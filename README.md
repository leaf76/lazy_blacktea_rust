# Lazy Blacktea

Lazy Blacktea is a desktop console for mobile device operations (Tauri v2 + Rust + React).
It helps you run daily Android ADB workflows from one place and can also surface iOS devices for basic inventory and observation.

## Why use it

- One workspace for common Android diagnostics and iOS device inventory
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

Optional for iOS inventory:

- macOS: install Xcode command line tools for `devicectl`, or install libimobiledevice tools.
- Linux Ubuntu/Debian: install libimobiledevice and enable `usbmuxd`:

```bash
sudo apt install usbmuxd libimobiledevice-utils
sudo systemctl enable --now usbmuxd
idevice_id -l
ideviceinfo -u "IOS_UDID"
```

`devicectl` is macOS/Xcode-only and is not required on Linux.

## Feature highlights

- Multi-device discovery and quick actions
- Cross-platform device list with Android/iOS platform badges
- Logcat streaming with live filters, presets, search, and export
- iOS syslog streaming when `idevicesyslog` is available
- File browser with pull/upload/rename/delete/preview
- APK install flows: single APK, multi APK, split bundles, and launch
- UI hierarchy capture with screenshot preview and XML/HTML export
- Wireless pairing helper and `scrcpy` integration
- Task Center for tracking long-running operations

## Platform capabilities

| Capability | Android | iOS MVP |
| --- | --- | --- |
| Device list and basic info | Yes, via `adb` | Yes, via `devicectl` or libimobiledevice |
| Live logs | Yes, logcat | Yes, syslog when `idevicesyslog` is available |
| Crash report export | No dedicated Android flow | Yes, when `idevicecrashreport` is available |
| Shell commands | Yes | No |
| File browser and file mutation | Yes | No |
| APK / app install workflow | Yes | No |
| Screenshot, screen record, mirroring | Yes | No |
| Wi-Fi, Bluetooth, reboot controls | Yes | No |

## Who this is for

- Mobile app engineers and QA who work with Android and iOS devices
- Teams that run repeated ADB routines across multiple devices
- Developers who want a faster desktop workflow around ADB

## Requirements

- `adb` available in `PATH`, or set an absolute ADB path in Settings
- Android device with USB debugging enabled
- For iOS inventory on macOS: Xcode command line tools or libimobiledevice tools available in `PATH`
- For iOS inventory on Linux: `usbmuxd` running plus `idevice_id` and `ideviceinfo`; `idevicesyslog` and `idevicecrashreport` enable optional observation features

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
