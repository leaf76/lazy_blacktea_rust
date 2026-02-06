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
        let payload = raw.split_once(':').map(|x| x.1).unwrap_or("").trim();
        if payload.is_empty() {
            return BugreportzPayload::Unknown {
                raw: line.to_string(),
            };
        }
        if let Some((num_raw, den_raw)) = payload.split_once('/') {
            let num = num_raw.trim().parse::<i32>().unwrap_or(0);
            let den = den_raw.trim().parse::<i32>().unwrap_or(1).max(1);
            let percent = ((100.0 * num as f32 / den as f32).round() as i32).clamp(0, 100);
            return BugreportzPayload::Progress { percent };
        }
        let trimmed = payload.trim_end_matches('%').trim();
        if let Ok(percent) = trimmed.parse::<i32>() {
            return BugreportzPayload::Progress {
                percent: percent.clamp(0, 100),
            };
        }
        return BugreportzPayload::Unknown {
            raw: line.to_string(),
        };
    }
    if upper.starts_with("OK") {
        let payload = raw.split_once(':').map(|x| x.1).unwrap_or("").trim();
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
        let payload = raw.split_once(':').map(|x| x.1).unwrap_or(raw).trim();
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
