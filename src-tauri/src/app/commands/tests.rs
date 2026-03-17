use super::*;
use crate::app::models::BugreportExtractTemplateKind;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|err| err.into_inner())
}

fn valid_test_png_bytes() -> Vec<u8> {
    STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")
        .expect("valid png")
}

fn valid_test_ui_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hierarchy rotation="0">
  <node
    index="0"
    text=""
    resource-id=""
    class="android.widget.FrameLayout"
    package="com.example.app"
    content-desc=""
    checkable="false"
    checked="false"
    clickable="false"
    enabled="true"
    focusable="false"
    focused="false"
    scrollable="false"
    long-clickable="false"
    password="false"
    selected="false"
    bounds="[0,0][100,100]" />
</hierarchy>
"#
}

fn truncated_test_ui_xml() -> String {
    valid_test_ui_xml()
        .trim_end()
        .trim_end_matches("</hierarchy>")
        .trim_end()
        .to_string()
}

fn write_fake_adb_script(path: &std::path::Path) {
    let body = if cfg!(windows) {
        r#"@echo off
setlocal enableextensions
if "%~1"=="-s" (
  shift
  shift
)
if "%~1"=="exec-out" if "%~2"=="uiautomator" (
  if "%FAKE_ADB_XML_MODE%"=="exec_truncated_pull_ok" (
    type "%FAKE_ADB_UI_XML_TRUNCATED%"
    exit /b 0
  )
  if "%FAKE_ADB_XML_MODE%"=="exec_fail_download_only" (
    echo exec dump failed 1>&2
    exit /b 1
  )
  if "%FAKE_ADB_XML_MODE%"=="exec_fail_pull_ok" (
    echo exec dump failed 1>&2
    exit /b 1
  )
  if "%FAKE_ADB_XML_MODE%"=="all_fail" (
    type "%FAKE_ADB_UI_XML_TRUNCATED%"
    exit /b 0
  )
  type "%FAKE_ADB_UI_XML_VALID%"
  exit /b 0
)
if "%~1"=="exec-out" if "%~2"=="screencap" (
  if "%FAKE_ADB_MODE%"=="exec_ok_pull_fail" (
    type "%FAKE_ADB_VALID_PNG%"
    exit /b 0
  )
  if "%FAKE_ADB_MODE%"=="exec_fail_pull_ok" (
    echo exec screencap failed 1>&2
    exit /b 1
  )
  if "%FAKE_ADB_MODE%"=="all_fail" (
    echo exec screencap failed 1>&2
    exit /b 1
  )
  <nul set /p=not-a-png
  exit /b 0
)
if "%~1"=="shell" if "%~2"=="screencap" (
  for %%I in ("%~4") do set "REMOTE_NAME=%%~nxI"
  if "%FAKE_ADB_MODE%"=="exec_corrupt_pull_ok" (
    copy /Y "%FAKE_ADB_VALID_PNG%" "%FAKE_ADB_REMOTE_ROOT%\%REMOTE_NAME%" >nul
    exit /b 0
  )
  if "%FAKE_ADB_MODE%"=="exec_fail_pull_ok" (
    copy /Y "%FAKE_ADB_VALID_PNG%" "%FAKE_ADB_REMOTE_ROOT%\%REMOTE_NAME%" >nul
    exit /b 0
  )
  echo capture failed 1>&2
  exit /b 1
)
if "%~1"=="shell" if "%~2"=="uiautomator" (
  for %%I in ("%~4") do set "REMOTE_NAME=%%~nxI"
  if "%FAKE_ADB_XML_MODE%"=="exec_ok_pull_fail" (
    echo dump should not pull 1>&2
    exit /b 1
  )
  if "%FAKE_ADB_XML_MODE%"=="exec_fail_download_only" (
    echo "%~4" | findstr /B /C:"/sdcard/Download/" >nul
    if errorlevel 1 (
      echo dump path blocked 1>&2
      exit /b 1
    )
    copy /Y "%FAKE_ADB_UI_XML_VALID%" "%FAKE_ADB_REMOTE_ROOT%\%REMOTE_NAME%" >nul
    exit /b 0
  )
  if "%FAKE_ADB_XML_MODE%"=="exec_fail_pull_ok" (
    echo dump failed 1>&2
    exit /b 1
  )
  if "%FAKE_ADB_XML_MODE%"=="all_fail" (
    echo dump failed 1>&2
    exit /b 1
  )
  copy /Y "%FAKE_ADB_UI_XML_VALID%" "%FAKE_ADB_REMOTE_ROOT%\%REMOTE_NAME%" >nul
  exit /b 0
)
if "%~1"=="pull" (
  for %%I in ("%~2") do set "REMOTE_NAME=%%~nxI"
  copy /Y "%FAKE_ADB_REMOTE_ROOT%\%REMOTE_NAME%" "%~3" >nul
  exit /b 0
)
if "%~1"=="shell" if "%~2"=="rm" (
  for %%I in ("%~4") do del /Q "%FAKE_ADB_REMOTE_ROOT%\%%~nxI" >nul 2>nul
  exit /b 0
)
echo unexpected args %* 1>&2
exit /b 1
"#
    } else {
        r#"#!/bin/sh
set -eu

if [ "${1:-}" = "-s" ]; then
  shift
  shift
fi

remote_name() {
  basename "$1"
}

if [ "${1:-}" = "exec-out" ] && [ "${2:-}" = "uiautomator" ]; then
  case "${FAKE_ADB_XML_MODE:-valid}" in
    exec_truncated_pull_ok|all_fail)
      cat "$FAKE_ADB_UI_XML_TRUNCATED"
      ;;
    exec_fail_download_only|exec_fail_pull_ok)
      echo "exec dump failed" >&2
      exit 1
      ;;
    *)
      cat "$FAKE_ADB_UI_XML_VALID"
      ;;
  esac
  exit 0
