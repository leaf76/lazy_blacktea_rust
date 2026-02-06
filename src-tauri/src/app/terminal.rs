use crate::app::models::TerminalEvent;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::warn;

pub const TERMINAL_EVENT_NAME: &str = "terminal-event";

pub struct TerminalSession {
    pub serial: String,
    pub session_id: String,
    pub trace_id: String,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    stop_flag: Arc<AtomicBool>,
    emitter: Arc<dyn Fn(TerminalEvent) + Send + Sync>,
}

impl TerminalSession {
    pub fn spawn(
        program: &str,
        args: &[String],
        serial: String,
        session_id: String,
        trace_id: String,
        emitter: Arc<dyn Fn(TerminalEvent) + Send + Sync>,
    ) -> Result<Self, std::io::Error> {
        let mut cmd = Command::new(program);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| std::io::Error::other("Failed to capture stdin"))?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| std::io::Error::other("Failed to capture stdout"))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| std::io::Error::other("Failed to capture stderr"))?;

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_stdout = Arc::clone(&stop_flag);
        let stop_stderr = Arc::clone(&stop_flag);
        let stop_watch = Arc::clone(&stop_flag);

        let child = Arc::new(Mutex::new(child));
        let child_watch = Arc::clone(&child);
        let stdin = Arc::new(Mutex::new(stdin));

        let serial_stdout = serial.clone();
        let serial_stderr = serial.clone();
        let serial_watch = serial.clone();
        let session_stdout = session_id.clone();
        let session_stderr = session_id.clone();
        let session_watch = session_id.clone();
        let trace_stdout = trace_id.clone();
        let trace_stderr = trace_id.clone();
        let trace_watch = trace_id.clone();

        let batch_delay = Duration::from_millis(50);
        let batch_max_len = 16_384usize;

        let emitter_stdout = Arc::clone(&emitter);
        std::thread::spawn(move || {
            let mut temp = [0u8; 4096];
            let mut pending = String::new();
            let mut last_emit = Instant::now();
            loop {
                if stop_stdout.load(Ordering::Relaxed) {
                    break;
                }
                let read_count = match stdout.read(&mut temp) {
                    Ok(0) => break,
                    Ok(count) => count,
                    Err(err) => {
                        warn!(trace_id = %trace_stdout, error = %err, "failed to read terminal stdout");
                        break;
                    }
                };
                let chunk = String::from_utf8_lossy(&temp[..read_count]);
                pending.push_str(&chunk);
                // Flush on common "end of burst" signals. With blocking reads, a time-based
                // flush alone can stall forever when only a single small chunk arrives.
                if pending.len() >= batch_max_len
                    || read_count < temp.len()
                    || chunk.contains('\n')
                    || chunk.contains('\r')
                    || last_emit.elapsed() >= batch_delay
                {
                    let flush = std::mem::take(&mut pending);
                    (emitter_stdout)(TerminalEvent {
                        serial: serial_stdout.clone(),
                        session_id: session_stdout.clone(),
                        event: "output".to_string(),
                        stream: Some("stdout".to_string()),
                        chunk: Some(flush),
                        exit_code: None,
                        trace_id: trace_stdout.clone(),
                    });
                    last_emit = Instant::now();
                }
            }
            if !pending.is_empty() {
                (emitter_stdout)(TerminalEvent {
                    serial: serial_stdout.clone(),
                    session_id: session_stdout.clone(),
                    event: "output".to_string(),
                    stream: Some("stdout".to_string()),
                    chunk: Some(pending),
                    exit_code: None,
                    trace_id: trace_stdout.clone(),
                });
            }
        });

        let emitter_stderr = Arc::clone(&emitter);
        std::thread::spawn(move || {
            let mut temp = [0u8; 4096];
            let mut pending = String::new();
            let mut last_emit = Instant::now();
            loop {
                if stop_stderr.load(Ordering::Relaxed) {
                    break;
                }
                let read_count = match stderr.read(&mut temp) {
                    Ok(0) => break,
                    Ok(count) => count,
                    Err(err) => {
                        warn!(trace_id = %trace_stderr, error = %err, "failed to read terminal stderr");
                        break;
                    }
                };
                let chunk = String::from_utf8_lossy(&temp[..read_count]);
                pending.push_str(&chunk);
                // Flush on common "end of burst" signals. With blocking reads, a time-based
                // flush alone can stall forever when only a single small chunk arrives.
                if pending.len() >= batch_max_len
                    || read_count < temp.len()
                    || chunk.contains('\n')
                    || chunk.contains('\r')
                    || last_emit.elapsed() >= batch_delay
                {
                    let flush = std::mem::take(&mut pending);
                    (emitter_stderr)(TerminalEvent {
                        serial: serial_stderr.clone(),
                        session_id: session_stderr.clone(),
                        event: "output".to_string(),
                        stream: Some("stderr".to_string()),
                        chunk: Some(flush),
                        exit_code: None,
                        trace_id: trace_stderr.clone(),
                    });
                    last_emit = Instant::now();
                }
            }
            if !pending.is_empty() {
                (emitter_stderr)(TerminalEvent {
                    serial: serial_stderr.clone(),
                    session_id: session_stderr.clone(),
                    event: "output".to_string(),
                    stream: Some("stderr".to_string()),
                    chunk: Some(pending),
                    exit_code: None,
                    trace_id: trace_stderr.clone(),
                });
            }
        });

        let emitter_watch = Arc::clone(&emitter);
        std::thread::spawn(move || loop {
            let status = {
                let mut guard = match child_watch.lock() {
                    Ok(guard) => guard,
                    Err(_) => break,
                };
                match guard.try_wait() {
                    Ok(Some(status)) => Some(status),
                    Ok(None) => None,
                    Err(err) => {
                        warn!(trace_id = %trace_watch, error = %err, "failed to poll terminal process");
                        break;
                    }
                }
            };

            if let Some(status) = status {
                (emitter_watch)(TerminalEvent {
                    serial: serial_watch,
                    session_id: session_watch,
                    event: "exit".to_string(),
                    stream: None,
                    chunk: None,
                    exit_code: status.code(),
                    trace_id: trace_watch,
                });
                break;
            }

            if stop_watch.load(Ordering::Relaxed) {
                // Process should exit soon after being stopped; keep polling until it does.
            }
            std::thread::sleep(Duration::from_millis(150));
        });

        Ok(Self {
            serial,
            session_id,
            trace_id,
            child,
            stdin,
            stop_flag,
            emitter,
        })
    }

    pub fn write(&self, data: &str, newline: bool) -> Result<(), std::io::Error> {
        let mut guard = self
            .stdin
            .lock()
            .map_err(|_| std::io::Error::other("stdin lock poisoned"))?;
        guard.write_all(data.as_bytes())?;
        if newline {
            guard.write_all(b"\n")?;
        }
        guard.flush()?;
        Ok(())
    }

    pub fn is_running(&self) -> bool {
        let mut guard = match self.child.lock() {
            Ok(guard) => guard,
            Err(_) => return false,
        };
        match guard.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => false,
            Err(_) => false,
        }
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Ok(mut guard) = self.child.lock() {
            let _ = guard.kill();
            let _ = guard.wait();
        }
        (self.emitter)(TerminalEvent {
            serial: self.serial.clone(),
            session_id: self.session_id.clone(),
            event: "stopped".to_string(),
            stream: None,
            chunk: None,
            exit_code: None,
            trace_id: self.trace_id.clone(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    #[test]
    fn terminal_session_emits_output_and_exit() {
        let (tx, rx) = mpsc::channel::<TerminalEvent>();
        let emitter: Arc<dyn Fn(TerminalEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = tx.send(event);
        });

        let (program, args, input_sequence): (&str, Vec<String>, Vec<(&str, bool)>) =
            if cfg!(windows) {
                (
                    "cmd.exe",
                    vec!["/Q".to_string(), "/K".to_string()],
                    vec![("echo hello", true), ("exit", true)],
                )
            } else {
                ("cat", vec![], vec![("hello", true)])
            };

        let session = TerminalSession::spawn(
            program,
            &args,
            "test-serial".to_string(),
            "test-session".to_string(),
            "test-trace".to_string(),
            emitter,
        )
        .expect("spawn terminal");

        for (value, newline) in input_sequence {
            session.write(value, newline).expect("write");
        }

        let start = Instant::now();
        let mut saw_hello = false;
        let mut saw_exit = false;
        while start.elapsed() < Duration::from_secs(3) {
            if let Ok(event) = rx.recv_timeout(Duration::from_millis(250)) {
                if event.event == "output" {
                    if let Some(chunk) = event.chunk.as_ref() {
                        if chunk.contains("hello") {
                            saw_hello = true;
                        }
                    }
                }
                if event.event == "exit" {
                    saw_exit = true;
                    break;
                }
            }
            if saw_hello && cfg!(unix) {
                break;
            }
        }

        assert!(saw_hello, "expected output to contain hello");

        if !saw_exit {
            session.stop();
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(3) {
                if let Ok(event) = rx.recv_timeout(Duration::from_millis(250)) {
                    if event.event == "exit" || event.event == "stopped" {
                        saw_exit = true;
                        break;
                    }
                }
            }
        }

        assert!(saw_exit, "expected exit or stopped event");
    }
}
