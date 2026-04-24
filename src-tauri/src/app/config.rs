use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::app::adb::screen_record::{
    normalize_screen_record_time_limit_sec, DEFAULT_SCREEN_RECORD_TIME_LIMIT_SEC,
};
use crate::app::error::AppError;
use tracing::warn;
use uuid::Uuid;

fn normalize_trace_id(trace_id: &str) -> String {
    let trimmed = trace_id.trim();
    if trimmed.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        trimmed.to_string()
    }
}

fn resolve_default_output_dir(download_dir: Option<PathBuf>, home_dir: Option<PathBuf>) -> String {
    if let Some(dir) = download_dir {
        return dir.to_string_lossy().to_string();
    }
    if let Some(home) = home_dir {
        return home.join("Downloads").to_string_lossy().to_string();
    }
    "Downloads".to_string()
}

fn default_output_dir() -> String {
    resolve_default_output_dir(dirs::download_dir(), dirs::home_dir())
}

fn default_device_refresh_interval() -> i32 {
    5
}

fn default_true() -> bool {
    true
}

fn default_theme_preset_id() -> String {
    "system".to_string()
}

fn default_theme_background_kind() -> String {
    "preset".to_string()
}

fn default_theme_background_fit() -> String {
    "cover".to_string()
}

fn default_theme_opacity() -> f32 {
    1.0
}

pub const THEME_BACKGROUND_MAX_BYTES: u64 = 8 * 1024 * 1024;
const THEME_COPY_TITLE_MAX_CHARS: usize = 80;
const THEME_COPY_SUBTITLE_MAX_CHARS: usize = 120;
const THEME_COPY_STATUS_MAX_CHARS: usize = 40;
const THEME_PATH_MAX_CHARS: usize = 2048;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeBackgroundSource {
    #[serde(default = "default_theme_background_kind")]
    pub kind: String,
    #[serde(default)]
    pub path: String,
}

