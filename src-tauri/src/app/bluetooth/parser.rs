use std::collections::HashMap;

use regex::Regex;

use super::models::{
    AdvertisingSet, AdvertisingState, BluetoothEventType, BondState, BondedDevice, ParsedEvent,
    ParsedSnapshot, ScanningState,
};

pub struct BluetoothParser {
    re_address: Regex,
    re_interval: Regex,
    re_tx_power: Regex,
    re_data_len: Regex,
    re_uuids: Regex,
    re_profile_state: Regex,
    re_client_uid: Regex,
    re_client: Regex,
    re_message: Regex,
    re_set_id: Regex,
    re_bonded_device: Regex,
    re_bonded_name_addr: Regex,
    re_bonded_addr_name: Regex,
}

impl Default for BluetoothParser {
    fn default() -> Self {
        Self {
            re_address: Regex::new(r"address\s*[:=]\s*([0-9A-Fa-f:]{11,})").unwrap(),
            re_interval: Regex::new(r"interval(?:=|:)\s*(\d+)").unwrap(),
            re_tx_power: Regex::new(r"tx\s*power(?:=|:)\s*([A-Za-z0-9+\-]+)").unwrap(),
            re_data_len: Regex::new(r"data(?:Len|Length)?(?:=|:)\s*(\d+)").unwrap(),
            re_uuids: Regex::new(r"uuid[s]?\s*[:=]\s*([^\r\n]+)").unwrap(),
            re_profile_state: Regex::new(
                r"^(?P<profile>[A-Za-z0-9_\- ]+?)\s*(?:state\s*[:=]|[:=])\s*(?P<state>[A-Za-z0-9_ \-]+)$",
            )
            .unwrap(),
            re_client_uid: Regex::new(r"uid\s*/([\w\./:-]+)").unwrap(),
            re_client: Regex::new(r"client\s*=\s*([\w\./:-]+)").unwrap(),
            re_message: Regex::new(r"\s([A-Za-z0-9_.-]+):\s(.+)$").unwrap(),
            re_set_id: Regex::new(r"set(?:=|\s)(\d+)").unwrap(),
            re_bonded_device: Regex::new(
                r"^\s*([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})\s*(?:\(([^)]+)\)|(.+?))?$",
            )
            .unwrap(),
            re_bonded_name_addr: Regex::new(
                r"name\s*=\s*([^,]+),?\s*address\s*=\s*([0-9A-Fa-f:]{17})",
            )
            .unwrap(),
            re_bonded_addr_name: Regex::new(
                r"address\s*=\s*([0-9A-Fa-f:]{17}),?\s*name\s*=\s*([^,\n]+)",
            )
            .unwrap(),
        }
    }
}

impl BluetoothParser {
    pub fn parse_snapshot(&self, serial: &str, raw_text: &str, timestamp: f64) -> ParsedSnapshot {
        let lines: Vec<String> = raw_text
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect();
        let lowered: Vec<String> = lines.iter().map(|line| line.to_lowercase()).collect();

        let adapter_enabled = lowered
            .iter()
            .any(|line| line.contains("state=on") || line.contains("enabled: true"));
        let address = self.extract_address(&lines);

        let scanning = self.extract_scanning_state(&lines, &lowered);
        let advertising = self.extract_advertising_state(&lines, &lowered);
        let profiles = self.extract_profile_states(&lines);
        let bonded_devices = self.extract_bonded_devices(raw_text);

        ParsedSnapshot {
            serial: serial.to_string(),
            timestamp,
            adapter_enabled,
            address,
            scanning,
            advertising,
            profiles,
            bonded_devices,
            raw_text: raw_text.to_string(),
        }
    }

    pub fn parse_log_line(
        &self,
        serial: &str,
        line: &str,
        timestamp: f64,
    ) -> Option<ParsedEvent> {
        if line.trim().is_empty() {
            return None;
        }
        let lowered = line.to_lowercase();
        let event_type = self.classify_event(&lowered)?;
        let (tag, message) = self.split_tag_and_message(line);
        let metadata = self.extract_metadata(&lowered, &message);
        Some(ParsedEvent {
            serial: serial.to_string(),
            timestamp,
            event_type,
            message: message.trim().to_string(),
            tag,
            metadata,
            raw_line: line.to_string(),
        })
    }

    fn extract_address(&self, lines: &[String]) -> Option<String> {
        for line in lines {
            if let Some(caps) = self.re_address.captures(line) {
                return Some(caps[1].to_uppercase());
            }
        }
        None
    }

