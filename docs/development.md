# Development

This page is for building and running Lazy Blacktea from source.

## Prerequisites

- Node.js + npm
- Rust (latest stable)
- `adb` available in `PATH` (or configure an absolute ADB path in the app Settings)
- Optional: `scrcpy` for device mirroring

### Optional iOS host tools

iOS features are host-tool dependent and are not bundled with the app.

| Host | For inventory | For observation / extras |
| --- | --- | --- |
| macOS | Xcode CLT (`xcrun --find devicectl`) and/or libimobiledevice | `idevicesyslog`, `idevicecrashreport`, `idevicescreenshot`; `cfgutil` for profile install |
| Linux | `usbmuxd` + `libimobiledevice-utils` (`idevice_id`, `ideviceinfo`) | same optional tools as above |
| Windows | Android only in this project | iOS unsupported |

Quick checks:

```bash
# macOS
xcrun --find devicectl
cfgutil help

# Linux
sudo systemctl enable --now usbmuxd
idevice_id -l
ideviceinfo -u "IOS_UDID"
```

## Run in Dev Mode

```bash
npm install
npm run tauri dev
```

## Build (Release)

```bash
npm install
npm run tauri build
```

Tauri outputs bundles under `src-tauri/target/` depending on your OS.

## Tests / Checks

```bash
npm run test

cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```

## Smoke Testing

See `docs/testing.md` for macOS-friendly smoke checks (web UI + Rust tests + real-device ADB smoke).

## Contributing

See `CONTRIBUTING.md` for guidelines and PR expectations.
