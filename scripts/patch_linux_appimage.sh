#!/usr/bin/env bash
# Lazy Blacktea Linux AppImage Wayland Patch Helper
# Strips bundled libwayland* libraries from AppImage to avoid Mesa/EGL ABI collisions
set -euo pipefail

APPIMAGE_PATH="${1:-}"

if [[ -z "$APPIMAGE_PATH" ]]; then
  shopt -s nullglob
  candidates=(src-tauri/target/release/bundle/appimage/*.AppImage)
  shopt -u nullglob
  if [[ ${#candidates[@]} -gt 0 ]]; then
    APPIMAGE_PATH="${candidates[0]}"
  else
    echo "Error: No AppImage path provided and none found in src-tauri/target/release/bundle/appimage/" >&2
    exit 1
  fi
fi

if [[ ! -f "$APPIMAGE_PATH" ]]; then
  echo "Error: File not found: $APPIMAGE_PATH" >&2
  exit 1
fi

echo "Patching AppImage: $APPIMAGE_PATH"

WORK_DIR="$(mktemp -d /tmp/lazy_blacktea_patch_XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

ABS_APPIMAGE="$(readlink -f "$APPIMAGE_PATH" 2>/dev/null || realpath "$APPIMAGE_PATH" 2>/dev/null || echo "$APPIMAGE_PATH")"
chmod +x "$ABS_APPIMAGE"

cd "$WORK_DIR"
echo "Extracting AppImage for inspection..."
"$ABS_APPIMAGE" --appimage-extract >/dev/null

echo "Stripping bundled Wayland client/EGL libraries to enforce host driver compatibility..."
find squashfs-root/usr/lib -name "libwayland*.so*" -delete 2>/dev/null || true

# Prepare appimagetool without requiring FUSE
if ! command -v appimagetool >/dev/null 2>&1; then
  TOOL_DIR="/tmp/appimagetool-tool"
  if [[ ! -x "$TOOL_DIR/AppRun" ]]; then
    echo "Downloading appimagetool..."
    mkdir -p "$TOOL_DIR"
    curl -fsSL -o /tmp/appimagetool.AppImage https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
    chmod +x /tmp/appimagetool.AppImage
    (
      cd /tmp
      ./appimagetool.AppImage --appimage-extract >/dev/null 2>&1
      rm -rf "$TOOL_DIR"
      mv squashfs-root "$TOOL_DIR"
      rm -f /tmp/appimagetool.AppImage
    )
  fi
  APPIMAGETOOL="$TOOL_DIR/AppRun"
else
  APPIMAGETOOL="appimagetool"
fi

PATCHED_OUTPUT="$WORK_DIR/patched.AppImage"
echo "Repacking patched AppImage..."
ARCH=x86_64 "$APPIMAGETOOL" squashfs-root "$PATCHED_OUTPUT" >/dev/null 2>&1 || \
ARCH=x86_64 "$APPIMAGETOOL" --appimage-extract-and-run squashfs-root "$PATCHED_OUTPUT" >/dev/null

chmod +x "$PATCHED_OUTPUT"
cp "$PATCHED_OUTPUT" "$ABS_APPIMAGE"
echo "Successfully patched $APPIMAGE_PATH (removed bundled libwayland)"
