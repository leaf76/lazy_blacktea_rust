use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use mime_guess::MimeGuess;
use tauri::{AppHandle, Emitter, State};
use tracing::{info, warn};
use uuid::Uuid;
use zip::ZipArchive;

use crate::app::adb::apk::{extract_split_apks, get_apk_info, is_split_bundle, normalize_apk_path};
use crate::app::adb::apps::{
    package_entry_to_app_info, parse_dumpsys_components_summary, parse_dumpsys_data_dir,
    parse_dumpsys_first_install_time, parse_dumpsys_granted_permissions,
    parse_dumpsys_initiating_package_name, parse_dumpsys_installer_package_name,
    parse_dumpsys_installing_package_name, parse_dumpsys_last_update_time,
    parse_dumpsys_originating_package_name, parse_dumpsys_requested_permissions,
    parse_dumpsys_target_sdk, parse_dumpsys_user_id, parse_dumpsys_version_code,
    parse_dumpsys_version_name, parse_pm_list_packages_output, parse_pm_path_output,
};
use crate::app::adb::bugreport::{parse_bugreportz_line, BugreportzPayload};
use crate::app::adb::device_tracking::start_device_tracker;
use crate::app::adb::locator::{normalize_command_path, resolve_adb_program, validate_adb_program};
use crate::app::adb::parse::{
    build_device_detail, parse_adb_devices, parse_audio_summary, parse_battery_level,
    parse_bluetooth_manager_state, parse_df_total_kb,
    parse_dumpsys_version_name as parse_gms_version_name, parse_getprop_map, parse_ls_la,
    parse_settings_bool, parse_wm_size,
};
use crate::app::adb::paths::{
    device_parent_dir, sanitize_filename_component, validate_device_path,
};
use crate::app::adb::runner::{run_adb, run_command_with_timeout};
use crate::app::adb::scrcpy::{build_scrcpy_command, check_scrcpy_availability};
use crate::app::adb::transfer::parse_progress_percent;
use crate::app::bluetooth::service::start_bluetooth_monitor as start_bluetooth_monitor_service;
use crate::app::bugreport_logcat;
use crate::app::config::{
    clamp_terminal_buffer_lines, load_config, normalize_config_for_save, save_config, AppConfig,
};
use crate::app::diagnostics;
use crate::app::error::AppError;
use crate::app::models::{
    AdbInfo, ApkBatchInstallResult, ApkInstallErrorCode, ApkInstallResult, AppBasicInfo,
    AppComponentsSummary, AppIcon, AppInfo, BugreportLogAroundPage, BugreportLogFilters,
    BugreportLogPage, BugreportLogSearchResult, BugreportLogSummary, BugreportResult,
    CommandResponse, CommandResult, DeviceDetail, DeviceFileEntry, DeviceInfo, FilePreview,
    HostCommandResult, LogcatExportResult, NetProfilerSnapshot, PerfSnapshot, ScrcpyInfo,
    TerminalEvent, TerminalSessionInfo, UiHierarchyCaptureResult, UiHierarchyExportResult,
};
use crate::app::net_profiler::parse::{
    parse_cmd_package_list_u, parse_dumpsys_netstats_app_uid_stats, parse_xt_qtaguid_stats,
};
use crate::app::net_profiler::snapshot::build_net_usage_rows;
use crate::app::perf::parse::{
    build_perf_script, compute_cpu_percent_x100, parse_battery_totals, parse_cpu_freq_khz,
    parse_cpu_totals, parse_mem_totals, parse_net_totals, parse_per_core_cpu_totals,
    split_marked_sections, BatteryTotals, CpuTotals, MemTotals, NetTotals, MARK_CPUFREQ,
    MARK_MEMINFO, MARK_NETDEV, MARK_PROC_STAT,
};
use crate::app::state::{
    AppState, BugreportHandle, LogcatHandle, NetProfilerHandle, PerfMonitorHandle, RecordingHandle,
};
use crate::app::terminal::{TerminalSession, TERMINAL_EVENT_NAME};
use crate::app::ui_capture::png_bytes_to_data_url;
use crate::app::ui_xml::render_device_ui_html;

#[cfg(test)]
mod tests;

type LogcatEmitter = Arc<dyn Fn(LogcatEvent) + Send + Sync>;
type BugreportChildHolder = Arc<std::sync::Mutex<Option<std::process::Child>>>;
type BugreportReservation = (Arc<AtomicBool>, BugreportChildHolder);

