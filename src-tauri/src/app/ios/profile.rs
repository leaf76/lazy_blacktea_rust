use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use plist::Value as PlistValue;

use crate::app::adb::runner::{run_command_with_timeout, CommandOutput};
use crate::app::error::AppError;
use crate::app::models::{IosProfileInstallResult, IosProfileInstallStatus, MobileconfigSummary};

use super::tools::{cfgutil_profile_install_supported, check_ios_tools};
use super::trust::humanize_ios_tool_error;
use super::validate::validate_ios_serial;

const IOS_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(6);
const IOS_PROFILE_INSTALL_TIMEOUT: Duration = Duration::from_secs(60);
const MOBILECONFIG_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn validate_mobileconfig_path(profile_path: &str, trace_id: &str) -> Result<PathBuf, AppError> {
    let trimmed = profile_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("profile_path is required", trace_id));
    }
    let path = PathBuf::from(trimmed);
    let has_mobileconfig_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("mobileconfig"))
        .unwrap_or(false);
    if !has_mobileconfig_extension {
        return Err(AppError::validation(
            "Only .mobileconfig profiles are supported",
            trace_id,
        ));
    }
    let canonical = fs::canonicalize(&path).map_err(|err| {
        AppError::validation(format!("Profile file is not readable: {err}"), trace_id)
    })?;
    let metadata = fs::metadata(&canonical).map_err(|err| {
        AppError::validation(format!("Profile file is not readable: {err}"), trace_id)
    })?;
    if !metadata.is_file() {
        return Err(AppError::validation(
            "Profile path must be a file",
            trace_id,
        ));
    }
    if metadata.len() > MOBILECONFIG_MAX_BYTES {
        return Err(AppError::validation(
            format!(
                "Profile file is larger than {} bytes",
                MOBILECONFIG_MAX_BYTES
            ),
            trace_id,
        ));
    }
    Ok(canonical)
}

fn plist_string(value: Option<&PlistValue>) -> Option<String> {
    value
        .and_then(PlistValue::as_string)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub fn parse_mobileconfig_summary_value(
    value: &PlistValue,
    trace_id: &str,
) -> Result<MobileconfigSummary, AppError> {
    let Some(dictionary) = value.as_dictionary() else {
        return Err(AppError::validation(
            "Profile plist root must be a dictionary",
            trace_id,
        ));
    };
    let payload_count = dictionary
        .get("PayloadContent")
        .and_then(PlistValue::as_array)
        .map(Vec::len)
        .unwrap_or(0);

    let summary = MobileconfigSummary {
        display_name: plist_string(dictionary.get("PayloadDisplayName")),
        identifier: plist_string(dictionary.get("PayloadIdentifier")),
        uuid: plist_string(dictionary.get("PayloadUUID")),
        payload_type: plist_string(dictionary.get("PayloadType")),
        payload_count,
    };
    if summary.payload_type.as_deref() != Some("Configuration") {
        return Err(AppError::validation(
            "Profile plist must use PayloadType Configuration",
            trace_id,
        ));
    }
    Ok(summary)
}

pub fn validate_mobileconfig(
    profile_path: &str,
    trace_id: &str,
) -> Result<MobileconfigSummary, AppError> {
    let path = validate_mobileconfig_path(profile_path, trace_id)?;
    let value = PlistValue::from_file(&path)
        .map_err(|err| AppError::validation(format!("Malformed profile plist: {err}"), trace_id))?;
    parse_mobileconfig_summary_value(&value, trace_id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CfgutilDevice {
    pub ecid: String,
    pub udid: String,
    pub name: Option<String>,
}

fn looks_like_ecid(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with("0x")
        && trimmed.len() > 2
        && trimmed[2..].chars().all(|item| item.is_ascii_hexdigit())
}

fn looks_like_udid(value: &str) -> bool {
    let trimmed = value.trim();
    let hex_or_dash = trimmed
        .chars()
        .all(|item| item.is_ascii_hexdigit() || item == '-');
    hex_or_dash && trimmed.len() >= 24
}

pub fn parse_cfgutil_list_output(output: &str) -> Vec<CfgutilDevice> {
    output
        .lines()
        .filter_map(|line| {
            let parts = line.split_whitespace().collect::<Vec<_>>();
            let ecid_index = parts.iter().position(|part| looks_like_ecid(part))?;
            let udid_index = parts
                .iter()
                .enumerate()
                .skip(ecid_index + 1)
                .find_map(|(index, part)| looks_like_udid(part).then_some(index))?;
            let name = if let Some(name_index) = parts.iter().position(|part| *part == "Name:") {
                let raw_name = parts[(name_index + 1)..].join(" ");
                (!raw_name.trim().is_empty()).then_some(raw_name)
            } else if parts.len() > udid_index + 2 {
                Some(parts[(udid_index + 2)..].join(" "))
            } else {
                None
            };
            Some(CfgutilDevice {
                ecid: parts[ecid_index].to_string(),
                udid: parts[udid_index].to_string(),
                name,
            })
        })
        .collect()
}

fn cfgutil_devices(trace_id: &str) -> Result<Vec<CfgutilDevice>, AppError> {
    let output = run_command_with_timeout(
        "cfgutil",
        &["list".to_string()],
        IOS_DISCOVERY_TIMEOUT,
        trace_id,
    )?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            humanize_ios_tool_error(&format!("cfgutil list failed: {}", output.stderr.trim())),
            trace_id,
        ));
    }
    Ok(parse_cfgutil_list_output(&output.stdout))
}

