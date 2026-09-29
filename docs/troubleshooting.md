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

## macOS: ADB Blocked by Gatekeeper

If macOS shows "`adb` can't be opened because it was not downloaded from the App Store",
Lazy Blacktea may report ADB as unavailable before any Android device can be listed. This
usually means the selected `adb` executable is quarantined by macOS.

Check the selected binary without running it:

```bash
xattr -l "/path/to/adb"
spctl --assess --type execute --verbose=4 "/path/to/adb"
```

Safer recovery options:

1. In Lazy Blacktea, open **Settings -> ADB** and select a trusted Android SDK
   `platform-tools/adb` binary, such as `~/Library/Android/sdk/platform-tools/adb`.
2. Reinstall Android Platform Tools from Android Studio SDK Manager or Homebrew, then test
   the new `adb` path.
3. Only if you trust the exact binary, remove quarantine yourself:

   ```bash
   xattr -d com.apple.quarantine "/path/to/adb"
   ```

Lazy Blacktea does not remove quarantine automatically.

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

Common human-readable failures:

- Locked / passcode → unlock the phone
- Pairing / lockdown / trust → reconnect USB and accept Trust This Computer
- No device / disconnected → cable, `usbmuxd`, then Refresh Devices

## iOS Crash Report Export Fails

Crash report export requires `idevicecrashreport`.

```bash
idevicecrashreport --version
```

Confirm the output folder is writable and the iPhone is trusted. The app writes crash reports only to the configured local output folder or an explicitly selected folder.

Large exports can take up to about two minutes. Watch **Task Center** for success or error instead of assuming a hang.

## iOS Screenshot Fails

Screenshot on iOS requires `idevicescreenshot`.

```bash
idevicescreenshot --version
```

If the tool is missing, the device row will not expose screenshot capability. Android screenshots are unaffected.

## iOS List Stale After Plug / Unplug

iOS has no ADB-style hot-plug stream. Either:

1. Click **Refresh Devices**, or
2. Enable **Settings → Devices → Auto-refresh iOS inventory**

## iOS Configuration Profile Install Fails

Configuration profile install is macOS-only in the MVP and requires Apple Configurator `cfgutil`.

1. Install Apple Configurator from the App Store.
2. In Apple Configurator, install the command-line tool, then verify:

   ```bash
   cfgutil help
   cfgutil list
   ```

3. In the app, open **Settings -> iOS Tools -> Test iOS Tools** and confirm `cfgutil` is `available`.
4. Connect the iPhone over USB, unlock it, and accept the trust prompt.
5. Open **Profiles**, validate the `.mobileconfig`, select eligible iOS devices, then install.

Common causes:

- `cfgutil` is missing or not in `PATH`.
- The iPhone is locked, untrusted, or not visible in `cfgutil list`.
- The profile has the same identifier as an existing profile and the device rejects the update.
- The profile requires supervision, missing user input, or a payload that cannot be installed silently.
- The profile contains an MDM enrollment or network-dependent payload and the device is not ready for that step.

Linux note: this app does not install `.mobileconfig` through libimobiledevice. Use MDM, Apple Configurator on macOS, or user-guided installation for Linux workflows.

## macOS: App Blocked (Unsigned Build)

If macOS says the app cannot be opened:

- Right-click the app and choose **Open**, then confirm.
- Or go to **System Settings -> Privacy & Security** and allow the app.

## scrcpy Does Not Launch

If mirroring fails:

1. Verify `scrcpy` is installed and available in `PATH`.
2. Try running `scrcpy` directly in your terminal to see the error output.

## Linux: AppImage Fails to Launch / WebKitGTK EGL Errors

If launching the Linux AppImage fails with errors such as:

```text
/usr/lib/x86_64-linux-gnu/gvfs/libgvfscommon.so: undefined symbol: g_variant_builder_init_static
Failed to load module: /usr/lib/x86_64-linux-gnu/gio/modules/libgvfsdbus.so
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

### 1. Active Conda Environment or GIO Module Mismatch (`undefined symbol: g_variant_builder_init_static`)

If you run the AppImage inside an active Conda environment (e.g. `(base)` prompt) or on a distribution with newer GIO modules, the dynamic linker may load an older `libglib-2.0.so` that conflicts with the host system's GVFS modules (`libgvfsdbus.so`).

- Deactivate Conda before running:
  ```bash
  conda deactivate
  ./Lazy.Blacktea_*.AppImage
  ```
- Or clear `LD_LIBRARY_PATH` and isolate `GIO_MODULE_DIR` for that invocation:
  ```bash
  LD_LIBRARY_PATH="" GIO_MODULE_DIR="" ./Lazy.Blacktea_*.AppImage
  ```

### 2. WebKitGTK Hardware Acceleration Conflicts (`EGL_BAD_PARAMETER`)

WebKitGTK's hardware-accelerated DMA-BUF renderer can fail to initialize EGL displays on certain Linux compositors (particularly Wayland, NVIDIA proprietary drivers, or Mesa driver mismatches with bundled AppImage libraries).

- Disable DMA-BUF renderer (set automatically in newer builds):
  ```bash
  WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Lazy.Blacktea_*.AppImage
  ```
- If running under Wayland still fails, fallback to software compositing or force X11 / XWayland:
  ```bash
  WEBKIT_DISABLE_COMPOSITING_MODE=1 ./Lazy.Blacktea_*.AppImage
  # or
  GDK_BACKEND=x11 ./Lazy.Blacktea_*.AppImage
  ```
- If the bundled Wayland client library causes ABI mismatch:
  ```bash
  LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libwayland-client.so.0 ./Lazy.Blacktea_*.AppImage
  ```

### 3. FUSE Missing on Ubuntu 24.04+ (`dlopen(): error loading libfuse.so.2`)

Ubuntu 24.04 ships with FUSE 3 by default. Running Type 2 AppImages may require installing the FUSE 2 compatibility library:

```bash
sudo apt install libfuse2t64
# On older Ubuntu 22.04:
# sudo apt install libfuse2
```

### 4. Wayland Clipboard Fallback Warning

If you see:

```text
WARN: Tried to initialize the wayland data control protocol clipboard, but failed. Falling back to the X11 clipboard protocol.
```

This is a non-fatal warning from `arboard` (clipboard manager) indicating that your Wayland compositor (such as GNOME Wayland) does not support the `wlr-data-control` protocol extension. The clipboard manager automatically and safely falls back to the X11 clipboard protocol.

### 5. Quick Launch Helper Script

You can use the helper script included in the repository to automatically apply all Linux environment fixes:

```bash
# Standard launch with isolation and DMA-BUF workaround
./scripts/launch_linux.sh ./Lazy.Blacktea_*.AppImage

# Force X11 backend if Wayland has issues
./scripts/launch_linux.sh --x11 ./Lazy.Blacktea_*.AppImage

# Bypass FUSE requirement by extracting and running
./scripts/launch_linux.sh --extract ./Lazy.Blacktea_*.AppImage
```

### 6. Recommended Alternative: Native `.deb` Package

On Ubuntu or Debian, install the native `.deb` package provided on GitHub Releases instead of AppImage:

```bash
sudo apt install ./Lazy.Blacktea_*_amd64.deb
```

Native packages link against your host system's WebKitGTK and Mesa libraries directly, avoiding AppImage bundling conflicts.

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
