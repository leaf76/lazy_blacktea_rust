use std::io::BufRead;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tracing::warn;

use crate::app::adb::runner::run_command_with_timeout;

use super::models::{ParsedEvent, ParsedSnapshot, StateSummary};
use super::parser::BluetoothParser;
use super::state_machine::{BluetoothStateMachine, StateUpdate};

const DEFAULT_INTERVAL_S: f64 = 5.0;
const MIN_INTERVAL_S: f64 = 2.0;
const MAX_INTERVAL_S: f64 = 10.0;
const IDLE_THRESHOLD_S: f64 = 30.0;

pub struct BluetoothMonitorHandle {
    stop_flag: Arc<AtomicBool>,
    logcat_child: Arc<Mutex<Option<Child>>>,
    trace_id: String,
    threads: Vec<JoinHandle<()>>,
}

impl BluetoothMonitorHandle {
    pub fn stop(self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        stop_child_process(&self.logcat_child, &self.trace_id, "bluetooth logcat");
        for thread in self.threads {
            let _ = thread.join();
        }
    }
}

pub fn start_bluetooth_monitor(
    app: AppHandle,
    serial: String,
    trace_id: String,
    adb_program: String,
) -> BluetoothMonitorHandle {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let mut threads = Vec::new();
    let parser = Arc::new(BluetoothParser::default());
    let machine = Arc::new(Mutex::new(BluetoothStateMachine::new(3.0, 3.0)));
    let logcat_child = Arc::new(Mutex::new(None));
    let serial_snapshot = serial.clone();
    let serial_logcat = serial.clone();
    let app_snapshot = app.clone();
    let app_logcat = app.clone();
    let stop_snapshot = Arc::clone(&stop_flag);
    let stop_logcat = Arc::clone(&stop_flag);
    let parser_snapshot = Arc::clone(&parser);
    let parser_logcat = Arc::clone(&parser);
    let machine_snapshot = Arc::clone(&machine);
    let machine_logcat = Arc::clone(&machine);
    let logcat_child_for_thread = Arc::clone(&logcat_child);
    let trace_snapshot = trace_id.clone();
    let trace_logcat = trace_id.clone();
    let adb_program_snapshot = adb_program.clone();
    let adb_program_logcat = adb_program;

    threads.push(thread::spawn(move || {
        let mut current_interval = DEFAULT_INTERVAL_S;
        let mut last_activity: Option<Instant> = None;
        let mut last_snapshot_hash: Option<u64> = None;
        while !stop_snapshot.load(Ordering::Relaxed) {
            let start = Instant::now();
            let snapshot_cmd = vec![
                "-s".to_string(),
                serial_snapshot.clone(),
                "shell".to_string(),
                "sh".to_string(),
                "-c".to_string(),
                "dumpsys bluetooth_manager && echo '---SEPARATOR---' && dumpsys bluetooth_adapter"
                    .to_string(),
            ];
            let output = run_command_with_timeout(
                &adb_program_snapshot,
                &snapshot_cmd,
                Duration::from_secs(5),
                &trace_snapshot,
            );
            match output {
                Ok(output) => {
                    let raw = output.stdout;
                    if !raw.trim().is_empty() {
                        let hash = fxhash::hash64(&raw);
                        let changed = last_snapshot_hash.map(|prev| prev != hash).unwrap_or(true);
                        last_snapshot_hash = Some(hash);
                        if changed {
                            last_activity = Some(Instant::now());
                        }
                        let snapshot = parser_snapshot.parse_snapshot(
                            &serial_snapshot,
                            &raw,
                            current_timestamp(),
                        );
                        let update = apply_snapshot_update(&machine_snapshot, &snapshot, &trace_snapshot);
                        emit_snapshot(&app_snapshot, snapshot, &trace_snapshot);
                        if let Some(update) = update {
                            if update.changed {
                                emit_state(&app_snapshot, update.summary, &trace_snapshot);
                            }
                        }
                        current_interval =
                            adjust_interval(current_interval, last_activity, Instant::now());
                    }
                }
                Err(err) => {
                    warn!(trace_id = %trace_snapshot, error = %err, "failed to capture bluetooth snapshot");
                }
            }
            let elapsed = start.elapsed();
            let sleep_for = Duration::from_secs_f64(current_interval).saturating_sub(elapsed);
            if sleep_for > Duration::from_millis(0)
                && sleep_with_stop_flag(&stop_snapshot, sleep_for)
            {
                break;
            }
        }
    }));

    threads.push(thread::spawn(move || {
        let args = vec![
            "-s".to_string(),
            serial_logcat.clone(),
            "logcat".to_string(),
            "-b".to_string(),
            "all".to_string(),
        ];
        let child = match Command::new(&adb_program_logcat)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                warn!(trace_id = %trace_logcat, error = %err, "failed to start bluetooth logcat");
                return;
            }
        };

        if let Ok(mut guard) = logcat_child_for_thread.lock() {
            *guard = Some(child);
        } else {
            warn!(trace_id = %trace_logcat, "failed to lock bluetooth logcat child handle");
            return;
        }

        let stdout = match take_logcat_stdout(&logcat_child_for_thread, &trace_logcat) {
            Some(stdout) => stdout,
            None => {
                stop_child_process(&logcat_child_for_thread, &trace_logcat, "bluetooth logcat");
                return;
            }
        };
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            if stop_logcat.load(Ordering::Relaxed) {
                break;
            }
            let line = match line {
                Ok(line) => line,
                Err(err) => {
                    warn!(trace_id = %trace_logcat, error = %err, "failed to read bluetooth logcat stdout");
                    break;
                }
            };
            if let Some(event) =
                parser_logcat.parse_log_line(&serial_logcat, &line, current_timestamp())
            {
                let update = apply_event_update(&machine_logcat, &event, &trace_logcat);
                emit_event(&app_logcat, event, &trace_logcat);
                if let Some(update) = update {
                    if update.changed {
                        emit_state(&app_logcat, update.summary, &trace_logcat);
                    }
                }
            }
        }
        stop_child_process(&logcat_child_for_thread, &trace_logcat, "bluetooth logcat");
    }));

    BluetoothMonitorHandle {
        stop_flag,
        logcat_child,
        trace_id,
        threads,
    }
}

