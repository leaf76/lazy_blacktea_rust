# Agent Instructions (Read First)

These rules are **always on** for any automated agent work in this repository.

## Language

- Use **English only** for: code, comments, logs, config, UI strings, and commit messages.
- Use **Traditional Chinese (Taiwan)** for: planning and explanations in chat.

## Core Rules

- If requirements, scope, acceptance criteria, or constraints are unclear: **ask before coding**.
- Do **not** modify, revert, delete, or refactor unrelated code or files.
- Do **not** remove or revert changes without explicit user approval.
- No hardcoded secrets, credentials, or environment-specific config.
- No SQL string concatenation; all SQL must be parameterized.
- No silent error swallowing (no empty `catch`, no ignored `Result` without intent).
- Do not experiment directly in production environments.

## Default Flow

Follow this flow unless explicitly allowed otherwise:

1. Clarify
2. Plan
3. TDD
4. Implement
5. Summary

Notes:
- If TDD is skipped, explicitly state why and how correctness is verified.
- Auth, payments, permissions, and data mutation require TDD plus integration tests.

## Security (Always On)

- Least-privilege access.
- Validate all external input (including device output and user-provided paths).
- Never log secrets, tokens, or PII.

## Logging & Traceability (Server-side / Integrations)

- Use `X-Request-ID` if provided; otherwise generate UUID v4.
- Include `trace_id` in all logs and error responses.
- Logs must be JSON in production.

### Error Response Contract (API/server-side)

Return to clients only (no internal details):

```json
{
  "error": "Human readable message",
  "code": "ERR_xxx",
  "trace_id": "uuid-v4"
}
```

## Error Handling (When Applicable)

- Classify errors: validation, business, system, dependency.
- Log stack traces for system errors (but keep client errors user-safe).
- Retry only idempotent operations.
- Use bounded exponential backoff for retries.
- Define timeouts (rule of thumb: API ~10s, DB ~5s).

## UI / UX (User-facing)

- Do not change UI/UX behavior without explicit intent or approval.
- Preserve established interaction patterns unless a change is required.
- All user-visible states must be handled: Loading, Empty, Error, Disabled, Success (if applicable).
- Error messages must be human-readable and must not expose technical/internal details.
- Avoid layout shifts during loading where reasonably possible.
- Do not degrade accessibility compared to existing behavior.

## Backend Compatibility

- Do not break API contracts without versioning or approval.
- DB schema changes require safe rollout (expand, migrate, contract).

## Files & Repo Hygiene

- Check file size before reading large files (`wc -l`) and prefer partial reads (`rg`, `sed -n`).
- Do not dump large files blindly into chat.

## Testing (This Repo)

Preferred commands:

```bash
scripts/smoke_all.sh
scripts/security_audit.sh
```

macOS note:
- Full desktop UI automation for the Tauri WebView is limited on macOS.
- Prefer: browser-mode UI smoke + Rust backend smoke/soak + real-device ADB smoke.
- See `docs/testing.md` for the manual desktop QA checklist (product paths).

During any manual testing (DevTools / adb / real devices), always verify:
- Functionality: core flows work without errors.
- UI/UX: layout, feedback, and interactions are usable.
- Regressions: no new obvious breakage introduced.

---

# Project Knowledge Base

**Generated:** 2026-02-08  
**Commit:** 8e599e7  
**Branch:** master

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
│   │   ├── commands/        # Tauri commands (invoke surface)
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
| Tauri commands | `src-tauri/src/app/commands/mod.rs` | All app-facing APIs |
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
| UI inspector export | `src-tauri/src/app/commands/mod.rs` | capture/export UI hierarchy + screenshot |
| Bugreport analysis | `src-tauri/src/app/bugreport_analysis.rs`, `src/App.tsx` | local parser + right-side analysis panel |
| Bugreport log viewer | `src-tauri/src/app/bugreport_logcat.rs`, `src/App.tsx` | cached index + filterable log viewer |
| Wireless pairing | `src-tauri/src/app/commands/mod.rs`, `src/api.ts`, `src/App.tsx` | adb pair/connect flow |
| Pairing helpers | `src/pairing.ts` | QR/pair output parsing + reducer |

## CONVENTIONS

- Commands return `{ trace_id, data }`. Errors return `{ error, code, trace_id }`.
- Always include a trace_id in logs.
- Use system `adb` (no bundled binary). Users can also set a full ADB executable path in Settings.
- File Explorer uses `adb ls/pull/push` plus `mkdir/mv/rm` for browsing, download/upload, and basic file management.
- Task Center keeps the last 50 tasks and persists across restarts.
- File transfers emit progress events when the installed `adb` supports `-p` (fallback is automatic).
- Device refresh uses a fast summary fetch before loading detailed fields in the background.
- WiFi/Bluetooth toggles update device state immediately and then re-sync details.
- Copy Device Info writes a Markdown bullet list to the clipboard.
- Screenshot capture falls back to `adb pull` when `exec-out` fails, with sanitized filenames.
- scrcpy launch reports immediate failures if the process exits on startup.
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

## AGENTS.md Hierarchy

- `src/AGENTS.md`: Frontend conventions and hotspots.
- `src-tauri/AGENTS.md`: Tauri backend entry points and build/test automation.
- `src-tauri/src/app/AGENTS.md`: Backend modules and command plumbing.
- `uiux/AGENTS.md`: UI/UX artifacts and how to use them.
