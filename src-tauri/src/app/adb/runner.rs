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

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AppError::system("Command timed out".to_string(), trace_id));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                return Err(AppError::system(format!("Failed to poll command: {err}"), trace_id));
            }
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|err| AppError::system(format!("Failed to capture output: {err}"), trace_id))?;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
    })
}

pub fn run_adb(program: &str, args: &[String], trace_id: &str) -> Result<CommandOutput, AppError> {
    run_command(program, args, trace_id)
}
