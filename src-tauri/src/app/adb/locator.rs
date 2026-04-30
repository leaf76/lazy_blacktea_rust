use std::ffi::OsStr;
use std::path::{Path, PathBuf};

pub const ADB_ISSUE_MACOS_GATEKEEPER_QUARANTINE: &str = "macos_gatekeeper_quarantine";

#[cfg(target_os = "macos")]
const MACOS_QUARANTINE_ATTR: &str = "com.apple.quarantine";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdbProgramValidationError {
    pub message: String,
    pub issue_code: Option<String>,
}

impl AdbProgramValidationError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            issue_code: None,
        }
    }

    #[cfg(target_os = "macos")]
    fn with_issue(message: impl Into<String>, issue_code: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            issue_code: Some(issue_code.into()),
        }
    }
}

pub fn normalize_command_path(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(inner) = trimmed
        .strip_prefix('"')
        .and_then(|candidate| candidate.strip_suffix('"'))
    {
        return inner.trim().to_string();
    }
    if let Some(inner) = trimmed
        .strip_prefix('\'')
        .and_then(|candidate| candidate.strip_suffix('\''))
    {
        return inner.trim().to_string();
    }
    trimmed.to_string()
}

pub fn resolve_adb_program(config_command_path: &str) -> String {
    let normalized = normalize_command_path(config_command_path);
    if is_default_adb_alias(&normalized) {
        resolve_default_adb_program()
    } else {
        normalized
    }
}

pub fn validate_adb_program(program: &str) -> Result<(), AdbProgramValidationError> {
    if program.trim().is_empty() {
        return Err(AdbProgramValidationError::new("ADB command is empty"));
    }
    if program == "adb" {
        return Ok(());
    }
    let path = Path::new(program);
    if path.is_dir() {
        return Err(AdbProgramValidationError::new(
            "ADB path must point to an executable file",
        ));
    }
    if !path.exists() {
        return Err(AdbProgramValidationError::new(
            "ADB executable not found at the configured path",
        ));
    }
    validate_macos_quarantine(path)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn validate_macos_quarantine(path: &Path) -> Result<(), AdbProgramValidationError> {
    match xattr::get(path, MACOS_QUARANTINE_ATTR) {
        Ok(Some(_)) => Err(AdbProgramValidationError::with_issue(
            "macOS blocked this ADB executable because it is quarantined. Choose a trusted Android SDK platform-tools adb path in Settings, reinstall Android Platform Tools, or approve this exact binary in macOS Privacy & Security after you trust it.",
            ADB_ISSUE_MACOS_GATEKEEPER_QUARANTINE,
        )),
        Ok(None) => Ok(()),
        Err(err) => Err(AdbProgramValidationError::new(format!(
            "Failed to inspect ADB quarantine metadata: {err}"
        ))),
    }
}

#[cfg(not(target_os = "macos"))]
fn validate_macos_quarantine(_path: &Path) -> Result<(), AdbProgramValidationError> {
    Ok(())
}

fn adb_binary_name() -> &'static str {
    if cfg!(windows) {
        "adb.exe"
    } else {
        "adb"
    }
}

fn is_default_adb_alias(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return true;
    }
    if cfg!(windows) {
        return trimmed.eq_ignore_ascii_case("adb") || trimmed.eq_ignore_ascii_case("adb.exe");
    }
    trimmed == "adb"
}

fn resolve_default_adb_program() -> String {
    let path_env = std::env::var_os("PATH");
    let home_env = std::env::var_os("HOME");
    let android_sdk_root = std::env::var_os("ANDROID_SDK_ROOT");
    let android_home = std::env::var_os("ANDROID_HOME");

    resolve_default_adb_program_from_values(
        path_env.as_deref(),
        home_env.as_deref(),
        android_sdk_root.as_deref(),
        android_home.as_deref(),
        true,
    )
}

fn resolve_default_adb_program_from_values(
    path_env: Option<&OsStr>,
    home_env: Option<&OsStr>,
    android_sdk_root: Option<&OsStr>,
    android_home: Option<&OsStr>,
    include_system_fallbacks: bool,
) -> String {
    let candidates = build_default_adb_candidates(
        path_env,
        home_env,
        android_sdk_root,
        android_home,
        include_system_fallbacks,
    );
    pick_first_existing_candidate(&candidates).unwrap_or_else(|| "adb".to_string())
}

