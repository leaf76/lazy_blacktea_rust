use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use plist::Value as PlistValue;
use serde_json::Value;
use tracing::warn;

use crate::app::adb::runner::{run_command_with_timeout, CommandOutput};
use crate::app::error::AppError;
use crate::app::models::{
    DeviceCapabilities, DeviceDetail, DeviceInfo, DevicePlatform, DeviceSummary, HostCommandResult,
    IosProfileInstallResult, IosProfileInstallStatus, IosToolStatus, IosToolsInfo,
    MobileconfigSummary,
};

const IOS_TOOL_TIMEOUT: Duration = Duration::from_secs(3);
const IOS_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(6);
const IOS_PROFILE_INSTALL_TIMEOUT: Duration = Duration::from_secs(60);
const MOBILECONFIG_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn cfgutil_profile_install_supported() -> bool {
    cfg!(target_os = "macos")
}

fn tool_status_unavailable(command_path: &str, error: impl Into<String>) -> IosToolStatus {
    IosToolStatus {
        available: false,
        command_path: command_path.to_string(),
        version_output: String::new(),
        error: Some(error.into()),
    }
}

fn probe_command(command_path: &str, args: &[&str], trace_id: &str) -> IosToolStatus {
    let args = args.iter().map(|item| item.to_string()).collect::<Vec<_>>();
    match run_command_with_timeout(command_path, &args, IOS_TOOL_TIMEOUT, trace_id) {
        Ok(output) => IosToolStatus {
            available: true,
            command_path: command_path.to_string(),
            version_output: output.stdout.trim().to_string(),
            error: if output.exit_code.unwrap_or_default() == 0 {
                None
            } else {
                let detail = output.stderr.trim();
                if detail.is_empty() {
                    None
                } else {
                    Some(detail.to_string())
                }
            },
        },
        Err(err) => tool_status_unavailable(command_path, err.error),
    }
}

fn probe_devicectl(trace_id: &str) -> IosToolStatus {
    let args = vec!["--find".to_string(), "devicectl".to_string()];
    match run_command_with_timeout("xcrun", &args, IOS_TOOL_TIMEOUT, trace_id) {
        Ok(output) if output.exit_code.unwrap_or_default() == 0 => {
            let path = output.stdout.trim();
            IosToolStatus {
                available: true,
                command_path: if path.is_empty() {
                    "xcrun devicectl".to_string()
                } else {
                    path.to_string()
                },
                version_output: String::new(),
                error: None,
            }
        }
        Ok(output) => {
            let detail = output.stderr.trim();
            tool_status_unavailable(
                "xcrun devicectl",
                if detail.is_empty() {
                    "devicectl was not found by xcrun".to_string()
                } else {
                    detail.to_string()
                },
            )
        }
        Err(err) => tool_status_unavailable("xcrun devicectl", err.error),
    }
}

fn probe_cfgutil(trace_id: &str) -> IosToolStatus {
    probe_command("cfgutil", &["help"], trace_id)
}

pub fn check_ios_tools(trace_id: &str) -> IosToolsInfo {
    IosToolsInfo {
        devicectl: probe_devicectl(trace_id),
        idevice_id: probe_command("idevice_id", &["--version"], trace_id),
        ideviceinfo: probe_command("ideviceinfo", &["--version"], trace_id),
        idevicesyslog: probe_command("idevicesyslog", &["--version"], trace_id),
        idevicecrashreport: probe_command("idevicecrashreport", &["--version"], trace_id),
        cfgutil: probe_cfgutil(trace_id),
    }
}

