---
name: release-version
description: >-
  Bumps the Lazy Blacktea Tauri app version across all JS, Cargo, and Tauri
  manifests, updates CHANGELOG.md, runs cross-platform local verification, and
  publishes an annotated v* Git tag to trigger the GitHub Actions Release workflow.
  Use when the user asks to bump version, cut a release, or publish a new build.
---

# Release Version Runbook (`lazy_blacktea_rust`)

## Version Files (Keep in Lockstep)
1. `package.json` (`"version"`)
2. `package-lock.json` (both top-level `"version"` and `packages[""].version`)
3. `src-tauri/Cargo.toml` (`[package] version`)
4. `src-tauri/Cargo.lock` (`[[package]] name = "lazy_blacktea_rust"` `version`)
5. `src-tauri/tauri.conf.json` (`"version"`)
6. `CHANGELOG.md` (prepend `## <version> - YYYY-MM-DD` directly above the previous release heading; no `## Unreleased` section is kept)

## Pre-Release Verification
1. Frontend:
   - `npm run test`
   - `npm run build`
2. Backend (`src-tauri/`):
   - `cargo fmt --all -- --check`
   - `cargo clippy --all-targets --all-features -- -D warnings`
   - macOS/Linux: `cargo test --all --all-features`
   - Windows (PowerShell): `$env:LAZY_BLACKTEA_TEST_MANIFEST="1"; cargo test --lib --all-features` (clear env var before any `tauri build`)

## Pre-Tag Cross-Platform CI Gate
- Local Windows checks do not compile `#[cfg(not(windows))]` or macOS-only branches. Before tagging, confirm the latest `master` run of `Build (macOS, Linux, Windows)` is `success` (`gh run list --repo leaf76/lazy_blacktea_rust --limit 5`) so non-Windows `cargo clippy -- -D warnings` issues (such as `unused_mut`) are caught first.

## Publish Flow (Tag-Driven CI)
1. Commit only version files + `CHANGELOG.md`:
   - `git commit -m "chore: bump version to <version> for release"`
   - `git push origin master`
2. Create and push annotated tag:
   - `git tag -a v<version> -m "Release v<version>"`
   - `git push origin v<version>`
3. Verify and watch `.github/workflows/release.yml`:
   - `gh run list --repo leaf76/lazy_blacktea_rust --limit 5`
   - `gh run watch <run-id> --repo leaf76/lazy_blacktea_rust --compact --interval 30` (note: `macos-latest` universal build typically takes 25-28 minutes).
   - After completion, verify promotion and all platform artifacts (`latest.json`, `.sig`, macOS `.dmg`/`.app.tar.gz`/`.app.zip`, Windows `.exe`/`.msi`, Linux `.AppImage`/`.deb`/`.tar.gz`):
     `gh release view v<version> --repo leaf76/lazy_blacktea_rust --json tagName,isPrerelease,isDraft,assets` (`isPrerelease` must be `false`).
   - Note: open Dependabot alerts on transitive `zip v4.x` via `tauri-plugin-updater` do not block releases while direct `zip` stays on `v9+`.
