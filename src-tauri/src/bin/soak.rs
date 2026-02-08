use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lazy_blacktea_rust_lib::app::adb::locator::resolve_adb_program;
use lazy_blacktea_rust_lib::app::adb::parse::parse_adb_devices;
use lazy_blacktea_rust_lib::app::adb::runner::{run_adb, run_command_with_timeout};
use lazy_blacktea_rust_lib::app::commands::{
    smoke_start_logcat_stream, smoke_start_perf_monitor, smoke_stop_logcat_stream,
    smoke_stop_perf_monitor, LogcatEvent, PerfEvent,
};
use lazy_blacktea_rust_lib::app::config::load_config;
use lazy_blacktea_rust_lib::app::state::AppState;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct Args {
    serial: Option<String>,
    out_dir: Option<PathBuf>,
    duration_secs: u64,
    interval_ms: u64,
    json: bool,
}

#[derive(Serialize)]
struct SoakSummary {
    tool: &'static str,
    status: &'static str,
    trace_id: String,
    serial: String,
    adb_program: String,
    out_dir: String,
    iterations: usize,
    failures: usize,
    warnings: usize,
    checks: Vec<SoakIteration>,
}

#[derive(Serialize)]
struct SoakIteration {
    index: usize,
    status: &'static str, // pass|fail|warn
    duration_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut serial = std::env::var("ANDROID_SERIAL")
        .ok()
        .filter(|s| !s.trim().is_empty());
    let mut out_dir: Option<PathBuf> = None;
    let mut duration_secs: u64 = 120;
    let mut interval_ms: u64 = 500;
    let mut json = false;

    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--serial" => {
                serial = it
                    .next()
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty());
                if serial.is_none() {
                    return Err("--serial requires a value".to_string());
                }
            }
            "--out" => {
                let value = it
                    .next()
                    .ok_or_else(|| "--out requires a value".to_string())?;
                out_dir = Some(PathBuf::from(value));
            }
            "--duration-secs" => {
                let value = it
                    .next()
                    .ok_or_else(|| "--duration-secs requires a value".to_string())?;
                duration_secs = value
                    .trim()
                    .parse::<u64>()
                    .map_err(|_| "--duration-secs must be a number".to_string())?;
            }
            "--interval-ms" => {
                let value = it
                    .next()
                    .ok_or_else(|| "--interval-ms requires a value".to_string())?;
                interval_ms = value
                    .trim()
                    .parse::<u64>()
                    .map_err(|_| "--interval-ms must be a number".to_string())?;
            }
            "--json" => json = true,
            "-h" | "--help" => {
                return Err("Usage: cargo run --bin soak -- [--serial SERIAL] [--out DIR] [--duration-secs N] [--interval-ms N] [--json]\n".to_string());
            }
            other => return Err(format!("Unknown arg: {other}")),
        }
    }

    Ok(Args {
        serial,
        out_dir,
        duration_secs: duration_secs.max(10),
        interval_ms: interval_ms.clamp(200, 5000),
        json,
    })
}

fn pick_single_device(adb_program: &str, trace_id: &str) -> Result<String, String> {
    let args = vec!["devices".to_string(), "-l".to_string()];
    let out = run_adb(adb_program, &args, trace_id).map_err(|err| err.to_string())?;
    if out.exit_code.unwrap_or_default() != 0 {
        return Err(format!("adb devices failed: {}", out.stderr.trim()));
    }
    let summaries = parse_adb_devices(&out.stdout);
    let online: Vec<_> = summaries
        .into_iter()
        .filter(|d| d.state == "device")
        .collect();
    if online.is_empty() {
        return Err("No online adb devices found.".to_string());
    }
    if online.len() > 1 {
        let serials = online
            .into_iter()
            .map(|d| d.serial)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Multiple online devices found ({serials}). Set ANDROID_SERIAL or pass --serial."
        ));
    }
    Ok(online[0].serial.clone())
}

