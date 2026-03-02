#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

section() {
  echo "-- $1"
}

echo "== Lazy Blacktea Full Smoke =="
echo

section "frontend unit tests"
cd "$ROOT_DIR"
npm run test
echo

section "frontend build"
npm run build
echo

section "rust fmt"
cd "$ROOT_DIR/src-tauri"
cargo fmt --all -- --check
echo

section "rust clippy"
cargo clippy --all-targets --all-features -- -D warnings
echo

section "rust tests"
cargo test --all --all-features
echo

section "adb smoke (optional)"
echo "  If a device is connected, run:"
echo "  scripts/smoke_adb.sh"
echo
section "tauri backend smoke (optional, runs Rust backend paths against a real device)"
echo "  cd src-tauri && cargo run --bin smoke -- --json --with-files --with-uiauto"
echo

echo "OK"