fi

if [ "${1:-}" = "exec-out" ] && [ "${2:-}" = "screencap" ]; then
  case "${FAKE_ADB_MODE:-}" in
    exec_ok_pull_fail)
      cat "$FAKE_ADB_VALID_PNG"
      exit 0
      ;;
    exec_fail_pull_ok|all_fail)
      echo "exec screencap failed" >&2
      exit 1
      ;;
    *)
      printf 'not-a-png'
      exit 0
      ;;
  esac
fi

if [ "${1:-}" = "shell" ] && [ "${2:-}" = "screencap" ]; then
  case "${FAKE_ADB_MODE:-}" in
    exec_corrupt_pull_ok|exec_fail_pull_ok)
      cp "$FAKE_ADB_VALID_PNG" "$FAKE_ADB_REMOTE_ROOT/$(remote_name "${4:-}")"
      exit 0
      ;;
    *)
      echo "capture failed" >&2
      exit 1
      ;;
  esac
fi

if [ "${1:-}" = "shell" ] && [ "${2:-}" = "uiautomator" ]; then
  case "${FAKE_ADB_XML_MODE:-valid}" in
    exec_ok_pull_fail)
      echo "dump should not pull" >&2
      exit 1
      ;;
    exec_fail_download_only)
      case "${4:-}" in
        /sdcard/Download/*)
          cp "$FAKE_ADB_UI_XML_VALID" "$FAKE_ADB_REMOTE_ROOT/$(remote_name "${4:-}")"
          exit 0
          ;;
        *)
          echo "dump path blocked" >&2
          exit 1
          ;;
      esac
      ;;
    exec_fail_pull_ok|all_fail)
      echo "dump failed" >&2
      exit 1
      ;;
    *)
      cp "$FAKE_ADB_UI_XML_VALID" "$FAKE_ADB_REMOTE_ROOT/$(remote_name "${4:-}")"
      exit 0
      ;;
  esac
fi

if [ "${1:-}" = "pull" ]; then
  cp "$FAKE_ADB_REMOTE_ROOT/$(remote_name "${2:-}")" "${3:-}"
  exit 0
fi

if [ "${1:-}" = "shell" ] && [ "${2:-}" = "rm" ]; then
  rm -f "$FAKE_ADB_REMOTE_ROOT/$(remote_name "${4:-}")"
  exit 0
fi

echo "unexpected args: $*" >&2
exit 1
"#
    };

    std::fs::write(path, body).expect("write fake adb");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut perms = std::fs::metadata(path).expect("metadata").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).expect("chmod");
    }
}

fn setup_fake_adb(
    tmp: &tempfile::TempDir,
    screenshot_mode: &str,
    xml_mode: &str,
    trace_id: &str,
) -> PathBuf {
    let remote_root = tmp.path().join("remote");
    std::fs::create_dir_all(&remote_root).expect("create remote root");
    let valid_png_path = tmp.path().join("valid.png");
    std::fs::write(&valid_png_path, valid_test_png_bytes()).expect("write png");
    let valid_xml_path = tmp.path().join("hierarchy.xml");
    std::fs::write(&valid_xml_path, valid_test_ui_xml()).expect("write xml");
    let truncated_xml_path = tmp.path().join("hierarchy_truncated.xml");
    std::fs::write(&truncated_xml_path, truncated_test_ui_xml()).expect("write truncated xml");
    let adb_path = tmp.path().join(if cfg!(windows) {
        "fake-adb.cmd"
    } else {
        "fake-adb.sh"
    });
    write_fake_adb_script(&adb_path);

    std::env::set_var("FAKE_ADB_MODE", screenshot_mode);
    std::env::set_var("FAKE_ADB_XML_MODE", xml_mode);
    std::env::set_var("FAKE_ADB_REMOTE_ROOT", &remote_root);
    std::env::set_var("FAKE_ADB_VALID_PNG", &valid_png_path);
    std::env::set_var("FAKE_ADB_UI_XML_VALID", &valid_xml_path);
    std::env::set_var("FAKE_ADB_UI_XML_TRUNCATED", &truncated_xml_path);

    let config_path = tmp.path().join("config.json");
    std::env::set_var("LAZY_BLACKTEA_CONFIG_PATH", &config_path);

    let mut config = AppConfig::default();
    config.adb.command_path = adb_path.to_string_lossy().to_string();
    save_config(&config, trace_id).expect("save config");

    adb_path
}

fn clear_fake_adb_env() {
    std::env::remove_var("FAKE_ADB_MODE");
    std::env::remove_var("FAKE_ADB_XML_MODE");
    std::env::remove_var("FAKE_ADB_REMOTE_ROOT");
    std::env::remove_var("FAKE_ADB_VALID_PNG");
    std::env::remove_var("FAKE_ADB_UI_XML_VALID");
    std::env::remove_var("FAKE_ADB_UI_XML_TRUNCATED");
    std::env::remove_var("LAZY_BLACKTEA_CONFIG_PATH");
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

fn spawn_exited_piped_child() -> std::process::Child {
    if cfg!(windows) {
        Command::new("cmd.exe")
            .args(["/C", "echo", "done"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn echo")
    } else {
        Command::new("sh")
            .args(["-c", "echo done"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn echo")
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
fn start_logcat_inner_is_idempotent_when_already_running() {
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

    let ok = start_logcat_inner(
        "ABC".to_string(),
        None,
        "adb",
        &registry,
        emitter,
        "trace-2",
        |_program, _serial, _filter, _trace| Ok(spawn_long_running_piped_child()),
    )
    .expect("idempotent start should succeed");
    assert!(ok);

    stop_logcat_inner("ABC".to_string(), &registry, "trace-2-stop").expect("cleanup stop");
}

#[test]
fn start_logcat_inner_cleans_stale_handle_and_restarts() {
    let registry = Mutex::new(std::collections::HashMap::<String, LogcatHandle>::new());
    let emitter: Arc<dyn Fn(LogcatEvent) + Send + Sync> = Arc::new(|_evt| {});

    let mut exited_child = spawn_exited_piped_child();
    let _ = exited_child.wait();
    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            LogcatHandle {
                child: exited_child,
                stop_flag: Arc::new(AtomicBool::new(false)),
            },
        );
    }

    let ok = start_logcat_inner(
        "ABC".to_string(),
        None,
        "adb",
        &registry,
        emitter,
        "trace-2b",
        |_program, _serial, _filter, _trace| Ok(spawn_long_running_piped_child()),
    )
    .expect("stale handle should be replaced");
    assert!(ok);

    stop_logcat_inner("ABC".to_string(), &registry, "trace-2b-stop").expect("cleanup stop");
}

#[test]
fn stop_logcat_inner_is_idempotent_when_not_running() {
    let registry = Mutex::new(std::collections::HashMap::<String, LogcatHandle>::new());
    let ok = stop_logcat_inner("ABC".to_string(), &registry, "trace-3")
        .expect("idempotent stop should succeed");
    assert!(ok);
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
fn get_logcat_status_inner_reports_not_running_for_missing_handle() {
    let registry = Mutex::new(std::collections::HashMap::<String, LogcatHandle>::new());
    let status = get_logcat_status_inner("ABC".to_string(), &registry, "trace-logcat-status-1")
        .expect("status");
    assert_eq!(status.serial, "ABC");
    assert!(!status.running);
}

#[test]
fn get_logcat_status_inner_reports_running_for_active_handle() {
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
    let status = get_logcat_status_inner("ABC".to_string(), &registry, "trace-logcat-status-2")
        .expect("status");
    assert!(status.running);

    stop_logcat_inner("ABC".to_string(), &registry, "trace-logcat-status-2-stop")
        .expect("cleanup stop");
}

#[test]
fn get_logcat_status_inner_cleans_stale_handle() {
    let registry = Mutex::new(std::collections::HashMap::<String, LogcatHandle>::new());
    let mut exited_child = spawn_exited_piped_child();
    let _ = exited_child.wait();
    {
        let mut guard = registry.lock().expect("registry");
        guard.insert(
            "ABC".to_string(),
            LogcatHandle {
                child: exited_child,
                stop_flag: Arc::new(AtomicBool::new(false)),
            },
        );
    }

    let status = get_logcat_status_inner("ABC".to_string(), &registry, "trace-logcat-status-3")
        .expect("status");
    assert!(!status.running);
    let guard = registry.lock().expect("registry");
    assert!(!guard.contains_key("ABC"));
}

#[test]
fn parse_legacy_logcat_preset_json_reads_filters() {
    let raw = r#"{
        "name": "Crash Watch",
        "filters": [" ActivityManager ", "", "AndroidRuntime", "ActivityManager"]
    }"#;

    let preset = parse_legacy_logcat_preset_json(raw).expect("preset");
    assert_eq!(preset.name, "Crash Watch");
    assert_eq!(preset.include, vec!["ActivityManager", "AndroidRuntime"]);
    assert!(preset.exclude.is_empty());
}

#[test]
fn parse_legacy_logcat_preset_json_rejects_empty_payload() {
    let raw = r#"{
        "name": "   ",
        "filters": ["ActivityManager"]
    }"#;
    assert!(parse_legacy_logcat_preset_json(raw).is_none());

    let raw_no_filters = r#"{
        "name": "Valid Name",
        "filters": []
    }"#;
    assert!(parse_legacy_logcat_preset_json(raw_no_filters).is_none());
}

#[test]
fn parse_legacy_logcat_filters_json_reads_value_map() {
    let raw = r#"{
        "f1": " Bluetooth ",
        "f2": "",
        "f3": "AudioFlinger",
        "f4": "Bluetooth",
        "f5": 123
    }"#;

    let preset = parse_legacy_logcat_filters_json(raw, "Migrated Filters").expect("preset");
    assert_eq!(preset.name, "Migrated Filters");
    assert_eq!(preset.include, vec!["Bluetooth", "AudioFlinger"]);
    assert!(preset.exclude.is_empty());
}

#[test]
fn load_legacy_logcat_presets_from_home_reads_files_and_legacy_map() {
    let tmp = tempfile::TempDir::new().expect("tmp");
    let home = tmp.path();
    let preset_dir = home.join(".lazy_blacktea").join("presets");
    std::fs::create_dir_all(&preset_dir).expect("create preset dir");

    std::fs::write(
        preset_dir.join("a.json"),
        r#"{
            "name": "Crash",
            "filters": ["ActivityManager", "AndroidRuntime"]
        }"#,
    )
    .expect("write a");
    std::fs::write(
        preset_dir.join("b.json"),
        r#"{
            "name": "Bluetooth",
            "filters": ["BluetoothAdapter"]
        }"#,
    )
    .expect("write b");
    std::fs::write(
        preset_dir.join("invalid.json"),
        r#"{"name":"broken","filters":"bad"}"#,
    )
    .expect("write invalid");
    std::fs::write(
        home.join(".lazy_blacktea_filters.json"),
        r#"{"legacy1":"BatteryStats","legacy2":"BluetoothAdapter"}"#,
    )
    .expect("write legacy map");

    let presets = load_legacy_logcat_presets_from_home(home, "trace-legacy-1");
    assert_eq!(presets.len(), 3);
    assert_eq!(presets[0].name, "Crash");
    assert_eq!(presets[1].name, "Bluetooth");
    assert_eq!(presets[2].name, "Migrated Filters");
    assert_eq!(presets[2].include, vec!["BatteryStats", "BluetoothAdapter"]);
}

#[test]
fn load_legacy_logcat_presets_from_home_deduplicates_by_name() {
    let tmp = tempfile::TempDir::new().expect("tmp");
    let home = tmp.path();
    let preset_dir = home.join(".lazy_blacktea").join("presets");
    std::fs::create_dir_all(&preset_dir).expect("create preset dir");

    std::fs::write(
        preset_dir.join("a.json"),
        r#"{
            "name": "Crash",
            "filters": ["ActivityManager"]
        }"#,
    )
    .expect("write a");
    std::fs::write(
        preset_dir.join("b.json"),
        r#"{
            "name": "Crash",
            "filters": ["BluetoothAdapter"]
        }"#,
    )
    .expect("write b");

    let presets = load_legacy_logcat_presets_from_home(home, "trace-legacy-2");
    assert_eq!(presets.len(), 1);
    assert_eq!(presets[0].name, "Crash");
    assert_eq!(presets[0].include, vec!["ActivityManager"]);
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
fn build_bugreport_filename_prefers_device_model_and_includes_serial() {
    let filename =
        build_bugreport_filename("emulator-5554", Some("Pixel 8 Pro"), "20260226_120000");
    assert_eq!(
        filename,
        "bugreport_Pixel_8_Pro_emulator-5554_20260226_120000.zip"
    );
}

#[test]
fn build_bugreport_filename_sanitizes_model_and_serial() {
    let filename = build_bugreport_filename(
        "192.168.0.1:5555",
        Some("Galaxy/S24 Ultra"),
        "20260226_120001",
    );
    assert_eq!(
        filename,
        "bugreport_Galaxy_S24_Ultra_192.168.0.1_5555_20260226_120001.zip"
    );
}

#[test]
fn build_bugreport_filename_falls_back_to_serial_when_model_missing() {
    let filename = build_bugreport_filename("ABC:123", Some("   "), "20260226_120002");
    assert_eq!(filename, "bugreport_ABC_123_ABC_123_20260226_120002.zip");
}

#[test]
fn build_bugreport_filename_falls_back_to_serial_when_model_unavailable() {
    let filename = build_bugreport_filename("ABC:123", None, "20260226_120003");
    assert_eq!(filename, "bugreport_ABC_123_ABC_123_20260226_120003.zip");
}

#[test]
fn build_ui_export_bundle_base_name_sanitizes_serial() {
    let base_name = build_ui_export_bundle_base_name("192.168.0.1:5555", "20260226_120004");
    assert_eq!(base_name, "ui_export_192.168.0.1_5555_20260226_120004");
}

#[test]
fn build_ui_export_bundle_base_name_uses_fallback_when_serial_is_empty() {
    let base_name = build_ui_export_bundle_base_name("   ", "20260226_120005");
    assert_eq!(base_name, "ui_export_device_20260226_120005");
}

#[test]
fn resolve_unique_ui_export_bundle_dir_appends_suffix_when_collision_exists() {
    let tmp = tempfile::TempDir::new().expect("tmp");
    let parent = tmp.path();
    let base = "ui_export_emulator-5554_20260226_120006";
    std::fs::create_dir_all(parent.join(base)).expect("create existing dir");
    std::fs::create_dir_all(parent.join(format!("{base}_2"))).expect("create second existing dir");

    let resolved = resolve_unique_ui_export_bundle_dir(parent, base);
    let resolved_name = resolved
        .file_name()
        .and_then(|value| value.to_str())
        .expect("bundle dir name");
    assert_eq!(resolved_name, format!("{base}_3"));
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
fn prepare_bugreport_extract_index_inner_rejects_empty_path() {
    let err = prepare_bugreport_extract_index_inner(" ", "trace-9x").expect_err("err");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-9x");
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
fn query_bugreport_extract_inner_rejects_empty_report_id() {
    let err = query_bugreport_extract_inner(
        " ",
        BugreportExtractQuery {
            kind: BugreportExtractTemplateKind::Keyword,
            input: "bluetooth".to_string(),
            limit: Some(10),
            include_regex: vec![],
            exclude_regex: vec![],
        },
        "trace-9c",
    )
    .expect_err("err");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-9c");
}

#[test]
fn map_bugreport_extract_query_error_maps_validation_prefix() {
    let err =
        map_bugreport_extract_query_error("VALIDATION: invalid regex".to_string(), "trace-9d");
    assert_eq!(err.code, "ERR_VALIDATION");
    assert_eq!(err.trace_id, "trace-9d");
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

#[test]
fn capture_screenshot_prefers_exec_out_when_it_is_valid() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    let output_dir = tmp.path().join("out");
    std::fs::create_dir_all(&output_dir).expect("create output");
    setup_fake_adb(
        &tmp,
        "exec_ok_pull_fail",
        "exec_ok_pull_fail",
        "trace-screenshot-exec-primary",
    );

    let response = capture_screenshot(
        "SERIAL-1".to_string(),
        output_dir.to_string_lossy().to_string(),
        Some("trace-screenshot-exec-primary".to_string()),
    )
    .expect("capture screenshot");

    let bytes = std::fs::read(&response.data).expect("read screenshot");
    crate::app::ui_capture::png_bytes_to_data_url(&bytes).expect("valid png");

    clear_fake_adb_env();
}

#[test]
fn capture_screenshot_falls_back_to_pull_when_exec_out_is_invalid() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    let output_dir = tmp.path().join("out");
    std::fs::create_dir_all(&output_dir).expect("create output");
    setup_fake_adb(
        &tmp,
        "exec_corrupt_pull_ok",
        "exec_ok_pull_fail",
        "trace-screenshot-pull-fallback",
    );

    let response = capture_screenshot(
        "SERIAL-2".to_string(),
        output_dir.to_string_lossy().to_string(),
        Some("trace-screenshot-pull-fallback".to_string()),
    )
    .expect("capture screenshot");

    let bytes = std::fs::read(&response.data).expect("read screenshot");
    crate::app::ui_capture::png_bytes_to_data_url(&bytes).expect("valid png");

    clear_fake_adb_env();
}

#[test]
fn export_ui_hierarchy_prefers_pull_path_for_screenshot_file() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    let output_dir = tmp.path().join("export");
    std::fs::create_dir_all(&output_dir).expect("create output");
    setup_fake_adb(
        &tmp,
        "exec_corrupt_pull_ok",
        "exec_ok_pull_fail",
        "trace-export-screenshot-pull-fallback",
    );

    let response = export_ui_hierarchy(
        "SERIAL-3".to_string(),
        Some(output_dir.to_string_lossy().to_string()),
        Some("trace-export-screenshot-pull-fallback".to_string()),
    )
    .expect("export ui hierarchy");

    let screenshot = std::fs::read(&response.data.screenshot_path).expect("read screenshot");
    crate::app::ui_capture::png_bytes_to_data_url(&screenshot).expect("valid png");
    let xml = std::fs::read_to_string(&response.data.xml_path).expect("read xml");
    crate::app::ui_capture::validate_ui_dump_xml(&xml).expect("valid xml");

    clear_fake_adb_env();
}

#[test]
fn capture_ui_hierarchy_prefers_exec_out_when_xml_is_valid() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    setup_fake_adb(
        &tmp,
        "exec_ok_pull_fail",
        "exec_ok_pull_fail",
        "trace-ui-capture-exec-primary",
    );

    let response = capture_ui_hierarchy(
        "SERIAL-4".to_string(),
        Some("trace-ui-capture-exec-primary".to_string()),
    )
    .expect("capture ui hierarchy");

    crate::app::ui_capture::validate_ui_dump_xml(&response.data.xml).expect("valid xml");
    assert!(response.data.xml.trim_end().ends_with("</hierarchy>"));
    assert!(response.data.html.contains("android.widget.FrameLayout"));

    clear_fake_adb_env();
}

#[test]
fn capture_ui_hierarchy_falls_back_to_pull_when_exec_out_xml_is_invalid() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    setup_fake_adb(
        &tmp,
        "exec_ok_pull_fail",
        "exec_truncated_pull_ok",
        "trace-ui-capture-pull-fallback",
    );

    let response = capture_ui_hierarchy(
        "SERIAL-5".to_string(),
        Some("trace-ui-capture-pull-fallback".to_string()),
    )
    .expect("capture ui hierarchy");

    crate::app::ui_capture::validate_ui_dump_xml(&response.data.xml).expect("valid xml");
    assert!(response.data.xml.contains("<hierarchy"));

    clear_fake_adb_env();
}

#[test]
fn capture_ui_hierarchy_uses_download_path_for_pull_fallback() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    setup_fake_adb(
        &tmp,
        "exec_ok_pull_fail",
        "exec_fail_download_only",
        "trace-ui-capture-download-fallback",
    );

    let response = capture_ui_hierarchy(
        "SERIAL-5A".to_string(),
        Some("trace-ui-capture-download-fallback".to_string()),
    )
    .expect("capture ui hierarchy");

    crate::app::ui_capture::validate_ui_dump_xml(&response.data.xml).expect("valid xml");
    assert!(response.data.xml.contains("<hierarchy"));

    clear_fake_adb_env();
}

#[test]
fn export_ui_hierarchy_prefers_pull_path_for_complete_xml() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    let output_dir = tmp.path().join("export_xml");
    std::fs::create_dir_all(&output_dir).expect("create output");
    setup_fake_adb(
        &tmp,
        "exec_ok_pull_fail",
        "exec_truncated_pull_ok",
        "trace-ui-export-xml-pull-fallback",
    );

    let response = export_ui_hierarchy(
        "SERIAL-6".to_string(),
        Some(output_dir.to_string_lossy().to_string()),
        Some("trace-ui-export-xml-pull-fallback".to_string()),
    )
    .expect("export ui hierarchy");

    let xml = std::fs::read_to_string(&response.data.xml_path).expect("read xml");
    crate::app::ui_capture::validate_ui_dump_xml(&xml).expect("valid xml");
    assert!(xml.trim_end().ends_with("</hierarchy>"));

    clear_fake_adb_env();
}

#[test]
fn export_ui_hierarchy_errors_when_both_xml_paths_are_invalid() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    let output_dir = tmp.path().join("export_xml_fail");
    std::fs::create_dir_all(&output_dir).expect("create output");
    setup_fake_adb(
        &tmp,
        "exec_corrupt_pull_ok",
        "all_fail",
        "trace-ui-export-xml-fail",
    );

    let err = export_ui_hierarchy(
        "SERIAL-7".to_string(),
        Some(output_dir.to_string_lossy().to_string()),
        Some("trace-ui-export-xml-fail".to_string()),
    )
    .expect_err("expected xml failure");

    assert_eq!(err.code, "ERR_DEPENDENCY");
    assert_eq!(
        err.error,
        "Failed to capture UI hierarchy. exec-out UI dump returned invalid XML. download fallback capture failed: dump failed. Check Task Center for details."
    );

    clear_fake_adb_env();
}

#[test]
fn build_ui_dump_failure_message_surfaces_safe_download_permission_detail() {
    let trace_id = "trace-ui-detail-1";
    let primary = AppError::dependency("Exec-out UI dump failed: exec dump failed", trace_id);
    let fallback =
        AppError::dependency("Pulled UI dump capture failed: Permission denied", trace_id);

    let message = build_ui_dump_failure_message(&primary, &fallback);

    assert_eq!(
        message,
        "Failed to capture UI hierarchy. exec-out UI dump failed: exec dump failed. download fallback could not write the temporary UI dump. Check Task Center for details."
    );
}

#[test]
fn capture_ui_hierarchy_returns_user_safe_screenshot_error() {
    let _guard = env_lock();
    let tmp = tempfile::TempDir::new().expect("tmp");
    setup_fake_adb(
        &tmp,
        "all_fail",
        "exec_ok_pull_fail",
        "trace-ui-screenshot-safe-error",
    );

    let response = capture_ui_hierarchy(
        "SERIAL-8".to_string(),
        Some("trace-ui-screenshot-safe-error".to_string()),
    )
    .expect("capture ui hierarchy");

    assert_eq!(
        response.data.screenshot_error.as_deref(),
        Some("Please try again.")
    );

    clear_fake_adb_env();
}
