use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use mime_guess::MimeGuess;
use tauri::State;
use tracing::warn;
use zip::ZipArchive;

use crate::app::adb::apps::{
    package_entry_to_app_info, parse_dumpsys_components_summary, parse_dumpsys_data_dir,
    parse_dumpsys_first_install_time, parse_dumpsys_granted_permissions,
    parse_dumpsys_initiating_package_name, parse_dumpsys_installer_package_name,
    parse_dumpsys_installing_package_name, parse_dumpsys_last_update_time,
    parse_dumpsys_originating_package_name, parse_dumpsys_package_versions,
    parse_dumpsys_requested_permissions, parse_dumpsys_target_sdk, parse_dumpsys_user_id,
    parse_dumpsys_version_code, parse_dumpsys_version_name, parse_pm_list_packages_output,
    parse_pm_path_output,
};
use crate::app::adb::parse::parse_ls_la;
use crate::app::adb::paths::sanitize_filename_component;
use crate::app::adb::runner::run_command_with_timeout;
use crate::app::error::AppError;
use crate::app::models::{
    AppBasicInfo, AppComponentsSummary, AppIcon, AppInfo, CommandResponse, CommandResult,
};
use crate::app::state::AppState;

use super::{ensure_non_empty, get_adb_program, resolve_trace_id};

fn cache_dir_for_app_icons() -> PathBuf {
    let base = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
    base.join("lazy_blacktea").join("app_icons")
}

fn density_rank(path: &str) -> i32 {
    let lower = path.to_lowercase();
    if lower.contains("xxxhdpi") {
        return 6;
    }
    if lower.contains("xxhdpi") {
        return 5;
    }
    if lower.contains("xhdpi") {
        return 4;
    }
    if lower.contains("hdpi") {
        return 3;
    }
    if lower.contains("mdpi") {
        return 2;
    }
    if lower.contains("ldpi") {
        return 1;
    }
    if lower.contains("nodpi") {
        return 0;
    }
    0
}

fn icon_name_rank(path: &str) -> i32 {
    let lower = path.to_lowercase();
    if lower.contains("ic_launcher") {
        return 6;
    }
    if lower.contains("launcher") {
        return 5;
    }
    if lower.contains("appicon") {
        return 4;
    }
    if lower.contains("app_icon") {
        return 4;
    }
    if lower.contains("icon") {
        return 2;
    }
    0
}

fn extract_best_icon_from_apk(
    path: &std::path::Path,
    trace_id: &str,
) -> Result<Option<(String, Vec<u8>)>, AppError> {
    let file = fs::File::open(path)
        .map_err(|err| AppError::system(format!("Failed to open APK: {err}"), trace_id))?;
    let mut zip = ZipArchive::new(file)
        .map_err(|err| AppError::system(format!("Failed to read APK zip: {err}"), trace_id))?;

    let mut best: Option<(i32, i32, u64, usize, String)> = None;
    for index in 0..zip.len() {
        let entry = match zip.by_index(index) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let name = entry.name().to_string();
        if !name.starts_with("res/") {
            continue;
        }
        let lower = name.to_lowercase();
        if !(lower.ends_with(".png") || lower.ends_with(".webp")) {
            continue;
        }
        if !(lower.contains("/mipmap") || lower.contains("/drawable")) {
            continue;
        }
        let name_score = icon_name_rank(&name);
        let density_score = density_rank(&name);
        let size = entry.size();
        let candidate = (name_score, density_score, size, index, name);
        if let Some(current) = &best {
            if candidate.0 > current.0
                || (candidate.0 == current.0 && candidate.1 > current.1)
                || (candidate.0 == current.0 && candidate.1 == current.1 && candidate.2 > current.2)
            {
                best = Some(candidate);
            }
        } else {
            best = Some(candidate);
        }
    }

    let Some((_name_score, _density_score, _size, index, entry_name)) = best else {
        return Ok(None);
    };

    let mut entry = zip
        .by_index(index)
        .map_err(|err| AppError::system(format!("Failed to read icon entry: {err}"), trace_id))?;
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|err| AppError::system(format!("Failed to read icon bytes: {err}"), trace_id))?;
    Ok(Some((entry_name, bytes)))
}

