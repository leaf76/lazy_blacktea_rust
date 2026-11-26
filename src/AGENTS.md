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
| Streaming state & route connectors | `src/streamStore.ts`, `src/components/StreamRouteConnectors.tsx` | Isolates logcat/perf/net/terminal streams from root `App.tsx` |
| Unit tests | `src/**/*.test.ts` | Vitest; tests live next to source |

## CONVENTIONS

- Prefer small pure helpers in `src/*.ts` with Vitest coverage; keep UI code in `src/App.tsx` thin when possible.
- Keep high-frequency Tauri streams (`logcat-line`, `perf-snapshot`, `net-profiler-snapshot`, `terminal-event`) inside `src/streamStore.ts` (`useSyncExternalStore`) and consume them inside route connectors (`StreamRouteConnectors.tsx`), keeping root `App.tsx` subscribed only to `useStreamStatusSummary()`.
- Place helpers/types shared between `App.tsx` and `React.lazy` pages in pure utility modules (`appsUtils.ts`, `filesUtils.ts`, `perfState.ts`, `netProfilerState.ts`, `terminalBuffer.ts`) so lazy chunks do not collapse back into `index-*.js`.
- Isolate 1s relative-time ticks inside memoized `useSyncExternalStore` leaf components, batch bursty UI event streams (e.g., Bluetooth events at 150ms), and preserve `.app-shell[data-has-wallpaper="false"]` `backdrop-filter` gating in `src/App.css`.
- UI-facing errors must be human readable and must not leak internal details.
- Handle user-visible states explicitly (Loading/Empty/Error/Disabled/Success) to avoid broken UX.

## ANTI-PATTERNS

- Do not bypass `src/api.ts` by sprinkling raw `invoke(...)` calls across components.
- Do not move high-frequency stream state back into root `App.tsx` `useState`, and never statically import runtime values from `React.lazy` route modules into `App.tsx`.
- Do not introduce UI layout shifts in loading states (especially for logcat/file lists).
- Do not do large refactors inside `src/App.tsx` while fixing unrelated bugs.
