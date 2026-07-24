# Testing

This project is a Tauri v2 + React desktop app backed by a Rust backend that shells out to system mobile tooling (`adb`, Xcode `devicectl`, and libimobiledevice when available).

On macOS, you can reliably automate:
- Web UI smoke checks (run the frontend in a plain browser).
- Rust unit/integration tests.
- Real-device ADB smoke checks (without UI automation).
- Real-device iOS inventory checks when Xcode or libimobiledevice tools are installed.

Full desktop UI automation on macOS is limited because the desktop WebView does not have the same WebDriver support story as Windows/Linux.

## Quick Commands

### Core Checks (fast, deterministic)

```bash
npm run test
npm run build

cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```

### Full Smoke Wrapper

```bash
scripts/smoke_all.sh
```

### Real Device ADB Smoke (macOS friendly)

Safe by default:

```bash
scripts/smoke_adb.sh
```

Machine-readable summary (for automation or sharing results):

```bash
scripts/smoke_adb.sh --json
```

If multiple devices are connected:

```bash
export ANDROID_SERIAL="YOUR_SERIAL"
scripts/smoke_adb.sh
```

Include file I/O and UI dump:

```bash
scripts/smoke_adb.sh --with-files --with-uiauto
```

### Cross-Platform Device Inventory Smoke

Use this when validating the Android + iOS device list MVP.

1. Connect one Android device with USB debugging enabled and verify:

```bash
adb devices -l
```

2. Connect one trusted iPhone. Verify the matching iOS tool path works.

macOS:

```bash
xcrun --find devicectl
```

Linux Ubuntu/Debian:

```bash
sudo apt install usbmuxd libimobiledevice-utils
sudo systemctl enable --now usbmuxd
idevice_id -l
ideviceinfo -u "IOS_UDID"
```

3. Launch the app and open **Settings -> iOS Tools -> Test iOS Tools**. Expected result:

- Available tools show `available`.
- Missing tools show `missing`.
- On Linux, missing `devicectl` is shown as macOS-only or not required.
- Missing iOS tools do not break Android device refresh.

4. Open **Device Manager** and click **Refresh Devices**. Expected result:

- Android and iOS devices appear in the same list.
- Rows show an Android or iOS badge.
- iOS rows show the UDID, device name or product type, iOS version when available, and trust status when available.
- Android-only actions such as Shell, APK Installer, File Browser, Reboot, Wi-Fi/Bluetooth controls, screen record, and mirroring are disabled or unavailable for iOS-only selections.

5. Open **Logs** with the iPhone selected. Expected result:

- If `idevicesyslog` is available, Start begins iOS syslog streaming and Stop terminates it.
- Source filters are disabled for iOS and do not block syslog.
- Export writes the visible log lines to the configured output folder.

6. Screenshot (optional tool):

- If `idevicescreenshot` is available, Screenshot captures a PNG for the selected iPhone.
- If the tool is missing, Screenshot stays disabled for that iOS device while Android devices still work.

7. iOS auto-refresh:

- Enable **Settings → Devices → Auto-refresh iOS inventory**.
- Disconnect or reconnect the iPhone and wait one interval; the list should update without a manual refresh.
- Disable the setting; plug changes should require **Refresh Devices**.

8. Negative checks:

- Lock or untrust the iPhone and refresh. The UI should show a human-readable unavailable or missing-detail state.
- Remove libimobiledevice tools from PATH or use a shell without them. Android refresh should still work.
- Stop `usbmuxd` on Linux and refresh. Settings and troubleshooting docs should point the user to `sudo systemctl enable --now usbmuxd`.
- Run with no ADB in PATH but with a trusted iPhone and libimobiledevice available. The iPhone should still appear in Device Manager.
- Keep Android and iPhone connected while ADB tracking emits updates. The iPhone row should remain visible after Android state changes.
- Select one iPhone with `idevicecrashreport` available. The device action menu should expose **Export iOS Crash Reports**.

### iOS Configuration Profile Install Smoke

Use this on macOS with Apple Configurator installed. This flow is not supported on Linux in the MVP.

1. Install Apple Configurator from the App Store, install its command-line tool, and verify:

```bash
cfgutil help
cfgutil list
```

2. Connect one trusted, unlocked iPhone over USB. For two-device batch validation, connect two trusted iPhones.
3. Launch the app, open **Settings -> iOS Tools -> Test iOS Tools**, and confirm `cfgutil` is `available`.
4. Open **Profiles**, choose a harmless test `.mobileconfig`, and click **Validate**. Expected result:

- The profile name, identifier, UUID when present, and payload count are shown.
- Invalid extension, missing file, malformed plist, or oversized profile failures are human-readable.
- Full payload contents are not shown in logs or UI.

5. Select one or more eligible iOS devices and click **Install Profile**. Expected result:

- A confirmation modal appears before the install starts.
- Each selected device reports `installed`, `failed`, or `skipped` independently.
- If one device rejects the profile, other selected devices still report their own result.

6. Negative checks:

- Hide `cfgutil` from `PATH` and confirm Settings plus Profiles explain that Apple Configurator `cfgutil` is required.
- Select Android devices only and confirm **Install Configuration Profile** is unavailable.
- Use a duplicate or rejected profile and confirm the result table shows the per-device failure message.
- Lock or untrust the iPhone and confirm the UI reports a readable trust/connection next step.

### Samsung UI Inspector RCA Probe

When a Samsung device fails `UI Inspector Capture`, collect a probe bundle before changing backend logic:

1. Copy the `trace_id` from the failed Task Center row.
2. Run the probe script against the affected device:

```bash
scripts/ui_inspector_probe.sh --serial "RFCW40P6PSB"
```