    fn extract_scanning_state(
        &self,
        lines: &[String],
        lowered: &[String],
    ) -> ScanningState {
        let scanning_keywords = [
            "startscan",
            "isdiscovering: true",
            "isscanning: true",
            "onbatchscanresults",
            "onscanresult",
        ];
        let is_scanning = lowered.iter().any(|text| {
            scanning_keywords
                .iter()
                .any(|keyword| text.contains(keyword))
        });
        let mut clients = Vec::new();
        for line in lines {
            for caps in self.re_client_uid.captures_iter(line) {
                let value = format!("uid/{}", &caps[1]);
                if !clients.contains(&value) {
                    clients.push(value);
                }
            }
            for caps in self.re_client.captures_iter(line) {
                let value = caps[1].to_string();
                if !clients.contains(&value) {
                    clients.push(value);
                }
            }
        }
        ScanningState { is_scanning, clients }
    }

    fn extract_advertising_state(
        &self,
        lines: &[String],
        lowered: &[String],
    ) -> AdvertisingState {
        let advertising_keywords = [
            "startadvertising",
            "onadvertisingsetstarted",
            "isadvertising: true",
        ];
        let is_advertising = lowered.iter().any(|text| {
            advertising_keywords
                .iter()
                .any(|keyword| text.contains(keyword))
        });
        let sets = if is_advertising {
            vec![self.build_advertising_set(lines)]
        } else {
            Vec::new()
        };
        AdvertisingState { is_advertising, sets }
    }

    fn build_advertising_set(&self, lines: &[String]) -> AdvertisingSet {
        let raw_dump = lines.join("\n");
        let interval = self.extract_int(&self.re_interval, &raw_dump);
        let tx_power = self
            .re_tx_power
            .captures(&raw_dump)
            .map(|caps| caps[1].to_string());
        let data_length = self
            .extract_int(&self.re_data_len, &raw_dump)
            .unwrap_or(0);
        let uuids = self.extract_uuids(&raw_dump);
        let set_id = self
            .re_set_id
            .captures(&raw_dump)
            .and_then(|caps| caps.get(1))
            .and_then(|value| value.as_str().parse::<i32>().ok());
        AdvertisingSet {
            set_id,
            interval_ms: interval,
            tx_power,
            data_length,
            service_uuids: uuids,
        }
    }

    fn extract_profile_states(&self, lines: &[String]) -> HashMap<String, String> {
        let mut profiles = HashMap::new();
        for line in lines {
            if let Some(caps) = self.re_profile_state.captures(line) {
                let profile = caps["profile"].trim().to_uppercase();
                let state = caps["state"].trim().to_uppercase();
                if !profile.is_empty() && !state.is_empty() {
                    profiles.insert(profile, state);
                }
            }
        }
        profiles
    }

    fn extract_bonded_devices(&self, raw_text: &str) -> Vec<BondedDevice> {
        let mut devices = Vec::new();
        let mut seen = Vec::new();
        let lines: Vec<&str> = raw_text.lines().collect();
        let mut in_bonded_section = false;
        for line in lines {
            let line_stripped = line.trim();
            let line_lower = line_stripped.to_lowercase();
            if ["bonded devices", "bonded_devices", "paired devices", "getbondeddevices"]
                .iter()
                .any(|header| line_lower.contains(header))
            {
                in_bonded_section = true;
                continue;
            }
            if in_bonded_section
                && (line_stripped.is_empty()
                    || (line_stripped.contains(':')
                        && !self.re_bonded_device.is_match(line_stripped)))
            {
                in_bonded_section = false;
            }
            let device = self.parse_bonded_device_line(line_stripped);
            if let Some(device) = device {
                let addr = device.address.to_uppercase();
                if !seen.contains(&addr) {
                    seen.push(addr);
                    devices.push(device);
                }
            }
        }
        devices
    }

    fn parse_bonded_device_line(&self, line: &str) -> Option<BondedDevice> {
        if line.is_empty() {
            return None;
        }
        if let Some(caps) = self.re_bonded_device.captures(line) {
            let address = caps[1].to_uppercase();
            let name = caps.get(2).or_else(|| caps.get(3)).map(|m| m.as_str().trim().to_string());
            return Some(BondedDevice {
                address,
                name,
                bond_state: BondState::Bonded,
            });
        }
        if let Some(caps) = self.re_bonded_name_addr.captures(line) {
            return Some(BondedDevice {
                name: Some(caps[1].trim().to_string()),
                address: caps[2].to_uppercase(),
                bond_state: BondState::Bonded,
            });
        }
        if let Some(caps) = self.re_bonded_addr_name.captures(line) {
            return Some(BondedDevice {
                address: caps[1].to_uppercase(),
                name: Some(caps[2].trim().to_string()),
                bond_state: BondState::Bonded,
            });
        }
        None
    }

