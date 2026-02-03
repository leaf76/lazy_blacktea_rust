use std::path::Path;

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
    if normalized.is_empty() {
        "adb".to_string()
    } else {
        normalized
    }
}

pub fn validate_adb_program(program: &str) -> Result<(), String> {
    if program.trim().is_empty() {
        return Err("ADB command is empty".to_string());
    }
    if program == "adb" {
        return Ok(());
    }
    let path = Path::new(program);
    if path.is_dir() {
        return Err("ADB path must point to an executable file".to_string());
    }
    if !path.exists() {
        return Err("ADB executable not found at the configured path".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(resolve_adb_program(""), "adb");
        assert_eq!(resolve_adb_program("   "), "adb");
    }

    #[test]
    fn validates_nonexistent_path() {
        let err = validate_adb_program("/this/path/should/not/exist/adb").unwrap_err();
        assert!(err.to_lowercase().contains("not found"));
    }
}