pub fn parse_idevice_id_output(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn parse_key_value_output(output: &str) -> HashMap<String, String> {
    output
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            let key = key.trim();
            let value = value.trim();
            if key.is_empty() || value.is_empty() {
                return None;
            }
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

pub fn device_from_ideviceinfo(
    udid: &str,
    output: &str,
    logs_available: bool,
    crash_reports_available: bool,
    configuration_profiles_available: bool,
) -> DeviceInfo {
    let map = parse_key_value_output(output);
    let serial = map
        .get("UniqueDeviceID")
        .cloned()
        .unwrap_or_else(|| udid.to_string());
    let os_version = map.get("ProductVersion").cloned();
    let device_name = map.get("DeviceName").cloned();
    let product_type = map.get("ProductType").cloned();
    let model = map
        .get("ProductName")
        .cloned()
        .or_else(|| product_type.clone());
    DeviceInfo {
        summary: DeviceSummary {
            platform: DevicePlatform::Ios,
            serial: serial.clone(),
            state: "device".to_string(),
            model: model.clone(),
            product: product_type.clone(),
            device: product_type.clone(),
            transport_id: None,
        },
        detail: Some(DeviceDetail {
            serial,
            os_version: os_version.clone(),
            device_name: device_name.clone(),
            product_type: product_type.clone(),
            connection_type: Some("usb".to_string()),
            trust_status: Some("trusted".to_string()),
            name: device_name,
            brand: Some("Apple".to_string()),
            model,
            device: product_type,
            serial_number: map.get("SerialNumber").cloned(),
            android_version: None,
            api_level: None,
            battery_level: None,
            wifi_is_on: None,
            bt_is_on: None,
            gms_version: None,
            build_fingerprint: None,
            processor: None,
            resolution: None,
            storage_total_bytes: None,
            memory_total_bytes: None,
            audio_state: None,
            bluetooth_manager_state: None,
        }),
        capabilities: DeviceCapabilities::ios_observation(
            logs_available,
            crash_reports_available,
            cfgutil_profile_install_supported() && configuration_profiles_available,
        ),
    }
}

fn basic_ios_device(
    serial: String,
    name: Option<String>,
    product_type: Option<String>,
    os_version: Option<String>,
    state: Option<String>,
    trust_status: Option<String>,
    tools: &IosToolsInfo,
) -> DeviceInfo {
    let state = state.unwrap_or_else(|| "device".to_string());
    let model = product_type.clone();
    DeviceInfo {
        summary: DeviceSummary {
            platform: DevicePlatform::Ios,
            serial: serial.clone(),
            state,
            model: model.clone(),
            product: product_type.clone(),
            device: product_type.clone(),
            transport_id: None,
        },
        detail: Some(DeviceDetail {
            serial,
            os_version,
            device_name: name.clone(),
            product_type: product_type.clone(),
            connection_type: Some("usb".to_string()),
            trust_status,
            name,
            brand: Some("Apple".to_string()),
            model,
            device: product_type,
            serial_number: None,
            android_version: None,
            api_level: None,
            battery_level: None,
            wifi_is_on: None,
            bt_is_on: None,
            gms_version: None,
            build_fingerprint: None,
            processor: None,
            resolution: None,
            storage_total_bytes: None,
            memory_total_bytes: None,
            audio_state: None,
            bluetooth_manager_state: None,
        }),
        capabilities: DeviceCapabilities::ios_observation(
            tools.idevicesyslog.available,
            tools.idevicecrashreport.available,
            cfgutil_profile_install_supported() && tools.cfgutil.available,
        ),
    }
}

fn first_string_in_object<'a>(
    object: &'a serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<&'a str> {
    for key in keys {
        if let Some(value) = object.get(*key).and_then(Value::as_str) {
            if !value.trim().is_empty() {
                return Some(value.trim());
            }
        }
    }
    None
}

fn find_nested_string<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    match value {
        Value::Object(object) => {
            if let Some(found) = first_string_in_object(object, keys) {
                return Some(found);
            }
            object
                .values()
                .find_map(|child| find_nested_string(child, keys))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|child| find_nested_string(child, keys)),
        _ => None,
    }
}

fn collect_devicectl_devices(value: &Value, tools: &IosToolsInfo, devices: &mut Vec<DeviceInfo>) {
    match value {
        Value::Object(object) => {
            let serial = first_string_in_object(
                object,
                &[
                    "identifier",
                    "udid",
                    "UDID",
                    "uniqueDeviceID",
                    "UniqueDeviceID",
                ],
            );
            if let Some(serial) = serial {
                let product_type = find_nested_string(value, &["productType", "ProductType"])
                    .map(ToOwned::to_owned);
                let is_ios_device = product_type
                    .as_deref()
                    .map(|item| {
                        item.starts_with("iPhone")
                            || item.starts_with("iPad")
                            || item.starts_with("iPod")
                    })
                    .unwrap_or_else(|| {
                        find_nested_string(value, &["platform", "operatingSystem"])
                            .map(|item| item.to_ascii_lowercase().contains("ios"))
                            .unwrap_or(false)
                    });
                if is_ios_device {
                    let name = find_nested_string(value, &["name", "deviceName", "DeviceName"])
                        .map(ToOwned::to_owned);
                    let os_version = find_nested_string(
                        value,
                        &[
                            "operatingSystemVersion",
                            "osVersion",
                            "ProductVersion",
                            "version",
                        ],
                    )
                    .map(ToOwned::to_owned);
                    let state = find_nested_string(value, &["state", "connectionState"])
                        .map(|item| item.to_ascii_lowercase())
                        .map(|item| {
                            if item.contains("unavailable") {
                                "offline"
                            } else {
                                "device"
                            }
                            .to_string()
                        });
                    devices.push(basic_ios_device(
                        serial.to_string(),
                        name,
                        product_type,
                        os_version,
                        state,
                        Some("trusted".to_string()),
                        tools,
                    ));
                }
            }
            for child in object.values() {
                collect_devicectl_devices(child, tools, devices);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_devicectl_devices(child, tools, devices);
            }
        }
        _ => {}
    }
}

pub fn parse_devicectl_json(output: &str, tools: &IosToolsInfo) -> Vec<DeviceInfo> {
    let Ok(value) = serde_json::from_str::<Value>(output) else {
        return Vec::new();
    };
    let mut devices = Vec::new();
    collect_devicectl_devices(&value, tools, &mut devices);
    dedupe_ios_devices(devices)
}

fn run_ios_command(
    program: &str,
    args: &[&str],
    trace_id: &str,
) -> Result<CommandOutput, AppError> {
    let args = args.iter().map(|item| item.to_string()).collect::<Vec<_>>();
    run_command_with_timeout(program, &args, IOS_DISCOVERY_TIMEOUT, trace_id)
}

fn discover_libimobiledevice_devices(tools: &IosToolsInfo, trace_id: &str) -> Vec<DeviceInfo> {
    if !tools.idevice_id.available {
        return Vec::new();
    }
    let output = match run_ios_command("idevice_id", &["-l"], trace_id) {
        Ok(output) if output.exit_code.unwrap_or_default() == 0 => output,
        Ok(output) => {
            warn!(
                trace_id = %trace_id,
                stderr = %output.stderr.trim(),
                "idevice_id failed during iOS discovery"
            );
            return Vec::new();
        }
        Err(err) => {
            warn!(trace_id = %trace_id, error = %err, "idevice_id failed during iOS discovery");
            return Vec::new();
        }
    };

    parse_idevice_id_output(&output.stdout)
        .into_iter()
        .map(|udid| {
            if tools.ideviceinfo.available {
                match run_ios_command("ideviceinfo", &["-u", &udid], trace_id) {
                    Ok(info) if info.exit_code.unwrap_or_default() == 0 => {
                        return device_from_ideviceinfo(
                            &udid,
                            &info.stdout,
                            tools.idevicesyslog.available,
                            tools.idevicecrashreport.available,
                            tools.cfgutil.available,
                        );
                    }
                    Ok(info) => {
                        warn!(
                            trace_id = %trace_id,
                            udid = %udid,
                            stderr = %info.stderr.trim(),
                            "ideviceinfo failed during iOS discovery"
                        );
                    }
                    Err(err) => {
                        warn!(
                            trace_id = %trace_id,
                            udid = %udid,
                            error = %err,
                            "ideviceinfo failed during iOS discovery"
                        );
                    }
                }
            }
            basic_ios_device(
                udid,
                None,
                None,
                None,
                Some("device".to_string()),
                None,
                tools,
            )
        })
        .collect()
}

fn discover_devicectl_devices(tools: &IosToolsInfo, trace_id: &str) -> Vec<DeviceInfo> {
    if !tools.devicectl.available {
        return Vec::new();
    }
    let args = vec![
        "devicectl".to_string(),
        "list".to_string(),
        "devices".to_string(),
        "--json-output".to_string(),
        "-".to_string(),
    ];
    match run_command_with_timeout("xcrun", &args, IOS_DISCOVERY_TIMEOUT, trace_id) {
        Ok(output) if output.exit_code.unwrap_or_default() == 0 => {
            parse_devicectl_json(&output.stdout, tools)
        }
        Ok(output) => {
            warn!(
                trace_id = %trace_id,
                stderr = %output.stderr.trim(),
                "devicectl failed during iOS discovery"
            );
            Vec::new()
        }
        Err(err) => {
            warn!(trace_id = %trace_id, error = %err, "devicectl failed during iOS discovery");
            Vec::new()
        }
    }
}

fn dedupe_ios_devices(devices: Vec<DeviceInfo>) -> Vec<DeviceInfo> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for device in devices {
        if seen.insert(device.summary.serial.clone()) {
            deduped.push(device);
        }
    }
    deduped
}

