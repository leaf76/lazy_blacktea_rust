use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use tauri::{AppHandle, Emitter, State};
use tracing::{info, warn};
use uuid::Uuid;

use crate::app::adb::apk::{
    extract_split_apks, get_apk_info, is_split_bundle, normalize_apk_path,
    supports_push_and_pm_install,
};
use crate::app::adb::device_tracking::start_device_tracker;
use crate::app::adb::locator::{normalize_command_path, resolve_adb_program, validate_adb_program};
use crate::app::adb::parse::{
    build_device_detail, parse_adb_devices, parse_audio_summary, parse_battery_level,
    parse_bluetooth_manager_state, parse_df_total_kb,
    parse_dumpsys_version_name as parse_gms_version_name, parse_getprop_map, parse_settings_bool,
    parse_wm_size,
};
use crate::app::adb::paths::sanitize_filename_component;
use crate::app::adb::runner::{run_adb, run_command_with_timeout};
use crate::app::adb::scrcpy::{
    build_scrcpy_command, build_scrcpy_record_command, check_scrcpy_availability,
};
use crate::app::adb::screen_record::{
    build_adb_screen_record_args, build_local_recording_artifact_dir,
    build_local_recording_logcat_path, build_local_recording_path, build_recording_logcat_args,
    build_remote_recording_path, select_screen_record_backend, ScreenRecordBackend,
    MAX_ADB_SCREEN_RECORD_TIME_LIMIT_SEC,
};
use crate::app::adb::transfer::parse_progress_percent;
use crate::app::config::{
    clamp_terminal_buffer_lines, import_theme_background_from_path, load_config,
    normalize_config_for_save, save_config, AppConfig,
};
use crate::app::diagnostics;
use crate::app::error::AppError;
use crate::app::ios as ios_service;
use crate::app::models::{
    AdbInfo, ApkBatchInstallResult, ApkInfo, ApkInstallErrorCode, ApkInstallResult,
    CommandResponse, CommandResult, DeviceCapabilities, DeviceDetail, DeviceInfo,
    HostCommandResult, ScrcpyInfo, ScreenRecordStartResult, ScreenRecordStatus,
    ScreenRecordStopResult, TerminalEvent, TerminalSessionInfo, UiHierarchyCaptureResult,
    UiHierarchyExportResult,
};
use crate::app::perf::parse::parse_mem_totals;
use crate::app::state::{
    ApkInstallChildrenMap, ApkInstallHandle, AppState, RecordingHandle, RecordingLogcatCapture,
    RecordingSession, SegmentedRecordingShared,
};
use crate::app::terminal::{TerminalSession, TERMINAL_EVENT_NAME};
use crate::app::ui_capture::{normalize_ui_dump_xml, png_bytes_to_data_url, validate_png_bytes};
use crate::app::ui_xml::render_device_ui_html;

mod apps;
mod bluetooth;
mod bugreport;
mod files;
mod ios;
mod logcat;
mod monitors;

pub use apps::*;
pub use bluetooth::*;
pub use bugreport::*;
pub use files::*;
pub use ios::*;
pub use logcat::*;
pub use monitors::*;

use logcat::{get_logcat_status_inner, start_logcat_inner, stop_logcat_inner, LogcatEmitter};

#[cfg(test)]
use bugreport::{
    build_bugreport_filename, map_bugreport_extract_query_error,
    prepare_bugreport_extract_index_inner, prepare_bugreport_logcat_inner,
    query_bugreport_extract_inner, query_bugreport_logcat_around_inner, reserve_bugreport_handle,
    search_bugreport_logcat_inner, validate_generate_bugreport_inputs,
};
#[cfg(test)]
use logcat::{
    load_legacy_logcat_presets_from_home, parse_legacy_logcat_filters_json,
    parse_legacy_logcat_preset_json,
};
#[cfg(test)]
use monitors::{
    set_net_profiler_pinned_uids_inner, start_net_profiler_inner, start_perf_monitor_inner,
    stop_net_profiler_inner, stop_perf_monitor_inner,
};

#[cfg(test)]
mod tests;

#[allow(clippy::too_many_arguments)]
pub fn smoke_install_apk_batch(
    serials: Vec<String>,
    apk_path: String,
    replace: bool,
    allow_downgrade: bool,
    grant: bool,
    allow_test_packages: bool,
    extra_args: Option<String>,
    state: &AppState,
    trace_id: &str,
) -> Result<ApkBatchInstallResult, AppError> {
    install_apk_batch_inner(
        serials,
        apk_path,
        replace,
        allow_downgrade,
        grant,
        allow_test_packages,
        extra_args,
        state,
        trace_id,
        None,
    )
}

pub fn smoke_launch_app(
    serials: Vec<String>,
    package_name: String,
    state: &AppState,
    trace_id: &str,
) -> Result<Vec<CommandResult>, AppError> {
    ensure_non_empty(&package_name, "package_name", trace_id)?;
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", trace_id));
    }

    let adb_program = get_adb_program(trace_id)?;
    let scheduler = Arc::clone(&state.scheduler);

    let mut handles = Vec::new();
    for (index, serial) in serials.into_iter().enumerate() {
        ensure_non_empty(&serial, "serial", trace_id)?;
        let scheduler_clone = Arc::clone(&scheduler);
        let trace_clone = trace_id.to_string();
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
            .map_err(|_| AppError::system("Launch app thread panicked", trace_id))??;
        collected.push((index, result));
    }
    collected.sort_by_key(|item| item.0);
    Ok(collected.into_iter().map(|item| item.1).collect())
}

#[derive(Clone, serde::Serialize)]
pub struct FileTransferProgressEvent {
    pub serial: String,
    pub direction: String,
    pub progress: Option<u8>,
    pub message: Option<String>,
    pub trace_id: String,
}

const APK_INSTALL_EVENT_NAME: &str = "apk-install-event";
const APK_INSTALL_OUTPUT_MAX_LEN: usize = 4096;

#[derive(Clone, serde::Serialize)]
pub struct ApkInstallEvent {
    pub serial: String,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<String>,
    pub trace_id: String,
}

fn resolve_trace_id(input: Option<String>) -> String {
    input
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

fn ensure_non_empty(value: &str, field: &str, trace_id: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::validation(
            format!("{field} is required"),
            trace_id,
        ));
    }
    Ok(())
}

fn build_ui_export_bundle_base_name(serial: &str, timestamp: &str) -> String {
    let safe_serial = sanitize_filename_component(serial);
    let serial_component = if safe_serial.trim().is_empty() {
        "device".to_string()
    } else {
        safe_serial
    };
    format!("ui_export_{serial_component}_{timestamp}")
}

fn resolve_unique_ui_export_bundle_dir(parent: &Path, base_name: &str) -> PathBuf {
    let initial = parent.join(base_name);
    if !initial.exists() {
        return initial;
    }

    let mut suffix = 2usize;
    loop {
        let candidate = parent.join(format!("{base_name}_{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
        suffix += 1;
    }
}

fn append_limited(buffer: &mut String, chunk: &str, max_len: usize) {
    if max_len == 0 {
        return;
    }
    if buffer.len() >= max_len {
        return;
    }
    let remaining = max_len - buffer.len();
    if chunk.len() <= remaining {
        buffer.push_str(chunk);
    } else {
        buffer.push_str(&chunk[..remaining]);
    }
}

fn truncate_for_event(value: &str, max_len: usize) -> String {
    if max_len == 0 {
        return String::new();
    }
    value.chars().take(max_len).collect()
}

fn run_adb_transfer_with_progress(
    program: &str,
    args: &[String],
    timeout: Duration,
    serial: &str,
    direction: &str,
    trace_id: &str,
    app: AppHandle,
) -> Result<crate::app::adb::runner::CommandOutput, AppError> {
    use std::io::Read;
    use std::sync::Mutex;
    use std::time::Instant;

    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| AppError::system(format!("Failed to spawn command: {err}"), trace_id))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::system("Failed to capture stdout", trace_id))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::system("Failed to capture stderr", trace_id))?;

    let stdout_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer = Arc::new(Mutex::new(String::new()));

    let serial_string = serial.to_string();
    let direction_string = direction.to_string();
    let trace_string = trace_id.to_string();
    let app_stdout = app.clone();
    let stdout_buffer_thread = Arc::clone(&stdout_buffer);
    let stdout_handle = std::thread::spawn(move || {
        let mut reader = stdout;
        let mut temp = [0u8; 4096];
        let mut pending = String::new();
        let mut last_progress: Option<u8> = None;

        loop {
            let read_count = match reader.read(&mut temp) {
                Ok(0) => break,
                Ok(count) => count,
                Err(_) => break,
            };
            let chunk = String::from_utf8_lossy(&temp[..read_count]).to_string();
            {
                if let Ok(mut guard) = stdout_buffer_thread.lock() {
                    append_limited(&mut guard, &chunk, 200_000);
                }
            }

            pending.push_str(&chunk);
            let mut start = 0usize;
            for (index, ch) in pending.char_indices() {
                if ch == '\n' || ch == '\r' {
                    let line = pending[start..index].trim().to_string();
                    start = index + ch.len_utf8();
                    if line.is_empty() {
                        continue;
                    }
                    if let Some(percent) = parse_progress_percent(&line) {
                        if last_progress != Some(percent) {
                            last_progress = Some(percent);
                            let message = Some(format!("{percent}%"));
                            if let Err(err) = app_stdout.emit(
                                "file-transfer-progress",
                                FileTransferProgressEvent {
                                    serial: serial_string.clone(),
                                    direction: direction_string.clone(),
                                    progress: Some(percent),
                                    message,
                                    trace_id: trace_string.clone(),
                                },
                            ) {
                                warn!(trace_id = %trace_string, error = %err, "failed to emit file transfer progress");
                            }
                        }
                    }
                }
            }
            if start > 0 {
                pending = pending[start..].to_string();
            }
        }
    });

    let stderr_buffer_thread = Arc::clone(&stderr_buffer);
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line_result in reader.lines() {
            let line = match line_result {
                Ok(line) => line,
                Err(_) => break,
            };
            if let Ok(mut guard) = stderr_buffer_thread.lock() {
                append_limited(&mut guard, &line, 200_000);
                append_limited(&mut guard, "\n", 200_000);
            }
        }
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_handle.join();
                    let _ = stderr_handle.join();
                    return Err(AppError::system("Command timed out".to_string(), trace_id));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                return Err(AppError::system(
                    format!("Failed to poll command: {err}"),
                    trace_id,
                ));
            }
        }
    };

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    let stdout_value = stdout_buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let stderr_value = stderr_buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();

    Ok(crate::app::adb::runner::CommandOutput {
        stdout: stdout_value,
        stderr: stderr_value,
        exit_code: status.code(),
    })
}

fn get_adb_program(trace_id: &str) -> Result<String, AppError> {
    let config = load_config(trace_id)?;
    let program = resolve_adb_program(&config.adb.command_path);
    if let Err(error) = validate_adb_program(&program) {
        return Err(AppError::validation(error.message, trace_id));
    }
    Ok(program)
}

fn extend_screenshot_capture_args(args: &mut Vec<String>, config: &AppConfig) {
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
}

fn build_exec_out_screenshot_args(serial: &str, config: &AppConfig) -> Vec<String> {
    let mut args = vec![
        "-s".to_string(),
        serial.to_string(),
        "exec-out".to_string(),
        "screencap".to_string(),
        "-p".to_string(),
    ];
    extend_screenshot_capture_args(&mut args, config);
    args
}

fn build_pull_screenshot_args(serial: &str, config: &AppConfig, remote_path: &str) -> Vec<String> {
    let mut args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "screencap".to_string(),
        "-p".to_string(),
    ];
    extend_screenshot_capture_args(&mut args, config);
    args.push(remote_path.to_string());
    args
}

fn stderr_message_bytes(stderr: &[u8]) -> String {
    let trimmed = String::from_utf8_lossy(stderr).trim().to_string();
    if trimmed.is_empty() {
        "unknown error".to_string()
    } else {
        trimmed
    }
}

fn stderr_message_text(stderr: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        "unknown error".to_string()
    } else {
        trimmed.to_string()
    }
}

fn user_safe_retry_message(action: &str) -> String {
    format!("Failed to {action}. Please try again.")
}

const UI_DUMP_AUTO_RECOVERY_DELAY_MS: u64 = 750;

#[derive(Clone)]
struct UiDumpCaptureFailure {
    primary: AppError,
    fallback: AppError,
}

#[derive(Default)]
struct UiDumpAutoRecoveryAttempt {
    attempted_methods: Vec<&'static str>,
    successful_method: Option<&'static str>,
}

impl UiDumpAutoRecoveryAttempt {
    fn attempted(&self) -> bool {
        !self.attempted_methods.is_empty()
    }

    fn method_summary(&self) -> String {
        if self.attempted_methods.is_empty() {
            "pkill/killall".to_string()
        } else {
            self.attempted_methods.join("/")
        }
    }
}

fn sanitize_ui_dump_error_excerpt(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = compact.trim();
    let shortened = if trimmed.len() > 120 {
        format!("{}…", &trimmed[..119])
    } else {
        trimmed.to_string()
    };
    if shortened.is_empty() || shortened == "unknown error" {
        "unknown error".to_string()
    } else {
        shortened
    }
}

fn summarize_primary_ui_dump_error(error: &str) -> String {
    if error.contains("Command timed out") {
        return "exec-out UI dump timed out".to_string();
    }
    if let Some((_, detail)) = error.split_once("Exec-out UI dump failed:") {
        let detail = sanitize_ui_dump_error_excerpt(detail);
        return if detail == "unknown error" {
            "exec-out UI dump failed".to_string()
        } else {
            format!("exec-out UI dump failed: {detail}")
        };
    }
    if error.contains("Exec-out UI dump returned invalid XML") {
        return "exec-out UI dump returned invalid XML".to_string();
    }
    if let Some((_, detail)) = error.split_once("Failed to run uiautomator:") {
        let detail = sanitize_ui_dump_error_excerpt(detail);
        return if detail == "unknown error" {
            "failed to start exec-out UI dump".to_string()
        } else {
            format!("failed to start exec-out UI dump: {detail}")
        };
    }
    "exec-out UI dump failed".to_string()
}

fn summarize_fallback_ui_dump_error(error: &str) -> String {
    if error.contains("Command timed out") {
        return "download fallback UI dump timed out".to_string();
    }
    if let Some((_, detail)) = error.split_once("Pulled UI dump capture failed:") {
        let detail = sanitize_ui_dump_error_excerpt(detail);
        let normalized = detail.to_lowercase();
        if normalized.contains("permission denied") || normalized.contains("dump path blocked") {
            return "download fallback could not write the temporary UI dump".to_string();
        }
        return if detail == "unknown error" {
            "download fallback could not create the temporary UI dump".to_string()
        } else {
            format!("download fallback capture failed: {detail}")
        };
    }
    if let Some((_, detail)) = error.split_once("Pulled UI dump fetch failed:") {
        let detail = sanitize_ui_dump_error_excerpt(detail);
        let normalized = detail.to_lowercase();
        if normalized.contains("no such file or directory") {
            return "download fallback did not produce a readable UI dump file".to_string();
        }
        return if detail == "unknown error" {
            "download fallback could not pull the temporary UI dump".to_string()
        } else {
            format!("download fallback pull failed: {detail}")
        };
    }
    if error.contains("UI dump validation failed:") {
        return "download fallback produced invalid UI XML".to_string();
    }
    "download fallback failed".to_string()
}

fn is_retryable_ui_dump_primary_error(error: &AppError) -> bool {
    if error.error.contains("Command timed out") {
        return true;
    }

    if error.code != "ERR_DEPENDENCY" {
        return false;
    }

    error.error.starts_with("Exec-out UI dump failed:")
        || error
            .error
            .starts_with("Exec-out UI dump returned invalid XML:")
        || error.error.starts_with("Failed to run uiautomator:")
}

