use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use mime_guess::MimeGuess;
use tauri::{AppHandle, Emitter, State};
use tracing::{info, warn};
use uuid::Uuid;

use crate::app::adb::apk::{extract_split_apks, get_apk_info, is_split_bundle, normalize_apk_path};
use crate::app::adb::apps::{
    package_entry_to_app_info, parse_dumpsys_version_code, parse_dumpsys_version_name,
    parse_pm_list_packages_output,
};
use crate::app::adb::bugreport::{parse_bugreportz_line, BugreportzPayload};
use crate::app::adb::parse::{
    build_device_detail, parse_adb_devices, parse_audio_summary, parse_battery_level,
    parse_bluetooth_manager_state, parse_dumpsys_version_name as parse_gms_version_name,
    parse_getprop_map, parse_ls_la, parse_settings_bool,
};
use crate::app::adb::runner::{run_adb, run_command_with_timeout};
use crate::app::adb::scrcpy::{build_scrcpy_command, check_scrcpy_availability};
use crate::app::bluetooth::service::start_bluetooth_monitor as start_bluetooth_monitor_service;
use crate::app::config::{load_config, save_config, AppConfig};
use crate::app::error::AppError;
use crate::app::models::{
    ApkBatchInstallResult, ApkInstallErrorCode, ApkInstallResult, AppInfo, BugreportResult,
    CommandResponse, CommandResult, DeviceFileEntry, DeviceInfo, FilePreview, HostCommandResult,
    ScrcpyInfo,
};
use crate::app::state::{AppState, BugreportHandle, LogcatHandle, RecordingHandle};
use crate::app::ui_xml::render_device_ui_html;

#[derive(Clone, serde::Serialize)]
pub struct LogcatEvent {
    pub serial: String,
    pub line: String,
    pub trace_id: String,
}

fn resolve_trace_id(input: Option<String>) -> String {
    input.filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

fn ensure_non_empty(value: &str, field: &str, trace_id: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::validation(format!("{field} is required"), trace_id));
    }
    Ok(())
}

#[tauri::command]
pub fn get_config(trace_id: Option<String>) -> Result<CommandResponse<AppConfig>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let config = load_config().map_err(|err| AppError::system(err.error, &trace_id))?;
    Ok(CommandResponse {
        trace_id,
        data: config,
    })
}

#[tauri::command]
pub fn save_app_config(
    config: AppConfig,
    trace_id: Option<String>,
) -> Result<CommandResponse<AppConfig>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    save_config(&config).map_err(|err| AppError::system(err.error, &trace_id))?;
    Ok(CommandResponse {
        trace_id,
        data: config,
    })
}

#[tauri::command]
pub fn reset_config(trace_id: Option<String>) -> Result<CommandResponse<AppConfig>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let config = AppConfig::default();
    save_config(&config).map_err(|err| AppError::system(err.error, &trace_id))?;
    Ok(CommandResponse {
        trace_id,
        data: config,
    })
}

#[tauri::command]
pub fn list_devices(
    detailed: Option<bool>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<DeviceInfo>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    info!(trace_id = %trace_id, "list_devices");

    let args = vec!["devices".to_string(), "-l".to_string()];
    let output = run_adb(&args, &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("adb devices failed: {}", output.stderr),
            &trace_id,
        ));
    }
    let summaries = parse_adb_devices(&output.stdout);
    let mut devices = Vec::with_capacity(summaries.len());

    let need_detail = detailed.unwrap_or(true);
    for summary in summaries {
        let detail = if need_detail && summary.state == "device" {
            let getprop_args = vec![
                "-s".to_string(),
                summary.serial.clone(),
                "shell".to_string(),
                "getprop".to_string(),
            ];
            let getprop = run_command_with_timeout("adb", &getprop_args, Duration::from_secs(5), &trace_id);
            let battery_args = vec![
                "-s".to_string(),
                summary.serial.clone(),
                "shell".to_string(),
                "dumpsys".to_string(),
                "battery".to_string(),
            ];
            let battery = run_command_with_timeout("adb", &battery_args, Duration::from_secs(5), &trace_id);
            let wifi_args = vec![
                "-s".to_string(),
                summary.serial.clone(),
                "shell".to_string(),
                "settings".to_string(),
                "get".to_string(),
                "global".to_string(),
                "wifi_on".to_string(),
            ];
            let wifi_output = run_command_with_timeout(
                "adb",
                &wifi_args,
                Duration::from_secs(5),
                &trace_id,
            );
            let bt_args = vec![
                "-s".to_string(),
                summary.serial.clone(),
                "shell".to_string(),
                "settings".to_string(),
                "get".to_string(),
                "global".to_string(),
                "bluetooth_on".to_string(),
            ];
            let bt_output = run_command_with_timeout(
                "adb",
                &bt_args,
                Duration::from_secs(5),
                &trace_id,
            );
            let bt_state_args = vec![
                "-s".to_string(),
                summary.serial.clone(),
                "shell".to_string(),
                "cmd".to_string(),
                "bluetooth_manager".to_string(),
                "get-state".to_string(),
            ];
            let bt_state_output = run_command_with_timeout(
                "adb",
                &bt_state_args,
                Duration::from_secs(5),
                &trace_id,
            );
            let audio_args = vec![
                "-s".to_string(),
                summary.serial.clone(),
                "shell".to_string(),
                "dumpsys".to_string(),
                "audio".to_string(),
            ];
            let audio_output = run_command_with_timeout(
                "adb",
                &audio_args,
                Duration::from_secs(5),
                &trace_id,
            );
            let gms_args = vec![
                "-s".to_string(),
                summary.serial.clone(),
                "shell".to_string(),
                "dumpsys".to_string(),
                "package".to_string(),
                "com.google.android.gms".to_string(),
            ];
            let gms_output = run_command_with_timeout(
                "adb",
                &gms_args,
                Duration::from_secs(5),
                &trace_id,
            );

            match getprop {
                Ok(output) => {
                    let mut detail = build_device_detail(&summary.serial, &parse_getprop_map(&output.stdout));
                    if let Ok(battery_output) = battery {
                        detail.battery_level = parse_battery_level(&battery_output.stdout);
                    }
                    if let Ok(wifi_output) = wifi_output {
                        detail.wifi_is_on = parse_settings_bool(&wifi_output.stdout);
                    }
                    if let Ok(bt_output) = bt_output {
                        detail.bt_is_on = parse_settings_bool(&bt_output.stdout);
                    }
                    let bt_state = bt_state_output
                        .ok()
                        .and_then(|output| parse_bluetooth_manager_state(&output.stdout));
                    if detail.bt_is_on.is_none() {
                        if let Some(state) = bt_state.as_deref() {
                            detail.bt_is_on = Some(state.contains("ON"));
                        }
                    }
                    detail.bluetooth_manager_state = bt_state;
                    if let Ok(audio_output) = audio_output {
                        detail.audio_state = parse_audio_summary(&audio_output.stdout);
                    }
                    if let Ok(gms_output) = gms_output {
                        detail.gms_version = parse_gms_version_name(&gms_output.stdout);
                    }
                    Some(detail)
                }
                Err(err) => {
                    warn!(trace_id = %trace_id, error = %err, "failed to load device detail");
                    None
                }
            }
        } else {
            None
        };
        devices.push(DeviceInfo { summary, detail });
    }

    Ok(CommandResponse {
        trace_id,
        data: devices,
    })
}