#[tauri::command(async)]
pub fn list_apps(
    serial: String,
    third_party_only: Option<bool>,
    include_versions: Option<bool>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<AppInfo>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let mut args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "pm".to_string(),
        "list".to_string(),
        "packages".to_string(),
        "-f".to_string(),
    ];
    if let Some(only_third_party) = third_party_only {
        if only_third_party {
            args.push("-3".to_string());
        } else {
            args.push("-s".to_string());
        }
    }

    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(30), &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("List apps failed: {}", output.stderr),
            &trace_id,
        ));
    }

    let versions_by_package = if include_versions.unwrap_or(false) {
        let dump_args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "dumpsys".to_string(),
            "package".to_string(),
        ];
        match run_command_with_timeout(&adb_program, &dump_args, Duration::from_secs(30), &trace_id)
        {
            Ok(out) if out.exit_code.unwrap_or_default() == 0 => {
                parse_dumpsys_package_versions(&out.stdout)
            }
            Ok(out) => {
                warn!(
                    trace_id = %trace_id,
                    exit_code = ?out.exit_code,
                    stderr = %out.stderr,
                    "bulk dumpsys package failed while listing app versions"
                );
                HashMap::new()
            }
            Err(err) => {
                warn!(
                    trace_id = %trace_id,
                    error = %err,
                    "bulk dumpsys package command failed while listing app versions"
                );
                HashMap::new()
            }
        }
    } else {
        HashMap::new()
    };

    let mut apps = Vec::new();
    for entry in parse_pm_list_packages_output(&output.stdout) {
        let version = versions_by_package.get(&entry.package_name);
        let version_name = version.and_then(|item| item.version_name.clone());
        let version_code = version.and_then(|item| item.version_code.clone());
        apps.push(package_entry_to_app_info(entry, version_name, version_code));
    }

    apps.sort_by(|a, b| a.package_name.cmp(&b.package_name));

    Ok(CommandResponse {
        trace_id,
        data: apps,
    })
}

#[tauri::command(async)]
pub fn get_app_icon(
    serial: String,
    package_name: String,
    apk_path: Option<String>,
    trace_id: Option<String>,
) -> Result<CommandResponse<AppIcon>, AppError> {
    use base64::Engine as _;

    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let safe_serial = sanitize_filename_component(&serial);
    let safe_pkg = sanitize_filename_component(&package_name);

    let cache_dir = cache_dir_for_app_icons().join(safe_serial);
    let cache_png = cache_dir.join(format!("{safe_pkg}.png"));
    let cache_webp = cache_dir.join(format!("{safe_pkg}.webp"));
    let existing_cache = if cache_png.exists() {
        Some(cache_png.clone())
    } else if cache_webp.exists() {
        Some(cache_webp.clone())
    } else {
        None
    };

    if let Some(cache_path) = existing_cache {
        let bytes = fs::read(&cache_path).map_err(|err| {
            AppError::system(format!("Failed to read cached icon: {err}"), &trace_id)
        })?;
        let mime_type = MimeGuess::from_path(&cache_path)
            .first_or_octet_stream()
            .essence_str()
            .to_string();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(CommandResponse {
            trace_id,
            data: AppIcon {
                package_name,
                mime_type: mime_type.clone(),
                data_url: format!("data:{mime_type};base64,{encoded}"),
                from_cache: true,
            },
        });
    }

    fs::create_dir_all(&cache_dir)
        .map_err(|err| AppError::system(format!("Failed to create cache dir: {err}"), &trace_id))?;

    let adb_program = get_adb_program(&trace_id)?;
    let resolved_apk_path = if let Some(path) = apk_path {
        path
    } else {
        let pm_path_args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "pm".to_string(),
            "path".to_string(),
            package_name.clone(),
        ];
        let output = run_command_with_timeout(
            &adb_program,
            &pm_path_args,
            Duration::from_secs(10),
            &trace_id,
        )?;
        if output.exit_code.unwrap_or_default() != 0 {
            return Err(AppError::dependency(
                format!("pm path failed: {}", output.stderr.trim()),
                &trace_id,
            ));
        }
        parse_pm_path_output(&output.stdout)
            .into_iter()
            .find(|item| item.ends_with("base.apk"))
            .or_else(|| parse_pm_path_output(&output.stdout).into_iter().next())
            .ok_or_else(|| AppError::dependency("pm path returned no APK path", &trace_id))?
    };

    if !resolved_apk_path.starts_with('/') {
        return Err(AppError::validation("Invalid APK path", &trace_id));
    }

    let temp_dir = tempfile::tempdir()
        .map_err(|err| AppError::system(format!("Failed to create temp dir: {err}"), &trace_id))?;
    let local_apk_path = temp_dir.path().join("base.apk");
    let local_apk_string = local_apk_path.to_string_lossy().to_string();

    let pull_args = vec![
        "-s".to_string(),
        serial.clone(),
        "pull".to_string(),
        resolved_apk_path.clone(),
        local_apk_string.clone(),
    ];
    let pull_output =
        run_command_with_timeout(&adb_program, &pull_args, Duration::from_secs(60), &trace_id)?;
    if pull_output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("Pull APK failed: {}", pull_output.stderr.trim()),
            &trace_id,
        ));
    }

    let Some((entry_name, icon_bytes)) = extract_best_icon_from_apk(&local_apk_path, &trace_id)?
    else {
        return Err(AppError::dependency(
            "Failed to locate icon in APK",
            &trace_id,
        ));
    };

    const MAX_ICON_BYTES: usize = 1_000_000;
    if icon_bytes.len() > MAX_ICON_BYTES {
        return Err(AppError::dependency(
            "Icon file too large to preview",
            &trace_id,
        ));
    }

    let mime_type = MimeGuess::from_path(&entry_name)
        .first_or_octet_stream()
        .essence_str()
        .to_string();
    let ext = if mime_type == "image/webp" {
        "webp"
    } else {
        "png"
    };
    let cache_path = cache_dir.join(format!("{safe_pkg}.{ext}"));
    fs::write(&cache_path, &icon_bytes).map_err(|err| {
        AppError::system(format!("Failed to write cached icon: {err}"), &trace_id)
    })?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(&icon_bytes);
    Ok(CommandResponse {
        trace_id,
        data: AppIcon {
            package_name,
            mime_type: mime_type.clone(),
            data_url: format!("data:{mime_type};base64,{encoded}"),
            from_cache: false,
        },
    })
}