fn is_retryable_ui_dump_fallback_error(error: &AppError) -> bool {
    if error.error.contains("Command timed out") {
        return true;
    }

    if error.code != "ERR_DEPENDENCY" {
        return false;
    }

    if error.error.starts_with("Pulled UI dump capture failed:") {
        let detail = error
            .error
            .split_once("Pulled UI dump capture failed:")
            .map(|(_, detail)| sanitize_ui_dump_error_excerpt(detail))
            .unwrap_or_else(|| "unknown error".to_string());
        let normalized = detail.to_lowercase();
        return !normalized.contains("permission denied")
            && !normalized.contains("dump path blocked");
    }

    if error.error.starts_with("Pulled UI dump fetch failed:") {
        let detail = error
            .error
            .split_once("Pulled UI dump fetch failed:")
            .map(|(_, detail)| sanitize_ui_dump_error_excerpt(detail))
            .unwrap_or_else(|| "unknown error".to_string());
        return !detail.to_lowercase().contains("no such file or directory");
    }

    error.error.starts_with("UI dump validation failed:")
}

fn should_attempt_ui_dump_auto_recovery(failure: &UiDumpCaptureFailure) -> bool {
    is_retryable_ui_dump_primary_error(&failure.primary)
        && is_retryable_ui_dump_fallback_error(&failure.fallback)
}

fn build_ui_dump_failure_message(
    primary_error: &AppError,
    fallback_error: &AppError,
    recovery: Option<&UiDumpAutoRecoveryAttempt>,
    retry_failure: Option<&UiDumpCaptureFailure>,
) -> String {
    let mut message = format!(
        "Failed to capture UI hierarchy. {}. {}.",
        summarize_primary_ui_dump_error(&primary_error.error),
        summarize_fallback_ui_dump_error(&fallback_error.error),
    );

    if let Some(recovery) = recovery {
        if recovery.attempted() {
            message.push_str(&format!(
                " auto-recovery attempted via {}.",
                recovery.method_summary()
            ));
        }
    }

    if let Some(retry_failure) = retry_failure {
        message.push_str(&format!(
            " retry after auto-recovery failed: {}. {}.",
            summarize_primary_ui_dump_error(&retry_failure.primary.error),
            summarize_fallback_ui_dump_error(&retry_failure.fallback.error),
        ));
    }

    message.push_str(" Check Task Center for details.");
    message
}

fn build_ui_dump_recovery_command_args(
    serial: &str,
    program: &'static str,
    extra_arg: &'static str,
) -> Vec<String> {
    vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        program.to_string(),
        extra_arg.to_string(),
        "uiautomator".to_string(),
    ]
}

fn attempt_ui_dump_auto_recovery(
    adb_program: &str,
    serial: &str,
    trace_id: &str,
) -> UiDumpAutoRecoveryAttempt {
    let mut attempt = UiDumpAutoRecoveryAttempt::default();

    for (method, args) in [
        (
            "pkill",
            build_ui_dump_recovery_command_args(serial, "pkill", "-f"),
        ),
        (
            "killall",
            build_ui_dump_recovery_command_args(serial, "killall", ""),
        ),
    ] {
        let args = if method == "killall" {
            vec![
                "-s".to_string(),
                serial.to_string(),
                "shell".to_string(),
                "killall".to_string(),
                "uiautomator".to_string(),
            ]
        } else {
            args
        };
        attempt.attempted_methods.push(method);
        match run_command_with_timeout(adb_program, &args, Duration::from_secs(5), trace_id) {
            Ok(output) if output.exit_code.unwrap_or(1) == 0 => {
                attempt.successful_method = Some(method);
                break;
            }
            Ok(output) => {
                warn!(
                    trace_id = %trace_id,
                    serial = %serial,
                    recovery_method = method,
                    exit_code = ?output.exit_code,
                    stderr = %sanitize_ui_dump_error_excerpt(&output.stderr),
                    "ui dump auto-recovery command did not succeed"
                );
            }
            Err(err) => {
                warn!(
                    trace_id = %trace_id,
                    serial = %serial,
                    recovery_method = method,
                    error = %err.error,
                    "ui dump auto-recovery command failed"
                );
            }
        }
    }

    if attempt.attempted() {
        std::thread::sleep(Duration::from_millis(UI_DUMP_AUTO_RECOVERY_DELAY_MS));
    }

    attempt
}

fn capture_ui_dump_once(
    adb_program: &str,
    serial: &str,
    remote_path: &str,
    local_pull_path: &Path,
    trace_id: &str,
) -> Result<String, Box<UiDumpCaptureFailure>> {
    match capture_ui_dump_via_exec_out(adb_program, serial, trace_id) {
        Ok(xml) => Ok(xml),
        Err(primary_err) => {
            warn!(
                trace_id = %trace_id,
                error = %primary_err.error,
                "exec-out ui dump failed; falling back to pull"
            );
            match capture_ui_dump_via_pull(
                adb_program,
                serial,
                remote_path,
                local_pull_path,
                trace_id,
            ) {
                Ok(xml) => Ok(xml),
                Err(fallback_err) => Err(Box::new(UiDumpCaptureFailure {
                    primary: primary_err,
                    fallback: fallback_err,
                })),
            }
        }
    }
}

fn build_remote_screenshot_path(serial: &str, label: &str) -> String {
    let safe_label = sanitize_filename_component(label);
    let safe_serial = sanitize_filename_component(serial);
    format!(
        "/sdcard/{}_{}_{}.png",
        safe_label,
        safe_serial,
        Uuid::new_v4()
    )
}

fn write_png_file(path: &Path, bytes: &[u8], trace_id: &str) -> Result<(), AppError> {
    fs::write(path, bytes)
        .map_err(|err| AppError::system(format!("Failed to write screenshot: {err}"), trace_id))
}

fn read_validated_png_file(path: &Path, trace_id: &str) -> Result<Vec<u8>, AppError> {
    let bytes = fs::read(path)
        .map_err(|err| AppError::system(format!("Failed to read screenshot: {err}"), trace_id))?;
    validate_png_bytes(&bytes).map_err(|message| {
        AppError::dependency(format!("Screenshot validation failed: {message}"), trace_id)
    })?;
    Ok(bytes)
}

fn capture_screenshot_via_exec_out(
    adb_program: &str,
    serial: &str,
    config: &AppConfig,
    trace_id: &str,
) -> Result<Vec<u8>, AppError> {
    let args = build_exec_out_screenshot_args(serial, config);
    let output = Command::new(adb_program)
        .args(&args)
        .output()
        .map_err(|err| AppError::dependency(format!("Failed to run adb: {err}"), trace_id))?;

    if !output.status.success() {
        return Err(AppError::dependency(
            format!(
                "Exec-out screenshot failed: {}",
                stderr_message_bytes(&output.stderr)
            ),
            trace_id,
        ));
    }

    validate_png_bytes(&output.stdout).map_err(|message| {
        AppError::dependency(
            format!("Exec-out screenshot returned invalid PNG: {message}"),
            trace_id,
        )
    })?;
    Ok(output.stdout)
}

fn capture_screenshot_via_pull(
    adb_program: &str,
    serial: &str,
    config: &AppConfig,
    remote_path: &str,
    local_path: &Path,
    trace_id: &str,
) -> Result<Vec<u8>, AppError> {
    let result = (|| -> Result<Vec<u8>, AppError> {
        let capture_args = build_pull_screenshot_args(serial, config, remote_path);
        let capture_output = run_command_with_timeout(
            adb_program,
            &capture_args,
            Duration::from_secs(10),
            trace_id,
        )?;
        if capture_output.exit_code.unwrap_or(1) != 0 {
            return Err(AppError::dependency(
                format!(
                    "Pulled screenshot capture failed: {}",
                    stderr_message_text(&capture_output.stderr)
                ),
                trace_id,
            ));
        }

        let pull_args = vec![
            "-s".to_string(),
            serial.to_string(),
            "pull".to_string(),
            remote_path.to_string(),
            local_path.to_string_lossy().to_string(),
        ];
        let pull_output =
            run_command_with_timeout(adb_program, &pull_args, Duration::from_secs(20), trace_id)?;
        if pull_output.exit_code.unwrap_or(1) != 0 {
            return Err(AppError::dependency(
                format!(
                    "Pulled screenshot fetch failed: {}",
                    stderr_message_text(&pull_output.stderr)
                ),
                trace_id,
            ));
        }

        read_validated_png_file(local_path, trace_id)
    })();

    let cleanup_args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "rm".to_string(),
        "-f".to_string(),
        remote_path.to_string(),
    ];
    if let Err(err) = run_command_with_timeout(
        adb_program,
        &cleanup_args,
        Duration::from_secs(10),
        trace_id,
    ) {
        warn!(
            trace_id = %trace_id,
            error = %err.error,
            "failed to remove temporary screenshot"
        );
    }

    result
}

fn capture_validated_screenshot_bytes(
    adb_program: &str,
    serial: &str,
    config: &AppConfig,
    local_pull_path: &Path,
    label: &str,
    trace_id: &str,
) -> Result<Vec<u8>, AppError> {
    let remote_path = build_remote_screenshot_path(serial, label);
    match capture_screenshot_via_exec_out(adb_program, serial, config, trace_id) {
        Ok(bytes) => Ok(bytes),
        Err(primary_err) => {
            warn!(
                trace_id = %trace_id,
                error = %primary_err.error,
                "exec-out screenshot failed; falling back to pull"
            );
            match capture_screenshot_via_pull(
                adb_program,
                serial,
                config,
                &remote_path,
                local_pull_path,
                trace_id,
            ) {
                Ok(bytes) => Ok(bytes),
                Err(fallback_err) => {
                    warn!(
                        trace_id = %trace_id,
                        primary_error = %primary_err.error,
                        fallback_error = %fallback_err.error,
                        "screenshot capture failed"
                    );
                    Err(AppError::dependency(
                        user_safe_retry_message("capture screenshot"),
                        trace_id,
                    ))
                }
            }
        }
    }
}

fn build_exec_out_ui_dump_args(serial: &str) -> Vec<String> {
    vec![
        "-s".to_string(),
        serial.to_string(),
        "exec-out".to_string(),
        "uiautomator".to_string(),
        "dump".to_string(),
        "/dev/tty".to_string(),
    ]
}

fn build_pull_ui_dump_args(serial: &str, remote_path: &str) -> Vec<String> {
    vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "uiautomator".to_string(),
        "dump".to_string(),
        remote_path.to_string(),
    ]
}

fn build_remote_ui_dump_path(serial: &str, label: &str) -> String {
    let safe_label = sanitize_filename_component(label);
    let safe_serial = sanitize_filename_component(serial);
    format!(
        "/sdcard/Download/lazy_blacktea_{}_{}_{}.xml",
        safe_label,
        safe_serial,
        Uuid::new_v4()
    )
}

fn read_validated_ui_dump_file(path: &Path, trace_id: &str) -> Result<String, AppError> {
    let bytes = fs::read(path)
        .map_err(|err| AppError::system(format!("Failed to read UI dump: {err}"), trace_id))?;
    normalize_ui_dump_xml(&bytes).map_err(|message| {
        AppError::dependency(format!("UI dump validation failed: {message}"), trace_id)
    })
}

fn capture_ui_dump_via_exec_out(
    adb_program: &str,
    serial: &str,
    trace_id: &str,
) -> Result<String, AppError> {
    let args = build_exec_out_ui_dump_args(serial);
    let output = Command::new(adb_program)
        .args(&args)
        .output()
        .map_err(|err| {
            AppError::dependency(format!("Failed to run uiautomator: {err}"), trace_id)
        })?;

    if !output.status.success() {
        return Err(AppError::dependency(
            format!(
                "Exec-out UI dump failed: {}",
                stderr_message_bytes(&output.stderr)
            ),
            trace_id,
        ));
    }

    normalize_ui_dump_xml(&output.stdout).map_err(|message| {
        AppError::dependency(
            format!("Exec-out UI dump returned invalid XML: {message}"),
            trace_id,
        )
    })
}

fn capture_ui_dump_via_pull(
    adb_program: &str,
    serial: &str,
    remote_path: &str,
    local_path: &Path,
    trace_id: &str,
) -> Result<String, AppError> {
    let result = (|| -> Result<String, AppError> {
        let capture_args = build_pull_ui_dump_args(serial, remote_path);
        let capture_output = run_command_with_timeout(
            adb_program,
            &capture_args,
            Duration::from_secs(10),
            trace_id,
        )?;
        if capture_output.exit_code.unwrap_or(1) != 0 {
            return Err(AppError::dependency(
                format!(
                    "Pulled UI dump capture failed: {}",
                    stderr_message_text(&capture_output.stderr)
                ),
                trace_id,
            ));
        }

        let pull_args = vec![
            "-s".to_string(),
            serial.to_string(),
            "pull".to_string(),
            remote_path.to_string(),
            local_path.to_string_lossy().to_string(),
        ];
        let pull_output =
            run_command_with_timeout(adb_program, &pull_args, Duration::from_secs(20), trace_id)?;
        if pull_output.exit_code.unwrap_or(1) != 0 {
            return Err(AppError::dependency(
                format!(
                    "Pulled UI dump fetch failed: {}",
                    stderr_message_text(&pull_output.stderr)
                ),
                trace_id,
            ));
        }

        read_validated_ui_dump_file(local_path, trace_id)
    })();

    let cleanup_args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "rm".to_string(),
        "-f".to_string(),
        remote_path.to_string(),
    ];
    if let Err(err) = run_command_with_timeout(
        adb_program,
        &cleanup_args,
        Duration::from_secs(10),
        trace_id,
    ) {
        warn!(
            trace_id = %trace_id,
            error = %err.error,
            "failed to remove temporary ui dump"
        );
    }

    result
}

fn capture_validated_ui_dump_xml(
    adb_program: &str,
    serial: &str,
    local_pull_path: &Path,
    label: &str,
    trace_id: &str,
) -> Result<String, AppError> {
    let remote_path = build_remote_ui_dump_path(serial, label);
    let initial_failure =
        match capture_ui_dump_once(adb_program, serial, &remote_path, local_pull_path, trace_id) {
            Ok(xml) => return Ok(xml),
            Err(failure) => *failure,
        };

    if !should_attempt_ui_dump_auto_recovery(&initial_failure) {
        warn!(
            trace_id = %trace_id,
            primary_error = %initial_failure.primary.error,
            fallback_error = %initial_failure.fallback.error,
            "ui dump capture failed without retryable recovery signature"
        );
        return Err(AppError::dependency(
            build_ui_dump_failure_message(
                &initial_failure.primary,
                &initial_failure.fallback,
                None,
                None,
            ),
            trace_id,
        ));
    }

    let recovery = attempt_ui_dump_auto_recovery(adb_program, serial, trace_id);
    let retry_failure =
        match capture_ui_dump_once(adb_program, serial, &remote_path, local_pull_path, trace_id) {
            Ok(xml) => {
                info!(
                    trace_id = %trace_id,
                    serial = %serial,
                    recovery_attempted = true,
                    recovery_method = %recovery.method_summary(),
                    recovery_result = %recovery.successful_method.unwrap_or("retry_only"),
                    "ui dump auto-recovery succeeded"
                );
                return Ok(xml);
            }
            Err(failure) => *failure,
        };

    warn!(
        trace_id = %trace_id,
        serial = %serial,
        primary_error = %initial_failure.primary.error,
        fallback_error = %initial_failure.fallback.error,
        recovery_attempted = true,
        recovery_method = %recovery.method_summary(),
        recovery_result = %recovery.successful_method.unwrap_or("failed"),
        retry_primary_error = %retry_failure.primary.error,
        retry_fallback_error = %retry_failure.fallback.error,
        "ui dump capture failed after auto-recovery"
    );

    Err(AppError::dependency(
        build_ui_dump_failure_message(
            &initial_failure.primary,
            &initial_failure.fallback,
            Some(&recovery),
            Some(&retry_failure),
        ),
        trace_id,
    ))
}

#[tauri::command(async)]
pub fn get_config(trace_id: Option<String>) -> Result<CommandResponse<AppConfig>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let config = load_config(&trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: config,
    })
}

#[tauri::command(async)]
pub fn save_app_config(
    config: AppConfig,
    trace_id: Option<String>,
) -> Result<CommandResponse<AppConfig>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let config = normalize_config_for_save(config);
    save_config(&config, &trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: config,
    })
}

#[tauri::command(async)]
pub fn reset_config(trace_id: Option<String>) -> Result<CommandResponse<AppConfig>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let config = normalize_config_for_save(AppConfig::default());
    save_config(&config, &trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: config,
    })
}

