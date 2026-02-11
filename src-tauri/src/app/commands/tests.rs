use super::*;

use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .expect("env lock")
}

fn spawn_long_running_piped_child() -> std::process::Child {
    if cfg!(windows) {
        Command::new("cmd.exe")
            .args(["/C", "ping", "127.0.0.1", "-n", "30"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn ping")
    } else {
        Command::new("sh")
            .args(["-c", "sleep 30"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sleep")
    }
}

fn spawn_perf_stop_waiter(stop_flag: Arc<AtomicBool>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        while !stop_flag.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(10));
        }
    })
}

#[test]
fn start_logcat_inner_rejects_empty_serial() {
    let registry = Mutex::new(std::collections::HashMap::<String, LogcatHandle>::new());
    let emitter: Arc<dyn Fn(LogcatEvent) + Send + Sync> = Arc::new(|_evt| {});

    let err = start_logcat_inner(
        " ".to_string(),
        None,
        "adb",
        &registry,
        emitter,
        "trace-1",
        |_program, _serial, _filter, _trace| Ok(spawn_long_running_piped_child()),
    )
    .expect_err("expected error");

    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-1");
}

#[test]
fn start_perf_monitor_inner_rejects_empty_serial() {
    let registry = Mutex::new(std::collections::HashMap::<String, PerfMonitorHandle>::new());
    let err = start_perf_monitor_inner(" ".to_string(), &registry, "trace-perf-1", |_stop| {
        panic!("spawn should not be called");
    })
    .expect_err("expected error");

    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-perf-1");
}

#[test]
fn start_net_profiler_inner_rejects_empty_serial() {
    let registry = Mutex::new(std::collections::HashMap::<String, NetProfilerHandle>::new());
    let err = start_net_profiler_inner(
        " ".to_string(),
        &registry,
        "trace-net-1",
        vec![],
        |_stop, _pinned| {
            panic!("spawn should not be called");
        },
    )
    .expect_err("expected error");

    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-net-1");
}

#[test]
fn start_perf_monitor_inner_rejects_when_already_running() {
    let registry = Mutex::new(std::collections::HashMap::<String, PerfMonitorHandle>::new());

    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            PerfMonitorHandle {
                stop_flag: Arc::new(AtomicBool::new(false)),
                join: std::thread::spawn(|| {}),
            },
        );
    }

    let err = start_perf_monitor_inner("ABC".to_string(), &registry, "trace-perf-2", |_stop| {
        std::thread::spawn(|| {})
    })
    .expect_err("expected already running");

    assert_eq!(err.code, "ERR_VALIDATION");
    assert!(err.error.to_lowercase().contains("already running"));

    stop_perf_monitor_inner("ABC".to_string(), &registry, "trace-perf-2-stop").expect("stop ok");
}

#[test]
fn start_net_profiler_inner_rejects_when_already_running() {
    let registry = Mutex::new(std::collections::HashMap::<String, NetProfilerHandle>::new());

    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            NetProfilerHandle {
                stop_flag: Arc::new(AtomicBool::new(false)),
                pinned_uids: Arc::new(RwLock::new(vec![])),
                join: std::thread::spawn(|| {}),
            },
        );
    }

    let err = start_net_profiler_inner(
        "ABC".to_string(),
        &registry,
        "trace-net-2",
        vec![],
        |_stop, _pinned| std::thread::spawn(|| {}),
    )
    .expect_err("expected already running");

    assert_eq!(err.code, "ERR_VALIDATION");
    assert!(err.error.to_lowercase().contains("already running"));

    stop_net_profiler_inner("ABC".to_string(), &registry, "trace-net-2-stop").expect("stop ok");
}

#[test]
fn stop_perf_monitor_inner_errors_when_not_running() {
    let registry = Mutex::new(std::collections::HashMap::<String, PerfMonitorHandle>::new());
    let err =
        stop_perf_monitor_inner("ABC".to_string(), &registry, "trace-perf-3").expect_err("err");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert!(err.error.to_lowercase().contains("not running"));
}

