# Contributing

Thanks for taking the time to contribute.

## Ways to Contribute

- Report bugs and regressions
- Suggest features and UX improvements
- Improve documentation
- Submit pull requests

## Development Setup

### Prerequisites

- Node.js + npm
- Rust (latest stable)
- `adb` available in `PATH` (or configure an absolute ADB path in the app Settings)
- Optional: `scrcpy` for device mirroring

### Run in Dev Mode

```bash
npm install
npm run tauri dev
```

### Run Tests / Checks

```bash
npm run test

cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```

## Pull Request Guidelines

- Keep PRs small and focused. Avoid unrelated refactors.
- Include reproduction steps for bug fixes.
- Add tests for non-trivial logic and critical paths.
- Ensure `npm run test` and Rust checks pass.
- Document user-visible behavior changes in the PR description.

## Reporting Bugs

Please use the bug report issue template and include:

- OS and version
- App version
- ADB version (`adb version`)
- Reproduction steps and expected/actual behavior

## Security Issues

Please follow `SECURITY.md` and use GitHub Security Advisories.