pub fn discover_ios_devices(trace_id: &str) -> Vec<DeviceInfo> {
    let tools = check_ios_tools(trace_id);
    let mut devices = discover_libimobiledevice_devices(&tools, trace_id);
    devices.extend(discover_devicectl_devices(&tools, trace_id));
    dedupe_ios_devices(devices)
}

pub fn export_crash_reports(
    serial: &str,
    output_dir: Option<String>,
    trace_id: &str,
) -> Result<HostCommandResult, AppError> {
    if serial.trim().is_empty() {
        return Err(AppError::validation("serial is required", trace_id));
    }
    let tools = check_ios_tools(trace_id);
    if !tools.idevicecrashreport.available {
        return Err(AppError::dependency(
            "idevicecrashreport is not available",
            trace_id,
        ));
    }
    let output_dir = output_dir
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| ".".to_string());
    fs::create_dir_all(&output_dir)
        .map_err(|err| AppError::system(format!("Failed to create output dir: {err}"), trace_id))?;
    let output_dir = PathBuf::from(output_dir);
    let output_dir_str = output_dir.to_string_lossy().to_string();
    let output = run_ios_command(
        "idevicecrashreport",
        &["-u", serial, &output_dir_str],
        trace_id,
    )?;
    if output.exit_code.unwrap_or_default() != 0 {
        return Err(AppError::dependency(
            format!("iOS crash report export failed: {}", output.stderr.trim()),
            trace_id,
        ));
    }
    Ok(HostCommandResult {
        stdout: output.stdout,
        stderr: output.stderr,
        exit_code: output.exit_code,
    })
}

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
    let metadata = fs::metadata(&path).map_err(|err| {
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
    Ok(path)
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
            format!("cfgutil list failed: {}", output.stderr.trim()),
            trace_id,
        ));
    }
    Ok(parse_cfgutil_list_output(&output.stdout))
}

