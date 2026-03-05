#[cfg(test)]
mod tests {
    use std::process::{Child, Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    use super::super::service::{sleep_with_stop_flag, stop_child_process};

    fn spawn_sleep_child() -> Child {
        if cfg!(windows) {
            Command::new("cmd.exe")
                .args(["/C", "ping -n 30 127.0.0.1 > nul"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn windows child")
        } else {
            Command::new("sh")
                .args(["-c", "sleep 30"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn unix child")
        }
    }

    #[test]
    fn sleep_with_stop_flag_returns_early_when_stop_is_requested() {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_for_thread = Arc::clone(&stop_flag);
        let join = thread::spawn(move || {
            thread::sleep(Duration::from_millis(40));
            stop_flag_for_thread.store(true, Ordering::Relaxed);
        });

        let started = Instant::now();
        let interrupted = sleep_with_stop_flag(&stop_flag, Duration::from_secs(2));
        join.join().expect("join stop request");

        assert!(interrupted, "expected sleep to stop early");
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "expected early wakeup, took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn stop_child_process_terminates_running_child() {
        let child = spawn_sleep_child();
        let shared_child = Arc::new(Mutex::new(Some(child)));

        stop_child_process(&shared_child, "test-trace", "test child");

        let mut guard = shared_child.lock().expect("lock child");
        let child = guard
            .as_mut()
            .expect("child remains available for inspection");
        let status = child.try_wait().expect("poll child status");
        assert!(status.is_some(), "expected child process to exit");
    }
}
