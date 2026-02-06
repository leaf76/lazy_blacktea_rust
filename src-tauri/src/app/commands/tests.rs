use super::*;

use std::process::{Command, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

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
    let err =
        prepare_bugreport_logcat_inner("/this/path/does/not/exist/bugreport.zip", "trace-9")
            .expect_err("err");
    assert_eq!(err.code, "ERR_SYSTEM");
    assert_eq!(err.trace_id, "trace-9");
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