#[tauri::command(async)]
pub fn import_theme_background(
    source_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let imported = import_theme_background_from_path(Path::new(&source_path), &trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: imported,
    })
}

#[tauri::command(async)]
pub fn check_adb(
    command_path: Option<String>,
    trace_id: Option<String>,
) -> Result<CommandResponse<AdbInfo>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    info!(trace_id = %trace_id, "check_adb");

    let config = load_config(&trace_id)?;
    let program = command_path
        .as_deref()
        .map(normalize_command_path)
        .filter(|value| !value.is_empty())
        .map(|value| resolve_adb_program(&value))
        .unwrap_or_else(|| resolve_adb_program(&config.adb.command_path));

    if let Err(error) = validate_adb_program(&program) {
        warn!(trace_id = %trace_id, error = %error.message, "adb validation failed");
        return Ok(CommandResponse {
            trace_id,
            data: AdbInfo {
                available: false,
                version_output: String::new(),
                command_path: program,
                error: Some(error.message),
                issue_code: error.issue_code,
            },
        });
    }

    let args = vec!["version".to_string()];
    let output = match run_command_with_timeout(&program, &args, Duration::from_secs(5), &trace_id)
    {
        Ok(output) => output,
        Err(err) => {
            warn!(trace_id = %trace_id, error = %err.error, "adb check failed");
            return Ok(CommandResponse {
                trace_id,
                data: AdbInfo {
                    available: false,
                    version_output: String::new(),
                    command_path: program,
                    error: Some(err.error),
                    issue_code: None,
                },
            });
        }
    };

    let mut version_output = output.stdout.trim().to_string();
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        if !version_output.is_empty() {
            version_output.push('\n');
        }
        version_output.push_str(stderr);
    }

    let available = output.exit_code.unwrap_or_default() == 0;
    Ok(CommandResponse {
        trace_id,
        data: AdbInfo {
            available,
            version_output,
            command_path: program,
            error: if available {
                None
            } else if output.stderr.trim().is_empty() {
                Some("ADB command returned a non-zero exit code".to_string())
            } else {
                Some(output.stderr.trim().to_string())
            },
            issue_code: None,
        },
    })
}

#[tauri::command(async)]
pub fn export_diagnostics_bundle(
    output_dir: Option<String>,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    info!(trace_id = %trace_id, "export_diagnostics_bundle");

    // Best-effort: diagnostics bundle should still be generated even if config is broken.
    let adb_program = match load_config(&trace_id) {
        Ok(config) => resolve_adb_program(&config.adb.command_path),
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                error = %err,
                "Failed to load config for diagnostics adb program, falling back to default"
            );
            "adb".to_string()
        }
    };

    let bundle_path = diagnostics::export_diagnostics_bundle(&adb_program, output_dir, &trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: bundle_path.to_string_lossy().to_string(),
    })
}

const DETAIL_SECTION_GETPROP: &str = "getprop";
const DETAIL_SECTION_BATTERY: &str = "battery";
const DETAIL_SECTION_WIFI: &str = "wifi";
const DETAIL_SECTION_BLUETOOTH: &str = "bluetooth";
const DETAIL_SECTION_BT_STATE: &str = "bt_state";
const DETAIL_SECTION_AUDIO: &str = "audio";
const DETAIL_SECTION_GMS: &str = "gms";
const DETAIL_SECTION_WM: &str = "wm";
const DETAIL_SECTION_DF: &str = "df";
const DETAIL_SECTION_MEM: &str = "mem";
const DETAIL_GETPROP_FAIL_EXIT_CODE: i32 = 42;

fn detail_section_marker(key: &str) -> String {
    format!("__LBT_DETAIL__{key}__")
}

/// Builds a single device-side shell script running `getprop` followed by every other
/// device-detail probe, emitting a unique marker line before each so combined stdout can be
/// split into sections. If `getprop` fails, the shell exits immediately with
/// `DETAIL_GETPROP_FAIL_EXIT_CODE` so slow `dumpsys` probes are skipped; subsequent probes use
/// `;` so an unsupported command degrades gracefully without aborting the rest.
fn build_device_detail_script() -> String {
    let probes: [(&str, &str); 9] = [
        (DETAIL_SECTION_BATTERY, "dumpsys battery"),
        (DETAIL_SECTION_WIFI, "settings get global wifi_on"),
        (DETAIL_SECTION_BLUETOOTH, "settings get global bluetooth_on"),
        (DETAIL_SECTION_BT_STATE, "cmd bluetooth_manager get-state"),
        (DETAIL_SECTION_AUDIO, "dumpsys audio"),
        (DETAIL_SECTION_GMS, "dumpsys package com.google.android.gms"),
        (DETAIL_SECTION_WM, "wm size"),
        (DETAIL_SECTION_DF, "df -k /data"),
        (DETAIL_SECTION_MEM, "cat /proc/meminfo"),
    ];
    let mut parts = Vec::with_capacity(probes.len() + 1);
    parts.push(format!(
        "echo {}; getprop || exit {}",
        detail_section_marker(DETAIL_SECTION_GETPROP),
        DETAIL_GETPROP_FAIL_EXIT_CODE
    ));
    for (key, command) in probes {
        parts.push(format!("echo {}; {}", detail_section_marker(key), command));
    }
    parts.join("; ")
}

/// Splits combined device-detail stdout into per-probe sections keyed by marker name. A probe that
/// produced no output (or whose command was unsupported) simply yields an empty/absent section.
fn split_device_detail_sections(stdout: &str) -> HashMap<String, String> {
    let mut sections: HashMap<String, String> = HashMap::new();
    let mut current_key: Option<String> = None;
    let mut current_lines: Vec<&str> = Vec::new();
    for line in stdout.lines() {
        if let Some(key) = line
            .trim()
            .strip_prefix("__LBT_DETAIL__")
            .and_then(|rest| rest.strip_suffix("__"))
        {
            if let Some(prev_key) = current_key.take() {
                sections.insert(prev_key, current_lines.join("\n"));
            }
            current_key = Some(key.to_string());
            current_lines = Vec::new();
        } else if current_key.is_some() {
            current_lines.push(line);
        }
    }
    if let Some(prev_key) = current_key.take() {
        sections.insert(prev_key, current_lines.join("\n"));
    }
    sections
}

fn load_device_detail(
    serial: &str,
    trace_id: &str,
    profile_devices: bool,
    profile_slow_ms: u64,
    mut run: impl FnMut(
        &[String],
        Duration,
        &'static str,
    ) -> Result<crate::app::adb::runner::CommandOutput, AppError>,
) -> Option<DeviceDetail> {
    let detail_started = Instant::now();
    let serial_arg = serial.to_string();

    let should_log = |elapsed_ms: u64| -> bool {
        if !profile_devices {
            return false;
        }
        profile_slow_ms == 0 || elapsed_ms >= profile_slow_ms
    };

    let mut run_timed = |step: &'static str,
                         args: Vec<String>,
                         timeout: Duration|
     -> (
        u64,
        Result<crate::app::adb::runner::CommandOutput, AppError>,
    ) {
        let started = Instant::now();
        let result = run(&args, timeout, step);
        let elapsed_ms = started.elapsed().as_millis() as u64;

        if should_log(elapsed_ms) {
            match &result {
                Ok(output) => {
                    info!(
                        trace_id = %trace_id,
                        serial = %serial,
                        step,
                        elapsed_ms,
                        exit_code = ?output.exit_code,
                        "adb device command timing"
                    );
                }
                Err(err) => {
                    warn!(
                        trace_id = %trace_id,
                        serial = %serial,
                        step,
                        elapsed_ms,
                        error = %err,
                        "adb device command failed (timing)"
                    );
                }
            }
        }

        (elapsed_ms, result)
    };

    // Run getprop plus all remaining detail probes in ONE `adb shell` invocation with delimited
    // sections. If `getprop` fails, the script exits early with `DETAIL_GETPROP_FAIL_EXIT_CODE`
    // before running the heavier `dumpsys` probes; otherwise each subsequent probe degrades
    // gracefully when missing or empty.
    let detail_script = build_device_detail_script();
    let batch_args = vec![
        "-s".to_string(),
        serial_arg,
        "shell".to_string(),
        detail_script,
    ];
    let (batch_elapsed_ms, batch_output) =
        run_timed("device_detail_batch", batch_args, Duration::from_secs(15));

    let log_total = || {
        let detail_elapsed_ms = detail_started.elapsed().as_millis() as u64;
        if should_log(detail_elapsed_ms) {
            info!(
                trace_id = %trace_id,
                serial = %serial,
                step = "device_detail_total",
                elapsed_ms = detail_elapsed_ms,
                "device detail timing"
            );
        }
    };

    let out = match batch_output {
        Ok(out) => out,
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                serial = %serial,
                step = "device_detail_batch",
                elapsed_ms = batch_elapsed_ms,
                error = %err,
                "failed to load device detail"
            );
            log_total();
            return None;
        }
    };

    let sections = split_device_detail_sections(&out.stdout);
    let getprop_failed = out.exit_code == Some(DETAIL_GETPROP_FAIL_EXIT_CODE)
        && !sections.contains_key(DETAIL_SECTION_BATTERY);
    let Some(getprop_text) = sections.get(DETAIL_SECTION_GETPROP) else {
        warn!(
            trace_id = %trace_id,
            serial = %serial,
            step = "device_detail_batch",
            elapsed_ms = batch_elapsed_ms,
            exit_code = ?out.exit_code,
            "missing getprop section in device detail batch output"
        );
        log_total();
        return None;
    };
    if getprop_failed {
        warn!(
            trace_id = %trace_id,
            serial = %serial,
            step = "getprop",
            elapsed_ms = batch_elapsed_ms,
            stderr = %out.stderr.trim(),
            "getprop exited early during device detail batch"
        );
        log_total();
        return None;
    }

    let mut detail = build_device_detail(serial, &parse_getprop_map(getprop_text));

    if let Some(text) = sections.get(DETAIL_SECTION_BATTERY) {
        detail.battery_level = parse_battery_level(text);
    }
    if let Some(text) = sections.get(DETAIL_SECTION_WIFI) {
        detail.wifi_is_on = parse_settings_bool(text);
    }
    if let Some(text) = sections.get(DETAIL_SECTION_BLUETOOTH) {
        detail.bt_is_on = parse_settings_bool(text);
    }

    let bt_state = sections
        .get(DETAIL_SECTION_BT_STATE)
        .and_then(|text| parse_bluetooth_manager_state(text));
    if detail.bt_is_on.is_none() {
        if let Some(state) = bt_state.as_deref() {
            detail.bt_is_on = Some(state.contains("ON"));
        }
    }
    detail.bluetooth_manager_state = bt_state;

    if let Some(text) = sections.get(DETAIL_SECTION_AUDIO) {
        detail.audio_state = parse_audio_summary(text);
    }
    if let Some(text) = sections.get(DETAIL_SECTION_GMS) {
        detail.gms_version = parse_gms_version_name(text);
    }

    if let Some(text) = sections.get(DETAIL_SECTION_WM) {
        let parsed = parse_wm_size(text);
        if parsed.is_none() && !text.trim().is_empty() {
            warn!(
                trace_id = %trace_id,
                serial = %serial,
                step = "wm_size",
                output = %text.trim(),
                "failed to parse wm size"
            );
        }
        detail.resolution = parsed;
    }

    if let Some(text) = sections.get(DETAIL_SECTION_DF) {
        match parse_df_total_kb(text) {
            Ok(total_kb) => {
                detail.storage_total_bytes = Some(total_kb.saturating_mul(1024));
            }
            Err(err) => {
                warn!(
                    trace_id = %trace_id,
                    serial = %serial,
                    step = "df",
                    error = %err,
                    "failed to parse df output"
                );
            }
        }
    }

    if let Some(text) = sections.get(DETAIL_SECTION_MEM) {
        match parse_mem_totals(text) {
            Ok(mem) => {
                detail.memory_total_bytes = Some(mem.total_bytes);
            }
            Err(err) => {
                warn!(
                    trace_id = %trace_id,
                    serial = %serial,
                    step = "meminfo",
                    error = %err,
                    "failed to parse /proc/meminfo"
                );
            }
        }
    }

    log_total();
    Some(detail)
}