#[tauri::command(async)]
pub fn get_app_basic_info(
    serial: String,
    package_name: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<AppBasicInfo>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;

    let dump_args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "dumpsys".to_string(),
        "package".to_string(),
        package_name.clone(),
    ];
    let output =
        run_command_with_timeout(&adb_program, &dump_args, Duration::from_secs(10), &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("Get app info failed: {}", output.stderr),
            &trace_id,
        ));
    }

    let version_name = parse_dumpsys_version_name(&output.stdout);
    let version_code = parse_dumpsys_version_code(&output.stdout);
    let first_install_time = parse_dumpsys_first_install_time(&output.stdout);
    let last_update_time = parse_dumpsys_last_update_time(&output.stdout);
    let installer_package_name = parse_dumpsys_installer_package_name(&output.stdout);
    let installing_package_name = parse_dumpsys_installing_package_name(&output.stdout);
    let originating_package_name = parse_dumpsys_originating_package_name(&output.stdout);
    let initiating_package_name = parse_dumpsys_initiating_package_name(&output.stdout);
    let uid = parse_dumpsys_user_id(&output.stdout);
    let data_dir = parse_dumpsys_data_dir(&output.stdout);
    let target_sdk = parse_dumpsys_target_sdk(&output.stdout);
    let requested_permissions = parse_dumpsys_requested_permissions(&output.stdout);
    let granted_permissions = parse_dumpsys_granted_permissions(&output.stdout);
    let (activities, services, receivers, providers) =
        parse_dumpsys_components_summary(&output.stdout);
    let components_summary = if activities + services + receivers + providers > 0 {
        Some(AppComponentsSummary {
            activities,
            services,
            receivers,
            providers,
        })
    } else {
        None
    };

    let pm_path_args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "pm".to_string(),
        "path".to_string(),
        package_name.clone(),
    ];
    let mut apk_paths = Vec::new();
    match run_command_with_timeout(
        &adb_program,
        &pm_path_args,
        Duration::from_secs(10),
        &trace_id,
    ) {
        Ok(out) => {
            if out.exit_code.unwrap_or_default() != 0 {
                warn!(
                    trace_id = %trace_id,
                    package_name = %package_name,
                    stderr = %out.stderr.trim(),
                    "pm path returned non-zero exit code"
                );
            } else {
                apk_paths = parse_pm_path_output(&out.stdout);
            }
        }
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                package_name = %package_name,
                error = %err,
                "pm path failed"
            );
        }
    }

    apk_paths.sort();
    apk_paths.dedup();

    const MAX_APK_PATHS: usize = 20;
    let mut apk_size_bytes_total = None;
    if !apk_paths.is_empty() {
        if apk_paths.len() > MAX_APK_PATHS {
            warn!(
                trace_id = %trace_id,
                package_name = %package_name,
                apk_paths_len = apk_paths.len(),
                max_apk_paths = MAX_APK_PATHS,
                "Too many APK paths; skipping size calculation"
            );
        } else {
            let mut total = 0u64;
            let mut has_error = false;
            for apk_path in &apk_paths {
                match try_get_device_file_size_bytes(&adb_program, &serial, apk_path, &trace_id) {
                    Some(size) => total = total.saturating_add(size),
                    None => {
                        has_error = true;
                        warn!(
                            trace_id = %trace_id,
                            package_name = %package_name,
                            apk_path = %apk_path,
                            "Failed to resolve APK size"
                        );
                    }
                }
            }
            if !has_error {
                apk_size_bytes_total = Some(total);
            }
        }
    }

    Ok(CommandResponse {
        trace_id,
        data: AppBasicInfo {
            package_name,
            version_name,
            version_code,
            first_install_time,
            last_update_time,
            installer_package_name,
            installing_package_name,
            originating_package_name,
            initiating_package_name,
            uid,
            data_dir,
            target_sdk,
            requested_permissions,
            granted_permissions,
            components_summary,
            apk_paths,
            apk_size_bytes_total,
        },
    })
}

