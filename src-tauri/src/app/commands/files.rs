use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

use mime_guess::MimeGuess;
use tauri::AppHandle;

use crate::app::adb::parse::parse_ls_la;
use crate::app::adb::paths::{
    device_parent_dir, floor_char_boundary, quote_adb_shell_arg, validate_device_browse_path,
    validate_device_path,
};
use crate::app::adb::runner::run_command_with_timeout;
use crate::app::error::AppError;
use crate::app::models::{CommandResponse, DeviceFileEntry, FilePreview};

use super::{ensure_non_empty, get_adb_program, resolve_trace_id, run_adb_transfer_with_progress};

#[tauri::command(async)]
pub fn list_device_files(
    serial: String,
    path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<DeviceFileEntry>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&path, "path", &trace_id)?;

    if let Err(message) = validate_device_browse_path(&path) {
        return Err(AppError::validation(message, &trace_id));
    }

    let adb_program = get_adb_program(&trace_id)?;
    let normalized = path.trim().to_string();
    let dir_hint = if normalized == "/" {
        "/".to_string()
    } else {
        format!("{}/", normalized.trim_end_matches('/'))
    };
    let dir_args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "ls".to_string(),
        "-la".to_string(),
        quote_adb_shell_arg(&dir_hint),
    ];
    let mut output =
        run_command_with_timeout(&adb_program, &dir_args, Duration::from_secs(300), &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        let fallback_args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "ls".to_string(),
            "-la".to_string(),
            quote_adb_shell_arg(&normalized),
        ];
        output = run_command_with_timeout(
            &adb_program,
            &fallback_args,
            Duration::from_secs(300),
            &trace_id,
        )?;
    }
    let entries = parse_ls_la(&normalized, &output.stdout);

    Ok(CommandResponse {
        trace_id,
        data: entries,
    })
}

#[tauri::command(async)]
pub fn pull_device_file(
    serial: String,
    device_path: String,
    output_dir: String,
    app: AppHandle,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&device_path, "device_path", &trace_id)?;
    ensure_non_empty(&output_dir, "output_dir", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    fs::create_dir_all(&output_dir).map_err(|err| {
        AppError::system(format!("Failed to create output dir: {err}"), &trace_id)
    })?;

    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "pull".to_string(),
        "-p".to_string(),
        device_path.clone(),
        output_dir.clone(),
    ];
    let app_progress = app.clone();
    let mut output = run_adb_transfer_with_progress(
        &adb_program,
        &args,
        Duration::from_secs(600),
        &serial,
        "pull",
        &trace_id,
        app_progress,
    )?;
    if output.exit_code.unwrap_or_default() != 0 {
        let combined = format!("{}\n{}", output.stdout, output.stderr).to_lowercase();
        if combined.contains("unknown option") && combined.contains("-p") {
            let fallback_args: Vec<String> = args
                .iter()
                .filter(|value| value.as_str() != "-p")
                .cloned()
                .collect();
            output = run_adb_transfer_with_progress(
                &adb_program,
                &fallback_args,
                Duration::from_secs(600),
                &serial,
                "pull",
                &trace_id,
                app.clone(),
            )?;
        }
    }
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("Pull failed: {}", output.stderr),
            &trace_id,
        ));
    }

    let filename = PathBuf::from(&device_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());
    let local_path = PathBuf::from(output_dir)
        .join(filename)
        .to_string_lossy()
        .to_string();

    Ok(CommandResponse {
        trace_id,
        data: local_path,
    })
}

#[tauri::command(async)]
pub fn push_device_file(
    serial: String,
    local_path: String,
    device_path: String,
    app: AppHandle,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&local_path, "local_path", &trace_id)?;
    ensure_non_empty(&device_path, "device_path", &trace_id)?;

    if let Err(message) = validate_device_path(&device_path) {
        return Err(AppError::validation(message, &trace_id));
    }

    let host_path = PathBuf::from(&local_path);
    if !host_path.exists() {
        return Err(AppError::validation("Local file does not exist", &trace_id));
    }
    if !host_path.is_file() {
        return Err(AppError::validation("Local path must be a file", &trace_id));
    }

    let adb_program = get_adb_program(&trace_id)?;

    let device_dir = device_parent_dir(&device_path);
    if device_dir != "/" {
        let mkdir_args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "mkdir".to_string(),
            "-p".to_string(),
            quote_adb_shell_arg(&device_dir),
        ];
        let mkdir_output = run_command_with_timeout(
            &adb_program,
            &mkdir_args,
            Duration::from_secs(10),
            &trace_id,
        )?;
        if mkdir_output.exit_code.unwrap_or_default() != 0 {
            return Err(AppError::dependency(
                format!("Failed to create device directory: {}", mkdir_output.stderr),
                &trace_id,
            ));
        }
    }

    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "push".to_string(),
        "-p".to_string(),
        local_path.clone(),
        device_path.clone(),
    ];
    let app_progress = app.clone();
    let mut output = run_adb_transfer_with_progress(
        &adb_program,
        &args,
        Duration::from_secs(600),
        &serial,
        "push",
        &trace_id,
        app_progress,
    )?;
    if output.exit_code.unwrap_or_default() != 0 {
        let combined = format!("{}\n{}", output.stdout, output.stderr).to_lowercase();
        if combined.contains("unknown option") && combined.contains("-p") {
            let fallback_args: Vec<String> = args
                .iter()
                .filter(|value| value.as_str() != "-p")
                .cloned()
                .collect();
            output = run_adb_transfer_with_progress(
                &adb_program,
                &fallback_args,
                Duration::from_secs(600),
                &serial,
                "push",
                &trace_id,
                app.clone(),
            )?;
        }
    }
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("Push failed: {}", output.stderr),
            &trace_id,
        ));
    }

    Ok(CommandResponse {
        trace_id,
        data: device_path,
    })
}

