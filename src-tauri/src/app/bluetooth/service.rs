use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tracing::warn;

use crate::app::adb::runner::run_command_with_timeout;

use super::models::{ParsedEvent, ParsedSnapshot, StateSummary};
use super::parser::BluetoothParser;
use super::state_machine::BluetoothStateMachine;

const DEFAULT_INTERVAL_S: f64 = 5.0;
const MIN_INTERVAL_S: f64 = 2.0;
const MAX_INTERVAL_S: f64 = 10.0;
const IDLE_THRESHOLD_S: f64 = 30.0;

pub struct BluetoothMonitorHandle {
    stop_flag: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl BluetoothMonitorHandle {
    pub fn stop(self) {
        self.stop_flag.store(true, Ordering::Relaxed);
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
    let serial_snapshot = serial.clone();
    let serial_logcat = serial.clone();
    let app_snapshot = app.clone();
    let app_logcat = app.clone();
    let stop_snapshot = Arc::clone(&stop_flag);
    let stop_logcat = Arc::clone(&stop_flag);
    let parser_snapshot = Arc::clone(&parser);
    let parser_logcat = Arc::clone(&parser);
    let trace_snapshot = trace_id.clone();
    let trace_logcat = trace_id.clone();
    let adb_program_snapshot = adb_program.clone();
    let adb_program_logcat = adb_program;

    threads.push(thread::spawn(move || {
        let mut machine = BluetoothStateMachine::new(3.0, 3.0);
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
            if let Ok(output) = output {
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
                        start.elapsed().as_secs_f64(),
                    );
                    let update = machine.apply_snapshot(&snapshot);
                    emit_snapshot(&app_snapshot, snapshot, &trace_snapshot);
                    if update.changed {
                        emit_state(&app_snapshot, update.summary, &trace_snapshot);
                    }
                    current_interval =
                        adjust_interval(current_interval, last_activity, Instant::now());
                }
            }
            let elapsed = start.elapsed();
            let sleep_for = Duration::from_secs_f64(current_interval).saturating_sub(elapsed);
            if sleep_for > Duration::from_millis(0) {
                thread::sleep(sleep_for);
            }
        }
    }));

    threads.push(thread::spawn(move || {
        let mut machine = BluetoothStateMachine::new(3.0, 3.0);
        let args = vec![
            "-s".to_string(),
            serial_logcat.clone(),
            "logcat".to_string(),
            "-b".to_string(),
            "all".to_string(),
        ];
        let mut child = match std::process::Command::new(&adb_program_logcat)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                warn!(trace_id = %trace_logcat, error = %err, "failed to start bluetooth logcat");
                return;
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => return,
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
                let update = machine.apply_event(&event);
                emit_event(&app_logcat, event, &trace_logcat);
                if update.changed {
                    emit_state(&app_logcat, update.summary, &trace_logcat);
                }
            }
        }
        if let Err(err) = child.kill() {
            warn!(trace_id = %trace_logcat, error = %err, "failed to stop bluetooth logcat child");
        }
    }));

    BluetoothMonitorHandle { stop_flag, threads }
}

fn emit_snapshot(app: &AppHandle, snapshot: ParsedSnapshot, trace_id: &str) {
    let payload = serde_json::json!({
        "trace_id": trace_id,
        "snapshot": snapshot,
    });
    let _ = app.emit("bluetooth-snapshot", payload);
}

fn emit_event(app: &AppHandle, event: ParsedEvent, trace_id: &str) {
    let payload = serde_json::json!({
        "trace_id": trace_id,
        "event": event,
    });
    let _ = app.emit("bluetooth-event", payload);
}

fn emit_state(app: &AppHandle, summary: StateSummary, trace_id: &str) {
    let payload = serde_json::json!({
        "trace_id": trace_id,
        "state": summary,
    });
    let _ = app.emit("bluetooth-state", payload);
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

mod fxhash {
    pub fn hash64(input: &str) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        input.hash(&mut hasher);
        hasher.finish()
    }
}
