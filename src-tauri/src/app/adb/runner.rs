use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::app::error::AppError;

#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
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
    let mut child = Command::new(program)
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

    let stdout_handle = std::thread::spawn(move || {
        let mut reader = stdout;
        let mut buffer = Vec::<u8>::new();
        let mut temp = [0u8; 4096];
        loop {
            match reader.read(&mut temp) {
                Ok(0) => break,
                Ok(count) => buffer.extend_from_slice(&temp[..count]),
                Err(_) => break,
            }
        }
        buffer
    });

    let stderr_handle = std::thread::spawn(move || {
        let mut reader = stderr;
        let mut buffer = Vec::<u8>::new();
        let mut temp = [0u8; 4096];
        loop {
            match reader.read(&mut temp) {
                Ok(0) => break,
                Ok(count) => buffer.extend_from_slice(&temp[..count]),
                Err(_) => break,
            }
        }
        buffer
    });

    let start = Instant::now();
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

    let stdout_bytes = stdout_handle.join().unwrap_or_default();
    let stderr_bytes = stderr_handle.join().unwrap_or_default();

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&stdout_bytes).to_string(),
        stderr: String::from_utf8_lossy(&stderr_bytes).to_string(),
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
}
