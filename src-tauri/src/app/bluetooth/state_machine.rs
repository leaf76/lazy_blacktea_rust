use std::collections::{HashMap, HashSet};

use super::models::{
    AdvertisingState, BluetoothEventType, BluetoothState, ParsedEvent, ParsedSnapshot,
    ScanningState, StateSummary,
};

#[derive(Debug, Clone)]
pub struct StateUpdate {
    pub summary: StateSummary,
    pub changed: bool,
}

pub struct BluetoothStateMachine {
    serial: Option<String>,
    adapter_enabled: bool,
    advertising_active: bool,
    scanning_active: bool,
    connected_active: bool,
    advertising_snapshot: AdvertisingState,
    scanning_snapshot: ScanningState,
    profiles: HashMap<String, String>,
    advertising_timeout_s: f64,
    scanning_timeout_s: f64,
    last_advertising_seen: Option<f64>,
    last_scanning_seen: Option<f64>,
    last_timestamp: f64,
    current_summary: StateSummary,
}

impl BluetoothStateMachine {
    pub fn new(advertising_timeout_s: f64, scanning_timeout_s: f64) -> Self {
        Self {
            serial: None,
            adapter_enabled: true,
            advertising_active: false,
            scanning_active: false,
            connected_active: false,
            advertising_snapshot: AdvertisingState::default(),
            scanning_snapshot: ScanningState::default(),
            profiles: HashMap::new(),
            advertising_timeout_s,
            scanning_timeout_s,
            last_advertising_seen: None,
            last_scanning_seen: None,
            last_timestamp: 0.0,
            current_summary: StateSummary {
                serial: "unknown".to_string(),
                active_states: HashSet::from([BluetoothState::Unknown]),
                metrics: HashMap::new(),
                timestamp: 0.0,
            },
        }
    }

    pub fn apply_snapshot(&mut self, snapshot: &ParsedSnapshot) -> StateUpdate {
        self.ensure_serial(&snapshot.serial);
        self.adapter_enabled = snapshot.adapter_enabled;
        self.advertising_snapshot = snapshot.advertising.clone();
        self.scanning_snapshot = snapshot.scanning.clone();
        self.profiles = snapshot.profiles.clone();
        self.last_timestamp = snapshot.timestamp;

        if snapshot.advertising.is_advertising {
            self.advertising_active = true;
            self.last_advertising_seen = Some(snapshot.timestamp);
        } else {
            self.advertising_active = false;
        }

        if snapshot.scanning.is_scanning {
            self.scanning_active = true;
            self.last_scanning_seen = Some(snapshot.timestamp);
        } else {
            self.scanning_active = false;
        }

        self.apply_timeouts(snapshot.timestamp);
        self.emit_summary(snapshot.timestamp)
    }

    pub fn apply_event(&mut self, event: &ParsedEvent) -> StateUpdate {
        self.ensure_serial(&event.serial);
        self.last_timestamp = event.timestamp;

        match event.event_type {
            BluetoothEventType::AdvertisingStart => {
                self.advertising_active = true;
                self.last_advertising_seen = Some(event.timestamp);
            }
            BluetoothEventType::AdvertisingStop => {
                self.advertising_active = false;
            }
            BluetoothEventType::ScanStart => {
                self.scanning_active = true;
                self.last_scanning_seen = Some(event.timestamp);
            }
            BluetoothEventType::ScanStop => {
                self.scanning_active = false;
            }
            BluetoothEventType::Connect => {
                self.connected_active = true;
            }
            BluetoothEventType::Disconnect => {
                self.connected_active = false;
            }
            _ => {}
        }

        self.apply_timeouts(event.timestamp);
        self.emit_summary(event.timestamp)
    }

    fn ensure_serial(&mut self, serial: &str) {
        if self.serial.is_none() {
            self.serial = Some(serial.to_string());
            self.current_summary.serial = serial.to_string();
        }
    }

    fn apply_timeouts(&mut self, timestamp: f64) {
        if self.advertising_active {
            if let Some(last_seen) = self.last_advertising_seen {
                if timestamp - last_seen > self.advertising_timeout_s {
                    self.advertising_active = false;
                }
            }
        }
        if self.scanning_active {
            if let Some(last_seen) = self.last_scanning_seen {
                if timestamp - last_seen > self.scanning_timeout_s {
                    self.scanning_active = false;
                }
            }
        }
    }

    fn emit_summary(&mut self, timestamp: f64) -> StateUpdate {
        let states = self.calculate_states();
        let metrics = self.calculate_metrics();
        let summary = StateSummary {
            serial: self.serial.clone().unwrap_or_else(|| "unknown".to_string()),
            active_states: states,
            metrics,
            timestamp,
        };
        let changed = self.state_changed(&summary);
        if changed {
            self.current_summary = summary.clone();
        } else {
            self.current_summary.timestamp = timestamp;
        }
        StateUpdate {
            summary: self.current_summary.clone(),
            changed,
        }
    }

    fn calculate_states(&self) -> HashSet<BluetoothState> {
        if !self.adapter_enabled {
            return HashSet::from([BluetoothState::Off]);
        }
        let mut states = HashSet::new();
        if self.advertising_active {
            states.insert(BluetoothState::Advertising);
        }
        if self.scanning_active {
            states.insert(BluetoothState::Scanning);
        }
        if self.connected_active || self.has_connected_profile() {
            states.insert(BluetoothState::Connected);
        }
        if states.is_empty() {
            states.insert(BluetoothState::Idle);
        }
        states
    }

    fn has_connected_profile(&self) -> bool {
        self.profiles.values().any(|state| {
            let upper = state.to_uppercase();
            upper.contains("CONNECTED") && !upper.contains("DISCONNECTED")
        })
    }

    fn calculate_metrics(&self) -> HashMap<String, serde_json::Value> {
        let mut metrics = HashMap::new();
        metrics.insert(
            "adapter_enabled".to_string(),
            serde_json::json!(self.adapter_enabled),
        );
        metrics.insert(
            "advertising_sets".to_string(),
            serde_json::json!(self.advertising_snapshot.sets.len()),
        );
        metrics.insert(
            "scanners".to_string(),
            serde_json::json!(self.scanning_snapshot.clients.len()),
        );
        if !self.profiles.is_empty() {
            metrics.insert("profiles".to_string(), serde_json::json!(self.profiles));
        }
        if let Some(last) = self.last_advertising_seen {
            metrics.insert("last_advertising_seen".to_string(), serde_json::json!(last));
        }
        if let Some(last) = self.last_scanning_seen {
            metrics.insert("last_scanning_seen".to_string(), serde_json::json!(last));
        }
        metrics
    }

    fn state_changed(&self, summary: &StateSummary) -> bool {
        self.current_summary.active_states != summary.active_states
            || self.current_summary.metrics != summary.metrics
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::bluetooth::models::{AdvertisingState, ScanningState};

    #[test]
    fn transitions_to_scanning() {
        let mut machine = BluetoothStateMachine::new(3.0, 3.0);
        let snapshot = ParsedSnapshot {
            serial: "ABC".to_string(),
            timestamp: 1.0,
            adapter_enabled: true,
            address: None,
            scanning: ScanningState {
                is_scanning: true,
                clients: vec![],
            },
            advertising: AdvertisingState::default(),
            profiles: HashMap::new(),
            bonded_devices: vec![],
            raw_text: String::new(),
        };
        let update = machine.apply_snapshot(&snapshot);
        assert!(update
            .summary
            .active_states
            .contains(&BluetoothState::Scanning));
    }
}
