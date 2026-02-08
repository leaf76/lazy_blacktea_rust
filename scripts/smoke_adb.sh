#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/smoke_adb.sh [--serial SERIAL] [--out DIR] [--with-files] [--with-uiauto] [--apk APK_PATH]
  scripts/smoke_adb.sh --json [--summary-file PATH] [other flags...]

What it does (safe by default):
  - Verifies adb can talk to exactly one connected device (or --serial provided)
  - Collects basic device info
  - Captures a screenshot (exec-out screencap)
  - Dumps a short logcat snapshot

Optional checks:
  --with-files   Create a temp directory on /sdcard/Download, push/pull a small file, then clean up.
  --with-uiauto  Run uiautomator dump and pull XML back (requires --with-files).
  --apk PATH     Install an APK (no uninstall). This is a destructive action and may prompt on-device dialogs.
  --json         Print a machine-readable JSON summary to stdout (still writes artifacts).
  --summary-file Write JSON summary to the given path (default: OUT_DIR/summary.json).

Examples:
  scripts/smoke_adb.sh
  scripts/smoke_adb.sh --serial "$ANDROID_SERIAL" --with-files --with-uiauto
  scripts/smoke_adb.sh --apk "./app-debug.apk"
EOF
}

SERIAL="${ANDROID_SERIAL:-}"
OUT_DIR=""
SUMMARY_FILE=""
FORMAT="text"
WITH_FILES=0
WITH_UIAUTO=0
APK_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial)
      SERIAL="${2:-}"
      shift 2
      ;;
    --out)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --with-files)
      WITH_FILES=1
      shift 1
      ;;
    --with-uiauto)
      WITH_UIAUTO=1
      shift 1
      ;;
    --apk)
      APK_PATH="${2:-}"
      shift 2
      ;;
    --json)
      FORMAT="json"
      shift 1
      ;;
    --summary-file)
      SUMMARY_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ $WITH_UIAUTO -eq 1 && $WITH_FILES -ne 1 ]]; then
  echo "--with-uiauto requires --with-files (needs a temp path on device)." >&2
  exit 2
fi

adb_cmd=(adb)

ts_ms() {
  python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
}

pick_single_device() {
  # Output: serial on stdout
  local serials
  serials="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
  local count
  count="$(printf "%s\n" "$serials" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$count" -eq 1 ]]; then
    printf "%s\n" "$serials" | sed '/^$/d'
    return 0
  fi
  if [[ "$count" -eq 0 ]]; then
    echo "No online adb devices found. Check 'adb devices' and USB debugging authorization." >&2
    return 1
  fi
  echo "Multiple adb devices found. Set ANDROID_SERIAL or pass --serial." >&2
  echo "Online devices:" >&2
  printf "%s\n" "$serials" | sed '/^$/d' >&2
  return 1
}

if [[ -z "$SERIAL" ]]; then
  SERIAL="$(pick_single_device)"
fi

adb_cmd+=( -s "$SERIAL" )

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$(mktemp -d -t lazy_blacktea_smoke_XXXXXX)"
fi

mkdir -p "$OUT_DIR"

if [[ -z "$SUMMARY_FILE" ]]; then
  SUMMARY_FILE="$OUT_DIR/summary.json"
fi

OVERALL_STATUS="pass"
ERROR_CODE=""
ERROR_MESSAGE=""

CHECKS_FILE="$OUT_DIR/.checks.tsv"
: > "$CHECKS_FILE"

add_check() {
  # name status duration_ms artifacts_csv error_code error_message
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$1" "$2" "$3" "$4" "$5" "$6" >> "$CHECKS_FILE"
}

run_step() {
  # name cmd... (captures stdout+stderr to a log file on failure only)
  local name="$1"
  shift 1
  local start end dur status artifacts err_code err_msg
  start="$(ts_ms)"

  status="pass"
  artifacts=""
  err_code=""
  err_msg=""

  if ! "$@"; then
    status="fail"
    OVERALL_STATUS="fail"
    err_code="ERR_STEP_FAILED"
    err_msg="Step failed: ${name}"
  fi

  end="$(ts_ms)"
  dur="$((end - start))"
  add_check "$name" "$status" "$dur" "$artifacts" "$err_code" "$err_msg"
}

