use std::path::Path;
use std::process::Command;

use crate::app::config::ScrcpySettings;

pub struct ScrcpyAvailability {
    pub available: bool,
    pub version_output: String,
    pub major_version: i32,
    pub command_path: String,
}

pub fn check_scrcpy_availability() -> ScrcpyAvailability {
    let mut result = ScrcpyAvailability {
        available: false,
        version_output: String::new(),
        major_version: 2,
        command_path: "scrcpy".to_string(),
    };

    if let Some(output) = try_version("scrcpy") {
        result.available = true;
        result.version_output = output.clone();
        result.major_version = parse_scrcpy_major(&output);
        return result;
    }

    let system = std::env::consts::OS;
    let common_paths = if system == "macos" {
        vec![
            "/opt/homebrew/bin/scrcpy",
            "/usr/local/bin/scrcpy",
            "/opt/homebrew/Caskroom/scrcpy",
            "~/Applications/scrcpy.app/Contents/MacOS/scrcpy",
        ]
    } else {
        vec![
            "/usr/bin/scrcpy",
            "/usr/local/bin/scrcpy",
            "/snap/bin/scrcpy",
            "/flatpak/exports/bin/scrcpy",
            "~/.local/bin/scrcpy",
            "/opt/scrcpy/scrcpy",
        ]
    };

    for path in common_paths {
        let expanded = expand_home(path);
        if expanded.contains('*') {
            continue;
        }
        if !Path::new(&expanded).exists() {
            continue;
        }
        if let Some(output) = try_version(&expanded) {
            result.available = true;
            result.version_output = output.clone();
            result.major_version = parse_scrcpy_major(&output);
            result.command_path = expanded;
            return result;
        }
    }

    result
}

pub fn build_scrcpy_command(serial: &str, settings: &ScrcpySettings, major_version: i32) -> Vec<String> {
    let mut args = vec!["scrcpy".to_string(), "-s".to_string(), serial.to_string()];
    let audio_mode = if major_version >= 3 {
        AudioFlagMode::NoAudioOnly
    } else if major_version >= 2 {
        AudioFlagMode::AudioToggle
    } else {
        AudioFlagMode::Unsupported
    };
    if settings.stay_awake {
        args.push("--stay-awake".to_string());
    }
    if settings.turn_screen_off {
        args.push("--turn-screen-off".to_string());
    }
    if settings.disable_screensaver {
        args.push("--disable-screensaver".to_string());
    }
    match audio_mode {
        AudioFlagMode::AudioToggle => {
            if settings.enable_audio_playback {
                args.push("--audio".to_string());
            } else {
                args.push("--no-audio".to_string());
            }
        }
        AudioFlagMode::NoAudioOnly => {
            if !settings.enable_audio_playback {
                args.push("--no-audio".to_string());
            }
        }
        AudioFlagMode::Unsupported => {}
    }
    if !settings.bitrate.trim().is_empty() {
        args.push("--bit-rate".to_string());
        args.push(settings.bitrate.trim().to_string());
    }
    if settings.max_size > 0 {
        args.push("--max-size".to_string());
        args.push(settings.max_size.to_string());
    }
    if !settings.extra_args.trim().is_empty() {
        args.extend(settings.extra_args.split_whitespace().map(|s| s.to_string()));
    }
    args
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum AudioFlagMode {
    AudioToggle,
    NoAudioOnly,
    Unsupported,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_settings() -> ScrcpySettings {
        ScrcpySettings {
            stay_awake: false,
            turn_screen_off: false,
            disable_screensaver: false,
            enable_audio_playback: true,
            bitrate: String::new(),
            max_size: 0,
            extra_args: String::new(),
        }
    }

    fn has_flag(args: &[String], flag: &str) -> bool {
        args.iter().any(|item| item == flag)
    }

    #[test]
    fn build_scrcpy_command_audio_major3_enabled_has_no_audio_flag() {
        let settings = base_settings();
        let args = build_scrcpy_command("device", &settings, 3);
        assert!(!has_flag(&args, "--audio"));
        assert!(!has_flag(&args, "--no-audio"));
    }

    #[test]
    fn build_scrcpy_command_audio_major3_disabled_adds_no_audio() {
        let mut settings = base_settings();
        settings.enable_audio_playback = false;
        let args = build_scrcpy_command("device", &settings, 3);
        assert!(!has_flag(&args, "--audio"));
        assert!(has_flag(&args, "--no-audio"));
    }

    #[test]
    fn build_scrcpy_command_audio_major2_enabled_adds_audio() {
        let settings = base_settings();
        let args = build_scrcpy_command("device", &settings, 2);
        assert!(has_flag(&args, "--audio"));
    }

    #[test]
    fn build_scrcpy_command_audio_major2_disabled_adds_no_audio() {
        let mut settings = base_settings();
        settings.enable_audio_playback = false;
        let args = build_scrcpy_command("device", &settings, 2);
        assert!(has_flag(&args, "--no-audio"));
    }

    #[test]
    fn build_scrcpy_command_audio_major1_ignores_audio_flags() {
        let settings = base_settings();
        let args = build_scrcpy_command("device", &settings, 1);
        assert!(!has_flag(&args, "--audio"));
        assert!(!has_flag(&args, "--no-audio"));
    }
}

fn try_version(command: &str) -> Option<String> {
    let output = Command::new(command)
        .arg("--version")
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn parse_scrcpy_major(output: &str) -> i32 {
    let lower = output.to_lowercase();
    for token in lower.split_whitespace() {
        if token.starts_with("scrcpy") {
            let version = token.trim_start_matches("scrcpy");
            if let Some(version) = version.strip_prefix("v") {
                if let Some(major) = version.split('.').next() {
                    if let Ok(value) = major.parse::<i32>() {
                        return value;
                    }
                }
            }
        }
        if let Some(major) = token.split('.').next() {
            if let Ok(value) = major.parse::<i32>() {
                return value;
            }
        }
    }
    2
}

fn expand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}
