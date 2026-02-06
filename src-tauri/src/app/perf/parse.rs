use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CpuTotals {
    pub total: u64,
    pub idle: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemTotals {
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NetTotals {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatteryTotals {
    pub level: Option<u8>,
    pub temperature_decic: Option<i32>,
}

pub const MARK_PROC_STAT: &str = "__LBT_PERF_PROC_STAT__";
pub const MARK_MEMINFO: &str = "__LBT_PERF_MEMINFO__";
pub const MARK_NETDEV: &str = "__LBT_PERF_NETDEV__";
pub const MARK_BATTERY: &str = "__LBT_PERF_BATTERY__";

pub fn build_perf_script() -> String {
    [
        format!("echo {MARK_PROC_STAT}"),
        "cat /proc/stat".to_string(),
        format!("echo {MARK_MEMINFO}"),
        "cat /proc/meminfo".to_string(),
        format!("echo {MARK_NETDEV}"),
        "cat /proc/net/dev".to_string(),
        format!("echo {MARK_BATTERY}"),
        "dumpsys battery".to_string(),
    ]
    .join("; ")
}

pub fn split_marked_sections(output: &str) -> Result<HashMap<&'static str, String>, String> {
    let mut sections: HashMap<&'static str, String> = HashMap::new();
    let mut current: Option<&'static str> = None;

    for line in output.lines() {
        let marker = match line.trim() {
            MARK_PROC_STAT => Some(MARK_PROC_STAT),
            MARK_MEMINFO => Some(MARK_MEMINFO),
            MARK_NETDEV => Some(MARK_NETDEV),
            MARK_BATTERY => Some(MARK_BATTERY),
            _ => None,
        };

        if let Some(marker) = marker {
            current = Some(marker);
            sections.entry(marker).or_default();
            continue;
        }

        if let Some(key) = current {
            let buf = sections.get_mut(key).expect("section exists");
            buf.push_str(line);
            buf.push('\n');
        }
    }

    Ok(sections)
}

pub fn parse_cpu_totals(proc_stat: &str) -> Result<CpuTotals, String> {
    let cpu_line = proc_stat
        .lines()
        .find(|line| line.starts_with("cpu "))
        .ok_or_else(|| "Missing cpu line in /proc/stat".to_string())?;

    let mut parts = cpu_line.split_whitespace();
    let label = parts.next().unwrap_or_default();
    if label != "cpu" {
        return Err("Invalid cpu line".to_string());
    }

    let mut values: Vec<u64> = Vec::new();
    for part in parts {
        if let Ok(value) = part.parse::<u64>() {
            values.push(value);
        } else {
            return Err("Invalid cpu counter".to_string());
        }
    }

    if values.len() < 4 {
        return Err("cpu line has insufficient counters".to_string());
    }

    let user = values.first().copied().unwrap_or(0);
    let nice = values.get(1).copied().unwrap_or(0);
    let system = values.get(2).copied().unwrap_or(0);
    let idle = values.get(3).copied().unwrap_or(0);
    let iowait = values.get(4).copied().unwrap_or(0);
    let irq = values.get(5).copied().unwrap_or(0);
    let softirq = values.get(6).copied().unwrap_or(0);
    let steal = values.get(7).copied().unwrap_or(0);
    let guest = values.get(8).copied().unwrap_or(0);
    let guest_nice = values.get(9).copied().unwrap_or(0);

    let idle_all = idle.saturating_add(iowait);
    let non_idle = user
        .saturating_add(nice)
        .saturating_add(system)
        .saturating_add(irq)
        .saturating_add(softirq)
        .saturating_add(steal);
    let total = idle_all
        .saturating_add(non_idle)
        .saturating_add(guest)
        .saturating_add(guest_nice);

    Ok(CpuTotals {
        total,
        idle: idle_all,
    })
}

pub fn compute_cpu_percent_x100(prev: CpuTotals, curr: CpuTotals) -> Option<u16> {
    let delta_total = curr.total.saturating_sub(prev.total);
    if delta_total == 0 {
        return None;
    }
    let delta_idle = curr.idle.saturating_sub(prev.idle);
    let busy = delta_total.saturating_sub(delta_idle);
    let percent_x100 = ((busy as u128) * 10_000u128 / (delta_total as u128)).min(10_000u128) as u16;
    Some(percent_x100)
}

pub fn parse_mem_totals(meminfo: &str) -> Result<MemTotals, String> {
    let mut total_kb: Option<u64> = None;
    let mut available_kb: Option<u64> = None;
    let mut free_kb: Option<u64> = None;
    let mut buffers_kb: Option<u64> = None;
    let mut cached_kb: Option<u64> = None;

    for line in meminfo.lines() {
        let mut parts = line.split_whitespace();
        let key = parts.next().unwrap_or_default().trim_end_matches(':');
        let value_str = parts.next().unwrap_or_default();
        let value = match value_str.parse::<u64>() {
            Ok(v) => v,
            Err(_) => continue,
        };

        match key {
            "MemTotal" => total_kb = Some(value),
            "MemAvailable" => available_kb = Some(value),
            "MemFree" => free_kb = Some(value),
            "Buffers" => buffers_kb = Some(value),
            "Cached" => cached_kb = Some(value),
            _ => {}
        }
    }

    let total_kb = total_kb.ok_or_else(|| "Missing MemTotal in /proc/meminfo".to_string())?;
    let available_kb = match available_kb {
        Some(value) => value,
        None => {
            let free = free_kb.unwrap_or(0);
            let buffers = buffers_kb.unwrap_or(0);
            let cached = cached_kb.unwrap_or(0);
            free.saturating_add(buffers).saturating_add(cached)
        }
    };

    Ok(MemTotals {
        total_bytes: total_kb.saturating_mul(1024),
        available_bytes: available_kb.saturating_mul(1024),
    })
}

pub fn parse_net_totals(netdev: &str) -> Result<NetTotals, String> {
    let mut rx_total: u64 = 0;
    let mut tx_total: u64 = 0;
    let mut seen = false;

    for line in netdev.lines() {
        let line = line.trim();
        if !line.contains(':') {
            continue;
        }
        let (iface, rest) = match line.split_once(':') {
            Some((a, b)) => (a.trim(), b.trim()),
            None => continue,
        };
        if iface.is_empty() || iface == "lo" {
            continue;
        }

        let cols: Vec<&str> = rest.split_whitespace().collect();
        if cols.len() < 9 {
            continue;
        }

        let rx_bytes = cols[0].parse::<u64>().ok();
        let tx_bytes = cols[8].parse::<u64>().ok();
        if let (Some(rx), Some(tx)) = (rx_bytes, tx_bytes) {
            rx_total = rx_total.saturating_add(rx);
            tx_total = tx_total.saturating_add(tx);
            seen = true;
        }
    }

    if !seen {
        return Err("Missing interfaces in /proc/net/dev".to_string());
    }

    Ok(NetTotals {
        rx_bytes: rx_total,
        tx_bytes: tx_total,
    })
}

pub fn parse_battery_totals(battery: &str) -> Result<BatteryTotals, String> {
    let mut level: Option<u8> = None;
    let mut temperature: Option<i32> = None;

    for line in battery.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("level:") {
            level = value.trim().parse::<u8>().ok();
        }
        if let Some(value) = line.strip_prefix("temperature:") {
            temperature = value.trim().parse::<i32>().ok();
        }
    }

    Ok(BatteryTotals {
        level,
        temperature_decic: temperature,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cpu_totals_extracts_cpu_line() {
        let input = "cpu  100 0 50 200 0 0 0 0 0 0\ncpu0 50 0 25 100 0 0 0 0 0 0\n";
        let totals = parse_cpu_totals(input).expect("cpu totals");
        assert_eq!(
            totals,
            CpuTotals {
                total: 350,
                idle: 200
            }
        );
    }

    #[test]
    fn compute_cpu_percent_x100_returns_none_when_no_delta() {
        let prev = CpuTotals { total: 10, idle: 5 };
        let curr = CpuTotals { total: 10, idle: 6 };
        assert_eq!(compute_cpu_percent_x100(prev, curr), None);
    }

    #[test]
    fn compute_cpu_percent_x100_computes_busy_fraction() {
        let prev = CpuTotals {
            total: 1000,
            idle: 700,
        };
        let curr = CpuTotals {
            total: 1100,
            idle: 740,
        };
        // delta_total=100, delta_idle=40 => busy=60 => 60.00%
        assert_eq!(compute_cpu_percent_x100(prev, curr), Some(6000));
    }

    #[test]
    fn parse_mem_totals_uses_memavailable_when_present() {
        let input = "MemTotal: 1000 kB\nMemAvailable: 250 kB\n";
        let mem = parse_mem_totals(input).expect("mem totals");
        assert_eq!(mem.total_bytes, 1000 * 1024);
        assert_eq!(mem.available_bytes, 250 * 1024);
    }

    #[test]
    fn parse_mem_totals_falls_back_when_memavailable_missing() {
        let input = "MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 25 kB\n";
        let mem = parse_mem_totals(input).expect("mem totals");
        assert_eq!(mem.total_bytes, 1000 * 1024);
        assert_eq!(mem.available_bytes, 175 * 1024);
    }

    #[test]
    fn parse_net_totals_sums_non_lo_interfaces() {
        let input = r#"
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1 0 0 0 0 0 0 0 2 0 0 0 0 0 0 0
  wlan0: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0
   rmnet0: 50 0 0 0 0 0 0 0 75 0 0 0 0 0 0 0
"#;
        let net = parse_net_totals(input).expect("net totals");
        assert_eq!(net.rx_bytes, 150);
        assert_eq!(net.tx_bytes, 275);
    }

    #[test]
    fn parse_battery_totals_extracts_level_and_temp() {
        let input = "AC powered: false\nlevel: 85\ntemperature: 300\n";
        let battery = parse_battery_totals(input).expect("battery");
        assert_eq!(battery.level, Some(85));
        assert_eq!(battery.temperature_decic, Some(300));
    }

    #[test]
    fn split_marked_sections_collects_sections() {
        let output = format!(
            "{MARK_PROC_STAT}\ncpu 1 2 3 4\n{MARK_MEMINFO}\nMemTotal: 1 kB\n{MARK_NETDEV}\nlo: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n{MARK_BATTERY}\nlevel: 1\n"
        );
        let sections = split_marked_sections(&output).expect("sections");
        assert!(sections.get(MARK_PROC_STAT).unwrap().contains("cpu "));
        assert!(sections.get(MARK_MEMINFO).unwrap().contains("MemTotal"));
        assert!(sections.get(MARK_NETDEV).unwrap().contains("lo:"));
        assert!(sections.get(MARK_BATTERY).unwrap().contains("level:"));
    }
}
