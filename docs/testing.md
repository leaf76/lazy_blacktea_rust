# Testing

This project is a Tauri v2 + React desktop app backed by a Rust backend that shells out to system `adb`.

On macOS, you can reliably automate:
- Web UI smoke checks (run the frontend in a plain browser).
- Rust unit/integration tests.
- Real-device ADB smoke checks (without UI automation).

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
