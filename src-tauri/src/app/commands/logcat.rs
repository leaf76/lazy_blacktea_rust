use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use tauri::{AppHandle, Emitter, State};
use tracing::warn;

use crate::app::adb::runner::run_adb;
use crate::app::config::load_config;
use crate::app::error::AppError;
use crate::app::models::{CommandResponse, LegacyLogcatPreset, LogcatExportResult, LogcatStatus};
use crate::app::state::{AppState, LogcatHandle};

use super::{ensure_non_empty, get_adb_program, resolve_trace_id};

pub(super) type LogcatEmitter = Arc<dyn Fn(LogcatEvent) + Send + Sync>;

#[derive(Clone, serde::Serialize)]
pub struct LogcatEvent {
    pub serial: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<String>,
    pub trace_id: String,
}

pub(super) fn start_logcat_inner(
    serial: String,
    filter: Option<String>,
    adb_program: &str,
    registry: &Mutex<HashMap<String, LogcatHandle>>,
    emitter: LogcatEmitter,
    trace_id: &str,
    spawn_logcat: impl FnOnce(&str, &str, Option<&str>, &str) -> Result<std::process::Child, AppError>,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let mut guard = registry
        .lock()
        .map_err(|_| AppError::system("Logcat registry locked", trace_id))?;
    let existing_running = if let Some(handle) = guard.get_mut(&serial) {
        match handle.child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => false,
            Err(err) => {
                return Err(AppError::system(
                    format!("Failed to inspect logcat process: {err}"),
                    trace_id,
                ))
            }
        }
    } else {
        false
    };
    if existing_running {
        return Ok(true);
    }
    if let Some(mut stale) = guard.remove(&serial) {
        stale.stop_flag.store(true, Ordering::Relaxed);
        let _ = stale.child.kill();
        let _ = stale.child.wait();
    }

    let mut child = spawn_logcat(
        adb_program,
        &serial,
        filter.as_deref().filter(|value| !value.trim().is_empty()),
        trace_id,
    )?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::system("Failed to capture logcat stdout", trace_id))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::system("Failed to capture logcat stderr", trace_id))?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_stdout = Arc::clone(&stop_flag);
    let stop_flag_stderr = Arc::clone(&stop_flag);

    let batch_limit = 50usize;
    let batch_delay = Duration::from_millis(60);

    let emitter_stdout = Arc::clone(&emitter);
    let serial_stdout = serial.clone();
    let trace_stdout = trace_id.to_string();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut pending: Vec<String> = Vec::new();
        let mut last_emit = Instant::now();
        for line_result in reader.lines() {
            if stop_flag_stdout.load(Ordering::Relaxed) {
                break;
            }
            let line = match line_result {
                Ok(line) => line,
                Err(err) => {
                    warn!(trace_id = %trace_stdout, error = %err, "failed to read logcat stdout");
                    break;
                }
            };
            pending.push(line);
            if pending.len() >= batch_limit || last_emit.elapsed() >= batch_delay {
                let batch = std::mem::take(&mut pending);
                (emitter_stdout)(LogcatEvent {
                    serial: serial_stdout.clone(),
                    line: None,
                    lines: batch,
                    trace_id: trace_stdout.clone(),
                });
                last_emit = Instant::now();
            }
        }
        if !pending.is_empty() {
            (emitter_stdout)(LogcatEvent {
                serial: serial_stdout,
                line: None,
                lines: pending,
                trace_id: trace_stdout,
            });
        }
    });

    let emitter_stderr = Arc::clone(&emitter);
    let serial_stderr = serial.clone();
    let trace_stderr = trace_id.to_string();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        let mut pending: Vec<String> = Vec::new();
        let mut last_emit = Instant::now();
        for line_result in reader.lines() {
            if stop_flag_stderr.load(Ordering::Relaxed) {
                break;
            }
            let line = match line_result {
                Ok(line) => line,
                Err(err) => {
                    warn!(trace_id = %trace_stderr, error = %err, "failed to read logcat stderr");
                    break;
                }
            };
            pending.push(format!("STDERR: {line}"));
            if pending.len() >= batch_limit || last_emit.elapsed() >= batch_delay {
                let batch = std::mem::take(&mut pending);
                (emitter_stderr)(LogcatEvent {
                    serial: serial_stderr.clone(),
                    line: None,
                    lines: batch,
                    trace_id: trace_stderr.clone(),
                });
                last_emit = Instant::now();
            }
        }
        if !pending.is_empty() {
            (emitter_stderr)(LogcatEvent {
                serial: serial_stderr,
                line: None,
                lines: pending,
                trace_id: trace_stderr,
            });
        }
    });

    guard.insert(serial, LogcatHandle { child, stop_flag });
    Ok(true)
}

