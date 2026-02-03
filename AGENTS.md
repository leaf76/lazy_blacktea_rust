# LAZY BLACKTEA RUST KNOWLEDGE BASE

**Generated:** 2026-02-03  
**Branch:** main

## OVERVIEW

Tauri v2 + React desktop app for Android device automation via ADB. Rust commands handle device discovery, operations, logcat streaming, file browsing, and UI hierarchy rendering.

## STRUCTURE

```
lazy_blacktea_rust/
├── src/                     # React UI (device console, operations, logcat, files)
├── src-tauri/               # Rust backend + Tauri config
│   ├── src/app/             # Backend modules
│   │   ├── adb/             # ADB parsing + runner + app helpers
│   │   ├── bluetooth/       # Bluetooth monitoring helpers
│   │   ├── commands.rs      # Tauri commands
│   │   ├── config.rs        # Config load/save + legacy migration
│   │   ├── models.rs        # Shared data types
│   │   ├── ui_xml.rs        # UI hierarchy rendering
│   │   └── state.rs         # Process registries
│   └── tauri.conf.json      # App metadata and bundling
└── README.md
```

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| ADB parsing | `src-tauri/src/app/adb/parse.rs` | Pure functions + tests |
| App package parsing | `src-tauri/src/app/adb/apps.rs` | `pm list packages` parsing |
| ADB execution | `src-tauri/src/app/adb/runner.rs` | Timeout wrapper, no silent failures |
| Tauri commands | `src-tauri/src/app/commands.rs` | All app-facing APIs |
| UI hierarchy | `src-tauri/src/app/ui_xml.rs` | XML → HTML renderer |
| Frontend API | `src/api.ts` | Tauri invoke wrappers |
| Frontend UI | `src/App.tsx` | Device console layout |

## CONVENTIONS

- Commands return `{ trace_id, data }`. Errors return `{ error, code, trace_id }`.
- Always include a trace_id in logs.
- Use system `adb` (no bundled binary).
- Avoid blocking UI: long tasks are handled in Rust threads.
- Config stored at `~/.lazy_blacktea_config.json` with legacy compatibility.
- Tauri plugins in use: opener, dialog, clipboard-manager.

## COMMANDS

```bash
# Install deps
npm install

# Run dev app
npm run tauri dev

# Rust checks
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```