emit_text_header() {
  echo "== Lazy Blacktea ADB Smoke =="
  echo "serial: $SERIAL"
  echo "out:    $OUT_DIR"
  echo "summary:$SUMMARY_FILE"
  echo
}

if [[ "$FORMAT" == "text" ]]; then
  emit_text_header
fi

ADB_VERSION_FILE="$OUT_DIR/adb_version.txt"
DEVICE_STATE_FILE="$OUT_DIR/device_state.txt"
DEVICE_INFO_FILE="$OUT_DIR/device_info.txt"

step_adb_version() {
  "${adb_cmd[@]}" version > "$ADB_VERSION_FILE"
}
step_device_state() {
  "${adb_cmd[@]}" get-state > "$DEVICE_STATE_FILE"
}
step_device_info() {
  MODEL="$("${adb_cmd[@]}" shell getprop ro.product.model | tr -d '\r')"
  DEVICE="$("${adb_cmd[@]}" shell getprop ro.product.device | tr -d '\r')"
  ANDROID_REL="$("${adb_cmd[@]}" shell getprop ro.build.version.release | tr -d '\r')"
  SDK="$("${adb_cmd[@]}" shell getprop ro.build.version.sdk | tr -d '\r')"
  {
    echo "model=${MODEL:-unknown}"
    echo "device=${DEVICE:-unknown}"
    echo "android_release=${ANDROID_REL:-unknown}"
    echo "sdk=${SDK:-unknown}"
  } > "$DEVICE_INFO_FILE"
}

start="$(ts_ms)"
if step_adb_version; then
  end="$(ts_ms)"; add_check "adb_version" "pass" "$((end - start))" "$ADB_VERSION_FILE" "" ""
else
  end="$(ts_ms)"; add_check "adb_version" "fail" "$((end - start))" "$ADB_VERSION_FILE" "ERR_ADB_VERSION" "Failed to get adb version"
  OVERALL_STATUS="fail"
fi

start="$(ts_ms)"
if step_device_state; then
  end="$(ts_ms)"; add_check "device_state" "pass" "$((end - start))" "$DEVICE_STATE_FILE" "" ""
else
  end="$(ts_ms)"; add_check "device_state" "fail" "$((end - start))" "$DEVICE_STATE_FILE" "ERR_DEVICE_STATE" "Failed to get device state"
  OVERALL_STATUS="fail"
fi

start="$(ts_ms)"
if step_device_info; then
  end="$(ts_ms)"; add_check "device_info" "pass" "$((end - start))" "$DEVICE_INFO_FILE" "" ""
else
  end="$(ts_ms)"; add_check "device_info" "fail" "$((end - start))" "$DEVICE_INFO_FILE" "ERR_DEVICE_INFO" "Failed to read device properties"
  OVERALL_STATUS="fail"
fi

if [[ "$FORMAT" == "text" ]]; then
  echo "-- adb version"
  sed 's/^/  /' "$ADB_VERSION_FILE" || true
  echo

  echo "-- device state"
  sed 's/^/  /' "$DEVICE_STATE_FILE" || true
  echo

  echo "-- basic device info"
  sed 's/^/  /' "$DEVICE_INFO_FILE" || true
  echo
fi

SHOT_PATH="$OUT_DIR/screenshot.png"
start="$(ts_ms)"
if "${adb_cmd[@]}" exec-out screencap -p > "$SHOT_PATH"; then
  if [[ ! -s "$SHOT_PATH" ]]; then
    end="$(ts_ms)"
    add_check "screenshot" "fail" "$((end - start))" "$SHOT_PATH" "ERR_SCREENSHOT_EMPTY" "Screenshot capture produced an empty file"
    OVERALL_STATUS="fail"
  else
    end="$(ts_ms)"
    add_check "screenshot" "pass" "$((end - start))" "$SHOT_PATH" "" ""
  fi
else
  end="$(ts_ms)"
  add_check "screenshot" "fail" "$((end - start))" "" "ERR_SCREENSHOT_FAILED" "Failed to capture screenshot"
  OVERALL_STATUS="fail"
fi

if [[ "$FORMAT" == "text" ]]; then
  echo "-- screenshot (exec-out screencap)"
  if [[ -s "$SHOT_PATH" ]]; then
    echo "  saved: $SHOT_PATH ($(wc -c < "$SHOT_PATH" | tr -d ' ') bytes)"
  else
    echo "  failed"
  fi
  echo