impl Default for ThemeBackgroundSource {
    fn default() -> Self {
        Self {
            kind: default_theme_background_kind(),
            path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ThemeColorSettings {
    #[serde(default)]
    pub primary: String,
    #[serde(default)]
    pub accent: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub muted_text: String,
    #[serde(default)]
    pub panel: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ThemeCopyOverrides {
    #[serde(default)]
    pub app_title: String,
    #[serde(default)]
    pub app_subtitle: String,
    #[serde(default)]
    pub sidebar_status_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeStyleSettings {
    #[serde(default = "default_theme_preset_id")]
    pub preset_id: String,
    #[serde(default)]
    pub background_source: ThemeBackgroundSource,
    #[serde(default = "default_theme_background_fit")]
    pub background_fit: String,
    #[serde(default = "default_theme_opacity")]
    pub background_opacity: f32,
    #[serde(default = "default_theme_opacity")]
    pub panel_opacity: f32,
    #[serde(default)]
    pub colors: ThemeColorSettings,
    #[serde(default)]
    pub copy_overrides: ThemeCopyOverrides,
}

impl Default for ThemeStyleSettings {
    fn default() -> Self {
        Self {
            preset_id: default_theme_preset_id(),
            background_source: ThemeBackgroundSource::default(),
            background_fit: default_theme_background_fit(),
            background_opacity: default_theme_opacity(),
            panel_opacity: default_theme_opacity(),
            colors: ThemeColorSettings::default(),
            copy_overrides: ThemeCopyOverrides::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
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
    #[serde(default)]
    pub theme_style: ThemeStyleSettings,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            window_width: 1280,
            window_height: 760,
            window_x: 100,
            window_y: 100,
            ui_scale: 1.0,
            theme: "dark".to_string(),
            font_size: 10,
            show_console_panel: false,
            single_selection: true,
            default_output_path: default_output_dir(),
            theme_style: ThemeStyleSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct DeviceSettings {
    #[serde(default = "default_device_refresh_interval")]
    pub refresh_interval: i32,
    #[serde(default = "default_true")]
    pub auto_refresh_enabled: bool,
    #[serde(default = "default_true")]
    pub auto_connect: bool,
    #[serde(default)]
    pub show_offline_devices: bool,
    #[serde(default)]
    pub preferred_devices: Vec<String>,
}

impl Default for DeviceSettings {
    fn default() -> Self {
        Self {
            refresh_interval: default_device_refresh_interval(),
            auto_refresh_enabled: true,
            auto_connect: true,
            show_offline_devices: false,
            preferred_devices: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AdbSettings {
    pub command_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
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
#[serde(default)]
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
#[serde(default)]
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
            bitrate: "8M".to_string(),
            max_size: 0,
            extra_args: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
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
#[serde(default)]
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
#[serde(default)]
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
            // Use explicit defaults so Settings/Quick Actions don't look "unset".
            // Values match typical Android `screenrecord` defaults for short recordings.
            bit_rate: "4000000".to_string(),
            time_limit_sec: DEFAULT_SCREEN_RECORD_TIME_LIMIT_SEC,
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
#[serde(default)]
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
pub struct NotificationsSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub desktop_enabled: bool,
    #[serde(default = "default_true")]
    pub desktop_only_when_unfocused: bool,
    #[serde(default)]
    pub desktop_on_success: bool,
    #[serde(default = "default_true")]
    pub desktop_on_error: bool,
    #[serde(default)]
    pub desktop_on_cancelled: bool,
    #[serde(default = "default_true")]
    pub in_app_modal_enabled: bool,
}

impl Default for NotificationsSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            desktop_enabled: false,
            desktop_only_when_unfocused: true,
            desktop_on_success: false,
            desktop_on_error: true,
            desktop_on_cancelled: false,
            in_app_modal_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DashboardFieldPref {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DashboardCardPref {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub order: i32,
    #[serde(default)]
    pub fields: Vec<DashboardFieldPref>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DashboardSettings {
    #[serde(default)]
    pub cards: Vec<DashboardCardPref>,
}

impl Default for DashboardSettings {
    fn default() -> Self {
        fn fields(ids: &[&str]) -> Vec<DashboardFieldPref> {
            ids.iter()
                .enumerate()
                .map(|(index, id)| DashboardFieldPref {
                    id: (*id).to_string(),
                    enabled: true,
                    order: index as i32,
                })
                .collect()
        }

        fn card(id: &str, order: i32, field_ids: &[&str]) -> DashboardCardPref {
            DashboardCardPref {
                id: id.to_string(),
                enabled: true,
                order,
                fields: fields(field_ids),
            }
        }

        Self {
            cards: vec![
                card(
                    "overview",
                    0,
                    &[
                        "selected_count",
                        "online_count",
                        "unauthorized_count",
                        "offline_count",
                        "primary_device",
                        "running_tasks",
                    ],
                ),
                card(
                    "device_profile",
                    1,
                    &[
                        "brand",
                        "model",
                        "android_version",
                        "api_level",
                        "processor",
                        "resolution",
                    ],
                ),
                card(
                    "capacity_battery",
                    2,
                    &[
                        "battery_level",
                        "memory_total",
                        "storage_total",
                        "wifi_state",
                        "bt_state",
                        "gms_version",
                    ],
                ),
                card(
                    "connection_health",
                    3,
                    &[
                        "adb_status",
                        "scrcpy_status",
                        "selected_connected",
                        "selected_ready_ratio",
                    ],
                ),
            ],
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TerminalSettings {
    #[serde(default)]
    pub restore_sessions: Vec<String>,
    #[serde(default)]
    pub buffers: HashMap<String, Vec<String>>,
}

pub const TERMINAL_PERSIST_MAX_LINES: usize = 500;
pub const TERMINAL_PERSIST_MAX_LINE_CHARS: usize = 8_000;

pub fn clamp_terminal_buffer_lines(lines: &mut Vec<String>) {
    for line in lines.iter_mut() {
        if line.len() > TERMINAL_PERSIST_MAX_LINE_CHARS {
            line.truncate(TERMINAL_PERSIST_MAX_LINE_CHARS);
        }
    }
    if lines.len() > TERMINAL_PERSIST_MAX_LINES {
        let start = lines.len().saturating_sub(TERMINAL_PERSIST_MAX_LINES);
        lines.drain(0..start);
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
    pub adb: AdbSettings,
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
    pub notifications: NotificationsSettings,
    #[serde(default)]
    pub dashboard: DashboardSettings,
    #[serde(default)]
    pub terminal: TerminalSettings,
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
        let output_dir = default_output_dir();
        Self {
            ui: UiSettings::default(),
            device: DeviceSettings::default(),
            command: CommandSettings::default(),
            adb: AdbSettings::default(),
            logging: LoggingSettings::default(),
            logcat: LogcatSettings::default(),
            scrcpy: ScrcpySettings::default(),
            apk_install: ApkInstallSettings::default(),
            screenshot: ScreenshotSettings::default(),
            screen_record: ScreenRecordSettings::default(),
            logcat_viewer: LogcatViewerSettings::default(),
            notifications: NotificationsSettings::default(),
            dashboard: DashboardSettings::default(),
            terminal: TerminalSettings::default(),
            command_history: Vec::new(),
            device_groups: HashMap::new(),
            output_path: output_dir.clone(),
            file_gen_output_path: output_dir,
            version: "0.0.50".to_string(),
        }
    }
}

pub fn config_path() -> PathBuf {
    if let Ok(path) = std::env::var("LAZY_BLACKTEA_CONFIG_PATH") {
        return PathBuf::from(path);
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .or_else(|_| {
            let drive = std::env::var("HOMEDRIVE")?;
            let path = std::env::var("HOMEPATH")?;
            Ok::<String, std::env::VarError>(format!("{drive}{path}"))
        })
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".lazy_blacktea_config.json")
}

pub fn backup_config_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .or_else(|_| {
            let drive = std::env::var("HOMEDRIVE")?;
            let path = std::env::var("HOMEPATH")?;
            Ok::<String, std::env::VarError>(format!("{drive}{path}"))
        })
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".lazy_blacktea_config.backup.json")
}

pub fn load_config(trace_id: &str) -> Result<AppConfig, AppError> {
    load_config_from_path(&config_path(), trace_id)
}

pub fn save_config(config: &AppConfig, trace_id: &str) -> Result<(), AppError> {
    save_config_to_path(config, &config_path(), &backup_config_path(), trace_id)
}

pub fn load_config_from_path(path: &Path, trace_id: &str) -> Result<AppConfig, AppError> {
    let trace_id = normalize_trace_id(trace_id);
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(path)
        .map_err(|err| AppError::system(format!("Failed to read config: {err}"), &trace_id))?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|err| {
        AppError::validation(format!("Failed to parse config JSON: {err}"), &trace_id)
    })?;
    let mut config: AppConfig = serde_json::from_value(value.clone())
        .map_err(|err| AppError::validation(format!("Config file is invalid: {err}"), &trace_id))?;
    config = apply_legacy_overrides(config, &value);
    Ok(validate_config(config))
}

pub fn save_config_to_path(
    config: &AppConfig,
    path: &Path,
    backup_path: &Path,
    trace_id: &str,
) -> Result<(), AppError> {
    let trace_id = normalize_trace_id(trace_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::system(format!("Failed to create config dir: {err}"), &trace_id)
        })?;
    }
    if path.exists() {
        if let Err(err) = fs::copy(path, backup_path) {
            warn!(
                trace_id = %trace_id,
                error = %err,
                "Failed to backup config file"
            );
        }
    }
    let payload = serde_json::to_string_pretty(config)
        .map_err(|err| AppError::system(format!("Failed to serialize config: {err}"), &trace_id))?;
    fs::write(path, payload)
        .map_err(|err| AppError::system(format!("Failed to write config: {err}"), &trace_id))?;
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
    if let Some(file_gen_output_path) = value.get("file_gen_output_path").and_then(|v| v.as_str()) {
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

fn is_allowed_theme_preset(value: &str) -> bool {
    matches!(
        value,
        "system" | "midnight" | "terminal" | "graphite" | "daylight"
    )
}

fn is_allowed_theme_background_kind(value: &str) -> bool {
    matches!(value, "preset" | "none" | "local_path" | "managed_path")
}

fn is_allowed_theme_background_fit(value: &str) -> bool {
    matches!(value, "cover" | "contain" | "repeat")
}

fn normalize_hex_color(value: &str) -> String {
    let trimmed = value.trim().to_ascii_lowercase();
    let bytes = trimmed.as_bytes();
    if bytes.len() == 4 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        let mut expanded = String::from("#");
        for value in trimmed[1..].chars() {
            expanded.push(value);
            expanded.push(value);
        }
        return expanded;
    }
    if bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return trimmed;
    }
    String::new()
}

fn normalize_copy_override(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect()
}

fn truncate_path_value(value: &str) -> String {
    value.trim().chars().take(THEME_PATH_MAX_CHARS).collect()
}

fn validate_theme_style(mut settings: ThemeStyleSettings) -> ThemeStyleSettings {
    settings.preset_id = settings.preset_id.trim().to_string();
    if !is_allowed_theme_preset(&settings.preset_id) {
        settings.preset_id = default_theme_preset_id();
    }

    settings.background_source.kind = settings.background_source.kind.trim().to_string();
    if !is_allowed_theme_background_kind(&settings.background_source.kind) {
        settings.background_source = ThemeBackgroundSource::default();
    } else {
        settings.background_source.path = truncate_path_value(&settings.background_source.path);
        if matches!(
            settings.background_source.kind.as_str(),
            "local_path" | "managed_path"
        ) {
            if settings.background_source.path.is_empty()
                || !Path::new(&settings.background_source.path).is_file()
            {
                settings.background_source = ThemeBackgroundSource::default();
            }
        } else {
            settings.background_source.path.clear();
        }
    }

    settings.background_fit = settings.background_fit.trim().to_string();
    if !is_allowed_theme_background_fit(&settings.background_fit) {
        settings.background_fit = default_theme_background_fit();
    }
    if !settings.background_opacity.is_finite() {
        settings.background_opacity = default_theme_opacity();
    }
    settings.background_opacity = settings.background_opacity.clamp(0.0, 1.0);
    if !settings.panel_opacity.is_finite() {
        settings.panel_opacity = default_theme_opacity();
    }
    settings.panel_opacity = settings.panel_opacity.clamp(0.72, 1.0);

    settings.colors.primary = normalize_hex_color(&settings.colors.primary);
    settings.colors.accent = normalize_hex_color(&settings.colors.accent);
    settings.colors.text = normalize_hex_color(&settings.colors.text);
    settings.colors.muted_text = normalize_hex_color(&settings.colors.muted_text);
    settings.colors.panel = normalize_hex_color(&settings.colors.panel);

    settings.copy_overrides.app_title = normalize_copy_override(
        &settings.copy_overrides.app_title,
        THEME_COPY_TITLE_MAX_CHARS,
    );
    settings.copy_overrides.app_subtitle = normalize_copy_override(
        &settings.copy_overrides.app_subtitle,
        THEME_COPY_SUBTITLE_MAX_CHARS,
    );
    settings.copy_overrides.sidebar_status_label = normalize_copy_override(
        &settings.copy_overrides.sidebar_status_label,
        THEME_COPY_STATUS_MAX_CHARS,
    );

    settings
}

fn validate_config(mut config: AppConfig) -> AppConfig {
    if !(0.5..=3.0).contains(&config.ui.ui_scale) {
        config.ui.ui_scale = 1.0;
    }
    config.ui.font_size = config.ui.font_size.clamp(10, 18);
    config.ui.theme_style = validate_theme_style(config.ui.theme_style);
    if config.ui.default_output_path.trim().is_empty() {
        config.ui.default_output_path = default_output_dir();
    }
    if config.device.refresh_interval < 1 {
        config.device.refresh_interval = default_device_refresh_interval();
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
    if config.output_path.trim().is_empty() {
        config.output_path = default_output_dir();
    }
    if config.file_gen_output_path.trim().is_empty() {
        config.file_gen_output_path = config.output_path.clone();
    }
    if config.scrcpy.bitrate.trim().is_empty() {
        config.scrcpy.bitrate = ScrcpySettings::default().bitrate;
    }
    if config.scrcpy.max_size < 0 {
        config.scrcpy.max_size = 0;
    }
    if config.screenshot.display_id < -1 {
        config.screenshot.display_id = -1;
    }
    if config.screen_record.display_id < -1 {
        config.screen_record.display_id = -1;
    }
    if config.screen_record.bit_rate.trim().is_empty() {
        config.screen_record.bit_rate = ScreenRecordSettings::default().bit_rate;
    }
    config.screen_record.time_limit_sec =
        normalize_screen_record_time_limit_sec(config.screen_record.time_limit_sec);
    if config.dashboard.cards.is_empty() {
        config.dashboard = DashboardSettings::default();
    }
    config
}

pub fn normalize_config_for_save(config: AppConfig) -> AppConfig {
    validate_config(config)
}

fn theme_background_dir() -> PathBuf {
    if let Ok(path) = std::env::var("LAZY_BLACKTEA_THEME_DIR") {
        return PathBuf::from(path);
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .or_else(|_| {
            let drive = std::env::var("HOMEDRIVE")?;
            let path = std::env::var("HOMEPATH")?;
            Ok::<String, std::env::VarError>(format!("{drive}{path}"))
        })
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".lazy_blacktea")
        .join("themes")
        .join("backgrounds")
}

fn validate_theme_background_extension(path: &Path, trace_id: &str) -> Result<String, AppError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") {
        Ok(extension)
    } else {
        Err(AppError::validation(
            "Theme background must be a png, jpg, jpeg, webp, or gif file",
            trace_id,
        ))
    }
}

pub fn import_theme_background_from_path(
    source_path: &Path,
    trace_id: &str,
) -> Result<String, AppError> {
    let trace_id = normalize_trace_id(trace_id);
    let extension = validate_theme_background_extension(source_path, &trace_id)?;
    let metadata = fs::metadata(source_path).map_err(|err| {
        AppError::validation(
            format!("Failed to read theme background file: {err}"),
            &trace_id,
        )
    })?;
    if !metadata.is_file() {
        return Err(AppError::validation(
            "Theme background source must be a file",
            &trace_id,
        ));
    }
    if metadata.len() > THEME_BACKGROUND_MAX_BYTES {
        return Err(AppError::validation(
            "Theme background file is too large",
            &trace_id,
        ));
    }

    let target_dir = theme_background_dir();
    fs::create_dir_all(&target_dir).map_err(|err| {
        AppError::system(
            format!("Failed to create theme background directory: {err}"),
            &trace_id,
        )
    })?;
    let target = target_dir.join(format!("theme-background-{}.{}", Uuid::new_v4(), extension));
    fs::copy(source_path, &target).map_err(|err| {
        AppError::system(
            format!("Failed to import theme background: {err}"),
            &trace_id,
        )
    })?;

    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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
        assert!(config.device.auto_refresh_enabled);
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
        assert_eq!(validated.device.refresh_interval, 5);
        assert_eq!(validated.logcat.max_lines, 1000);
        assert_eq!(validated.command.max_history_size, 50);
    }

    #[test]
    fn fills_action_defaults_when_empty_or_invalid() {
        let mut config = AppConfig::default();
        config.scrcpy.bitrate = String::new();
        config.scrcpy.max_size = -10;
        config.screenshot.display_id = -99;
        config.screen_record.display_id = -99;
        config.screen_record.bit_rate = String::new();
        config.screen_record.time_limit_sec = -1;

        let validated = validate_config(config);
        assert_eq!(validated.scrcpy.bitrate, "8M");
        assert_eq!(validated.scrcpy.max_size, 0);
        assert_eq!(validated.screenshot.display_id, -1);
        assert_eq!(validated.screen_record.display_id, -1);
        assert_eq!(validated.screen_record.bit_rate, "4000000");
        assert_eq!(validated.screen_record.time_limit_sec, 180);
    }

    #[test]
    fn preserves_unbounded_and_long_screen_record_limits() {
        let mut config = AppConfig::default();
        config.screen_record.time_limit_sec = 0;
        let unbounded = validate_config(config.clone());
        assert_eq!(unbounded.screen_record.time_limit_sec, 0);

        config.screen_record.time_limit_sec = 600;
        let long = validate_config(config);
        assert_eq!(long.screen_record.time_limit_sec, 600);
    }

    #[test]
    fn loads_device_settings_without_new_fields() {
        let value = serde_json::json!({
            "device": {
                "refresh_interval": 15,
                "auto_connect": true,
                "show_offline_devices": false,
                "preferred_devices": []
            }
        });
        let parsed: AppConfig = serde_json::from_value(value).expect("config should deserialize");
        assert_eq!(parsed.device.refresh_interval, 15);
        assert!(parsed.device.auto_refresh_enabled);
    }

    #[test]
    fn loads_notifications_settings_without_new_fields() {
        let value = serde_json::json!({});
        let parsed: AppConfig = serde_json::from_value(value).expect("config should deserialize");
        assert!(parsed.notifications.enabled);
        assert!(!parsed.notifications.desktop_enabled);
        assert!(parsed.notifications.desktop_only_when_unfocused);
        assert!(!parsed.notifications.desktop_on_success);
        assert!(parsed.notifications.desktop_on_error);
        assert!(!parsed.notifications.desktop_on_cancelled);
        assert!(parsed.notifications.in_app_modal_enabled);
    }

    #[test]
    fn default_output_dir_prefers_download_dir() {
        let resolved = resolve_default_output_dir(
            Some(PathBuf::from("/tmp/Downloads")),
            Some(PathBuf::from("/tmp/home")),
        );
        assert_eq!(resolved, "/tmp/Downloads");
    }

    #[test]
    fn default_output_dir_falls_back_to_home_downloads() {
        let resolved = resolve_default_output_dir(None, Some(PathBuf::from("/tmp/home")));
        assert_eq!(resolved, "/tmp/home/Downloads");
    }

    #[test]
    fn terminal_settings_defaults_are_empty() {
        let config = AppConfig::default();
        assert!(config.terminal.restore_sessions.is_empty());
        assert!(config.terminal.buffers.is_empty());
    }

    #[test]
    fn dashboard_settings_default_to_balanced_cards() {
        let config = AppConfig::default();
        assert_eq!(config.dashboard.cards.len(), 4);
        assert_eq!(config.dashboard.cards[0].id, "overview");
        assert_eq!(config.dashboard.cards[0].fields.len(), 6);
    }

    #[test]
    fn loads_config_without_dashboard_field() {
        let value = serde_json::json!({});
        let parsed: AppConfig = serde_json::from_value(value).expect("config should deserialize");
        assert_eq!(parsed.dashboard.cards.len(), 4);
        assert!(parsed
            .dashboard
            .cards
            .iter()
            .any(|card| card.id == "device_profile"));
    }

    #[test]
    fn loads_partial_nested_settings_with_defaults() {
        let value = serde_json::json!({
            "command": {
                "parallel_execution": false
            },
            "apk_install": {
                "extra_args": "--user 0"
            },
            "screen_record": {
                "display_id": 2
            }
        });

        let parsed: AppConfig = serde_json::from_value(value).expect("config should deserialize");
        assert_eq!(parsed.command.max_history_size, 50);
        assert!(parsed.command.auto_save_history);
        assert_eq!(parsed.command.command_timeout, 30);
        assert!(!parsed.command.parallel_execution);
        assert!(parsed.apk_install.replace_existing);
        assert!(parsed.apk_install.allow_downgrade);
        assert!(parsed.apk_install.grant_permissions);
        assert!(!parsed.apk_install.allow_test_packages);
        assert_eq!(parsed.apk_install.extra_args, "--user 0");
        assert_eq!(parsed.screen_record.bit_rate, "4000000");
        assert_eq!(parsed.screen_record.time_limit_sec, 180);
        assert_eq!(parsed.screen_record.display_id, 2);
    }

    #[test]
    fn theme_style_defaults_and_legacy_ui_load() {
        let value = serde_json::json!({
            "ui": {
                "window_width": 1280,
                "window_height": 760,
                "window_x": 100,
                "window_y": 100,
                "ui_scale": 1.0,
                "theme": "dark",
                "font_size": 10,
                "show_console_panel": false,
                "single_selection": true,
                "default_output_path": "/tmp"
            }
        });

        let parsed: AppConfig = serde_json::from_value(value).expect("config should deserialize");
        assert_eq!(parsed.ui.theme_style.preset_id, "system");
        assert_eq!(parsed.ui.theme_style.background_source.kind, "preset");
        assert_eq!(parsed.ui.theme_style.background_fit, "cover");
    }

    #[test]
    fn validates_theme_style_values() {
        let mut config = AppConfig::default();
        config.ui.font_size = 99;
        config.ui.theme_style.preset_id = "missing".to_string();
        config.ui.theme_style.background_source.kind = "remote".to_string();
        config.ui.theme_style.background_source.path = "/tmp/bg.png".to_string();
        config.ui.theme_style.background_fit = "stretch".to_string();
        config.ui.theme_style.background_opacity = 2.0;
        config.ui.theme_style.panel_opacity = 0.2;
        config.ui.theme_style.colors.primary = "blue".to_string();
        config.ui.theme_style.colors.accent = "#0F766E".to_string();
        config.ui.theme_style.colors.text = "#abc".to_string();
        config.ui.theme_style.colors.muted_text = "inherit".to_string();
        config.ui.theme_style.copy_overrides.app_title = "  My Lab  ".to_string();
        config.ui.theme_style.copy_overrides.app_subtitle = "x".repeat(200);

        let validated = validate_config(config);
        assert_eq!(validated.ui.font_size, 18);
        assert_eq!(validated.ui.theme_style.preset_id, "system");
        assert_eq!(validated.ui.theme_style.background_source.kind, "preset");
        assert!(validated.ui.theme_style.background_source.path.is_empty());
        assert_eq!(validated.ui.theme_style.background_fit, "cover");
        assert_eq!(validated.ui.theme_style.background_opacity, 1.0);
        assert_eq!(validated.ui.theme_style.panel_opacity, 0.72);
        assert!(validated.ui.theme_style.colors.primary.is_empty());
        assert_eq!(validated.ui.theme_style.colors.accent, "#0f766e");
        assert_eq!(validated.ui.theme_style.colors.text, "#aabbcc");
        assert!(validated.ui.theme_style.colors.muted_text.is_empty());
        assert_eq!(validated.ui.theme_style.copy_overrides.app_title, "My Lab");
        assert_eq!(
            validated.ui.theme_style.copy_overrides.app_subtitle.len(),
            120
        );
    }

    #[test]
    fn theme_style_falls_back_when_background_path_is_missing() {
        let mut config = AppConfig::default();
        config.ui.theme_style.background_source.kind = "local_path".to_string();
        config.ui.theme_style.background_source.path =
            "/tmp/missing-lazy-blacktea-bg.png".to_string();

        let validated = validate_config(config);
        assert_eq!(validated.ui.theme_style.background_source.kind, "preset");
        assert!(validated.ui.theme_style.background_source.path.is_empty());
    }

    #[test]
    fn imports_theme_background_with_validation() {
        let dir = TempDir::new().expect("tmp");
        let source = dir.path().join("source.png");
        fs::write(&source, b"png").expect("write image");
        let theme_dir = dir.path().join("managed");
        std::env::set_var("LAZY_BLACKTEA_THEME_DIR", &theme_dir);

        let imported =
            import_theme_background_from_path(&source, "theme-trace").expect("import background");
        let imported_path = PathBuf::from(imported);
        assert!(imported_path.exists());
        assert_eq!(
            imported_path.extension().and_then(|value| value.to_str()),
            Some("png")
        );

        std::env::remove_var("LAZY_BLACKTEA_THEME_DIR");
    }

    #[test]
    fn rejects_invalid_theme_background_imports_with_trace_id() {
        let dir = TempDir::new().expect("tmp");
        let source = dir.path().join("source.txt");
        fs::write(&source, b"text").expect("write text");

        let err = import_theme_background_from_path(&source, "theme-trace")
            .expect_err("expected validation error");
        assert_eq!(err.code, "ERR_VALIDATION");
        assert_eq!(err.trace_id, "theme-trace");
    }

    #[test]
    fn load_config_reports_invalid_config_instead_of_silently_defaulting() {
        let dir = TempDir::new().expect("tmp");
        let path = dir.path().join("config.json");
        // window_width is expected to be a number; a string should fail deserialization.
        let payload = r#"{ "ui": { "window_width": "oops" } }"#;
        fs::write(&path, payload).expect("write");

        let err = load_config_from_path(&path, "test-trace").expect_err("expected error");
        assert_eq!(err.code, "ERR_VALIDATION");
        assert_eq!(err.trace_id, "test-trace");
    }

    #[test]
    fn clamp_terminal_buffer_lines_trims_length_and_count() {
        let mut lines = vec![
            "short".to_string(),
            "x".repeat(TERMINAL_PERSIST_MAX_LINE_CHARS + 10),
        ];
        for _ in 0..(TERMINAL_PERSIST_MAX_LINES + 20) {
            lines.push("keep".to_string());
        }
        clamp_terminal_buffer_lines(&mut lines);
        assert!(lines.len() <= TERMINAL_PERSIST_MAX_LINES);
        assert!(lines
            .iter()
            .all(|line| line.len() <= TERMINAL_PERSIST_MAX_LINE_CHARS));
    }
}