#[tauri::command]
pub fn adb_pair(
    address: String,
    pairing_code: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<HostCommandResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&address, "address", &trace_id)?;
    ensure_non_empty(&pairing_code, "pairing_code", &trace_id)?;

    let args = vec![
        "pair".to_string(),
        address.clone(),
        pairing_code.clone(),
    ];
    let output = run_command_with_timeout("adb", &args, Duration::from_secs(10), &trace_id)?;
    let combined = format!("{}{}", output.stdout, output.stderr).to_lowercase();
    if output.exit_code.unwrap_or_default() != 0 || combined.contains("failed") || combined.contains("unable") {
        let detail = if output.stderr.trim().is_empty() {
            output.stdout.trim()
        } else {
            output.stderr.trim()
        };
        return Err(AppError::dependency(
            format!("adb pair failed: {detail}"),
            &trace_id,
        ));
    }

    Ok(CommandResponse {
        trace_id,
        data: HostCommandResult {
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        },
    })
}

#[tauri::command]
pub fn adb_connect(
    address: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<HostCommandResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&address, "address", &trace_id)?;

    let args = vec!["connect".to_string(), address.clone()];
    let output = run_command_with_timeout("adb", &args, Duration::from_secs(10), &trace_id)?;
    let combined = format!("{}{}", output.stdout, output.stderr).to_lowercase();
    if output.exit_code.unwrap_or_default() != 0 || combined.contains("failed") || combined.contains("unable") {
        let detail = if output.stderr.trim().is_empty() {
            output.stdout.trim()
        } else {
            output.stderr.trim()
        };
        return Err(AppError::dependency(
            format!("adb connect failed: {detail}"),
            &trace_id,
        ));
    }

    Ok(CommandResponse {
        trace_id,
        data: HostCommandResult {
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        },
    })
}

#[tauri::command]
pub fn run_shell(
    serials: Vec<String>,
    command: String,
    parallel: Option<bool>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&command, "command", &trace_id)?;
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let mut config = load_config().unwrap_or_default();
    let timeout = Duration::from_secs(config.command.command_timeout.max(1) as u64);
    let use_parallel = parallel.unwrap_or(config.command.parallel_execution);

    let mut results = Vec::with_capacity(serials.len());
    if use_parallel {
        let mut handles = Vec::new();
        for (index, serial) in serials.into_iter().enumerate() {
            ensure_non_empty(&serial, "serial", &trace_id)?;
            let trace_id_clone = trace_id.clone();
            let command_clone = command.clone();
            handles.push(std::thread::spawn(move || {
                let args = vec![
                    "-s".to_string(),
                    serial.clone(),
                    "shell".to_string(),
                    "sh".to_string(),
                    "-c".to_string(),
                    command_clone,
                ];
                let output = run_command_with_timeout("adb", &args, timeout, &trace_id_clone);
                (index, serial, output)
            }));
        }

        let mut collected = Vec::new();
        for handle in handles {
            let (index, serial, output) = handle
                .join()
                .map_err(|_| AppError::system("Shell command thread panicked", &trace_id))?;
            let output = output?;
            collected.push((index, CommandResult {
                serial,
                stdout: output.stdout,
                stderr: output.stderr,
                exit_code: output.exit_code,
            }));
        }
        collected.sort_by_key(|item| item.0);
        results = collected.into_iter().map(|item| item.1).collect();
    } else {
        for serial in serials {
            ensure_non_empty(&serial, "serial", &trace_id)?;
            let args = vec![
                "-s".to_string(),
                serial.clone(),
                "shell".to_string(),
                "sh".to_string(),
                "-c".to_string(),
                command.clone(),
            ];
            let output = run_command_with_timeout("adb", &args, timeout, &trace_id)?;
            results.push(CommandResult {
                serial,
                stdout: output.stdout,
                stderr: output.stderr,
                exit_code: output.exit_code,
            });
        }
    }

    if config.command.auto_save_history && !command.trim().is_empty() {
        if config.command_history.last().map(|last| last == &command).unwrap_or(false) {
            // skip duplicate trailing entry
        } else {
            config.command_history.push(command.clone());
            if config.command_history.len() > config.command.max_history_size {
                let start = config.command_history.len().saturating_sub(config.command.max_history_size);
                config.command_history = config.command_history.split_off(start);
            }
            let _ = save_config(&config);
        }
    }

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}

