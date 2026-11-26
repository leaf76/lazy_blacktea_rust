fn validate_device_path_impl(path: &str, allow_root: bool) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("device_path is required".to_string());
    }
    if !trimmed.starts_with('/') {
        return Err("device_path must be an absolute device path starting with '/'".to_string());
    }
    if trimmed.contains(['\0', '\n', '\r']) {
        return Err("device_path contains invalid characters".to_string());
    }
    if !allow_root && trimmed == "/" {
        return Err("device_path must not be root".to_string());
    }
    for segment in trimmed.split('/') {
        if segment == ".." {
            return Err("device_path must not contain '..' segments".to_string());
        }
    }
    Ok(())
}

pub fn validate_device_path(path: &str) -> Result<(), String> {
    validate_device_path_impl(path, false)
}

pub fn validate_device_browse_path(path: &str) -> Result<(), String> {
    validate_device_path_impl(path, true)
}

pub fn quote_adb_shell_arg(arg: &str) -> String {
    let escaped = arg.replace('\'', "'\\''");
    format!("'{escaped}'")
}

pub fn floor_char_boundary(value: &str, max_bytes: usize) -> usize {
    let mut end = max_bytes.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    end
}

pub fn device_parent_dir(device_path: &str) -> String {
    let trimmed = device_path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/".to_string();
    }
    let mut path = trimmed.trim_end_matches('/').to_string();
    if path == "/" {
        return "/".to_string();
    }
    match path.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(index) => {
            path.truncate(index);
            if path.is_empty() {
                "/".to_string()
            } else {
                path
            }
        }
    }
}

pub fn sanitize_filename_component(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "device".to_string();
    }
    trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_device_path_requires_absolute() {
        assert!(validate_device_path("").is_err());
        assert!(validate_device_path("sdcard/file.txt").is_err());
        assert!(validate_device_path("/").is_err());
        assert!(validate_device_path("/sdcard/file.txt").is_ok());
    }

    #[test]
    fn validate_device_path_blocks_dotdot() {
        assert!(validate_device_path("/sdcard/../etc/passwd").is_err());
        assert!(validate_device_path("/sdcard/..").is_err());
        assert!(validate_device_path("/sdcard/a/../b").is_err());
    }

    #[test]
    fn device_parent_dir_handles_common_cases() {
        assert_eq!(
            device_parent_dir("/sdcard/Download/file.txt"),
            "/sdcard/Download"
        );
        assert_eq!(device_parent_dir("/sdcard/Download/"), "/sdcard");
        assert_eq!(device_parent_dir("/file.txt"), "/");
        assert_eq!(device_parent_dir("/"), "/");
        assert_eq!(device_parent_dir(""), "/");
    }

    #[test]
    fn sanitize_filename_component_replaces_invalid_chars() {
        assert_eq!(
            sanitize_filename_component("emulator-5554"),
            "emulator-5554"
        );
        assert_eq!(
            sanitize_filename_component("192.168.0.1:5555"),
            "192.168.0.1_5555"
        );
        assert_eq!(sanitize_filename_component("pixel 7 pro"), "pixel_7_pro");
    }

    #[test]
    fn sanitize_filename_component_handles_empty() {
        assert_eq!(sanitize_filename_component(""), "device");
        assert_eq!(sanitize_filename_component("   "), "device");
    }

    #[test]
    fn validate_device_path_rejects_newlines() {
        assert!(validate_device_path("/sdcard/a\nb").is_err());
        assert!(validate_device_path("/sdcard/a\rb").is_err());
        assert!(validate_device_browse_path("/").is_ok());
        assert!(validate_device_browse_path("/sdcard/My Files").is_ok());
        assert!(validate_device_browse_path("/sdcard/../etc").is_err());
    }

    #[test]
    fn quote_adb_shell_arg_escapes_special_characters() {
        assert_eq!(
            quote_adb_shell_arg("/sdcard/My Files/test (1).txt"),
            "'/sdcard/My Files/test (1).txt'"
        );
        assert_eq!(
            quote_adb_shell_arg("/sdcard/it's; rm -rf / $(id)"),
            "'/sdcard/it'\\''s; rm -rf / $(id)'"
        );
    }

    #[test]
    fn floor_char_boundary_handles_multibyte_utf8() {
        let text = "ab中文字";
        assert_eq!(floor_char_boundary(text, 0), 0);
        assert_eq!(floor_char_boundary(text, 2), 2);
        assert_eq!(floor_char_boundary(text, 3), 2);
        assert_eq!(floor_char_boundary(text, 4), 2);
        assert_eq!(floor_char_boundary(text, 5), 5);
        assert_eq!(floor_char_boundary(text, 99), text.len());
    }
}
