use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum BluetoothState {
    Idle,
    Scanning,
    Advertising,
    Connected,
    Off,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum BluetoothEventType {
    AdvertisingStart,
    AdvertisingStop,
    ScanStart,
    ScanResult,
    ScanStop,
    Connect,
    Disconnect,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdvertisingSet {
    pub set_id: Option<i32>,
    pub interval_ms: Option<i32>,
    pub tx_power: Option<String>,
    pub data_length: i32,
    pub service_uuids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdvertisingState {
    pub is_advertising: bool,
    pub sets: Vec<AdvertisingSet>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScanningState {
    pub is_scanning: bool,
    pub clients: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum BondState {
    None,
    Bonding,
    Bonded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BondedDevice {
    pub address: String,
    pub name: Option<String>,
    pub bond_state: BondState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedSnapshot {
    pub serial: String,
    pub timestamp: f64,
    pub adapter_enabled: bool,
    pub address: Option<String>,
    pub scanning: ScanningState,
    pub advertising: AdvertisingState,
    pub profiles: HashMap<String, String>,
    pub bonded_devices: Vec<BondedDevice>,
    pub raw_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedEvent {
    pub serial: String,
    pub timestamp: f64,
    pub event_type: BluetoothEventType,
    pub message: String,
    pub tag: Option<String>,
    pub metadata: HashMap<String, serde_json::Value>,
    pub raw_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateSummary {
    pub serial: String,
    pub active_states: HashSet<BluetoothState>,
    pub metrics: HashMap<String, serde_json::Value>,
    pub timestamp: f64,
}
