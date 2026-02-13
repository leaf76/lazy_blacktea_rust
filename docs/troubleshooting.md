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

4. If assets are still missing after a successful run, review the updated upload logs in:

   - `gh run view <run-id> --log`

Recent workflow change added in this repo verifies artifact presence before upload and uploads with retries:

- `Upload updater assets to GitHub Release` (with retry + `--clobber`)
- `Upload macOS assets to GitHub Release` (with retry + `--clobber`)
- `Upload Linux assets to GitHub Release` (with retry + `--clobber`)
- `Upload latest.json to GitHub Release` (with retry + `--clobber`)

It also fails early if build outputs are missing, so broken releases stop at a clear step instead of publishing an empty asset list.
