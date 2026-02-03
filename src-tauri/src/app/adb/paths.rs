pub fn validate_device_path(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("device_path is required".to_string());
    }
    if !trimmed.starts_with('/') {
        return Err("device_path must be an absolute device path starting with '/'".to_string());
    }
    if trimmed.contains('\0') {
        return Err("device_path contains invalid characters".to_string());
    }
    if trimmed == "/" {
        return Err("device_path must not be root".to_string());
    }
    for segment in trimmed.split('/') {
        if segment == ".." {
            return Err("device_path must not contain '..' segments".to_string());
        }
    }
    Ok(())
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
        assert_eq!(device_parent_dir("/sdcard/Download/file.txt"), "/sdcard/Download");
        assert_eq!(device_parent_dir("/sdcard/Download/"), "/sdcard");
        assert_eq!(device_parent_dir("/file.txt"), "/");
        assert_eq!(device_parent_dir("/"), "/");
        assert_eq!(device_parent_dir(""), "/");
    }
}