#[test]
fn stop_net_profiler_inner_errors_when_not_running() {
    let registry = Mutex::new(std::collections::HashMap::<String, NetProfilerHandle>::new());
    let err =
        stop_net_profiler_inner("ABC".to_string(), &registry, "trace-net-3").expect_err("err");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert!(err.error.to_lowercase().contains("not running"));
}

#[test]
fn stop_perf_monitor_inner_stops_and_removes_handle() {
    let registry = Mutex::new(std::collections::HashMap::<String, PerfMonitorHandle>::new());
    let stop_flag = Arc::new(AtomicBool::new(false));
    let join = spawn_perf_stop_waiter(Arc::clone(&stop_flag));

    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            PerfMonitorHandle {
                stop_flag: Arc::clone(&stop_flag),
                join,
            },
        );
    }

    stop_perf_monitor_inner("ABC".to_string(), &registry, "trace-perf-4").expect("stop ok");
    assert!(stop_flag.load(Ordering::Relaxed));

    let guard = registry.lock().expect("registry");
    assert!(!guard.contains_key("ABC"));
}

#[test]
fn stop_net_profiler_inner_stops_and_removes_handle() {
    let registry = Mutex::new(std::collections::HashMap::<String, NetProfilerHandle>::new());
    let stop_flag = Arc::new(AtomicBool::new(false));
    let join = spawn_perf_stop_waiter(Arc::clone(&stop_flag));

    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            NetProfilerHandle {
                stop_flag: Arc::clone(&stop_flag),
                pinned_uids: Arc::new(RwLock::new(vec![])),
                join,
            },
        );
    }

    stop_net_profiler_inner("ABC".to_string(), &registry, "trace-net-4").expect("stop ok");
    assert!(stop_flag.load(Ordering::Relaxed));

    let guard = registry.lock().expect("registry");
    assert!(!guard.contains_key("ABC"));
}

#[test]
fn set_net_profiler_pinned_uids_inner_rejects_empty_serial() {
    let registry = Mutex::new(std::collections::HashMap::<String, NetProfilerHandle>::new());
    let err = set_net_profiler_pinned_uids_inner(
        " ".to_string(),
        Some(vec![123]),
        &registry,
        "trace-net-pin-1",
    )
    .expect_err("expected validation error");

    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-net-pin-1");
}

#[test]
fn set_net_profiler_pinned_uids_inner_errors_when_not_running() {
    let registry = Mutex::new(std::collections::HashMap::<String, NetProfilerHandle>::new());
    let err = set_net_profiler_pinned_uids_inner(
        "ABC".to_string(),
        Some(vec![123]),
        &registry,
        "trace-net-pin-2",
    )
    .expect_err("expected not running error");

    assert_eq!(err.code, "ERR_VALIDATION");
    assert!(err.error.to_lowercase().contains("not running"));
}

#[test]
fn set_net_profiler_pinned_uids_inner_updates_handle() {
    let registry = Mutex::new(std::collections::HashMap::<String, NetProfilerHandle>::new());
    let stop_flag = Arc::new(AtomicBool::new(false));
    let pinned = Arc::new(RwLock::new(vec![]));

    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            NetProfilerHandle {
                stop_flag,
                pinned_uids: Arc::clone(&pinned),
                join: std::thread::spawn(|| {}),
            },
        );
    }

    set_net_profiler_pinned_uids_inner(
        "ABC".to_string(),
        Some(vec![200, 200, 201]),
        &registry,
        "trace-net-pin-3",
    )
    .expect("set pinned ok");

    let values = pinned.read().expect("read pinned");
    assert_eq!(*values, vec![200, 201]);
}