#[tauri::command(async)]
pub fn list_devices(
    detailed: Option<bool>,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<DeviceInfo>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    info!(trace_id = %trace_id, "list_devices");

    // When troubleshooting device refresh performance, enable:
    //   LAZY_BLACKTEA_PROFILE_DEVICES=1
    // Optionally adjust the slow threshold:
    //   LAZY_BLACKTEA_PROFILE_DEVICES_SLOW_MS=500
    let profile_devices = std::env::var_os("LAZY_BLACKTEA_PROFILE_DEVICES").is_some();
    let profile_slow_ms = std::env::var("LAZY_BLACKTEA_PROFILE_DEVICES_SLOW_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(500);
    let list_started = Instant::now();

    let need_detail = detailed.unwrap_or(true);
    let android_result = (|| -> Result<Vec<DeviceInfo>, AppError> {
        let adb_program = get_adb_program(&trace_id)?;
        let args = vec!["devices".to_string(), "-l".to_string()];
        let devices_cmd_started = Instant::now();
        let output = run_adb(&adb_program, &args, &trace_id)?;
        let devices_cmd_elapsed_ms = devices_cmd_started.elapsed().as_millis() as u64;
        if profile_devices && (profile_slow_ms == 0 || devices_cmd_elapsed_ms >= profile_slow_ms) {
            info!(
                trace_id = %trace_id,
                step = "devices",
                elapsed_ms = devices_cmd_elapsed_ms,
                exit_code = ?output.exit_code,
                "adb host command timing"
            );
        }
        if output.exit_code.unwrap_or_default() != 0 {
            return Err(AppError::dependency(
                format!("adb devices failed: {}", output.stderr),
                &trace_id,
            ));
        }
        let summaries = parse_adb_devices(&output.stdout);
        let mut devices = Vec::with_capacity(summaries.len());

        if need_detail && summaries.iter().any(|summary| summary.state == "device") {
            let scheduler = Arc::clone(&state.scheduler);
            let detail_slots: Arc<Vec<OnceLock<Option<DeviceDetail>>>> = Arc::new(
                (0..summaries.len())
                    .map(|_| OnceLock::new())
                    .collect::<Vec<_>>(),
            );

            let mut handles = Vec::new();
            for (index, summary) in summaries.iter().enumerate() {
                if summary.state != "device" {
                    continue;
                }

                let serial = summary.serial.clone();
                let adb_program_spawn = adb_program.clone();
                let trace_spawn = trace_id.clone();
                let scheduler_spawn = Arc::clone(&scheduler);
                let detail_slots = Arc::clone(&detail_slots);

                handles.push(std::thread::spawn(move || {
                    let run_scheduled = |args: &[String],
                                         timeout: Duration,
                                         _step: &'static str|
                     -> Result<
                        crate::app::adb::runner::CommandOutput,
                        AppError,
                    > {
                        let _permit = scheduler_spawn.acquire_global();
                        let device_lock = scheduler_spawn.device_lock(&serial);
                        let _device_guard = device_lock.lock().map_err(|_| {
                            warn!(trace_id = %trace_spawn, serial = %serial, "device lock poisoned");
                            AppError::system(
                                "Failed to access the device. Please try again.",
                                &trace_spawn,
                            )
                        })?;
                        run_command_with_timeout(&adb_program_spawn, args, timeout, &trace_spawn)
                    };

                    let detail = load_device_detail(
                        &serial,
                        &trace_spawn,
                        profile_devices,
                        profile_slow_ms,
                        run_scheduled,
                    );

                    let _ = detail_slots[index].set(detail);
                }));
            }

            for handle in handles {
                if handle.join().is_err() {
                    warn!(
                        trace_id = %trace_id,
                        "device detail thread panicked"
                    );
                }
            }

            for (index, summary) in summaries.into_iter().enumerate() {
                let detail = detail_slots[index].get().cloned().unwrap_or(None);
                devices.push(DeviceInfo {
                    summary,
                    detail,
                    capabilities: DeviceCapabilities::android_default(),
                });
            }
        } else {
            for summary in summaries {
                devices.push(DeviceInfo {
                    summary,
                    detail: None,
                    capabilities: DeviceCapabilities::android_default(),
                });
            }
        }
        Ok(devices)
    })();

    let mut devices = Vec::new();
    let mut android_error = None;
    match android_result {
        Ok(mut android_devices) => devices.append(&mut android_devices),
        Err(err) => {
            warn!(trace_id = %trace_id, error = %err, "Android device discovery failed");
            android_error = Some(err);
        }
    }

    let mut ios_devices = ios_service::discover_ios_devices(&trace_id);
    devices.append(&mut ios_devices);

    if devices.is_empty() {
        if let Some(err) = android_error {
            return Err(err);
        }
    }

    let list_elapsed_ms = list_started.elapsed().as_millis() as u64;
    if profile_devices && (profile_slow_ms == 0 || list_elapsed_ms >= profile_slow_ms) {
        info!(
            trace_id = %trace_id,
            step = "list_devices_total",
            elapsed_ms = list_elapsed_ms,
            detailed = need_detail,
            device_count = devices.len(),
            "list_devices timing"
        );
    }

    Ok(CommandResponse {
        trace_id,
        data: devices,
    })
}

#[tauri::command(async)]
pub fn start_device_tracking(
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    info!(trace_id = %trace_id, "start_device_tracking");

    let adb_program = get_adb_program(&trace_id)?;
    let mut guard = state
        .device_tracker
        .lock()
        .map_err(|_| AppError::system("Device tracker registry locked", &trace_id))?;
    if let Some(handle) = guard.take() {
        handle.stop();
    }
    *guard = Some(start_device_tracker(app, trace_id.clone(), adb_program));

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn stop_device_tracking(
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    info!(trace_id = %trace_id, "stop_device_tracking");

    let mut guard = state
        .device_tracker
        .lock()
        .map_err(|_| AppError::system("Device tracker registry locked", &trace_id))?;
    if let Some(handle) = guard.take() {
        handle.stop();
    }

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn adb_pair(
    address: String,
    pairing_code: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<HostCommandResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&address, "address", &trace_id)?;
    ensure_non_empty(&pairing_code, "pairing_code", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let args = vec!["pair".to_string(), address.clone(), pairing_code.clone()];
    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(10), &trace_id)?;
    let combined = format!("{}{}", output.stdout, output.stderr).to_lowercase();
    if output.exit_code.unwrap_or_default() != 0
        || combined.contains("failed")
        || combined.contains("unable")
    {
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

#[tauri::command(async)]
pub fn adb_connect(
    address: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<HostCommandResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&address, "address", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let args = vec!["connect".to_string(), address.clone()];
    let output = run_command_with_timeout(&adb_program, &args, Duration::from_secs(10), &trace_id)?;
    let combined = format!("{}{}", output.stdout, output.stderr).to_lowercase();
    if output.exit_code.unwrap_or_default() != 0
        || combined.contains("failed")
        || combined.contains("unable")
    {
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

#[tauri::command(async)]
pub fn run_shell(
    serials: Vec<String>,
    command: String,
    parallel: Option<bool>,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&command, "command", &trace_id)?;
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let adb_program = get_adb_program(&trace_id)?;
    let mut config = load_config(&trace_id)?;
    let timeout = Duration::from_secs(config.command.command_timeout.max(1) as u64);
    let use_parallel = parallel.unwrap_or(config.command.parallel_execution);
    let scheduler = Arc::clone(&state.scheduler);

    let mut results = Vec::with_capacity(serials.len());
    if use_parallel {
        let mut handles = Vec::new();
        for (index, serial) in serials.into_iter().enumerate() {
            ensure_non_empty(&serial, "serial", &trace_id)?;
            let trace_id_clone = trace_id.clone();
            let command_clone = command.clone();
            let adb_program_clone = adb_program.clone();
            let scheduler_clone = Arc::clone(&scheduler);
            handles.push(std::thread::spawn(move || -> Result<_, AppError> {
                let _permit = scheduler_clone.acquire_global();
                let device_lock = scheduler_clone.device_lock(&serial);
                let _device_guard = device_lock.lock().map_err(|_| {
                    warn!(trace_id = %trace_id_clone, serial = %serial, "device lock poisoned");
                    AppError::system(
                        "Failed to access the device. Please try again.",
                        &trace_id_clone,
                    )
                })?;
                let args = vec![
                    "-s".to_string(),
                    serial.clone(),
                    "shell".to_string(),
                    "sh".to_string(),
                    "-c".to_string(),
                    command_clone,
                ];
                let output =
                    run_command_with_timeout(&adb_program_clone, &args, timeout, &trace_id_clone)?;
                Ok((index, serial, output))
            }));
        }

        let mut collected = Vec::new();
        for handle in handles {
            let (index, serial, output) = handle
                .join()
                .map_err(|_| AppError::system("Shell command thread panicked", &trace_id))??;
            collected.push((
                index,
                CommandResult {
                    serial,
                    stdout: output.stdout,
                    stderr: output.stderr,
                    exit_code: output.exit_code,
                },
            ));
        }
        collected.sort_by_key(|item| item.0);
        results = collected.into_iter().map(|item| item.1).collect();
    } else {
        for serial in serials {
            ensure_non_empty(&serial, "serial", &trace_id)?;
            let _permit = scheduler.acquire_global();
            let device_lock = scheduler.device_lock(&serial);
            let _device_guard = device_lock.lock().map_err(|_| {
                warn!(trace_id = %trace_id, serial = %serial, "device lock poisoned");
                AppError::system("Failed to access the device. Please try again.", &trace_id)
            })?;
            let args = vec![
                "-s".to_string(),
                serial.clone(),
                "shell".to_string(),
                "sh".to_string(),
                "-c".to_string(),
                command.clone(),
            ];
            let output = run_command_with_timeout(&adb_program, &args, timeout, &trace_id)?;
            results.push(CommandResult {
                serial,
                stdout: output.stdout,
                stderr: output.stderr,
                exit_code: output.exit_code,
            });
        }
    }

    if config.command.auto_save_history && !command.trim().is_empty() {
        if config
            .command_history
            .last()
            .map(|last| last == &command)
            .unwrap_or(false)
        {
            // skip duplicate trailing entry
        } else {
            config.command_history.push(command.clone());
            if config.command_history.len() > config.command.max_history_size {
                let start = config
                    .command_history
                    .len()
                    .saturating_sub(config.command.max_history_size);
                config.command_history = config.command_history.split_off(start);
            }
            if let Err(err) = save_config(&config, &trace_id) {
                warn!(trace_id = %trace_id, error = %err, "Failed to save command history");
            }
        }
    }

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}

#[tauri::command(async)]
pub fn persist_terminal_state(
    restore_sessions: Vec<String>,
    buffers: HashMap<String, Vec<String>>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);

    let mut config = load_config(&trace_id)?;

    let mut unique_restore_sessions = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for serial in restore_sessions {
        let trimmed = serial.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            unique_restore_sessions.push(trimmed.to_string());
        }
    }

    let mut next_buffers: HashMap<String, Vec<String>> = HashMap::new();
    for serial in unique_restore_sessions.iter() {
        if let Some(lines) = buffers.get(serial) {
            let mut lines = lines.clone();
            clamp_terminal_buffer_lines(&mut lines);
            next_buffers.insert(serial.clone(), lines);
        } else if let Some(existing) = config.terminal.buffers.get(serial) {
            next_buffers.insert(serial.clone(), existing.clone());
        }
    }

    config.terminal.restore_sessions = unique_restore_sessions;
    config.terminal.buffers = next_buffers;

    save_config(&config, &trace_id).map_err(|err| {
        AppError::system(
            format!("Failed to persist terminal state: {err}"),
            &trace_id,
        )
    })?;

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

fn terminal_shell_args(serial: &str) -> Vec<String> {
    vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "-t".to_string(),
        "-t".to_string(),
    ]
}

fn running_terminal_session_response(
    existing: &TerminalSession,
    trace_id: &str,
) -> Option<CommandResponse<TerminalSessionInfo>> {
    if !existing.is_running() {
        return None;
    }
    Some(CommandResponse {
        trace_id: trace_id.to_string(),
        data: TerminalSessionInfo {
            serial: existing.serial.clone(),
            session_id: existing.session_id.clone(),
        },
    })
}

#[tauri::command(async)]
pub fn start_terminal_session(
    serial: String,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<TerminalSessionInfo>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let mut guard = state
        .terminal_sessions
        .lock()
        .map_err(|_| AppError::system("Terminal registry locked", &trace_id))?;
    if let Some(existing) = guard.get(&serial) {
        if let Some(response) = running_terminal_session_response(existing, &trace_id) {
            return Ok(response);
        }
    }
    guard.remove(&serial);

    let session_id = Uuid::new_v4().to_string();
    let args = terminal_shell_args(&serial);

    let app_emit = app.clone();
    let trace_emit = trace_id.clone();
    let emitter: Arc<dyn Fn(TerminalEvent) + Send + Sync> = Arc::new(move |event| {
        if let Err(err) = app_emit.emit(TERMINAL_EVENT_NAME, event) {
            warn!(trace_id = %trace_emit, error = %err, "failed to emit terminal event");
        }
    });

    let session = TerminalSession::spawn(
        &adb_program,
        &args,
        serial.clone(),
        session_id.clone(),
        trace_id.clone(),
        emitter,
    )
    .map_err(|err| {
        AppError::dependency(
            format!("Failed to start terminal session: {err}"),
            &trace_id,
        )
    })?;

    guard.insert(serial.clone(), session);

    Ok(CommandResponse {
        trace_id,
        data: TerminalSessionInfo { serial, session_id },
    })
}

#[tauri::command(async)]
pub fn write_terminal_session(
    serial: String,
    data: String,
    newline: bool,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let mut guard = state
        .terminal_sessions
        .lock()
        .map_err(|_| AppError::system("Terminal registry locked", &trace_id))?;
    let not_running = match guard.get(&serial) {
        Some(session) => !session.is_running(),
        None => true,
    };
    if not_running {
        guard.remove(&serial);
        return Err(AppError::validation(
            "Terminal session not running",
            &trace_id,
        ));
    }
    let session = guard
        .get(&serial)
        .ok_or_else(|| AppError::validation("Terminal session not running", &trace_id))?;
    session
        .write(&data, newline)
        .map_err(|err| AppError::dependency(format!("Terminal write failed: {err}"), &trace_id))?;

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn stop_terminal_session(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let mut guard = state
        .terminal_sessions
        .lock()
        .map_err(|_| AppError::system("Terminal registry locked", &trace_id))?;
    let session = guard
        .remove(&serial)
        .ok_or_else(|| AppError::validation("Terminal session not running", &trace_id))?;
    session.stop();

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn reboot_devices(
    serials: Vec<String>,
    mode: Option<String>,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let adb_program = get_adb_program(&trace_id)?;
    let mode = mode.unwrap_or_else(|| "system".to_string());
    let scheduler = Arc::clone(&state.scheduler);

    let mut handles = Vec::new();
    for (index, serial) in serials.into_iter().enumerate() {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let scheduler_clone = Arc::clone(&scheduler);
        let trace_clone = trace_id.clone();
        let adb_program_clone = adb_program.clone();
        let mode_clone = mode.clone();
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

            let mut args = vec!["-s".to_string(), serial.clone(), "reboot".to_string()];
            match mode_clone.as_str() {
                "recovery" => args.push("recovery".to_string()),
                "bootloader" => args.push("bootloader".to_string()),
                _ => {}
            }
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
            .map_err(|_| AppError::system("Reboot thread panicked", &trace_id))??;
        collected.push((index, result));
    }
    collected.sort_by_key(|item| item.0);
    let results = collected.into_iter().map(|item| item.1).collect();

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}

#[tauri::command(async)]
pub fn set_wifi_state(
    serials: Vec<String>,
    enable: bool,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
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
                "svc".to_string(),
                "wifi".to_string(),
                if enable { "enable" } else { "disable" }.to_string(),
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
            .map_err(|_| AppError::system("WiFi toggle thread panicked", &trace_id))??;
        collected.push((index, result));
    }
    collected.sort_by_key(|item| item.0);
    let results = collected.into_iter().map(|item| item.1).collect();

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}

#[tauri::command(async)]
pub fn set_bluetooth_state(
    serials: Vec<String>,
    enable: bool,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
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

            let mut args = vec![
                "-s".to_string(),
                serial.clone(),
                "shell".to_string(),
                "svc".to_string(),
                "bluetooth".to_string(),
                if enable { "enable" } else { "disable" }.to_string(),
            ];
            let mut output = run_command_with_timeout(
                &adb_program_clone,
                &args,
                Duration::from_secs(10),
                &trace_clone,
            );
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
                output = run_command_with_timeout(
                    &adb_program_clone,
                    &args,
                    Duration::from_secs(10),
                    &trace_clone,
                );
            }
            let output = output?;
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
            .map_err(|_| AppError::system("Bluetooth toggle thread panicked", &trace_id))??;
        collected.push((index, result));
    }
    collected.sort_by_key(|item| item.0);
    let results = collected.into_iter().map(|item| item.1).collect();

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}

enum CancellableCommandOutcome {
    Completed(crate::app::adb::runner::CommandOutput),
    Cancelled,
    TimedOut,
}

struct ApkInstallProcessGuard<'a> {
    state: &'a AppState,
    trace_id: String,
}

impl Drop for ApkInstallProcessGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.state.apk_install_processes.lock() {
            map.remove(&self.trace_id);
        }
    }
}

