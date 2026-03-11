# Agent Instructions (Read First)

These rules are **always on** for any automated agent work in this repository.

## DO NOT FORGET

- Follow DEFAULT FLOW unless explicitly allowed.
- SECURITY rules are ALWAYS ON.
- UI / UX rules apply to all user-facing changes.
- If unsure, ask before coding.

## LANGUAGE

- Use **English only** for: code, comments, logs, config, UI strings, and commit messages.
- Use **Traditional Chinese (Taiwan)** for: planning and explanations in chat.

## CORE RULES

- If requirements, scope, acceptance criteria, or constraints are unclear: **ask before coding**.
- Do **not** modify, revert, delete, or refactor unrelated code or files.
- Do **not** remove or revert changes without explicit user approval.
- No hardcoded secrets, credentials, or environment-specific config.
- No SQL string concatenation; all SQL must be parameterized.
- No silent error swallowing (no empty `catch`, no ignored `Result` without intent).
- Do not experiment directly in production environments.

## DEFAULT FLOW

Follow this flow unless explicitly allowed otherwise:

1. Clarify
2. Plan
3. TDD
4. Implement
5. Summary

Notes:
- For trivial or UI-only changes, Plan/TDD may be abbreviated but not skipped silently.
- If TDD is skipped, explicitly state why and how correctness is verified.
- Auth, payments, permissions, and data mutation require TDD plus integration tests.

## SKILL STRATEGY (UI/UX)

- For UI/UX tasks, always try Gemini-based UIUX skills first (`gemini-uiux-designer`, `gemini-uiux-visual-engineer`).
- If Gemini execution fails, fallback to non-Gemini UI/UX flow.
- Failure is defined as any of:
  - Tool unavailable / dispatch error / exception.
  - Timeout: invocation is actually terminated by timeout, or finishes with no usable result.
  - Dependency error (quota/auth/network/authz, e.g. HTTP 429) returned by Gemini.
  - Empty output, clearly malformed output, or missing required deliverables.
- Tool window: 10 seconds per Gemini invocation (soft decision window, not a hard kill timeout).
  - If usable output arrives after 10 seconds and the invocation completes successfully, treat it as success (not timeout).
  - If classification is ambiguous, use final process result (exit status/stdout/stderr) as source of truth.
- On failure: retry Gemini once; if the second attempt also fails, perform one fallback attempt to non-Gemini flow.
- Use fallback only after these failed attempts; do not bypass Gemini for normal UI/UX tasks.

## SKILL ROUTING POLICY (NON-SYSTEM)

- Do not change `.system` skills (`skill-creator`, `skill-installer`) from this plan.
- Keep `.system` skills unchanged unless explicitly requested.
- For non-system skills, follow `/Users/cy76/.codex/skills/README.md` as the single source of truth:
  - `explore` is the default entrypoint for codebase investigation.
  - `document-writer` handles general documentation; `doc` handles DOCX-specific work.
  - `frontend-ui-ux-engineer` handles Web/frontend UIUX; `frontend-mobile-uiux-designer` handles iOS/Android scope.
  - Gemini skills are used as first-pass helpers under UI/UX flows, with retry/fallback policy unchanged.

## CLARIFY

- Ask concise questions only if scope, acceptance criteria, or constraints are unclear.
- Ask before proceeding if a breaking change, data migration, or security impact is possible.
- Do not propose solutions or plans at this stage.

## PLAN

- Then briefly state (include only what is relevant):
  - Goal and explicit non-goals
  - Files/modules likely to change
  - Risk notes (compatibility, security, data, migrations)
  - Test strategy (what level, what to mock)
  - Verification plan (how to prove it works)
  - Rollback approach (how to undo safely)
- No code or tests in this section.

## TDD

- If TDD is skipped, explicitly state why and how correctness is verified.
- Write tests BEFORE implementation for business logic and critical paths.
- Auth, payments, permissions, and data mutation require TDD plus integration tests.
- For UI-only changes, TDD is optional but a verification plan is required.
- Tests must be deterministic and isolated (Arrange, Act, Assert).

## IMPLEMENT

- Search existing code before adding new logic.
- Keep changes minimal, scoped, and single-responsibility.
- Preserve existing style, types, lint, and format rules.
- No commented-out, dead, or unrelated refactor code.

## SUMMARY

- Summary of changes (what / where / why).
- List of updated files.
- Test results or reproducible validation steps.
- Compatibility impact (only if applicable).
- Rollback notes and follow-up optimizations (if relevant).

## SECURITY (ALWAYS ON)

- Least-privilege access.
- Validate all external input (including device output and user-provided paths).
- Never log secrets, tokens, or PII.

## LOGGING & TRACEABILITY (WHEN SERVER-SIDE OR INTEGRATIONS ARE INVOLVED)

- Use `X-Request-ID` if provided; otherwise generate UUID v4.
- Trace ID must appear in all logs and error responses.
- Logs must be JSON in production.

