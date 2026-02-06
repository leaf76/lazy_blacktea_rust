use crate::app::adb::parse::parse_adb_devices;
use crate::app::adb::paths::sanitize_filename_component;
use crate::app::adb::runner::run_adb;
use crate::app::config::{load_config, AppConfig};
use crate::app::error::AppError;
use crate::app::models::DeviceSummary;
use chrono::Utc;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tracing::warn;
use zip::write::FileOptions;

#[derive(Debug, Serialize)]
struct DiagnosticsManifest {
    app_version: &'static str,
    os: &'static str,
    arch: &'static str,
    timestamp_utc: String,
    trace_id: String,
}

#[derive(Debug, Serialize)]
struct DevicesPayload {
    parsed: Vec<DeviceSummary>,
    raw_stdout: String,
    raw_stderr: String,
    exit_code: Option<i32>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct DiagnosticsPayload {
    manifest: DiagnosticsManifest,
    command_history: Vec<String>,
    devices: DevicesPayload,
}

fn resolve_output_dir(config: Option<&AppConfig>, output_dir: Option<String>) -> Result<String, String> {
    if let Some(dir) = output_dir.as_ref().map(|value| value.trim()).filter(|v| !v.is_empty()) {
        return Ok(dir.to_string());
    }
    if let Some(config) = config {
        if !config.output_path.trim().is_empty() {
            return Ok(config.output_path.clone());
        }
        if !config.file_gen_output_path.trim().is_empty() {
            return Ok(config.file_gen_output_path.clone());
        }
    }
    Ok(std::env::temp_dir()
        .join("lazy_blacktea_diagnostics")
        .to_string_lossy()
        .to_string())
}

pub fn export_diagnostics_bundle(
    adb_program: &str,
    output_dir: Option<String>,
    trace_id: &str,
) -> Result<PathBuf, AppError> {
    let config = match load_config(trace_id) {
        Ok(config) => Some(config),
        Err(err) => {
            warn!(trace_id = %trace_id, error = %err, "Failed to load config for diagnostics");
            None
        }
    };

    let resolved_dir = resolve_output_dir(config.as_ref(), output_dir)
        .map_err(|message| AppError::validation(message, trace_id))?;
    fs::create_dir_all(&resolved_dir).map_err(|err| {
        AppError::system(format!("Failed to create output dir: {err}"), trace_id)
    })?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let safe_trace = sanitize_filename_component(trace_id);
    let trace_short = safe_trace.chars().take(8).collect::<String>();
    let filename = format!("diagnostics_{}_{}.zip", timestamp, trace_short);
    let bundle_path = PathBuf::from(&resolved_dir).join(filename);

    let manifest = DiagnosticsManifest {
        app_version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        timestamp_utc: Utc::now().to_rfc3339(),
        trace_id: trace_id.to_string(),
    };

    let command_history = config
        .as_ref()
        .map(|cfg| cfg.command_history.clone())
        .unwrap_or_default();

    let mut devices_payload = DevicesPayload {
        parsed: Vec::new(),
        raw_stdout: String::new(),
        raw_stderr: String::new(),
        exit_code: None,
        error: None,
    };
    let args = vec!["devices".to_string(), "-l".to_string()];
    match run_adb(adb_program, &args, trace_id) {
        Ok(output) => {
            devices_payload.exit_code = output.exit_code;
            devices_payload.raw_stdout = output.stdout.clone();
            devices_payload.raw_stderr = output.stderr.clone();
            devices_payload.parsed = parse_adb_devices(&output.stdout);
        }
        Err(err) => {
            warn!(
                trace_id = %trace_id,
                error = %err.error,
                code = %err.code,
                "Failed to run adb devices for diagnostics"
            );
            devices_payload.error = Some(err.error);
        }
    }

    let payload = DiagnosticsPayload {
        manifest,
        command_history,
        devices: devices_payload,
    };

    let json = serde_json::to_vec_pretty(&payload).map_err(|err| {
        AppError::system(format!("Failed to serialize diagnostics payload: {err}"), trace_id)
    })?;

    let file = fs::File::create(&bundle_path)
        .map_err(|err| AppError::system(format!("Failed to create bundle: {err}"), trace_id))?;
    let mut zip = zip::ZipWriter::new(file);
    zip.start_file("diagnostics.json", FileOptions::<()>::default())
        .map_err(|err| AppError::system(format!("Failed to write bundle: {err}"), trace_id))?;
    zip.write_all(&json)
        .map_err(|err| AppError::system(format!("Failed to write bundle: {err}"), trace_id))?;
    zip.finish()
        .map_err(|err| AppError::system(format!("Failed to finalize bundle: {err}"), trace_id))?;

    Ok(bundle_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read};
    use tempfile::TempDir;

    #[test]
    fn export_succeeds_without_adb_and_includes_history() {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        let _guard = LOCK
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .expect("env lock");

        let dir = TempDir::new().expect("tmp");
        let config_path = dir.path().join("config.json");
        let out_dir = dir.path().join("out");

        std::env::set_var("LAZY_BLACKTEA_CONFIG_PATH", &config_path);
        fs::write(
            &config_path,
            serde_json::json!({
                "output_path": out_dir.to_string_lossy().to_string(),
                "command_history": ["echo 1", "echo 2"]
            })
            .to_string(),
        )
        .expect("write config");

        let bundle = export_diagnostics_bundle("adb-does-not-exist", None, "trace-test")
            .expect("bundle");

        let bytes = fs::read(&bundle).expect("read bundle");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("zip");
        let mut file = archive.by_name("diagnostics.json").expect("entry");
        let mut content = String::new();
        file.read_to_string(&mut content).expect("read");

        assert!(content.contains("\"command_history\""));
        assert!(content.contains("echo 1"));
        assert!(content.contains("\"trace_id\""));

        std::env::remove_var("LAZY_BLACKTEA_CONFIG_PATH");
    }
}
