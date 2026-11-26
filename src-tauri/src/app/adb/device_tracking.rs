use std::io::{BufRead, Read};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tracing::warn;

use crate::app::adb::runner::new_background_command;
use crate::app::adb::track_devices::TrackDevicesStreamParser;
use crate::app::models::{DeviceCapabilities, DeviceInfo};

pub const DEVICE_TRACKING_SNAPSHOT_EVENT: &str = "device-tracking-snapshot";

pub struct DeviceTrackerHandle {
    stop_flag: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    join: JoinHandle<()>,
}

impl DeviceTrackerHandle {
    pub fn stop(self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        let _ = self.join.join();
    }
}

pub fn start_device_tracker(
    app: AppHandle,
    trace_id: String,
    adb_program: String,
) -> DeviceTrackerHandle {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let child_slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let stop_thread = Arc::clone(&stop_flag);
    let child_thread = Arc::clone(&child_slot);

    let join = thread::spawn(move || {
        let try_spawn = |args: &[&str]| -> Option<Child> {
            match new_background_command(&adb_program)
                .args(args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(child) => Some(child),
                Err(err) => {
                    warn!(
                        trace_id = %trace_id,
                        error = %err,
                        "failed to spawn adb device tracker"
                    );
                    None
                }
            }
        };

        let args_primary = ["track-devices", "-l"];
        let args_fallback = ["track-devices"];

        let mut backoff_ms = 200u64;
        let backoff_max_ms = 5_000u64;
        let mut use_fallback = false;

        loop {
            if stop_thread.load(Ordering::Relaxed) {
                return;
            }

            let spawn_args: &[&str] = if use_fallback {
                &args_fallback
            } else {
                &args_primary
            };
            let child = match try_spawn(spawn_args) {
                Some(child) => child,
                None => {
                    thread::sleep(Duration::from_millis(backoff_ms));
                    backoff_ms = (backoff_ms * 2).min(backoff_max_ms);
                    continue;
                }
            };

            // Store child so stop() can kill it even if the reader is blocked.
            {
                let mut guard = match child_thread.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                if let Some(mut previous) = guard.take() {
                    // Reap any stale child before replacing the slot.
                    let _ = previous.wait();
                }
                *guard = Some(child);
            }

            let (stdout, stderr) = {
                let mut guard = match child_thread.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let Some(child) = guard.as_mut() else {
                    return;
                };
                let stdout = match child.stdout.take() {
                    Some(stdout) => stdout,
                    None => return,
                };
                let stderr = child.stderr.take();
                (stdout, stderr)
            };

            let stderr_join = if let Some(stderr) = stderr {
                let trace_stderr = trace_id.clone();
                let stop_stderr = Arc::clone(&stop_thread);
                Some(thread::spawn(move || {
                    let reader = std::io::BufReader::new(stderr);
                    let mut reported = false;
                    for line in reader.lines() {
                        if stop_stderr.load(Ordering::Relaxed) {
                            break;
                        }
                        let line = match line {
                            Ok(line) => line,
                            Err(_) => break,
                        };
                        if reported || line.trim().is_empty() {
                            continue;
                        }
                        reported = true;
                        warn!(
                            trace_id = %trace_stderr,
                            stderr = %line,
                            "adb device tracker stderr"
                        );
                    }
                }))
            } else {
                None
            };

            let started = Instant::now();
            let mut emitted_any = false;

            let mut reader = std::io::BufReader::new(stdout);
            let mut parser = TrackDevicesStreamParser::new();
            let mut chunk = [0u8; 4096];
            loop {
                if stop_thread.load(Ordering::Relaxed) {
                    break;
                }
                let bytes_read = match reader.read(&mut chunk) {
                    Ok(bytes_read) => bytes_read,
                    Err(err) => {
                        warn!(
                            trace_id = %trace_id,
                            error = %err,
                            "failed to read adb device tracker stdout"
                        );
                        break;
                    }
                };
                if bytes_read == 0 {
                    break;
                }

                for snapshot in parser.push_chunk(&chunk[..bytes_read]) {
                    emitted_any = true;
                    backoff_ms = 200;
                    let devices = snapshot
                        .into_iter()
                        .map(|summary| DeviceInfo {
                            summary,
                            detail: None,
                            capabilities: DeviceCapabilities::android_default(),
                        })
                        .collect::<Vec<_>>();
                    let payload = serde_json::json!({
                        "trace_id": trace_id,
                        "devices": devices,
                    });
                    let _ = app.emit(DEVICE_TRACKING_SNAPSHOT_EVENT, payload);
                }
            }

            // Emit the last buffered snapshot (if any) before exiting.
            for snapshot in parser.flush() {
                emitted_any = true;
                backoff_ms = 200;
                let devices = snapshot
                    .into_iter()
                    .map(|summary| DeviceInfo {
                        summary,
                        detail: None,
                        capabilities: DeviceCapabilities::android_default(),
                    })
                    .collect::<Vec<_>>();
                let payload = serde_json::json!({
                    "trace_id": trace_id,
                    "devices": devices,
                });
                let _ = app.emit(DEVICE_TRACKING_SNAPSHOT_EVENT, payload);
            }

            let exit_status = if let Ok(mut guard) = child_thread.lock() {
                if let Some(mut child) = guard.take() {
                    if stop_thread.load(Ordering::Relaxed) {
                        let _ = child.kill();
                    }
                    child.wait().ok()
                } else {
                    None
                }
            } else {
                None
            };
            if let Some(join) = stderr_join {
                let _ = join.join();
            }

            if stop_thread.load(Ordering::Relaxed) {
                return;
            }

            // If `-l` is unsupported, adb exits quickly with a non-zero code before emitting.
            // Retry immediately without `-l` to keep basic tracking functional without a 1s stall.
            if !use_fallback
                && !emitted_any
                && started.elapsed() < Duration::from_secs(2)
                && exit_status
                    .and_then(|status| status.code())
                    .unwrap_or_default()
                    != 0
            {
                warn!(
                    trace_id = %trace_id,
                    "adb track-devices -l exited quickly; retrying without -l"
                );
                use_fallback = true;
                continue;
            }

            warn!(
                trace_id = %trace_id,
                exit_code = ?exit_status.and_then(|status| status.code()),
                "adb device tracker exited"
            );

            // Unexpected exit: bounded exponential backoff restart.
            thread::sleep(Duration::from_millis(backoff_ms));
            backoff_ms = (backoff_ms * 2).min(backoff_max_ms);
        }
    });

    DeviceTrackerHandle {
        stop_flag,
        child: child_slot,
        join,
    }
}
