/// Classify host-side trust / pairing state from tool stderr or messages.
pub fn classify_trust_status(message: &str) -> Option<&'static str> {
    let lower = message.to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    if lower.contains("password protected")
        || lower.contains("device is locked")
        || lower.contains("passcode")
        || lower.contains("locked")
    {
        return Some("locked");
    }
    if lower.contains("pair")
        || lower.contains("trust")
        || lower.contains("lockdown")
        || lower.contains("invalid host id")
        || lower.contains("not paired")
        || lower.contains("untrusted")
    {
        return Some("untrusted");
    }
    if lower.contains("no device")
        || lower.contains("not found")
        || lower.contains("disconnected")
        || lower.contains("unable to connect")
    {
        return Some("unavailable");
    }
    None
}

pub fn humanize_ios_tool_error(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return "iOS tool failed.".to_string();
    }
    match classify_trust_status(trimmed) {
        Some("locked") => "iPhone is locked. Unlock the device and try again.".to_string(),
        Some("untrusted") => {
            "This computer is not trusted. Unlock the iPhone and accept the trust prompt."
                .to_string()
        }
        Some("unavailable") => {
            "Device is not reachable over USB. Reconnect the cable and refresh devices.".to_string()
        }
        _ => trimmed.lines().take(3).collect::<Vec<_>>().join(" "),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_common_lockdown_errors() {
        assert_eq!(
            classify_trust_status("ERROR: Could not connect to lockdownd"),
            Some("untrusted")
        );
        assert_eq!(
            classify_trust_status("Device is locked with a passcode"),
            Some("locked")
        );
        assert_eq!(
            classify_trust_status("ERROR: No device found"),
            Some("unavailable")
        );
        assert_eq!(classify_trust_status("something else"), None);
    }

    #[test]
    fn humanizes_trust_errors() {
        let message = humanize_ios_tool_error("Could not pair with the device");
        assert!(message.to_ascii_lowercase().contains("trust"));
    }
}
