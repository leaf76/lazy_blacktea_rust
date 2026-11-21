pub mod adb;
pub mod bluetooth;
pub mod bugreport_extract;
pub mod bugreport_logcat;
pub mod commands;
pub mod config;
pub mod diagnostics;
pub mod error;
pub mod ios;
pub mod logging;
pub mod models;
pub mod net_profiler;
pub mod perf;
pub mod platform;
pub mod scheduler;
pub mod state;
pub mod terminal;
pub mod ui_capture;
pub mod ui_xml;

#[cfg(test)]
pub(crate) fn test_env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|err| err.into_inner())
}

#[cfg(test)]
pub(crate) struct TestEnvVarGuard {
    key: &'static str,
    prev: Option<std::ffi::OsString>,
}

#[cfg(test)]
impl TestEnvVarGuard {
    pub(crate) fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let prev = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, prev }
    }
}

#[cfg(test)]
impl Drop for TestEnvVarGuard {
    fn drop(&mut self) {
        match &self.prev {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}