#[test]
fn set_net_profiler_pinned_uids_inner_rejects_too_many() {
    let registry = Mutex::new(std::collections::HashMap::<String, NetProfilerHandle>::new());
    let stop_flag = Arc::new(AtomicBool::new(false));
    let pinned = Arc::new(RwLock::new(vec![]));

    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            NetProfilerHandle {
                stop_flag,
                pinned_uids: Arc::clone(&pinned),
                join: std::thread::spawn(|| {}),
            },
        );
    }

    let err = set_net_profiler_pinned_uids_inner(
        "ABC".to_string(),
        Some(vec![1, 2, 3, 4, 5, 6]),
        &registry,
        "trace-net-pin-4",
    )
    .expect_err("expected too many");

    assert_eq!(err.code, "ERR_VALIDATION");
}

#[test]
fn start_logcat_inner_rejects_when_already_running() {
    let registry = Mutex::new(std::collections::HashMap::<String, LogcatHandle>::new());
    let emitter: Arc<dyn Fn(LogcatEvent) + Send + Sync> = Arc::new(|_evt| {});

    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            LogcatHandle {
                child: spawn_long_running_piped_child(),
                stop_flag: Arc::new(AtomicBool::new(false)),
            },
        );
    }

    let err = start_logcat_inner(
        "ABC".to_string(),
        None,
        "adb",
        &registry,
        emitter,
        "trace-2",
        |_program, _serial, _filter, _trace| Ok(spawn_long_running_piped_child()),
    )
    .expect_err("expected already running");

    assert_eq!(err.code, "ERR_VALIDATION");
    assert!(err.error.to_lowercase().contains("already running"));
}

#[test]
fn stop_logcat_inner_errors_when_not_running() {
    let registry = Mutex::new(std::collections::HashMap::<String, LogcatHandle>::new());
    let err = stop_logcat_inner("ABC".to_string(), &registry, "trace-3").expect_err("expected err");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert!(err.error.to_lowercase().contains("not running"));
}

#[test]
fn stop_logcat_inner_removes_handle() {
    let registry = Mutex::new(std::collections::HashMap::<String, LogcatHandle>::new());
    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            LogcatHandle {
                child: spawn_long_running_piped_child(),
                stop_flag: Arc::new(AtomicBool::new(false)),
            },
        );
    }

    stop_logcat_inner("ABC".to_string(), &registry, "trace-4").expect("stop ok");

    let guard = registry.lock().expect("registry");
    assert!(!guard.contains_key("ABC"));
}

#[test]
fn reserve_bugreport_handle_rejects_duplicate() {
    let state = AppState::new();
    let (cancel, child) = reserve_bugreport_handle("ABC", &state, "trace-5").expect("reserve");
    assert!(!cancel.load(std::sync::atomic::Ordering::Relaxed));
    assert!(child.lock().expect("lock").is_none());

    let err = reserve_bugreport_handle("ABC", &state, "trace-6").expect_err("expected duplicate");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert!(err.error.to_lowercase().contains("already running"));
}

#[test]
fn validate_generate_bugreport_inputs_rejects_empty_output_dir() {
    let err = validate_generate_bugreport_inputs("ABC", "  ", "trace-7").expect_err("err");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-7");
    assert!(err.error.to_lowercase().contains("output_dir"));
}

#[test]
fn prepare_bugreport_logcat_inner_rejects_empty_path() {
    let err = prepare_bugreport_logcat_inner(" ", "trace-8").expect_err("err");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-8");
}

#[test]
fn prepare_bugreport_logcat_inner_errors_for_missing_file() {
    let err = prepare_bugreport_logcat_inner("/this/path/does/not/exist/bugreport.zip", "trace-9")
        .expect_err("err");
    assert_eq!(err.code, "ERR_SYSTEM");
    assert_eq!(err.trace_id, "trace-9");
}

#[test]
fn search_bugreport_logcat_inner_rejects_empty_query() {
    let err = search_bugreport_logcat_inner(
        "report",
        "   ",
        BugreportLogFilters::default(),
        0,
        "trace-9a",
    )
    .expect_err("err");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-9a");
}

