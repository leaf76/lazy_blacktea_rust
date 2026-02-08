# Tauri Backend (src-tauri/) Agent Notes

## OVERVIEW
Rust (edition 2021) backend for the Tauri v2 desktop app; exposes commands to the frontend and shells out to system tools (notably `adb`).

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Rust entry point | `src-tauri/src/main.rs` | Calls `lazy_blacktea_rust_lib::run()`; Windows subsystem attr is intentional |
| Tauri builder + command wiring | `src-tauri/src/lib.rs` | Registers plugins, manages `AppState`, sets `.invoke_handler(...)` |
| Domain logic | `src-tauri/src/app/` | ADB, logcat, perf, file ops, bugreport, UI capture |
| App config / bundling | `src-tauri/tauri.conf.json` | Build hooks + bundle metadata |
| Smoke/soak binaries | `src-tauri/src/bin/` | `smoke.rs` and `soak.rs` reuse backend logic for macOS-friendly checks |

## CONVENTIONS

- Command API contract: success `{ trace_id, data }`, error `{ error, code, trace_id }` (keep client errors user-safe).
- Use `tracing` and include `trace_id` in logs; never log secrets/tokens/PII.
- Avoid blocking the UI thread: long-running work should run in threads and report progress via events.

## ANTI-PATTERNS

- Do not remove the Windows subsystem attribute in `src-tauri/src/main.rs`.
- Do not spawn unbounded processes or run shell commands without timeouts/validation.
- Do not return internal error details directly to the frontend.
