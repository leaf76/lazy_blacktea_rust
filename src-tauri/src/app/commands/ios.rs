use std::process::{Command, Stdio};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use tracing::{info, warn};

use crate::app::error::AppError;
use crate::app::ios;
use crate::app::models::{
    CommandResponse, HostCommandResult, IosProfileInstallResult, IosToolsInfo, LogcatStatus,
    MobileconfigSummary,
};
use crate::app::state::AppState;

use super::{
    get_logcat_status_inner, resolve_trace_id, start_logcat_inner, stop_logcat_inner,
    LogcatEmitter, LogcatEvent,
};

#[tauri::command(async)]
pub fn check_ios_tools(
    trace_id: Option<String>,
) -> Result<CommandResponse<IosToolsInfo>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    info!(trace_id = %trace_id, "check_ios_tools");
    // Settings / Profiles always force a fresh probe so cache does not hide install changes.
    Ok(CommandResponse {
        data: ios::check_ios_tools_force(&trace_id),
        trace_id,
    })
}

#[tauri::command(async)]
pub fn start_ios_syslog(
    serial: String,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let serial = ios::validate_ios_serial(&serial, &trace_id)?;
    let tools = ios::check_ios_tools(&trace_id);
    if !tools.idevicesyslog.available {
        return Err(AppError::dependency(
            "idevicesyslog is not available. Install libimobiledevice tools to stream iOS logs.",
            &trace_id,
        ));
    }
    // Avoid concurrent mutation tooling on the same serial when possible.
    if state
        .ios_syslog_processes
        .lock()
        .map(|map| map.contains_key(&serial))
        .unwrap_or(false)
    {
        return Err(AppError::validation(
            "iOS syslog is already running for this device",
            &trace_id,
        ));
    }
    let trace_emit = trace_id.clone();
    let emitter: LogcatEmitter = Arc::new(move |event: LogcatEvent| {
        if let Err(err) = app.emit("logcat-line", event) {
            warn!(trace_id = %trace_emit, error = %err, "failed to emit iOS syslog line");
        }
    });

    start_logcat_inner(
        serial,
        None,
        "idevicesyslog",
        &state.ios_syslog_processes,
        emitter,
        &trace_id,
        |program, serial, _filter, trace_id| {
            Command::new(program)
                .args(["-u", serial])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|err| {
                    AppError::dependency(
                        ios::humanize_ios_tool_error(&format!("Failed to start iOS syslog: {err}")),
                        trace_id,
                    )
                })
        },
    )?;

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn stop_ios_syslog(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    stop_logcat_inner(serial, &state.ios_syslog_processes, &trace_id)?;

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn get_ios_syslog_status(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<LogcatStatus>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let status = get_logcat_status_inner(serial, &state.ios_syslog_processes, &trace_id)?;
    Ok(CommandResponse {
        trace_id,
        data: status,
    })
}

#[tauri::command(async)]
pub fn export_ios_crash_reports(
    serial: String,
    output_dir: Option<String>,
    trace_id: Option<String>,
) -> Result<CommandResponse<HostCommandResult>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let data = ios::export_crash_reports(&serial, output_dir, &trace_id)?;
    Ok(CommandResponse { trace_id, data })
}

#[tauri::command(async)]
pub fn validate_mobileconfig(
    profile_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<MobileconfigSummary>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let data = ios::validate_mobileconfig(&profile_path, &trace_id)?;
    Ok(CommandResponse { trace_id, data })
}

#[tauri::command(async)]
pub fn install_ios_configuration_profile(
    serials: Vec<String>,
    profile_path: String,
    trace_id: Option<String>,
) -> Result<CommandResponse<Vec<IosProfileInstallResult>>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    let data = ios::install_configuration_profile(serials, &profile_path, &trace_id)?;
    Ok(CommandResponse { trace_id, data })
}
