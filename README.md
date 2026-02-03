# Lazy Blacktea (Rust + Tauri)

Lazy Blacktea is a desktop console for Android device automation. This edition uses Tauri v2, Rust, and React while keeping feature parity with the original PyQt app.

## Features

- Multi-device discovery with detailed device telemetry (WiFi, Bluetooth, Android, GMS)
- Device grouping, filtering, and quick actions (reboot, WiFi/Bluetooth toggles)
- Batch shell commands with history
- APK install (split bundles supported, configurable flags)
- Screenshot and screen recording with configurable settings
- Logcat streaming, clear, and filters
- Device file browsing, pull, and preview
- UI hierarchy capture and HTML rendering
- App management (list, uninstall, force stop, clear data, enable/disable, open info)
- Bugreport generation with streaming progress and cancel
- Bluetooth monitor (snapshot + log events)
- scrcpy integration with configurable launch settings

## Requirements

- `adb` available in PATH
- Node.js + npm
- Rust toolchain (latest stable)
- macOS or Linux
- Optional: `scrcpy` for device mirroring

## Quick Start

```bash
npm install
npm run tauri dev
```

## Commands

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```

## Notes

- Configuration is stored at `~/.lazy_blacktea_config.json`.
- Logs are JSON-formatted in release builds.
- Default output paths can be configured in Settings.