#[tauri::command]
pub fn reboot_devices(
    serials: Vec<String>,
    mode: Option<String>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let mode = mode.unwrap_or_else(|| "system".to_string());
    let mut results = Vec::with_capacity(serials.len());
    for serial in serials {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let mut args = vec!["-s".to_string(), serial.clone(), "reboot".to_string()];
        match mode.as_str() {
            "recovery" => args.push("recovery".to_string()),
            "bootloader" => args.push("bootloader".to_string()),
            _ => {}
        }
        let output = run_command_with_timeout("adb", &args, Duration::from_secs(10), &trace_id)?;
        results.push(CommandResult {
            serial,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        });
    }

    Ok(CommandResponse { trace_id, data: results })
}

#[tauri::command]
pub fn set_wifi_state(
    serials: Vec<String>,
    enable: bool,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let mut results = Vec::with_capacity(serials.len());
    for serial in serials {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "svc".to_string(),
            "wifi".to_string(),
            if enable { "enable" } else { "disable" }.to_string(),
        ];
        let output = run_command_with_timeout("adb", &args, Duration::from_secs(10), &trace_id)?;
        results.push(CommandResult {
            serial,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        });
    }

    Ok(CommandResponse { trace_id, data: results })
}

#[tauri::command]
pub fn set_bluetooth_state(
    serials: Vec<String>,
    enable: bool,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let mut results = Vec::with_capacity(serials.len());
    for serial in serials {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let mut args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "svc".to_string(),
            "bluetooth".to_string(),
            if enable { "enable" } else { "disable" }.to_string(),
        ];
        let mut output = run_command_with_timeout("adb", &args, Duration::from_secs(10), &trace_id);
        if output
            .as_ref()
            .ok()
            .and_then(|out| out.exit_code)
            .unwrap_or(1)
            != 0
        {
            args = vec![
                "-s".to_string(),
                serial.clone(),
                "shell".to_string(),
                "service".to_string(),
                "call".to_string(),
                "bluetooth_manager".to_string(),
                if enable { "8" } else { "9" }.to_string(),
            ];
            output = run_command_with_timeout("adb", &args, Duration::from_secs(10), &trace_id);
        }
        let output = output?;
        results.push(CommandResult {
            serial,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        });
    }

    Ok(CommandResponse { trace_id, data: results })
}