pub(super) fn stop_logcat_inner(
    serial: String,
    registry: &Mutex<HashMap<String, LogcatHandle>>,
    trace_id: &str,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let mut guard = registry
        .lock()
        .map_err(|_| AppError::system("Logcat registry locked", trace_id))?;
    let mut handle = match guard.remove(&serial) {
        Some(handle) => handle,
        None => return Ok(true),
    };
    handle.stop_flag.store(true, Ordering::Relaxed);
    let _ = handle.child.kill();
    let _ = handle.child.wait();
    Ok(true)
}

pub(super) fn get_logcat_status_inner(
    serial: String,
    registry: &Mutex<HashMap<String, LogcatHandle>>,
    trace_id: &str,
) -> Result<LogcatStatus, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let mut guard = registry
        .lock()
        .map_err(|_| AppError::system("Logcat registry locked", trace_id))?;

    let running = if let Some(handle) = guard.get_mut(&serial) {
        match handle.child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => false,
            Err(err) => {
                return Err(AppError::system(
                    format!("Failed to inspect logcat process: {err}"),
                    trace_id,
                ))
            }
        }
    } else {
        false
    };

    if !running {
        if let Some(mut stale) = guard.remove(&serial) {
            stale.stop_flag.store(true, Ordering::Relaxed);
            let _ = stale.child.kill();
            let _ = stale.child.wait();
        }
    }

    Ok(LogcatStatus { serial, running })
}

// Smoke helpers: these allow macOS-friendly "real device" checks without needing a Tauri AppHandle.
// They intentionally reuse the same registries and inner logic as the Tauri commands.
pub fn smoke_start_logcat_stream(
    serial: String,
    filter: Option<String>,
    adb_program: &str,
    registry: &Mutex<HashMap<String, LogcatHandle>>,
    emitter: Arc<dyn Fn(LogcatEvent) + Send + Sync>,
    trace_id: &str,
) -> Result<bool, AppError> {
    start_logcat_inner(
        serial,
        filter,
        adb_program,
        registry,
        emitter,
        trace_id,
        |program, serial, filter, trace_id| {
            let mut cmd = Command::new(program);
            cmd.args(["-s", serial, "logcat"]);
            if let Some(filter) = filter {
                cmd.args(filter.split_whitespace());
            }
            cmd.stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|err| {
                    AppError::dependency(format!("Failed to start logcat: {err}"), trace_id)
                })
        },
    )
}

pub fn smoke_stop_logcat_stream(
    serial: String,
    registry: &Mutex<HashMap<String, LogcatHandle>>,
    trace_id: &str,
) -> Result<bool, AppError> {
    stop_logcat_inner(serial, registry, trace_id)
}

fn parse_string_array_from_json(value: Option<&serde_json::Value>, limit: usize) -> Vec<String> {
    let Some(items) = value.and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    if limit == 0 {
        return Vec::new();
    }

    let mut values = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        let Some(raw) = item.as_str() else {
            continue;
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let owned = trimmed.to_string();
        if seen.insert(owned.clone()) {
            values.push(owned);
            if values.len() >= limit {
                break;
            }
        }
    }
    values
}

pub(super) fn parse_legacy_logcat_preset_json(content: &str) -> Option<LegacyLogcatPreset> {
    let parsed: serde_json::Value = serde_json::from_str(content).ok()?;
    let record = parsed.as_object()?;
    let name = record.get("name")?.as_str()?.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let mut include = parse_string_array_from_json(record.get("filters"), 50);
    let mut exclude = Vec::new();
    if include.is_empty() {
        include = parse_string_array_from_json(record.get("include"), 50);
        exclude = parse_string_array_from_json(record.get("exclude"), 50);
    }
    if include.is_empty() && exclude.is_empty() {
        include = parse_string_array_from_json(record.get("patterns"), 50);
    }
    if include.is_empty() && exclude.is_empty() {
        return None;
    }

    Some(LegacyLogcatPreset {
        name,
        include,
        exclude,
    })
}

