use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceSummary {
    pub serial: String,
    pub state: String,
    pub model: Option<String>,
    pub product: Option<String>,
    pub device: Option<String>,
    pub transport_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceDetail {
    pub serial: String,
    pub name: Option<String>,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub device: Option<String>,
    pub serial_number: Option<String>,
    pub android_version: Option<String>,
    pub api_level: Option<String>,
    pub battery_level: Option<u8>,
    pub wifi_is_on: Option<bool>,
    pub bt_is_on: Option<bool>,
    pub gms_version: Option<String>,
    pub build_fingerprint: Option<String>,
    pub processor: Option<String>,
    pub resolution: Option<String>,
    pub storage_total_bytes: Option<u64>,
    pub memory_total_bytes: Option<u64>,
    pub audio_state: Option<String>,
    pub bluetooth_manager_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceInfo {
    pub summary: DeviceSummary,
    pub detail: Option<DeviceDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandResult {
    pub serial: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostCommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdbInfo {
    pub available: bool,
    pub version_output: String,
    pub command_path: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UiHierarchyCaptureResult {
    pub html: String,
    pub xml: String,
    pub screenshot_data_url: Option<String>,
    pub screenshot_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UiHierarchyExportResult {
    pub serial: String,
    pub xml_path: String,
    pub html_path: String,
    pub screenshot_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LogcatExportResult {
    pub serial: String,
    pub output_path: String,
    pub line_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PerfSnapshot {
    pub ts_ms: i64,
    pub cpu_total_percent_x100: Option<u16>,
    pub mem_total_bytes: Option<u64>,
    pub mem_used_bytes: Option<u64>,
    pub net_rx_bps: Option<u64>,
    pub net_tx_bps: Option<u64>,
    pub battery_level: Option<u8>,
    pub battery_temp_decic: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandResponse<T> {
    pub trace_id: String,
    pub data: T,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalSessionInfo {
    pub serial: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalEvent {
    pub serial: String,
    pub session_id: String,
    pub event: String,
    pub stream: Option<String>,
    pub chunk: Option<String>,
    pub exit_code: Option<i32>,
    pub trace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppInfo {
    pub package_name: String,
    pub version_name: Option<String>,
    pub version_code: Option<String>,
    pub is_system: bool,
    pub apk_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppBasicInfo {
    pub package_name: String,
    pub version_name: Option<String>,
    pub version_code: Option<String>,
    pub first_install_time: Option<String>,
    pub last_update_time: Option<String>,
    #[serde(default)]
    pub apk_paths: Vec<String>,
    pub apk_size_bytes_total: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BugreportResult {
    pub serial: String,
    pub success: bool,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub stream_supported: bool,
    pub progress: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BugreportLogSummary {
    pub report_id: String,
    pub source_path: String,
    pub db_path: String,
    pub total_rows: usize,
    pub min_ts: Option<String>,
    pub max_ts: Option<String>,
    pub levels: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct BugreportLogFilters {
    pub levels: Vec<String>,
    pub tag: Option<String>,
    pub pid: Option<i64>,
    /// Deprecated: legacy single text filter.
    pub text: Option<String>,
    #[serde(default)]
    pub text_terms: Vec<String>,
    #[serde(default)]
    pub text_excludes: Vec<String>,
    pub start_ts: Option<String>,
    pub end_ts: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BugreportLogRow {
    pub id: i64,
    pub ts: String,
    pub level: String,
    pub tag: String,
    pub pid: i64,
    pub tid: i64,
    pub msg: String,
    pub raw_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BugreportLogPage {
    pub rows: Vec<BugreportLogRow>,
    pub has_more: bool,
    pub next_offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FilePreview {
    pub local_path: String,
    pub mime_type: String,
    pub is_text: bool,
    pub preview_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScrcpyInfo {
    pub available: bool,
    pub version_output: String,
    pub major_version: i32,
    pub command_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ApkInstallErrorCode {
    Success,
    InstallFailedAlreadyExists,
    InstallFailedUpdateIncompatible,
    InstallFailedDuplicatePackage,
    InstallFailedOlderSdk,
    InstallFailedNewerSdk,
    InstallFailedVersionDowngrade,
    InstallFailedInsufficientStorage,
    InstallFailedMediaUnavailable,
    InstallFailedUserRestricted,
    InstallFailedVerificationFailure,
    InstallParseFailedNotApk,
    InstallParseFailedBadManifest,
    InstallParseFailedNoCertificates,
    InstallParseFailedInconsistentCertificates,
    InstallFailedInvalidApk,
    InstallFailedAborted,
    InstallFailedNoMatchingAbis,
    InstallFailedTestOnly,
    UnknownError,
}

impl ApkInstallErrorCode {
    pub fn code(&self) -> &'static str {
        match self {
            ApkInstallErrorCode::Success => "SUCCESS",
            ApkInstallErrorCode::InstallFailedAlreadyExists => "INSTALL_FAILED_ALREADY_EXISTS",
            ApkInstallErrorCode::InstallFailedUpdateIncompatible => {
                "INSTALL_FAILED_UPDATE_INCOMPATIBLE"
            }
            ApkInstallErrorCode::InstallFailedDuplicatePackage => {
                "INSTALL_FAILED_DUPLICATE_PACKAGE"
            }
            ApkInstallErrorCode::InstallFailedOlderSdk => "INSTALL_FAILED_OLDER_SDK",
            ApkInstallErrorCode::InstallFailedNewerSdk => "INSTALL_FAILED_NEWER_SDK",
            ApkInstallErrorCode::InstallFailedVersionDowngrade => {
                "INSTALL_FAILED_VERSION_DOWNGRADE"
            }
            ApkInstallErrorCode::InstallFailedInsufficientStorage => {
                "INSTALL_FAILED_INSUFFICIENT_STORAGE"
            }
            ApkInstallErrorCode::InstallFailedMediaUnavailable => {
                "INSTALL_FAILED_MEDIA_UNAVAILABLE"
            }
            ApkInstallErrorCode::InstallFailedUserRestricted => "INSTALL_FAILED_USER_RESTRICTED",
            ApkInstallErrorCode::InstallFailedVerificationFailure => {
                "INSTALL_FAILED_VERIFICATION_FAILURE"
            }
            ApkInstallErrorCode::InstallParseFailedNotApk => "INSTALL_PARSE_FAILED_NOT_APK",
            ApkInstallErrorCode::InstallParseFailedBadManifest => {
                "INSTALL_PARSE_FAILED_BAD_MANIFEST"
            }
            ApkInstallErrorCode::InstallParseFailedNoCertificates => {
                "INSTALL_PARSE_FAILED_NO_CERTIFICATES"
            }
            ApkInstallErrorCode::InstallParseFailedInconsistentCertificates => {
                "INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES"
            }
            ApkInstallErrorCode::InstallFailedInvalidApk => "INSTALL_FAILED_INVALID_APK",
            ApkInstallErrorCode::InstallFailedAborted => "INSTALL_FAILED_ABORTED",
            ApkInstallErrorCode::InstallFailedNoMatchingAbis => "INSTALL_FAILED_NO_MATCHING_ABIS",
            ApkInstallErrorCode::InstallFailedTestOnly => "INSTALL_FAILED_TEST_ONLY",
            ApkInstallErrorCode::UnknownError => "UNKNOWN_ERROR",
        }
    }

    #[allow(dead_code)]
    pub fn description(&self) -> &'static str {
        match self {
            ApkInstallErrorCode::Success => "Installation successful",
            ApkInstallErrorCode::InstallFailedAlreadyExists => {
                "App already installed with different signature"
            }
            ApkInstallErrorCode::InstallFailedUpdateIncompatible => {
                "Update incompatible with existing installation"
            }
            ApkInstallErrorCode::InstallFailedDuplicatePackage => {
                "Package already exists on device"
            }
            ApkInstallErrorCode::InstallFailedOlderSdk => {
                "Device Android version too old for this APK"
            }
            ApkInstallErrorCode::InstallFailedNewerSdk => "APK requires older Android version",
            ApkInstallErrorCode::InstallFailedVersionDowngrade => {
                "Cannot downgrade - use -d flag or uninstall first"
            }
            ApkInstallErrorCode::InstallFailedInsufficientStorage => {
                "Not enough storage space on device"
            }
            ApkInstallErrorCode::InstallFailedMediaUnavailable => "Storage media not available",
            ApkInstallErrorCode::InstallFailedUserRestricted => {
                "User restricted from installing apps"
            }
            ApkInstallErrorCode::InstallFailedVerificationFailure => "Package verification failed",
            ApkInstallErrorCode::InstallParseFailedNotApk => "File is not a valid APK",
            ApkInstallErrorCode::InstallParseFailedBadManifest => {
                "Invalid AndroidManifest.xml in APK"
            }
            ApkInstallErrorCode::InstallParseFailedNoCertificates => "APK is not signed",
            ApkInstallErrorCode::InstallParseFailedInconsistentCertificates => {
                "APK signature inconsistent with installed version"
            }
            ApkInstallErrorCode::InstallFailedInvalidApk => "APK file is corrupted or invalid",
            ApkInstallErrorCode::InstallFailedAborted => "Installation was aborted",
            ApkInstallErrorCode::InstallFailedNoMatchingAbis => {
                "APK not compatible with device CPU architecture"
            }
            ApkInstallErrorCode::InstallFailedTestOnly => "Test-only APK - use -t flag to install",
            ApkInstallErrorCode::UnknownError => "Unknown installation error",
        }
    }

    pub fn from_output(output: &str) -> Self {
        if output.is_empty() {
            return ApkInstallErrorCode::UnknownError;
        }
        let upper = output.to_uppercase();
        if upper.contains("SUCCESS") {
            return ApkInstallErrorCode::Success;
        }
        for code in [
            ApkInstallErrorCode::InstallFailedAlreadyExists,
            ApkInstallErrorCode::InstallFailedUpdateIncompatible,
            ApkInstallErrorCode::InstallFailedDuplicatePackage,
            ApkInstallErrorCode::InstallFailedOlderSdk,
            ApkInstallErrorCode::InstallFailedNewerSdk,
            ApkInstallErrorCode::InstallFailedVersionDowngrade,
            ApkInstallErrorCode::InstallFailedInsufficientStorage,
            ApkInstallErrorCode::InstallFailedMediaUnavailable,
            ApkInstallErrorCode::InstallFailedUserRestricted,
            ApkInstallErrorCode::InstallFailedVerificationFailure,
            ApkInstallErrorCode::InstallParseFailedNotApk,
            ApkInstallErrorCode::InstallParseFailedBadManifest,
            ApkInstallErrorCode::InstallParseFailedNoCertificates,
            ApkInstallErrorCode::InstallParseFailedInconsistentCertificates,
            ApkInstallErrorCode::InstallFailedInvalidApk,
            ApkInstallErrorCode::InstallFailedAborted,
            ApkInstallErrorCode::InstallFailedNoMatchingAbis,
            ApkInstallErrorCode::InstallFailedTestOnly,
        ] {
            if upper.contains(code.code()) {
                return code;
            }
        }
        ApkInstallErrorCode::UnknownError
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApkInfo {
    pub path: String,
    pub package_name: Option<String>,
    pub version_code: Option<i32>,
    pub version_name: Option<String>,
    pub min_sdk_version: Option<i32>,
    pub target_sdk_version: Option<i32>,
    pub is_split_apk: bool,
    pub split_apk_paths: Vec<String>,
    pub file_size_bytes: u64,
    pub error: Option<String>,
}

impl ApkInfo {
    pub fn is_valid(&self) -> bool {
        self.error.is_none() && self.package_name.is_some()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApkInstallResult {
    pub serial: String,
    pub success: bool,
    pub error_code: ApkInstallErrorCode,
    pub raw_output: String,
    pub duration_seconds: f64,
    pub device_model: Option<String>,
}

impl ApkInstallResult {
    #[allow(dead_code)]
    pub fn error_message(&self) -> String {
        if self.success {
            String::new()
        } else {
            self.error_code.description().to_string()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApkBatchInstallResult {
    pub apk_path: String,
    pub apk_info: Option<ApkInfo>,
    pub results: HashMap<String, ApkInstallResult>,
    pub total_duration_seconds: f64,
}

impl ApkBatchInstallResult {
    #[allow(dead_code)]
    pub fn successful_count(&self) -> usize {
        self.results.values().filter(|item| item.success).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_apk_error_code() {
        let output = "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]";
        let code = ApkInstallErrorCode::from_output(output);
        assert_eq!(code, ApkInstallErrorCode::InstallFailedVersionDowngrade);
    }
}
