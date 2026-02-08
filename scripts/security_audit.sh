#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OUT_DIR="${1:-"$ROOT_DIR/.audit"}"
mkdir -p "$OUT_DIR"

echo "== Lazy Blacktea Security Audit =="
echo "out: $OUT_DIR"
echo

echo "-- npm audit (JSON)"
cd "$ROOT_DIR"
if npm audit --json >"$OUT_DIR/npm_audit.json"; then
  echo "  status: ok"
else
  # npm audit exits non-zero when vulnerabilities are found.
  echo "  status: vulnerabilities found (see npm_audit.json)"
fi
echo "  saved: $OUT_DIR/npm_audit.json"
echo

echo "-- cargo audit (JSON)"
cd "$ROOT_DIR/src-tauri"
if command -v cargo-audit >/dev/null 2>&1; then
  if cargo audit --json >"$OUT_DIR/cargo_audit.json"; then
    echo "  status: ok"
  else
    echo "  status: vulnerabilities found (see cargo_audit.json)"
  fi
  echo "  saved: $OUT_DIR/cargo_audit.json"
else
  echo "  status: skipped (cargo-audit not installed)"
  echo "  hint: cargo install cargo-audit"
fi
echo

echo "-- tauri config quick checks"
cd "$ROOT_DIR"
if jq -e '.app.security.csp == null' src-tauri/tauri.conf.json >/dev/null 2>&1; then
  echo "  warn: CSP is null in src-tauri/tauri.conf.json (no CSP hardening)."
else
  echo "  ok: CSP is set."
fi
echo

echo "-- high-risk command surface"
if rg -n "pub fn run_shell\\b" src-tauri/src/app/commands/mod.rs >/dev/null 2>&1; then
  echo "  note: run_shell exists (device-side arbitrary shell via adb)."
  echo "  recommendation: consider adding a 'restricted mode' or explicit user confirmation for production usage."
fi
echo

echo "OK"

