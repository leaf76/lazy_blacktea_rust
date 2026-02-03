use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::app::bluetooth::service::BluetoothMonitorHandle;

pub struct LogcatHandle {
    pub child: Child,
    pub stop_flag: Arc<AtomicBool>,
}

pub struct RecordingHandle {
    pub child: Child,
    pub remote_path: String,
}

pub struct BugreportHandle {
    pub cancel_flag: Arc<AtomicBool>,
    pub child: Arc<Mutex<Option<Child>>>,
}

pub struct AppState {
    pub recording_processes: Mutex<HashMap<String, RecordingHandle>>,
    pub logcat_processes: Mutex<HashMap<String, LogcatHandle>>,
    pub bugreport_processes: Mutex<HashMap<String, BugreportHandle>>,
    pub bluetooth_monitors: Mutex<HashMap<String, BluetoothMonitorHandle>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            recording_processes: Mutex::new(HashMap::new()),
            logcat_processes: Mutex::new(HashMap::new()),
            bugreport_processes: Mutex::new(HashMap::new()),
            bluetooth_monitors: Mutex::new(HashMap::new()),
        }
    }
}
