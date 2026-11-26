use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Emitter, State};
use tracing::warn;

use crate::app::adb::bugreport::{parse_bugreportz_line, BugreportzPayload};
use crate::app::adb::paths::sanitize_filename_component;
use crate::app::adb::runner::{new_background_command, run_adb, run_command_with_timeout};
use crate::app::bugreport_extract;
use crate::app::bugreport_logcat;
use crate::app::error::AppError;
use crate::app::models::{
    BugreportExtractIndexSummary, BugreportExtractQuery, BugreportExtractResult,
    BugreportLogAroundPage, BugreportLogFilters, BugreportLogPage, BugreportLogSearchResult,
    BugreportLogSummary, BugreportResult, CommandResponse,
};
use crate::app::state::{AppState, BugreportHandle};

use super::{ensure_non_empty, get_adb_program, resolve_trace_id};

pub(super) type BugreportChildHolder = Arc<std::sync::Mutex<Option<std::process::Child>>>;
pub(super) type BugreportReservation = (Arc<AtomicBool>, BugreportChildHolder);

pub(super) fn reserve_bugreport_handle(
    serial: &str,
    state: &AppState,
    trace_id: &str,
) -> Result<BugreportReservation, AppError> {
    ensure_non_empty(serial, "serial", trace_id)?;

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let child: BugreportChildHolder = Arc::new(std::sync::Mutex::new(None));

    let mut guard = state
        .bugreport_processes
        .lock()
        .map_err(|_| AppError::system("Bugreport registry locked", trace_id))?;
    if guard.contains_key(serial) {
        return Err(AppError::validation("Bugreport already running", trace_id));
    }
    guard.insert(
        serial.to_string(),
        BugreportHandle {
            cancel_flag: Arc::clone(&cancel_flag),
            child: Arc::clone(&child),
        },
    );

    Ok((cancel_flag, child))
}

pub(super) fn validate_generate_bugreport_inputs(
    serial: &str,
    output_dir: &str,
    trace_id: &str,
) -> Result<(), AppError> {
    ensure_non_empty(serial, "serial", trace_id)?;
    ensure_non_empty(output_dir, "output_dir", trace_id)?;
    Ok(())
}

fn load_device_model_for_bugreport_filename(
    adb_program: &str,
    serial: &str,
    trace_id: &str,
) -> Option<String> {
    let args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "getprop".to_string(),
        "ro.product.model".to_string(),
    ];
    match run_command_with_timeout(adb_program, &args, Duration::from_secs(5), trace_id) {
        Ok(output) => {
            if output.exit_code.unwrap_or_default() != 0 {
                warn!(
                    trace_id = %trace_id,
                    serial = %serial,
                    exit_code = ?output.exit_code,
                    "Failed to fetch device model for bugreport filename"
                );
                return None;
            }
            let model = output.stdout.trim();
            if model.is_empty() {
                None
            } else {
                Some(model.to_string())
            }
        }
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                serial = %serial,
                code = %err.code,
                "Failed to fetch device model for bugreport filename"
            );
            None
        }
    }
}

pub(super) fn build_bugreport_filename(
    serial: &str,
    device_model: Option<&str>,
    timestamp: &str,
) -> String {
    let safe_serial = sanitize_filename_component(serial);
    let safe_device_name = device_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitize_filename_component)
        .unwrap_or_else(|| safe_serial.clone());
    format!("bugreport_{safe_device_name}_{safe_serial}_{timestamp}.zip")
}