fn start_logcat_inner(
    serial: String,
    filter: Option<String>,
    adb_program: &str,
    registry: &std::sync::Mutex<std::collections::HashMap<String, LogcatHandle>>,
    emitter: LogcatEmitter,
    trace_id: &str,
    spawn_logcat: impl FnOnce(&str, &str, Option<&str>, &str) -> Result<std::process::Child, AppError>,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let mut guard = registry
        .lock()
        .map_err(|_| AppError::system("Logcat registry locked", trace_id))?;
    if guard.contains_key(&serial) {
        return Err(AppError::validation("Logcat already running", trace_id));
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

fn stop_logcat_inner(
    serial: String,
    registry: &std::sync::Mutex<std::collections::HashMap<String, LogcatHandle>>,
    trace_id: &str,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let mut guard = registry
        .lock()
        .map_err(|_| AppError::system("Logcat registry locked", trace_id))?;
    let mut handle = match guard.remove(&serial) {
        Some(handle) => handle,
        None => return Err(AppError::validation("Logcat not running", trace_id)),
    };
    handle.stop_flag.store(true, Ordering::Relaxed);
    let _ = handle.child.kill();
    let _ = handle.child.wait();
    Ok(true)
}

// Smoke helpers: these allow macOS-friendly "real device" checks without needing a Tauri AppHandle.
// They intentionally reuse the same registries and inner logic as the Tauri commands.
pub fn smoke_start_logcat_stream(
    serial: String,
    filter: Option<String>,
    adb_program: &str,
    registry: &std::sync::Mutex<std::collections::HashMap<String, LogcatHandle>>,
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
    registry: &std::sync::Mutex<std::collections::HashMap<String, LogcatHandle>>,
    trace_id: &str,
) -> Result<bool, AppError> {
    stop_logcat_inner(serial, registry, trace_id)
}

fn clamp_perf_interval_ms(input: Option<u64>) -> u64 {
    let value = input.unwrap_or(1000);
    value.clamp(500, 5000)
}

fn clamp_net_profiler_interval_ms(input: Option<u64>) -> u64 {
    let value = input.unwrap_or(2000);
    value.clamp(500, 5000)
}

fn clamp_net_profiler_top_n(input: Option<u32>) -> usize {
    let value = input.unwrap_or(20);
    let clamped = value.clamp(5, 50);
    clamped as usize
}

fn sanitize_net_profiler_pinned_uids(
    input: Option<Vec<u32>>,
    top_n: usize,
    trace_id: &str,
) -> Result<Vec<u32>, AppError> {
    const MAX_PINNED_UIDS: usize = 5;
    let mut unique: Vec<u32> = Vec::new();
    let mut seen = std::collections::HashSet::<u32>::new();
    for uid in input.unwrap_or_default() {
        if seen.insert(uid) {
            unique.push(uid);
        }
    }
    if unique.len() > MAX_PINNED_UIDS {
        return Err(AppError::validation(
            format!("Too many pinned UIDs (max {MAX_PINNED_UIDS})"),
            trace_id,
        ));
    }
    if unique.len() > top_n {
        unique.truncate(top_n);
    }
    Ok(unique)
}

fn start_perf_monitor_inner(
    serial: String,
    registry: &std::sync::Mutex<std::collections::HashMap<String, PerfMonitorHandle>>,
    trace_id: &str,
    spawn: impl FnOnce(Arc<AtomicBool>) -> std::thread::JoinHandle<()>,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let mut guard = registry
        .lock()
        .map_err(|_| AppError::system("Perf monitor registry locked", trace_id))?;
    if guard.contains_key(&serial) {
        return Err(AppError::validation(
            "Perf monitor already running",
            trace_id,
        ));
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let join = spawn(Arc::clone(&stop_flag));
    guard.insert(serial, PerfMonitorHandle { stop_flag, join });
    Ok(true)
}

fn stop_perf_monitor_inner(
    serial: String,
    registry: &std::sync::Mutex<std::collections::HashMap<String, PerfMonitorHandle>>,
    trace_id: &str,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let handle = {
        let mut guard = registry
            .lock()
            .map_err(|_| AppError::system("Perf monitor registry locked", trace_id))?;
        match guard.remove(&serial) {
            Some(handle) => handle,
            None => return Err(AppError::validation("Perf monitor not running", trace_id)),
        }
    };

    handle.stop_flag.store(true, Ordering::Relaxed);
    handle
        .join
        .join()
        .map_err(|_| AppError::system("Perf monitor thread panicked", trace_id))?;
    Ok(true)
}

fn start_net_profiler_inner(
    serial: String,
    registry: &std::sync::Mutex<std::collections::HashMap<String, NetProfilerHandle>>,
    trace_id: &str,
    initial_pinned_uids: Vec<u32>,
    spawn: impl FnOnce(Arc<AtomicBool>, Arc<RwLock<Vec<u32>>>) -> std::thread::JoinHandle<()>,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let mut guard = registry
        .lock()
        .map_err(|_| AppError::system("Net profiler registry locked", trace_id))?;
    if guard.contains_key(&serial) {
        return Err(AppError::validation(
            "Net profiler already running",
            trace_id,
        ));
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let pinned_uids = Arc::new(RwLock::new(initial_pinned_uids));
    let join = spawn(Arc::clone(&stop_flag), Arc::clone(&pinned_uids));
    guard.insert(
        serial,
        NetProfilerHandle {
            stop_flag,
            pinned_uids,
            join,
        },
    );
    Ok(true)
}

fn stop_net_profiler_inner(
    serial: String,
    registry: &std::sync::Mutex<std::collections::HashMap<String, NetProfilerHandle>>,
    trace_id: &str,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let handle = {
        let mut guard = registry
            .lock()
            .map_err(|_| AppError::system("Net profiler registry locked", trace_id))?;
        match guard.remove(&serial) {
            Some(handle) => handle,
            None => return Err(AppError::validation("Net profiler not running", trace_id)),
        }
    };

    handle.stop_flag.store(true, Ordering::Relaxed);
    handle
        .join
        .join()
        .map_err(|_| AppError::system("Net profiler thread panicked", trace_id))?;
    Ok(true)
}

fn set_net_profiler_pinned_uids_inner(
    serial: String,
    pinned_uids: Option<Vec<u32>>,
    registry: &std::sync::Mutex<std::collections::HashMap<String, NetProfilerHandle>>,
    trace_id: &str,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;
    let pinned_uids = sanitize_net_profiler_pinned_uids(pinned_uids, 50, trace_id)?;

    let pinned_target = {
        let guard = registry
            .lock()
            .map_err(|_| AppError::system("Net profiler registry locked", trace_id))?;
        match guard.get(&serial) {
            Some(handle) => Arc::clone(&handle.pinned_uids),
            None => return Err(AppError::validation("Net profiler not running", trace_id)),
        }
    };

    {
        let mut guard = pinned_target
            .write()
            .map_err(|_| AppError::system("Net profiler pinned uids locked", trace_id))?;
        *guard = pinned_uids;
    }

    Ok(true)
}

pub fn smoke_start_perf_monitor(
    serial: String,
    interval_ms: Option<u64>,
    adb_program: &str,
    registry: &std::sync::Mutex<std::collections::HashMap<String, PerfMonitorHandle>>,
    emitter: Arc<dyn Fn(PerfEvent) + Send + Sync>,
    trace_id: &str,
) -> Result<bool, AppError> {
    ensure_non_empty(&serial, "serial", trace_id)?;

    let interval_ms = clamp_perf_interval_ms(interval_ms);
    let interval = Duration::from_millis(interval_ms);
    let perf_script = build_perf_script();

    let serial_spawn = serial.clone();
    let trace_spawn = trace_id.to_string();
    let adb_program_spawn = adb_program.to_string();

    start_perf_monitor_inner(serial, registry, trace_id, move |stop_flag| {
        std::thread::spawn(move || {
            let max_samples = 3usize;
            let mut samples = 0usize;

            let mut cpu_prev: Option<CpuTotals> = None;
            let mut cores_prev: Option<Vec<CpuTotals>> = None;
            let mut net_prev: Option<NetTotals> = None;
            let mut net_prev_instant: Option<Instant> = None;

            loop {
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }
                if samples >= max_samples {
                    break;
                }

                let loop_started = Instant::now();
                let args = vec![
                    "-s".to_string(),
                    serial_spawn.clone(),
                    "shell".to_string(),
                    perf_script.clone(),
                ];

                let output = match run_command_with_timeout(
                    &adb_program_spawn,
                    &args,
                    Duration::from_secs(5),
                    &trace_spawn,
                ) {
                    Ok(out) => out,
                    Err(err) => {
                        emitter(PerfEvent {
                            serial: serial_spawn.clone(),
                            snapshot: None,
                            error: Some(err.error),
                            trace_id: trace_spawn.clone(),
                        });
                        sleep_with_stop(interval, &stop_flag);
                        continue;
                    }
                };

                if output.exit_code.unwrap_or_default() != 0 {
                    emitter(PerfEvent {
                        serial: serial_spawn.clone(),
                        snapshot: None,
                        error: Some(output.stderr),
                        trace_id: trace_spawn.clone(),
                    });
                    sleep_with_stop(interval, &stop_flag);
                    continue;
                }

                let sections = match split_marked_sections(&output.stdout) {
                    Ok(sections) => sections,
                    Err(err) => {
                        emitter(PerfEvent {
                            serial: serial_spawn.clone(),
                            snapshot: None,
                            error: Some(err),
                            trace_id: trace_spawn.clone(),
                        });
                        sleep_with_stop(interval, &stop_flag);
                        continue;
                    }
                };

                let proc_stat = sections
                    .get(MARK_PROC_STAT)
                    .map(String::as_str)
                    .unwrap_or("");
                let meminfo = sections.get(MARK_MEMINFO).map(String::as_str).unwrap_or("");
                let netdev = sections.get(MARK_NETDEV).map(String::as_str).unwrap_or("");
                let cpufreq = sections.get(MARK_CPUFREQ).map(String::as_str).unwrap_or("");

                let cpu_curr = match parse_cpu_totals(proc_stat) {
                    Ok(v) => v,
                    Err(err) => {
                        emitter(PerfEvent {
                            serial: serial_spawn.clone(),
                            snapshot: None,
                            error: Some(err),
                            trace_id: trace_spawn.clone(),
                        });
                        sleep_with_stop(interval, &stop_flag);
                        continue;
                    }
                };

                let cores_curr = parse_per_core_cpu_totals(proc_stat).unwrap_or_default();
                let core_count = cores_curr.len();
                let core_percents_x100: Vec<Option<u16>> = match cores_prev.as_ref() {
                    Some(prev) if prev.len() == core_count && core_count > 0 => prev
                        .iter()
                        .zip(cores_curr.iter())
                        .map(|(p, c)| compute_cpu_percent_x100(*p, *c))
                        .collect(),
                    _ => vec![None; core_count],
                };

                let freq_map = parse_cpu_freq_khz(cpufreq);
                let core_freq_khz: Vec<Option<u32>> = (0..core_count)
                    .map(|idx| freq_map.get(&idx).copied())
                    .collect();
                let mem = parse_mem_totals(meminfo).unwrap_or(MemTotals {
                    total_bytes: 0,
                    available_bytes: 0,
                });
                let net_curr = parse_net_totals(netdev).unwrap_or(NetTotals {
                    rx_bytes: 0,
                    tx_bytes: 0,
                });

                let now = Instant::now();
                let dt_ms = net_prev_instant.map(|prev| now.duration_since(prev).as_millis());

                let snapshot = build_perf_snapshot(PerfSnapshotInput {
                    ts_ms: Utc::now().timestamp_millis(),
                    cpu_prev,
                    cpu_curr,
                    core_percents_x100,
                    core_freq_khz,
                    mem,
                    net_prev,
                    net_curr,
                    dt_ms,
                    battery: BatteryTotals {
                        level: None,
                        temperature_decic: None,
                    },
                    display_refresh_hz_x100: None,
                    missed_frames_per_sec_x100: None,
                });

                cpu_prev = Some(cpu_curr);
                cores_prev = Some(cores_curr);
                net_prev = Some(net_curr);
                net_prev_instant = Some(now);

                emitter(PerfEvent {
                    serial: serial_spawn.clone(),
                    snapshot: Some(snapshot),
                    error: None,
                    trace_id: trace_spawn.clone(),
                });

                samples += 1;

                let elapsed = loop_started.elapsed();
                if elapsed < interval {
                    sleep_with_stop(interval - elapsed, &stop_flag);
                }
            }
        })
    })
}

pub fn smoke_stop_perf_monitor(
    serial: String,
    registry: &std::sync::Mutex<std::collections::HashMap<String, PerfMonitorHandle>>,
    trace_id: &str,
) -> Result<bool, AppError> {
    stop_perf_monitor_inner(serial, registry, trace_id)
}

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

fn emit_perf_event(app: &AppHandle, event: PerfEvent) {
    let trace_id = event.trace_id.clone();
    if let Err(err) = app.emit("perf-snapshot", event) {
        warn!(trace_id = %trace_id, error = %err, "failed to emit perf snapshot");
    }
}

fn emit_net_profiler_event(app: &AppHandle, event: NetProfilerEvent) {
    let trace_id = event.trace_id.clone();
    if let Err(err) = app.emit("net-profiler-snapshot", event) {
        warn!(
            trace_id = %trace_id,
            error = %err,
            "failed to emit net profiler snapshot"
        );
    }
}

struct PerfSnapshotInput {
    ts_ms: i64,
    cpu_prev: Option<CpuTotals>,
    cpu_curr: CpuTotals,
    core_percents_x100: Vec<Option<u16>>,
    core_freq_khz: Vec<Option<u32>>,
    mem: MemTotals,
    net_prev: Option<NetTotals>,
    net_curr: NetTotals,
    dt_ms: Option<u128>,
    battery: BatteryTotals,
    display_refresh_hz_x100: Option<u16>,
    missed_frames_per_sec_x100: Option<u16>,
}

fn build_perf_snapshot(input: PerfSnapshotInput) -> PerfSnapshot {
    let PerfSnapshotInput {
        ts_ms,
        cpu_prev,
        cpu_curr,
        core_percents_x100,
        core_freq_khz,
        mem,
        net_prev,
        net_curr,
        dt_ms,
        battery,
        display_refresh_hz_x100,
        missed_frames_per_sec_x100,
    } = input;
    let cpu_total_percent_x100 = cpu_prev.and_then(|prev| compute_cpu_percent_x100(prev, cpu_curr));

    let mem_total_bytes = Some(mem.total_bytes);
    let mem_used_bytes = Some(mem.total_bytes.saturating_sub(mem.available_bytes));

    let (net_rx_bps, net_tx_bps) = match (net_prev, dt_ms) {
        (Some(prev), Some(dt_ms)) if dt_ms > 0 => {
            let rx_delta = net_curr.rx_bytes.saturating_sub(prev.rx_bytes) as u128;
            let tx_delta = net_curr.tx_bytes.saturating_sub(prev.tx_bytes) as u128;
            let rx_bps = ((rx_delta * 1000u128) / dt_ms).min(u64::MAX as u128) as u64;
            let tx_bps = ((tx_delta * 1000u128) / dt_ms).min(u64::MAX as u128) as u64;
            (Some(rx_bps), Some(tx_bps))
        }
        _ => (None, None),
    };

    PerfSnapshot {
        ts_ms,
        cpu_total_percent_x100,
        cpu_cores_percent_x100: core_percents_x100,
        cpu_cores_freq_khz: core_freq_khz,
        mem_total_bytes,
        mem_used_bytes,
        net_rx_bps,
        net_tx_bps,
        battery_level: battery.level,
        battery_temp_decic: battery.temperature_decic,
        display_refresh_hz_x100,
        missed_frames_per_sec_x100,
    }
}

fn reserve_bugreport_handle(
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

#[derive(Clone, serde::Serialize)]
pub struct LogcatEvent {
    pub serial: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<String>,
    pub trace_id: String,
}

#[derive(Clone, serde::Serialize)]
pub struct PerfEvent {
    pub serial: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<PerfSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub trace_id: String,
}

#[derive(Clone, serde::Serialize)]
pub struct NetProfilerEvent {
    pub serial: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<NetProfilerSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub trace_id: String,
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
    pub success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
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

fn validate_generate_bugreport_inputs(
    serial: &str,
    output_dir: &str,
    trace_id: &str,
) -> Result<(), AppError> {
    ensure_non_empty(serial, "serial", trace_id)?;
    ensure_non_empty(output_dir, "output_dir", trace_id)?;
    Ok(())
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
    if let Err(message) = validate_adb_program(&program) {
        return Err(AppError::validation(message, trace_id));
    }
    Ok(program)
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
        .unwrap_or_else(|| resolve_adb_program(&config.adb.command_path));

    if let Err(message) = validate_adb_program(&program) {
        warn!(trace_id = %trace_id, error = %message, "adb validation failed");
        return Ok(CommandResponse {
            trace_id,
            data: AdbInfo {
                available: false,
                version_output: String::new(),
                command_path: program,
                error: Some(message),
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

    // getprop is required to build base detail. If it fails, bail early to avoid spending up to
    // 5s * N subcommands per device.
    let getprop_args = vec![
        "-s".to_string(),
        serial_arg.clone(),
        "shell".to_string(),
        "getprop".to_string(),
    ];
    let (getprop_elapsed_ms, getprop) = run_timed("getprop", getprop_args, Duration::from_secs(5));

    let output = match getprop {
        Ok(output) => output,
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                serial = %serial,
                step = "getprop",
                elapsed_ms = getprop_elapsed_ms,
                error = %err,
                "failed to load device detail"
            );
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
            return None;
        }
    };

    let mut detail = build_device_detail(serial, &parse_getprop_map(&output.stdout));

    let battery_args = vec![
        "-s".to_string(),
        serial_arg.clone(),
        "shell".to_string(),
        "dumpsys".to_string(),
        "battery".to_string(),
    ];
    let (_battery_elapsed_ms, battery) = run_timed("battery", battery_args, Duration::from_secs(5));
    if let Ok(battery_output) = battery {
        detail.battery_level = parse_battery_level(&battery_output.stdout);
    }

    let wifi_args = vec![
        "-s".to_string(),
        serial_arg.clone(),
        "shell".to_string(),
        "settings".to_string(),
        "get".to_string(),
        "global".to_string(),
        "wifi_on".to_string(),
    ];
    let (_wifi_elapsed_ms, wifi_output) = run_timed("wifi", wifi_args, Duration::from_secs(5));
    if let Ok(wifi_output) = wifi_output {
        detail.wifi_is_on = parse_settings_bool(&wifi_output.stdout);
    }

    let bt_args = vec![
        "-s".to_string(),
        serial_arg.clone(),
        "shell".to_string(),
        "settings".to_string(),
        "get".to_string(),
        "global".to_string(),
        "bluetooth_on".to_string(),
    ];
    let (_bt_elapsed_ms, bt_output) = run_timed("bluetooth", bt_args, Duration::from_secs(5));
    if let Ok(bt_output) = bt_output {
        detail.bt_is_on = parse_settings_bool(&bt_output.stdout);
    }

    let bt_state_args = vec![
        "-s".to_string(),
        serial_arg.clone(),
        "shell".to_string(),
        "cmd".to_string(),
        "bluetooth_manager".to_string(),
        "get-state".to_string(),
    ];
    let (_bt_state_elapsed_ms, bt_state_output) = run_timed(
        "bluetooth_manager_state",
        bt_state_args,
        Duration::from_secs(5),
    );
    let bt_state = bt_state_output
        .ok()
        .and_then(|output| parse_bluetooth_manager_state(&output.stdout));
    if detail.bt_is_on.is_none() {
        if let Some(state) = bt_state.as_deref() {
            detail.bt_is_on = Some(state.contains("ON"));
        }
    }
    detail.bluetooth_manager_state = bt_state;

    let audio_args = vec![
        "-s".to_string(),
        serial_arg.clone(),
        "shell".to_string(),
        "dumpsys".to_string(),
        "audio".to_string(),
    ];
    let (_audio_elapsed_ms, audio_output) = run_timed("audio", audio_args, Duration::from_secs(5));
    if let Ok(audio_output) = audio_output {
        detail.audio_state = parse_audio_summary(&audio_output.stdout);
    }

    let gms_args = vec![
        "-s".to_string(),
        serial_arg.clone(),
        "shell".to_string(),
        "dumpsys".to_string(),
        "package".to_string(),
        "com.google.android.gms".to_string(),
    ];
    let (_gms_elapsed_ms, gms_output) = run_timed("gms", gms_args, Duration::from_secs(5));
    if let Ok(gms_output) = gms_output {
        detail.gms_version = parse_gms_version_name(&gms_output.stdout);
    }

    let wm_size_args = vec![
        "-s".to_string(),
        serial_arg.clone(),
        "shell".to_string(),
        "wm".to_string(),
        "size".to_string(),
    ];
    let (wm_size_elapsed_ms, wm_size_output) =
        run_timed("wm_size", wm_size_args, Duration::from_secs(5));
    match wm_size_output {
        Ok(out) => {
            let parsed = parse_wm_size(&out.stdout);
            if parsed.is_none() && !out.stdout.trim().is_empty() {
                warn!(
                    trace_id = %trace_id,
                    serial = %serial,
                    step = "wm_size",
                    elapsed_ms = wm_size_elapsed_ms,
                    output = %out.stdout.trim(),
                    "failed to parse wm size"
                );
            }
            detail.resolution = parsed;
        }
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                serial = %serial,
                step = "wm_size",
                elapsed_ms = wm_size_elapsed_ms,
                error = %err,
                "failed to load wm size"
            );
        }
    }

    let df_args = vec![
        "-s".to_string(),
        serial_arg.clone(),
        "shell".to_string(),
        "df".to_string(),
        "-k".to_string(),
        "/data".to_string(),
    ];
    let (df_elapsed_ms, df_output) = run_timed("df", df_args, Duration::from_secs(5));
    match df_output {
        Ok(out) => match parse_df_total_kb(&out.stdout) {
            Ok(total_kb) => {
                detail.storage_total_bytes = Some(total_kb.saturating_mul(1024));
            }
            Err(err) => {
                warn!(
                    trace_id = %trace_id,
                    serial = %serial,
                    step = "df",
                    elapsed_ms = df_elapsed_ms,
                    error = %err,
                    "failed to parse df output"
                );
            }
        },
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                serial = %serial,
                step = "df",
                elapsed_ms = df_elapsed_ms,
                error = %err,
                "failed to load df output"
            );
        }
    }

    let meminfo_args = vec![
        "-s".to_string(),
        serial_arg,
        "shell".to_string(),
        "cat".to_string(),
        "/proc/meminfo".to_string(),
    ];
    let (meminfo_elapsed_ms, meminfo_output) =
        run_timed("meminfo", meminfo_args, Duration::from_secs(5));
    match meminfo_output {
        Ok(out) => match parse_mem_totals(&out.stdout) {
            Ok(mem) => {
                detail.memory_total_bytes = Some(mem.total_bytes);
            }
            Err(err) => {
                warn!(
                    trace_id = %trace_id,
                    serial = %serial,
                    step = "meminfo",
                    elapsed_ms = meminfo_elapsed_ms,
                    error = %err,
                    "failed to parse /proc/meminfo"
                );
            }
        },
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                serial = %serial,
                step = "meminfo",
                elapsed_ms = meminfo_elapsed_ms,
                error = %err,
                "failed to load /proc/meminfo"
            );
        }
    }

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
    let need_detail = detailed.unwrap_or(true);
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
            devices.push(DeviceInfo { summary, detail });
        }
    } else {
        for summary in summaries {
            devices.push(DeviceInfo {
                summary,
                detail: None,
            });
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
        if existing.is_running() {
            return Err(AppError::validation(
                "Terminal session already running",
                &trace_id,
            ));
        }
        guard.remove(&serial);
    }

    let session_id = Uuid::new_v4().to_string();
    let args = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        "-t".to_string(),
    ];

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

    let mut handles = Vec::new();
    for serial in serials {
        let trace_clone = trace_id.clone();
        let extra_args_list = extra_args_list.clone();
        let split_paths = split_bundle.as_ref().map(|bundle| bundle.apk_paths.clone());
        let apk_path_clone = apk_path.clone();
        let adb_program_clone = adb_program.clone();
        let scheduler_clone = Arc::clone(&scheduler);
        let app_clone = app.clone();
        handles.push(std::thread::spawn(move || {
            let start_device = std::time::Instant::now();
            if let Some(app_emit) = &app_clone {
                if let Err(err) = app_emit.emit(
                    APK_INSTALL_EVENT_NAME,
                    ApkInstallEvent {
                        serial: serial.clone(),
                        event: "start".to_string(),
                        success: None,
                        message: Some("Installing...".to_string()),
                        error_code: None,
                        raw_output: None,
                        trace_id: trace_clone.clone(),
                    },
                ) {
                    warn!(trace_id = %trace_clone, error = %err, "failed to emit apk install event");
                }
            }
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
                    if let Some(app_emit) = &app_clone {
                        if let Err(err) = app_emit.emit(
                            APK_INSTALL_EVENT_NAME,
                            ApkInstallEvent {
                                serial: result_item.serial.clone(),
                                event: "complete".to_string(),
                                success: Some(false),
                                message: Some("Failed to access the device. Please try again.".to_string()),
                                error_code: Some(result_item.error_code.code().to_string()),
                                raw_output: Some(truncate_for_event(
                                    result_item.raw_output.trim(),
                                    APK_INSTALL_OUTPUT_MAX_LEN,
                                )),
                                trace_id: trace_clone.clone(),
                            },
                        ) {
                            warn!(trace_id = %trace_clone, error = %err, "failed to emit apk install event");
                        }
                    }
                    return result_item;
                }
            };
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
            let output = run_command_with_timeout(
                &adb_program_clone,
                &args,
                Duration::from_secs(180),
                &trace_clone,
            );
            let elapsed = start_device.elapsed().as_secs_f64();
            let result_item = match output {
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
            };

            if let Some(app_emit) = &app_clone {
                let raw_trimmed = result_item.raw_output.trim();
                let raw_output = if raw_trimmed.is_empty() {
                    None
                } else {
                    Some(truncate_for_event(raw_trimmed, APK_INSTALL_OUTPUT_MAX_LEN))
                };
                let message = if result_item.success {
                    Some("Installed.".to_string())
                } else if let Some(raw) = raw_output.clone() {
                    Some(raw)
                } else {
                    Some(result_item.error_code.code().to_string())
                };
                if let Err(err) = app_emit.emit(
                    APK_INSTALL_EVENT_NAME,
                    ApkInstallEvent {
                        serial: result_item.serial.clone(),
                        event: "complete".to_string(),
                        success: Some(result_item.success),
                        message,
                        error_code: Some(result_item.error_code.code().to_string()),
                        raw_output,
                        trace_id: trace_clone.clone(),
                    },
                ) {
                    warn!(trace_id = %trace_clone, error = %err, "failed to emit apk install event");
                }
            }

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

    let adb_program = get_adb_program(&trace_id)?;
    let config = load_config(&trace_id)?;
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let safe_serial = sanitize_filename_component(&serial);
    let filename = format!("screenshot_{}_{}.png", safe_serial, timestamp);
    let mut output_path = PathBuf::from(output_dir);
    fs::create_dir_all(&output_path).map_err(|err| {
        AppError::system(format!("Failed to create output dir: {err}"), &trace_id)
    })?;
    output_path.push(&filename);
    let output_path_string = output_path.to_string_lossy().to_string();

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

    let output = Command::new(&adb_program)
        .args(&args)
        .output()
        .map_err(|err| AppError::dependency(format!("Failed to run adb: {err}"), &trace_id))?;

    if output.status.success() {
        fs::write(&output_path, &output.stdout).map_err(|err| {
            AppError::system(format!("Failed to write screenshot: {err}"), &trace_id)
        })?;
        return Ok(CommandResponse {
            trace_id,
            data: output_path_string,
        });
    }

    let exec_error_raw = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let exec_error = if exec_error_raw.is_empty() {
        "unknown error".to_string()
    } else {
        exec_error_raw
    };
    warn!(
        trace_id = %trace_id,
        error = %exec_error,
        "exec-out screencap failed; falling back to pull"
    );

    let fallback_result = (|| -> Result<(), AppError> {
        let remote_path = format!("/sdcard/{filename}");
        let capture_args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "screencap".to_string(),
            "-p".to_string(),
            remote_path.clone(),
        ];
        let capture_output = run_command_with_timeout(
            &adb_program,
            &capture_args,
            Duration::from_secs(10),
            &trace_id,
        )?;
        if capture_output.exit_code.unwrap_or(1) != 0 {
            return Err(AppError::dependency(
                format!(
                    "Fallback screencap failed: {}",
                    capture_output.stderr.trim()
                ),
                &trace_id,
            ));
        }
        let pull_args = vec![
            "-s".to_string(),
            serial.clone(),
            "pull".to_string(),
            remote_path.clone(),
            output_path_string.clone(),
        ];
        let pull_output =
            run_command_with_timeout(&adb_program, &pull_args, Duration::from_secs(20), &trace_id)?;
        if pull_output.exit_code.unwrap_or(1) != 0 {
            return Err(AppError::dependency(
                format!("Fallback pull failed: {}", pull_output.stderr.trim()),
                &trace_id,
            ));
        }
        let cleanup_args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "rm".to_string(),
            "-f".to_string(),
            remote_path,
        ];
        if let Err(err) = run_command_with_timeout(
            &adb_program,
            &cleanup_args,
            Duration::from_secs(10),
            &trace_id,
        ) {
            warn!(
                trace_id = %trace_id,
                error = %err.error,
                "failed to remove fallback screenshot"
            );
        }
        Ok(())
    })();

    match fallback_result {
        Ok(()) => Ok(CommandResponse {
            trace_id,
            data: output_path_string,
        }),
        Err(err) => Err(AppError::dependency(
            format!(
                "Screenshot failed (exec-out): {}. Fallback failed: {}",
                exec_error, err.error
            ),
            &trace_id,
        )),
    }
}