#[test]
fn query_bugreport_logcat_around_inner_rejects_non_positive_anchor_id() {
    let err = query_bugreport_logcat_around_inner(
        "report",
        0,
        10,
        10,
        BugreportLogFilters::default(),
        "trace-9b",
    )
    .expect_err("err");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-9b");
}

#[test]
fn install_apk_batch_inner_returns_invalid_apk_result_without_running_adb() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    let config_path = tmp.path().join("config.json");
    std::env::set_var("LAZY_BLACKTEA_CONFIG_PATH", &config_path);

    let state = AppState::new();
    let result = install_apk_batch_inner(
        vec!["A".to_string(), "B".to_string()],
        tmp.path().join("missing.apk").to_string_lossy().to_string(),
        true,
        false,
        false,
        false,
        None,
        &state,
        "trace-10",
        None,
    )
    .expect("result");

    assert_eq!(result.results.len(), 2);
    assert_eq!(
        result.results.get("A").unwrap().error_code,
        ApkInstallErrorCode::InstallFailedInvalidApk
    );
    assert_eq!(
        result.results.get("B").unwrap().error_code,
        ApkInstallErrorCode::InstallFailedInvalidApk
    );

    std::env::remove_var("LAZY_BLACKTEA_CONFIG_PATH");
}

#[test]
fn load_device_detail_bails_early_when_getprop_fails() {
    let trace_id = "trace-load-device-detail-1";
    let serial = "SERIAL-1";
    let mut called_steps: Vec<&'static str> = Vec::new();

    let run = |_args: &[String],
               _timeout: Duration,
               step: &'static str|
     -> Result<crate::app::adb::runner::CommandOutput, AppError> {
        called_steps.push(step);
        if step == "getprop" {
            return Err(AppError::system("Command timed out".to_string(), trace_id));
        }
        panic!("expected load_device_detail to bail after getprop failure");
    };

    let detail = load_device_detail(serial, trace_id, false, 0, run);
    assert!(detail.is_none());
    assert_eq!(called_steps, vec!["getprop"]);
}

#[test]
fn load_device_detail_continues_when_non_getprop_steps_fail() {
    let trace_id = "trace-load-device-detail-2";
    let serial = "SERIAL-2";
    let mut called_steps: Vec<&'static str> = Vec::new();

    let run = |_args: &[String],
               _timeout: Duration,
               step: &'static str|
     -> Result<crate::app::adb::runner::CommandOutput, AppError> {
        called_steps.push(step);

        let ok = |stdout: &str| crate::app::adb::runner::CommandOutput {
            stdout: stdout.to_string(),
            stderr: String::new(),
            exit_code: Some(0),
        };

        match step {
            "getprop" => Ok(ok("")),
            "battery" => Ok(ok("level: 50\n")),
            "wifi" => Ok(ok("1\n")),
            "bluetooth" => Ok(ok("0\n")),
            "bluetooth_manager_state" => Ok(ok("state: ON\n")),
            "audio" => Ok(ok("mode: NORMAL\n")),
            "gms" => Err(AppError::dependency("gms fails".to_string(), trace_id)),
            "wm_size" => Ok(ok("Physical size: 1080x2400\n")),
            "df" => Ok(ok(
                "Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-0 1000 0 0 0% /data\n",
            )),
            "meminfo" => Ok(ok("MemTotal: 2048 kB\n")),
            other => panic!("unexpected step {other}"),
        }
    };

    let detail = load_device_detail(serial, trace_id, false, 0, run);
    assert!(detail.is_some());
    assert_eq!(
        called_steps,
        vec![
            "getprop",
            "battery",
            "wifi",
            "bluetooth",
            "bluetooth_manager_state",
            "audio",
            "gms",
            "wm_size",
            "df",
            "meminfo"
        ]
    );
}