If `ANDROID_SERIAL` is already set, `--serial` is optional. To store the probe under a specific directory:

```bash
scripts/ui_inspector_probe.sh --serial "RFCW40P6PSB" --out "./ui-probe"
```

The script writes:
- raw `stdout` / `stderr` / `exitcode` files for every probe command
- pulled XML artifacts from `/sdcard/Download` and, if needed, `/data/local/tmp`
- `probe_info.txt`
- a sibling `.zip` bundle ready to attach to a bug report

When reporting the issue, attach:
- the generated probe `.zip`
- the original `trace_id`

Install an APK (destructive):

```bash
scripts/smoke_adb.sh --apk "./app-debug.apk"
```

### Tauri Backend Smoke (Runs Rust Code Paths)

This runs a small Rust CLI that reuses backend command functions where possible.

```bash
cd src-tauri
cargo run --bin smoke -- --json --with-files
```

If you want JSON-only stdout (no cargo build logs), build once and run the binary directly:

```bash
cd src-tauri
cargo build --bin smoke
./target/debug/smoke --json --with-files
```

It covers:
- ADB availability
- Screenshot capture
- Logcat snapshot and logcat stream start/stop
- Device file listing
- Perf monitor start/stop (bounded samples)
- Optional file push/pull and uiautomator dump
- Optional File Explorer ops (mkdir/rename/delete inside a temp directory)
- Optional UI Inspector export (writes XML/HTML/PNG to output dir)
- Optional APK install and launch (destructive; only when flags are provided)

Flags:
```bash
./target/debug/smoke --with-ui-inspector
./target/debug/smoke --apk "./app-debug.apk" --apk-launch
./target/debug/smoke --apk "./app-debug.apk" --apk-package "com.example.app" --apk-launch
```

### Tauri Backend Soak (Stability)

This is a repeatable stability loop that repeatedly:
- starts/stops a logcat stream and verifies a marker line is observed
- starts/stops the perf monitor (bounded samples)

It is safe by default (no file ops, no APK installs).

```bash
cd src-tauri
cargo build --bin soak
./target/debug/soak --json --duration-secs 120 --interval-ms 500
```

If multiple devices are connected:

```bash
./target/debug/soak --json --serial "YOUR_SERIAL"
```

### Security Audit (Dependencies + Quick Checks)

This writes JSON reports under `.audit/`:

```bash
scripts/security_audit.sh
```

Notes:
- `npm audit` includes devDependencies; do not run `npm audit fix --force` blindly.
- `cargo audit` should be clean for release builds; update `Cargo.lock` to address advisories.
- Tauri CSP hardening is intentionally not auto-enabled because it can be breaking; discuss a CSP policy before turning it on.

## Manual Desktop QA Checklist (Product Paths)

Run the desktop app:

```bash
npm run tauri dev
```

Then validate the following flows on a real connected device:

### Devices
- Refresh devices list shows the device, no repeated error toasts.
- Selecting devices updates the global device context.
- Multi-select works as expected (Shift/Ctrl behaviors, if applicable).

### Screenshot
- Screenshot action completes and an output file is created in the configured output directory.
- Failure path: unplug device or use invalid serial; confirm the error is human readable and does not leak internals.

### Logcat
- Start logcat shows new lines, stop works, and the UI stays responsive.
- Filters (tag/text/level) apply correctly.
- Empty state is clear when no lines are available.

### File Explorer
- List directory works.
- Pull a file works (download path is clear).
- Push a small file works (overwrite toggle behaves correctly).
- Rename and delete show confirmation and have safe defaults.

### APK Installer
- Single APK install works.
- Batch/multi-device install reports per-device results clearly.
- Launch-after-install works (if enabled).

### Updater (Settings > Update)

Preconditions:
- Use an app build older than the latest release (for example `Current: 0.0.60`, `Latest: 0.0.62`).
- Run one pass with stable network and one pass with unstable network.
- On macOS, run one pass from `/Applications` and one pass from a non-writable location.

Checks:
- `Check for updates` updates the `Last checked` timestamp and shows either `Up to date` or a newer version.
- Automatic checks show an optional update modal once per version; closing it keeps the top-bar `Update` entry available without starting installation.
- Opening the update modal shows current/latest version and release notes (if available).
- While checking/installing, related action buttons are disabled and no duplicate actions are triggered.
- Success path: `Install and restart` eventually relaunches the app, or shows `Update installed. Please restart the app manually.` when relaunch fails.
- Publishing window path: if a newer GitHub release exists but updater artifacts are still publishing, the app shows an informational `Update is still publishing` state with retry guidance instead of a hard error.
- Install retry path: if install hits a transient missing-artifact condition, it retries once automatically and then lands in the same publishing-pending state (no raw internal error text).
- Permission failure path: when install cannot replace the app binary (for example, non-writable location), the message instructs moving the app to `Applications`.
- Retry path: after an error, running `Install and restart` again is still possible and behaves consistently.
- Release verification path: after pushing a `vX.Y.Z` tag, the GitHub release should be auto-created as a prerelease while automation runs, and it should not become the latest stable release until `.dmg`, `.AppImage`, `.deb`, and signed `latest.json` are uploaded.

### Bugreport / UI Inspector (if used)
- Bugreport generation progress updates and completes.
- Bugreport log viewer can search/filter without freezing.
- UI Inspector captures hierarchy and screenshot, and export works.

## UI/UX Completeness Checks

For each page, verify:
- Loading state: no layout shift that breaks reading.
- Empty state: clear next action (e.g., "Connect device" / "Refresh").
- Error state: clear message and an actionable recovery step.
- Disabled state: disabled controls are visually obvious and explain why, when possible.
- Success state: completion feedback is visible and non-technical.
