use std::collections::HashMap;

use regex::Regex;

use crate::app::models::{DeviceDetail, DeviceFileEntry, DeviceSummary};

pub fn parse_adb_devices(output: &str) -> Vec<DeviceSummary> {
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter(|line| !line.trim_start().starts_with('*'))
        .filter(|line| !line.to_lowercase().contains("list of devices"))
        .filter_map(|line| {
            let tokens: Vec<&str> = line.split_whitespace().collect();
            if tokens.len() < 2 {
                return None;
            }
            let serial = tokens[0].to_string();
            let state = tokens[1].to_string();
            let mut model = None;
            let mut product = None;
            let mut device = None;
            let mut transport_id = None;
            for token in tokens.iter().skip(2) {
                if let Some(value) = token.strip_prefix("model:") {
                    model = Some(value.to_string());
                } else if let Some(value) = token.strip_prefix("product:") {
                    product = Some(value.to_string());
                } else if let Some(value) = token.strip_prefix("device:") {
                    device = Some(value.to_string());
                } else if let Some(value) = token.strip_prefix("transport_id:") {
                    transport_id = Some(value.to_string());
                }
            }
            Some(DeviceSummary {
                serial,
                state,
                model,
                product,
                device,
                transport_id,
            })
        })
        .collect()
}

pub fn parse_getprop_map(output: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('[') {
            continue;
        }
        let Some((key_part, value_part)) = trimmed.split_once("]: [") else {
            continue;
        };
        let key = key_part.trim_start_matches('[').trim();
        let value = value_part.trim_end_matches(']').trim();
        if !key.is_empty() {
            map.insert(key.to_string(), value.to_string());
        }
    }
    map
}

pub fn build_device_detail(serial: &str, getprop_map: &HashMap<String, String>) -> DeviceDetail {
    DeviceDetail {
        serial: serial.to_string(),
        brand: getprop_map.get("ro.product.brand").cloned(),
        model: getprop_map.get("ro.product.model").cloned(),
        device: getprop_map.get("ro.product.device").cloned(),
        android_version: getprop_map.get("ro.build.version.release").cloned(),
        api_level: getprop_map.get("ro.build.version.sdk").cloned(),
        battery_level: None,
        wifi_is_on: None,
        bt_is_on: None,
        gms_version: None,
        build_fingerprint: getprop_map.get("ro.build.fingerprint").cloned(),
        audio_state: None,
        bluetooth_manager_state: None,
    }
}

pub fn parse_battery_level(output: &str) -> Option<u8> {
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("level:") {
            if let Ok(level) = value.trim().parse::<u8>() {
                return Some(level);
            }
        }
    }
    None
}

pub fn parse_settings_bool(output: &str) -> Option<bool> {
    let value = output
        .lines()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())?;
    if let Ok(num) = value.parse::<i32>() {
        return Some(num != 0);
    }
    match value.to_lowercase().as_str() {
        "true" | "on" | "enabled" => Some(true),
        "false" | "off" | "disabled" => Some(false),
        _ => None,
    }
}

pub fn parse_audio_summary(output: &str) -> Option<String> {
    let mode_re = Regex::new(r"(?i)\bmode\s*[:=]\s*([A-Za-z_]+)").ok()?;
    let ringer_re = Regex::new(r"(?i)\bringer\s+mode\s*[:=]\s*([A-Za-z_]+)").ok()?;
    let music_re = Regex::new(r"(?i)music\s+active\s*[:=]\s*([A-Za-z_]+)").ok()?;
    let device_re = Regex::new(r"(?i)device\s+(?:current\s+)?state\s*[:=]\s*(.+)")
        .ok()?;
    let sco_re = Regex::new(r"(?i)sco\s+state\s*[:=]\s*(.+)").ok()?;

    let mut summary: HashMap<&str, String> = HashMap::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if !summary.contains_key("mode") {
            if let Some(caps) = mode_re.captures(trimmed) {
                summary.insert("mode", caps[1].to_uppercase());
                continue;
            }
        }
        if !summary.contains_key("ringer") {
            if let Some(caps) = ringer_re.captures(trimmed) {
                summary.insert("ringer", caps[1].to_uppercase());
                continue;
            }
        }
        if !summary.contains_key("music_active") {
            if let Some(caps) = music_re.captures(trimmed) {
                summary.insert("music_active", caps[1].to_lowercase());
                continue;
            }
        }
        if !summary.contains_key("device_state") {
            if let Some(caps) = device_re.captures(trimmed) {
                summary.insert("device_state", caps[1].trim().to_string());
                continue;
            }
        }
        if !summary.contains_key("sco_state") {
            if let Some(caps) = sco_re.captures(trimmed) {
                summary.insert("sco_state", caps[1].trim().to_string());
            }
        }

        if summary.len() >= 5 {
            break;
        }
    }

    if summary.is_empty() {
        return None;
    }

    let mut parts = Vec::new();
    if let Some(mode) = summary.get("mode") {
        parts.push(format!("mode={mode}"));
    }
    if let Some(ringer) = summary.get("ringer") {
        parts.push(format!("ringer={ringer}"));
    }
    if let Some(music) = summary.get("music_active") {
        parts.push(format!("music_active={music}"));
    }
    if let Some(device_state) = summary.get("device_state") {
        parts.push(format!("device_state={device_state}"));
    }
    if let Some(sco_state) = summary.get("sco_state") {
        parts.push(format!("sco_state={sco_state}"));
    }

    Some(parts.join(" | "))
}

