use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lazy_blacktea_rust_lib::app::adb::locator::resolve_adb_program;
use lazy_blacktea_rust_lib::app::adb::parse::parse_adb_devices;
use lazy_blacktea_rust_lib::app::adb::runner::{run_adb, run_command_with_timeout};
use lazy_blacktea_rust_lib::app::commands::{
    capture_screenshot, check_adb, check_scrcpy, delete_device_path, export_ui_hierarchy,
    list_device_files, mkdir_device_dir, rename_device_path, smoke_install_apk_batch,
    smoke_launch_app, smoke_start_logcat_stream, smoke_start_perf_monitor,
    smoke_stop_logcat_stream, smoke_stop_perf_monitor, LogcatEvent, PerfEvent,
};
use lazy_blacktea_rust_lib::app::config::load_config;
use lazy_blacktea_rust_lib::app::state::AppState;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct Args {
    serial: Option<String>,
    out_dir: Option<PathBuf>,
    json: bool,
    with_files: bool,
    with_uiauto: bool,
    with_ui_inspector: bool,
    apk_path: Option<String>,
    apk_replace: bool,
    apk_allow_downgrade: bool,
    apk_grant: bool,
    apk_allow_test: bool,
    apk_extra_args: Option<String>,
    apk_launch: bool,
    apk_package: Option<String>,
}

#[derive(Serialize)]
struct SmokeSummary {
    tool: &'static str,
    status: &'static str,
    trace_id: String,
    serial: Option<String>,
    adb_program: Option<String>,
    out_dir: String,
    artifacts: HashMap<String, String>,
    checks: Vec<SmokeCheck>,
}

#[derive(Serialize)]
struct SmokeCheck {
    name: &'static str,
    status: &'static str, // pass|fail|warn|skip
    duration_ms: u128,
    artifacts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut serial = std::env::var("ANDROID_SERIAL")
        .ok()
        .filter(|s| !s.trim().is_empty());
    let mut out_dir: Option<PathBuf> = None;
    let mut json = false;
    let mut with_files = false;
    let mut with_uiauto = false;
    let mut with_ui_inspector = false;
    let mut apk_path: Option<String> = None;
    let mut apk_replace = true;
    let mut apk_allow_downgrade = false;
    let mut apk_grant = true;
    let mut apk_allow_test = false;
    let mut apk_extra_args: Option<String> = None;
    let mut apk_launch = false;
    let mut apk_package: Option<String> = None;

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
            "--json" => {
                json = true;
            }
            "--with-files" => {
                with_files = true;
            }
            "--with-uiauto" => {
                with_uiauto = true;
            }
            "--with-ui-inspector" => {
                with_ui_inspector = true;
            }
            "--apk" => {
                let value = it
                    .next()
                    .ok_or_else(|| "--apk requires a value".to_string())?;
                apk_path = Some(value);
            }
            "--apk-no-replace" => {
                apk_replace = false;
            }
            "--apk-allow-downgrade" => {
                apk_allow_downgrade = true;
            }
            "--apk-no-grant" => {
                apk_grant = false;
            }
            "--apk-allow-test" => {
                apk_allow_test = true;
            }
            "--apk-extra-args" => {
                let value = it
                    .next()
                    .ok_or_else(|| "--apk-extra-args requires a value".to_string())?;
                apk_extra_args = Some(value);
            }
            "--apk-launch" => {
                apk_launch = true;
            }
            "--apk-package" => {
                let value = it
                    .next()
                    .ok_or_else(|| "--apk-package requires a value".to_string())?;
                apk_package = Some(value);
            }
            "-h" | "--help" => {
                return Err(
                    "Usage: cargo run --bin smoke -- [--serial SERIAL] [--out DIR] [--json] [--with-files] [--with-uiauto] [--with-ui-inspector] [--apk PATH] [--apk-launch]\n"
                        .to_string(),
                );
            }
            other => return Err(format!("Unknown arg: {other}")),
        }
    }

    if with_uiauto && !with_files {
        return Err("--with-uiauto requires --with-files".to_string());
    }

    Ok(Args {
        serial,
        out_dir,
        json,
        with_files,
        with_uiauto,
        with_ui_inspector,
        apk_path,
        apk_replace,
        apk_allow_downgrade,
        apk_grant,
        apk_allow_test,
        apk_extra_args,
        apk_launch,
        apk_package,
    })
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|err| format!("Failed to create dir {}: {err}", path.display()))
}

