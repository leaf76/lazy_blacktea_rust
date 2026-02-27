# Lazy Blacktea

Lazy Blacktea is a desktop console for Android debugging and device operations (Tauri v2 + Rust + React).
It helps you run daily ADB workflows from one place: device management, logcat, files, APK installs, and UI inspection.

## Why use it

- One workspace for common Android diagnostics and operations
- Multi-device friendly workflow for USB and wireless debugging
- Less terminal context-switching for repetitive ADB tasks
- Built for practical day-to-day engineering use

## Download

Get the latest build from GitHub **Releases**: [Releases](../../releases)

### Packages

- macOS: `*.dmg` (preferred), `*.app` bundle (if provided)
- Linux: `*.AppImage` (portable), `*.deb` (Debian/Ubuntu-based distros)

macOS note: current builds are **unsigned**. If blocked by Gatekeeper, right-click and choose **Open**, or allow it in **System Settings -> Privacy & Security**.

## Quick start (3 minutes)

1. Install `adb` and confirm it works: `adb version`
2. Enable **USB debugging** on your Android device
3. Connect the device and verify: `adb devices`
4. Launch Lazy Blacktea and select your device
5. Start from **Device Manager** or **Logcat**

Optional: install `scrcpy` if you want screen mirroring support.

## Feature highlights

- Multi-device discovery and quick actions
- Logcat streaming with live filters, presets, search, and export
- File browser with pull/upload/rename/delete/preview
- APK install flows: single APK, multi APK, split bundles, and launch
- UI hierarchy capture with screenshot preview and XML/HTML export
- Wireless pairing helper and `scrcpy` integration
- Task Center for tracking long-running operations

## Who this is for

- Android app engineers and QA who work with real devices
- Teams that run repeated ADB routines across multiple devices
- Developers who want a faster desktop workflow around ADB

## Requirements

- `adb` available in `PATH`, or set an absolute ADB path in Settings
- Android device with USB debugging enabled

## Documentation

- Usage guide: [docs/usage.md](docs/usage.md)
- Troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md)
- Development / build from source: [docs/development.md](docs/development.md)
- Testing guide: [docs/testing.md](docs/testing.md)

## Project status

Active personal project under continuous development.
Breaking changes may happen before a stable release is announced.

## Contributing

Contributions and issue reports are welcome.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

For vulnerabilities, please use GitHub Security Advisories.
See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
