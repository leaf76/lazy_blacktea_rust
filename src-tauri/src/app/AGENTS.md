# Backend Domain (src-tauri/src/app/) Agent Notes

## OVERVIEW
Backend domain modules backing Tauri commands: device discovery, ADB operations, logcat streaming, file browsing, perf monitoring, and UI hierarchy capture.

## STRUCTURE

| Area | Location | Notes |
| --- | --- | --- |
| Tauri command implementations | `src-tauri/src/app/commands/mod.rs` | Large module; defines `#[tauri::command]` APIs and internal helpers |
| Command tests | `src-tauri/src/app/commands/tests.rs` | Unit tests for command-adjacent logic |
| ADB core | `src-tauri/src/app/adb/` | Runner, parsers, file transfer, scrcpy helpers |
| Shared types | `src-tauri/src/app/models.rs` | DTOs shared across commands and frontend |
| Errors | `src-tauri/src/app/error.rs` | Error classification + public error codes |
| State registries | `src-tauri/src/app/state.rs` | Process/task registries for long-running operations |
| UI hierarchy rendering | `src-tauri/src/app/ui_xml.rs` | UI XML → HTML renderer |
| Bugreport log index/query | `src-tauri/src/app/bugreport_logcat.rs` | Cached index + filterable viewer backend |
| Config load/save | `src-tauri/src/app/config.rs` | Persistence + legacy migration + validation/clamping |

## CONVENTIONS

- Validate all external input (device serials, user-provided paths, ADB output) and return user-safe errors.
- Prefer pure parsing helpers in `adb/*` with tests; keep command handlers thin.
- Long-running operations should be cancellable or bounded; store handles in `state.rs` registries.
- `config.rs` preserves unknown JSON keys in `~/.lazy_blacktea_config.json` for coexistence with the PyQt6 edition; any new user-editable `HashMap` field in `AppConfig` must be registered in `CONFIG_REPLACE_MAP_PATHS` so deleted keys do not resurrect on save.
- `ApkInstallErrorCode::from_output` must match standalone `Success` lines with no `Failure`/`Error` lines (never substring-match `SUCCESS`).
- Split OS-specific mutating helpers with `#[cfg(windows)]` / `#[cfg(not(windows))]` instead of declaring `let mut` only mutated inside one `#[cfg]` block (prevents macOS/Linux `clippy -D warnings` `unused_mut` failures).
- Spawn background tools via `adb::runner::new_background_command` and `run_command_bytes_with_timeout` (`DEFAULT_MAX_OUTPUT_BYTES` = 64 MiB), quote `adb shell` arguments with `quote_adb_shell_arg`, validate browse paths with `validate_device_browse_path` (rejecting `\n`/`\r`), and slice UTF-8 text only with `floor_char_boundary`.
- Keep hot logcat regexes in `OnceLock`, keep SQLite bugreport bulk-insert PRAGMAs + deferred indexes intact, preserve `prune_bugreport_caches` (`8` reports / `512 MiB`) and `prune_app_icon_cache` (`500` files / `64 MiB`), and run multi-device commands via `run_for_serials_parallel`.

## ANTI-PATTERNS

- Do not silently swallow errors (no empty `match Err => {}` patterns); always classify and surface appropriately.
- Do not build SQL via string concatenation (parameterize everything).
- Do not accept device paths without sanitization/validation.
- Do not use bare `std::process::Command::new` or unbounded reads, and never slice strings by raw byte index (`&s[..n]`).