fi

LOGCAT_PATH="$OUT_DIR/logcat.txt"
start="$(ts_ms)"
if "${adb_cmd[@]}" logcat -d -v time -t 200 > "$LOGCAT_PATH"; then
  end="$(ts_ms)"
  add_check "logcat_snapshot" "pass" "$((end - start))" "$LOGCAT_PATH" "" ""
else
  # Logcat may fail on some devices; keep it non-fatal but visible.
  end="$(ts_ms)"
  add_check "logcat_snapshot" "warn" "$((end - start))" "$LOGCAT_PATH" "WARN_LOGCAT_FAILED" "Failed to capture logcat snapshot"
fi

if [[ "$FORMAT" == "text" ]]; then
  echo "-- logcat snapshot"
  echo "  saved: $LOGCAT_PATH ($(wc -l < "$LOGCAT_PATH" | tr -d ' ') lines)"
  echo
fi

DEVICE_TMP_DIR=""
cleanup_device_tmp() {
  if [[ -n "$DEVICE_TMP_DIR" ]]; then
    "${adb_cmd[@]}" shell rm -rf "$DEVICE_TMP_DIR" >/dev/null 2>&1 || true
  fi
}

if [[ $WITH_FILES -eq 1 ]]; then
  if [[ "$FORMAT" == "text" ]]; then
    echo "-- file I/O (push/pull, then cleanup)"
  fi
  DEVICE_TMP_DIR="/sdcard/Download/lazy_blacktea_smoke_$(date +%Y%m%d_%H%M%S)"
  trap cleanup_device_tmp EXIT

  FILES_STEP_ARTIFACTS=()

  start="$(ts_ms)"
  "${adb_cmd[@]}" shell mkdir -p "$DEVICE_TMP_DIR"

  FILES_STEP_ARTIFACTS+=("$OUT_DIR/push.txt" "$OUT_DIR/pulled.txt")

  if [[ "$FORMAT" == "text" ]]; then
    echo "  device tmp: $DEVICE_TMP_DIR"
  fi
  echo "hello from lazy_blacktea_smoke" > "$OUT_DIR/push.txt"
  if [[ "$FORMAT" == "json" ]]; then
    "${adb_cmd[@]}" push "$OUT_DIR/push.txt" "$DEVICE_TMP_DIR/push.txt" >/dev/null 2>&1
  else
    "${adb_cmd[@]}" push "$OUT_DIR/push.txt" "$DEVICE_TMP_DIR/push.txt" >/dev/null 2>&1
  fi

  if [[ "$FORMAT" == "json" ]]; then
    "${adb_cmd[@]}" pull "$DEVICE_TMP_DIR/push.txt" "$OUT_DIR/pulled.txt" >/dev/null 2>&1
  else
    "${adb_cmd[@]}" pull "$DEVICE_TMP_DIR/push.txt" "$OUT_DIR/pulled.txt" >/dev/null 2>&1
  fi
  if [[ ! -s "$OUT_DIR/pulled.txt" ]]; then
    end="$(ts_ms)"
    add_check "file_io" "fail" "$((end - start))" "$(IFS=,; echo "${FILES_STEP_ARTIFACTS[*]}")" "ERR_FILE_PULL_EMPTY" "Pulled file is empty"
    OVERALL_STATUS="fail"
  else
    end="$(ts_ms)"
    add_check "file_io" "pass" "$((end - start))" "$(IFS=,; echo "${FILES_STEP_ARTIFACTS[*]}")" "" ""
  fi

  if [[ "$FORMAT" == "text" ]]; then
    "${adb_cmd[@]}" shell ls -la "$DEVICE_TMP_DIR" | tr -d '\r' | sed 's/^/  /'
    echo "  pulled: $OUT_DIR/pulled.txt"
  fi

  if [[ $WITH_UIAUTO -eq 1 ]]; then
    if [[ "$FORMAT" == "text" ]]; then
      echo "-- uiautomator dump (requires unlocked screen)"
    fi
    DUMP_REMOTE="$DEVICE_TMP_DIR/window_dump.xml"
    DUMP_LOCAL="$OUT_DIR/window_dump.xml"
    start="$(ts_ms)"
    if "${adb_cmd[@]}" shell uiautomator dump "$DUMP_REMOTE" >/dev/null 2>&1 && "${adb_cmd[@]}" pull "$DUMP_REMOTE" "$DUMP_LOCAL" >/dev/null 2>&1; then
      if [[ ! -s "$DUMP_LOCAL" ]]; then
        end="$(ts_ms)"
        add_check "uiauto_dump" "fail" "$((end - start))" "$DUMP_LOCAL" "ERR_UIAUTO_EMPTY" "UI dump is empty"
        OVERALL_STATUS="fail"
      else
        end="$(ts_ms)"
        add_check "uiauto_dump" "pass" "$((end - start))" "$DUMP_LOCAL" "" ""
      fi
    else
      end="$(ts_ms)"
      add_check "uiauto_dump" "fail" "$((end - start))" "$DUMP_LOCAL" "ERR_UIAUTO_FAILED" "Failed to run uiautomator dump"
      OVERALL_STATUS="fail"
    fi
    if [[ "$FORMAT" == "text" ]]; then
      echo "  saved: $DUMP_LOCAL"
    fi
  fi

  cleanup_device_tmp
  DEVICE_TMP_DIR=""
  trap - EXIT
  if [[ "$FORMAT" == "text" ]]; then
    echo
  fi
