use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BugreportzPayload {
    Progress { percent: i32 },
    Ok { path: String },
    Fail { reason: String },
    Unknown { raw: String },
}

pub fn parse_bugreportz_line(line: &str) -> BugreportzPayload {
    let raw = line.trim();
    if raw.is_empty() {
        return BugreportzPayload::Unknown {
            raw: line.to_string(),
        };
    }
    let upper = raw.to_uppercase();
    if upper.starts_with("PROGRESS") {
        let payload = raw.splitn(2, ':').nth(1).unwrap_or("").trim();
        if payload.is_empty() {
            return BugreportzPayload::Unknown {
                raw: line.to_string(),
            };
        }
        let fraction_re = Regex::new(r"^(\d+)\s*/\s*(\d+)$").unwrap();
        if let Some(caps) = fraction_re.captures(payload) {
            let num = caps[1].parse::<i32>().unwrap_or(0);
            let den = caps[2].parse::<i32>().unwrap_or(1).max(1);
            let percent = ((100.0 * num as f32 / den as f32).round() as i32).clamp(0, 100);
            return BugreportzPayload::Progress { percent };
        }
        let pct_re = Regex::new(r"^(\d+)\s*%?$").unwrap();
        if let Some(caps) = pct_re.captures(payload) {
            let percent = caps[1].parse::<i32>().unwrap_or(0).clamp(0, 100);
            return BugreportzPayload::Progress { percent };
        }
        return BugreportzPayload::Unknown {
            raw: line.to_string(),
        };
    }
    if upper.starts_with("OK") {
        let payload = raw.splitn(2, ':').nth(1).unwrap_or("").trim();
        if payload.is_empty() {
            return BugreportzPayload::Unknown {
                raw: line.to_string(),
            };
        }
        let path = if let Some((_, value)) = payload.split_once('=') {
            value.trim()
        } else {
            payload
        };
        return BugreportzPayload::Ok {
            path: path.to_string(),
        };
    }
    if upper.starts_with("FAIL") {
        let payload = raw.splitn(2, ':').nth(1).unwrap_or(raw).trim();
        return BugreportzPayload::Fail {
            reason: payload.to_string(),
        };
    }
    BugreportzPayload::Unknown {
        raw: line.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_fraction() {
        let payload = parse_bugreportz_line("PROGRESS: 1/4");
        assert_eq!(payload, BugreportzPayload::Progress { percent: 25 });
    }

    #[test]
    fn parses_progress_percent() {
        let payload = parse_bugreportz_line("PROGRESS: 90%");
        assert_eq!(payload, BugreportzPayload::Progress { percent: 90 });
    }

    #[test]
    fn parses_ok_line() {
        let payload = parse_bugreportz_line("OK: /data/user/bugreport.zip");
        assert_eq!(
            payload,
            BugreportzPayload::Ok {
                path: "/data/user/bugreport.zip".to_string()
            }
        );
    }

    #[test]
    fn parses_fail_line() {
        let payload = parse_bugreportz_line("FAIL: Permission denied");
        assert_eq!(
            payload,
            BugreportzPayload::Fail {
                reason: "Permission denied".to_string()
            }
        );
    }
}
