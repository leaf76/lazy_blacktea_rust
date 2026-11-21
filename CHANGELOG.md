# Changelog

All notable changes to **Lazy Blacktea (Tauri / Rust)** are documented in this file.

## Unreleased

### Added
- **Shared Config Coexistence (`~/.lazy_blacktea_config.json`)**: Saving settings now recursively merges with existing JSON on disk so unknown keys from the PyQt6 edition (such as `updates`) are preserved, while user-editable maps (`device_groups`, `terminal.buffers`) still delete cleanly.
- **APK Pre-Check, Progress & Cancellation**:
  - Added `inspect_apk` command validating `AndroidManifest.xml`, inspecting split `.apks`/`.xapk` bundles, and parsing `aapt2`/`aapt dump badging` metadata (`package_name`, `versionCode`, `versionName`, `minSdkVersion`, `targetSdkVersion`).
  - Added `ApkInspectionCard` in `/apk-installer` with `minSdk` compatibility warnings for selected devices and 1-click Launch package fill.
  - Added streamed `adb push -p` progress + `pm install` + remote temp cleanup and `cancel_apk_install` support across single, multi, and split APK installs.
- **Keyboard-First UX & Density**:
  - Added `Ctrl+K` / `Cmd+K` Command Palette searching pages, live connected devices, quick actions, and recent tasks.
  - Added `?` Keyboard Shortcuts overlay, `/` focus device search, and device list keyboard navigation (`ArrowUp`/`ArrowDown`/`Home`/`End`/`Space`/`Ctrl+A`/`Ctrl+Shift+A`).
  - Added Quick-Filter Chips (`Selected`, `Recording`, `Wi-Fi On/Off`, `BT On/Off`, `API 33+/34+`, `Android/iOS`) and `Run Shell` action in the selected-device bar.
  - Added persisted `ui.density` (`compact` / `cozy` / `comfortable`) in Settings -> Appearance, sharing the `ui.density` schema with the PyQt6 edition.
- **UI Inspector Selectors & File Preview Zoom**:
  - Added copyable XPath, Android `UiSelector`, and interaction flags under selected nodes in UI Inspector.
  - Added `Zoom -` / `Zoom +` / `100%` / `Fit` controls to File Explorer image previews.
- **Logcat Embedded Scrcpy & Synced Recording Slice**:
  - Added `Mirror (scrcpy)`, `Record + Sync`, and time-windowed `Export Slice` actions directly inside the Logcat toolbar.
- **Bluetooth Raw Diagnostics Viewer**:
  - Upgraded the Raw Bluetooth Snapshot panel with line search filtering and a **Metrics JSON** tab for parsed state & snapshot inspection.
- **ADB Server & Batch Android Utilities**:
  - Added `adb_server_control` (`start` / `kill` / `restart`), `adb_root_devices`, `set_logcat_buffer_size` (`256K`–`64M`), `pull_device_dcim_batch`, and `export_discovery_service_dump` commands with UI in Settings -> Connectivity and `/actions` -> **Utilities**.
  - Added `parse_battery_capacity_mah` helper for sysfs/`dumpsys battery` mAh parsing.

### Fixed
- Tightened `ApkInstallErrorCode::from_output` to require a standalone `Success` line with no `Failure`/`Error` lines, preventing false-positive success classification when a path or message contains `"success"`.

### Notes
- `BUGREPORT_CUSTOM_VIEW_ENTRY_VISIBLE` in `src/App.tsx` remains intentionally gated (`false`) pending product sign-off.

## 0.0.94
- Resolved Linux tarball packaging pipe error.

## 0.0.93
- Added portable Linux tarball packaging and patched AppImage Wayland library bundling.

## 0.0.92
- Resolved Linux AppImage launch crash.

## 0.0.91
- Added device retention and status transparency for rebooting and reconnecting devices.

## 0.0.89 - 0.0.90
- Shipped Windows builds (NSIS / MSI) and Windows CI test manifest support.

## 0.0.88
- Hardened cross-platform iOS MVP inventory and observation.

## 0.0.85 - 0.0.87
- Grouped screen recording artifacts with companion logcat capture, improved device action feedback, and fixed opener path scope.
