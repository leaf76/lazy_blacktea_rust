use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::app::adb::runner::run_command_with_timeout;
use crate::app::error::AppError;

use super::tools::check_ios_tools;
use super::trust::humanize_ios_tool_error;
use super::validate::validate_ios_serial;

const IOS_SCREENSHOT_TIMEOUT: Duration = Duration::from_secs(30);

pub fn capture_screenshot(
    serial: &str,
    output_path: &Path,
    trace_id: &str,
) -> Result<PathBuf, AppError> {
    let serial = validate_ios_serial(serial, trace_id)?;
    let tools = check_ios_tools(trace_id);
    if !tools.idevicescreenshot.available {
        return Err(AppError::dependency(
            "idevicescreenshot is not available. Install libimobiledevice tools to capture iOS screenshots.",
            trace_id,
        ));
    }
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::system(format!("Failed to create output dir: {err}"), trace_id)
        })?;
    }
    let path_str = output_path.to_string_lossy().to_string();
    let args = vec!["-u".to_string(), serial, path_str.clone()];
    let output =
        run_command_with_timeout("idevicescreenshot", &args, IOS_SCREENSHOT_TIMEOUT, trace_id)?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            humanize_ios_tool_error(&format!("iOS screenshot failed: {}", output.stderr.trim())),
            trace_id,
        ));
    }
    if !output_path.exists() {
        return Err(AppError::dependency(
            "iOS screenshot tool reported success but the output file is missing",
            trace_id,
        ));
    }
    Ok(output_path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn capture_requires_valid_serial() {
        let dir = TempDir::new().expect("tmp");
        let path = dir.path().join("shot.png");
        let err = capture_screenshot("not-a-udid", &path, "trace-shot").expect_err("invalid");
        assert_eq!(err.code, "ERR_VALIDATION");
    }
}
