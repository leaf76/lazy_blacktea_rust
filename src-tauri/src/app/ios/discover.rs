use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde_json::Value;
use tracing::{info, warn};

use crate::app::adb::runner::{run_command_with_timeout, CommandOutput};
use crate::app::error::AppError;
use crate::app::models::{
    DeviceCapabilities, DeviceDetail, DeviceInfo, DevicePlatform, DeviceSummary, IosToolsInfo,
};

use super::tools::{cfgutil_profile_install_supported, check_ios_tools};
use super::trust::classify_trust_status;

const IOS_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(6);

fn run_ios_command(
    program: &str,
    args: &[&str],
    trace_id: &str,
) -> Result<CommandOutput, AppError> {
    let args = args.iter().map(|item| item.to_string()).collect::<Vec<_>>();
    run_command_with_timeout(program, &args, IOS_DISCOVERY_TIMEOUT, trace_id)
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

fn observation_capabilities(
    tools: &IosToolsInfo,
    logs_available: bool,
    crash_reports_available: bool,
    configuration_profiles_available: bool,
) -> DeviceCapabilities {
    let mut caps = DeviceCapabilities::ios_observation(
        logs_available,
        crash_reports_available,
        cfgutil_profile_install_supported() && configuration_profiles_available,
    );
    caps.screenshot = tools.idevicescreenshot.available;
    caps
}

pub fn device_from_ideviceinfo(udid: &str, output: &str, tools: &IosToolsInfo) -> DeviceInfo {
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
        capabilities: observation_capabilities(
            tools,
            tools.idevicesyslog.available,
            tools.idevicecrashreport.available,
            tools.cfgutil.available,
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
        capabilities: observation_capabilities(
            tools,
            tools.idevicesyslog.available,
            tools.idevicecrashreport.available,
            tools.cfgutil.available,
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
    merge_ios_devices(devices)
}

fn detail_richness(device: &DeviceInfo) -> usize {
    let Some(detail) = device.detail.as_ref() else {
        return 0;
    };
    let mut score = 0;
    if detail.device_name.as_ref().is_some_and(|v| !v.is_empty()) {
        score += 2;
    }
    if detail.os_version.as_ref().is_some_and(|v| !v.is_empty()) {
        score += 2;
    }
    if detail.product_type.as_ref().is_some_and(|v| !v.is_empty()) {
        score += 1;
    }
    if detail.serial_number.as_ref().is_some_and(|v| !v.is_empty()) {
        score += 1;
    }
    if detail.trust_status.as_deref() == Some("trusted") {
        score += 1;
    }
    if device.summary.state == "device" {
        score += 1;
    }
    score
}

fn prefer_richer(left: DeviceInfo, right: DeviceInfo) -> DeviceInfo {
    if detail_richness(&right) > detail_richness(&left) {
        right
    } else {
        left
    }
}

/// Dedupe by serial, keeping the richer detail when both discovery paths see the same UDID.
pub fn merge_ios_devices(devices: Vec<DeviceInfo>) -> Vec<DeviceInfo> {
    let mut by_serial: HashMap<String, DeviceInfo> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for device in devices {
        let serial = device.summary.serial.clone();
        match by_serial.remove(&serial) {
            Some(existing) => {
                by_serial.insert(serial.clone(), prefer_richer(existing, device));
            }
            None => {
                order.push(serial.clone());
                by_serial.insert(serial, device);
            }
        }
    }
    order
        .into_iter()
        .filter_map(|serial| by_serial.remove(&serial))
        .collect()
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
                        return device_from_ideviceinfo(&udid, &info.stdout, tools);
                    }
                    Ok(info) => {
                        let trust = classify_trust_status(&info.stderr)
                            .or_else(|| classify_trust_status(&info.stdout))
                            .map(str::to_string);
                        warn!(
                            trace_id = %trace_id,
                            udid = %udid,
                            stderr = %info.stderr.trim(),
                            trust_status = ?trust,
                            "ideviceinfo failed during iOS discovery"
                        );
                        return basic_ios_device(
                            udid,
                            None,
                            None,
                            None,
                            Some("device".to_string()),
                            trust,
                            tools,
                        );
                    }
                    Err(err) => {
                        let trust = classify_trust_status(&err.error).map(str::to_string);
                        warn!(
                            trace_id = %trace_id,
                            udid = %udid,
                            error = %err,
                            "ideviceinfo failed during iOS discovery"
                        );
                        return basic_ios_device(
                            udid,
                            None,
                            None,
                            None,
                            Some("device".to_string()),
                            trust,
                            tools,
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

pub fn discover_ios_devices(trace_id: &str) -> Vec<DeviceInfo> {
    let started = Instant::now();
    let tools = check_ios_tools(trace_id);
    let mut devices = discover_libimobiledevice_devices(&tools, trace_id);
    devices.extend(discover_devicectl_devices(&tools, trace_id));
    let devices = merge_ios_devices(devices);
    info!(
        trace_id = %trace_id,
        elapsed_ms = started.elapsed().as_millis() as u64,
        device_count = devices.len(),
        "iOS device discovery finished"
    );
    devices
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::models::IosToolStatus;

    fn test_tools() -> IosToolsInfo {
        let available = IosToolStatus {
            available: true,
            command_path: "tool".to_string(),
            version_output: String::new(),
            error: None,
        };
        let missing = IosToolStatus {
            available: false,
            command_path: "missing".to_string(),
            version_output: String::new(),
            error: Some("missing".to_string()),
        };
        IosToolsInfo {
            devicectl: available.clone(),
            idevice_id: available.clone(),
            ideviceinfo: available.clone(),
            idevicesyslog: available.clone(),
            idevicecrashreport: available.clone(),
            idevicescreenshot: available.clone(),
            cfgutil: missing.clone(),
            usbmuxd: missing,
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
        let device = device_from_ideviceinfo("fallback", raw, &test_tools());
        assert_eq!(device.summary.platform, DevicePlatform::Ios);
        assert_eq!(device.summary.serial, "00008030-001C195E0E82802E");
        assert_eq!(
            device.detail.as_ref().unwrap().os_version.as_deref(),
            Some("17.4")
        );
        assert!(device.capabilities.logs);
        assert!(device.capabilities.screenshot);
        assert!(!device.capabilities.shell);
    }

    #[test]
    fn merge_ios_devices_prefers_richer_detail() {
        let tools = test_tools();
        let sparse = basic_ios_device(
            "00008030-001C195E0E82802E".to_string(),
            None,
            None,
            None,
            Some("device".to_string()),
            None,
            &tools,
        );
        let rich = device_from_ideviceinfo(
            "00008030-001C195E0E82802E",
            "UniqueDeviceID: 00008030-001C195E0E82802E\nDeviceName: Lab\nProductType: iPhone15,2\nProductVersion: 17.4\n",
            &tools,
        );
        let merged = merge_ios_devices(vec![sparse, rich]);
        assert_eq!(merged.len(), 1);
        assert_eq!(
            merged[0].detail.as_ref().unwrap().device_name.as_deref(),
            Some("Lab")
        );
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
    }
}