fn sanitize_cfgutil_message(output: &CommandOutput) -> String {
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        return humanize_ios_tool_error(stderr);
    }
    let stdout = output.stdout.trim();
    if !stdout.is_empty() {
        return humanize_ios_tool_error(stdout);
    }
    "cfgutil returned a non-zero exit code".to_string()
}

fn find_cfgutil_device<'a>(
    devices: &'a [CfgutilDevice],
    serial: &str,
) -> Option<&'a CfgutilDevice> {
    devices.iter().find(|device| {
        device.udid.eq_ignore_ascii_case(serial) || device.ecid.eq_ignore_ascii_case(serial)
    })
}

fn install_configuration_profile_on_ecid(
    ecid: &str,
    profile_path: &Path,
    trace_id: &str,
) -> Result<CommandOutput, AppError> {
    let args = vec![
        "-e".to_string(),
        ecid.to_string(),
        "install-profile".to_string(),
        profile_path.to_string_lossy().to_string(),
    ];
    run_command_with_timeout("cfgutil", &args, IOS_PROFILE_INSTALL_TIMEOUT, trace_id)
}

pub fn install_configuration_profile(
    serials: Vec<String>,
    profile_path: &str,
    trace_id: &str,
) -> Result<Vec<IosProfileInstallResult>, AppError> {
    let _summary = validate_mobileconfig(profile_path, trace_id)?;
    let profile_path = validate_mobileconfig_path(profile_path, trace_id)?;
    if serials.is_empty() {
        return Err(AppError::validation("serials is required", trace_id));
    }
    if !cfgutil_profile_install_supported() {
        return Err(AppError::dependency(
            "Configuration profile install requires macOS and Apple Configurator cfgutil",
            trace_id,
        ));
    }
    let tools = check_ios_tools(trace_id);
    if !tools.cfgutil.available {
        return Err(AppError::dependency("cfgutil is not available", trace_id));
    }
    // Fresh list immediately before install to reduce ECID/UDID drift.
    let cfgutil_devices = cfgutil_devices(trace_id)?;
    let mut results = Vec::with_capacity(serials.len());

    for serial in serials {
        let serial = match validate_ios_serial(&serial, trace_id) {
            Ok(value) => value,
            Err(_) if serial.trim().is_empty() => {
                results.push(IosProfileInstallResult {
                    serial: serial.trim().to_string(),
                    status: IosProfileInstallStatus::Skipped,
                    message: "Skipped empty device serial.".to_string(),
                    trace_id: trace_id.to_string(),
                });
                continue;
            }
            Err(err) => {
                results.push(IosProfileInstallResult {
                    serial: serial.trim().to_string(),
                    status: IosProfileInstallStatus::Skipped,
                    message: err.error,
                    trace_id: trace_id.to_string(),
                });
                continue;
            }
        };
        let Some(device) = find_cfgutil_device(&cfgutil_devices, &serial) else {
            results.push(IosProfileInstallResult {
                serial,
                status: IosProfileInstallStatus::Skipped,
                message: "Device is not visible to cfgutil. Connect over USB, unlock, and trust this Mac.".to_string(),
                trace_id: trace_id.to_string(),
            });
            continue;
        };
        match install_configuration_profile_on_ecid(&device.ecid, &profile_path, trace_id) {
            Ok(output) if output.exit_code.unwrap_or_default() == 0 => {
                results.push(IosProfileInstallResult {
                    serial,
                    status: IosProfileInstallStatus::Installed,
                    message: format!("Configuration profile installed (ECID {}).", device.ecid),
                    trace_id: trace_id.to_string(),
                });
            }
            Ok(output) => {
                results.push(IosProfileInstallResult {
                    serial,
                    status: IosProfileInstallStatus::Failed,
                    message: sanitize_cfgutil_message(&output),
                    trace_id: trace_id.to_string(),
                });
            }
            Err(err) => {
                results.push(IosProfileInstallResult {
                    serial,
                    status: IosProfileInstallStatus::Failed,
                    message: humanize_ios_tool_error(&err.error),
                    trace_id: trace_id.to_string(),
                });
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mobileconfig_summary_value_reads_top_level_metadata() {
        let raw = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadDisplayName</key>
      <string>Wi-Fi</string>
      <key>PayloadType</key>
      <string>com.apple.wifi.managed</string>
    </dict>
    <dict>
      <key>PayloadDisplayName</key>
      <string>Web Clip</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>Lab Profile</string>
  <key>PayloadIdentifier</key>
  <string>com.example.lab</string>
  <key>PayloadUUID</key>
  <string>11111111-2222-3333-4444-555555555555</string>
  <key>PayloadType</key>
  <string>Configuration</string>
</dict>
</plist>"#;

        let value = PlistValue::from_reader_xml(raw.as_bytes()).expect("valid plist");
        let summary =
            parse_mobileconfig_summary_value(&value, "trace-profile").expect("valid profile");

        assert_eq!(summary.display_name.as_deref(), Some("Lab Profile"));
        assert_eq!(summary.identifier.as_deref(), Some("com.example.lab"));
        assert_eq!(summary.payload_count, 2);
    }

    #[test]
    fn parse_mobileconfig_summary_value_rejects_non_configuration_root() {
        let raw = r#"<plist version="1.0"><dict><key>PayloadType</key><string>com.apple.wifi.managed</string></dict></plist>"#;
        let value = PlistValue::from_reader_xml(raw.as_bytes()).expect("valid plist");
        let err =
            parse_mobileconfig_summary_value(&value, "trace-profile").expect_err("invalid root");

        assert_eq!(err.code, "ERR_VALIDATION");
        assert!(err.error.contains("PayloadType Configuration"));
    }

    #[test]
    fn validate_mobileconfig_rejects_invalid_extension() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("profile.txt");
        fs::write(&path, "<plist/>").expect("write profile");

        let err =
            validate_mobileconfig(path.to_str().unwrap(), "trace-profile").expect_err("extension");

        assert_eq!(err.code, "ERR_VALIDATION");
        assert!(err.error.contains(".mobileconfig"));
    }

    #[test]
    fn parse_cfgutil_list_output_maps_ecid_to_udid() {
        let raw = "\
Type    ECID                UDID                                  Location     Name
iPhone  0x0000000000000001  00008030-001C195E0E82802E            0x14100000   Lab iPhone
iPad    0x0000000000000002  00008110-000A111122223333            0x14200000   Lab iPad
";

        let devices = parse_cfgutil_list_output(raw);

        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].ecid, "0x0000000000000001");
        assert_eq!(devices[0].udid, "00008030-001C195E0E82802E");
        assert_eq!(devices[0].name.as_deref(), Some("Lab iPhone"));
    }

    #[test]
    fn parse_cfgutil_list_output_handles_labeled_rows() {
        let raw = "\
Type: iPhone ECID: 0x0000000000000001 UDID: 00008030001C195E0E82802E Location: 0x14100000 Name: Lab iPhone
";

        let devices = parse_cfgutil_list_output(raw);

        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].ecid, "0x0000000000000001");
        assert_eq!(devices[0].udid, "00008030001C195E0E82802E");
        assert_eq!(devices[0].name.as_deref(), Some("Lab iPhone"));
    }
}
