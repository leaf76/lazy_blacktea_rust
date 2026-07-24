# Usage Guide

This guide covers common day-to-day workflows.

## Devices

- If you don't see any devices, confirm `adb devices` shows your device.
- If `adb` is not in `PATH`, set an absolute ADB executable path in the app Settings.

## iOS Devices (MVP)

iOS support is inventory and observation oriented. It does not replace Xcode or full device management.

### Requirements

- **macOS:** Xcode command line tools (`devicectl`) and/or libimobiledevice tools in `PATH`. Profile install also needs Apple Configurator `cfgutil`.
- **Linux:** `usbmuxd` running plus `idevice_id` / `ideviceinfo` (optional: `idevicesyslog`, `idevicecrashreport`, `idevicescreenshot`).
- **Windows:** iOS is not supported; use Android workflows only.

### Device list

1. Unlock the iPhone/iPad and accept the trust prompt.
2. Open **Device Manager** and click **Refresh Devices**.
3. iOS rows show an **iOS** badge, UDID, name/product type, and version when available.
4. Trust problems show a short hint on the device row (locked / untrusted / unavailable).
5. iOS has **no hot-plug events**. Either refresh manually or enable **Settings → Devices → Auto-refresh iOS inventory**.

Android hot-plug still uses ADB tracking. iOS auto-refresh re-runs full discovery on an interval.

### Logs (syslog)

1. Select one online iOS device with `idevicesyslog` available.
2. Open **Logs** and click **Start**.
3. Source filters are Android-only and stay disabled for iOS.
4. **Stop** ends the stream. Export saves the visible lines from the UI buffer.

### Screenshot

1. Select an online iOS device with `idevicescreenshot` available.
2. Use the Screenshot action (same control as Android).
3. Output goes to the configured Settings output folder.

### Crash reports

1. Select one online iOS device with `idevicecrashreport` available.
2. Device menu → **Export iOS Crash Reports**.
3. Follow progress in **Task Center**. Large exports can take up to about two minutes.

### Configuration profiles (macOS only)

1. Install Apple Configurator and its `cfgutil` command-line tool.
2. Open **Profiles**, browse a `.mobileconfig`, and click **Validate**.
3. Select eligible USB-connected iOS devices and **Install Profile**.
4. Each device reports installed / failed / skipped independently. Copy the per-row `trace_id` if you need support.

### Tool check

Open **Settings → iOS Tools → Test iOS Tools** to probe host tooling (`devicectl`, libimobiledevice, `cfgutil`, `usbmuxd` socket, and optional observation tools).

## Wireless Pairing (ADB)

Wireless pairing typically requires Android 11+.

1. Make sure your phone and computer are on the same network.
2. Use the app's pairing flow (QR or pairing code, depending on your device).

## ADB Command Library

The ADB Command Library stores reusable `adb shell` commands so you can select a device,
choose a command, and run it manually.

### Add a command

1. Open Shell Commands -> ADB Shell.
2. Select one or more online Android devices in the device context selector.
3. Click Add Command.
4. Enter a title, category, shell command, optional description, tags, and risk level.
5. Click Save.

The command field accepts plain shell content such as `wm size` or a full `adb shell`
prefix such as `adb shell wm size`. The app stores only the shell content.

### Import a pack

1. Open Shell Commands -> ADB Shell.
2. Click Import Pack.
3. Select a JSON file that matches command pack v1.

Import only saves the commands. It never runs imported commands automatically.

Non-shell adb tasks are rejected. For example, `adb install app.apk`, `adb pull ...`,
`adb push ...`, and `adb reboot` are not accepted by command pack v1.

### Export custom commands

Click Export Pack to download your custom commands as
`lazy-blacktea-custom-adb-shell-pack.json`.

Export includes only custom commands. Built-in commands and imported packs are not included.

### Command pack v1

```json
{
  "version": 1,
  "id": "lazy-blacktea-example-pack",
  "name": "Lazy Blacktea Example Pack",
  "commands": [
    {
      "id": "screen-size",
      "title": "Show screen size",
      "category": "Display",
      "command": "wm size",
      "description": "Print the current physical and override display size.",
      "tags": ["display", "wm"],
      "risk": "normal"
    },
    {
      "id": "battery-status",
      "title": "Show battery status",
      "category": "Device",
      "command": "adb shell dumpsys battery",
      "description": "Print battery, power, and charging state.",
      "tags": ["battery", "dumpsys"],
      "risk": "normal"
    }
  ]
}
```

Rules:

- `version` must be `1`.
- `commands` must include at least one command.
- `risk` can be `normal` or `dangerous`.
- `command` can be plain shell content or `adb shell ...`.
- Dangerous commands require confirmation before execution.
- The example file is also available at `docs/examples/adb-command-pack.example.json`.

## Output Files

Some features export files (e.g., screenshots, UI inspector exports, bugreport analysis). The default output location is typically your system Downloads folder and can be changed in Settings.

## Configuration Files

- Config file path:
  - macOS/Linux: `~/.lazy_blacktea_config.json`
  - Windows: `%USERPROFILE%\\.lazy_blacktea_config.json`
- Override location with `LAZY_BLACKTEA_CONFIG_PATH`.

## Task Center

Long-running operations are tracked in the Task Center. It keeps a limited history to stay fast.

## Desktop Notifications

You can enable native desktop notifications for task completion.

- Open Settings -> Notifications.
- Enable "Desktop notifications".
- Click "Request permission" (macOS may prompt).
- Use "Send test" to verify notifications work.

Notes:
- On Windows, notifications may behave differently in development builds. Install the app for the best experience.
