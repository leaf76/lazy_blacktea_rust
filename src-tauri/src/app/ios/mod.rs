//! iOS device inventory and observation helpers (MVP).
//!
//! External tools are discovered on the host PATH and are not bundled with the app.

mod crash;
mod discover;
mod profile;
mod screenshot;
mod tools;
mod trust;
mod validate;

pub use crash::export_crash_reports;
pub use discover::{
    device_from_ideviceinfo, discover_ios_devices, merge_ios_devices, parse_devicectl_json,
    parse_idevice_id_output,
};
pub use profile::{
    install_configuration_profile, parse_cfgutil_list_output, parse_mobileconfig_summary_value,
    validate_mobileconfig, CfgutilDevice,
};
pub use screenshot::capture_screenshot as capture_ios_screenshot;
pub use tools::{
    cfgutil_profile_install_supported, check_ios_tools, check_ios_tools_force,
    invalidate_ios_tools_cache,
};
pub use trust::{classify_trust_status, humanize_ios_tool_error};
pub use validate::{looks_like_ios_serial, validate_ios_serial};