#[tauri::command]
pub fn install_apk_batch(
    serials: Vec<String>,
    apk_path: String,
    replace: bool,
    allow_downgrade: bool,
    grant: bool,
    allow_test_packages: bool,
    extra_args: Option<String>,
    trace_id: Option<String>,
) -> Result<CommandResponse<ApkBatchInstallResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&apk_path, "apk_path", &trace_id)?;
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let normalized = normalize_apk_path(&apk_path);
    let apk_path = normalized.to_string_lossy().to_string();
    let mut result = ApkBatchInstallResult {
        apk_path: apk_path.clone(),
        apk_info: None,
        results: HashMap::new(),
        total_duration_seconds: 0.0,
    };

    let start = std::time::Instant::now();

    let mut split_bundle = None;
    if is_split_bundle(&apk_path) {
        let bundle = extract_split_apks(&apk_path)
            .map_err(|err| AppError::dependency(err, &trace_id))?;
        if bundle.apk_paths.is_empty() {
            for serial in &serials {
                result.results.insert(
                    serial.clone(),
                    ApkInstallResult {
                        serial: serial.clone(),
                        success: false,
                        error_code: ApkInstallErrorCode::InstallFailedInvalidApk,
                        raw_output: "Failed to extract split APKs".to_string(),
                        duration_seconds: 0.0,
                        device_model: None,
                    },
                );
            }
            result.total_duration_seconds = start.elapsed().as_secs_f64();
            return Ok(CommandResponse { trace_id, data: result });
        }
        split_bundle = Some(bundle);
    } else {
        let apk_info = get_apk_info(&apk_path);
        result.apk_info = Some(apk_info.clone());
        if !apk_info.is_valid() {
            for serial in &serials {
                result.results.insert(
                    serial.clone(),
                    ApkInstallResult {
                        serial: serial.clone(),
                        success: false,
                        error_code: ApkInstallErrorCode::InstallFailedInvalidApk,
                        raw_output: apk_info.error.clone().unwrap_or_default(),
                        duration_seconds: 0.0,
                        device_model: None,
                    },
                );
            }
            result.total_duration_seconds = start.elapsed().as_secs_f64();
            return Ok(CommandResponse { trace_id, data: result });
        }
    }

    let extra_args_list = extra_args
        .unwrap_or_default()
        .split_whitespace()
        .map(|item| item.to_string())
        .collect::<Vec<_>>();

    let use_parallel = load_config()
        .map(|config| config.command.parallel_execution)
        .unwrap_or(true);

    let mut handles = Vec::new();
    for serial in serials {
        let trace_clone = trace_id.clone();
        let extra_args_list = extra_args_list.clone();
        let split_paths = split_bundle
            .as_ref()
            .map(|bundle| bundle.apk_paths.clone());
        let apk_path_clone = apk_path.clone();
        handles.push(std::thread::spawn(move || {
            let start_device = std::time::Instant::now();
            let mut args = vec!["-s".to_string(), serial.clone()];
            if let Some(paths) = split_paths {
                args.push("install-multiple".to_string());
                if replace {
                    args.push("-r".to_string());
                }
                if allow_downgrade {
                    args.push("-d".to_string());
                }
                if grant {
                    args.push("-g".to_string());
                }
                if allow_test_packages {
                    args.push("-t".to_string());
                }
                args.extend(extra_args_list.clone());
                args.extend(paths);
            } else {
                args.push("install".to_string());
                if replace {
                    args.push("-r".to_string());
                }
                if allow_downgrade {
                    args.push("-d".to_string());
                }
                if grant {
                    args.push("-g".to_string());
                }
                if allow_test_packages {
                    args.push("-t".to_string());
                }
                args.extend(extra_args_list.clone());
                args.push(apk_path_clone);
            }
            let output = run_command_with_timeout("adb", &args, Duration::from_secs(180), &trace_clone);
            let elapsed = start_device.elapsed().as_secs_f64();
            match output {
                Ok(output) => {
                    let raw = if output.stdout.trim().is_empty() {
                        output.stderr.clone()
                    } else {
                        output.stdout.clone()
                    };
                    let error_code = ApkInstallErrorCode::from_output(&raw);
                    let success = error_code == ApkInstallErrorCode::Success;
                    ApkInstallResult {
                        serial,
                        success,
                        error_code,
                        raw_output: raw,
                        duration_seconds: elapsed,
                        device_model: None,
                    }
                }
                Err(err) => ApkInstallResult {
                    serial,
                    success: false,
                    error_code: ApkInstallErrorCode::UnknownError,
                    raw_output: err.error,
                    duration_seconds: elapsed,
                    device_model: None,
                },
            }
        }));
        if !use_parallel {
            if let Some(handle) = handles.pop() {
                let result_item = handle
                    .join()
                    .map_err(|_| AppError::system("Install thread panicked", &trace_id))?;
                result.results.insert(result_item.serial.clone(), result_item);
            }
        }
    }

    for handle in handles {
        let result_item = handle
            .join()
            .map_err(|_| AppError::system("Install thread panicked", &trace_id))?;
        result.results.insert(result_item.serial.clone(), result_item);
    }

    result.total_duration_seconds = start.elapsed().as_secs_f64();

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

#[tauri::command]
pub fn capture_screenshot(
    serial: String,
    output_dir: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&output_dir, "output_dir", &trace_id)?;

    let config = load_config().unwrap_or_default();
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("screenshot_{}_{}.png", serial, timestamp);
    let mut output_path = PathBuf::from(output_dir);
    fs::create_dir_all(&output_path)
        .map_err(|err| AppError::system(format!("Failed to create output dir: {err}"), &trace_id))?;
    output_path.push(filename);

    let mut args = vec![
        "-s".to_string(),
        serial.clone(),
        "exec-out".to_string(),
        "screencap".to_string(),
        "-p".to_string(),
    ];
    if config.screenshot.display_id >= 0 {
        args.push("-d".to_string());
        args.push(config.screenshot.display_id.to_string());
    }
    if !config.screenshot.extra_args.trim().is_empty() {
        args.extend(
            config
                .screenshot
                .extra_args
                .split_whitespace()
                .map(|item| item.to_string()),
        );
    }

    let output = Command::new("adb")
        .args(&args)
        .output()
        .map_err(|err| AppError::dependency(format!("Failed to run adb: {err}"), &trace_id))?;

    if !output.status.success() {
        return Err(AppError::dependency(
            format!("Screenshot failed: {}", String::from_utf8_lossy(&output.stderr)),
            &trace_id,
        ));
    }

    fs::write(&output_path, &output.stdout)
        .map_err(|err| AppError::system(format!("Failed to write screenshot: {err}"), &trace_id))?;

    Ok(CommandResponse {
        trace_id,
        data: output_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn start_screen_record(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let mut guard = state
        .recording_processes
        .lock()
        .map_err(|_| AppError::system("Recording registry locked", &trace_id))?;
    if guard.contains_key(&serial) {
        return Err(AppError::validation("Recording already active", &trace_id));
    }

    let config = load_config().unwrap_or_default();
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let remote_path = format!("/sdcard/screenrecord_{}_{}.mp4", serial, timestamp);

    let mut args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "screenrecord".to_string(),
    ];
    if !config.screen_record.bit_rate.trim().is_empty() {
        args.push("--bit-rate".to_string());
        args.push(config.screen_record.bit_rate.trim().to_string());
    }
    if config.screen_record.time_limit_sec > 0 {
        args.push("--time-limit".to_string());
        args.push(config.screen_record.time_limit_sec.to_string());
    }
    if !config.screen_record.size.trim().is_empty() {
        args.push("--size".to_string());
        args.push(config.screen_record.size.trim().to_string());
    }
    if config.screen_record.use_hevc {
        args.push("--codec".to_string());
        args.push("hevc".to_string());
    }
    if config.screen_record.bugreport {
        args.push("--bugreport".to_string());
    }
    if config.screen_record.verbose {
        args.push("--verbose".to_string());
    }
    if config.screen_record.display_id >= 0 {
        args.push("--display-id".to_string());
        args.push(config.screen_record.display_id.to_string());
    }
    if !config.screen_record.extra_args.trim().is_empty() {
        args.extend(
            config
                .screen_record
                .extra_args
                .split_whitespace()
                .map(|item| item.to_string()),
        );
    }
    args.push(remote_path.clone());

    let child = Command::new("adb")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| AppError::dependency(format!("Failed to start screenrecord: {err}"), &trace_id))?;

    guard.insert(
        serial,
        RecordingHandle {
            child,
            remote_path: remote_path.clone(),
        },
    );

    Ok(CommandResponse {
        trace_id,
        data: remote_path,
    })
}

