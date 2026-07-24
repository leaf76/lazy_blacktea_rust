use crate::app::error::AppError;

const MAX_IOS_SERIAL_LEN: usize = 64;

/// Returns true when the value looks like an iOS UDID (40 hex, or dashed Apple form).
pub fn looks_like_ios_serial(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_IOS_SERIAL_LEN {
        return false;
    }
    if trimmed.contains(|c: char| c.is_control() || c.is_whitespace()) {
        return false;
    }
    // Reject common Android serial patterns.
    if trimmed.contains(':') || trimmed.starts_with("emulator-") {
        return false;
    }
    let hex_or_dash = trimmed
        .chars()
        .all(|item| item.is_ascii_hexdigit() || item == '-');
    if !hex_or_dash {
        return false;
    }
    let hex_len = trimmed.chars().filter(|c| c.is_ascii_hexdigit()).count();
    hex_len >= 24
}

pub fn validate_ios_serial(serial: &str, trace_id: &str) -> Result<String, AppError> {
    let trimmed = serial.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("serial is required", trace_id));
    }
    if trimmed.len() > MAX_IOS_SERIAL_LEN {
        return Err(AppError::validation(
            format!("serial is longer than {MAX_IOS_SERIAL_LEN} characters"),
            trace_id,
        ));
    }
    if trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::validation(
            "serial contains invalid characters",
            trace_id,
        ));
    }
    if !looks_like_ios_serial(trimmed) {
        return Err(AppError::validation(
            "serial does not look like a valid iOS UDID",
            trace_id,
        ));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_common_udid_shapes() {
        assert!(looks_like_ios_serial("00008030-001C195E0E82802E"));
        assert!(looks_like_ios_serial("00008030001C195E0E82802E"));
        assert!(looks_like_ios_serial(
            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
        ));
    }

    #[test]
    fn rejects_android_and_junk() {
        assert!(!looks_like_ios_serial("emulator-5554"));
        assert!(!looks_like_ios_serial("192.168.1.10:5555"));
        assert!(!looks_like_ios_serial("short"));
        assert!(!looks_like_ios_serial("bad serial with spaces"));
        assert!(!looks_like_ios_serial("00008030;rm -rf /"));
    }

    #[test]
    fn validate_ios_serial_errors_on_empty() {
        let err = validate_ios_serial("  ", "t").expect_err("empty");
        assert_eq!(err.code, "ERR_VALIDATION");
    }
}