#[tauri::command(async)]
pub fn generate_bugreport(
    serial: String,
    output_dir: String,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<BugreportResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    validate_generate_bugreport_inputs(&serial, &output_dir, &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    fs::create_dir_all(&output_dir).map_err(|err| {
        AppError::system(format!("Failed to create output dir: {err}"), &trace_id)
    })?;
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let device_model = load_device_model_for_bugreport_filename(&adb_program, &serial, &trace_id);
    let filename = build_bugreport_filename(&serial, device_model.as_deref(), &timestamp);
    let output_path = PathBuf::from(output_dir).join(filename);

    let (cancel_flag, child) = reserve_bugreport_handle(&serial, &state, &trace_id)?;

    let mut result = BugreportResult {
        serial: serial.clone(),
        success: false,
        output_path: None,
        error: None,
        stream_supported: false,
        progress: None,
    };

    let stream_result =
        run_bugreport_streaming(&adb_program, &serial, &app, &trace_id, &cancel_flag, &child);

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
            let pull =
                run_command_with_timeout(&adb_program, &args, Duration::from_secs(300), &trace_id)?;
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
        let output = run_adb(&adb_program, &args, &trace_id)?;
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

#[tauri::command(async)]
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

pub(super) fn prepare_bugreport_logcat_inner(
    source_path: &str,
    trace_id: &str,
) -> Result<BugreportLogSummary, AppError> {
    ensure_non_empty(source_path, "source_path", trace_id)?;
    let path = PathBuf::from(source_path);
    bugreport_logcat::prepare_bugreport_logcat(&path, trace_id)
        .map_err(|err| AppError::system(err, trace_id))
}

#[tauri::command(async)]
pub async fn prepare_bugreport_logcat(
    source_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<BugreportLogSummary>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let trace_for_worker = trace_id.clone();
    let source_for_worker = source_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        prepare_bugreport_logcat_inner(&source_for_worker, &trace_for_worker)
    })
    .await
    .map_err(|_| AppError::system("Bugreport log index thread failed", &trace_id))??;

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

pub(super) fn prepare_bugreport_extract_index_inner(
    source_path: &str,
    trace_id: &str,
) -> Result<BugreportExtractIndexSummary, AppError> {
    ensure_non_empty(source_path, "source_path", trace_id)?;
    let path = PathBuf::from(source_path);
    bugreport_extract::prepare_bugreport_extract_index(&path, trace_id)
        .map_err(|err| AppError::system(err, trace_id))
}

#[tauri::command(async)]
pub async fn prepare_bugreport_extract_index(
    source_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<BugreportExtractIndexSummary>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let trace_for_worker = trace_id.clone();
    let source_for_worker = source_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        prepare_bugreport_extract_index_inner(&source_for_worker, &trace_for_worker)
    })
    .await
    .map_err(|_| AppError::system("Bugreport extract index thread failed", &trace_id))??;

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

pub(super) fn query_bugreport_extract_inner(
    report_id: &str,
    query: BugreportExtractQuery,
    trace_id: &str,
) -> Result<BugreportExtractResult, AppError> {
    ensure_non_empty(report_id, "report_id", trace_id)?;
    bugreport_extract::query_bugreport_extract(report_id, query)
        .map_err(|err| map_bugreport_extract_query_error(err, trace_id))
}

#[tauri::command(async)]
pub async fn query_bugreport_extract(
    report_id: String,
    query: BugreportExtractQuery,
    trace_id: Option<String>,
) -> Result<CommandResponse<BugreportExtractResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let trace_for_worker = trace_id.clone();
    let report_for_worker = report_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        query_bugreport_extract_inner(&report_for_worker, query, &trace_for_worker)
    })
    .await
    .map_err(|_| AppError::system("Bugreport extract query thread failed", &trace_id))??;

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

#[tauri::command(async)]
pub async fn query_bugreport_logcat(
    report_id: String,
    filters: BugreportLogFilters,
    offset: Option<usize>,
    limit: Option<usize>,
    trace_id: Option<String>,
) -> Result<CommandResponse<BugreportLogPage>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&report_id, "report_id", &trace_id)?;
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(0);

    let result = tauri::async_runtime::spawn_blocking(move || {
        bugreport_logcat::query_bugreport_logcat(&report_id, filters, offset, limit)
    })
    .await
    .map_err(|_| AppError::system("Bugreport log query thread failed", &trace_id))?
    .map_err(|err| map_bugreport_log_query_error(err, &trace_id))?;

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