#[tauri::command]
pub fn stop_screen_record(
    serial: String,
    output_dir: Option<String>,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let mut guard = state
        .recording_processes
        .lock()
        .map_err(|_| AppError::system("Recording registry locked", &trace_id))?;

    let handle = match guard.remove(&serial) {
        Some(handle) => handle,
        None => return Err(AppError::validation("No recording in progress", &trace_id)),
    };
    let mut child = handle.child;

    let _ = Command::new("adb")
        .args(["-s", &serial, "shell", "pkill", "-SIGINT", "screenrecord"])
        .output();

    let timeout = Duration::from_secs(5);
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AppError::system("Timeout waiting for screenrecord", &trace_id));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(err) => {
                return Err(AppError::system(format!("Failed to stop screenrecord: {err}"), &trace_id));
            }
        }
    }

    let config = load_config().unwrap_or_default();
    let output_dir = output_dir
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| config.output_path.clone());
    if output_dir.trim().is_empty() {
        return Ok(CommandResponse {
            trace_id,
            data: String::new(),
        });
    }

    fs::create_dir_all(&output_dir)
        .map_err(|err| AppError::system(format!("Failed to create output dir: {err}"), &trace_id))?;

    let filename = PathBuf::from(&handle.remote_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("screenrecord_{}.mp4", serial));
    let local_path = PathBuf::from(&output_dir).join(filename);

    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "pull".to_string(),
        handle.remote_path.clone(),
        local_path.to_string_lossy().to_string(),
    ];
    let output = run_adb(&args, &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("Pull failed: {}", output.stderr),
            &trace_id,
        ));
    }

    Ok(CommandResponse {
        trace_id,
        data: local_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn list_device_files(
    serial: String,
    path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<DeviceFileEntry>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&path, "path", &trace_id)?;

    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "ls".to_string(),
        "-la".to_string(),
        path.clone(),
    ];
    let output = run_command_with_timeout("adb", &args, Duration::from_secs(300), &trace_id)?;
    let entries = parse_ls_la(&path, &output.stdout);

    Ok(CommandResponse {
        trace_id,
        data: entries,
    })
}

#[tauri::command]
pub fn pull_device_file(
    serial: String,
    device_path: String,
    output_dir: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&device_path, "device_path", &trace_id)?;
    ensure_non_empty(&output_dir, "output_dir", &trace_id)?;

    fs::create_dir_all(&output_dir)
        .map_err(|err| AppError::system(format!("Failed to create output dir: {err}"), &trace_id))?;

    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "pull".to_string(),
        device_path.clone(),
        output_dir.clone(),
    ];
    let output = run_adb(&args, &trace_id)?;
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

