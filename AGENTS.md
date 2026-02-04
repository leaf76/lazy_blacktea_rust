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
| App shell + routing | `src/App.tsx`, `src/App.css`, `src/main.tsx` | Sidebar, dashboard, HashRouter |
| Primary device selector | `src/App.tsx`, `src/App.css` | Auto-selects first online device after refresh; top bar device context popover |
| Global device selection panel | `src/App.tsx`, `src/App.css` | Top bar device context popover for multi-select across pages, with recent/group sections and keyboard navigation |
| Device Manager layout | `src/App.tsx`, `src/App.css` | Filter toolbar, grid device rows, sticky command bar, Shift/Ctrl selection |
| Layout tokens | `src/App.css` | Compact density, page-section/page-header styles, system theme variables |
| Settings layout | `src/App.tsx`, `src/App.css` | Settings page grid, fixed label column, responsive density, and actions layout |
| Logcat layout | `src/App.tsx`, `src/App.css` | Compact advanced panel with scroll to preserve log viewport |
| Logcat toolbar | `src/App.tsx`, `src/App.css` | Grouped primary/secondary actions, compact spacing |
| Logcat filters | `src/App.tsx`, `src/App.css` | Live filters always visible, presets via dropdown + save row |
| Logcat filter layout | `src/App.tsx`, `src/App.css` | Inline filter rows + ultra-compact presets |
| Logcat filter UX | `src/App.tsx`, `src/App.css` | Active filters collapsed with expand toggle |
| Logcat compact layout | `src/App.tsx`, `src/App.css` | Tightened spacing + inline labels to reduce height |
| APK installer | `src/App.tsx` | Single/multi/bundle install flow + launch |
| Logcat helpers | `src/logcat.ts` | Filter/regex/search utilities |
| UI inspector export | `src-tauri/src/app/commands.rs` | capture/export UI hierarchy + screenshot |
| Wireless pairing | `src-tauri/src/app/commands.rs`, `src/api.ts`, `src/App.tsx` | adb pair/connect flow |
| Pairing helpers | `src/pairing.ts` | QR/pair output parsing + reducer |

## CONVENTIONS

- Commands return `{ trace_id, data }`. Errors return `{ error, code, trace_id }`.
- Always include a trace_id in logs.
- Use system `adb` (no bundled binary). Users can also set a full ADB executable path in Settings.
- File Explorer uses `adb ls/pull/push` plus `mkdir/mv/rm` for browsing, download/upload, and basic file management.
- Task Center keeps the last 50 tasks and persists across restarts.
- File transfers emit progress events when the installed `adb` supports `-p` (fallback is automatic).
- Avoid blocking UI: long tasks are handled in Rust threads.
- Config stored at `~/.lazy_blacktea_config.json` (or `%USERPROFILE%\\.lazy_blacktea_config.json` on Windows) with legacy compatibility.
- Tauri plugins in use: opener, dialog, clipboard-manager.

## COMMANDS

```bash
# Install deps
npm install

# Run dev app
npm run tauri dev

# Frontend tests
npm run test

# Rust checks
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```

## UI/UX Artifacts

- `brief.md`: Redesign brief and assumptions.
- `uiux/`: UI/UX audit, plan, tokens, and backlog for the redesign.
- `uiux/device-manager/`: Device Manager optimization artifacts (Gemini CLI).
- Decisions: wireless ADB pairing and live UI inspector mirror support.