pub(super) fn search_bugreport_logcat_inner(
    report_id: &str,
    query: &str,
    filters: BugreportLogFilters,
    limit: usize,
    trace_id: &str,
) -> Result<BugreportLogSearchResult, AppError> {
    ensure_non_empty(report_id, "report_id", trace_id)?;
    ensure_non_empty(query, "query", trace_id)?;
    bugreport_logcat::search_bugreport_logcat(report_id, query, filters, limit)
        .map_err(|err| map_bugreport_log_query_error(err, trace_id))
}

#[tauri::command(async)]
pub async fn search_bugreport_logcat(
    report_id: String,
    query: String,
    filters: BugreportLogFilters,
    limit: Option<usize>,
    trace_id: Option<String>,
) -> Result<CommandResponse<BugreportLogSearchResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let limit = limit.unwrap_or(0);
    let trace_for_worker = trace_id.clone();
    let report_for_worker = report_id.clone();
    let query_for_worker = query.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        search_bugreport_logcat_inner(
            &report_for_worker,
            &query_for_worker,
            filters,
            limit,
            &trace_for_worker,
        )
    })
    .await
    .map_err(|_| AppError::system("Bugreport log search thread failed", &trace_id))??;

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

pub(super) fn query_bugreport_logcat_around_inner(
    report_id: &str,
    anchor_id: i64,
    before: usize,
    after: usize,
    filters: BugreportLogFilters,
    trace_id: &str,
) -> Result<BugreportLogAroundPage, AppError> {
    ensure_non_empty(report_id, "report_id", trace_id)?;
    if anchor_id <= 0 {
        return Err(AppError::validation(
            "anchor_id must be a positive integer",
            trace_id,
        ));
    }
    bugreport_logcat::query_bugreport_logcat_around(report_id, anchor_id, before, after, filters)
        .map_err(|err| map_bugreport_log_query_error(err, trace_id))
}

#[tauri::command(async)]
pub async fn query_bugreport_logcat_around(
    report_id: String,
    anchor_id: i64,
    before: Option<usize>,
    after: Option<usize>,
    filters: BugreportLogFilters,
    trace_id: Option<String>,
) -> Result<CommandResponse<BugreportLogAroundPage>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let before = before.unwrap_or(200);
    let after = after.unwrap_or(200);
    let trace_for_worker = trace_id.clone();
    let report_for_worker = report_id.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        query_bugreport_logcat_around_inner(
            &report_for_worker,
            anchor_id,
            before,
            after,
            filters,
            &trace_for_worker,
        )
    })
    .await
    .map_err(|_| AppError::system("Bugreport log around thread failed", &trace_id))??;

    Ok(CommandResponse {
        trace_id,
        data: result,
    })
}

pub(super) fn map_bugreport_log_query_error(err: String, trace_id: &str) -> AppError {
    if let Some(message) = err.strip_prefix("VALIDATION:") {
        return AppError::validation(message.trim(), trace_id);
    }
    AppError::system(err, trace_id)
}

pub(super) fn map_bugreport_extract_query_error(err: String, trace_id: &str) -> AppError {
    if let Some(message) = err.strip_prefix("VALIDATION:") {
        return AppError::validation(message.trim(), trace_id);
    }
    AppError::system(err, trace_id)
}

fn run_bugreport_streaming(
    adb_program: &str,
    serial: &str,
    app: &AppHandle,
    trace_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    child_holder: &Arc<std::sync::Mutex<Option<std::process::Child>>>,
) -> Result<Option<String>, String> {
    let child = new_background_command(adb_program)
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
        let child = guard
            .as_mut()
            .ok_or_else(|| "Bugreport process missing".to_string())?;
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
