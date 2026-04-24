# Troubleshooting

## ADB Not Found / No Devices

1. Verify `adb` works in your terminal: `adb version`
2. Verify your device shows up: `adb devices`
3. Confirm the device is in "device" state (not "unauthorized").
4. If unauthorized, unplug/replug USB and accept the RSA prompt on the phone.

Linux notes:

- You may need udev rules to access USB devices without root.

Windows notes:

- You may need an OEM USB driver for your device.

## iOS Device Does Not Appear

The iOS MVP depends on external Apple or libimobiledevice tools. The app does not bundle them.

1. In the app, open **Settings -> iOS Tools -> Test iOS Tools**.
2. On macOS, verify Xcode command line tools can locate `devicectl`:

   ```bash
   xcrun --find devicectl
   ```

3. On Linux Ubuntu/Debian, install libimobiledevice and start `usbmuxd`:

   ```bash
   sudo apt install usbmuxd libimobiledevice-utils
   sudo systemctl enable --now usbmuxd
   ```

   `devicectl` is macOS/Xcode-only and is not required on Linux.

4. If using libimobiledevice, verify the tools are in `PATH`:

   ```bash
   idevice_id -l
   ideviceinfo -u "IOS_UDID"
   ```

5. Unlock the iPhone, reconnect USB, and accept the trust prompt.
6. If the device is visible but details are missing, keep the phone unlocked and run `ideviceinfo -u "IOS_UDID"` to confirm the trust state.

Common causes:

- The iPhone is locked or has not trusted this computer.
- Xcode command line tools are not installed or `xcode-select` points to the wrong developer directory.
- libimobiledevice is not installed or not visible in `PATH`.
- Developer Mode or pairing state is incomplete for the specific operation.

Linux-specific checks:

- If `idevice_id -l` returns nothing, confirm the USB cable, unlock the phone, accept trust, and verify `usbmuxd` is running:

  ```bash
  systemctl status usbmuxd
  ```

- If `ideviceinfo` fails with a pairing or lockdown error, reconnect the iPhone and accept the trust prompt again.
- If USB access fails as a normal user, install your distro's iOS/libimobiledevice udev rules or test from a shell with the expected USB permissions.
- If ADB is missing but libimobiledevice works, iOS devices should still appear. ADB is only required for Android functionality.

## iOS Syslog Does Not Start

1. Verify `idevicesyslog` is available:

   ```bash
   idevicesyslog --version
   ```

2. Confirm the iPhone is trusted and visible:

   ```bash
   idevice_id -l
   ```

3. Start Logs again in the app. Source filters are Android-only and are ignored for iOS syslog.

If `idevicesyslog` is missing, the iPhone can still appear in Device Manager, but live iOS logs are disabled.

## iOS Crash Report Export Fails

Crash report export requires `idevicecrashreport`.

```bash
idevicecrashreport --version
```

Confirm the output folder is writable and the iPhone is trusted. The app writes crash reports only to the configured local output folder or an explicitly selected folder.

## macOS: App Blocked (Unsigned Build)

If macOS says the app cannot be opened:

- Right-click the app and choose **Open**, then confirm.
- Or go to **System Settings -> Privacy & Security** and allow the app.

## scrcpy Does Not Launch

If mirroring fails:

1. Verify `scrcpy` is installed and available in `PATH`.
2. Try running `scrcpy` directly in your terminal to see the error output.

## GitHub Release Upload Missing Binaries

If a release page temporarily shows `assets: []` for a new tag:

1. The release workflow is asynchronous. Check workflow status first:

   - `gh run list --workflow "Release (macOS, Linux)" --limit 5`
   - `gh run view <run-id> --json status,conclusion`

2. Inspect macOS and Linux build jobs:

   - `gh api repos/leaf76/lazy_blacktea_rust/actions/runs/<run-id>/jobs --jq '.jobs[] | {name, status, conclusion}'`

3. Re-check the release assets after the run is `completed`:

   - `gh release view vX.Y.Z --json assets`

4. Confirm the release is still marked as a prerelease while assets are uploading:

   - `gh release view vX.Y.Z --json isPrerelease,isLatest`

5. If assets are still missing after a successful run, review the updated upload logs in:

   - `gh run view <run-id> --log`

6. After the workflow completes, verify the release was promoted to latest stable only after installers are present:

   - `gh release view vX.Y.Z --json isPrerelease,isLatest,assets`

Recent workflow change added in this repo verifies artifact presence before upload and uploads with retries:

- `Upload updater assets to GitHub Release` (with retry + `--clobber`)
- `Upload macOS assets to GitHub Release` (with retry + `--clobber`)
- `Upload Linux assets to GitHub Release` (with retry + `--clobber`)
- `Upload latest.json to GitHub Release` (with retry + `--clobber`)

It also marks the release as a prerelease while assets publish and promotes it to latest stable only after required assets are present, including `latest.json` for signed updater builds. If promotion does not happen, inspect the `Verify release assets are ready` or `Promote release to latest stable` steps first.

Release creation is tag-driven: pushing `vX.Y.Z` starts `release.yml`, and the workflow creates or reuses the GitHub release for that tag before uploading assets.