fn is_valid_package_name(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Basic Android package format: segments separated by dots, segments are alnum/underscore.
    let mut parts = trimmed.split('.');
    let first = match parts.next() {
        Some(v) => v,
        None => return false,
    };
    if first.is_empty() {
        return false;
    }
    let mut count = 1usize;
    if !first.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return false;
    }
    for part in parts {
        count += 1;
        if part.is_empty() {
            return false;
        }
        if !part.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return false;
        }
    }
    count >= 2
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

fn run_check<F>(checks: &mut Vec<SmokeCheck>, name: &'static str, f: F) -> Result<(), ()>
where
    F: FnOnce() -> Result<
        (Vec<String>, Option<&'static str>, Option<String>),
        (&'static str, String),
    >,
{
    let start = Instant::now();
    match f() {
        Ok((artifacts, error_code, error)) => {
            checks.push(SmokeCheck {
                name,
                status: if error_code.is_some() || error.is_some() {
                    "warn"
                } else {
                    "pass"
                },
                duration_ms: start.elapsed().as_millis(),
                artifacts,
                error_code,
                error,
            });
            Ok(())
        }
        Err((code, err)) => {
            checks.push(SmokeCheck {
                name,
                status: "fail",
                duration_ms: start.elapsed().as_millis(),
                artifacts: vec![],
                error_code: Some(code),
                error: Some(err),
            });
            Err(())
        }
    }
}

fn run_warn<F>(checks: &mut Vec<SmokeCheck>, name: &'static str, f: F)
where
    F: FnOnce() -> Result<(Vec<String>, Option<String>), (&'static str, String)>,
{
    let start = Instant::now();
    match f() {
        Ok((artifacts, warning)) => {
            checks.push(SmokeCheck {
                name,
                status: if warning.is_some() { "warn" } else { "pass" },
                duration_ms: start.elapsed().as_millis(),
                artifacts,
                error_code: warning.as_ref().map(|_| "WARN"),
                error: warning,
            });
        }
        Err((code, err)) => {
            checks.push(SmokeCheck {
                name,
                status: "warn",
                duration_ms: start.elapsed().as_millis(),
                artifacts: vec![],
                error_code: Some(code),
                error: Some(err),
            });
        }
    }
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
        p.push(format!("lazy_blacktea_tauri_smoke_{trace_id}"));
        p
    });
    if let Err(err) = ensure_dir(&out_dir) {
        eprintln!("{err}");
        std::process::exit(1);
    }

    let mut artifacts: HashMap<String, String> = HashMap::new();
    let mut checks: Vec<SmokeCheck> = Vec::new();
    let mut status = "pass";
    let app_state = AppState::new();

    // Resolve adb program the same way the app does (config-aware).
    let config = match load_config(&trace_id) {
        Ok(cfg) => cfg,
        Err(err) => {
            checks.push(SmokeCheck {
                name: "load_config",
                status: "fail",
                duration_ms: 0,
                artifacts: vec![],
                error_code: Some("ERR_CONFIG"),
                error: Some(err.to_string()),
            });
            status = "fail";
            let summary = SmokeSummary {
                tool: "lazy_blacktea_tauri_backend_smoke",
                status,
                trace_id,
                serial: args.serial,
                adb_program: None,
                out_dir: out_dir.to_string_lossy().to_string(),
                artifacts,
                checks,
            };
            println!(
                "{}",
                serde_json::to_string_pretty(&summary).unwrap_or_default()
            );
            std::process::exit(1);
        }
    };
    let adb_program = resolve_adb_program(&config.adb.command_path);

    // check_adb (real command)
    if run_check(&mut checks, "check_adb", || {
        let resp = check_adb(Some(adb_program.clone()), Some(trace_id.clone()))
            .map_err(|err| ("ERR_CHECK_ADB", err.to_string()))?;
        let path = out_dir.join("check_adb.txt");
        fs::write(&path, &resp.data.version_output)
            .map_err(|err| ("ERR_IO", format!("Failed to write check_adb output: {err}")))?;
        artifacts.insert("check_adb".to_string(), path.to_string_lossy().to_string());
        Ok((vec![path.to_string_lossy().to_string()], None, None))
    })
    .is_err()
    {
        status = "fail";
    }

    // check_scrcpy (warn if not available)
    run_warn(&mut checks, "check_scrcpy", || {
        let resp =
            check_scrcpy(Some(trace_id.clone())).map_err(|err| ("WARN_SCRCPY", err.to_string()))?;
        let path = out_dir.join("check_scrcpy.json");
        let body = serde_json::to_string_pretty(&resp.data).map_err(|err| {
            (
                "WARN_SCRCPY",
                format!("Failed to serialize scrcpy info: {err}"),
            )
        })?;
        fs::write(&path, body)
            .map_err(|err| ("WARN_SCRCPY", format!("Failed to write scrcpy info: {err}")))?;
        artifacts.insert(
            "check_scrcpy".to_string(),
            path.to_string_lossy().to_string(),
        );
        if resp.data.available {
            Ok((vec![path.to_string_lossy().to_string()], None))
        } else {
            Ok((
                vec![path.to_string_lossy().to_string()],
                Some("scrcpy not available (optional).".to_string()),
            ))
        }
    });

    // Determine serial.
    let serial = match args.serial.clone() {
        Some(s) => s,
        None => match pick_single_device(&adb_program, &trace_id) {
            Ok(s) => s,
            Err(err) => {
                checks.push(SmokeCheck {
                    name: "pick_device",
                    status: "fail",
                    duration_ms: 0,
                    artifacts: vec![],
                    error_code: Some("ERR_PICK_DEVICE"),
                    error: Some(err),
                });
                status = "fail";
                let summary = SmokeSummary {
                    tool: "lazy_blacktea_tauri_backend_smoke",
                    status,
                    trace_id,
                    serial: None,
                    adb_program: Some(adb_program),
                    out_dir: out_dir.to_string_lossy().to_string(),
                    artifacts,
                    checks,
                };
                println!(
                    "{}",
                    serde_json::to_string_pretty(&summary).unwrap_or_default()
                );
                std::process::exit(1);
            }
        },
    };

    // capture_screenshot (real command)
    if run_check(&mut checks, "capture_screenshot", || {
        let resp = capture_screenshot(
            serial.clone(),
            out_dir.to_string_lossy().to_string(),
            Some(trace_id.clone()),
        )
        .map_err(|err| ("ERR_SCREENSHOT", err.to_string()))?;
        let path = PathBuf::from(resp.data);
        if !path.exists()
            || fs::metadata(&path)
                .map_err(|err| ("ERR_IO", err.to_string()))?
                .len()
                == 0
        {
            return Err((
                "ERR_SCREENSHOT_EMPTY",
                "Screenshot file missing or empty".to_string(),
            ));
        }
        artifacts.insert("screenshot".to_string(), path.to_string_lossy().to_string());
        Ok((vec![path.to_string_lossy().to_string()], None, None))
    })
    .is_err()
    {
        status = "fail";
    }

    // list_device_files (real command)
    if run_check(&mut checks, "list_device_files", || {
        let resp = list_device_files(
            serial.clone(),
            "/sdcard".to_string(),
            Some(trace_id.clone()),
        )
        .map_err(|err| ("ERR_LIST_FILES", err.to_string()))?;
        let path = out_dir.join("ls_sdcard.json");
        let body = serde_json::to_string_pretty(&resp.data)
            .map_err(|err| ("ERR_IO", format!("Failed to serialize file list: {err}")))?;
        fs::write(&path, body)
            .map_err(|err| ("ERR_IO", format!("Failed to write file list: {err}")))?;
        artifacts.insert("ls_sdcard".to_string(), path.to_string_lossy().to_string());
        Ok((vec![path.to_string_lossy().to_string()], None, None))
    })
    .is_err()
    {
        status = "fail";
    }

    // Bounded logcat snapshot (backend-equivalent external dependency check).
    run_warn(&mut checks, "logcat_snapshot", || {
        let path = out_dir.join("logcat.txt");
        let cmd_args = vec![
            "-s".to_string(),
            serial.clone(),
            "logcat".to_string(),
            "-d".to_string(),
            "-v".to_string(),
            "time".to_string(),
            "-t".to_string(),
            "200".to_string(),
        ];
        let out =
            run_command_with_timeout(&adb_program, &cmd_args, Duration::from_secs(10), &trace_id)
                .map_err(|err| ("WARN_LOGCAT", err.to_string()))?;
        fs::write(&path, out.stdout)
            .map_err(|err| ("WARN_LOGCAT", format!("Failed to write logcat: {err}")))?;
        artifacts.insert("logcat".to_string(), path.to_string_lossy().to_string());
        Ok((vec![path.to_string_lossy().to_string()], None))
    });

    // Logcat start/stop stream using the same registry logic as the Tauri command.
    // We write a marker log line to ensure the stream emits at least one known entry.
    if run_check(&mut checks, "logcat_stream_start_stop", || {
        let marker = format!("lbt-smoke-{trace_id}");
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

        smoke_start_logcat_stream(
            serial.clone(),
            // Filter to the marker tag to avoid waiting behind a large existing log buffer.
            // Use `-s TAG` (logcat option) rather than filter specs for broad device compatibility.
            Some("-v time -T 1 -s lazy_blacktea_smoke".to_string()),
            &adb_program,
            &app_state.logcat_processes,
            Arc::clone(&emitter),
            &trace_id,
        )
        .map_err(|err| ("ERR_LOGCAT_START", err.to_string()))?;

        let write_args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "log".to_string(),
            "-t".to_string(),
            "lazy_blacktea_smoke".to_string(),
            marker.clone(),
        ];
        let out =
            run_command_with_timeout(&adb_program, &write_args, Duration::from_secs(3), &trace_id)
                .map_err(|err| ("ERR_LOGCAT_WRITE", err.to_string()))?;
        if out.exit_code.unwrap_or_default() != 0 {
            let _ =
                smoke_stop_logcat_stream(serial.clone(), &app_state.logcat_processes, &trace_id);
            return Err(("ERR_LOGCAT_WRITE", out.stderr));
        }

        std::thread::sleep(Duration::from_millis(600));

        smoke_stop_logcat_stream(serial.clone(), &app_state.logcat_processes, &trace_id)
            .map_err(|err| ("ERR_LOGCAT_STOP", err.to_string()))?;

        let lines = captured.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let path = out_dir.join("logcat_stream.txt");
        fs::write(&path, lines.join("\n") + "\n")
            .map_err(|err| ("ERR_IO", format!("Failed to write logcat stream: {err}")))?;
        artifacts.insert(
            "logcat_stream".to_string(),
            path.to_string_lossy().to_string(),
        );

        let found = lines.iter().any(|line| line.contains(&marker));
        if found {
            Ok((vec![path.to_string_lossy().to_string()], None, None))
        } else {
            Ok((
                vec![path.to_string_lossy().to_string()],
                Some("WARN_LOGCAT_NO_MARKER"),
                Some("Logcat stream did not capture the marker line.".to_string()),
            ))
        }
    })
    .is_err()
    {
        status = "fail";
    }

    // Perf monitor start/stop using the same registry logic as the Tauri command.
    // This emits a few snapshots (bounded) and verifies at least one snapshot arrives.
    if run_check(&mut checks, "perf_monitor_start_stop", || {
        let events: Arc<Mutex<Vec<PerfEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let events_emit = Arc::clone(&events);
        let emitter: Arc<dyn Fn(PerfEvent) + Send + Sync> = Arc::new(move |event| {
            let mut buf = events_emit.lock().unwrap_or_else(|p| p.into_inner());
            buf.push(event);
        });

        smoke_start_perf_monitor(
            serial.clone(),
            Some(500),
            &adb_program,
            &app_state.perf_monitors,
            Arc::clone(&emitter),
            &trace_id,
        )
        .map_err(|err| ("ERR_PERF_START", err.to_string()))?;

        std::thread::sleep(Duration::from_millis(1300));

        smoke_stop_perf_monitor(serial.clone(), &app_state.perf_monitors, &trace_id)
            .map_err(|err| ("ERR_PERF_STOP", err.to_string()))?;

        let buf = events.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let path = out_dir.join("perf_events.json");
        let body = serde_json::to_string_pretty(&buf)
            .map_err(|err| ("ERR_IO", format!("Failed to serialize perf events: {err}")))?;
        fs::write(&path, body)
            .map_err(|err| ("ERR_IO", format!("Failed to write perf events: {err}")))?;
        artifacts.insert(
            "perf_events".to_string(),
            path.to_string_lossy().to_string(),
        );

        let has_snapshot = buf.iter().any(|event| event.snapshot.is_some());
        if has_snapshot {
            Ok((vec![path.to_string_lossy().to_string()], None, None))
        } else {
            Ok((
                vec![path.to_string_lossy().to_string()],
                Some("WARN_PERF_NO_SNAPSHOT"),
                Some("Perf monitor did not emit any snapshot.".to_string()),
            ))
        }
    })
    .is_err()
    {
        status = "fail";
    }

    // Optional file push/pull and uiautomator dump (real-device product capability).
    if args.with_files {
        // File Explorer command-path coverage: mkdir/rename/delete inside a temp dir.
        if run_check(&mut checks, "file_ops_mkdir_rename_delete", || {
            let base = format!(
                "/sdcard/Download/lazy_blacktea_smoke_ops_{}",
                Uuid::new_v4()
            );
            let a = format!("{base}/a");
            let b = format!("{base}/b");

            mkdir_device_dir(serial.clone(), a.clone(), Some(trace_id.clone()))
                .map_err(|err| ("ERR_MKDIR", err.to_string()))?;
            rename_device_path(serial.clone(), a.clone(), b.clone(), Some(trace_id.clone()))
                .map_err(|err| ("ERR_RENAME", err.to_string()))?;
            delete_device_path(serial.clone(), base.clone(), true, Some(trace_id.clone()))
                .map_err(|err| ("ERR_DELETE", err.to_string()))?;

            Ok((vec![], None, None))
        })
        .is_err()
        {
            status = "fail";
        }

        if run_check(&mut checks, "file_push_pull", || {
            let device_tmp = format!("/sdcard/Download/lazy_blacktea_smoke_{}", Uuid::new_v4());
            let mkdir_args = vec![
                "-s".to_string(),
                serial.clone(),
                "shell".to_string(),
                "mkdir".to_string(),
                "-p".to_string(),
                device_tmp.clone(),
            ];
            let out = run_command_with_timeout(
                &adb_program,
                &mkdir_args,
                Duration::from_secs(10),
                &trace_id,
            )
            .map_err(|err| ("ERR_FILES_MKDIR", err.to_string()))?;
            if out.exit_code.unwrap_or_default() != 0 {
                return Err(("ERR_FILES_MKDIR", out.stderr));
            }

            let host_push = out_dir.join("push.txt");
            fs::write(&host_push, "hello from lazy_blacktea_tauri_backend_smoke\n")
                .map_err(|err| ("ERR_IO", format!("Failed to write push file: {err}")))?;
            let remote_push = format!("{device_tmp}/push.txt");

            let push_args = vec![
                "-s".to_string(),
                serial.clone(),
                "push".to_string(),
                host_push.to_string_lossy().to_string(),
                remote_push.clone(),
            ];
            let out = run_adb(&adb_program, &push_args, &trace_id)
                .map_err(|err| ("ERR_FILES_PUSH", err.to_string()))?;
            if out.exit_code.unwrap_or_default() != 0 {
                return Err(("ERR_FILES_PUSH", out.stderr));
            }

            let host_pull = out_dir.join("pulled.txt");
            let pull_args = vec![
                "-s".to_string(),
                serial.clone(),
                "pull".to_string(),
                remote_push.clone(),
                host_pull.to_string_lossy().to_string(),
            ];
            let out = run_adb(&adb_program, &pull_args, &trace_id)
                .map_err(|err| ("ERR_FILES_PULL", err.to_string()))?;
            if out.exit_code.unwrap_or_default() != 0 {
                return Err(("ERR_FILES_PULL", out.stderr));
            }
            if fs::metadata(&host_pull)
                .map_err(|err| ("ERR_IO", err.to_string()))?
                .len()
                == 0
            {
                return Err(("ERR_FILES_PULL_EMPTY", "Pulled file is empty".to_string()));
            }

            // Cleanup best-effort.
            let rm_args = vec![
                "-s".to_string(),
                serial.clone(),
                "shell".to_string(),
                "rm".to_string(),
                "-rf".to_string(),
                device_tmp.clone(),
            ];
            let _ = run_command_with_timeout(
                &adb_program,
                &rm_args,
                Duration::from_secs(10),
                &trace_id,
            );

            artifacts.insert(
                "file_push".to_string(),
                host_push.to_string_lossy().to_string(),
            );
            artifacts.insert(
                "file_pull".to_string(),
                host_pull.to_string_lossy().to_string(),
            );
            Ok((
                vec![
                    host_push.to_string_lossy().to_string(),
                    host_pull.to_string_lossy().to_string(),
                ],
                None,
                None,
            ))
        })
        .is_err()
        {
            status = "fail";
        }

        if args.with_uiauto
            && run_check(&mut checks, "uiautomator_dump", || {
                let remote = "/sdcard/Download/lazy_blacktea_smoke_window_dump.xml";
                let dump_args = vec![
                    "-s".to_string(),
                    serial.clone(),
                    "shell".to_string(),
                    "uiautomator".to_string(),
                    "dump".to_string(),
                    remote.to_string(),
                ];
                let out = run_command_with_timeout(
                    &adb_program,
                    &dump_args,
                    Duration::from_secs(15),
                    &trace_id,
                )
                .map_err(|err| ("ERR_UIAUTO", err.to_string()))?;
                if out.exit_code.unwrap_or_default() != 0 {
                    return Err(("ERR_UIAUTO", out.stderr));
                }
                let local = out_dir.join("window_dump.xml");
                let pull_args = vec![
                    "-s".to_string(),
                    serial.clone(),
                    "pull".to_string(),
                    remote.to_string(),
                    local.to_string_lossy().to_string(),
                ];
                let out = run_adb(&adb_program, &pull_args, &trace_id)
                    .map_err(|err| ("ERR_UIAUTO_PULL", err.to_string()))?;
                if out.exit_code.unwrap_or_default() != 0 {
                    return Err(("ERR_UIAUTO_PULL", out.stderr));
                }
                if fs::metadata(&local)
                    .map_err(|err| ("ERR_IO", err.to_string()))?
                    .len()
                    == 0
                {
                    return Err(("ERR_UIAUTO_EMPTY", "UI dump is empty".to_string()));
                }
                artifacts.insert(
                    "uiauto_dump".to_string(),
                    local.to_string_lossy().to_string(),
                );
                Ok((vec![local.to_string_lossy().to_string()], None, None))
            })
            .is_err()
        {
            status = "fail";
        }
    } else {
        checks.push(SmokeCheck {
            name: "file_ops_mkdir_rename_delete",
            status: "skip",
            duration_ms: 0,
            artifacts: vec![],
            error_code: None,
            error: None,
        });
        checks.push(SmokeCheck {
            name: "file_push_pull",
            status: "skip",
            duration_ms: 0,
            artifacts: vec![],
            error_code: None,
            error: None,
        });
        checks.push(SmokeCheck {
            name: "uiautomator_dump",
            status: "skip",
            duration_ms: 0,
            artifacts: vec![],
            error_code: None,
            error: None,
        });
    }

    if args.with_ui_inspector {
        if run_check(&mut checks, "ui_inspector_export", || {
            let resp = export_ui_hierarchy(
                serial.clone(),
                Some(out_dir.to_string_lossy().to_string()),
                Some(trace_id.clone()),
            )
            .map_err(|err| ("ERR_UI_EXPORT", err.to_string()))?;
            let path = out_dir.join("ui_export.json");
            let body = serde_json::to_string_pretty(&resp.data)
                .map_err(|err| ("ERR_IO", format!("Failed to serialize ui export: {err}")))?;
            fs::write(&path, body)
                .map_err(|err| ("ERR_IO", format!("Failed to write ui export: {err}")))?;
            artifacts.insert("ui_export".to_string(), path.to_string_lossy().to_string());
            Ok((vec![path.to_string_lossy().to_string()], None, None))
        })
        .is_err()
        {
            status = "fail";
        }
    } else {
        checks.push(SmokeCheck {
            name: "ui_inspector_export",
            status: "skip",
            duration_ms: 0,
            artifacts: vec![],
            error_code: None,
            error: None,
        });
    }

    if let Some(apk_path) = args.apk_path.clone() {
        if run_check(&mut checks, "apk_install", || {
            let result = smoke_install_apk_batch(
                vec![serial.clone()],
                apk_path,
                args.apk_replace,
                args.apk_allow_downgrade,
                args.apk_grant,
                args.apk_allow_test,
                args.apk_extra_args.clone(),
                &app_state,
                &trace_id,
            )
            .map_err(|err| ("ERR_APK_INSTALL", err.to_string()))?;

            let path = out_dir.join("apk_install_result.json");
            let body = serde_json::to_string_pretty(&result).map_err(|err| {
                (
                    "ERR_IO",
                    format!("Failed to serialize apk install result: {err}"),
                )
            })?;
            fs::write(&path, body).map_err(|err| {
                (
                    "ERR_IO",
                    format!("Failed to write apk install result: {err}"),
                )
            })?;
            artifacts.insert(
                "apk_install_result".to_string(),
                path.to_string_lossy().to_string(),
            );

            let ok = result.results.values().all(|r| r.success);
            if ok {
                Ok((vec![path.to_string_lossy().to_string()], None, None))
            } else {
                Err((
                    "ERR_APK_INSTALL_FAILED",
                    "One or more devices reported APK install failure.".to_string(),
                ))
            }
        })
        .is_err()
        {
            status = "fail";
        }

        if args.apk_launch {
            if run_check(&mut checks, "apk_launch", || {
                let candidate = args
                    .apk_package
                    .clone()
                    .or_else(|| {
                        // Best-effort: read back package name from previous result artifact.
                        let p = out_dir.join("apk_install_result.json");
                        let body = fs::read_to_string(&p).ok()?;
                        let parsed: lazy_blacktea_rust_lib::app::models::ApkBatchInstallResult =
                            serde_json::from_str(&body).ok()?;
                        parsed.apk_info.and_then(|info| info.package_name)
                    })
                    .unwrap_or_default();

                if !is_valid_package_name(&candidate) {
                    let note_path = out_dir.join("apk_launch_skipped.txt");
                    fs::write(
                        &note_path,
                        "APK launch skipped: package name not available or invalid.\nProvide --apk-package (e.g. com.example.app) to enable launch.\n",
                    )
                    .map_err(|err| ("ERR_IO", format!("Failed to write launch note: {err}")))?;
                    artifacts.insert(
                        "apk_launch_note".to_string(),
                        note_path.to_string_lossy().to_string(),
                    );
                    return Ok((
                        vec![note_path.to_string_lossy().to_string()],
                        Some("WARN_APK_PACKAGE"),
                        Some("Package name not available or invalid; launch skipped.".to_string()),
                    ));
                }

                let results =
                    smoke_launch_app(vec![serial.clone()], candidate, &app_state, &trace_id)
                        .map_err(|err| ("ERR_APK_LAUNCH", err.to_string()))?;
                let path = out_dir.join("apk_launch.json");
                let body = serde_json::to_string_pretty(&results).map_err(|err| {
                    (
                        "ERR_IO",
                        format!("Failed to serialize launch result: {err}"),
                    )
                })?;
                fs::write(&path, body)
                    .map_err(|err| ("ERR_IO", format!("Failed to write launch result: {err}")))?;
                artifacts.insert("apk_launch".to_string(), path.to_string_lossy().to_string());

                let ok = results.iter().all(|r| r.exit_code.unwrap_or(1) == 0);
                if ok {
                    Ok((vec![path.to_string_lossy().to_string()], None, None))
                } else {
                    Err((
                        "ERR_APK_LAUNCH_FAILED",
                        "Launch returned non-zero exit code.".to_string(),
                    ))
                }
            })
            .is_err()
            {
                status = "fail";
            }
        } else {
            checks.push(SmokeCheck {
                name: "apk_launch",
                status: "skip",
                duration_ms: 0,
                artifacts: vec![],
                error_code: None,
                error: None,
            });
        }
    } else {
        checks.push(SmokeCheck {
            name: "apk_install",
            status: "skip",
            duration_ms: 0,
            artifacts: vec![],
            error_code: None,
            error: None,
        });
        checks.push(SmokeCheck {
            name: "apk_launch",
            status: "skip",
            duration_ms: 0,
            artifacts: vec![],
            error_code: None,
            error: None,
        });
    }

    let summary = SmokeSummary {
        tool: "lazy_blacktea_tauri_backend_smoke",
        status,
        trace_id: trace_id.clone(),
        serial: Some(serial),
        adb_program: Some(adb_program),
        out_dir: out_dir.to_string_lossy().to_string(),
        artifacts,
        checks,
    };

    let output = if args.json {
        serde_json::to_string_pretty(&summary).unwrap_or_else(|_| "{}".to_string())
    } else {
        format!(
            "status: {}\ntrace_id: {}\nout: {}\n",
            summary.status, summary.trace_id, summary.out_dir
        )
    };

    println!("{output}");
    if summary.status != "pass" {
        std::process::exit(1);
    }
}
