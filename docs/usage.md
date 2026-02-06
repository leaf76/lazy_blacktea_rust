# Usage Guide

This guide covers common day-to-day workflows.

## Devices

- If you don't see any devices, confirm `adb devices` shows your device.
- If `adb` is not in `PATH`, set an absolute ADB executable path in the app Settings.

## Wireless Pairing (ADB)

Wireless pairing typically requires Android 11+.

1. Make sure your phone and computer are on the same network.
2. Use the app's pairing flow (QR or pairing code, depending on your device).

## Output Files

Some features export files (e.g., screenshots, UI inspector exports, bugreport analysis). The default output location is typically your system Downloads folder and can be changed in Settings.

## Configuration Files

- Config file path:
  - macOS/Linux: `~/.lazy_blacktea_config.json`
  - Windows: `%USERPROFILE%\\.lazy_blacktea_config.json`
- Override location with `LAZY_BLACKTEA_CONFIG_PATH`.

## Task Center

Long-running operations are tracked in the Task Center. It keeps a limited history to stay fast.
