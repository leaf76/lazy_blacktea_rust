#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/ui_inspector_probe.sh [--serial SERIAL] [--out DIR] [--adb PATH]

Collects raw ADB evidence for Samsung / UI Inspector capture failures and writes:
- commands/*.stdout
- commands/*.stderr
- commands/*.exitcode
- commands/*.command
- artifacts/*.xml
- probe_info.txt
- a sibling .zip bundle

If --serial is omitted, the script auto-selects the single connected device.
EOF
}

fail() {
  echo "$*" >&2
  exit 1
}

sanitize_name() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'
}

ADB_BIN="${ADB:-adb}"
SERIAL="${ANDROID_SERIAL:-}"
OUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial)
      [[ $# -ge 2 ]] || fail "Missing value for --serial."
      SERIAL="$2"
      shift 2
      ;;
    --out)
      [[ $# -ge 2 ]] || fail "Missing value for --out."
      OUT_DIR="$2"
      shift 2
      ;;
    --adb)
      [[ $# -ge 2 ]] || fail "Missing value for --adb."
      ADB_BIN="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

timestamp="$(date -u +%Y%m%d_%H%M%S)"

tmp_root=""
cleanup_tmp_root() {
  if [[ -n "$tmp_root" && -d "$tmp_root" ]]; then
    rm -rf "$tmp_root"
  fi
}
trap cleanup_tmp_root EXIT

if [[ -z "$OUT_DIR" ]]; then
  tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/ui_inspector_probe.XXXXXX")"
  OUT_DIR="$tmp_root/probe"
fi

mkdir -p "$OUT_DIR" || fail "Failed to create output directory: $OUT_DIR"
COMMANDS_DIR="$OUT_DIR/commands"
ARTIFACTS_DIR="$OUT_DIR/artifacts"
mkdir -p "$COMMANDS_DIR" "$ARTIFACTS_DIR" || fail "Failed to create probe subdirectories."

run_capture() {
  local name="$1"
  shift

  local stdout_path="$COMMANDS_DIR/${name}.stdout"
  local stderr_path="$COMMANDS_DIR/${name}.stderr"
  local exitcode_path="$COMMANDS_DIR/${name}.exitcode"
  local command_path="$COMMANDS_DIR/${name}.command"

  printf '%s\n' "$*" >"$command_path"

  if "$@" >"$stdout_path" 2>"$stderr_path"; then
    echo "0" >"$exitcode_path"
    return 0
  else
    local status=$?
    echo "$status" >"$exitcode_path"
    return "$status"
  fi
}

run_capture "adb_devices_l" "$ADB_BIN" devices -l || true

if [[ -z "$SERIAL" ]]; then
  detected_serials=()
  while IFS= read -r detected_serial; do
    [[ -n "$detected_serial" ]] || continue
    detected_serials+=("$detected_serial")
  done < <(awk 'NR > 1 && $1 != "" && $1 != "*" { print $1 }' "$COMMANDS_DIR/adb_devices_l.stdout")
  if [[ ${#detected_serials[@]} -eq 0 ]]; then
    fail "No connected Android devices found. Pass --serial or set ANDROID_SERIAL."
  fi
  if [[ ${#detected_serials[@]} -gt 1 ]]; then
    fail "Multiple Android devices detected. Pass --serial or set ANDROID_SERIAL."
  fi
  SERIAL="${detected_serials[0]}"
fi

safe_serial="$(sanitize_name "$SERIAL")"
if [[ -z "$tmp_root" ]]; then
  OUT_DIR="${OUT_DIR%/}"
else
  resolved_out_dir="$(dirname "$OUT_DIR")/ui_inspector_probe_${safe_serial}_${timestamp}"
  mv "$OUT_DIR" "$resolved_out_dir" || fail "Failed to rename probe output directory."
  OUT_DIR="$resolved_out_dir"
  COMMANDS_DIR="$OUT_DIR/commands"
  ARTIFACTS_DIR="$OUT_DIR/artifacts"
fi

probe_info="$OUT_DIR/probe_info.txt"
{
  echo "timestamp_utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "serial=$SERIAL"
  echo "adb_bin=$ADB_BIN"
} >"$probe_info"

run_capture "getprop_ro_product_manufacturer" "$ADB_BIN" -s "$SERIAL" shell getprop ro.product.manufacturer || true
run_capture "getprop_ro_product_model" "$ADB_BIN" -s "$SERIAL" shell getprop ro.product.model || true
run_capture "getprop_ro_build_version_release" "$ADB_BIN" -s "$SERIAL" shell getprop ro.build.version.release || true
run_capture "getprop_ro_build_version_sdk" "$ADB_BIN" -s "$SERIAL" shell getprop ro.build.version.sdk || true
run_capture "exec_out_uiautomator_dump" "$ADB_BIN" -s "$SERIAL" exec-out uiautomator dump /dev/tty || true

download_remote="/sdcard/Download/lbt_probe.xml"
download_local="$ARTIFACTS_DIR/download_lbt_probe.xml"
tmp_remote="/data/local/tmp/lbt_probe.xml"
tmp_local="$ARTIFACTS_DIR/tmp_lbt_probe.xml"

download_ok=0
run_capture "download_shell_dump" "$ADB_BIN" -s "$SERIAL" shell uiautomator dump "$download_remote" || true
run_capture "download_shell_ls" "$ADB_BIN" -s "$SERIAL" shell ls -l "$download_remote" || true
if run_capture "download_pull" "$ADB_BIN" -s "$SERIAL" pull "$download_remote" "$download_local"; then
  download_ok=1
fi

if [[ $download_ok -ne 1 ]]; then
  run_capture "tmp_shell_dump" "$ADB_BIN" -s "$SERIAL" shell uiautomator dump "$tmp_remote" || true
  run_capture "tmp_shell_ls" "$ADB_BIN" -s "$SERIAL" shell ls -l "$tmp_remote" || true
  run_capture "tmp_pull" "$ADB_BIN" -s "$SERIAL" pull "$tmp_remote" "$tmp_local" || true
fi

run_capture "cleanup_download_rm" "$ADB_BIN" -s "$SERIAL" shell rm -f "$download_remote" || true
run_capture "cleanup_tmp_rm" "$ADB_BIN" -s "$SERIAL" shell rm -f "$tmp_remote" || true

zip_path="$(dirname "$OUT_DIR")/$(basename "$OUT_DIR").zip"
python3 - "$OUT_DIR" "$zip_path" <<'PY' || fail "Failed to create probe zip bundle."
import pathlib
import sys
import zipfile

root = pathlib.Path(sys.argv[1])
zip_path = pathlib.Path(sys.argv[2])

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(root))
PY

{
  echo "out_dir=$OUT_DIR"
  echo "zip_path=$zip_path"
  echo "serial=$SERIAL"
}
