Project: LAZY BLACKTEA RUST (Tauri v2 + React desktop app)
Goal: Full UI layout rework across all screens to improve usability and reduce learning cost. Current UI feels confusing and dense.
Platform: Desktop app (Tauri). Primary users: QA engineers and software engineers.
Style: Minimal tech. Default theme: system (light/dark). Density: compact.
Scope: Rework layout for all pages (Dashboard, Devices, Actions, Logcat, Files, UI Inspector, Apps, Bugreport, Bluetooth, Settings).
Constraints:
- Keep existing core functionality and commands.
- Use current React + Tauri + CSS stack (minimal styles allowed).
- Navigation can be regrouped and renamed; use sidebar + top bar.
Accessibility: Keyboard-first, visible focus states, WCAG AA contrast.
Navigation requirement: New grouping and naming allowed. Provide IA with section groups.
Logcat preference: compact (more lines per screen).
Files preference: fixed dual-pane layout.
Wireless pairing: Provide QR payload parsing + auto-fill for connect address.
Live mirror: Keep scrcpy integration with clear dependency messaging.
Success Criteria:
- Users can find key tasks within 10 seconds.
- Reduced scrolling and clearer grouping per page.
- Compact density without losing clarity.
Deliverables:
- Updated IA with group naming
- Screen layout specs for every page
- Component states (empty/loading/error)
- Tokens aligned with system theme and compact density
