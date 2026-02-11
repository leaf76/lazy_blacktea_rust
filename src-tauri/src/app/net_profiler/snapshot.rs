use std::collections::{HashMap, HashSet};

use crate::app::models::NetUsageRow;

pub fn build_net_usage_rows(
    totals: &HashMap<u32, (u64, u64)>,
    prev_totals: Option<&HashMap<u32, (u64, u64)>>,
    dt_ms: Option<u128>,
    packages_by_uid: &HashMap<u32, Vec<String>>,
    pinned_uids: &[u32],
    top_n: usize,
) -> Vec<NetUsageRow> {
    if top_n == 0 {
        return vec![];
    }

    let mut pinned_unique: Vec<u32> = Vec::new();
    let mut pinned_seen: HashSet<u32> = HashSet::new();
    for uid in pinned_uids.iter().copied() {
        if pinned_seen.insert(uid) {
            pinned_unique.push(uid);
        }
    }
    if pinned_unique.len() > top_n {
        pinned_unique.truncate(top_n);
    }
    let pinned_set: HashSet<u32> = pinned_unique.iter().copied().collect();

    let dt_ms = dt_ms.filter(|value| *value > 0);
    let sort_by_bps = prev_totals.is_some() && dt_ms.is_some();

    let mut rows_all: Vec<NetUsageRow> = Vec::with_capacity(totals.len());
    for (uid, (rx_bytes, tx_bytes)) in totals.iter() {
        if *rx_bytes == 0 && *tx_bytes == 0 && !pinned_set.contains(uid) {
            continue;
        }

        let (rx_bps, tx_bps) = match (prev_totals, dt_ms) {
            (Some(prev), Some(dt_ms)) => {
                let (prev_rx, prev_tx) = prev.get(uid).copied().unwrap_or((0, 0));
                let rx_delta = rx_bytes.saturating_sub(prev_rx) as u128;
                let tx_delta = tx_bytes.saturating_sub(prev_tx) as u128;
                let rx_bps = ((rx_delta * 1000u128) / dt_ms).min(u64::MAX as u128) as u64;
                let tx_bps = ((tx_delta * 1000u128) / dt_ms).min(u64::MAX as u128) as u64;
                (Some(rx_bps), Some(tx_bps))
            }
            _ => (None, None),
        };

        rows_all.push(NetUsageRow {
            uid: *uid,
            packages: packages_by_uid.get(uid).cloned().unwrap_or_default(),
            rx_bytes: *rx_bytes,
            tx_bytes: *tx_bytes,
            rx_bps,
            tx_bps,
        });
    }

    for uid in pinned_unique.iter().copied() {
        if rows_all.iter().any(|row| row.uid == uid) {
            continue;
        }

        let (rx_bps, tx_bps) = match (prev_totals, dt_ms) {
            (Some(prev), Some(dt_ms)) => {
                let (prev_rx, prev_tx) = prev.get(&uid).copied().unwrap_or((0, 0));
                let rx_delta = 0u64.saturating_sub(prev_rx) as u128;
                let tx_delta = 0u64.saturating_sub(prev_tx) as u128;
                let rx_bps = ((rx_delta * 1000u128) / dt_ms).min(u64::MAX as u128) as u64;
                let tx_bps = ((tx_delta * 1000u128) / dt_ms).min(u64::MAX as u128) as u64;
                (Some(rx_bps), Some(tx_bps))
            }
            _ => (None, None),
        };

        rows_all.push(NetUsageRow {
            uid,
            packages: packages_by_uid.get(&uid).cloned().unwrap_or_default(),
            rx_bytes: 0,
            tx_bytes: 0,
            rx_bps,
            tx_bps,
        });
    }

    if sort_by_bps {
        rows_all.sort_by_key(|row| {
            let rx = row.rx_bps.unwrap_or(0);
            let tx = row.tx_bps.unwrap_or(0);
            std::cmp::Reverse(rx.saturating_add(tx))
        });
    } else {
        rows_all.sort_by_key(|row| std::cmp::Reverse(row.rx_bytes.saturating_add(row.tx_bytes)));
    }

    let mut final_rows: Vec<NetUsageRow> = Vec::new();
    for uid in pinned_unique.iter().copied() {
        if let Some(row) = rows_all.iter().find(|row| row.uid == uid) {
            final_rows.push(row.clone());
        }
    }

    for row in rows_all.iter() {
        if final_rows.len() >= top_n {
            break;
        }
        if pinned_set.contains(&row.uid) {
            continue;
        }
        final_rows.push(row.clone());
    }

    final_rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_net_usage_rows_includes_pinned_even_if_not_top_n() {
        let totals: HashMap<u32, (u64, u64)> =
            HashMap::from([(100, (1000, 0)), (101, (900, 0)), (200, (1, 0))]);
        let packages_by_uid: HashMap<u32, Vec<String>> = HashMap::new();
        let rows = build_net_usage_rows(&totals, None, None, &packages_by_uid, &[200], 2);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].uid, 200);
        assert_eq!(rows[1].uid, 100);
    }

    #[test]
    fn build_net_usage_rows_includes_missing_pinned_uid_with_zeros() {
        let totals: HashMap<u32, (u64, u64)> = HashMap::from([(100, (1000, 0))]);
        let packages_by_uid: HashMap<u32, Vec<String>> = HashMap::new();
        let rows = build_net_usage_rows(&totals, None, None, &packages_by_uid, &[200], 2);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].uid, 200);
        assert_eq!(rows[0].rx_bytes, 0);
        assert_eq!(rows[0].tx_bytes, 0);
        assert_eq!(rows[1].uid, 100);
    }

    #[test]
    fn build_net_usage_rows_dedupes_pinned_uids_and_respects_top_n() {
        let totals: HashMap<u32, (u64, u64)> =
            HashMap::from([(1, (100, 0)), (2, (90, 0)), (3, (80, 0))]);
        let packages_by_uid: HashMap<u32, Vec<String>> = HashMap::new();
        let rows = build_net_usage_rows(&totals, None, None, &packages_by_uid, &[2, 2, 3], 2);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].uid, 2);
        assert_eq!(rows[1].uid, 3);
    }
}
