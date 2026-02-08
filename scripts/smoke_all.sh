#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Lazy Blacktea Full Smoke =="
echo

echo "-- frontend unit tests"
cd "$ROOT_DIR"
npm run test
echo

echo "-- frontend build"
npm run build
echo

echo "-- rust fmt"
cd "$ROOT_DIR/src-tauri"
cargo fmt --all -- --check
echo

echo "-- rust clippy"
cargo clippy --all-targets --all-features -- -D warnings
echo

echo "-- rust tests"
cargo test --all --all-features
echo

echo "-- adb smoke (optional)"
echo "  If a device is connected, run:"
echo "  scripts/smoke_adb.sh"
echo
echo "-- tauri backend smoke (optional, runs Rust backend paths against a real device)"
echo "  cd src-tauri && cargo run --bin smoke -- --json --with-files --with-uiauto"
echo

echo "OK"