fi

if [[ -n "$APK_PATH" ]]; then
  if [[ ! -f "$APK_PATH" ]]; then
    echo "--apk path not found: $APK_PATH" >&2
    exit 2
  fi
  start="$(ts_ms)"
  APK_LOG="$OUT_DIR/apk_install.txt"
  if "${adb_cmd[@]}" install -r "$APK_PATH" > "$APK_LOG" 2>&1; then
    end="$(ts_ms)"
    add_check "apk_install" "pass" "$((end - start))" "$APK_LOG" "" ""
  else
    end="$(ts_ms)"
    add_check "apk_install" "fail" "$((end - start))" "$APK_LOG" "ERR_APK_INSTALL" "APK install failed"
    OVERALL_STATUS="fail"
  fi
  if [[ "$FORMAT" == "text" ]]; then
    echo "-- APK install (destructive)"
    echo "  apk: $APK_PATH"
    tr -d '\r' < "$APK_LOG" | sed 's/^/  /' || true
    echo
  fi
fi

python3 - "$SERIAL" "$OUT_DIR" "$SUMMARY_FILE" "$OVERALL_STATUS" "$ADB_VERSION_FILE" "$DEVICE_STATE_FILE" "$DEVICE_INFO_FILE" "$CHECKS_FILE" <<'PY'
import json
import sys
from pathlib import Path

serial, out_dir, summary_file, overall_status, adb_version_file, device_state_file, device_info_file, checks_file = sys.argv[1:]

def read_text(path: str) -> str:
  p = Path(path)
  if not p.exists():
    return ""
  return p.read_text(errors="replace")

checks = []
for line in Path(checks_file).read_text(errors="replace").splitlines():
  if not line.strip():
    continue
  name, status, duration_ms, artifacts_csv, err_code, err_msg = (line.split("\t") + ["", "", "", "", "", ""])[:6]
  artifacts = [a for a in artifacts_csv.split(",") if a] if artifacts_csv else []
  checks.append({
    "name": name,
    "status": status,
    "duration_ms": int(duration_ms) if duration_ms.isdigit() else None,
    "artifacts": artifacts,
    **({"error_code": err_code} if err_code else {}),
    **({"error": err_msg} if err_msg else {}),
  })

summary = {
  "tool": "lazy_blacktea_smoke_adb",
  "status": overall_status,
  "serial": serial,
  "out_dir": out_dir,
  "artifacts": {
    "adb_version": adb_version_file,
    "device_state": device_state_file,
    "device_info": device_info_file,
    "screenshot": str(Path(out_dir) / "screenshot.png"),
    "logcat": str(Path(out_dir) / "logcat.txt"),
  },
  "checks": checks,
}

Path(summary_file).write_text(json.dumps(summary, indent=2, sort_keys=False) + "\n")

PY

if [[ "$FORMAT" == "json" ]]; then
  cat "$SUMMARY_FILE"
else
  if [[ "$OVERALL_STATUS" == "pass" ]]; then
    echo "OK"
  else
    echo "FAILED (see $SUMMARY_FILE)" >&2
  fi
fi

if [[ "$OVERALL_STATUS" != "pass" ]]; then
  exit 1
fi