#[tauri::command(async)]
pub fn uninstall_app(
    serial: String,
    package_name: String,
    keep_data: bool,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let mut args = vec!["-s".to_string(), serial.clone(), "uninstall".to_string()];
    if keep_data {
        args.push("-k".to_string());
    }
    args.push(package_name);
    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(30), &trace_id)?;
    let success = output.stdout.contains("Success") || output.exit_code.unwrap_or_default() == 0;

    Ok(CommandResponse {
        trace_id,
        data: success,
    })
}

fn try_get_device_file_size_bytes(
    adb_program: &str,
    serial: &str,
    path: &str,
    trace_id: &str,
) -> Option<u64> {
    let stat_args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "stat".to_string(),
        "-c".to_string(),
        "%s".to_string(),
        path.to_string(),
    ];
    if let Ok(out) =
        run_command_with_timeout(adb_program, &stat_args, Duration::from_secs(5), trace_id)
    {
        if out.exit_code.unwrap_or_default() == 0 {
            if let Some(size) = parse_stat_size_output(&out.stdout) {
                return Some(size);
            }
        }
    }

    let ls_args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "ls".to_string(),
        "-la".to_string(),
        path.to_string(),
    ];
    let out =
        run_command_with_timeout(adb_program, &ls_args, Duration::from_secs(5), trace_id).ok()?;
    if out.exit_code.unwrap_or_default() != 0 {
        return None;
    }

    let (dir, base) = split_device_path(path);
    let parsed = parse_ls_la(&dir, &out.stdout);
    if parsed.len() == 1 {
        return parsed[0].size_bytes;
    }
    parsed
        .into_iter()
        .find(|entry| entry.name == base || entry.path.ends_with(&format!("/{}", base)))
        .and_then(|entry| entry.size_bytes)
}

fn parse_stat_size_output(output: &str) -> Option<u64> {
    output
        .lines()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())
        .and_then(|line| line.parse::<u64>().ok())
}

fn split_device_path(path: &str) -> (String, String) {
    let trimmed = path.trim_end_matches('/');
    if let Some((dir, base)) = trimmed.rsplit_once('/') {
        let dir = if dir.is_empty() {
            "/".to_string()
        } else {
            dir.to_string()
        };
        return (dir, base.to_string());
    }
    (".".to_string(), trimmed.to_string())
}

#[tauri::command(async)]
pub fn force_stop_app(
    serial: String,
    package_name: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "am".to_string(),
        "force-stop".to_string(),
        package_name,
    ];
    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(10), &trace_id)?;

    Ok(CommandResponse {
        trace_id,
        data: output.exit_code.unwrap_or_default() == 0,
    })
}

