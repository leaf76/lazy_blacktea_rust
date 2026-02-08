pub mod app;

use app::commands::{
    adb_connect, adb_pair, cancel_bugreport, capture_screenshot, capture_ui_hierarchy, check_adb,
    check_scrcpy, clear_app_data, clear_logcat, delete_device_path, export_diagnostics_bundle,
    export_logcat, export_ui_hierarchy, force_stop_app, generate_bugreport, get_app_basic_info,
    get_app_icon, get_config, install_apk_batch, launch_app, launch_scrcpy, list_apps,
    list_device_files, list_devices, mkdir_device_dir, open_app_info, persist_terminal_state,
    prepare_bugreport_logcat, preview_local_file, pull_device_file, push_device_file,
    query_bugreport_logcat, reboot_devices, rename_device_path, reset_config, run_shell,
    save_app_config, set_app_enabled, set_bluetooth_state, set_wifi_state, start_bluetooth_monitor,
    start_logcat, start_perf_monitor, start_screen_record, start_terminal_session,
    stop_bluetooth_monitor, stop_logcat, stop_perf_monitor, stop_screen_record,
    stop_terminal_session, uninstall_app, write_terminal_session,
};
use app::logging::init_logging;
use app::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_app_config,
            reset_config,
            check_adb,
            export_diagnostics_bundle,
            list_devices,
            adb_pair,
            adb_connect,
            run_shell,
            start_terminal_session,
            write_terminal_session,
            stop_terminal_session,
            persist_terminal_state,
            reboot_devices,
            set_wifi_state,
            set_bluetooth_state,
            install_apk_batch,
            capture_screenshot,
            start_screen_record,
            stop_screen_record,
            list_device_files,
            pull_device_file,
            push_device_file,
            mkdir_device_dir,
            rename_device_path,
            delete_device_path,
            preview_local_file,
            capture_ui_hierarchy,
            export_ui_hierarchy,
            start_perf_monitor,
            stop_perf_monitor,
            start_logcat,
            stop_logcat,
            clear_logcat,
            export_logcat,
            start_bluetooth_monitor,
            stop_bluetooth_monitor,
            list_apps,
            get_app_basic_info,
            get_app_icon,
            uninstall_app,
            force_stop_app,
            clear_app_data,
            set_app_enabled,
            open_app_info,
            launch_app,
            check_scrcpy,
            launch_scrcpy,
            generate_bugreport,
            cancel_bugreport,
            prepare_bugreport_logcat,
            query_bugreport_logcat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
