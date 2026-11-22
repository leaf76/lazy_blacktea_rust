use tauri::{AppHandle, State};

use crate::app::bluetooth::service::start_bluetooth_monitor as start_bluetooth_monitor_service;
use crate::app::error::AppError;
use crate::app::models::CommandResponse;
use crate::app::state::AppState;

use super::{ensure_non_empty, get_adb_program, resolve_trace_id};

#[tauri::command(async)]
pub fn start_bluetooth_monitor(
    serial: String,
    app: AppHandle,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let adb_program = get_adb_program(&trace_id)?;
    let mut guard = state
        .bluetooth_monitors
        .lock()
        .map_err(|_| AppError::system("Bluetooth monitor registry locked", &trace_id))?;
    if guard.contains_key(&serial) {
        return Err(AppError::validation(
            "Bluetooth monitor already running",
            &trace_id,
        ));
    }

    let handle =
        start_bluetooth_monitor_service(app, serial.clone(), trace_id.clone(), adb_program);
    guard.insert(serial, handle);

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}

#[tauri::command(async)]
pub fn stop_bluetooth_monitor(
    serial: String,
    state: State<'_, AppState>,
    trace_id: Option<String>,
) -> Result<CommandResponse<bool>, AppError> {
    let trace_id = resolve_trace_id(trace_id);
    ensure_non_empty(&serial, "serial", &trace_id)?;

    let mut guard = state
        .bluetooth_monitors
        .lock()
        .map_err(|_| AppError::system("Bluetooth monitor registry locked", &trace_id))?;
    let handle = match guard.remove(&serial) {
        Some(handle) => handle,
        None => {
            return Err(AppError::validation(
                "Bluetooth monitor not running",
                &trace_id,
            ))
        }
    };
    drop(guard);
    handle.stop();

    Ok(CommandResponse {
        trace_id,
        data: true,
    })
}