fn sanitize_cfgutil_message(output: &CommandOutput) -> String {
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        return stderr.lines().take(4).collect::<Vec<_>>().join(" ");
    }
    let stdout = output.stdout.trim();
    if !stdout.is_empty() {
        return stdout.lines().take(4).collect::<Vec<_>>().join(" ");
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
    let cfgutil_devices = cfgutil_devices(trace_id)?;
    let mut results = Vec::with_capacity(serials.len());

    for serial in serials {
        let serial = serial.trim().to_string();
        if serial.is_empty() {
            results.push(IosProfileInstallResult {
                serial,
                status: IosProfileInstallStatus::Skipped,
                message: "Skipped empty device serial.".to_string(),
                trace_id: trace_id.to_string(),
            });
            continue;
        }
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
                    message: "Configuration profile installed.".to_string(),
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
                    message: err.error,
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

    fn test_tools() -> IosToolsInfo {
        let available = IosToolStatus {
            available: true,
            command_path: "tool".to_string(),
            version_output: String::new(),
            error: None,
        };
        IosToolsInfo {
            devicectl: available.clone(),
            idevice_id: available.clone(),
            ideviceinfo: available.clone(),
            idevicesyslog: available.clone(),
            idevicecrashreport: available,
            cfgutil: IosToolStatus {
                available: false,
                command_path: "cfgutil".to_string(),
                version_output: String::new(),
                error: Some("missing".to_string()),
            },
        }
    }

    #[test]
    fn parse_idevice_id_output_ignores_empty_lines() {
        assert_eq!(
            parse_idevice_id_output("\n00008030-001C195E0E82802E\n  \nabc\n"),
            vec!["00008030-001C195E0E82802E", "abc"]
        );
    }

    #[test]
    fn device_from_ideviceinfo_maps_cross_platform_fields() {
        let raw = "\
UniqueDeviceID: 00008030-001C195E0E82802E
DeviceName: Lab iPhone
ProductType: iPhone15,2
ProductVersion: 17.4
SerialNumber: F2ABC
";
        let device = device_from_ideviceinfo("fallback", raw, true, true, true);
        assert_eq!(device.summary.platform, DevicePlatform::Ios);
        assert_eq!(device.summary.serial, "00008030-001C195E0E82802E");
        assert_eq!(device.summary.state, "device");
        assert_eq!(
            device.detail.as_ref().unwrap().os_version.as_deref(),
            Some("17.4")
        );
        assert_eq!(
            device.detail.as_ref().unwrap().device_name.as_deref(),
            Some("Lab iPhone")
        );
        assert!(device.capabilities.logs);
        assert!(device.capabilities.crash_reports);
        assert_eq!(
            device.capabilities.configuration_profiles,
            cfgutil_profile_install_supported()
        );
        assert!(!device.capabilities.shell);
    }

    #[test]
    fn parse_devicectl_json_dedupes_ios_devices() {
        let raw = r#"
        {
          "result": {
            "devices": [
              {
                "identifier": "00008030-001C195E0E82802E",
                "name": "Lab iPhone",
                "deviceProperties": {
                  "productType": "iPhone15,2",
                  "operatingSystemVersion": "17.4"
                }
              },
              {
                "identifier": "00008030-001C195E0E82802E",
                "name": "Lab iPhone",
                "deviceProperties": {
                  "productType": "iPhone15,2",
                  "operatingSystemVersion": "17.4"
                }
              }
            ]
          }
        }
        "#;
        let devices = parse_devicectl_json(raw, &test_tools());
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].summary.platform, DevicePlatform::Ios);
        assert_eq!(
            devices[0].detail.as_ref().unwrap().product_type.as_deref(),
            Some("iPhone15,2")
        );
    }

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
        assert_eq!(
            summary.uuid.as_deref(),
            Some("11111111-2222-3333-4444-555555555555")
        );
        assert_eq!(summary.payload_type.as_deref(), Some("Configuration"));
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