#[tauri::command]
pub fn preview_local_file(
    local_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<FilePreview>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&local_path, "local_path", &trace_id)?;

    let path = PathBuf::from(&local_path);
    if !path.exists() {
        return Err(AppError::validation("File does not exist", &trace_id));
    }

    let mime = MimeGuess::from_path(&path).first_or_octet_stream();
    let mime_type = mime.essence_str().to_string();

    const MAX_PREVIEW_BYTES: usize = 200_000;
    let mut file = fs::File::open(&path)
        .map_err(|err| AppError::system(format!("Failed to open file: {err}"), &trace_id))?;
    let mut buffer = Vec::new();
    file.by_ref()
        .take((MAX_PREVIEW_BYTES + 1) as u64)
        .read_to_end(&mut buffer)
        .map_err(|err| AppError::system(format!("Failed to read file: {err}"), &trace_id))?;

    let mut preview_text = None;
    let mut is_text = false;
    if let Ok(text) = std::str::from_utf8(&buffer) {
        if !contains_binary_control_chars(text) {
            is_text = true;
            let mut content = text.to_string();
            if buffer.len() > MAX_PREVIEW_BYTES {
                content.truncate(MAX_PREVIEW_BYTES);
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

#[tauri::command]
pub fn list_apps(
    serial: String,
    third_party_only: Option<bool>,
    include_versions: Option<bool>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<AppInfo>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

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

    let output = run_command_with_timeout("adb", &args, Duration::from_secs(30), &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("List apps failed: {}", output.stderr),
            &trace_id,
        ));
    }

    let include_versions = include_versions.unwrap_or(false);
    let mut apps = Vec::new();
    for entry in parse_pm_list_packages_output(&output.stdout) {
        let (version_name, version_code) = if include_versions {
            let dump_args = vec![
                "-s".to_string(),
                serial.clone(),
                "shell".to_string(),
                "dumpsys".to_string(),
                "package".to_string(),
                entry.package_name.clone(),
            ];
            match run_command_with_timeout("adb", &dump_args, Duration::from_secs(10), &trace_id) {
                Ok(out) => (
                    parse_dumpsys_version_name(&out.stdout),
                    parse_dumpsys_version_code(&out.stdout),
                ),
                Err(_) => (None, None),
            }
        } else {
            (None, None)
        };
        apps.push(package_entry_to_app_info(entry, version_name, version_code));
    }

    apps.sort_by(|a, b| a.package_name.cmp(&b.package_name));

    Ok(CommandResponse { trace_id, data: apps })
}

#[tauri::command]
pub fn uninstall_app(
    serial: String,
    package_name: String,
    keep_data: bool,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let mut args = vec!["-s".to_string(), serial.clone(), "uninstall".to_string()];
    if keep_data {
        args.push("-k".to_string());
    }
    args.push(package_name);
    let output = run_command_with_timeout("adb", &args, Duration::from_secs(30), &trace_id)?;
    let success = output.stdout.contains("Success") || output.exit_code.unwrap_or_default() == 0;

    Ok(CommandResponse {
        trace_id,
        data: success,
    })
}

#[tauri::command]
pub fn force_stop_app(
    serial: String,
    package_name: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "am".to_string(),
        "force-stop".to_string(),
        package_name,
    ];
    let output = run_command_with_timeout("adb", &args, Duration::from_secs(10), &trace_id)?;

    Ok(CommandResponse {
        trace_id,
        data: output.exit_code.unwrap_or_default() == 0,
    })
}

#[tauri::command]
pub fn clear_app_data(
    serial: String,
    package_name: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "pm".to_string(),
        "clear".to_string(),
        package_name,
    ];
    let output = run_command_with_timeout("adb", &args, Duration::from_secs(20), &trace_id)?;
    let success = output.stdout.to_lowercase().contains("success")
        || output.exit_code.unwrap_or_default() == 0;

    Ok(CommandResponse {
        trace_id,
        data: success,
    })
}

#[tauri::command]
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
    let output = run_command_with_timeout("adb", &args, Duration::from_secs(10), &trace_id)?;
    let normalized = format!("{} {}", output.stdout.to_lowercase(), output.stderr.to_lowercase());
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

#[tauri::command]
pub fn open_app_info(
    serial: String,
    package_name: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&package_name, "package_name", &trace_id)?;

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
    let output = run_command_with_timeout("adb", &primary_args, Duration::from_secs(10), &trace_id)?;
    let combined = format!("{}{}", output.stdout.to_lowercase(), output.stderr.to_lowercase());
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
        let _ = run_command_with_timeout("adb", &legacy_args, Duration::from_secs(10), &trace_id)?;
    }

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command]
pub fn check_scrcpy(
    trace_id: Option<String>,
) -> Result<CommandResponse<ScrcpyInfo>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let availability = check_scrcpy_availability();
    Ok(CommandResponse {
        trace_id,
        data: ScrcpyInfo {
            available: availability.available,
            version_output: availability.version_output,
            major_version: availability.major_version,
            command_path: availability.command_path,
        },
    })
}

#[tauri::command]
pub fn launch_scrcpy(
    serials: Vec<String>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let availability = check_scrcpy_availability();
    if !availability.available {
        return Err(AppError::dependency("scrcpy is not available", &trace_id));
    }
    let config = load_config().unwrap_or_default();

    let mut results = Vec::with_capacity(serials.len());
    for serial in serials {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let mut args = build_scrcpy_command(&serial, &config.scrcpy, availability.major_version);
        if !availability.command_path.trim().is_empty() {
            args[0] = availability.command_path.clone();
        }
        let mut iter = args.into_iter();
        let command_path = iter.next().unwrap_or_else(|| "scrcpy".to_string());
        let mut command = Command::new(command_path);
        command.args(iter);
        let spawn_result = command.spawn();
        match spawn_result {
            Ok(_) => results.push(CommandResult {
                serial,
                stdout: "scrcpy launched".to_string(),
                stderr: String::new(),
                exit_code: Some(0),
            }),
            Err(err) => results.push(CommandResult {
                serial,
                stdout: String::new(),
                stderr: format!("Failed to launch scrcpy: {err}"),
                exit_code: Some(1),
            }),
        }
    }

    Ok(CommandResponse { trace_id, data: results })
}