    fn classify_event(&self, lowered_line: &str) -> Option<BluetoothEventType> {
        let advertising_keywords = ["startadvertising", "onadvertisingsetstarted", "isadvertising: true"];
        let advertising_stop = ["stopadvertising", "onadvertisingsetstopped", "isadvertising: false"];
        let scanning_keywords = [
            "startscan",
            "isdiscovering: true",
            "isscanning: true",
            "onbatchscanresults",
            "onscanresult",
        ];
        let scanning_stop = ["stopscan", "isdiscovering: false", "isscanning: false"];
        if advertising_keywords.iter().any(|keyword| lowered_line.contains(keyword)) {
            return Some(BluetoothEventType::AdvertisingStart);
        }
        if advertising_stop.iter().any(|keyword| lowered_line.contains(keyword)) {
            return Some(BluetoothEventType::AdvertisingStop);
        }
        if lowered_line.contains("onscanresult") {
            return Some(BluetoothEventType::ScanResult);
        }
        if scanning_keywords.iter().any(|keyword| lowered_line.contains(keyword)) {
            return Some(BluetoothEventType::ScanStart);
        }
        if scanning_stop.iter().any(|keyword| lowered_line.contains(keyword)) {
            return Some(BluetoothEventType::ScanStop);
        }
        if lowered_line.contains("connect") && lowered_line.contains("gatt") {
            return Some(BluetoothEventType::Connect);
        }
        if lowered_line.contains("disconnect") && lowered_line.contains("gatt") {
            return Some(BluetoothEventType::Disconnect);
        }
        if lowered_line.contains("error") || lowered_line.contains("failed") {
            return Some(BluetoothEventType::Error);
        }
        None
    }

    fn split_tag_and_message(&self, line: &str) -> (Option<String>, String) {
        if let Some(caps) = self.re_message.captures(line) {
            return (Some(caps[1].to_string()), caps[2].to_string());
        }
        (None, line.trim().to_string())
    }

    fn extract_metadata(&self, lowered_line: &str, message: &str) -> HashMap<String, serde_json::Value> {
        let mut metadata = HashMap::new();
        if let Some(caps) = self.re_set_id.captures(lowered_line) {
            if let Ok(set_id) = caps[1].parse::<i32>() {
                metadata.insert("set_id".to_string(), serde_json::json!(set_id));
            }
        }
        if let Some(caps) = self.re_tx_power.captures(lowered_line) {
            metadata.insert("tx_power".to_string(), serde_json::json!(caps[1].to_uppercase()));
        }
        if let Some(caps) = self.re_data_len.captures(lowered_line) {
            if let Ok(value) = caps[1].parse::<i32>() {
                metadata.insert("data_length".to_string(), serde_json::json!(value));
            }
        }
        if let Some(caps) = self.re_client_uid.captures(message) {
            metadata.insert("client".to_string(), serde_json::json!(format!("uid/{}", &caps[1])));
        } else if let Some(caps) = self.re_client.captures(message) {
            metadata.insert("client".to_string(), serde_json::json!(caps[1].to_string()));
        }
        metadata
    }

    fn extract_int(&self, pattern: &Regex, text: &str) -> Option<i32> {
        pattern
            .captures(text)
            .and_then(|caps| caps.get(1))
            .and_then(|value| value.as_str().parse::<i32>().ok())
    }

    fn extract_uuids(&self, text: &str) -> Vec<String> {
        if let Some(caps) = self.re_uuids.captures(text) {
            let raw_list = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            return raw_list
                .split(|ch| ch == ',' || ch == ':')
                .filter_map(|item| {
                    let trimmed = item.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_uppercase())
                    }
                })
                .collect();
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_snapshot_basic() {
        let parser = BluetoothParser::default();
        let snapshot = parser.parse_snapshot(
            "ABC",
            "State=ON\naddress: 00:11:22:33:44:55\nstartScan\n",
            1.0,
        );
        assert_eq!(snapshot.serial, "ABC");
        assert!(snapshot.adapter_enabled);
        assert_eq!(snapshot.address.as_deref(), Some("00:11:22:33:44:55"));
        assert!(snapshot.scanning.is_scanning);
    }

    #[test]
    fn parses_log_event() {
        let parser = BluetoothParser::default();
        let event = parser
            .parse_log_line("ABC", "BluetoothGatt: onScanResult", 2.0)
            .expect("event");
        assert_eq!(event.serial, "ABC");
        assert_eq!(event.event_type, BluetoothEventType::ScanResult);
    }
}
