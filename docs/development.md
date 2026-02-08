# Development

This page is for building and running Lazy Blacktea from source.

## Prerequisites

- Node.js + npm
- Rust (latest stable)
- `adb` available in `PATH` (or configure an absolute ADB path in the app Settings)
- Optional: `scrcpy` for device mirroring

## Run in Dev Mode

```bash
npm install
npm run tauri dev
```

## Build (Release)

```bash
npm install
npm run tauri build
```

Tauri outputs bundles under `src-tauri/target/` depending on your OS.

## Tests / Checks

```bash
npm run test

cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```

## Smoke Testing

See `docs/testing.md` for macOS-friendly smoke checks (web UI + Rust tests + real-device ADB smoke).

## Contributing

See `CONTRIBUTING.md` for guidelines and PR expectations.