fn kill_apk_install_handle(handle: &ApkInstallHandle) {
    handle.cancel_flag.store(true, Ordering::SeqCst);
    if let Ok(mut children) = handle.active_children.lock() {
        for (_, slot) in children.drain() {
            if let Ok(mut guard) = slot.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

fn emit_apk_install_event(app: &Option<AppHandle>, event: ApkInstallEvent) {
    if let Some(app_emit) = app {
        let trace_id = event.trace_id.clone();
        if let Err(err) = app_emit.emit(APK_INSTALL_EVENT_NAME, event) {
            warn!(trace_id = %trace_id, error = %err, "failed to emit apk install event");
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_cancellable_adb_command<F>(
    program: &str,
    args: &[String],
    timeout: Duration,
    serial: &str,
    cancel_flag: &Arc<AtomicBool>,
    active_children: &ApkInstallChildrenMap,
    trace_id: &str,
    on_progress: Option<Arc<F>>,
) -> Result<CancellableCommandOutcome, AppError>
where
    F: Fn(u8) + Send + Sync + 'static,
{
    if cancel_flag.load(Ordering::SeqCst) {
        return Ok(CancellableCommandOutcome::Cancelled);
    }

    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| AppError::system(format!("Failed to spawn command: {err}"), trace_id))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::system("Failed to capture stdout", trace_id))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::system("Failed to capture stderr", trace_id))?;

    let child_slot = Arc::new(std::sync::Mutex::new(Some(child)));
    if let Ok(mut map) = active_children.lock() {
        map.insert(serial.to_string(), Arc::clone(&child_slot));
    }

    let stdout_buffer = Arc::new(std::sync::Mutex::new(String::new()));
    let stderr_buffer = Arc::new(std::sync::Mutex::new(String::new()));
    let last_progress = Arc::new(std::sync::Mutex::new(None::<u8>));

    let spawn_reader = |mut stream: Box<dyn Read + Send>,
                        buffer: Arc<std::sync::Mutex<String>>,
                        progress_cb: Option<Arc<F>>,
                        last_pct: Arc<std::sync::Mutex<Option<u8>>>| {
        std::thread::spawn(move || {
            let mut temp = [0u8; 4096];
            let mut pending = String::new();
            loop {
                let read_count = match stream.read(&mut temp) {
                    Ok(0) => break,
                    Ok(count) => count,
                    Err(_) => break,
                };
                let chunk = String::from_utf8_lossy(&temp[..read_count]).to_string();
                if let Ok(mut guard) = buffer.lock() {
                    append_limited(&mut guard, &chunk, 200_000);
                }
                if let Some(cb) = &progress_cb {
                    pending.push_str(&chunk);
                    let mut start = 0usize;
                    for (index, ch) in pending.char_indices() {
                        if ch == '\n' || ch == '\r' {
                            let line = pending[start..index].trim();
                            start = index + ch.len_utf8();
                            if !line.is_empty() {
                                if let Some(percent) = parse_progress_percent(line) {
                                    let should_emit = last_pct
                                        .lock()
                                        .map(|mut guard| {
                                            if *guard != Some(percent) {
                                                *guard = Some(percent);
                                                true
                                            } else {
                                                false
                                            }
                                        })
                                        .unwrap_or(false);
                                    if should_emit {
                                        cb(percent);
                                    }
                                }
                            }
                        }
                    }
                    if start > 0 {
                        pending = pending[start..].to_string();
                    }
                }
            }
        })
    };

    let stdout_handle = spawn_reader(
        Box::new(stdout),
        Arc::clone(&stdout_buffer),
        on_progress.clone(),
        Arc::clone(&last_progress),
    );
    let stderr_handle = spawn_reader(
        Box::new(stderr),
        Arc::clone(&stderr_buffer),
        on_progress,
        last_progress,
    );

    let start = Instant::now();
    enum WaitOutcome {
        Exited(std::process::ExitStatus),
        Cancelled,
        TimedOut,
    }
    let wait_outcome = loop {
        if cancel_flag.load(Ordering::SeqCst) {
            if let Ok(mut guard) = child_slot.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            break Ok(WaitOutcome::Cancelled);
        }

        let wait_result = if let Ok(mut guard) = child_slot.lock() {
            match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => {
                        guard.take();
                        Ok(Some(status))
                    }
                    Ok(None) => Ok(None),
                    Err(err) => Err(err),
                },
                None => {
                    // Child was taken & killed by cancellation handler.
                    break Ok(WaitOutcome::Cancelled);
                }
            }
        } else {
            break Err(AppError::system(
                "Install process lock poisoned".to_string(),
                trace_id,
            ));
        };

        match wait_result {
            Ok(Some(status)) => {
                break Ok(WaitOutcome::Exited(status));
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    if let Ok(mut guard) = child_slot.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                    break Ok(WaitOutcome::TimedOut);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                if let Ok(mut guard) = child_slot.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                break Err(AppError::system(
                    format!("Failed to poll command: {err}"),
                    trace_id,
                ));
            }
        }
    };

    if let Ok(mut map) = active_children.lock() {
        map.remove(serial);
    }

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    match wait_outcome? {
        WaitOutcome::Cancelled => Ok(CancellableCommandOutcome::Cancelled),
        WaitOutcome::TimedOut => Ok(CancellableCommandOutcome::TimedOut),
        WaitOutcome::Exited(status) => {
            let stdout_value = stdout_buffer
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            let stderr_value = stderr_buffer
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            Ok(CancellableCommandOutcome::Completed(
                crate::app::adb::runner::CommandOutput {
                    stdout: stdout_value,
                    stderr: stderr_value,
                    exit_code: status.code(),
                },
            ))
        }
    }
}

fn cleanup_remote_temp_apk(adb_program: &str, serial: &str, remote_path: &str, trace_id: &str) {
    let args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "rm".to_string(),
        "-f".to_string(),
        remote_path.to_string(),
    ];
    let _ = run_command_with_timeout(adb_program, &args, Duration::from_secs(5), trace_id);
}

#[allow(clippy::too_many_arguments)]
fn install_apk_batch_inner(
    serials: Vec<String>,
    apk_path: String,
    replace: bool,
    allow_downgrade: bool,
    grant: bool,
    allow_test_packages: bool,
    extra_args: Option<String>,
    state: &AppState,
    trace_id: &str,
    app: Option<AppHandle>,
) -> Result<ApkBatchInstallResult, AppError> {
    let trace_id = trace_id.to_string();
    ensure_non_empty(&apk_path, "apk_path", &trace_id)?;
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }

    let adb_program = get_adb_program(&trace_id)?;
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
        let bundle =
            extract_split_apks(&apk_path).map_err(|err| AppError::dependency(err, &trace_id))?;
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
            return Ok(result);
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
            return Ok(result);
        }
    }

    let extra_args_list = extra_args
        .unwrap_or_default()
        .split_whitespace()
        .map(|item| item.to_string())
        .collect::<Vec<_>>();

    let use_parallel = load_config(&trace_id)?.command.parallel_execution;
    let scheduler = Arc::clone(&state.scheduler);
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let active_children: ApkInstallChildrenMap = Arc::new(std::sync::Mutex::new(HashMap::new()));
    if let Ok(mut map) = state.apk_install_processes.lock() {
        map.insert(
            trace_id.clone(),
            ApkInstallHandle {
                cancel_flag: Arc::clone(&cancel_flag),
                active_children: Arc::clone(&active_children),
            },
        );
    }
    let _guard = ApkInstallProcessGuard {
        state,
        trace_id: trace_id.clone(),
    };

    let mut handles = Vec::new();
    for serial in serials {
        let trace_clone = trace_id.clone();
        let extra_args_list = extra_args_list.clone();
        let split_paths = split_bundle.as_ref().map(|bundle| bundle.apk_paths.clone());
        let apk_path_clone = apk_path.clone();
        let adb_program_clone = adb_program.clone();
        let scheduler_clone = Arc::clone(&scheduler);
        let cancel_flag_clone = Arc::clone(&cancel_flag);
        let active_children_clone = Arc::clone(&active_children);
        let app_clone = app.clone();
        handles.push(std::thread::spawn(move || {
            let start_device = std::time::Instant::now();
            emit_apk_install_event(
                &app_clone,
                ApkInstallEvent {
                    serial: serial.clone(),
                    event: "start".to_string(),
                    stage: Some("validating".to_string()),
                    progress: None,
                    success: None,
                    message: Some("Preparing install...".to_string()),
                    error_code: None,
                    error_description: None,
                    raw_output: None,
                    trace_id: trace_clone.clone(),
                },
            );
            let _permit = scheduler_clone.acquire_global();
            let device_lock = scheduler_clone.device_lock(&serial);
            let _device_guard = match device_lock.lock() {
                Ok(guard) => guard,
                Err(_) => {
                    warn!(trace_id = %trace_clone, serial = %serial, "device lock poisoned");
                    let result_item = ApkInstallResult {
                        serial,
                        success: false,
                        error_code: ApkInstallErrorCode::UnknownError,
                        raw_output: "Failed to access the device. Please try again.".to_string(),
                        duration_seconds: start_device.elapsed().as_secs_f64(),
                        device_model: None,
                    };
                    emit_apk_install_event(
                        &app_clone,
                        ApkInstallEvent {
                            serial: result_item.serial.clone(),
                            event: "complete".to_string(),
                            stage: Some("complete".to_string()),
                            progress: None,
                            success: Some(false),
                            message: Some(
                                "Failed to access the device. Please try again.".to_string(),
                            ),
                            error_code: Some(result_item.error_code.code().to_string()),
                            error_description: Some(
                                result_item.error_code.description().to_string(),
                            ),
                            raw_output: Some(truncate_for_event(
                                result_item.raw_output.trim(),
                                APK_INSTALL_OUTPUT_MAX_LEN,
                            )),
                            trace_id: trace_clone.clone(),
                        },
                    );
                    return result_item;
                }
            };

            let mut was_cancelled = false;
            let result_item = if split_paths.is_none()
                && supports_push_and_pm_install(&extra_args_list)
            {
                let short_id = Uuid::new_v4().simple().to_string();
                let remote_tmp = format!("/data/local/tmp/lb_install_{}.apk", &short_id[..12]);
                emit_apk_install_event(
                    &app_clone,
                    ApkInstallEvent {
                        serial: serial.clone(),
                        event: "progress".to_string(),
                        stage: Some("pushing".to_string()),
                        progress: Some(0),
                        success: None,
                        message: Some("Pushing APK... (0%)".to_string()),
                        error_code: None,
                        error_description: None,
                        raw_output: None,
                        trace_id: trace_clone.clone(),
                    },
                );

                let push_args = vec![
                    "-s".to_string(),
                    serial.clone(),
                    "push".to_string(),
                    "-p".to_string(),
                    apk_path_clone.clone(),
                    remote_tmp.clone(),
                ];
                let progress_app = app_clone.clone();
                let progress_serial = serial.clone();
                let progress_trace = trace_clone.clone();
                let progress_cb = Arc::new(move |percent: u8| {
                    emit_apk_install_event(
                        &progress_app,
                        ApkInstallEvent {
                            serial: progress_serial.clone(),
                            event: "progress".to_string(),
                            stage: Some("pushing".to_string()),
                            progress: Some(percent),
                            success: None,
                            message: Some(format!("Pushing APK... ({percent}%)")),
                            error_code: None,
                            error_description: None,
                            raw_output: None,
                            trace_id: progress_trace.clone(),
                        },
                    );
                });

                let push_outcome = run_cancellable_adb_command(
                    &adb_program_clone,
                    &push_args,
                    Duration::from_secs(300),
                    &serial,
                    &cancel_flag_clone,
                    &active_children_clone,
                    &trace_clone,
                    Some(progress_cb),
                );

                let install_res = match push_outcome {
                    Ok(CancellableCommandOutcome::Cancelled) => {
                        was_cancelled = true;
                        ApkInstallResult {
                            serial: serial.clone(),
                            success: false,
                            error_code: ApkInstallErrorCode::InstallFailedAborted,
                            raw_output: "Installation cancelled by user".to_string(),
                            duration_seconds: start_device.elapsed().as_secs_f64(),
                            device_model: None,
                        }
                    }
                    Ok(CancellableCommandOutcome::TimedOut) => ApkInstallResult {
                        serial: serial.clone(),
                        success: false,
                        error_code: ApkInstallErrorCode::UnknownError,
                        raw_output: "Timed out while pushing APK to device".to_string(),
                        duration_seconds: start_device.elapsed().as_secs_f64(),
                        device_model: None,
                    },
                    Err(err) => ApkInstallResult {
                        serial: serial.clone(),
                        success: false,
                        error_code: ApkInstallErrorCode::UnknownError,
                        raw_output: err.error,
                        duration_seconds: start_device.elapsed().as_secs_f64(),
                        device_model: None,
                    },
                    Ok(CancellableCommandOutcome::Completed(push_output)) => {
                        if push_output.exit_code != Some(0) {
                            let raw = if push_output.stderr.trim().is_empty() {
                                push_output.stdout
                            } else {
                                push_output.stderr
                            };
                            let error_code = ApkInstallErrorCode::from_output(&raw);
                            ApkInstallResult {
                                serial: serial.clone(),
                                success: false,
                                error_code,
                                raw_output: if raw.trim().is_empty() {
                                    "Failed to push APK to device".to_string()
                                } else {
                                    raw
                                },
                                duration_seconds: start_device.elapsed().as_secs_f64(),
                                device_model: None,
                            }
                        } else {
                            emit_apk_install_event(
                                &app_clone,
                                ApkInstallEvent {
                                    serial: serial.clone(),
                                    event: "progress".to_string(),
                                    stage: Some("installing".to_string()),
                                    progress: Some(100),
                                    success: None,
                                    message: Some("Installing package...".to_string()),
                                    error_code: None,
                                    error_description: None,
                                    raw_output: None,
                                    trace_id: trace_clone.clone(),
                                },
                            );

                            let mut pm_args = vec![
                                "-s".to_string(),
                                serial.clone(),
                                "shell".to_string(),
                                "pm".to_string(),
                                "install".to_string(),
                            ];
                            if replace {
                                pm_args.push("-r".to_string());
                            }
                            if allow_downgrade {
                                pm_args.push("-d".to_string());
                            }
                            if grant {
                                pm_args.push("-g".to_string());
                            }
                            if allow_test_packages {
                                pm_args.push("-t".to_string());
                            }
                            pm_args.push(remote_tmp.clone());

                            let pm_outcome = run_cancellable_adb_command::<fn(u8)>(
                                &adb_program_clone,
                                &pm_args,
                                Duration::from_secs(300),
                                &serial,
                                &cancel_flag_clone,
                                &active_children_clone,
                                &trace_clone,
                                None,
                            );

                            match pm_outcome {
                                Ok(CancellableCommandOutcome::Cancelled) => {
                                    was_cancelled = true;
                                    ApkInstallResult {
                                        serial: serial.clone(),
                                        success: false,
                                        error_code: ApkInstallErrorCode::InstallFailedAborted,
                                        raw_output: "Installation cancelled by user".to_string(),
                                        duration_seconds: start_device.elapsed().as_secs_f64(),
                                        device_model: None,
                                    }
                                }
                                Ok(CancellableCommandOutcome::TimedOut) => ApkInstallResult {
                                    serial: serial.clone(),
                                    success: false,
                                    error_code: ApkInstallErrorCode::UnknownError,
                                    raw_output: "Command timed out".to_string(),
                                    duration_seconds: start_device.elapsed().as_secs_f64(),
                                    device_model: None,
                                },
                                Err(err) => ApkInstallResult {
                                    serial: serial.clone(),
                                    success: false,
                                    error_code: ApkInstallErrorCode::UnknownError,
                                    raw_output: err.error,
                                    duration_seconds: start_device.elapsed().as_secs_f64(),
                                    device_model: None,
                                },
                                Ok(CancellableCommandOutcome::Completed(output)) => {
                                    let raw = if output.stdout.trim().is_empty() {
                                        output.stderr
                                    } else if output.stderr.trim().is_empty() {
                                        output.stdout
                                    } else {
                                        format!(
                                            "{}\n{}",
                                            output.stdout.trim(),
                                            output.stderr.trim()
                                        )
                                    };
                                    let error_code = ApkInstallErrorCode::from_output(&raw);
                                    let success = error_code == ApkInstallErrorCode::Success;
                                    ApkInstallResult {
                                        serial: serial.clone(),
                                        success,
                                        error_code,
                                        raw_output: raw,
                                        duration_seconds: start_device.elapsed().as_secs_f64(),
                                        device_model: None,
                                    }
                                }
                            }
                        }
                    }
                };

                cleanup_remote_temp_apk(&adb_program_clone, &serial, &remote_tmp, &trace_clone);
                install_res
            } else {
                emit_apk_install_event(
                    &app_clone,
                    ApkInstallEvent {
                        serial: serial.clone(),
                        event: "progress".to_string(),
                        stage: Some("installing".to_string()),
                        progress: None,
                        success: None,
                        message: Some("Installing package...".to_string()),
                        error_code: None,
                        error_description: None,
                        raw_output: None,
                        trace_id: trace_clone.clone(),
                    },
                );

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

                let outcome = run_cancellable_adb_command::<fn(u8)>(
                    &adb_program_clone,
                    &args,
                    Duration::from_secs(300),
                    &serial,
                    &cancel_flag_clone,
                    &active_children_clone,
                    &trace_clone,
                    None,
                );
                let elapsed = start_device.elapsed().as_secs_f64();
                match outcome {
                    Ok(CancellableCommandOutcome::Cancelled) => {
                        was_cancelled = true;
                        ApkInstallResult {
                            serial: serial.clone(),
                            success: false,
                            error_code: ApkInstallErrorCode::InstallFailedAborted,
                            raw_output: "Installation cancelled by user".to_string(),
                            duration_seconds: elapsed,
                            device_model: None,
                        }
                    }
                    Ok(CancellableCommandOutcome::TimedOut) => ApkInstallResult {
                        serial: serial.clone(),
                        success: false,
                        error_code: ApkInstallErrorCode::UnknownError,
                        raw_output: "Command timed out".to_string(),
                        duration_seconds: elapsed,
                        device_model: None,
                    },
                    Ok(CancellableCommandOutcome::Completed(output)) => {
                        let raw = if output.stdout.trim().is_empty() {
                            output.stderr
                        } else if output.stderr.trim().is_empty() {
                            output.stdout
                        } else {
                            format!("{}\n{}", output.stdout.trim(), output.stderr.trim())
                        };
                        let error_code = ApkInstallErrorCode::from_output(&raw);
                        let success = error_code == ApkInstallErrorCode::Success;
                        ApkInstallResult {
                            serial: serial.clone(),
                            success,
                            error_code,
                            raw_output: raw,
                            duration_seconds: elapsed,
                            device_model: None,
                        }
                    }
                    Err(err) => ApkInstallResult {
                        serial: serial.clone(),
                        success: false,
                        error_code: ApkInstallErrorCode::UnknownError,
                        raw_output: err.error,
                        duration_seconds: elapsed,
                        device_model: None,
                    },
                }
            };

            let raw_trimmed = result_item.raw_output.trim();
            let raw_output = if raw_trimmed.is_empty() {
                None
            } else {
                Some(truncate_for_event(raw_trimmed, APK_INSTALL_OUTPUT_MAX_LEN))
            };
            let error_description = if result_item.success {
                None
            } else {
                Some(result_item.error_code.description().to_string())
            };
            let message = if result_item.success {
                Some("Installed.".to_string())
            } else if was_cancelled {
                Some("Cancelled.".to_string())
            } else if result_item.error_code != ApkInstallErrorCode::UnknownError {
                Some(result_item.error_code.description().to_string())
            } else if let Some(raw) = raw_output.clone() {
                Some(raw)
            } else {
                Some(result_item.error_code.description().to_string())
            };

            emit_apk_install_event(
                &app_clone,
                ApkInstallEvent {
                    serial: result_item.serial.clone(),
                    event: "complete".to_string(),
                    stage: Some(
                        if was_cancelled {
                            "cancelled"
                        } else {
                            "complete"
                        }
                        .to_string(),
                    ),
                    progress: if result_item.success { Some(100) } else { None },
                    success: Some(result_item.success),
                    message,
                    error_code: Some(result_item.error_code.code().to_string()),
                    error_description,
                    raw_output,
                    trace_id: trace_clone.clone(),
                },
            );

            result_item
        }));
        if !use_parallel {
            if let Some(handle) = handles.pop() {
                let result_item = handle
                    .join()
                    .map_err(|_| AppError::system("Install thread panicked", &trace_id))?;
                result
                    .results
                    .insert(result_item.serial.clone(), result_item);
            }
        }
    }

    for handle in handles {
        let result_item = handle
            .join()
            .map_err(|_| AppError::system("Install thread panicked", &trace_id))?;
        result
            .results
            .insert(result_item.serial.clone(), result_item);
    }

    result.total_duration_seconds = start.elapsed().as_secs_f64();

    Ok(result)
}

