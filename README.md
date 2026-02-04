# Lazy Blacktea (Rust + Tauri)

Lazy Blacktea is a desktop console for Android device automation. This edition uses Tauri v2, Rust, and React while keeping feature parity with the original PyQt app.

## Features

- Multi-device discovery with detailed device telemetry (WiFi, Bluetooth, Android, GMS)
- Device grouping, filtering, and quick actions (reboot, WiFi/Bluetooth toggles)
- Batch shell commands with history
- APK installer page (single, multi, split bundles with flags + launch)
- Screenshot and screen recording with configurable settings
- Logcat streaming with filters, presets, search, and export
- Device file browsing, pull, upload, rename/delete, and preview
- UI hierarchy capture with inline screenshot preview + XML/HTML export
- Wireless ADB pairing helper (QR/pairing code flow)
- App management (list, uninstall, force stop, clear data, enable/disable, open info)
- Bugreport generation with streaming progress and cancel
- Bluetooth monitor (snapshot + log events)
- scrcpy integration with configurable launch settings

## Requirements

- `adb` available in PATH (or configure a full path in Settings)
- Node.js + npm
- Rust toolchain (latest stable)
- macOS, Linux, or Windows
- Optional: `scrcpy` for device mirroring

## Quick Start

```bash
npm install
npm run tauri dev
```

## Commands

```bash
npm run test
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```

## Notes

- Configuration is stored at `~/.lazy_blacktea_config.json` (or `%USERPROFILE%\\.lazy_blacktea_config.json` on Windows). Override with `LAZY_BLACKTEA_CONFIG_PATH`.
- Logs are JSON-formatted in release builds.
- Default output paths are set to your system Downloads folder and can be changed in Settings.
- Task Center keeps the last 50 tasks and persists across restarts.
- File transfers report progress in Task Center when the installed `adb` supports `-p` (falls back automatically).
- UI Inspector capture includes an embedded screenshot preview; export writes XML/HTML/PNG files to the configured output folder.
- Form rows align labels with a fixed width and tighten spacing in smaller windows.
- App shell + routing are implemented in `src/App.tsx` with `HashRouter` in `src/main.tsx`.
- UI layout uses compact density, grouped sidebar navigation, and a device status top bar.
- Primary device auto-selects the first online device after refresh; the top bar device context popover includes a Manage shortcut.
- The top bar device context popover provides global multi-select with checkboxes, recent devices from task history, grouped sections, and keyboard navigation; single-device pages use the primary selection.
- Device Manager uses a filter toolbar + command bar layout with grid-aligned device rows.
- Device Manager supports Shift range select and Ctrl/Cmd toggle for multi-selection.
- Logcat advanced panel is compact and scrollable to preserve log viewport height.
- Logcat primary/secondary actions are grouped into a compact toolbar cluster.
- Logcat filters stay visible, with presets accessed via a dropdown selector + save row.
- Logcat filter rows use ultra-compact inline controls to reduce vertical height.
- Active Filters collapse to a count with an expand toggle; presets are a single-line row.
- Logcat panel uses tightened spacing and inline labels for a compact control block.
- Settings page groups configuration into a two-column grid with a fixed label column, ADB spanning full width, compact small-width spacing, and right-aligned actions.
- Theme follows system light/dark via CSS variables in `src/App.css`.

## UI/UX Planning

- `brief.md` captures the redesign brief and assumptions.
- `uiux/` contains the generated UI/UX artifacts (plan, audit, tokens, backlog).
- `uiux/device-manager/` contains Device Manager optimization artifacts from Gemini CLI.
- Decisions captured: wireless ADB pairing and live UI inspector mirror support.