fn emit_snapshot(app: &AppHandle, snapshot: ParsedSnapshot, trace_id: &str) {
    let payload = serde_json::json!({
        "trace_id": trace_id,
        "snapshot": snapshot,
    });
    if let Err(err) = app.emit("bluetooth-snapshot", payload) {
        warn!(trace_id = %trace_id, error = %err, "failed to emit bluetooth snapshot");
    }
}

fn emit_event(app: &AppHandle, event: ParsedEvent, trace_id: &str) {
    let payload = serde_json::json!({
        "trace_id": trace_id,
        "event": event,
    });
    if let Err(err) = app.emit("bluetooth-event", payload) {
        warn!(trace_id = %trace_id, error = %err, "failed to emit bluetooth event");
    }
}

fn emit_state(app: &AppHandle, summary: StateSummary, trace_id: &str) {
    let payload = serde_json::json!({
        "trace_id": trace_id,
        "state": summary,
    });
    if let Err(err) = app.emit("bluetooth-state", payload) {
        warn!(trace_id = %trace_id, error = %err, "failed to emit bluetooth state");
    }
}

fn adjust_interval(current: f64, last_activity: Option<Instant>, now: Instant) -> f64 {
    let Some(last) = last_activity else {
        return current;
    };
    let idle_time = now.duration_since(last).as_secs_f64();
    if idle_time < IDLE_THRESHOLD_S {
        current.clamp(MIN_INTERVAL_S, DEFAULT_INTERVAL_S)
    } else {
        let slowdown = (1.0 + (idle_time - IDLE_THRESHOLD_S) / 60.0).min(2.0);
        (DEFAULT_INTERVAL_S * slowdown).min(MAX_INTERVAL_S)
    }
}

fn current_timestamp() -> f64 {
    let now = std::time::SystemTime::now();
    now.duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn apply_snapshot_update(
    machine: &Arc<Mutex<BluetoothStateMachine>>,
    snapshot: &ParsedSnapshot,
    trace_id: &str,
) -> Option<StateUpdate> {
    let mut guard = match machine.lock() {
        Ok(guard) => guard,
        Err(_) => {
            warn!(trace_id = %trace_id, "failed to lock bluetooth state machine for snapshot");
            return None;
        }
    };
    Some(guard.apply_snapshot(snapshot))
}

fn apply_event_update(
    machine: &Arc<Mutex<BluetoothStateMachine>>,
    event: &ParsedEvent,
    trace_id: &str,
) -> Option<StateUpdate> {
    let mut guard = match machine.lock() {
        Ok(guard) => guard,
        Err(_) => {
            warn!(trace_id = %trace_id, "failed to lock bluetooth state machine for event");
            return None;
        }
    };
    Some(guard.apply_event(event))
}

fn take_logcat_stdout(
    shared_child: &Arc<Mutex<Option<Child>>>,
    trace_id: &str,
) -> Option<std::process::ChildStdout> {
    let mut guard = match shared_child.lock() {
        Ok(guard) => guard,
        Err(_) => {
            warn!(trace_id = %trace_id, "failed to lock bluetooth logcat child for stdout");
            return None;
        }
    };
    let child = match guard.as_mut() {
        Some(child) => child,
        None => {
            warn!(trace_id = %trace_id, "bluetooth logcat child missing before stdout capture");
            return None;
        }
    };
    match child.stdout.take() {
        Some(stdout) => Some(stdout),
        None => {
            warn!(trace_id = %trace_id, "failed to capture bluetooth logcat stdout");
            None
        }
    }
}

pub(super) fn stop_child_process(
    shared_child: &Arc<Mutex<Option<Child>>>,
    trace_id: &str,
    label: &str,
) {
    let mut guard = match shared_child.lock() {
        Ok(guard) => guard,
        Err(_) => {
            warn!(trace_id = %trace_id, process = %label, "failed to lock child handle");
            return;
        }
    };
    let Some(child) = guard.as_mut() else {
        return;
    };

    match child.try_wait() {
        Ok(Some(_)) => return,
        Ok(None) => {}
        Err(err) => {
            warn!(trace_id = %trace_id, process = %label, error = %err, "failed to poll child before stop");
        }
    }

    if let Err(err) = child.kill() {
        warn!(trace_id = %trace_id, process = %label, error = %err, "failed to kill child process");
    }
    if let Err(err) = child.wait() {
        warn!(trace_id = %trace_id, process = %label, error = %err, "failed to wait for child process");
    }
}

pub(super) fn sleep_with_stop_flag(stop_flag: &AtomicBool, duration: Duration) -> bool {
    let started = Instant::now();
    loop {
        if stop_flag.load(Ordering::Relaxed) {
            return true;
        }
        let elapsed = started.elapsed();
        if elapsed >= duration {
            return false;
        }
        let remaining = duration.saturating_sub(elapsed);
        thread::sleep(remaining.min(Duration::from_millis(100)));
    }
}

mod fxhash {
    pub fn hash64(input: &str) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        input.hash(&mut hasher);
        hasher.finish()
    }
}
