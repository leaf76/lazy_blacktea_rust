use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::app::error::AppError;

pub const DEFAULT_MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Creates a `Command` configured not to flash a console window on Windows.
#[cfg(windows)]
pub fn new_background_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Creates a `Command` configured not to flash a console window on Windows.
#[cfg(not(windows))]
pub fn new_background_command(program: &str) -> Command {
    Command::new(program)
}

#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct RawCommandOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: Option<i32>,
}

pub fn run_command(
    program: &str,
    args: &[String],
    trace_id: &str,
) -> Result<CommandOutput, AppError> {
    run_command_with_timeout(program, args, Duration::from_secs(10), trace_id)
}

pub fn run_command_with_timeout(
    program: &str,
    args: &[String],
    timeout: Duration,
    trace_id: &str,
) -> Result<CommandOutput, AppError> {
    let raw = run_command_bytes_with_timeout(
        program,
        args,
        timeout,
        Some(DEFAULT_MAX_OUTPUT_BYTES),
        trace_id,
    )?;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&raw.stdout).to_string(),
        stderr: String::from_utf8_lossy(&raw.stderr).to_string(),
        exit_code: raw.exit_code,
    })
}

fn spawn_pipe_drainer<R: Read + Send + 'static>(
    mut reader: R,
    max_bytes: Option<usize>,
) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buffer = Vec::<u8>::new();
        let mut temp = [0u8; 4096];
        loop {
            match reader.read(&mut temp) {
                Ok(0) => break,
                Ok(count) => {
                    if let Some(limit) = max_bytes {
                        if buffer.len() < limit {
                            let take = (limit - buffer.len()).min(count);
                            buffer.extend_from_slice(&temp[..take]);
                        }
                    } else {
                        buffer.extend_from_slice(&temp[..count]);
                    }
                }
                Err(_) => break,
            }
        }
        buffer
    })
}

pub fn run_command_bytes_with_timeout(
    program: &str,
    args: &[String],
    timeout: Duration,
    max_output_bytes: Option<usize>,
    trace_id: &str,
) -> Result<RawCommandOutput, AppError> {
    let mut child = new_background_command(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| AppError::system(format!("Failed to spawn command: {err}"), trace_id))?;

    // Drain stdout/stderr in parallel; otherwise, a chatty child process can block once the pipe
    // buffer fills, and we will incorrectly hit the timeout.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::system("Failed to capture stdout", trace_id))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::system("Failed to capture stderr", trace_id))?;

    let stdout_handle = spawn_pipe_drainer(stdout, max_output_bytes);
    let stderr_handle = spawn_pipe_drainer(stderr, max_output_bytes);

    let start = Instant::now();
    // Adaptive backoff: a flat 50ms poll added up to ~50ms latency to *every* command (the first
    // try_wait almost always observes the child still running). Start tight and back off so fast
    // adb calls return promptly while long-running ones stay cheap to poll.
    let mut poll_interval = Duration::from_millis(1);
    let max_poll_interval = Duration::from_millis(25);
    let exit_code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_handle.join();
                    let _ = stderr_handle.join();
                    return Err(AppError::system("Command timed out".to_string(), trace_id));
                }
                std::thread::sleep(poll_interval);
                poll_interval = (poll_interval * 2).min(max_poll_interval);
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

    let stdout_bytes = stdout_handle.join().unwrap_or_default();
    let stderr_bytes = stderr_handle.join().unwrap_or_default();

    Ok(RawCommandOutput {
        stdout: stdout_bytes,
        stderr: stderr_bytes,
        exit_code,
    })
}

pub fn run_adb(program: &str, args: &[String], trace_id: &str) -> Result<CommandOutput, AppError> {
    run_command(program, args, trace_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_command_with_timeout_does_not_deadlock_on_large_stdout() {
        // Regression test: If stdout/stderr are piped but not drained, the child can block once
        // the pipe buffer fills, causing an otherwise-fast command to "hang" until we hit the
        // timeout.
        let trace_id = "test-trace-large-output";

        let (program, args, min_stdout_len) = if cfg!(windows) {
            // Use a deterministic loop to emit > 1MB to stdout.
            (
                "cmd.exe".to_string(),
                vec![
                    "/C".to_string(),
                    "for /L %i in (1,1,100000) do @echo 1234567890".to_string(),
                ],
                1_000_000usize,
            )
        } else {
            (
                "sh".to_string(),
                vec![
                    "-c".to_string(),
                    "i=0; while [ $i -lt 100000 ]; do echo 1234567890; i=$((i+1)); done"
                        .to_string(),
                ],
                1_000_000usize,
            )
        };

        let output = run_command_with_timeout(&program, &args, Duration::from_secs(10), trace_id)
            .expect("expected large-output command to complete without timing out");

        assert_eq!(output.exit_code, Some(0));
        assert!(
            output.stdout.len() >= min_stdout_len,
            "expected stdout >= {min_stdout_len}, got {}",
            output.stdout.len()
        );
    }

    #[test]
    fn run_command_bytes_with_timeout_caps_output_without_deadlock() {
        let (program, args) = if cfg!(windows) {
            (
                "cmd.exe".to_string(),
                vec![
                    "/C".to_string(),
                    "for /L %i in (1,1,2000) do @echo 1234567890".to_string(),
                ],
            )
        } else {
            (
                "sh".to_string(),
                vec![
                    "-c".to_string(),
                    "i=0; while [ $i -lt 2000 ]; do echo 1234567890; i=$((i+1)); done".to_string(),
                ],
            )
        };

        let output = run_command_bytes_with_timeout(
            &program,
            &args,
            Duration::from_secs(10),
            Some(512),
            "test-trace-cap",
        )
        .expect("bounded output command should complete");
        assert_eq!(output.exit_code, Some(0));
        assert_eq!(output.stdout.len(), 512);
    }
}