fn main() {
    let args = match parse_args() {
        Ok(v) => v,
        Err(msg) => {
            eprintln!("{msg}");
            std::process::exit(2);
        }
    };

    let trace_id = Uuid::new_v4().to_string();
    let out_dir = args.out_dir.unwrap_or_else(|| {
        let mut p = std::env::temp_dir();
        p.push(format!("lazy_blacktea_tauri_soak_{trace_id}"));
        p
    });
    let _ = fs::create_dir_all(&out_dir);

    let config = match load_config(&trace_id) {
        Ok(cfg) => cfg,
        Err(err) => {
            eprintln!("Failed to load config: {err}");
            std::process::exit(1);
        }
    };
    let adb_program = resolve_adb_program(&config.adb.command_path);
    let serial = match args.serial {
        Some(s) => s,
        None => match pick_single_device(&adb_program, &trace_id) {
            Ok(s) => s,
            Err(err) => {
                eprintln!("{err}");
                std::process::exit(1);
            }
        },
    };

    let app_state = AppState::new();
    let start_all = Instant::now();
    let deadline = start_all + Duration::from_secs(args.duration_secs);

    let mut iterations: Vec<SoakIteration> = Vec::new();
    let mut failures = 0usize;
    let mut warnings = 0usize;

    let mut index = 0usize;
    while Instant::now() < deadline {
        index += 1;
        let iter_start = Instant::now();
        let mut status = "pass";
        let mut error: Option<String> = None;

        // 1) logcat stream start -> write marker -> stop
        let marker = format!("lbt-soak-{trace_id}-{index}");
        let captured: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let captured_emit = Arc::clone(&captured);
        let emitter: Arc<dyn Fn(LogcatEvent) + Send + Sync> = Arc::new(move |event| {
            let mut buf = captured_emit.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(line) = event.line {
                buf.push(line);
            }
            if !event.lines.is_empty() {
                buf.extend(event.lines);
            }
        });

        if let Err(err) = smoke_start_logcat_stream(
            serial.clone(),
            // Filter to the marker tag to avoid waiting behind a large existing log buffer.
            // Use `-s TAG` (logcat option) rather than filter specs for broad device compatibility.
            Some("-v time -T 1 -s lazy_blacktea_soak".to_string()),
            &adb_program,
            &app_state.logcat_processes,
            emitter,
            &trace_id,
        ) {
            status = "fail";
            error = Some(format!("logcat start failed: {err}"));
        } else {
            let write_args = vec![
                "-s".to_string(),
                serial.clone(),
                "shell".to_string(),
                "log".to_string(),
                "-t".to_string(),
                "lazy_blacktea_soak".to_string(),
                marker.clone(),
            ];
            let out = run_command_with_timeout(
                &adb_program,
                &write_args,
                Duration::from_secs(3),
                &trace_id,
            );
            if out.as_ref().ok().and_then(|o| o.exit_code).unwrap_or(1) != 0 {
                status = "warn";
                warnings += 1;
                error = Some("logcat marker write failed".to_string());
            }

            // Allow ADB/logcat some time to deliver the marker line into the stream.
            std::thread::sleep(Duration::from_millis(1000));

            let _ =
                smoke_stop_logcat_stream(serial.clone(), &app_state.logcat_processes, &trace_id);

            // The reader thread may flush a final batch of lines on process shutdown.
            let found_marker = {
                let lines = captured.lock().unwrap_or_else(|p| p.into_inner());
                lines.iter().any(|l| l.contains(&marker))
            };

            if !found_marker && status == "pass" {
                status = "warn";
                warnings += 1;
                error = Some("logcat marker not captured".to_string());
            }
        }

        // 2) perf monitor start -> wait -> stop (bounded internal samples)
        let perf_events: Arc<Mutex<Vec<PerfEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let perf_emit = Arc::clone(&perf_events);
        let perf_emitter: Arc<dyn Fn(PerfEvent) + Send + Sync> = Arc::new(move |event| {
            let mut buf = perf_emit.lock().unwrap_or_else(|p| p.into_inner());
            buf.push(event);
        });

        if let Err(err) = smoke_start_perf_monitor(
            serial.clone(),
            Some(args.interval_ms),
            &adb_program,
            &app_state.perf_monitors,
            perf_emitter,
            &trace_id,
        ) {
            status = "fail";
            error = Some(format!("perf start failed: {err}"));
        } else {
            std::thread::sleep(Duration::from_millis(args.interval_ms * 2));
            let _ = smoke_stop_perf_monitor(serial.clone(), &app_state.perf_monitors, &trace_id);
            let buf = perf_events.lock().unwrap_or_else(|p| p.into_inner());
            if !buf.iter().any(|e| e.snapshot.is_some()) && status == "pass" {
                status = "warn";
                warnings += 1;
                error = Some("perf emitted no snapshot".to_string());
            }
        }

        let duration_ms = iter_start.elapsed().as_millis();
        if status == "fail" {
            failures += 1;
        }
        iterations.push(SoakIteration {
            index,
            status,
            duration_ms,
            error,
        });
    }

    // Save full details for later inspection.
    let details_path = out_dir.join("soak_iterations.json");
    let _ = fs::write(
        &details_path,
        serde_json::to_string_pretty(&iterations).unwrap_or_default(),
    );

    let overall = if failures > 0 { "fail" } else { "pass" };
    let summary = SoakSummary {
        tool: "lazy_blacktea_tauri_backend_soak",
        status: overall,
        trace_id,
        serial,
        adb_program,
        out_dir: out_dir.to_string_lossy().to_string(),
        iterations: iterations.len(),
        failures,
        warnings,
        checks: iterations,
    };

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&summary).unwrap_or_default()
        );
    } else {
        println!(
            "status: {}\niterations: {}\nfailures: {}\nwarnings: {}\nout: {}\n",
            summary.status, summary.iterations, summary.failures, summary.warnings, summary.out_dir
        );
    }

    if overall != "pass" {
        std::process::exit(1);
    }
}