#[tauri::command(async)]
pub fn inspect_apk(
    apk_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<ApkInfo>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&apk_path, "apk_path", &trace_id)?;
    let info = get_apk_info(&apk_path);
    Ok(CommandResponse {
        trace_id,
        data: info,
    })
}

#[tauri::command]
pub fn cancel_apk_install(
    trace_id: String,
    state: State<'_, AppState>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = trace_id.trim().to_string();
    ensure_non_empty(&trace_id, "trace_id", &trace_id)?;
    let cancelled = if let Ok(mut map) = state.apk_install_processes.lock() {
        if let Some(handle) = map.remove(&trace_id) {
            kill_apk_install_handle(&handle);
            true
        } else {
            false
        }
    } else {
        false
    };
    Ok(CommandResponse {
        trace_id,
        data: cancelled,
    })
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn install_apk_batch(
    serials: Vec<String>,
    apk_path: String,
    replace: bool,
    allow_downgrade: bool,
    grant: bool,
    allow_test_packages: bool,
    extra_args: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<ApkBatchInstallResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let result = install_apk_batch_inner(
        serials,
        apk_path,
        replace,
        allow_downgrade,
        grant,
        allow_test_packages,
        extra_args,
        state.inner(),
        &trace_id,
        Some(app),
    )?;

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

#[tauri::command(async)]
pub fn capture_screenshot(
    serial: String,
    output_dir: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&output_dir, "output_dir", &trace_id)?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let safe_serial = sanitize_filename_component(&serial);
    let filename = format!("screenshot_{}_{}.png", safe_serial, timestamp);
    let mut output_path = PathBuf::from(output_dir);
    fs::create_dir_all(&output_path).map_err(|err| {
        AppError::system(format!("Failed to create output dir: {err}"), &trace_id)
    })?;
    output_path.push(&filename);
    let output_path_string = output_path.to_string_lossy().to_string();

    // Route iOS UDIDs to idevicescreenshot when the tool is available.
    if ios_service::looks_like_ios_serial(&serial) {
        let tools = ios_service::check_ios_tools(&trace_id);
        if tools.idevicescreenshot.available {
            let path = ios_service::capture_ios_screenshot(&serial, &output_path, &trace_id)?;
            return Ok(CommandResponse {
                trace_id,
                data: path.to_string_lossy().to_string(),
            });
        }
    }

    let adb_program = get_adb_program(&trace_id)?;
    let config = load_config(&trace_id)?;
    let bytes = capture_validated_screenshot_bytes(
        &adb_program,
        &serial,
        &config,
        &output_path,
        "screenshot",
        &trace_id,
    )?;
    write_png_file(&output_path, &bytes, &trace_id)?;

    Ok(CommandResponse {
        trace_id,
        data: output_path_string,
    })
}

fn resolve_screen_record_output_dir(
    output_dir: Option<String>,
    default_output_dir: &str,
    trace_id: &str,
) -> Result<String, AppError> {
    let resolved = output_dir
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_output_dir.to_string());
    ensure_non_empty(&resolved, "output_dir", trace_id)?;
    fs::create_dir_all(&resolved)
        .map_err(|err| AppError::system(format!("Failed to create output dir: {err}"), trace_id))?;
    Ok(resolved)
}

fn pull_screen_record_file(
    adb_program: &str,
    serial: &str,
    remote_path: &str,
    local_path: &Path,
    trace_id: &str,
) -> Result<(), AppError> {
    let args = vec![
        "-s".to_string(),
        serial.to_string(),
        "pull".to_string(),
        remote_path.to_string(),
        local_path.to_string_lossy().to_string(),
    ];
    let output = run_adb(adb_program, &args, trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("Pull failed: {}", output.stderr),
            trace_id,
        ));
    }
    Ok(())
}

fn wait_for_child_exit(
    child: &mut std::process::Child,
    timeout: Duration,
    label: &str,
    trace_id: &str,
) -> Result<(), AppError> {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AppError::system(
                        format!("Timeout waiting for {label}"),
                        trace_id,
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(err) => {
                return Err(AppError::system(
                    format!("Failed to stop {label}: {err}"),
                    trace_id,
                ))
            }
        }
    }
}

fn send_remote_screenrecord_sigint(adb_program: &str, serial: &str) {
    let _ = Command::new(adb_program)
        .args(["-s", serial, "shell", "pkill", "-SIGINT", "screenrecord"])
        .output();
}

#[cfg(unix)]
fn interrupt_local_child(child: &mut std::process::Child) {
    let _ = Command::new("kill")
        .args(["-INT", &child.id().to_string()])
        .status();
}

#[cfg(not(unix))]
fn interrupt_local_child(child: &mut std::process::Child) {
    let _ = child.kill();
}

fn move_recording_file_to_output_dir(
    source_path: &str,
    output_dir: Option<String>,
    trace_id: &str,
) -> Result<String, AppError> {
    let source = PathBuf::from(source_path);
    let Some(file_name) = source.file_name().map(|value| value.to_owned()) else {
        return Ok(source.to_string_lossy().to_string());
    };
    let Some(output_dir) = output_dir.filter(|value| !value.trim().is_empty()) else {
        return Ok(source.to_string_lossy().to_string());
    };
    fs::create_dir_all(&output_dir)
        .map_err(|err| AppError::system(format!("Failed to create output dir: {err}"), trace_id))?;
    let target = PathBuf::from(output_dir).join(file_name);
    if target == source {
        return Ok(source.to_string_lossy().to_string());
    }
    match fs::rename(&source, &target) {
        Ok(()) => Ok(target.to_string_lossy().to_string()),
        Err(_) => {
            fs::copy(&source, &target).map_err(|err| {
                AppError::system(format!("Failed to move recording: {err}"), trace_id)
            })?;
            fs::remove_file(&source).map_err(|err| {
                AppError::system(
                    format!("Failed to remove original recording after copy: {err}"),
                    trace_id,
                )
            })?;
            Ok(target.to_string_lossy().to_string())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RecordingLogcatCaptureResult {
    output_path: String,
    error: Option<String>,
}

fn build_screen_record_artifact_paths(
    output_path: &str,
    output_paths: &[String],
    logcat_output_path: Option<&str>,
) -> Vec<String> {
    let mut paths = Vec::new();
    for path in output_paths {
        if !path.trim().is_empty() && !paths.iter().any(|existing| existing == path) {
            paths.push(path.clone());
        }
    }
    if paths.is_empty() && !output_path.trim().is_empty() {
        paths.push(output_path.to_string());
    }
    if let Some(logcat_path) = logcat_output_path.filter(|path| !path.trim().is_empty()) {
        if !paths.iter().any(|existing| existing == logcat_path) {
            paths.push(logcat_path.to_string());
        }
    }
    paths
}

fn attach_logcat_capture_to_stop_result(
    mut result: ScreenRecordStopResult,
    logcat_result: Option<RecordingLogcatCaptureResult>,
) -> ScreenRecordStopResult {
    if let Some(logcat_result) = logcat_result {
        result.logcat_output_path = Some(logcat_result.output_path);
        result.logcat_error = logcat_result.error;
    }
    result.artifact_paths = build_screen_record_artifact_paths(
        &result.output_path,
        &result.output_paths,
        result.logcat_output_path.as_deref(),
    );
    result
}

fn start_recording_logcat_capture(
    adb_program: &str,
    serial: &str,
    output_dir: &str,
    timestamp: &str,
    trace_id: &str,
) -> Result<RecordingLogcatCapture, AppError> {
    ensure_non_empty(serial, "serial", trace_id)?;
    ensure_non_empty(output_dir, "output_dir", trace_id)?;
    let output_path = build_local_recording_logcat_path(Path::new(output_dir), serial, timestamp);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::system(format!("Failed to create artifact dir: {err}"), trace_id)
        })?;
    }
    let output_file = fs::File::create(&output_path).map_err(|err| {
        AppError::system(
            format!("Failed to create logcat capture file: {err}"),
            trace_id,
        )
    })?;
    let args = build_recording_logcat_args(serial);
    let child = Command::new(adb_program)
        .args(&args)
        .stdout(Stdio::from(output_file))
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| {
            AppError::dependency(format!("Failed to start logcat capture: {err}"), trace_id)
        })?;

    Ok(RecordingLogcatCapture {
        child,
        output_path: output_path.to_string_lossy().to_string(),
    })
}

fn stop_recording_logcat_capture(
    mut capture: RecordingLogcatCapture,
    _trace_id: &str,
) -> RecordingLogcatCaptureResult {
    let error = match capture.child.try_wait() {
        Ok(Some(status)) if status.success() => None,
        Ok(Some(status)) => Some(format!(
            "Logcat capture exited before recording stopped: {status}"
        )),
        Ok(None) => {
            if let Err(err) = capture.child.kill() {
                Some(format!("Failed to stop logcat capture: {err}"))
            } else if let Err(err) = capture.child.wait() {
                Some(format!("Failed to wait for logcat capture: {err}"))
            } else {
                None
            }
        }
        Err(err) => Some(format!("Failed to inspect logcat capture: {err}")),
    };

    RecordingLogcatCaptureResult {
        output_path: capture.output_path,
        error,
    }
}

fn cleanup_failed_recording_artifact_dir(artifact_dir: &str, logcat_output_path: &str) {
    if !logcat_output_path.trim().is_empty() {
        let _ = fs::remove_file(logcat_output_path);
    }
    if !artifact_dir.trim().is_empty() {
        let _ = fs::remove_dir(artifact_dir);
    }
}

fn build_idle_screen_record_status(serial: String) -> ScreenRecordStatus {
    ScreenRecordStatus {
        serial,
        running: false,
        backend: ScreenRecordBackend::Adb,
        display_path: String::new(),
        segment_count: 0,
        artifact_dir: None,
        logcat_output_path: None,
        logcat_running: false,
        logcat_error: None,
        artifact_paths: Vec::new(),
    }
}

fn build_running_screen_record_status(
    serial: &str,
    handle: &RecordingHandle,
    logcat_capture: Option<&RecordingLogcatCapture>,
    trace_id: &str,
) -> Result<ScreenRecordStatus, AppError> {
    let logcat_output_path = logcat_capture.map(|capture| capture.output_path.clone());
    let logcat_running = logcat_capture.is_some();
    match handle {
        RecordingHandle::Adb {
            remote_path,
            artifact_dir,
            ..
        } => Ok(ScreenRecordStatus {
            serial: serial.to_string(),
            running: true,
            backend: ScreenRecordBackend::Adb,
            display_path: remote_path.clone(),
            segment_count: 1,
            artifact_dir: Some(artifact_dir.clone()),
            logcat_output_path,
            logcat_running,
            logcat_error: None,
            artifact_paths: Vec::new(),
        }),
        RecordingHandle::Scrcpy {
            output_path,
            artifact_dir,
            ..
        } => Ok(ScreenRecordStatus {
            serial: serial.to_string(),
            running: true,
            backend: ScreenRecordBackend::Scrcpy,
            display_path: output_path.clone(),
            segment_count: 1,
            artifact_dir: Some(artifact_dir.clone()),
            logcat_output_path,
            logcat_running,
            logcat_error: None,
            artifact_paths: Vec::new(),
        }),
        RecordingHandle::AdbSegmented {
            shared,
            artifact_dir,
            ..
        } => {
            let guard = shared
                .lock()
                .map_err(|_| AppError::system("Recording registry locked", trace_id))?;
            Ok(ScreenRecordStatus {
                serial: serial.to_string(),
                running: !guard.completed,
                backend: ScreenRecordBackend::AdbSegmented,
                display_path: guard
                    .current_remote_path
                    .clone()
                    .or_else(|| guard.completed_remote_paths.last().cloned())
                    .unwrap_or_default(),
                segment_count: guard.completed_remote_paths.len()
                    + usize::from(guard.current_remote_path.is_some()),
                artifact_dir: Some(artifact_dir.clone()),
                logcat_output_path,
                logcat_running,
                logcat_error: None,
                artifact_paths: Vec::new(),
            })
        }
    }
}

fn recording_handle_is_finished(
    handle: &mut RecordingHandle,
    trace_id: &str,
) -> Result<bool, AppError> {
    match handle {
        RecordingHandle::Adb { child, .. } | RecordingHandle::Scrcpy { child, .. } => {
            match child.try_wait() {
                Ok(Some(_)) => Ok(true),
                Ok(None) => Ok(false),
                Err(err) => Err(AppError::system(
                    format!("Failed to inspect recording process: {err}"),
                    trace_id,
                )),
            }
        }
        RecordingHandle::AdbSegmented { shared, .. } => shared
            .lock()
            .map(|guard| guard.completed)
            .map_err(|_| AppError::system("Recording registry locked", trace_id)),
    }
}