#[tauri::command(async)]
pub fn clear_app_data(
    serial: String,
    package_name: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "pm".to_string(),
        "clear".to_string(),
        package_name,
    ];
    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(20), &trace_id)?;
    let success = output.stdout.to_lowercase().contains("success")
        || output.exit_code.unwrap_or_default() == 0;

    Ok(CommandResponse {
        trace_id,
        data: success,
    })
}

#[tauri::command(async)]
pub fn set_app_enabled(
    serial: String,
    package_name: String,
    enable: bool,
    user_id: Option<i32>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let mut args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "pm".to_string(),
    ];
    if enable {
        args.push("enable".to_string());
    } else {
        args.push("disable-user".to_string());
        if let Some(id) = user_id {
            args.push("--user".to_string());
            args.push(id.to_string());
        }
    }
    args.push(package_name);
    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(10), &trace_id)?;
    let normalized = format!(
        "{} {}",
        output.stdout.to_lowercase(),
        output.stderr.to_lowercase()
    );
    let success = if enable {
        normalized.contains("enabled") || normalized.trim().is_empty()
    } else {
        normalized.contains("disabled") || normalized.trim().is_empty()
    };

    Ok(CommandResponse {
        trace_id,
        data: success,
    })
}

#[tauri::command(async)]
pub fn open_app_info(
    serial: String,
    package_name: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let primary_args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "am".to_string(),
        "start".to_string(),
        "-a".to_string(),
        "android.settings.APPLICATION_DETAILS_SETTINGS".to_string(),
        "-d".to_string(),
        format!("package:{package_name}"),
    ];
    let output = run_command_with_timeout(
        &adb_program,
        &primary_args,
        Duration::from_secs(10),
        &trace_id,
    )?;
    let combined = format!(
        "{}{}",
        output.stdout.to_lowercase(),
        output.stderr.to_lowercase()
    );
    if output.exit_code.unwrap_or_default() != 0
        || combined.contains("error")
        || combined.contains("exception")
        || combined.contains("unable")
    {
        let legacy_args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "am".to_string(),
            "start".to_string(),
            "-n".to_string(),
            "com.android.settings/.applications.InstalledAppDetails".to_string(),
            "-e".to_string(),
            "package".to_string(),
            package_name,
        ];
        let _ = run_command_with_timeout(
            &adb_program,
            &legacy_args,
            Duration::from_secs(10),
            &trace_id,
        )?;
    }

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn launch_app(
    serials: Vec<String>,
    package_name: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&package_name, "package_name", &trace_id)?;
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let adb_program = get_adb_program(&trace_id)?;
    let scheduler = Arc::clone(&state.scheduler);

    let mut handles = Vec::new();
    for (index, serial) in serials.into_iter().enumerate() {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let scheduler_clone = Arc::clone(&scheduler);
        let trace_clone = trace_id.clone();
        let adb_program_clone = adb_program.clone();
        let package_clone = package_name.clone();
        handles.push(std::thread::spawn(move || -> Result<_, AppError> {
            let _permit = scheduler_clone.acquire_global();
            let device_lock = scheduler_clone.device_lock(&serial);
            let _device_guard = device_lock.lock().map_err(|_| {
                warn!(trace_id = %trace_clone, serial = %serial, "device lock poisoned");
                AppError::system(
                    "Failed to access the device. Please try again.",
                    &trace_clone,
                )
            })?;

            let args = vec![
                "-s".to_string(),
                serial.clone(),
                "shell".to_string(),
                "monkey".to_string(),
                "-p".to_string(),
                package_clone,
                "-c".to_string(),
                "android.intent.category.LAUNCHER".to_string(),
                "1".to_string(),
            ];
            let output = run_command_with_timeout(
                &adb_program_clone,
                &args,
                Duration::from_secs(10),
                &trace_clone,
            )?;
            Ok((
                index,
                CommandResult {
                    serial,
                    stdout: output.stdout,
                    stderr: output.stderr,
                    exit_code: output.exit_code,
                },
            ))
        }));
    }

    let mut collected = Vec::new();
    for handle in handles {
        let (index, result) = handle
            .join()
            .map_err(|_| AppError::system("Launch app thread panicked", &trace_id))??;
        collected.push((index, result));
    }
    collected.sort_by_key(|item| item.0);
    let results = collected.into_iter().map(|item| item.1).collect();

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}