#[tauri::command]
pub fn capture_ui_hierarchy(
    serial: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let output = Command::new("adb")
        .args(["-s", &serial, "exec-out", "uiautomator", "dump", "/dev/tty"])
        .output()
        .map_err(|err| AppError::dependency(format!("Failed to run uiautomator: {err}"), &trace_id))?;

    if !output.status.success() {
        return Err(AppError::dependency(
            format!("UI dump failed: {}", String::from_utf8_lossy(&output.stderr)),
            &trace_id,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    let html = render_device_ui_html(&xml)
        .map_err(|err| AppError::system(format!("Failed to render HTML: {err}"), &trace_id))?;

    Ok(CommandResponse {
        trace_id,
        data: html,
    })
}

#[tauri::command]
pub fn start_logcat(
    serial: String,
    filter: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let mut guard = state
        .logcat_processes
        .lock()
        .map_err(|_| AppError::system("Logcat registry locked", &trace_id))?;
    if guard.contains_key(&serial) {
        return Err(AppError::validation("Logcat already running", &trace_id));
    }

    let mut cmd = Command::new("adb");
    cmd.args(["-s", &serial, "logcat"]);
    if let Some(filter) = filter.as_ref().filter(|value| !value.trim().is_empty()) {
        cmd.args(filter.split_whitespace());
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| AppError::dependency(format!("Failed to start logcat: {err}"), &trace_id))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::system("Failed to capture logcat stdout", &trace_id))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::system("Failed to capture logcat stderr", &trace_id))?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_stdout = Arc::clone(&stop_flag);
    let stop_flag_stderr = Arc::clone(&stop_flag);
    let app_stdout = app.clone();
    let serial_stdout = serial.clone();
    let trace_stdout = trace_id.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if stop_flag_stdout.load(Ordering::Relaxed) {
                break;
            }
            if let Err(err) = app_stdout.emit(
                "logcat-line",
                LogcatEvent {
                    serial: serial_stdout.clone(),
                    line,
                    trace_id: trace_stdout.clone(),
                },
            ) {
                warn!(trace_id = %trace_stdout, error = %err, "failed to emit logcat line");
            }
        }
    });

    let app_stderr = app.clone();
    let serial_stderr = serial.clone();
    let trace_stderr = trace_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if stop_flag_stderr.load(Ordering::Relaxed) {
                break;
            }
            if let Err(err) = app_stderr.emit(
                "logcat-line",
                LogcatEvent {
                    serial: serial_stderr.clone(),
                    line: format!("STDERR: {line}"),
                    trace_id: trace_stderr.clone(),
                },
            ) {
                warn!(trace_id = %trace_stderr, error = %err, "failed to emit logcat stderr");
            }
        }
    });

    guard.insert(
        serial,
        LogcatHandle {
            child,
            stop_flag,
        },
    );

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command]
pub fn stop_logcat(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let mut guard = state
        .logcat_processes
        .lock()
        .map_err(|_| AppError::system("Logcat registry locked", &trace_id))?;
    let mut handle = match guard.remove(&serial) {
        Some(handle) => handle,
        None => return Err(AppError::validation("Logcat not running", &trace_id)),
    };
    handle.stop_flag.store(true, Ordering::Relaxed);
    let _ = handle.child.kill();
    let _ = handle.child.wait();

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command]
pub fn clear_logcat(
    serial: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "logcat".to_string(),
        "-b".to_string(),
        "all".to_string(),
        "-c".to_string(),
    ];
    let output = run_adb(&args, &trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("Logcat clear failed: {}", output.stderr),
            &trace_id,
        ));
    }

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command]
pub fn start_bluetooth_monitor(
    serial: String,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let mut guard = state
        .bluetooth_monitors
        .lock()
        .map_err(|_| AppError::system("Bluetooth monitor registry locked", &trace_id))?;
    if guard.contains_key(&serial) {
        return Err(AppError::validation("Bluetooth monitor already running", &trace_id));
    }

    let handle = start_bluetooth_monitor_service(app, serial.clone(), trace_id.clone());
    guard.insert(serial, handle);

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command]
pub fn stop_bluetooth_monitor(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let mut guard = state
        .bluetooth_monitors
        .lock()
        .map_err(|_| AppError::system("Bluetooth monitor registry locked", &trace_id))?;
    let handle = match guard.remove(&serial) {
        Some(handle) => handle,
        None => return Err(AppError::validation("Bluetooth monitor not running", &trace_id)),
    };
    handle.stop();

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command]
pub fn generate_bugreport(
    serial: String,
    output_dir: String,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<BugreportResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&output_dir, "output_dir", &trace_id)?;

    fs::create_dir_all(&output_dir)
        .map_err(|err| AppError::system(format!("Failed to create output dir: {err}"), &trace_id))?;
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("bugreport_{}_{}.zip", serial, timestamp);
    let output_path = PathBuf::from(output_dir).join(filename);

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let child = Arc::new(std::sync::Mutex::new(None));
    {
        let mut guard = state
            .bugreport_processes
            .lock()
            .map_err(|_| AppError::system("Bugreport registry locked", &trace_id))?;
        if guard.contains_key(&serial) {
            return Err(AppError::validation("Bugreport already running", &trace_id));
        }
        guard.insert(
            serial.clone(),
            BugreportHandle {
                cancel_flag: Arc::clone(&cancel_flag),
                child: Arc::clone(&child),
            },
        );
    }

    let mut result = BugreportResult {
        serial: serial.clone(),
        success: false,
        output_path: None,
        error: None,
        stream_supported: false,
        progress: None,
    };

    let stream_result =
        run_bugreport_streaming(&serial, &app, &trace_id, &cancel_flag, &child);

    let mut allow_fallback = true;
    match stream_result {
        Ok(Some(remote_path)) => {
            result.stream_supported = true;
            let args = vec![
                "-s".to_string(),
                serial.clone(),
                "pull".to_string(),
                remote_path,
                output_path.to_string_lossy().to_string(),
            ];
            let pull = run_command_with_timeout("adb", &args, Duration::from_secs(300), &trace_id)?;
            if pull.exit_code.unwrap_or_default() != 0 {
                result.error = Some(format!("Failed to pull bugreport: {}", pull.stderr));
            } else {
                result.success = true;
                result.output_path = Some(output_path.to_string_lossy().to_string());
                result.error = None;
            }
        }
        Ok(None) => {
            result.stream_supported = true;
            result.error = None;
        }
        Err(err) => {
            if err.to_lowercase().contains("cancelled") {
                result.stream_supported = true;
                result.error = Some(err);
                allow_fallback = false;
            } else {
                result.stream_supported = false;
                result.error = None;
            }
        }
    }

    if allow_fallback && !result.success {
        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "bugreport".to_string(),
            output_path.to_string_lossy().to_string(),
        ];
        let output = run_adb(&args, &trace_id)?;
        if output.exit_code.unwrap_or_default() != 0 {
            result.error = Some(format!("Bugreport failed: {}", output.stderr));
        } else {
            result.success = true;
            result.output_path = Some(output_path.to_string_lossy().to_string());
            result.error = None;
        }
    }

    {
        let mut guard = state
            .bugreport_processes
            .lock()
            .map_err(|_| AppError::system("Bugreport registry locked", &trace_id))?;
        guard.remove(&serial);
    }

    let _ = app.emit(
        "bugreport-complete",
        serde_json::json!({
            "trace_id": trace_id,
            "result": result,
        }),
    );

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

