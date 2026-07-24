use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use crate::app::adb::runner::{run_command_with_timeout, CommandOutput};
use crate::app::error::AppError;
use crate::app::models::HostCommandResult;

use super::tools::check_ios_tools;
use super::trust::humanize_ios_tool_error;
use super::validate::validate_ios_serial;

/// Crash report export can pull many files; keep this independent of discovery timeouts.
const IOS_CRASH_EXPORT_TIMEOUT: Duration = Duration::from_secs(120);

pub fn export_crash_reports(
    serial: &str,
    output_dir: Option<String>,
    trace_id: &str,
) -> Result<HostCommandResult, AppError> {
    let serial = validate_ios_serial(serial, trace_id)?;
    let tools = check_ios_tools(trace_id);
    if !tools.idevicecrashreport.available {
        return Err(AppError::dependency(
            "idevicecrashreport is not available",
            trace_id,
        ));
    }
    let output_dir = output_dir
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| ".".to_string());
    fs::create_dir_all(&output_dir)
        .map_err(|err| AppError::system(format!("Failed to create output dir: {err}"), trace_id))?;
    let output_dir = PathBuf::from(output_dir);
    let output_dir_str = output_dir.to_string_lossy().to_string();
    let args = vec!["-u".to_string(), serial, output_dir_str];
    let output = run_command_with_timeout(
        "idevicecrashreport",
        &args,
        IOS_CRASH_EXPORT_TIMEOUT,
        trace_id,
    )?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            humanize_ios_tool_error(&format!(
                "iOS crash report export failed: {}",
                output.stderr.trim()
            )),
            trace_id,
        ));
    }
    Ok(to_host_result(output))
}

fn to_host_result(output: CommandOutput) -> HostCommandResult {
    HostCommandResult {
        stdout: output.stdout,
        stderr: output.stderr,
        exit_code: output.exit_code,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_requires_valid_serial() {
        let err = export_crash_reports("emulator-5554", None, "trace-crash").expect_err("android");
        assert_eq!(err.code, "ERR_VALIDATION");
    }
}
