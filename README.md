# Lazy Blacktea

Lazy Blacktea is a desktop console for Android device automation (Tauri v2 + Rust + React). It focuses on day-to-day workflows like multi-device management, logcat, files, APK installs, and UI inspection, powered by Android Debug Bridge (ADB).

## Project Status

This is an actively developed personal project. Breaking changes may happen between versions until a stable release is announced.

## Download

Download the latest build from the GitHub **Releases** page: [Releases](../../releases)

### macOS

- Preferred: `*.dmg`
- Alternative: `*.app` bundle (if provided)

Note: builds are currently **unsigned**, so macOS Gatekeeper may block the first launch. If blocked, right-click the app and choose **Open**, or allow it in **System Settings -> Privacy & Security**.

### Linux

- `*.AppImage` (portable)
- `*.deb` (Debian/Ubuntu-based distros)

## Requirements

- `adb` installed and available in `PATH` (or set an absolute ADB path in the app Settings)
- An Android device with **USB debugging** enabled
- Optional: `scrcpy` for device mirroring

## First Run Checklist

1. Connect your device via USB and accept the RSA prompt on the phone (if prompted).
2. Verify your device is visible: `adb devices`
3. Launch Lazy Blacktea, pick your device, and start from **Device Manager** or **Logcat**.

## Key Features (High Level)

- Multi-device discovery and quick actions
- Logcat streaming with filters/search/presets and export
- File browser (pull/upload/rename/delete/preview)
- APK install flows (single, multi, split bundles) + launch
- UI hierarchy capture with screenshot preview + XML/HTML export
- Wireless pairing helper and scrcpy integration

## Documentation

- Usage guide: `docs/usage.md`
- Troubleshooting: `docs/troubleshooting.md`
- Development / building from source: `docs/development.md`

If you'd like a GitHub Wiki, you can also enable it in repo settings and link it here.

## Contributing

See `CONTRIBUTING.md`.

## Security

For vulnerabilities, please use GitHub Security Advisories. See `SECURITY.md`.

## License

MIT. See `LICENSE`.
