use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tracing::info;

use crate::app::adb::runner::run_command_with_timeout;
use crate::app::models::{IosToolStatus, IosToolsInfo};

const IOS_TOOL_TIMEOUT: Duration = Duration::from_secs(3);
const TOOLS_CACHE_TTL: Duration = Duration::from_secs(45);

struct ToolsCache {
    fetched_at: Instant,
    tools: IosToolsInfo,
}

fn tools_cache() -> &'static Mutex<Option<ToolsCache>> {
    static CACHE: OnceLock<Mutex<Option<ToolsCache>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

pub fn invalidate_ios_tools_cache() {
    if let Ok(mut guard) = tools_cache().lock() {
        *guard = None;
    }
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
        Ok(output) if output.exit_code.unwrap_or_default() == 0 => IosToolStatus {
            available: true,
            command_path: command_path.to_string(),
            version_output: output.stdout.trim().to_string(),
            error: None,
        },
        Ok(output) => {
            // Binary exists but reported non-zero — treat as found but degraded.
            let detail = output.stderr.trim();
            IosToolStatus {
                available: true,
                command_path: command_path.to_string(),
                version_output: output.stdout.trim().to_string(),
                error: if detail.is_empty() {
                    Some("command returned a non-zero exit code".to_string())
                } else {
                    Some(detail.to_string())
                },
            }
        }
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

fn probe_usbmuxd(trace_id: &str) -> IosToolStatus {
    // Best-effort: socket presence is enough for inventory guidance.
    let socket_candidates = ["/var/run/usbmuxd", "/run/usbmuxd", "/var/run/usbmuxd.sock"];
    for path in socket_candidates {
        if std::path::Path::new(path).exists() {
            return IosToolStatus {
                available: true,
                command_path: path.to_string(),
                version_output: "socket present".to_string(),
                error: None,
            };
        }
    }

    // Fallback probe via systemctl on Linux hosts that expose it.
    if cfg!(target_os = "linux") {
        match run_command_with_timeout(
            "systemctl",
            &["is-active".to_string(), "usbmuxd".to_string()],
            IOS_TOOL_TIMEOUT,
            trace_id,
        ) {
            Ok(output) if output.stdout.trim() == "active" => {
                return IosToolStatus {
                    available: true,
                    command_path: "systemctl usbmuxd".to_string(),
                    version_output: "active".to_string(),
                    error: None,
                };
            }
            Ok(output) => {
                return tool_status_unavailable(
                    "usbmuxd",
                    format!(
                        "usbmuxd is not active ({})",
                        output.stdout.trim().if_empty("unknown")
                    ),
                );
            }
            Err(err) => {
                return tool_status_unavailable(
                    "usbmuxd",
                    format!(
                        "usbmuxd socket not found and systemctl probe failed: {}",
                        err.error
                    ),
                );
            }
        }
    }

    tool_status_unavailable(
        "usbmuxd",
        "usbmuxd socket not found (optional on macOS; required on Linux for USB iOS access)",
    )
}

trait IfEmpty {
    fn if_empty(self, fallback: &str) -> String;
}

impl IfEmpty for &str {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self.to_string()
        }
    }
}

fn probe_all_tools(trace_id: &str) -> IosToolsInfo {
    let started = Instant::now();
    let tools = IosToolsInfo {
        devicectl: probe_devicectl(trace_id),
        idevice_id: probe_command("idevice_id", &["--version"], trace_id),
        ideviceinfo: probe_command("ideviceinfo", &["--version"], trace_id),
        idevicesyslog: probe_command("idevicesyslog", &["--version"], trace_id),
        idevicecrashreport: probe_command("idevicecrashreport", &["--version"], trace_id),
        idevicescreenshot: probe_command("idevicescreenshot", &["--version"], trace_id),
        cfgutil: probe_cfgutil(trace_id),
        usbmuxd: probe_usbmuxd(trace_id),
    };
    info!(
        trace_id = %trace_id,
        elapsed_ms = started.elapsed().as_millis() as u64,
        devicectl = tools.devicectl.available,
        idevice_id = tools.idevice_id.available,
        ideviceinfo = tools.ideviceinfo.available,
        idevicesyslog = tools.idevicesyslog.available,
        idevicecrashreport = tools.idevicecrashreport.available,
        idevicescreenshot = tools.idevicescreenshot.available,
        cfgutil = tools.cfgutil.available,
        usbmuxd = tools.usbmuxd.available,
        "probed iOS tools"
    );
    tools
}

/// Probe iOS host tools. Results are cached briefly to avoid repeated spawns during refresh.
pub fn check_ios_tools(trace_id: &str) -> IosToolsInfo {
    check_ios_tools_with_options(trace_id, false)
}

/// Force a fresh tool probe and refresh the cache (Settings / Profiles "Check Tools").
pub fn check_ios_tools_force(trace_id: &str) -> IosToolsInfo {
    check_ios_tools_with_options(trace_id, true)
}

pub fn check_ios_tools_with_options(trace_id: &str, force: bool) -> IosToolsInfo {
    if !force {
        if let Ok(guard) = tools_cache().lock() {
            if let Some(cache) = guard.as_ref() {
                if cache.fetched_at.elapsed() < TOOLS_CACHE_TTL {
                    return cache.tools.clone();
                }
            }
        }
    }

    let tools = probe_all_tools(trace_id);
    if let Ok(mut guard) = tools_cache().lock() {
        *guard = Some(ToolsCache {
            fetched_at: Instant::now(),
            tools: tools.clone(),
        });
    }
    tools
}

pub fn cfgutil_profile_install_supported() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn force_probe_replaces_cache() {
        invalidate_ios_tools_cache();
        // Smoke: force path does not panic without tools installed.
        let _ = check_ios_tools_force("trace-tools");
        let cached = check_ios_tools("trace-tools-cached");
        assert!(!cached.devicectl.command_path.is_empty());
    }
}
