mod app;

use app::commands::{
    adb_connect, adb_pair, cancel_bugreport, capture_screenshot, capture_ui_hierarchy, check_scrcpy,
    check_adb, clear_app_data, clear_logcat, export_logcat, export_ui_hierarchy, force_stop_app,
    generate_bugreport, get_config, install_apk_batch, launch_app, launch_scrcpy, list_apps,
    list_device_files, list_devices, open_app_info, preview_local_file, pull_device_file,
    push_device_file, mkdir_device_dir, rename_device_path, delete_device_path,
    reboot_devices, reset_config, run_shell, save_app_config, set_app_enabled, set_bluetooth_state,
    set_wifi_state, start_bluetooth_monitor, start_logcat, start_screen_record,
    stop_bluetooth_monitor, stop_logcat, stop_screen_record, uninstall_app,
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
            list_devices,
            adb_pair,
            adb_connect,
            run_shell,
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
            start_logcat,
            stop_logcat,
            clear_logcat,
            export_logcat,
            start_bluetooth_monitor,
            stop_bluetooth_monitor,
            list_apps,
            uninstall_app,
            force_stop_app,
            clear_app_data,
            set_app_enabled,
            open_app_info,
            launch_app,
            check_scrcpy,
            launch_scrcpy,
            generate_bugreport,
            cancel_bugreport
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
