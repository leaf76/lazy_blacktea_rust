use std::collections::{HashMap, HashSet};

pub type AndroidUid = u32;

/// Parse `cmd package list packages -U` output into `uid -> packages`.
///
/// Expected lines:
/// - `package:com.example.app uid:10234`
pub fn parse_cmd_package_list_u(output: &str) -> HashMap<AndroidUid, Vec<String>> {
    let mut by_uid: HashMap<AndroidUid, HashSet<String>> = HashMap::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !trimmed.starts_with("package:") {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let pkg_part = parts.next().unwrap_or_default();
        let package_name = pkg_part.strip_prefix("package:").unwrap_or_default().trim();
        if package_name.is_empty() {
            continue;
        }

        let uid_part = parts.find(|part| part.starts_with("uid:"));
        let uid: AndroidUid = match uid_part
            .and_then(|value| value.strip_prefix("uid:"))
            .and_then(|value| value.parse::<u32>().ok())
        {
            Some(uid) => uid,
            None => continue,
        };

        by_uid
            .entry(uid)
            .or_default()
            .insert(package_name.to_string());
    }

    let mut out: HashMap<AndroidUid, Vec<String>> = HashMap::new();
    for (uid, set) in by_uid {
        let mut packages: Vec<String> = set.into_iter().collect();
        packages.sort();
        out.insert(uid, packages);
    }
    out
}

fn find_column_index(header: &[&str], candidates: &[&str]) -> Option<usize> {
    candidates
        .iter()
        .copied()
        .find_map(|name| header.iter().position(|value| *value == name))
}

/// Parse `/proc/net/xt_qtaguid/stats` into `uid -> (rx_bytes, tx_bytes)`.
///
/// The header order varies across Android versions, so indices are resolved by column name.
pub fn parse_xt_qtaguid_stats(output: &str) -> Result<HashMap<AndroidUid, (u64, u64)>, String> {
    let mut lines = output.lines().filter(|line| !line.trim().is_empty());
    let header_line = lines
        .next()
        .ok_or_else(|| "Missing xt_qtaguid stats header".to_string())?;
    let header: Vec<&str> = header_line.split_whitespace().collect();

    let iface_index = find_column_index(&header, &["iface"])
        .ok_or_else(|| "Missing iface column in xt_qtaguid stats".to_string())?;
    let uid_index = find_column_index(&header, &["uid_tag_int", "uid"])
        .ok_or_else(|| "Missing uid column in xt_qtaguid stats".to_string())?;
    let rx_index = find_column_index(&header, &["rx_bytes"])
        .ok_or_else(|| "Missing rx_bytes column in xt_qtaguid stats".to_string())?;
    let tx_index = find_column_index(&header, &["tx_bytes"])
        .ok_or_else(|| "Missing tx_bytes column in xt_qtaguid stats".to_string())?;

    let required_len = iface_index
        .max(uid_index)
        .max(rx_index)
        .max(tx_index)
        .saturating_add(1);

    let mut by_uid: HashMap<AndroidUid, (u64, u64)> = HashMap::new();
    for line in lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < required_len {
            continue;
        }

        let iface = parts[iface_index];
        if iface == "lo" {
            continue;
        }

        let uid: AndroidUid = match parts[uid_index].parse::<u32>() {
            Ok(uid) => uid,
            Err(_) => continue,
        };
        let rx: u64 = match parts[rx_index].parse::<u64>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let tx: u64 = match parts[tx_index].parse::<u64>() {
            Ok(value) => value,
            Err(_) => continue,
        };

        let entry = by_uid.entry(uid).or_insert((0, 0));
        entry.0 = entry.0.saturating_add(rx);
        entry.1 = entry.1.saturating_add(tx);
    }

    Ok(by_uid)
}

