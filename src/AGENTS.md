# Frontend (src/) Agent Notes

## OVERVIEW
React 19 + TypeScript UI built with Vite; talks to Rust via Tauri `invoke` wrappers.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Frontend entry | `src/main.tsx` | Mounts React + `HashRouter` |
| App shell + routing | `src/App.tsx` | Routes, pages, global device context UI (very large file) |
| Tauri invoke wrappers | `src/api.ts` | Prefer calling typed wrappers over raw `invoke` |
| Logcat parsing/filtering | `src/logcat.ts` | Pure helpers + unit tests |
| Pairing parsing/reducer | `src/pairing.ts` | Parses `adb pair` output + QR payload |
| Device helpers | `src/deviceUtils.ts` | Selection + formatting helpers (see tests) |
| Unit tests | `src/**/*.test.ts` | Vitest; tests live next to source |

## CONVENTIONS

- Prefer small pure helpers in `src/*.ts` with Vitest coverage; keep UI code in `src/App.tsx` thin when possible.
- UI-facing errors must be human readable and must not leak internal details.
- Handle user-visible states explicitly (Loading/Empty/Error/Disabled/Success) to avoid broken UX.

## ANTI-PATTERNS

- Do not bypass `src/api.ts` by sprinkling raw `invoke(...)` calls across components.
- Do not introduce UI layout shifts in loading states (especially for logcat/file lists).
- Do not do large refactors inside `src/App.tsx` while fixing unrelated bugs.
