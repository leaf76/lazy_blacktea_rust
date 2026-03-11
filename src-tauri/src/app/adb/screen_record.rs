use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::app::adb::paths::sanitize_filename_component;
use crate::app::config::ScreenRecordSettings;

pub const DEFAULT_SCREEN_RECORD_TIME_LIMIT_SEC: i32 = 180;
pub const MAX_ADB_SCREEN_RECORD_TIME_LIMIT_SEC: u32 = 180;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScreenRecordBackend {
    Adb,
    AdbSegmented,
    Scrcpy,
}

pub fn normalize_screen_record_time_limit_sec(value: i32) -> i32 {
    if value < 0 {
        DEFAULT_SCREEN_RECORD_TIME_LIMIT_SEC
    } else {
        value
    }
}

pub fn select_screen_record_backend(
    time_limit_sec: i32,
    scrcpy_available: bool,
) -> ScreenRecordBackend {
    if time_limit_sec == 0 || time_limit_sec > MAX_ADB_SCREEN_RECORD_TIME_LIMIT_SEC as i32 {
        if scrcpy_available {
            ScreenRecordBackend::Scrcpy
        } else {
            ScreenRecordBackend::AdbSegmented
        }
    } else {
        ScreenRecordBackend::Adb
    }
}

pub fn build_screen_record_file_stem(
    serial: &str,
    timestamp: &str,
    segment_index: Option<usize>,
) -> String {
    let safe_serial = sanitize_filename_component(serial);
    match segment_index {
        Some(index) => format!(
            "screenrecord_{safe_serial}_{timestamp}_part{:02}",
            index + 1
        ),
        None => format!("screenrecord_{safe_serial}_{timestamp}"),
    }
}

pub fn build_remote_recording_path(
    serial: &str,
    timestamp: &str,
    segment_index: Option<usize>,
) -> String {
    format!(
        "/sdcard/{}.mp4",
        build_screen_record_file_stem(serial, timestamp, segment_index)
    )
}

pub fn build_local_recording_path(
    output_dir: &Path,
    serial: &str,
    timestamp: &str,
    segment_index: Option<usize>,
    extension: &str,
) -> PathBuf {
    output_dir.join(format!(
        "{}.{}",
        build_screen_record_file_stem(serial, timestamp, segment_index),
        extension.trim_start_matches('.')
    ))
}

pub fn build_adb_screen_record_args(
    serial: &str,
    settings: &ScreenRecordSettings,
    remote_path: &str,
    override_time_limit_sec: Option<u32>,
) -> Vec<String> {
    let mut args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "screenrecord".to_string(),
    ];
    if !settings.bit_rate.trim().is_empty() {
        args.push("--bit-rate".to_string());
        args.push(settings.bit_rate.trim().to_string());
    }
    let time_limit_sec = override_time_limit_sec
        .map(|value| value.min(MAX_ADB_SCREEN_RECORD_TIME_LIMIT_SEC))
        .or_else(|| {
            if settings.time_limit_sec > 0 {
                Some((settings.time_limit_sec as u32).min(MAX_ADB_SCREEN_RECORD_TIME_LIMIT_SEC))
            } else {
                None
            }
        });
    if let Some(limit) = time_limit_sec {
        args.push("--time-limit".to_string());
        args.push(limit.to_string());
    }
    if !settings.size.trim().is_empty() {
        args.push("--size".to_string());
        args.push(settings.size.trim().to_string());
    }
    if settings.use_hevc {
        args.push("--codec".to_string());
        args.push("hevc".to_string());
    }
    if settings.bugreport {
        args.push("--bugreport".to_string());
    }
    if settings.verbose {
        args.push("--verbose".to_string());
    }
    if settings.display_id >= 0 {
        args.push("--display-id".to_string());
        args.push(settings.display_id.to_string());
    }
    if !settings.extra_args.trim().is_empty() {
        args.extend(
            settings
                .extra_args
                .split_whitespace()
                .map(|item| item.to_string()),
        );
    }
    args.push(remote_path.to_string());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_settings() -> ScreenRecordSettings {
        ScreenRecordSettings {
            bit_rate: "4000000".to_string(),
            time_limit_sec: 180,
            size: String::new(),
            extra_args: String::new(),
            use_hevc: false,
            bugreport: false,
            verbose: false,
            display_id: -1,
        }
    }

    fn has_flag_with_value(args: &[String], flag: &str, value: &str) -> bool {
        args.windows(2)
            .any(|pair| pair[0] == flag && pair[1] == value)
    }

    #[test]
    fn select_screen_record_backend_uses_adb_for_short_recordings() {
        assert_eq!(
            select_screen_record_backend(180, true),
            ScreenRecordBackend::Adb
        );
        assert_eq!(
            select_screen_record_backend(30, false),
            ScreenRecordBackend::Adb
        );
    }

    #[test]
    fn select_screen_record_backend_prefers_scrcpy_for_long_or_unbounded_recordings() {
        assert_eq!(
            select_screen_record_backend(181, true),
            ScreenRecordBackend::Scrcpy
        );
        assert_eq!(
            select_screen_record_backend(0, true),
            ScreenRecordBackend::Scrcpy
        );
    }

    #[test]
    fn select_screen_record_backend_falls_back_to_segmented_adb_without_scrcpy() {
        assert_eq!(
            select_screen_record_backend(181, false),
            ScreenRecordBackend::AdbSegmented
        );
        assert_eq!(
            select_screen_record_backend(0, false),
            ScreenRecordBackend::AdbSegmented
        );
    }

    #[test]
    fn build_adb_screen_record_args_respects_override_limit_and_caps_it() {
        let settings = base_settings();
        let args = build_adb_screen_record_args("device", &settings, "/sdcard/out.mp4", Some(240));
        assert!(has_flag_with_value(&args, "--time-limit", "180"));
    }

    #[test]
    fn build_adb_screen_record_args_omits_limit_for_unbounded_setting() {
        let mut settings = base_settings();
        settings.time_limit_sec = 0;
        let args = build_adb_screen_record_args("device", &settings, "/sdcard/out.mp4", None);
        assert!(!args.iter().any(|item| item == "--time-limit"));
    }

    #[test]
    fn normalize_screen_record_time_limit_sec_preserves_zero_and_large_values() {
        assert_eq!(normalize_screen_record_time_limit_sec(-1), 180);
        assert_eq!(normalize_screen_record_time_limit_sec(0), 0);
        assert_eq!(normalize_screen_record_time_limit_sec(600), 600);
    }
}