## ERROR RESPONSE (WHEN API/SERVER-SIDE)

Return to clients only (no internal details):

```json
{
  "error": "Human readable message",
  "code": "ERR_xxx",
  "trace_id": "uuid-v4"
}
```

## ERROR HANDLING (WHEN APPLICABLE)

- Classify errors: validation, business, system, dependency.
- Log stack traces for system errors.
- Retry only idempotent operations.
- Use bounded exponential backoff.
- Define timeouts (API ~10s, DB ~5s).

## TASK-TYPE CHECKLISTS (CONDITIONAL)

### FRONTEND (USER-FACING UI: WEB / ANDROID / IOS)

- Verify key user flows using appropriate tools:
  - Web: DevTools
  - Android: adb / Android Studio
  - iOS: Xcode / Simulator
- Ensure user-facing errors are clear and actionable.
- Avoid leaking technical or internal details to users.

### UI / UX (WHEN USER-FACING)

- Do not change UI/UX behavior without explicit intent or approval.
- Preserve established interaction patterns unless a change is required.
- All user-visible states must be handled:
  - Loading
  - Empty
  - Error
  - Disabled
  - Success (if applicable)
- User feedback must be:
  - Immediate for user actions
  - Clear and human-readable
  - Consistent with existing tone and terminology
- Avoid UI regressions:
  - No layout shifts during loading (where reasonably preventable)
  - No breaking keyboard / touch interactions
  - No degraded accessibility compared to existing behavior
- Error presentation:
  - User-facing messages must not expose technical details
  - Map internal errors to user-meaningful messages
  - Retry guidance must be explicit if retry is possible
- Performance perception:
  - Avoid blocking UI on non-critical operations
  - Prefer optimistic or incremental rendering when applicable

### APP (MOBILE)

- Applies in addition to FRONTEND (USER-FACING UI: WEB / ANDROID / IOS).
- Assume unreliable networks and background suspension.
- Avoid infinite retries; keep retries bounded and idempotent.
- Note impacts to auth/session/storage, push, deep links, permissions.
- Consider backward compatibility with older app versions when calling APIs.

### BACKEND

- Do not break API contracts without versioning or approval.
- Prefer backward-compatible changes.
- DB schema changes require safe rollout (expand, migrate, contract).

### INFRA / OPS

- State what will change (resources, config, permissions) and blast radius.
- Provide a minimal troubleshooting note (where to look first if it fails).
- Avoid high-cardinality logs/metrics that can explode cost.

## FILES

- Check file size before reading large files (`wc -l`) and prefer partial reads (`rg`, `sed -n`).
- Do not dump large files blindly into chat.

## TESTING

Preferred commands:

```bash
scripts/smoke_all.sh
scripts/security_audit.sh
```

macOS note:
- Full desktop UI automation for the Tauri WebView is limited on macOS.
- Prefer: browser-mode UI smoke + Rust backend smoke/soak + real-device ADB smoke.
- See `docs/testing.md` for the manual desktop QA checklist (product paths).

- During any manual testing (DevTools, adb, iOS tools, emulators, real devices), always verify:
  1) Functionality: core flows work without errors
  2) UI/UX: layout, feedback, and interactions are usable
  3) Regressions: no new obvious breakage introduced

- If UI/App related:
  - Check loading, error, and disabled states
  - Verify behavior under slow or unstable network

- If Backend/API related:
  - Validate responses, error codes, and trace_id on failure

- If no automated tests exist, provide clear manual verification steps.

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

## Release Playbook (vX.Y.Z)

When the user asks to release a new version, use this exact sequence unless explicitly overridden:

1. Bump version in all required files:
   - `package.json`
   - `package-lock.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`
   - `src-tauri/tauri.conf.json`
2. Commit version bump with message `Release vX.Y.Z`.
3. Push branch and tag:
   - `git push origin master`
   - `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
   - `git push origin vX.Y.Z`
4. Let the tag-driven release workflow create/update the GitHub release automatically.
   - No manual `gh release create ...` step is required for the standard flow.
   - If you need custom notes, edit the generated GitHub release after the workflow creates it.
5. Verify release assets include installers:
   - macOS: `.dmg`
   - Linux: `.AppImage` and `.deb`
   - Signed updater builds: `latest.json`
6. If Linux installers are missing, inspect `release.yml` workflow run and job logs.
   - Common transient error: `failed to bundle project 'io: Peer disconnected'` during AppImage bundling.
   - Recovery: rerun failed jobs via `gh run rerun <run_id> --failed`, then re-check assets.

Notes:
- `release.yml` is triggered by pushing a `v*` tag.
- The workflow creates the GitHub release automatically if it does not already exist for that tag.
- The workflow marks the release as `prerelease` while artifacts upload, then promotes it to latest stable only after installers and signed-updater `latest.json` are ready.
- Keep retries bounded; do not loop indefinitely. Report final run URL and current asset list to the user.

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
