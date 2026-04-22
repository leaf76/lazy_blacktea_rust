# Agent Instructions (Read First)

These rules are always on for work in this repository.

## Purpose And Scope

- This repo is a Tauri v2 desktop app for Android device operations.
- Frontend: React 19 + TypeScript + Vite under `src/`.
- Backend: Rust + Tauri commands under `src-tauri/`.
- Primary product surfaces: device management, logcat, file explorer, APK install, wireless pairing, UI inspector, bugreport analysis, updater.
- Root guidance covers repo-wide workflow. Follow deeper guidance when working inside:
  - `src/AGENTS.md`
  - `src-tauri/AGENTS.md`
  - `src-tauri/src/app/AGENTS.md`
  - `uiux/AGENTS.md`

## Always On

- SECURITY rules from higher-level instructions always apply.
- Use English for code, comments, logs, config, UI strings, and commit messages.
- Use Traditional Chinese in chat for planning and explanations.
- If scope, acceptance criteria, or risk is unclear, clarify before coding.
- Do not modify, revert, delete, or refactor unrelated files.
- Do not weaken existing security, validation, or traceability behavior.

## Repo Snapshot

- Package manager: `npm`
- Frontend entry: `src/main.tsx`
- App shell and routing: `src/App.tsx`
- Frontend API wrappers: `src/api.ts`
- Tauri entry and command registration: `src-tauri/src/lib.rs`
- Backend domain modules: `src-tauri/src/app/`
- Tauri config and updater endpoint: `src-tauri/tauri.conf.json`
- Local smoke and soak helpers: `src-tauri/src/bin/smoke.rs`, `src-tauri/src/bin/soak.rs`
- Product docs: `README.md`, `docs/usage.md`, `docs/testing.md`, `docs/troubleshooting.md`, `docs/development.md`
- CI workflows:
  - `.github/workflows/build.yml`
  - `.github/workflows/release.yml`

## Workflow Policy

- Non-trivial work should follow `Clarify -> Plan -> TDD -> Implement -> Verify -> Summary`.
- Use test-first or reproduction-first flow for:
  - backend command behavior
  - parser logic
  - file or device mutation
  - trace/error contract changes
  - reproducible bug fixes
- UI-only polish may use abbreviated TDD, but you must still state the verification plan.
- Before commit or push in a dirty worktree, review staged and unstaged changes and keep the final diff task-scoped.
- Prefer the smallest possible change that fits the existing architecture.

## Change Safety

- Search existing code before adding new helpers or abstractions.
- `src/App.tsx` and `src-tauri/src/app/commands/mod.rs` are large hotspots; avoid opportunistic refactors there.
- Keep frontend calls routed through `src/api.ts` instead of adding scattered raw `invoke(...)` calls.
- Preserve the command response contract:
  - success: `{ trace_id, data }`
  - failure: `{ error, code, trace_id }`
- Preserve traceability. Do not remove `trace_id` propagation from backend logs, command responses, task center records, or issue-report tooling.
- Do not hardcode ADB, scrcpy, output paths, or user-specific filesystem locations.
- Config is user-local, not repo-local:
  - macOS/Linux: `~/.lazy_blacktea_config.json`
  - Windows: `%USERPROFILE%\\.lazy_blacktea_config.json`
- Do not add silent fallbacks around command, process, DB, or file errors.

## Verified Commands

Use only commands that are confirmed by manifests, docs, scripts, or CI.

### Local Setup

```bash
npm install
npm run tauri dev
```

### Fast Validation

```bash
npm run test
npm run build
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings
cd src-tauri && cargo test --all --all-features
```

### Repo Smoke Helpers

```bash
scripts/smoke_all.sh
scripts/security_audit.sh
scripts/smoke_adb.sh
cd src-tauri && cargo run --bin smoke -- --json --with-files
cd src-tauri && cargo build --bin soak && ./target/debug/soak --json --duration-secs 120 --interval-ms 500
```

Notes:
- `scripts/smoke_adb.sh`, `smoke`, and `soak` require a real device or explicit serial selection for meaningful coverage.
- `scripts/security_audit.sh` writes reports to `.audit/`.
- CI uses `npm ci`, not `npm install`.

## Domain Guardrails

### Frontend And Desktop UX

- This is a desktop product, but much of the UI can still be browser-smoke-tested through Vite.
- Preserve current user-facing behavior unless the task explicitly changes UX.
- User-facing errors must stay human-readable and must not expose internal details.
- Validate Loading, Empty, Error, Disabled, and Success states for touched screens.
- Keep layout changes compatible with the existing dense console-style UI.
- When changing routes, preserve `HashRouter` behavior unless the task explicitly changes routing strategy.

### Tauri / Rust / ADB Surface

- Backend logic shells out to system `adb`; validate all user-provided serials, paths, package names, and command arguments.
- Treat `run_shell` and destructive file/device operations as high-risk surfaces. Do not widen them without explicit intent, validation, and tests.
- Long-running work must remain bounded or cancellable and should stay off the UI thread.
- Do not return raw internal errors to the frontend.
- When touching parsers in `src-tauri/src/app/adb/`, prefer pure helpers with tests.
- When touching file operations, bugreport export, or UI inspector export, verify both success and failure paths.

### Release And Updater

- `build.yml` runs on pull requests and pushes to `master`, installs dependencies with `npm ci`, and builds macOS/Linux bundles.
- `release.yml` runs on `v*` tags, ensures a GitHub prerelease exists first, uploads installers, publishes signed `latest.json` when signing keys are available, then promotes the release to latest stable only after required assets are present.
- Do not invent manual release steps that bypass the tag-driven workflow unless the user explicitly asks for a non-standard release path.
- If you touch updater logic or release packaging, verify against:
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.updater.conf.json`
  - `docs/testing.md`
  - `docs/troubleshooting.md`

## Validation Baseline

- Match validation depth to risk.
- Minimum expectation for most code changes:
  - relevant unit tests
  - `npm run build`
  - Rust format, clippy, and tests when backend code is touched
- Required for parser, command, or reusable-helper changes:
  - deterministic tests first, or a failing reproduction first
- Required for device/file mutation paths:
  - success path
  - failure path
  - observable result or rollback behavior
- Required for updater or release changes:
  - release-state verification against the documented prerelease -> asset upload -> promote flow
- If automated coverage is not practical, provide exact manual verification steps and expected outcomes.

## macOS Testing Reality

- Full desktop automation of the Tauri WebView is limited on macOS.
- Prefer this verification order on macOS:
  1. frontend/browser smoke through Vite
  2. Rust unit/integration checks
  3. real-device ADB smoke
  4. manual desktop QA from `docs/testing.md`

## Repo-Specific Notes

- Default export destination is usually the system Downloads folder, but users can change it in Settings.
- This repo intentionally uses system tools instead of bundling `adb`.
- Tauri security CSP is currently `null` in `src-tauri/tauri.conf.json`; do not tighten it casually without checking desktop runtime impact.
- `uiux/` contains planning artifacts, not implementation truth. Reconcile UI plans with live code before acting on them.
- Keep release and troubleshooting guidance aligned with the actual GitHub workflow files; those files are the source of truth for packaging behavior.