#[tauri::command]
pub fn cancel_bugreport(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let guard = state
        .bugreport_processes
        .lock()
        .map_err(|_| AppError::system("Bugreport registry locked", &trace_id))?;
    let handle = match guard.get(&serial) {
        Some(handle) => handle,
        None => return Err(AppError::validation("Bugreport not running", &trace_id)),
    };
    handle.cancel_flag.store(true, Ordering::Relaxed);
    if let Ok(mut child_guard) = handle.child.lock() {
        if let Some(child) = child_guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

fn run_bugreport_streaming(
    serial: &str,
    app: &AppHandle,
    trace_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    child_holder: &Arc<std::sync::Mutex<Option<std::process::Child>>>,
) -> Result<Option<String>, String> {
    let child = Command::new("adb")
        .args(["-s", serial, "shell", "bugreportz", "-p"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start bugreportz: {err}"))?;

    {
        let mut guard = child_holder
            .lock()
            .map_err(|_| "Bugreport registry locked".to_string())?;
        *guard = Some(child);
    }

    let stdout = {
        let mut guard = child_holder
            .lock()
            .map_err(|_| "Bugreport registry locked".to_string())?;
        let child = guard.as_mut().ok_or_else(|| "Bugreport process missing".to_string())?;
        child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture bugreport stdout".to_string())?
    };

    let mut reader = BufReader::new(stdout);
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(300);
    let mut remote_path = None;
    let mut progress = None;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            kill_bugreport_process(child_holder);
            return Err("Cancelled by user".to_string());
        }
        if start.elapsed() > timeout {
            kill_bugreport_process(child_holder);
            return Err("Streaming bugreport timed out".to_string());
        }

        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                let finished = {
                    let mut guard = child_holder
                        .lock()
                        .map_err(|_| "Bugreport registry locked".to_string())?;
                    if let Some(child) = guard.as_mut() {
                        child.try_wait().ok().flatten().is_some()
                    } else {
                        true
                    }
                };
                if finished {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(_) => {
                let payload = parse_bugreportz_line(&line);
                match payload {
                    BugreportzPayload::Progress { percent } => {
                        if progress != Some(percent) {
                            progress = Some(percent);
                            let _ = app.emit(
                                "bugreport-progress",
                                serde_json::json!({
                                    "trace_id": trace_id,
                                    "serial": serial,
                                    "progress": percent,
                                }),
                            );
                        }
                    }
                    BugreportzPayload::Ok { path } => {
                        remote_path = Some(path);
                    }
                    BugreportzPayload::Fail { reason } => {
                        return Err(reason);
                    }
                    BugreportzPayload::Unknown { .. } => {}
                }
            }
            Err(err) => return Err(format!("Failed to read bugreport output: {err}")),
        }
    }

    if let Ok(mut guard) = child_holder.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.wait();
        }
    }

    if cancel_flag.load(Ordering::Relaxed) {
        return Err("Cancelled by user".to_string());
    }

    Ok(remote_path)
}

fn kill_bugreport_process(child_holder: &Arc<std::sync::Mutex<Option<std::process::Child>>>) {
    if let Ok(mut guard) = child_holder.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