#[tauri::command(async)]
pub fn mkdir_device_dir(
    serial: String,
    device_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&device_path, "device_path", &trace_id)?;

    if let Err(message) = validate_device_path(&device_path) {
        return Err(AppError::validation(message, &trace_id));
    }

    let adb_program = get_adb_program(&trace_id)?;
    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "mkdir".to_string(),
        "-p".to_string(),
        quote_adb_shell_arg(&device_path),
    ];
    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(10), &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("mkdir failed: {}", output.stderr),
            &trace_id,
        ));
    }

    Ok(CommandResponse {
        trace_id,
        data: device_path,
    })
}

#[tauri::command(async)]
pub fn rename_device_path(
    serial: String,
    from_path: String,
    to_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&from_path, "from_path", &trace_id)?;
    ensure_non_empty(&to_path, "to_path", &trace_id)?;

    if let Err(message) = validate_device_path(&from_path) {
        return Err(AppError::validation(message, &trace_id));
    }
    if let Err(message) = validate_device_path(&to_path) {
        return Err(AppError::validation(message, &trace_id));
    }
    if from_path.trim() == to_path.trim() {
        return Err(AppError::validation(
            "from_path and to_path must be different",
            &trace_id,
        ));
    }

    let adb_program = get_adb_program(&trace_id)?;
    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "mv".to_string(),
        quote_adb_shell_arg(&from_path),
        quote_adb_shell_arg(&to_path),
    ];
    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(10), &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("rename failed: {}", output.stderr),
            &trace_id,
        ));
    }

    Ok(CommandResponse {
        trace_id,
        data: to_path,
    })
}

#[tauri::command(async)]
pub fn delete_device_path(
    serial: String,
    device_path: String,
    recursive: bool,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&device_path, "device_path", &trace_id)?;

    if let Err(message) = validate_device_path(&device_path) {
        return Err(AppError::validation(message, &trace_id));
    }

    let adb_program = get_adb_program(&trace_id)?;
    let mut args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "rm".to_string(),
    ];
    if recursive {
        args.push("-rf".to_string());
    } else {
        args.push("-f".to_string());
    }
    args.push(quote_adb_shell_arg(&device_path));

    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(10), &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("delete failed: {}", output.stderr),
            &trace_id,
        ));
    }

    Ok(CommandResponse {
        trace_id,
        data: device_path,
    })
}

#[tauri::command(async)]
pub fn preview_local_file(
    local_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<FilePreview>, AppError> {
    use base64::Engine as _;

    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&local_path, "local_path", &trace_id)?;

    let path = PathBuf::from(&local_path);
    if !path.exists() {
        return Err(AppError::validation("File does not exist", &trace_id));
    }

    let mime = MimeGuess::from_path(&path).first_or_octet_stream();
    let mime_type = mime.essence_str().to_string();

    const MAX_TEXT_PREVIEW_BYTES: usize = 200_000;
    const MAX_IMAGE_PREVIEW_BYTES: usize = 6_000_000;
    let mut file = fs::File::open(&path)
        .map_err(|err| AppError::system(format!("Failed to open file: {err}"), &trace_id))?;
    let mut buffer = Vec::new();
    let is_image = mime_type.starts_with("image/");
    let max_preview_bytes = if is_image {
        MAX_IMAGE_PREVIEW_BYTES
    } else {
        MAX_TEXT_PREVIEW_BYTES
    };
    std::io::Read::by_ref(&mut file)
        .take((max_preview_bytes + 1) as u64)
        .read_to_end(&mut buffer)
        .map_err(|err| AppError::system(format!("Failed to read file: {err}"), &trace_id))?;

    let mut preview_text = None;
    let mut is_text = false;
    let mut preview_data_url = None;

    if is_image {
        // For images we only return a data URL if we captured the full file within the cap.
        if buffer.len() <= max_preview_bytes {
            let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer);
            preview_data_url = Some(format!("data:{mime_type};base64,{encoded}"));
        }
    } else if let Ok(text) = std::str::from_utf8(&buffer) {
        if !contains_binary_control_chars(text) {
            is_text = true;
            let mut content = text.to_string();
            if buffer.len() > MAX_TEXT_PREVIEW_BYTES {
                let boundary = floor_char_boundary(&content, MAX_TEXT_PREVIEW_BYTES);
                content.truncate(boundary);
                content.push_str("\n… (truncated)");
            }
            preview_text = Some(content);
        }
    }

    let is_text_flag = is_text || mime_type.starts_with("text/");

    Ok(CommandResponse {
        trace_id,
        data: FilePreview {
            local_path,
            mime_type,
            is_text: is_text_flag,
            preview_text,
            preview_data_url,
        },
    })
}

fn contains_binary_control_chars(text: &str) -> bool {
    for ch in text.chars() {
        if ch == '\n' || ch == '\r' || ch == '\t' {
            continue;
        }
        if ch == '\u{0}' || ch < '\u{20}' {
            return true;
        }
    }
    false
}
