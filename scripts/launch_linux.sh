#!/usr/bin/env bash
# Lazy Blacktea Linux AppImage Launcher Helper
# Handles environment isolation, Wayland/EGL workarounds, and FUSE diagnostics.
set -euo pipefail

USE_X11=0
USE_SOFTWARE=0
USE_EXTRACT=0
APPIMAGE_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --x11)
      USE_X11=1
      shift
      ;;
    --software)
      USE_SOFTWARE=1
      shift
      ;;
    --extract)
      USE_EXTRACT=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/launch_linux.sh [OPTIONS] [PATH_TO_APPIMAGE]

Options:
  --x11         Force X11 backend (GDK_BACKEND=x11)
  --software    Force software rendering (WEBKIT_DISABLE_COMPOSITING_MODE=1)
  --extract     Extract AppImage and run directly (bypasses FUSE requirement)
  -h, --help    Show this help message

Examples:
  ./scripts/launch_linux.sh ./Lazy.Blacktea_0.0.91_amd64.AppImage
  ./scripts/launch_linux.sh --x11
EOF
      exit 0
      ;;
    *)
      if [[ -z "$APPIMAGE_PATH" ]]; then
        APPIMAGE_PATH="$1"
      else
        echo "Unknown argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

# If no path provided, search for AppImage in current directory or Downloads
if [[ -z "$APPIMAGE_PATH" ]]; then
  shopt -s nullglob
  candidates=(./Lazy*.AppImage ~/Downloads/Lazy*.AppImage)
  shopt -u nullglob
  if [[ ${#candidates[@]} -gt 0 ]]; then
    APPIMAGE_PATH="${candidates[0]}"
    echo "Found AppImage: $APPIMAGE_PATH"
  else
    echo "Error: No AppImage specified and none found in . or ~/Downloads" >&2
    echo "Usage: $0 [OPTIONS] /path/to/Lazy.Blacktea.AppImage" >&2
    exit 1
  fi
fi

if [[ ! -f "$APPIMAGE_PATH" ]]; then
  echo "Error: File not found: $APPIMAGE_PATH" >&2
  exit 1
fi

chmod +x "$APPIMAGE_PATH"

# Environment workarounds
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export GIO_MODULE_DIR=""
export LD_LIBRARY_PATH=""

if [[ "$USE_X11" -eq 1 ]]; then
  echo "Mode: Forcing X11 backend (GDK_BACKEND=x11)"
  export GDK_BACKEND=x11
fi

if [[ "$USE_SOFTWARE" -eq 1 ]]; then
  echo "Mode: Disabling compositing (WEBKIT_DISABLE_COMPOSITING_MODE=1)"
  export WEBKIT_DISABLE_COMPOSITING_MODE=1
fi

if [[ "$USE_EXTRACT" -eq 1 ]]; then
  echo "Extracting AppImage to bypass FUSE..."
  TMP_DIR="$(mktemp -d /tmp/lazy_blacktea_extracted_XXXXXX)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  (
    cd "$TMP_DIR"
    "$APPIMAGE_PATH" --appimage-extract >/dev/null 2>&1
    ./squashfs-root/AppRun
  )
  exit 0
fi

echo "Launching: $APPIMAGE_PATH"
exec "$APPIMAGE_PATH" "$@"