fn build_default_adb_candidates(
    path_env: Option<&OsStr>,
    home_env: Option<&OsStr>,
    android_sdk_root: Option<&OsStr>,
    android_home: Option<&OsStr>,
    include_system_fallbacks: bool,
) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let binary_name = adb_binary_name();

    if let Some(path_value) = path_env {
        for dir in std::env::split_paths(path_value) {
            if !dir.as_os_str().is_empty() {
                candidates.push(dir.join(binary_name));
            }
        }
    }

    let mut sdk_roots: Vec<PathBuf> = Vec::new();
    for root in [android_sdk_root, android_home].into_iter().flatten() {
        if !root.is_empty() {
            sdk_roots.push(PathBuf::from(root));
        }
    }
    if let Some(home) = home_env {
        if !home.is_empty() {
            sdk_roots.push(PathBuf::from(home).join("Library/Android/sdk"));
        }
    }
    for root in sdk_roots {
        candidates.push(root.join("platform-tools").join(binary_name));
    }

    if include_system_fallbacks {
        #[cfg(target_os = "macos")]
        {
            candidates.push(PathBuf::from("/opt/homebrew/bin").join(binary_name));
            candidates.push(PathBuf::from("/usr/local/bin").join(binary_name));
        }
    }

    dedupe_paths(candidates)
}

fn dedupe_paths(candidates: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut deduped: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        if !deduped.iter().any(|existing| existing == &candidate) {
            deduped.push(candidate);
        }
    }
    deduped
}

fn pick_first_existing_candidate(candidates: &[PathBuf]) -> Option<String> {
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn strips_wrapping_double_quotes() {
        assert_eq!(
            normalize_command_path("  \"/opt/android/platform-tools/adb\"  "),
            "/opt/android/platform-tools/adb"
        );
    }

    #[test]
    fn strips_wrapping_single_quotes() {
        assert_eq!(
            normalize_command_path("  '/opt/android/platform-tools/adb'  "),
            "/opt/android/platform-tools/adb"
        );
    }

    #[test]
    fn resolves_empty_to_default_adb() {
        let resolved = resolve_default_adb_program_from_values(None, None, None, None, false);
        assert_eq!(resolved, "adb");
    }

    #[test]
    fn validates_nonexistent_path() {
        let err = validate_adb_program("/this/path/should/not/exist/adb").unwrap_err();
        assert!(err.message.to_lowercase().contains("not found"));
        assert_eq!(err.issue_code, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn validates_quarantined_macos_adb_path() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = test_temp_dir();
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let adb_path = temp_dir.join(adb_binary_name());
        fs::write(&adb_path, b"adb").expect("create adb file");
        fs::set_permissions(&adb_path, fs::Permissions::from_mode(0o755))
            .expect("set executable bit");
        xattr::set(
            &adb_path,
            MACOS_QUARANTINE_ATTR,
            b"01c1;test;Homebrew Cask;",
        )
        .expect("set quarantine attr");

        let err = validate_adb_program(&adb_path.to_string_lossy()).unwrap_err();

        assert!(err.message.contains("quarantined"));
        assert_eq!(
            err.issue_code.as_deref(),
            Some(ADB_ISSUE_MACOS_GATEKEEPER_QUARANTINE)
        );

        let _ = fs::remove_file(&adb_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn resolves_first_existing_path_candidate() {
        let temp_dir = test_temp_dir();
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let adb_path = temp_dir.join(adb_binary_name());
        fs::write(&adb_path, b"adb").expect("create adb file");

        let path_env = std::env::join_paths([temp_dir.as_path()]).expect("join PATH");
        let resolved = resolve_default_adb_program_from_values(
            Some(path_env.as_os_str()),
            None,
            None,
            None,
            false,
        );

        assert_eq!(resolved, adb_path.to_string_lossy());

        let _ = fs::remove_file(&adb_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn returns_adb_when_no_candidate_exists() {
        let temp_dir = test_temp_dir();
        let path_env = std::env::join_paths([temp_dir.as_path()]).expect("join PATH");
        let resolved = resolve_default_adb_program_from_values(
            Some(path_env.as_os_str()),
            Some(OsStr::new("/path/that/does/not/exist")),
            None,
            None,
            false,
        );
        assert_eq!(resolved, "adb");
    }

    fn test_temp_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "lazy_blacktea_locator_test_{}_{}",
            std::process::id(),
            nonce
        ))
    }
}
