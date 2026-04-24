use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;
use tracing::warn;

use crate::app::adb::runner::{run_command_with_timeout, CommandOutput};
use crate::app::error::AppError;
use crate::app::models::{
    DeviceCapabilities, DeviceDetail, DeviceInfo, DevicePlatform, DeviceSummary, HostCommandResult,
    IosToolStatus, IosToolsInfo,
};

const IOS_TOOL_TIMEOUT: Duration = Duration::from_secs(3);
const IOS_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(6);

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

pub fn check_ios_tools(trace_id: &str) -> IosToolsInfo {
    IosToolsInfo {
        devicectl: probe_devicectl(trace_id),
        idevice_id: probe_command("idevice_id", &["--version"], trace_id),
        ideviceinfo: probe_command("ideviceinfo", &["--version"], trace_id),
        idevicesyslog: probe_command("idevicesyslog", &["--version"], trace_id),
        idevicecrashreport: probe_command("idevicecrashreport", &["--version"], trace_id),
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
        capabilities: DeviceCapabilities::ios_observation(logs_available, crash_reports_available),
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
        let device = device_from_ideviceinfo("fallback", raw, true, true);
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
}
