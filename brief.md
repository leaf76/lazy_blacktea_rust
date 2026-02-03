Project: LAZY BLACKTEA RUST (Tauri v2 + React desktop app for Android device automation via ADB)
Goal: Full UI/UX redesign to drastically reduce learning curve for QA and engineers. The current UI is confusing; users cannot understand the structure or what to do.
Platform: Desktop app (Tauri). Primary users: QA engineers and software engineers.
Style: Minimal, modern, tech-forward (clean, structured, high-clarity).
Accessibility: Keyboard-first support and WCAG AA contrast; clear focus order and visible focus states.
Scope: Entire IA, flows, and screens. Provide onboarding guidance and clear task-oriented navigation.
Constraints:
- Keep existing core functionality: device discovery, operations, logcat streaming, file browsing, UI hierarchy rendering.
- No brand assets are provided; define a simple visual language and tokens.
- Prefer straightforward workflows and progressive disclosure for advanced tasks.
Success Criteria:
- New users can complete key tasks in < 3 minutes without guidance.
- Reduce time-to-first-action and cognitive load (clear next steps, visible system status).
Key Tasks (Top 5):
1) Connect and select an Android device.
2) Run common operations (reboot, input, install/uninstall, screenshots).
3) View/stream logcat with filters.
4) Browse device files and pull/push.
5) Inspect UI hierarchy / XML and interact with elements.
Pain Points (Reported):
- Current layout is unintuitive; users cannot find where to start.
- Information hierarchy is unclear; too many controls at once.
- Lack of guidance and affordances.
Evidence: No screenshots provided; assume the existing UI is dense and unstructured.
Deliverables:
- UX audit (issues + evidence summary)
- IA and navigation model
- Primary user flows
- Screen-level specs
- Component inventory with states (loading/empty/error)
- Design tokens (color, typography, spacing, elevation)
- Prioritized backlog + rollout suggestions
