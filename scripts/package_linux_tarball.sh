#!/usr/bin/env bash
# Lazy Blacktea Linux Portable Tarball Packager
# Packages the compiled binary and desktop assets into a portable tar.gz (zero FUSE / zero sudo)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION="$(python3 -c "import json; print(json.load(open('$ROOT_DIR/package.json'))['version'])")"
TARGET_DIR="$ROOT_DIR/src-tauri/target/release"

BINARY_PATH=""
for candidate in \
  "$TARGET_DIR/lazy_blacktea_rust" \
  "$TARGET_DIR/lazy-blacktea" \
  "$TARGET_DIR/lazy_blacktea"; do
  if [[ -f "$candidate" ]]; then
    BINARY_PATH="$candidate"
    break
  fi
done

if [[ -z "$BINARY_PATH" ]]; then
  echo "Error: Binary not found in $TARGET_DIR (checked lazy_blacktea_rust, lazy-blacktea)" >&2
  exit 1
fi

BUNDLE_TAR_DIR="$TARGET_DIR/bundle/tarball"
mkdir -p "$BUNDLE_TAR_DIR"

STAGE_DIR="$(mktemp -d /tmp/lazy_blacktea_tar_XXXXXX)"
trap 'rm -rf "$STAGE_DIR"' EXIT

APP_DIR="$STAGE_DIR/lazy-blacktea"
mkdir -p "$APP_DIR"

echo "Copying binary from $BINARY_PATH..."
cp "$BINARY_PATH" "$APP_DIR/lazy-blacktea"
chmod +x "$APP_DIR/lazy-blacktea"

# Copy icons if present
if [[ -d "$ROOT_DIR/src-tauri/icons" ]]; then
  mkdir -p "$APP_DIR/icons"
  cp -r "$ROOT_DIR/src-tauri/icons"/* "$APP_DIR/icons/"
fi

# Create desktop launcher
cat <<'EOF' > "$APP_DIR/lazy-blacktea.desktop"
[Desktop Entry]
Name=Lazy Blacktea
Comment=Lazy Blacktea Android Device Manager
Exec=./lazy-blacktea
Icon=icons/128x128.png
Terminal=false
Type=Application
Categories=Development;Utility;
EOF
chmod +x "$APP_DIR/lazy-blacktea.desktop"

# Create startup script that ensures environment isolation
cat <<'EOF' > "$APP_DIR/launch.sh"
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export GIO_MODULE_DIR=""
export LD_LIBRARY_PATH=""
exec "$DIR/lazy-blacktea" "$@"
EOF
chmod +x "$APP_DIR/launch.sh"

cat <<'EOF' > "$APP_DIR/README.txt"
Lazy Blacktea Portable (Linux x86_64)
=====================================

To launch the application:
  ./launch.sh
or:
  ./lazy-blacktea

Requirements:
- WebKitGTK (libwebkit2gtk-4.1) and GTK 3
- Zero FUSE required
- Zero root/sudo required
EOF

OUT_TAR="$BUNDLE_TAR_DIR/Lazy.Blacktea_${VERSION}_amd64.tar.gz"
echo "Creating portable tarball: $OUT_TAR"
tar -czf "$OUT_TAR" -C "$STAGE_DIR" lazy-blacktea

echo "Verifying portable tarball..."
tar -tzf "$OUT_TAR" | head -n 10
echo "Portable tarball created successfully: $OUT_TAR"