#[tauri::command(async)]
pub fn start_screen_record(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
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

    let child = Command::new(&adb_program)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            AppError::dependency(format!("Failed to start screenrecord: {err}"), &trace_id)
        })?;

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

#[tauri::command(async)]
pub fn stop_screen_record(
    serial: String,
    output_dir: Option<String>,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<String>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let mut guard = state
        .recording_processes
        .lock()
        .map_err(|_| AppError::system("Recording registry locked", &trace_id))?;

    let handle = match guard.remove(&serial) {
        Some(handle) => handle,
        None => return Err(AppError::validation("No recording in progress", &trace_id)),
    };
    let mut child = handle.child;

    let _ = Command::new(&adb_program)
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
                    return Err(AppError::system(
                        "Timeout waiting for screenrecord",
                        &trace_id,
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(err) => {
                return Err(AppError::system(
                    format!("Failed to stop screenrecord: {err}"),
                    &trace_id,
                ));
            }
        }
    }

    let config = load_config(&trace_id)?;
    let output_dir = output_dir
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| config.output_path.clone());
    if output_dir.trim().is_empty() {
        return Ok(CommandResponse {
            trace_id,
            data: String::new(),
        });
    }

    fs::create_dir_all(&output_dir).map_err(|err| {
        AppError::system(format!("Failed to create output dir: {err}"), &trace_id)
    })?;

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
    let output = run_adb(&adb_program, &args, &trace_id)?;
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