pub(super) fn parse_legacy_logcat_filters_json(
    content: &str,
    preset_name: &str,
) -> Option<LegacyLogcatPreset> {
    let parsed: serde_json::Value = serde_json::from_str(content).ok()?;
    let record = parsed.as_object()?;
    let name = preset_name.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let mut include = Vec::new();
    let mut seen = HashSet::new();
    for value in record.values() {
        let Some(raw) = value.as_str() else {
            continue;
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let owned = trimmed.to_string();
        if seen.insert(owned.clone()) {
            include.push(owned);
            if include.len() >= 50 {
                break;
            }
        }
    }

    if include.is_empty() {
        return None;
    }

    Some(LegacyLogcatPreset {
        name,
        include,
        exclude: Vec::new(),
    })
}

pub(super) fn load_legacy_logcat_presets_from_home(
    home_dir: &Path,
    trace_id: &str,
) -> Vec<LegacyLogcatPreset> {
    let mut presets = Vec::new();
    let preset_dir = home_dir.join(".lazy_blacktea").join("presets");
    if preset_dir.is_dir() {
        let mut preset_paths: Vec<PathBuf> = match fs::read_dir(&preset_dir) {
            Ok(entries) => entries
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.path())
                .filter(|path| {
                    path.is_file()
                        && path
                            .extension()
                            .and_then(|ext| ext.to_str())
                            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
                })
                .collect(),
            Err(err) => {
                warn!(
                    trace_id = %trace_id,
                    path = %preset_dir.to_string_lossy(),
                    error = %err,
                    "failed to read legacy preset directory"
                );
                Vec::new()
            }
        };
        preset_paths.sort();

        for path in preset_paths {
            let content = match fs::read_to_string(&path) {
                Ok(content) => content,
                Err(err) => {
                    warn!(
                        trace_id = %trace_id,
                        path = %path.to_string_lossy(),
                        error = %err,
                        "failed to read legacy preset file"
                    );
                    continue;
                }
            };
            if let Some(preset) = parse_legacy_logcat_preset_json(&content) {
                presets.push(preset);
            } else {
                warn!(
                    trace_id = %trace_id,
                    path = %path.to_string_lossy(),
                    "ignored invalid legacy preset file"
                );
            }
        }
    }

    let legacy_filters_path = home_dir.join(".lazy_blacktea_filters.json");
    if legacy_filters_path.is_file() {
        match fs::read_to_string(&legacy_filters_path) {
            Ok(content) => {
                if let Some(preset) = parse_legacy_logcat_filters_json(&content, "Migrated Filters")
                {
                    presets.push(preset);
                } else {
                    warn!(
                        trace_id = %trace_id,
                        path = %legacy_filters_path.to_string_lossy(),
                        "ignored invalid legacy filters file"
                    );
                }
            }
            Err(err) => {
                warn!(
                    trace_id = %trace_id,
                    path = %legacy_filters_path.to_string_lossy(),
                    error = %err,
                    "failed to read legacy filters file"
                );
            }
        }
    }

    let mut seen = HashSet::new();
    presets.retain(|preset| seen.insert(preset.name.clone()));
    presets
}

#[tauri::command(async)]
pub fn start_logcat(
    serial: String,
    filter: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let adb_program = get_adb_program(&trace_id)?;
    let trace_emit = trace_id.clone();
    let emitter: LogcatEmitter = Arc::new(move |event: LogcatEvent| {
        if let Err(err) = app.emit("logcat-line", event) {
            warn!(trace_id = %trace_emit, error = %err, "failed to emit logcat line");
        }
    });

    start_logcat_inner(
        serial,
        filter,
        &adb_program,
        &state.logcat_processes,
        emitter,
        &trace_id,
        |program, serial, filter, trace_id| {
            let mut cmd = Command::new(program);
            cmd.args(["-s", serial, "logcat"]);
            if let Some(filter) = filter {
                cmd.args(filter.split_whitespace());
            }
            cmd.stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|err| {
                    AppError::dependency(format!("Failed to start logcat: {err}"), trace_id)
                })
        },
    )?;

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn stop_logcat(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    stop_logcat_inner(serial, &state.logcat_processes, &trace_id)?;

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn get_logcat_status(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<LogcatStatus>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let status = get_logcat_status_inner(serial, &state.logcat_processes, &trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: status,
    })
}

#[tauri::command(async)]
pub fn load_legacy_logcat_presets(
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<LegacyLogcatPreset>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let data = dirs::home_dir()
        .map(|home_dir| load_legacy_logcat_presets_from_home(&home_dir, &trace_id))
        .unwrap_or_else(|| {
            warn!(trace_id = %trace_id, "failed to resolve home directory for legacy presets");
            Vec::new()
        });

    Ok(CommandResponse { trace_id, data })
}

#[tauri::command(async)]
pub fn clear_logcat(
    serial: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "logcat".to_string(),
        "-b".to_string(),
        "all".to_string(),
        "-c".to_string(),
    ];
    let output = run_adb(&adb_program, &args, &trace_id)?;
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

#[tauri::command(async)]
pub fn export_logcat(
    serial: String,
    lines: Vec<String>,
    output_dir: Option<String>,
    trace_id: Option<String>,
) -> Result<CommandResponse<LogcatExportResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let config = load_config(&trace_id)?;
    let resolved_dir = output_dir
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if !config.output_path.trim().is_empty() {
                config.output_path.clone()
            } else {
                config.file_gen_output_path.clone()
            }
        });
    ensure_non_empty(&resolved_dir, "output_dir", &trace_id)?;

    fs::create_dir_all(&resolved_dir).map_err(|err| {
        AppError::system(format!("Failed to create output dir: {err}"), &trace_id)
    })?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let output_path =
        PathBuf::from(&resolved_dir).join(format!("logcat_{}_{}.txt", serial, timestamp));
    let payload = lines.join("\n");
    fs::write(&output_path, payload).map_err(|err| {
        AppError::system(format!("Failed to write logcat file: {err}"), &trace_id)
    })?;

    Ok(CommandResponse {
        trace_id,
        data: LogcatExportResult {
            serial,
            output_path: output_path.to_string_lossy().to_string(),
            line_count: lines.len(),
        },
    })
}
