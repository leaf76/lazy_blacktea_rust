pub fn parse_progress_percent(line: &str) -> Option<u8> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Common adb `-p` output looks like: "[ 42%] /remote/file -> /local/file"
    if let Some(percent) = parse_bracket_percent(trimmed) {
        return Some(percent);
    }

    // Fallback: accept "42%" anywhere in the line.
    parse_loose_percent(trimmed)
}

fn parse_bracket_percent(input: &str) -> Option<u8> {
    let bytes = input.as_bytes();
    let open = bytes.iter().position(|b| *b == b'[')?;
    let close = bytes[open..].iter().position(|b| *b == b']')? + open;
    let inside = &input[open + 1..close];
    parse_loose_percent(inside)
}

fn parse_loose_percent(input: &str) -> Option<u8> {
    let bytes = input.as_bytes();
    let percent_index = bytes.iter().position(|b| *b == b'%')?;
    // Scan backwards to collect up to 3 digits.
    let mut start = percent_index;
    let mut digits = 0;
    while start > 0 {
        let prev = bytes[start - 1];
        if prev.is_ascii_digit() && digits < 3 {
            start -= 1;
            digits += 1;
        } else {
            break;
        }
    }
    if digits == 0 {
        return None;
    }
    let value: u8 = input[start..percent_index].trim().parse().ok()?;
    if value <= 100 {
        Some(value)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bracket_percent() {
        assert_eq!(
            parse_progress_percent("[ 42%] /sdcard/file -> /tmp/file"),
            Some(42)
        );
        assert_eq!(
            parse_progress_percent("[100%] /sdcard/file -> /tmp/file"),
            Some(100)
        );
    }

    #[test]
    fn parses_loose_percent() {
        assert_eq!(parse_progress_percent("42% /sdcard/file"), Some(42));
        assert_eq!(parse_progress_percent("Progress: 7%"), Some(7));
    }

    #[test]
    fn ignores_invalid_percent() {
        assert_eq!(parse_progress_percent("no percent here"), None);
        assert_eq!(parse_progress_percent("200%"), None);
        assert_eq!(parse_progress_percent("%"), None);
    }
}

