use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::app::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UiSettings {
    pub window_width: i32,
    pub window_height: i32,
    pub window_x: i32,
    pub window_y: i32,
    pub ui_scale: f32,
    pub theme: String,
    pub font_size: i32,
    pub show_console_panel: bool,
    pub single_selection: bool,
    pub default_output_path: String,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            window_width: 1200,
            window_height: 800,
            window_x: 100,
            window_y: 100,
            ui_scale: 1.0,
            theme: "dark".to_string(),
            font_size: 10,
            show_console_panel: false,
            single_selection: true,
            default_output_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceSettings {
    pub refresh_interval: i32,
    pub auto_connect: bool,
    pub show_offline_devices: bool,
    pub preferred_devices: Vec<String>,
}

impl Default for DeviceSettings {
    fn default() -> Self {
        Self {
            refresh_interval: 30,
            auto_connect: true,
            show_offline_devices: false,
            preferred_devices: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommandSettings {
    pub max_history_size: usize,
    pub auto_save_history: bool,
    pub command_timeout: i32,
    pub parallel_execution: bool,
}

impl Default for CommandSettings {
    fn default() -> Self {
        Self {
            max_history_size: 50,
            auto_save_history: true,
            command_timeout: 30,
            parallel_execution: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LoggingSettings {
    pub log_level: String,
    pub log_to_file: bool,
    pub max_log_files: i32,
    pub log_file_size_mb: i32,
}

impl Default for LoggingSettings {
    fn default() -> Self {
        Self {
            log_level: "INFO".to_string(),
            log_to_file: true,
            max_log_files: 10,
            log_file_size_mb: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogcatSettings {
    pub max_lines: i32,
    pub history_multiplier: i32,
    pub update_interval_ms: i32,
    pub max_lines_per_update: i32,
    pub max_buffer_size: i32,
}

impl Default for LogcatSettings {
    fn default() -> Self {
        Self {
            max_lines: 1000,
            history_multiplier: 5,
            update_interval_ms: 200,
            max_lines_per_update: 50,
            max_buffer_size: 100,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScrcpySettings {
    pub stay_awake: bool,
    pub turn_screen_off: bool,
    pub disable_screensaver: bool,
    pub enable_audio_playback: bool,
    pub bitrate: String,
    pub max_size: i32,
    pub extra_args: String,
}

impl Default for ScrcpySettings {
    fn default() -> Self {
        Self {
            stay_awake: true,
            turn_screen_off: true,
            disable_screensaver: true,
            enable_audio_playback: true,
            bitrate: String::new(),
            max_size: 0,
            extra_args: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApkInstallSettings {
    pub replace_existing: bool,
    pub allow_downgrade: bool,
    pub grant_permissions: bool,
    pub allow_test_packages: bool,
    pub extra_args: String,
}

impl Default for ApkInstallSettings {
    fn default() -> Self {
        Self {
            replace_existing: true,
            allow_downgrade: true,
            grant_permissions: true,
            allow_test_packages: false,
            extra_args: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScreenshotSettings {
    pub extra_args: String,
    pub display_id: i32,
}

impl Default for ScreenshotSettings {
    fn default() -> Self {
        Self {
            extra_args: String::new(),
            display_id: -1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScreenRecordSettings {
    pub bit_rate: String,
    pub time_limit_sec: i32,
    pub size: String,
    pub extra_args: String,
    pub use_hevc: bool,
    pub bugreport: bool,
    pub verbose: bool,
    pub display_id: i32,
}

impl Default for ScreenRecordSettings {
    fn default() -> Self {
        Self {
            bit_rate: String::new(),
            time_limit_sec: 0,
            size: String::new(),
            extra_args: String::new(),
            use_hevc: false,
            bugreport: false,
            verbose: false,
            display_id: -1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogcatViewerSettings {
    pub compact_mode: bool,
    pub show_preview_panel: bool,
    pub preview_collapsed: bool,
    pub recording_collapsed: bool,
    pub levels_collapsed: bool,
    pub filters_collapsed: bool,
    pub auto_scroll_enabled: bool,
}

impl Default for LogcatViewerSettings {
    fn default() -> Self {
        Self {
            compact_mode: true,
            show_preview_panel: false,
            preview_collapsed: true,
            recording_collapsed: true,
            levels_collapsed: true,
            filters_collapsed: true,
            auto_scroll_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppConfig {
    #[serde(default)]
    pub ui: UiSettings,
    #[serde(default)]
    pub device: DeviceSettings,
    #[serde(default)]
    pub command: CommandSettings,
    #[serde(default)]
    pub logging: LoggingSettings,
    #[serde(default)]
    pub logcat: LogcatSettings,
    #[serde(default)]
    pub scrcpy: ScrcpySettings,
    #[serde(default)]
    pub apk_install: ApkInstallSettings,
    #[serde(default)]
    pub screenshot: ScreenshotSettings,
    #[serde(default)]
    pub screen_record: ScreenRecordSettings,
    #[serde(default)]
    pub logcat_viewer: LogcatViewerSettings,
    #[serde(default)]
    pub command_history: Vec<String>,
    #[serde(default)]
    pub device_groups: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub output_path: String,
    #[serde(default)]
    pub file_gen_output_path: String,
    #[serde(default)]
    pub version: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            ui: UiSettings::default(),
            device: DeviceSettings::default(),
            command: CommandSettings::default(),
            logging: LoggingSettings::default(),
            logcat: LogcatSettings::default(),
            scrcpy: ScrcpySettings::default(),
            apk_install: ApkInstallSettings::default(),
            screenshot: ScreenshotSettings::default(),
            screen_record: ScreenRecordSettings::default(),
            logcat_viewer: LogcatViewerSettings::default(),
            command_history: Vec::new(),
            device_groups: HashMap::new(),
            output_path: String::new(),
            file_gen_output_path: String::new(),
            version: "0.0.50".to_string(),
        }
    }
}

pub fn config_path() -> PathBuf {
    if let Ok(path) = std::env::var("LAZY_BLACKTEA_CONFIG_PATH") {
        return PathBuf::from(path);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".lazy_blacktea_config.json")
}

pub fn backup_config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".lazy_blacktea_config.backup.json")
}

pub fn load_config() -> Result<AppConfig, AppError> {
    load_config_from_path(&config_path())
}

pub fn save_config(config: &AppConfig) -> Result<(), AppError> {
    save_config_to_path(config, &config_path(), &backup_config_path())
}

pub fn load_config_from_path(path: &Path) -> Result<AppConfig, AppError> {
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(path)
        .map_err(|err| AppError::system(format!("Failed to read config: {err}"), ""))?;
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|err| AppError::system(format!("Failed to parse config: {err}"), ""))?;
    let mut config: AppConfig = serde_json::from_value(value.clone()).unwrap_or_default();
    config = apply_legacy_overrides(config, &value);
    Ok(validate_config(config))
}

pub fn save_config_to_path(
    config: &AppConfig,
    path: &Path,
    backup_path: &Path,
) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if path.exists() {
        let _ = fs::copy(path, backup_path);
    }
    let payload = serde_json::to_string_pretty(config)
        .map_err(|err| AppError::system(format!("Failed to serialize config: {err}"), ""))?;
    fs::write(path, payload)
        .map_err(|err| AppError::system(format!("Failed to write config: {err}"), ""))?;
    Ok(())
}

fn apply_legacy_overrides(mut config: AppConfig, value: &serde_json::Value) -> AppConfig {
    if let Some(ui_scale) = value.get("ui_scale").and_then(|v| v.as_f64()) {
        config.ui.ui_scale = ui_scale as f32;
    }
    if let Some(refresh_interval) = value.get("refresh_interval").and_then(|v| v.as_i64()) {
        config.device.refresh_interval = refresh_interval as i32;
    }
    if let Some(output_path) = value.get("output_path").and_then(|v| v.as_str()) {
        config.output_path = output_path.to_string();
    }
    if let Some(file_gen_output_path) = value
        .get("file_gen_output_path")
        .and_then(|v| v.as_str())
    {
        config.file_gen_output_path = file_gen_output_path.to_string();
    }
    if let Some(groups) = value.get("device_groups").and_then(|v| v.as_object()) {
        let mut parsed: HashMap<String, Vec<String>> = HashMap::new();
        for (key, list) in groups {
            if let Some(items) = list.as_array() {
                let members = items
                    .iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>();
                parsed.insert(key.clone(), members);
            }
        }
        if !parsed.is_empty() {
            config.device_groups = parsed;
        }
    }
    if let Some(history) = value.get("command_history").and_then(|v| v.as_array()) {
        config.command_history = history
            .iter()
            .filter_map(|item| item.as_str().map(|s| s.to_string()))
            .collect::<Vec<_>>();
    }
    config
}

fn validate_config(mut config: AppConfig) -> AppConfig {
    if !(0.5..=3.0).contains(&config.ui.ui_scale) {
        config.ui.ui_scale = 1.0;
    }
    if config.device.refresh_interval < 1 {
        config.device.refresh_interval = 30;
    }
    if config.logcat.max_lines < 100 {
        config.logcat.max_lines = 1000;
    }
    if config.logcat.history_multiplier < 1 {
        config.logcat.history_multiplier = 5;
    }
    if config.logcat.update_interval_ms < 50 {
        config.logcat.update_interval_ms = 200;
    }
    if config.logcat.max_lines_per_update < 5 {
        config.logcat.max_lines_per_update = 50;
    }
    if config.logcat.max_buffer_size < 10 {
        config.logcat.max_buffer_size = 100;
    }
    if config.command.max_history_size == 0 {
        config.command.max_history_size = 50;
    }
    config
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_legacy_values() {
        let value = serde_json::json!({
            "ui_scale": 2.5,
            "refresh_interval": 10,
            "output_path": "/tmp/out",
            "file_gen_output_path": "/tmp/file",
            "device_groups": {
                "team": ["A", "B"]
            },
            "command_history": ["ls", "pwd"]
        });
        let mut config: AppConfig = serde_json::from_value(value.clone()).unwrap_or_default();
        config = apply_legacy_overrides(config, &value);
        assert_eq!(config.ui.ui_scale, 2.5);
        assert_eq!(config.device.refresh_interval, 10);
        assert_eq!(config.output_path, "/tmp/out");
        assert_eq!(config.device_groups.get("team").unwrap().len(), 2);
        assert_eq!(config.command_history.len(), 2);
    }

    #[test]
    fn clamps_invalid_values() {
        let mut config = AppConfig::default();
        config.ui.ui_scale = 10.0;
        config.device.refresh_interval = 0;
        config.logcat.max_lines = 10;
        config.command.max_history_size = 0;
        let validated = validate_config(config);
        assert_eq!(validated.ui.ui_scale, 1.0);
        assert_eq!(validated.device.refresh_interval, 30);
        assert_eq!(validated.logcat.max_lines, 1000);
        assert_eq!(validated.command.max_history_size, 50);
    }
}
