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