fn finalize_recording_handle(
    serial: &str,
    adb_program: &str,
    handle: RecordingHandle,
    _output_dir: Option<String>,
    trace_id: &str,
) -> Result<ScreenRecordStopResult, AppError> {
    match handle {
        RecordingHandle::Adb {
            remote_path,
            artifact_dir,
            ..
        } => {
            let filename = PathBuf::from(&remote_path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("screenrecord_{}.mp4", serial));
            fs::create_dir_all(&artifact_dir).map_err(|err| {
                AppError::system(format!("Failed to create artifact dir: {err}"), trace_id)
            })?;
            let local_path = PathBuf::from(&artifact_dir).join(filename);
            pull_screen_record_file(adb_program, serial, &remote_path, &local_path, trace_id)?;
            let output_path = local_path.to_string_lossy().to_string();
            Ok(ScreenRecordStopResult {
                serial: serial.to_string(),
                backend: ScreenRecordBackend::Adb,
                output_path: output_path.clone(),
                output_paths: vec![output_path.clone()],
                segment_count: 1,
                artifact_dir: Some(artifact_dir),
                logcat_output_path: None,
                logcat_error: None,
                artifact_paths: vec![output_path],
            })
        }
        RecordingHandle::Scrcpy {
            output_path,
            artifact_dir,
            ..
        } => {
            let final_path = move_recording_file_to_output_dir(
                &output_path,
                Some(artifact_dir.clone()),
                trace_id,
            )?;
            Ok(ScreenRecordStopResult {
                serial: serial.to_string(),
                backend: ScreenRecordBackend::Scrcpy,
                output_path: final_path.clone(),
                output_paths: vec![final_path.clone()],
                segment_count: 1,
                artifact_dir: Some(artifact_dir),
                logcat_output_path: None,
                logcat_error: None,
                artifact_paths: vec![final_path],
            })
        }
        RecordingHandle::AdbSegmented {
            shared,
            artifact_dir,
            join,
            ..
        } => {
            let _ = join.join();
            let shared = shared
                .lock()
                .map_err(|_| AppError::system("Recording registry locked", trace_id))?;
            if let Some(error) = shared.error.as_ref() {
                return Err(AppError::system(error.clone(), trace_id));
            }
            fs::create_dir_all(&artifact_dir).map_err(|err| {
                AppError::system(format!("Failed to create artifact dir: {err}"), trace_id)
            })?;
            let mut output_paths = Vec::with_capacity(shared.completed_remote_paths.len());
            for remote_path in &shared.completed_remote_paths {
                let filename = PathBuf::from(remote_path)
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("screenrecord_{}.mp4", serial));
                let local_path = PathBuf::from(&artifact_dir).join(filename);
                pull_screen_record_file(adb_program, serial, remote_path, &local_path, trace_id)?;
                output_paths.push(local_path.to_string_lossy().to_string());
            }
            let output_path = if output_paths.len() <= 1 {
                output_paths.first().cloned().unwrap_or_default()
            } else {
                artifact_dir.clone()
            };
            let artifact_paths = output_paths.clone();
            Ok(ScreenRecordStopResult {
                serial: serial.to_string(),
                backend: ScreenRecordBackend::AdbSegmented,
                output_path,
                output_paths,
                segment_count: shared.completed_remote_paths.len(),
                artifact_dir: Some(artifact_dir),
                logcat_output_path: None,
                logcat_error: None,
                artifact_paths,
            })
        }
    }
}

fn stop_recording_handle(
    serial: &str,
    adb_program: &str,
    handle: RecordingHandle,
    output_dir: Option<String>,
    trace_id: &str,
) -> Result<ScreenRecordStopResult, AppError> {
    match handle {
        RecordingHandle::Adb {
            mut child,
            remote_path,
            artifact_dir,
        } => {
            send_remote_screenrecord_sigint(adb_program, serial);
            wait_for_child_exit(&mut child, Duration::from_secs(5), "screenrecord", trace_id)?;
            finalize_recording_handle(
                serial,
                adb_program,
                RecordingHandle::Adb {
                    child,
                    remote_path,
                    artifact_dir,
                },
                output_dir,
                trace_id,
            )
        }
        RecordingHandle::Scrcpy {
            mut child,
            output_path,
            artifact_dir,
        } => {
            interrupt_local_child(&mut child);
            wait_for_child_exit(&mut child, Duration::from_secs(5), "scrcpy", trace_id)?;
            finalize_recording_handle(
                serial,
                adb_program,
                RecordingHandle::Scrcpy {
                    child,
                    output_path,
                    artifact_dir,
                },
                output_dir,
                trace_id,
            )
        }
        RecordingHandle::AdbSegmented {
            stop_flag,
            shared,
            join,
            artifact_dir,
        } => {
            stop_flag.store(true, Ordering::Relaxed);
            send_remote_screenrecord_sigint(adb_program, serial);
            finalize_recording_handle(
                serial,
                adb_program,
                RecordingHandle::AdbSegmented {
                    stop_flag,
                    shared,
                    join,
                    artifact_dir,
                },
                output_dir,
                trace_id,
            )
        }
    }
}

fn finalize_recording_session(
    serial: &str,
    adb_program: &str,
    session: RecordingSession,
    output_dir: Option<String>,
    trace_id: &str,
) -> Result<ScreenRecordStopResult, AppError> {
    let recording_result =
        finalize_recording_handle(serial, adb_program, session.recording, output_dir, trace_id);
    let logcat_result = session
        .logcat_capture
        .map(|capture| stop_recording_logcat_capture(capture, trace_id));
    recording_result.map(|result| attach_logcat_capture_to_stop_result(result, logcat_result))
}

fn stop_recording_session(
    serial: &str,
    adb_program: &str,
    session: RecordingSession,
    output_dir: Option<String>,
    trace_id: &str,
) -> Result<ScreenRecordStopResult, AppError> {
    let recording_result =
        stop_recording_handle(serial, adb_program, session.recording, output_dir, trace_id);
    let logcat_result = session
        .logcat_capture
        .map(|capture| stop_recording_logcat_capture(capture, trace_id));
    recording_result.map(|result| attach_logcat_capture_to_stop_result(result, logcat_result))
}

/// Best-effort kill of a recording session's child process(es) without the finalize/pull steps
/// (used on app shutdown, where pulling artifacts off the device may hang or is unwanted).
fn kill_recording_session(session: RecordingSession) {
    match session.recording {
        RecordingHandle::Adb { mut child, .. } | RecordingHandle::Scrcpy { mut child, .. } => {
            let _ = child.kill();
            let _ = child.wait();
        }
        RecordingHandle::AdbSegmented { stop_flag, .. } => {
            // Signal the segment loop to stop; do not join here so quitting stays responsive.
            stop_flag.store(true, Ordering::Relaxed);
        }
    }
    if let Some(mut capture) = session.logcat_capture {
        let _ = capture.child.kill();
        let _ = capture.child.wait();
    }
}

/// Tears down every spawned child process and monitor thread on app exit. Without this, closing
/// the window orphans long-lived `adb logcat` / `screenrecord` / `scrcpy` children and leaves the
/// device-tracker, perf/net pollers and terminal sessions running.
pub fn shutdown_all(state: &AppState) {
    // Long-lived capture children first (the ones most likely to orphan).
    if let Ok(mut map) = state.logcat_processes.lock() {
        for (_, handle) in map.drain() {
            handle.stop_flag.store(true, Ordering::Relaxed);
            let mut child = handle.child;
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut map) = state.ios_syslog_processes.lock() {
        for (_, handle) in map.drain() {
            handle.stop_flag.store(true, Ordering::Relaxed);
            let mut child = handle.child;
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut map) = state.recording_processes.lock() {
        for (_, session) in map.drain() {
            kill_recording_session(session);
        }
    }
    if let Ok(mut map) = state.bugreport_processes.lock() {
        for (_, handle) in map.drain() {
            handle.cancel_flag.store(true, Ordering::Relaxed);
            if let Ok(mut child_guard) = handle.child.lock() {
                if let Some(mut child) = child_guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
    if let Ok(mut map) = state.apk_install_processes.lock() {
        for (_, handle) in map.drain() {
            kill_apk_install_handle(&handle);
        }
    }
    // Monitor threads: signal stop; they own short-lived adb children and exit promptly.
    if let Ok(mut map) = state.perf_monitors.lock() {
        for (_, handle) in map.drain() {
            handle.stop_flag.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut map) = state.net_profilers.lock() {
        for (_, handle) in map.drain() {
            handle.stop_flag.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut map) = state.bluetooth_monitors.lock() {
        for (_, handle) in map.drain() {
            handle.stop();
        }
    }
    if let Ok(mut tracker) = state.device_tracker.lock() {
        if let Some(handle) = tracker.take() {
            handle.stop();
        }
    }
    if let Ok(mut map) = state.terminal_sessions.lock() {
        for (_, session) in map.drain() {
            session.stop();
        }
    }
}

fn stop_result_to_status(result: &ScreenRecordStopResult) -> ScreenRecordStatus {
    ScreenRecordStatus {
        serial: result.serial.clone(),
        running: false,
        backend: result.backend,
        display_path: if result.output_path.is_empty() {
            result.output_paths.first().cloned().unwrap_or_default()
        } else {
            result.output_path.clone()
        },
        segment_count: result.segment_count,
        artifact_dir: result.artifact_dir.clone(),
        logcat_output_path: result.logcat_output_path.clone(),
        logcat_running: false,
        logcat_error: result.logcat_error.clone(),
        artifact_paths: result.artifact_paths.clone(),
    }
}

fn spawn_segmented_recording_thread(
    adb_program: String,
    serial: String,
    settings: crate::app::config::ScreenRecordSettings,
    timestamp: String,
    trace_id: String,
    shared: Arc<std::sync::Mutex<SegmentedRecordingShared>>,
    stop_flag: Arc<AtomicBool>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut remaining = if settings.time_limit_sec > 0 {
            Some(settings.time_limit_sec as u32)
        } else {
            None
        };
        let mut segment_index = 0usize;

        loop {
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }
            let time_limit_sec = remaining
                .map(|value| value.min(MAX_ADB_SCREEN_RECORD_TIME_LIMIT_SEC))
                .unwrap_or(MAX_ADB_SCREEN_RECORD_TIME_LIMIT_SEC);
            let remote_path = build_remote_recording_path(&serial, &timestamp, Some(segment_index));
            if let Ok(mut guard) = shared.lock() {
                guard.current_remote_path = Some(remote_path.clone());
            }
            let args = build_adb_screen_record_args(
                &serial,
                &settings,
                &remote_path,
                Some(time_limit_sec),
            );
            let mut child = match Command::new(&adb_program)
                .args(&args)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(child) => child,
                Err(err) => {
                    if let Ok(mut guard) = shared.lock() {
                        guard.error = Some(format!("Failed to start screenrecord: {err}"));
                        guard.completed = true;
                        guard.current_remote_path = None;
                    }
                    return;
                }
            };

            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if !status.success() && !stop_flag.load(Ordering::Relaxed) {
                            if let Ok(mut guard) = shared.lock() {
                                guard.error =
                                    Some("Segmented screenrecord exited unexpectedly.".to_string());
                            }
                        }
                        break;
                    }
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                    Err(err) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        if let Ok(mut guard) = shared.lock() {
                            guard.error =
                                Some(format!("Failed to inspect screenrecord process: {err}"));
                        }
                        break;
                    }
                }
            }

            if let Ok(mut guard) = shared.lock() {
                guard.current_remote_path = None;
                guard.completed_remote_paths.push(remote_path);
            }

            if let Some(remaining_secs) = remaining.as_mut() {
                if *remaining_secs <= time_limit_sec {
                    break;
                }
                *remaining_secs -= time_limit_sec;
            }
            segment_index += 1;
        }

        if let Ok(mut guard) = shared.lock() {
            guard.completed = true;
            guard.current_remote_path = None;
        }

        info!(
            trace_id = %trace_id,
            serial = %serial,
            "segmented screenrecord thread finished"
        );
    })
}

#[tauri::command(async)]
pub fn start_screen_record(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<ScreenRecordStartResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let mut guard = state
        .recording_processes
        .lock()
        .map_err(|_| AppError::system("Recording registry locked", &trace_id))?;
    if guard.contains_key(&serial) {
        return Err(AppError::validation("Recording already active", &trace_id));
    }

    let config = load_config(&trace_id)?;
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let scrcpy_availability = check_scrcpy_availability();
    let backend = select_screen_record_backend(
        config.screen_record.time_limit_sec,
        scrcpy_availability.available,
    );
    let output_root = resolve_screen_record_output_dir(
        Some(config.output_path.clone()),
        &config.output_path,
        &trace_id,
    )?;
    let artifact_dir =
        build_local_recording_artifact_dir(Path::new(&output_root), &serial, &timestamp);
    fs::create_dir_all(&artifact_dir).map_err(|err| {
        AppError::system(format!("Failed to create artifact dir: {err}"), &trace_id)
    })?;
    let artifact_dir = artifact_dir.to_string_lossy().to_string();
    let logcat_capture =
        start_recording_logcat_capture(&adb_program, &serial, &output_root, &timestamp, &trace_id)?;
    let logcat_output_path = Some(logcat_capture.output_path.clone());

    let recording_result: Result<(RecordingHandle, String), AppError> = match backend {
        ScreenRecordBackend::Adb => {
            let remote_path = build_remote_recording_path(&serial, &timestamp, None);
            let args =
                build_adb_screen_record_args(&serial, &config.screen_record, &remote_path, None);
            match Command::new(&adb_program)
                .args(&args)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(child) => Ok((
                    RecordingHandle::Adb {
                        child,
                        remote_path: remote_path.clone(),
                        artifact_dir: artifact_dir.clone(),
                    },
                    remote_path,
                )),
                Err(err) => Err(AppError::dependency(
                    format!("Failed to start screenrecord: {err}"),
                    &trace_id,
                )),
            }
        }
        ScreenRecordBackend::Scrcpy => {
            if !scrcpy_availability.available {
                Err(AppError::dependency("scrcpy is not available", &trace_id))
            } else {
                let output_path = build_local_recording_path(
                    Path::new(&output_root),
                    &serial,
                    &timestamp,
                    None,
                    "mp4",
                );
                let mut args = build_scrcpy_record_command(
                    &serial,
                    &config.scrcpy,
                    &config.screen_record,
                    scrcpy_availability.major_version,
                    &output_path.to_string_lossy(),
                    config.screen_record.time_limit_sec,
                );
                if !scrcpy_availability.command_path.trim().is_empty() {
                    args[0] = scrcpy_availability.command_path;
                }
                let mut iter = args.into_iter();
                let command_path = iter.next().unwrap_or_else(|| "scrcpy".to_string());
                match Command::new(command_path)
                    .args(iter)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                {
                    Ok(child) => {
                        let output_path = output_path.to_string_lossy().to_string();
                        Ok((
                            RecordingHandle::Scrcpy {
                                child,
                                output_path: output_path.clone(),
                                artifact_dir: artifact_dir.clone(),
                            },
                            output_path,
                        ))
                    }
                    Err(err) => Err(AppError::dependency(
                        format!("Failed to start scrcpy recording: {err}"),
                        &trace_id,
                    )),
                }
            }
        }
        ScreenRecordBackend::AdbSegmented => {
            let shared = Arc::new(std::sync::Mutex::new(SegmentedRecordingShared {
                current_remote_path: None,
                completed_remote_paths: Vec::new(),
                completed: false,
                error: None,
            }));
            let stop_flag = Arc::new(AtomicBool::new(false));
            let join = spawn_segmented_recording_thread(
                adb_program.clone(),
                serial.clone(),
                config.screen_record.clone(),
                timestamp.clone(),
                trace_id.clone(),
                Arc::clone(&shared),
                Arc::clone(&stop_flag),
            );
            let display_path = build_remote_recording_path(&serial, &timestamp, Some(0));
            Ok((
                RecordingHandle::AdbSegmented {
                    stop_flag,
                    shared,
                    join,
                    artifact_dir: artifact_dir.clone(),
                },
                display_path,
            ))
        }
    };

    let (handle, display_path) = match recording_result {
        Ok(result) => result,
        Err(err) => {
            let logcat_output_path = logcat_capture.output_path.clone();
            let _ = stop_recording_logcat_capture(logcat_capture, &trace_id);
            cleanup_failed_recording_artifact_dir(&artifact_dir, &logcat_output_path);
            return Err(err);
        }
    };

    guard.insert(
        serial.clone(),
        RecordingSession {
            recording: handle,
            logcat_capture: Some(logcat_capture),
        },
    );

    Ok(CommandResponse {
        trace_id,
        data: ScreenRecordStartResult {
            serial,
            backend,
            display_path,
            artifact_dir: Some(artifact_dir),
            logcat_output_path,
            logcat_running: true,
        },
    })
}

#[tauri::command(async)]
pub fn get_screen_record_status(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<ScreenRecordStatus>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let finished_handle = {
        let mut guard = state
            .recording_processes
            .lock()
            .map_err(|_| AppError::system("Recording registry locked", &trace_id))?;
        let should_finalize = match guard.get_mut(&serial) {
            Some(session) => recording_handle_is_finished(&mut session.recording, &trace_id)?,
            None => false,
        };
        if should_finalize {
            guard.remove(&serial)
        } else {
            None
        }
    };

    if let Some(session) = finished_handle {
        let result = finalize_recording_session(&serial, &adb_program, session, None, &trace_id)?;
        return Ok(CommandResponse {
            trace_id,
            data: stop_result_to_status(&result),
        });
    }

    let guard = state
        .recording_processes
        .lock()
        .map_err(|_| AppError::system("Recording registry locked", &trace_id))?;
    let status = match guard.get(&serial) {
        Some(session) => build_running_screen_record_status(
            &serial,
            &session.recording,
            session.logcat_capture.as_ref(),
            &trace_id,
        )?,
        None => build_idle_screen_record_status(serial),
    };

    Ok(CommandResponse {
        trace_id,
        data: status,
    })
}