/// Parse `dumpsys netstats` output's `mAppUidStatsMap` into `uid -> (rx_bytes, tx_bytes)`.
///
/// Example section:
/// - `mAppUidStatsMap:`
/// - `uid rxBytes rxPackets txBytes txPackets`
/// - `10242 321596 726 118381 706`
pub fn parse_dumpsys_netstats_app_uid_stats(
    output: &str,
) -> Result<HashMap<AndroidUid, (u64, u64)>, String> {
    let mut in_section = false;
    let mut by_uid: HashMap<AndroidUid, (u64, u64)> = HashMap::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if in_section {
                break;
            }
            continue;
        }

        if !in_section {
            if trimmed == "uid rxBytes rxPackets txBytes txPackets" {
                in_section = true;
            }
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let uid_str = parts.next().unwrap_or_default();
        if uid_str.is_empty() || !uid_str.chars().all(|ch| ch.is_ascii_digit()) {
            break;
        }
        let uid: AndroidUid = match uid_str.parse::<u32>() {
            Ok(uid) => uid,
            Err(_) => break,
        };

        let rx_bytes_str = parts.next().unwrap_or_default();
        let _rx_packets_str = parts.next().unwrap_or_default();
        let tx_bytes_str = parts.next().unwrap_or_default();
        let _tx_packets_str = parts.next().unwrap_or_default();

        let rx_bytes: u64 = match rx_bytes_str.parse::<u64>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let tx_bytes: u64 = match tx_bytes_str.parse::<u64>() {
            Ok(value) => value,
            Err(_) => continue,
        };

        by_uid.insert(uid, (rx_bytes, tx_bytes));
    }

    if !in_section {
        return Err("Missing mAppUidStatsMap in dumpsys netstats output".to_string());
    }

    Ok(by_uid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cmd_package_list_u_groups_by_uid_and_sorts() {
        let input = r#"
package:com.example.one uid:10234
package:com.example.two uid:10234
package:com.shared.a uid:9999
package:com.shared.b uid:9999
package:invalid uid:abc
package:missinguid
random:ignored
"#;

        let map = parse_cmd_package_list_u(input);
        assert_eq!(
            map.get(&10234).cloned().unwrap_or_default(),
            vec!["com.example.one".to_string(), "com.example.two".to_string()]
        );
        assert_eq!(
            map.get(&9999).cloned().unwrap_or_default(),
            vec!["com.shared.a".to_string(), "com.shared.b".to_string()]
        );
        assert!(!map.contains_key(&0));
    }

    #[test]
    fn parse_xt_qtaguid_stats_sums_by_uid_and_ignores_loopback() {
        let input = r#"idx iface acct_tag_hex uid_tag_int cnt_set rx_bytes rx_packets tx_bytes tx_packets
2 wlan0 0x0 1000 0 100 1 200 2
3 rmnet0 0x0 1000 0 50 1 25 1
4 lo 0x0 1000 0 999 1 999 1
5 wlan0 0x0 10234 0 10 1 20 1
"#;

        let map = parse_xt_qtaguid_stats(input).expect("parse ok");
        assert_eq!(map.get(&1000), Some(&(150, 225)));
        assert_eq!(map.get(&10234), Some(&(10, 20)));
    }

    #[test]
    fn parse_xt_qtaguid_stats_resolves_header_by_name() {
        let input = r#"uid_tag_int tx_bytes iface rx_bytes idx
10234 7 wlan0 3 1
10234 1 rmnet0 2 2
"#;
        let map = parse_xt_qtaguid_stats(input).expect("parse ok");
        assert_eq!(map.get(&10234), Some(&(5, 8)));
    }

    #[test]
    fn parse_dumpsys_netstats_app_uid_stats_extracts_map() {
        let input = r#"
something else
mAppUidStatsMap:
  uid rxBytes rxPackets txBytes txPackets
  10242 321596 726 118381 706
  1000 17060394 57975 2422085 11204
  0 0 0 1262373 15101
mIfaceStatsMap:
  ifaceIndex ifaceName rxBytes rxPackets txBytes txPackets
  1 wlan0 1 1 2 2
"#;

        let map = parse_dumpsys_netstats_app_uid_stats(input).expect("parse ok");
        assert_eq!(map.get(&10242), Some(&(321596, 118381)));
        assert_eq!(map.get(&1000), Some(&(17060394, 2422085)));
        assert_eq!(map.get(&0), Some(&(0, 1262373)));
    }
}
