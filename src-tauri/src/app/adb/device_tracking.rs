use std::io::BufRead;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tracing::warn;

use crate::app::adb::track_devices::TrackDevicesStreamParser;
use crate::app::models::DeviceInfo;

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
            match Command::new(&adb_program)
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

        loop {
            if stop_thread.load(Ordering::Relaxed) {
                return;
            }

            let mut child = match try_spawn(&args_primary) {
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
                    Err(_) => {
                        let _ = child.kill();
                        return;
                    }
                };
                if let Some(mut previous) = guard.take() {
                    // `-l` fallback replaces an already-exited child; wait() reaps it
                    // so we do not leak a zombie process on Unix.
                    let _ = previous.wait();
                }
                *guard = Some(child);
            }

            // If `-l` is unsupported, adb tends to exit quickly with a non-zero code.
            // Detect that and retry without `-l` to keep basic tracking functional.
            let start = Instant::now();
            let mut did_fallback = false;
            let mut should_respawn = false;
            loop {
                if stop_thread.load(Ordering::Relaxed) {
                    return;
                }
                let exit = {
                    let mut guard = match child_thread.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    let Some(child) = guard.as_mut() else {
                        return;
                    };
                    child.try_wait().ok().flatten()
                };
                if let Some(status) = exit {
                    if status.code().unwrap_or_default() != 0
                        && start.elapsed() < Duration::from_secs(1)
                    {
                        warn!(
                            trace_id = %trace_id,
                            "adb track-devices -l exited quickly; retrying without -l"
                        );
                        did_fallback = true;
                        break;
                    }
                    warn!(
                        trace_id = %trace_id,
                        exit_code = ?status.code(),
                        "adb device tracker exited"
                    );
                    should_respawn = true;
                    break;
                }
                if start.elapsed() >= Duration::from_secs(1) {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }

            if should_respawn {
                if let Ok(mut guard) = child_thread.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                thread::sleep(Duration::from_millis(backoff_ms));
                backoff_ms = (backoff_ms * 2).min(backoff_max_ms);
                continue;
            }

            if did_fallback {
                let mut child = match try_spawn(&args_fallback) {
                    Some(child) => child,
                    None => {
                        thread::sleep(Duration::from_millis(backoff_ms));
                        backoff_ms = (backoff_ms * 2).min(backoff_max_ms);
                        continue;
                    }
                };
                let mut guard = match child_thread.lock() {
                    Ok(guard) => guard,
                    Err(_) => {
                        let _ = child.kill();
                        return;
                    }
                };
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

            // Successful spawn: reset backoff for the next unexpected exit.
            backoff_ms = 200;

            let reader = std::io::BufReader::new(stdout);
            let mut parser = TrackDevicesStreamParser::new();
            for line in reader.lines() {
                if stop_thread.load(Ordering::Relaxed) {
                    break;
                }
                let line = match line {
                    Ok(line) => line,
                    Err(err) => {
                        warn!(
                            trace_id = %trace_id,
                            error = %err,
                            "failed to read adb device tracker stdout"
                        );
                        break;
                    }
                };

                let maybe_snapshot = parser.push_line(&line);
                if let Some(snapshot) = maybe_snapshot {
                    let devices = snapshot
                        .into_iter()
                        .map(|summary| DeviceInfo {
                            summary,
                            detail: None,
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
            if let Some(snapshot) = parser.flush() {
                let devices = snapshot
                    .into_iter()
                    .map(|summary| DeviceInfo {
                        summary,
                        detail: None,
                    })
                    .collect::<Vec<_>>();
                let payload = serde_json::json!({
                    "trace_id": trace_id,
                    "devices": devices,
                });
                let _ = app.emit(DEVICE_TRACKING_SNAPSHOT_EVENT, payload);
            }

            if let Ok(mut guard) = child_thread.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            if let Some(join) = stderr_join {
                let _ = join.join();
            }

            if stop_thread.load(Ordering::Relaxed) {
                return;
            }

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