pub fn parse_bluetooth_manager_state(output: &str) -> Option<String> {
    let state_re = Regex::new(r"(?i)state\s*[:=]\s*([A-Za-z_]+)").ok()?;
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(caps) = state_re.captures(trimmed) {
            return Some(caps[1].to_uppercase());
        }
    }
    output
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
}

pub fn parse_dumpsys_version_name(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("versionName=") {
            return Some(value.trim_matches(['\"', '\'']).to_string());
        }
        if let Some(value) = trimmed.strip_prefix("versionName:") {
            return Some(value.trim_matches(['\"', '\'']).to_string());
        }
        if trimmed.contains("versionName") {
            if let Some((_, tail)) = trimmed.split_once("versionName=") {
                return Some(tail.trim_matches(['\"', '\'']).to_string());
            }
        }
    }
    None
}

pub fn parse_ls_la(path: &str, output: &str) -> Vec<DeviceFileEntry> {
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter(|line| !line.trim_start().starts_with("total"))
        .filter_map(|line| {
            let trimmed = line.trim();
            let tokens: Vec<&str> = trimmed.split_whitespace().collect();
            if tokens.len() < 8 {
                return None;
            }
            let perm = tokens[0];
            let is_dir = perm.starts_with('d');
            let size_bytes = tokens.get(4).and_then(|value| value.parse::<u64>().ok());
            let (modified_at, name_start_index) = if tokens.len() >= 9 {
                (
                    format!("{} {} {}", tokens[5], tokens[6], tokens[7]),
                    8usize,
                )
            } else {
                (format!("{} {}", tokens[5], tokens[6]), 7usize)
            };
            let modified_at = Some(modified_at).filter(|value| !value.trim().is_empty());
            let name = if tokens.len() > name_start_index {
                tokens[name_start_index..].join(" ")
            } else {
                String::new()
            };
            if name.is_empty() || name == "." || name == ".." {
                return None;
            }
            Some(DeviceFileEntry {
                name: name.clone(),
                path: format!("{}/{}", path.trim_end_matches('/'), name),
                is_dir,
                size_bytes,
                modified_at,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_adb_devices_output() {
        let output = "List of devices attached\n0123456789ABCDEF device product:sdk_gphone64_arm64 model:Pixel_7 device:emu64a transport_id:1\nemulator-5554 unauthorized transport_id:2\n";
        let parsed = parse_adb_devices(output);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].serial, "0123456789ABCDEF");
        assert_eq!(parsed[0].state, "device");
        assert_eq!(parsed[0].model.as_deref(), Some("Pixel_7"));
        assert_eq!(parsed[1].state, "unauthorized");
    }

    #[test]
    fn parses_getprop_map() {
        let output = "[ro.product.brand]: [google]\n[ro.product.model]: [Pixel 7]\n";
        let map = parse_getprop_map(output);
        assert_eq!(map.get("ro.product.brand").map(String::as_str), Some("google"));
        assert_eq!(map.get("ro.product.model").map(String::as_str), Some("Pixel 7"));
    }

    #[test]
    fn builds_device_detail() {
        let output = "[ro.product.brand]: [google]\n[ro.product.model]: [Pixel 7]\n[ro.build.version.sdk]: [34]\n";
        let map = parse_getprop_map(output);
        let detail = build_device_detail("ABC", &map);
        assert_eq!(detail.serial, "ABC");
        assert_eq!(detail.brand.as_deref(), Some("google"));
        assert_eq!(detail.model.as_deref(), Some("Pixel 7"));
        assert_eq!(detail.api_level.as_deref(), Some("34"));
    }

    #[test]
    fn parses_battery_level() {
        let output = "AC powered: false\nlevel: 87\nstatus: 2\n";
        assert_eq!(parse_battery_level(output), Some(87));
    }

    #[test]
    fn parses_ls_la() {
        let output = "drwxr-xr-x 2 root root 4096 2024-01-01 12:00 Download\n-rw-r--r-- 1 root root 123 2024-01-01 12:00 file.txt\n";
        let entries = parse_ls_la("/sdcard", output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "Download");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].path, "/sdcard/file.txt");
    }

    #[test]
    fn parses_settings_bool() {
        assert_eq!(parse_settings_bool("1"), Some(true));
        assert_eq!(parse_settings_bool("0"), Some(false));
        assert_eq!(parse_settings_bool("true"), Some(true));
        assert_eq!(parse_settings_bool("disabled"), Some(false));
    }

    #[test]
    fn parses_audio_summary() {
        let output = "mode: IN_COMMUNICATION\nringer mode: NORMAL\nmusic active: true\n";
        let summary = parse_audio_summary(output).unwrap_or_default();
        assert!(summary.contains("mode=IN_COMMUNICATION"));
        assert!(summary.contains("ringer=NORMAL"));
        assert!(summary.contains("music_active=true"));
    }

    #[test]
    fn parses_bluetooth_manager_state() {
        let output = "state: ON\n";
        assert_eq!(
            parse_bluetooth_manager_state(output).as_deref(),
            Some("ON")
        );
    }

    #[test]
    fn parses_dumpsys_versions() {
        let output = "versionName=22.1.0\nversionCode=12345 minSdk=23\n";
        assert_eq!(
            parse_dumpsys_version_name(output).as_deref(),
            Some("22.1.0")
        );
    }
}