#[tauri::command(async)]
pub fn stop_screen_record(
    serial: String,
    output_dir: Option<String>,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<ScreenRecordStopResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let mut guard = state
        .recording_processes
        .lock()
        .map_err(|_| AppError::system("Recording registry locked", &trace_id))?;

    let session = match guard.remove(&serial) {
        Some(session) => session,
        None => return Err(AppError::validation("No recording in progress", &trace_id)),
    };
    drop(guard);

    let result = stop_recording_session(&serial, &adb_program, session, output_dir, &trace_id)?;

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

#[tauri::command(async)]
pub fn check_scrcpy(trace_id: Option<String>) -> Result<CommandResponse<ScrcpyInfo>, AppError> {
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

#[tauri::command(async)]
pub fn launch_scrcpy(
    serials: Vec<String>,
    state: State<'_, AppState>,
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
    let config = load_config(&trace_id)?;
    let scheduler = Arc::clone(&state.scheduler);

    let mut results = Vec::with_capacity(serials.len());
    for serial in serials {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let _permit = scheduler.acquire_global();
        let device_lock = scheduler.device_lock(&serial);
        let _device_guard = match device_lock.lock() {
            Ok(guard) => guard,
            Err(_) => {
                warn!(trace_id = %trace_id, serial = %serial, "device lock poisoned");
                results.push(CommandResult {
                    serial,
                    stdout: String::new(),
                    stderr: "Failed to access the device. Please try again.".to_string(),
                    exit_code: Some(1),
                });
                continue;
            }
        };
        let mut args = build_scrcpy_command(&serial, &config.scrcpy, availability.major_version);
        if !availability.command_path.trim().is_empty() {
            args[0] = availability.command_path.clone();
        }
        let mut iter = args.into_iter();
        let command_path = iter.next().unwrap_or_else(|| "scrcpy".to_string());
        let mut command = Command::new(command_path);
        command
            .args(iter)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let spawn_result = command.spawn();
        match spawn_result {
            Ok(mut child) => {
                std::thread::sleep(Duration::from_millis(150));
                match child.try_wait() {
                    Ok(Some(_)) => match child.wait_with_output() {
                        Ok(output) => {
                            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                            let exit_code = output.status.code().unwrap_or(1);
                            let (final_exit, final_stderr) = if output.status.success() {
                                let detail = if !stderr.is_empty() {
                                    stderr
                                } else {
                                    stdout.clone()
                                };
                                let message = if detail.is_empty() {
                                    "scrcpy exited immediately".to_string()
                                } else {
                                    format!("scrcpy exited immediately: {detail}")
                                };
                                (1, message)
                            } else {
                                (exit_code, stderr)
                            };
                            if final_exit != 0 {
                                warn!(
                                    trace_id = %trace_id,
                                    serial = %serial,
                                    error = %final_stderr,
                                    "scrcpy exited immediately"
                                );
                            }
                            results.push(CommandResult {
                                serial,
                                stdout,
                                stderr: final_stderr,
                                exit_code: Some(final_exit),
                            });
                        }
                        Err(err) => results.push(CommandResult {
                            serial,
                            stdout: String::new(),
                            stderr: format!("Failed to capture scrcpy output: {err}"),
                            exit_code: Some(1),
                        }),
                    },
                    Ok(None) => results.push(CommandResult {
                        serial,
                        stdout: "scrcpy launched".to_string(),
                        stderr: String::new(),
                        exit_code: Some(0),
                    }),
                    Err(err) => results.push(CommandResult {
                        serial,
                        stdout: String::new(),
                        stderr: format!("Failed to check scrcpy status: {err}"),
                        exit_code: Some(1),
                    }),
                }
            }
            Err(err) => results.push(CommandResult {
                serial,
                stdout: String::new(),
                stderr: format!("Failed to launch scrcpy: {err}"),
                exit_code: Some(1),
            }),
        }
    }

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}

#[tauri::command(async)]
pub fn capture_ui_hierarchy(
    serial: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<UiHierarchyCaptureResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let config = load_config(&trace_id)?;
    let temp_dir = tempfile::tempdir()
        .map_err(|err| AppError::system(format!("Failed to prepare temp dir: {err}"), &trace_id))?;
    let xml_temp_path = temp_dir.path().join("ui_inspector.xml");
    let xml = capture_validated_ui_dump_xml(
        &adb_program,
        &serial,
        &xml_temp_path,
        "ui_inspector",
        &trace_id,
    )?;
    let html = render_device_ui_html(&xml)
        .map_err(|err| AppError::system(format!("Failed to render HTML: {err}"), &trace_id))?;
    let screenshot_temp_path = temp_dir.path().join("ui_inspector.png");
    let (screenshot_data_url, screenshot_error) = match capture_validated_screenshot_bytes(
        &adb_program,
        &serial,
        &config,
        &screenshot_temp_path,
        "ui_inspector",
        &trace_id,
    ) {
        Ok(bytes) => match png_bytes_to_data_url(&bytes) {
            Ok(url) => (Some(url), None),
            Err(message) => {
                warn!(trace_id = %trace_id, error = %message, "ui_inspector screenshot invalid");
                (None, Some("Please try again.".to_string()))
            }
        },
        Err(err) => {
            warn!(trace_id = %trace_id, error = %err.error, "ui_inspector screenshot failed");
            (None, Some("Please try again.".to_string()))
        }
    };

    Ok(CommandResponse {
        trace_id,
        data: UiHierarchyCaptureResult {
            html,
            xml,
            screenshot_data_url,
            screenshot_error,
        },
    })
}

#[tauri::command(async)]
pub fn export_ui_hierarchy(
    serial: String,
    output_dir: Option<String>,
    trace_id: Option<String>,
) -> Result<CommandResponse<UiHierarchyExportResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let config = load_config(&trace_id)?;
    let resolved_dir = output_dir
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if !config.file_gen_output_path.trim().is_empty() {
                config.file_gen_output_path.clone()
            } else {
                config.output_path.clone()
            }
        });
    ensure_non_empty(&resolved_dir, "output_dir", &trace_id)?;
    fs::create_dir_all(&resolved_dir).map_err(|err| {
        AppError::system(format!("Failed to create output dir: {err}"), &trace_id)
    })?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let base_bundle_name = build_ui_export_bundle_base_name(&serial, &timestamp);
    let resolved_parent = PathBuf::from(&resolved_dir);
    let bundle_dir = resolve_unique_ui_export_bundle_dir(&resolved_parent, &base_bundle_name);
    fs::create_dir_all(&bundle_dir).map_err(|err| {
        AppError::system(
            format!("Failed to create export bundle dir: {err}"),
            &trace_id,
        )
    })?;
    let xml_path = bundle_dir.join("hierarchy.xml");
    let html_path = bundle_dir.join("hierarchy.html");
    let screenshot_path = bundle_dir.join("screenshot.png");
    let xml =
        capture_validated_ui_dump_xml(&adb_program, &serial, &xml_path, "ui_export", &trace_id)?;
    let html = render_device_ui_html(&xml)
        .map_err(|err| AppError::system(format!("Failed to render HTML: {err}"), &trace_id))?;

    fs::write(&xml_path, &xml)
        .map_err(|err| AppError::system(format!("Failed to write XML: {err}"), &trace_id))?;
    fs::write(&html_path, html)
        .map_err(|err| AppError::system(format!("Failed to write HTML: {err}"), &trace_id))?;
    let screenshot_bytes = capture_validated_screenshot_bytes(
        &adb_program,
        &serial,
        &config,
        &screenshot_path,
        "ui_export",
        &trace_id,
    )?;
    write_png_file(&screenshot_path, &screenshot_bytes, &trace_id)?;

    Ok(CommandResponse {
        trace_id,
        data: UiHierarchyExportResult {
            serial,
            bundle_dir: bundle_dir.to_string_lossy().to_string(),
            xml_path: xml_path.to_string_lossy().to_string(),
            html_path: html_path.to_string_lossy().to_string(),
            screenshot_path: screenshot_path.to_string_lossy().to_string(),
        },
    })
}

pub(crate) fn validate_adb_server_action(action: &str) -> Result<&'static str, String> {
    match action.trim().to_ascii_lowercase().as_str() {
        "start" => Ok("start"),
        "kill" => Ok("kill"),
        "restart" => Ok("restart"),
        _ => Err("Invalid ADB server action. Expected start, kill, or restart.".to_string()),
    }
}

pub(crate) fn validate_logcat_buffer_size(size: &str) -> Result<&'static str, String> {
    match size.trim().to_ascii_uppercase().as_str() {
        "256K" => Ok("256K"),
        "1M" => Ok("1M"),
        "4M" => Ok("4M"),
        "8M" => Ok("8M"),
        "16M" => Ok("16M"),
        "32M" => Ok("32M"),
        "64M" => Ok("64M"),
        _ => Err(
            "Unsupported logcat buffer size. Allowed: 256K, 1M, 4M, 8M, 16M, 32M, 64M.".to_string(),
        ),
    }
}

#[tauri::command(async)]
pub fn adb_server_control(
    action: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<HostCommandResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let normalized =
        validate_adb_server_action(&action).map_err(|msg| AppError::validation(msg, &trace_id))?;
    let adb_program = get_adb_program(&trace_id)?;
    let timeout = Duration::from_secs(15);

    let result = match normalized {
        "start" => {
            let out = run_command_with_timeout(
                &adb_program,
                &["start-server".to_string()],
                timeout,
                &trace_id,
            )?;
            HostCommandResult {
                stdout: out.stdout,
                stderr: out.stderr,
                exit_code: out.exit_code,
            }
        }
        "kill" => {
            let out = run_command_with_timeout(
                &adb_program,
                &["kill-server".to_string()],
                timeout,
                &trace_id,
            )?;
            HostCommandResult {
                stdout: out.stdout,
                stderr: out.stderr,
                exit_code: out.exit_code,
            }
        }
        "restart" => {
            let kill_out = run_command_with_timeout(
                &adb_program,
                &["kill-server".to_string()],
                timeout,
                &trace_id,
            )?;
            let start_out = run_command_with_timeout(
                &adb_program,
                &["start-server".to_string()],
                timeout,
                &trace_id,
            )?;
            HostCommandResult {
                stdout: format!("{}\n{}", kill_out.stdout.trim(), start_out.stdout.trim())
                    .trim()
                    .to_string(),
                stderr: format!("{}\n{}", kill_out.stderr.trim(), start_out.stderr.trim())
                    .trim()
                    .to_string(),
                exit_code: start_out.exit_code,
            }
        }
        _ => unreachable!(),
    };

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

#[tauri::command(async)]
pub fn adb_root_devices(
    serials: Vec<String>,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }
    let adb_program = get_adb_program(&trace_id)?;
    let scheduler = Arc::clone(&state.scheduler);
    let mut results = Vec::with_capacity(serials.len());

    for serial in serials {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let _permit = scheduler.acquire_global();
        let device_lock = scheduler.device_lock(&serial);
        let _guard = device_lock
            .lock()
            .map_err(|_| AppError::system("Device lock poisoned", &trace_id))?;
        let args = vec!["-s".to_string(), serial.clone(), "root".to_string()];
        let out =
            run_command_with_timeout(&adb_program, &args, Duration::from_secs(20), &trace_id)?;
        results.push(CommandResult {
            serial,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        });
    }

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}

#[tauri::command(async)]
pub fn set_logcat_buffer_size(
    serials: Vec<String>,
    size: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }
    let normalized_size =
        validate_logcat_buffer_size(&size).map_err(|msg| AppError::validation(msg, &trace_id))?;
    let adb_program = get_adb_program(&trace_id)?;
    let scheduler = Arc::clone(&state.scheduler);
    let mut results = Vec::with_capacity(serials.len());

    for serial in serials {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let _permit = scheduler.acquire_global();
        let device_lock = scheduler.device_lock(&serial);
        let _guard = device_lock
            .lock()
            .map_err(|_| AppError::system("Device lock poisoned", &trace_id))?;
        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "logcat".to_string(),
            "-b".to_string(),
            "main".to_string(),
            "-G".to_string(),
            normalized_size.to_string(),
        ];
        let out =
            run_command_with_timeout(&adb_program, &args, Duration::from_secs(15), &trace_id)?;
        results.push(CommandResult {
            serial,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        });
    }

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}

#[tauri::command(async)]
pub fn pull_device_dcim_batch(
    serials: Vec<String>,
    output_dir: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }
    ensure_non_empty(&output_dir, "output_dir", &trace_id)?;
    let base_dir = PathBuf::from(output_dir.trim());
    fs::create_dir_all(&base_dir).map_err(|err| {
        AppError::system(
            format!("Failed to prepare output directory: {err}"),
            &trace_id,
        )
    })?;

    let adb_program = get_adb_program(&trace_id)?;
    let scheduler = Arc::clone(&state.scheduler);
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let mut results = Vec::with_capacity(serials.len());

    for serial in serials {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let safe_serial = sanitize_filename_component(&serial);
        let dest_dir = base_dir.join(format!("{safe_serial}_dcim_{timestamp}"));
        fs::create_dir_all(&dest_dir).map_err(|err| {
            AppError::system(
                format!("Failed to create DCIM output dir: {err}"),
                &trace_id,
            )
        })?;
        let dest_str = dest_dir.to_string_lossy().to_string();

        let _permit = scheduler.acquire_global();
        let device_lock = scheduler.device_lock(&serial);
        let _guard = device_lock
            .lock()
            .map_err(|_| AppError::system("Device lock poisoned", &trace_id))?;
        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "pull".to_string(),
            "/sdcard/DCIM".to_string(),
            dest_str.clone(),
        ];
        let out =
            run_command_with_timeout(&adb_program, &args, Duration::from_secs(300), &trace_id)?;
        let stdout = if out.exit_code == Some(0) {
            format!("{dest_str}\n{}", out.stdout.trim())
                .trim()
                .to_string()
        } else {
            out.stdout
        };
        results.push(CommandResult {
            serial,
            stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        });
    }

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}

#[tauri::command(async)]
pub fn export_discovery_service_dump(
    serials: Vec<String>,
    output_dir: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<CommandResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", &trace_id));
    }
    ensure_non_empty(&output_dir, "output_dir", &trace_id)?;
    let base_dir = PathBuf::from(output_dir.trim());
    fs::create_dir_all(&base_dir).map_err(|err| {
        AppError::system(
            format!("Failed to prepare output directory: {err}"),
            &trace_id,
        )
    })?;

    let adb_program = get_adb_program(&trace_id)?;
    let scheduler = Arc::clone(&state.scheduler);
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let mut results = Vec::with_capacity(serials.len());

    for serial in serials {
        ensure_non_empty(&serial, "serial", &trace_id)?;
        let _permit = scheduler.acquire_global();
        let device_lock = scheduler.device_lock(&serial);
        let _guard = device_lock
            .lock()
            .map_err(|_| AppError::system("Device lock poisoned", &trace_id))?;
        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "dumpsys".to_string(),
            "activity".to_string(),
            "service".to_string(),
            "DiscoveryService".to_string(),
        ];
        let out =
            run_command_with_timeout(&adb_program, &args, Duration::from_secs(30), &trace_id)?;
        if out.exit_code == Some(0) {
            let safe_serial = sanitize_filename_component(&serial);
            let out_file = base_dir.join(format!("{safe_serial}_discovery_{timestamp}.txt"));
            fs::write(&out_file, &out.stdout).map_err(|err| {
                AppError::system(
                    format!("Failed to write DiscoveryService dump: {err}"),
                    &trace_id,
                )
            })?;
            results.push(CommandResult {
                serial,
                stdout: out_file.to_string_lossy().to_string(),
                stderr: out.stderr,
                exit_code: out.exit_code,
            });
        } else {
            results.push(CommandResult {
                serial,
                stdout: out.stdout,
                stderr: out.stderr,
                exit_code: out.exit_code,
            });
        }
    }

    Ok(CommandResponse {
        trace_id,
        data: results,
    })
}
