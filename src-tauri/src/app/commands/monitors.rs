use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use tauri::{AppHandle, Emitter, State};
use tracing::warn;

use crate::app::adb::runner::run_command_with_timeout;
use crate::app::error::AppError;
use crate::app::models::{CommandResponse, NetProfilerSnapshot, PerfSnapshot};
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
use crate::app::state::{AppState, NetProfilerHandle, PerfMonitorHandle};

use super::{ensure_non_empty, get_adb_program, resolve_trace_id};

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

pub(super) fn clamp_perf_interval_ms(input: Option<u64>) -> u64 {
    let value = input.unwrap_or(1000);
    value.clamp(500, 5000)
}

pub(super) fn clamp_net_profiler_interval_ms(input: Option<u64>) -> u64 {
    let value = input.unwrap_or(2000);
    value.clamp(500, 5000)
}

pub(super) fn clamp_net_profiler_top_n(input: Option<u32>) -> usize {
    let value = input.unwrap_or(20);
    let clamped = value.clamp(5, 50);
    clamped as usize
}

pub(super) fn sanitize_net_profiler_pinned_uids(
    input: Option<Vec<u32>>,
    top_n: usize,
    trace_id: &str,
) -> Result<Vec<u32>, AppError> {
    const MAX_PINNED_UIDS: usize = 5;
    let mut unique: Vec<u32> = Vec::new();
    let mut seen = HashSet::<u32>::new();
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

pub(super) fn start_perf_monitor_inner(
    serial: String,
    registry: &Mutex<HashMap<String, PerfMonitorHandle>>,
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

pub(super) fn stop_perf_monitor_inner(
    serial: String,
    registry: &Mutex<HashMap<String, PerfMonitorHandle>>,
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

pub(super) fn start_net_profiler_inner(
    serial: String,
    registry: &Mutex<HashMap<String, NetProfilerHandle>>,
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

pub(super) fn stop_net_profiler_inner(
    serial: String,
    registry: &Mutex<HashMap<String, NetProfilerHandle>>,
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

pub(super) fn set_net_profiler_pinned_uids_inner(
    serial: String,
    pinned_uids: Option<Vec<u32>>,
    registry: &Mutex<HashMap<String, NetProfilerHandle>>,
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
    registry: &Mutex<HashMap<String, PerfMonitorHandle>>,
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
    registry: &Mutex<HashMap<String, PerfMonitorHandle>>,
    trace_id: &str,
) -> Result<bool, AppError> {
    stop_perf_monitor_inner(serial, registry, trace_id)
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

pub(super) struct PerfSnapshotInput {
    pub(super) ts_ms: i64,
    pub(super) cpu_prev: Option<CpuTotals>,
    pub(super) cpu_curr: CpuTotals,
    pub(super) core_percents_x100: Vec<Option<u16>>,
    pub(super) core_freq_khz: Vec<Option<u32>>,
    pub(super) mem: MemTotals,
    pub(super) net_prev: Option<NetTotals>,
    pub(super) net_curr: NetTotals,
    pub(super) dt_ms: Option<u128>,
    pub(super) battery: BatteryTotals,
    pub(super) display_refresh_hz_x100: Option<u16>,
    pub(super) missed_frames_per_sec_x100: Option<u16>,
}

pub(super) fn build_perf_snapshot(input: PerfSnapshotInput) -> PerfSnapshot {
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
                                        if let Some(rate_x100) =
                                            (delta * 100_000u128).checked_div(dt_ms)
                                        {
                                            let per_sec_x100 =
                                                rate_x100.min(u16::MAX as u128) as u16;
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

pub(super) fn parse_surfaceflinger_latency_ns(output: &str) -> Option<u64> {
    output
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .and_then(|line| line.parse::<u64>().ok())
        .filter(|value| *value > 0)
}

pub(super) fn compute_refresh_hz_x100(period_ns: u64) -> Option<u16> {
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