#[tauri::command(async)]
pub fn list_device_files(
    serial: String,
    path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<DeviceFileEntry>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;
    ensure_non_empty(&path, "path", &trace_id)?;

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
        dir_hint,
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
            normalized.clone(),
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
            device_dir,
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
        device_path.clone(),
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
        from_path,
        to_path.clone(),
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
    args.push(device_path.clone());

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
                content.truncate(MAX_TEXT_PREVIEW_BYTES);
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
            match run_command_with_timeout(
                &adb_program,
                &dump_args,
                Duration::from_secs(10),
                &trace_id,
            ) {
                Ok(out) => (
                    parse_dumpsys_version_name(&out.stdout),
                    parse_dumpsys_version_code(&out.stdout),
                ),
                Err(err) => {
                    warn!(
                        trace_id = %trace_id,
                        package_name = %entry.package_name,
                        error = %err,
                        "dumpsys package failed while listing apps"
                    );
                    (None, None)
                }
            }
        } else {
            (None, None)
        };
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
    let output = Command::new(&adb_program)
        .args(["-s", &serial, "exec-out", "uiautomator", "dump", "/dev/tty"])
        .output()
        .map_err(|err| {
            AppError::dependency(format!("Failed to run uiautomator: {err}"), &trace_id)
        })?;

    if !output.status.success() {
        return Err(AppError::dependency(
            format!(
                "UI dump failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ),
            &trace_id,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout).to_string();
    let html = render_device_ui_html(&xml)
        .map_err(|err| AppError::system(format!("Failed to render HTML: {err}"), &trace_id))?;

    let mut screenshot_args = vec![
        "-s".to_string(),
        serial.clone(),
        "exec-out".to_string(),
        "screencap".to_string(),
        "-p".to_string(),
    ];
    if config.screenshot.display_id >= 0 {
        screenshot_args.push("-d".to_string());
        screenshot_args.push(config.screenshot.display_id.to_string());
    }
    if !config.screenshot.extra_args.trim().is_empty() {
        screenshot_args.extend(
            config
                .screenshot
                .extra_args
                .split_whitespace()
                .map(|item| item.to_string()),
        );
    }

    let (screenshot_data_url, screenshot_error) = match Command::new(&adb_program)
        .args(&screenshot_args)
        .output()
    {
        Ok(screenshot_output) => {
            if !screenshot_output.status.success() {
                let message = format!(
                    "Screenshot failed: {}",
                    String::from_utf8_lossy(&screenshot_output.stderr)
                );
                warn!(trace_id = %trace_id, error = %message, "ui_inspector screenshot failed");
                (None, Some(message))
            } else {
                match png_bytes_to_data_url(&screenshot_output.stdout) {
                    Ok(url) => (Some(url), None),
                    Err(message) => {
                        warn!(trace_id = %trace_id, error = %message, "ui_inspector screenshot invalid");
                        (None, Some(message))
                    }
                }
            }
        }
        Err(err) => {
            let message = format!("Failed to capture screenshot: {err}");
            warn!(trace_id = %trace_id, error = %message, "ui_inspector screenshot error");
            (None, Some(message))
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

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let xml_path =
        PathBuf::from(&resolved_dir).join(format!("ui_hierarchy_{}_{}.xml", serial, timestamp));
    let html_path =
        PathBuf::from(&resolved_dir).join(format!("ui_hierarchy_{}_{}.html", serial, timestamp));
    let screenshot_path =
        PathBuf::from(&resolved_dir).join(format!("ui_hierarchy_{}_{}.png", serial, timestamp));

    let output = Command::new(&adb_program)
        .args(["-s", &serial, "exec-out", "uiautomator", "dump", "/dev/tty"])
        .output()
        .map_err(|err| {
            AppError::dependency(format!("Failed to run uiautomator: {err}"), &trace_id)
        })?;

    if !output.status.success() {
        return Err(AppError::dependency(
            format!(
                "UI dump failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ),
            &trace_id,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout).to_string();
    let html = render_device_ui_html(&xml)
        .map_err(|err| AppError::system(format!("Failed to render HTML: {err}"), &trace_id))?;

    fs::write(&xml_path, xml)
        .map_err(|err| AppError::system(format!("Failed to write XML: {err}"), &trace_id))?;
    fs::write(&html_path, html)
        .map_err(|err| AppError::system(format!("Failed to write HTML: {err}"), &trace_id))?;

    let mut screenshot_args = vec![
        "-s".to_string(),
        serial.clone(),
        "exec-out".to_string(),
        "screencap".to_string(),
        "-p".to_string(),
    ];
    if config.screenshot.display_id >= 0 {
        screenshot_args.push("-d".to_string());
        screenshot_args.push(config.screenshot.display_id.to_string());
    }
    if !config.screenshot.extra_args.trim().is_empty() {
        screenshot_args.extend(
            config
                .screenshot
                .extra_args
                .split_whitespace()
                .map(|item| item.to_string()),
        );
    }

    let screenshot_output = Command::new(&adb_program)
        .args(&screenshot_args)
        .output()
        .map_err(|err| {
            AppError::dependency(format!("Failed to capture screenshot: {err}"), &trace_id)
        })?;
    if !screenshot_output.status.success() {
        return Err(AppError::dependency(
            format!(
                "Failed to capture screenshot: {}",
                String::from_utf8_lossy(&screenshot_output.stderr)
            ),
            &trace_id,
        ));
    }
    let mut screenshot_file = fs::File::create(&screenshot_path).map_err(|err| {
        AppError::system(format!("Failed to create screenshot: {err}"), &trace_id)
    })?;
    screenshot_file
        .write_all(&screenshot_output.stdout)
        .map_err(|err| AppError::system(format!("Failed to write screenshot: {err}"), &trace_id))?;

    Ok(CommandResponse {
        trace_id,
        data: UiHierarchyExportResult {
            serial,
            xml_path: xml_path.to_string_lossy().to_string(),
            html_path: html_path.to_string_lossy().to_string(),
            screenshot_path: screenshot_path.to_string_lossy().to_string(),
        },
    })
}

#[tauri::command(async)]
pub fn start_perf_monitor(
    serial: String,
    interval_ms: Option<u64>,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let interval_ms = clamp_perf_interval_ms(interval_ms);
    let interval = Duration::from_millis(interval_ms);
    let perf_script = build_perf_script();
    let scheduler = Arc::clone(&state.scheduler);

    let app_emit = app.clone();
    let serial_spawn = serial.clone();
    let trace_spawn = trace_id.clone();
    let adb_program_spawn = adb_program.clone();

    start_perf_monitor_inner(serial, &state.perf_monitors, &trace_id, move |stop_flag| {
        std::thread::spawn(move || {
            let mut cpu_prev: Option<CpuTotals> = None;
            let mut cores_prev: Option<Vec<CpuTotals>> = None;
            let mut net_prev: Option<NetTotals> = None;
            let mut net_prev_instant: Option<Instant> = None;
            let mut display_refresh_hz_x100: Option<u16> = None;
            let mut missed_frames_total_prev: Option<u64> = None;
            let mut missed_frames_instant_prev: Option<Instant> = None;
            let mut missed_frames_per_sec_x100: Option<u16> = None;
            let mut last_missed_check = Instant::now();
            let mut battery_last = BatteryTotals {
                level: None,
                temperature_decic: None,
            };
            let mut last_battery_check: Option<Instant> = None;

            {
                let args = vec![
                    "-s".to_string(),
                    serial_spawn.clone(),
                    "shell".to_string(),
                    r#"dumpsys SurfaceFlinger --latency | sed -n "1p""#.to_string(),
                ];
                let output = {
                    let _permit = scheduler.acquire_global();
                    let device_lock = scheduler.device_lock(&serial_spawn);
                    let device_guard = device_lock.lock().ok();
                    device_guard.map(|_guard| {
                        run_command_with_timeout(
                            &adb_program_spawn,
                            &args,
                            Duration::from_secs(3),
                            &trace_spawn,
                        )
                    })
                };

                match output {
                    Some(Ok(output)) => {
                        if output.exit_code.unwrap_or_default() == 0 {
                            if let Some(period_ns) = parse_surfaceflinger_latency_ns(&output.stdout)
                            {
                                display_refresh_hz_x100 = compute_refresh_hz_x100(period_ns);
                            }
                        }
                    }
                    Some(Err(err)) => {
                        warn!(
                            trace_id = %trace_spawn,
                            error = %err,
                            "failed to read SurfaceFlinger latency"
                        );
                    }
                    None => {
                        warn!(trace_id = %trace_spawn, "device lock poisoned");
                    }
                }
            }

            loop {
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }

                let loop_started = Instant::now();

                let args = vec![
                    "-s".to_string(),
                    serial_spawn.clone(),
                    "shell".to_string(),
                    perf_script.clone(),
                ];

                let output = {
                    let _permit = scheduler.acquire_global();
                    let device_lock = scheduler.device_lock(&serial_spawn);
                    let device_guard = device_lock.lock().ok();
                    device_guard.map(|_guard| {
                        run_command_with_timeout(
                            &adb_program_spawn,
                            &args,
                            Duration::from_secs(3),
                            &trace_spawn,
                        )
                    })
                };

                let output = match output {
                    Some(output) => output,
                    None => {
                        emit_perf_event(
                            &app_emit,
                            PerfEvent {
                                serial: serial_spawn.clone(),
                                snapshot: None,
                                error: Some(
                                    "Failed to access the device. Please try again.".to_string(),
                                ),
                                trace_id: trace_spawn.clone(),
                            },
                        );
                        std::thread::sleep(Duration::from_millis(200));
                        continue;
                    }
                };

                let output = match output {
                    Ok(output) => output,
                    Err(err) => {
                        warn!(trace_id = %trace_spawn, error = %err, "failed to collect perf output");
                        emit_perf_event(
                            &app_emit,
                            PerfEvent {
                                serial: serial_spawn.clone(),
                                snapshot: None,
                                error: Some(format!(
                                    "Failed to collect performance data ({})",
                                    err.code
                                )),
                                trace_id: trace_spawn.clone(),
                            },
                        );
                        sleep_with_stop(interval, &stop_flag);
                        continue;
                    }
                };

                if output.exit_code.unwrap_or_default() != 0 {
                    warn!(
                        trace_id = %trace_spawn,
                        exit_code = ?output.exit_code,
                        stderr = %output.stderr,
                        "perf adb shell returned non-zero exit code"
                    );
                    emit_perf_event(
                        &app_emit,
                        PerfEvent {
                            serial: serial_spawn.clone(),
                            snapshot: None,
                            error: Some("Failed to collect performance data".to_string()),
                            trace_id: trace_spawn.clone(),
                        },
                    );
                    sleep_with_stop(interval, &stop_flag);
                    continue;
                }

                let sections = match split_marked_sections(&output.stdout) {
                    Ok(sections) => sections,
                    Err(err) => {
                        warn!(trace_id = %trace_spawn, error = %err, "failed to split perf output");
                        emit_perf_event(
                            &app_emit,
                            PerfEvent {
                                serial: serial_spawn.clone(),
                                snapshot: None,
                                error: Some(format!("Failed to parse performance data: {err}")),
                                trace_id: trace_spawn.clone(),
                            },
                        );
                        sleep_with_stop(interval, &stop_flag);
                        continue;
                    }
                };

                let proc_stat = sections
                    .get(MARK_PROC_STAT)
                    .map(|value| value.as_str())
                    .unwrap_or("");
                let meminfo = sections
                    .get(MARK_MEMINFO)
                    .map(|value| value.as_str())
                    .unwrap_or("");
                let netdev = sections
                    .get(MARK_NETDEV)
                    .map(|value| value.as_str())
                    .unwrap_or("");
                let cpufreq_section = sections
                    .get(MARK_CPUFREQ)
                    .map(|value| value.as_str())
                    .unwrap_or("");

                let cpu_curr = match parse_cpu_totals(proc_stat) {
                    Ok(value) => value,
                    Err(err) => {
                        warn!(trace_id = %trace_spawn, error = %err, "failed to parse /proc/stat");
                        emit_perf_event(
                            &app_emit,
                            PerfEvent {
                                serial: serial_spawn.clone(),
                                snapshot: None,
                                error: Some(format!("Failed to parse performance data: {err}")),
                                trace_id: trace_spawn.clone(),
                            },
                        );
                        sleep_with_stop(interval, &stop_flag);
                        continue;
                    }
                };

                let cores_curr = parse_per_core_cpu_totals(proc_stat).unwrap_or_default();
                let core_count = cores_curr.len();
                let core_percents_x100 = match cores_prev.as_ref() {
                    Some(prev) if prev.len() == core_count && core_count > 0 => prev
                        .iter()
                        .zip(cores_curr.iter())
                        .map(|(a, b)| compute_cpu_percent_x100(*a, *b))
                        .collect(),
                    _ => vec![None; core_count],
                };
                cores_prev = Some(cores_curr);

                let freq_map = parse_cpu_freq_khz(cpufreq_section);
                let core_freq_khz: Vec<Option<u32>> = (0..core_count)
                    .map(|idx| freq_map.get(&idx).copied())
                    .collect();

                let mem = match parse_mem_totals(meminfo) {
                    Ok(value) => value,
                    Err(err) => {
                        warn!(trace_id = %trace_spawn, error = %err, "failed to parse /proc/meminfo");
                        emit_perf_event(
                            &app_emit,
                            PerfEvent {
                                serial: serial_spawn.clone(),
                                snapshot: None,
                                error: Some(format!("Failed to parse performance data: {err}")),
                                trace_id: trace_spawn.clone(),
                            },
                        );
                        sleep_with_stop(interval, &stop_flag);
                        continue;
                    }
                };

                let net_curr = match parse_net_totals(netdev) {
                    Ok(value) => value,
                    Err(err) => {
                        warn!(trace_id = %trace_spawn, error = %err, "failed to parse /proc/net/dev");
                        emit_perf_event(
                            &app_emit,
                            PerfEvent {
                                serial: serial_spawn.clone(),
                                snapshot: None,
                                error: Some(format!("Failed to parse performance data: {err}")),
                                trace_id: trace_spawn.clone(),
                            },
                        );
                        sleep_with_stop(interval, &stop_flag);
                        continue;
                    }
                };

                let sample_instant = Instant::now();
                let dt_ms =
                    net_prev_instant.map(|prev| sample_instant.duration_since(prev).as_millis());
                let ts_ms = Utc::now().timestamp_millis();

                if last_battery_check.is_none()
                    || last_battery_check
                        .map(|prev| sample_instant.duration_since(prev))
                        .unwrap_or(Duration::from_secs(0))
                        >= Duration::from_secs(10)
                {
                    last_battery_check = Some(sample_instant);
                    let args = vec![
                        "-s".to_string(),
                        serial_spawn.clone(),
                        "shell".to_string(),
                        "dumpsys battery".to_string(),
                    ];
                    let output = {
                        let _permit = scheduler.acquire_global();
                        let device_lock = scheduler.device_lock(&serial_spawn);
                        let device_guard = device_lock.lock().ok();
                        device_guard.map(|_guard| {
                            run_command_with_timeout(
                                &adb_program_spawn,
                                &args,
                                Duration::from_secs(3),
                                &trace_spawn,
                            )
                        })
                    };

                    match output {
                        Some(Ok(output)) => {
                            if output.exit_code.unwrap_or_default() == 0 {
                                match parse_battery_totals(&output.stdout) {
                                    Ok(value) => {
                                        battery_last = value;
                                    }
                                    Err(err) => {
                                        warn!(
                                            trace_id = %trace_spawn,
                                            error = %err,
                                            "failed to parse battery output"
                                        );
                                    }
                                }
                            } else {
                                warn!(
                                    trace_id = %trace_spawn,
                                    exit_code = ?output.exit_code,
                                    stderr = %output.stderr,
                                    "battery dumpsys returned non-zero exit code"
                                );
                            }
                        }
                        Some(Err(err)) => {
                            warn!(
                                trace_id = %trace_spawn,
                                error = %err,
                                "failed to collect battery dumpsys"
                            );
                        }
                        None => {
                            warn!(trace_id = %trace_spawn, "device lock poisoned");
                        }
                    }
                }

                if missed_frames_total_prev.is_none()
                    || missed_frames_instant_prev.is_none()
                    || last_missed_check.elapsed() >= Duration::from_secs(10)
                {
                    last_missed_check = Instant::now();
                    let args = vec![
                        "-s".to_string(),
                        serial_spawn.clone(),
                        "shell".to_string(),
                        r#"dumpsys SurfaceFlinger | sed -n "s/.*Total missed frame count: *\([0-9][0-9]*\).*/\1/p" | sed -n "1p""#.to_string(),
                    ];
                    let output = {
                        let _permit = scheduler.acquire_global();
                        let device_lock = scheduler.device_lock(&serial_spawn);
                        let device_guard = device_lock.lock().ok();
                        device_guard.map(|_guard| {
                            run_command_with_timeout(
                                &adb_program_spawn,
                                &args,
                                Duration::from_secs(3),
                                &trace_spawn,
                            )
                        })
                    };

                    match output {
                        Some(Ok(output)) => {
                            if output.exit_code.unwrap_or_default() == 0 {
                                let digits = output.stdout.trim();
                                if let Ok(total) = digits.parse::<u64>() {
                                    let now = Instant::now();
                                    if let (Some(prev_total), Some(prev_instant)) =
                                        (missed_frames_total_prev, missed_frames_instant_prev)
                                    {
                                        let delta = total.saturating_sub(prev_total) as u128;
                                        let dt_ms = now.duration_since(prev_instant).as_millis();
                                        if dt_ms > 0 {
                                            let per_sec_x100 = ((delta * 100_000u128) / dt_ms)
                                                .min(u16::MAX as u128)
                                                as u16;
                                            missed_frames_per_sec_x100 = Some(per_sec_x100);
                                        }
                                    }
                                    missed_frames_total_prev = Some(total);
                                    missed_frames_instant_prev = Some(now);
                                }
                            } else {
                                warn!(
                                    trace_id = %trace_spawn,
                                    exit_code = ?output.exit_code,
                                    stderr = %output.stderr,
                                    "SurfaceFlinger dumpsys returned non-zero exit code"
                                );
                            }
                        }
                        Some(Err(err)) => {
                            warn!(
                                trace_id = %trace_spawn,
                                error = %err,
                                "failed to collect SurfaceFlinger missed frames"
                            );
                        }
                        None => {
                            warn!(trace_id = %trace_spawn, "device lock poisoned");
                        }
                    }
                }

                let snapshot = build_perf_snapshot(PerfSnapshotInput {
                    ts_ms,
                    cpu_prev,
                    cpu_curr,
                    core_percents_x100,
                    core_freq_khz,
                    mem,
                    net_prev,
                    net_curr,
                    dt_ms,
                    battery: battery_last,
                    display_refresh_hz_x100,
                    missed_frames_per_sec_x100,
                });

                cpu_prev = Some(cpu_curr);
                net_prev = Some(net_curr);
                net_prev_instant = Some(sample_instant);

                emit_perf_event(
                    &app_emit,
                    PerfEvent {
                        serial: serial_spawn.clone(),
                        snapshot: Some(snapshot),
                        error: None,
                        trace_id: trace_spawn.clone(),
                    },
                );

                let elapsed = loop_started.elapsed();
                if elapsed < interval {
                    sleep_with_stop(interval - elapsed, &stop_flag);
                }
            }
        })
    })?;

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn start_net_profiler(
    serial: String,
    interval_ms: Option<u64>,
    top_n: Option<u32>,
    pinned_uids: Option<Vec<u32>>,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let interval_ms = clamp_net_profiler_interval_ms(interval_ms);
    let interval = Duration::from_millis(interval_ms);
    let top_n = clamp_net_profiler_top_n(top_n);
    let pinned_uids = sanitize_net_profiler_pinned_uids(pinned_uids, top_n, &trace_id)?;
    let scheduler = Arc::clone(&state.scheduler);

    let app_emit = app.clone();
    let serial_spawn = serial.clone();
    let trace_spawn = trace_id.clone();
    let adb_program_spawn = adb_program.clone();

    start_net_profiler_inner(
        serial,
        &state.net_profilers,
        &trace_id,
        pinned_uids,
        move |stop_flag, pinned_uids| {
            std::thread::spawn(move || {
                #[derive(Clone, Copy, Debug, PartialEq, Eq)]
                enum NetStatsSource {
                    ProcXtQtaguid,
                    DumpsysNetstats,
                }

                let mut packages_by_uid: HashMap<u32, Vec<String>> = HashMap::new();
                let mut prev_totals: Option<HashMap<u32, (u64, u64)>> = None;
                let mut prev_instant: Option<Instant> = None;
                let mut stats_source: Option<NetStatsSource> = None;
                let mut unsupported = false;

                {
                    let args = vec![
                        "-s".to_string(),
                        serial_spawn.clone(),
                        "shell".to_string(),
                        "cmd package list packages -U".to_string(),
                    ];
                    let output = {
                        let _permit = scheduler.acquire_global();
                        let device_lock = scheduler.device_lock(&serial_spawn);
                        let device_guard = device_lock.lock().ok();
                        device_guard.map(|_guard| {
                            run_command_with_timeout(
                                &adb_program_spawn,
                                &args,
                                Duration::from_secs(5),
                                &trace_spawn,
                            )
                        })
                    };

                    match output {
                        Some(Ok(output)) => {
                            if output.exit_code.unwrap_or_default() == 0 {
                                packages_by_uid = parse_cmd_package_list_u(&output.stdout);
                            } else {
                                warn!(
                                    trace_id = %trace_spawn,
                                    exit_code = ?output.exit_code,
                                    stderr = %output.stderr,
                                    "cmd package list packages returned non-zero exit code"
                                );
                            }
                        }
                        Some(Err(err)) => {
                            warn!(
                                trace_id = %trace_spawn,
                                error = %err,
                                "failed to list packages for net profiler"
                            );
                        }
                        None => {
                            warn!(trace_id = %trace_spawn, "device lock poisoned");
                        }
                    }
                }

                loop {
                    if stop_flag.load(Ordering::Relaxed) {
                        break;
                    }

                    if unsupported {
                        std::thread::sleep(Duration::from_millis(200));
                        continue;
                    }

                    let loop_started = Instant::now();

                    let preferred = stats_source.unwrap_or(NetStatsSource::ProcXtQtaguid);
                    let candidates = match preferred {
                        NetStatsSource::ProcXtQtaguid => [
                            NetStatsSource::ProcXtQtaguid,
                            NetStatsSource::DumpsysNetstats,
                        ],
                        NetStatsSource::DumpsysNetstats => [
                            NetStatsSource::DumpsysNetstats,
                            NetStatsSource::ProcXtQtaguid,
                        ],
                    };
                    let candidate_count = candidates.len();

                    let mut totals: Option<HashMap<u32, (u64, u64)>> = None;
                    let mut unsupported_sources = 0usize;
                    let mut last_error: Option<String> = None;

                    for source in candidates {
                        if stop_flag.load(Ordering::Relaxed) {
                            break;
                        }

                        match source {
                            NetStatsSource::ProcXtQtaguid => {
                                let args = vec![
                                    "-s".to_string(),
                                    serial_spawn.clone(),
                                    "shell".to_string(),
                                    "cat /proc/net/xt_qtaguid/stats".to_string(),
                                ];

                                let output = {
                                    let _permit = scheduler.acquire_global();
                                    let device_lock = scheduler.device_lock(&serial_spawn);
                                    let device_guard = device_lock.lock().ok();
                                    device_guard.map(|_guard| {
                                        run_command_with_timeout(
                                            &adb_program_spawn,
                                            &args,
                                            Duration::from_secs(5),
                                            &trace_spawn,
                                        )
                                    })
                                };

                                let output = match output {
                                    Some(output) => output,
                                    None => {
                                        last_error = Some(
                                            "Failed to access the device. Please try again."
                                                .to_string(),
                                        );
                                        break;
                                    }
                                };

                                let output = match output {
                                    Ok(output) => output,
                                    Err(err) => {
                                        warn!(
                                            trace_id = %trace_spawn,
                                            error = %err,
                                            "failed to collect net profiler output"
                                        );
                                        last_error = Some(
	                                            "Failed to collect per-app network stats. Please try again."
	                                                .to_string(),
	                                        );
                                        break;
                                    }
                                };

                                if output.exit_code.unwrap_or_default() != 0 {
                                    let stderr_lower = output.stderr.to_lowercase();
                                    let stdout_lower = output.stdout.to_lowercase();
                                    let is_unsupported = stderr_lower.contains("no such file")
                                        || stderr_lower.contains("permission denied")
                                        || stdout_lower.contains("no such file")
                                        || stdout_lower.contains("permission denied");

                                    if is_unsupported {
                                        unsupported_sources += 1;
                                        continue;
                                    }

                                    warn!(
                                        trace_id = %trace_spawn,
                                        exit_code = ?output.exit_code,
                                        stderr = %output.stderr,
                                        "net profiler adb shell returned non-zero exit code"
                                    );
                                    last_error =
                                        Some("Failed to collect per-app network stats".to_string());
                                    break;
                                }

                                match parse_xt_qtaguid_stats(&output.stdout) {
                                    Ok(value) => {
                                        totals = Some(value);
                                        stats_source = Some(NetStatsSource::ProcXtQtaguid);
                                        break;
                                    }
                                    Err(err) => {
                                        warn!(
                                            trace_id = %trace_spawn,
                                            error = %err,
                                            "failed to parse xt_qtaguid stats; falling back"
                                        );
                                        unsupported_sources += 1;
                                        continue;
                                    }
                                }
                            }
                            NetStatsSource::DumpsysNetstats => {
                                let args = vec![
                                    "-s".to_string(),
                                    serial_spawn.clone(),
                                    "shell".to_string(),
                                    "dumpsys netstats".to_string(),
                                ];

                                let output = {
                                    let _permit = scheduler.acquire_global();
                                    let device_lock = scheduler.device_lock(&serial_spawn);
                                    let device_guard = device_lock.lock().ok();
                                    device_guard.map(|_guard| {
                                        run_command_with_timeout(
                                            &adb_program_spawn,
                                            &args,
                                            Duration::from_secs(5),
                                            &trace_spawn,
                                        )
                                    })
                                };

                                let output = match output {
                                    Some(output) => output,
                                    None => {
                                        last_error = Some(
                                            "Failed to access the device. Please try again."
                                                .to_string(),
                                        );
                                        break;
                                    }
                                };

                                let output = match output {
                                    Ok(output) => output,
                                    Err(err) => {
                                        warn!(
                                            trace_id = %trace_spawn,
                                            error = %err,
                                            "failed to collect dumpsys netstats output"
                                        );
                                        last_error = Some(
	                                            "Failed to collect per-app network stats. Please try again."
	                                                .to_string(),
	                                        );
                                        break;
                                    }
                                };

                                if output.exit_code.unwrap_or_default() != 0 {
                                    let stderr_lower = output.stderr.to_lowercase();
                                    let stdout_lower = output.stdout.to_lowercase();
                                    let is_unsupported = stderr_lower
                                        .contains("can't find service")
                                        || stderr_lower.contains("not found")
                                        || stderr_lower.contains("permission denied")
                                        || stdout_lower.contains("can't find service")
                                        || stdout_lower.contains("not found")
                                        || stdout_lower.contains("permission denied");

                                    if is_unsupported {
                                        unsupported_sources += 1;
                                        continue;
                                    }

                                    warn!(
                                        trace_id = %trace_spawn,
                                        exit_code = ?output.exit_code,
                                        stderr = %output.stderr,
                                        "dumpsys netstats returned non-zero exit code"
                                    );
                                    last_error =
                                        Some("Failed to collect per-app network stats".to_string());
                                    break;
                                }

                                match parse_dumpsys_netstats_app_uid_stats(&output.stdout) {
                                    Ok(value) => {
                                        totals = Some(value);
                                        stats_source = Some(NetStatsSource::DumpsysNetstats);
                                        break;
                                    }
                                    Err(err) => {
                                        warn!(
                                            trace_id = %trace_spawn,
                                            error = %err,
                                            "failed to parse dumpsys netstats uid map; falling back"
                                        );
                                        unsupported_sources += 1;
                                        continue;
                                    }
                                }
                            }
                        }
                    }

                    let totals = match totals {
                        Some(totals) => totals,
                        None => {
                            if unsupported_sources >= candidate_count {
                                unsupported = true;
                                let snapshot = NetProfilerSnapshot {
                                    ts_ms: Utc::now().timestamp_millis(),
                                    dt_ms: None,
                                    rows: vec![],
                                    unsupported: true,
                                };
                                emit_net_profiler_event(
                                &app_emit,
                                NetProfilerEvent {
                                    serial: serial_spawn.clone(),
                                    snapshot: Some(snapshot),
                                    error: Some(
                                        "Per-app network profiler is not supported on this device."
                                            .to_string(),
                                    ),
                                    trace_id: trace_spawn.clone(),
                                },
                            );
                                std::thread::sleep(Duration::from_millis(200));
                                continue;
                            }

                            emit_net_profiler_event(
                                &app_emit,
                                NetProfilerEvent {
                                    serial: serial_spawn.clone(),
                                    snapshot: None,
                                    error: Some(last_error.unwrap_or_else(|| {
                                        "Failed to collect per-app network stats".to_string()
                                    })),
                                    trace_id: trace_spawn.clone(),
                                },
                            );
                            sleep_with_stop(interval, &stop_flag);
                            continue;
                        }
                    };

                    let sample_instant = Instant::now();
                    let dt_ms_u128 = prev_instant
                        .map(|prev| sample_instant.duration_since(prev).as_millis())
                        .filter(|value| *value > 0);
                    let dt_ms_u64 = dt_ms_u128.map(|value| value.min(u64::MAX as u128) as u64);

                    let pinned = match pinned_uids.read() {
                        Ok(guard) => guard.clone(),
                        Err(_) => {
                            warn!(trace_id = %trace_spawn, "net profiler pinned uids lock poisoned");
                            vec![]
                        }
                    };

                    let rows = build_net_usage_rows(
                        &totals,
                        prev_totals.as_ref(),
                        dt_ms_u128,
                        &packages_by_uid,
                        &pinned,
                        top_n,
                    );

                    let snapshot = NetProfilerSnapshot {
                        ts_ms: Utc::now().timestamp_millis(),
                        dt_ms: dt_ms_u64,
                        rows,
                        unsupported: false,
                    };
                    emit_net_profiler_event(
                        &app_emit,
                        NetProfilerEvent {
                            serial: serial_spawn.clone(),
                            snapshot: Some(snapshot),
                            error: None,
                            trace_id: trace_spawn.clone(),
                        },
                    );

                    prev_totals = Some(totals);
                    prev_instant = Some(sample_instant);

                    let elapsed = loop_started.elapsed();
                    if elapsed < interval {
                        sleep_with_stop(interval - elapsed, &stop_flag);
                    }
                }
            })
        },
    )?;

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

fn sleep_with_stop(duration: Duration, stop_flag: &Arc<AtomicBool>) {
    let mut remaining = duration;
    let chunk = Duration::from_millis(50);
    while remaining > Duration::from_millis(0) {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }
        let step = if remaining > chunk { chunk } else { remaining };
        std::thread::sleep(step);
        remaining = remaining.saturating_sub(step);
    }
}

fn parse_surfaceflinger_latency_ns(output: &str) -> Option<u64> {
    output
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .and_then(|line| line.parse::<u64>().ok())
        .filter(|value| *value > 0)
}

fn compute_refresh_hz_x100(period_ns: u64) -> Option<u16> {
    if period_ns == 0 {
        return None;
    }
    let hz_x100 = (100_000_000_000u128 / (period_ns as u128)).min(u16::MAX as u128) as u16;
    if hz_x100 == 0 {
        return None;
    }
    Some(hz_x100)
}

// SurfaceFlinger output parsing is intentionally done via shell pipelines for missed frame totals.

#[tauri::command(async)]
pub fn stop_perf_monitor(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    stop_perf_monitor_inner(serial, &state.perf_monitors, &trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn stop_net_profiler(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    stop_net_profiler_inner(serial, &state.net_profilers, &trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn set_net_profiler_pinned_uids(
    serial: String,
    pinned_uids: Option<Vec<u32>>,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    set_net_profiler_pinned_uids_inner(serial, pinned_uids, &state.net_profilers, &trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: true,
    })
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

#[tauri::command(async)]
pub fn start_bluetooth_monitor(
    serial: String,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let mut guard = state
        .bluetooth_monitors
        .lock()
        .map_err(|_| AppError::system("Bluetooth monitor registry locked", &trace_id))?;
    if guard.contains_key(&serial) {
        return Err(AppError::validation(
            "Bluetooth monitor already running",
            &trace_id,
        ));
    }

    let handle =
        start_bluetooth_monitor_service(app, serial.clone(), trace_id.clone(), adb_program);
    guard.insert(serial, handle);

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
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
        None => {
            return Err(AppError::validation(
                "Bluetooth monitor not running",
                &trace_id,
            ))
        }
    };
    handle.stop();

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
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
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("bugreport_{}_{}.zip", serial, timestamp);
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

fn prepare_bugreport_logcat_inner(
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

fn search_bugreport_logcat_inner(
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

fn query_bugreport_logcat_around_inner(
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

fn map_bugreport_log_query_error(err: String, trace_id: &str) -> AppError {
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
    let child = Command::new(adb_program)
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
