Title: Shell Commands (Interactive Terminal Sessions) UI/UX Optimization

Context
- Product: Lazy Blacktea (Tauri v2 + React desktop app) for Android ADB automation.
- Feature: A "Shell Commands" page that provides per-device interactive shell sessions via host ADB (`adb shell`).
- Platforms: macOS + Linux.
- Audience: technical users (QA / developers) who want fast multi-device workflows.

Current UX (as implemented)
- There is a "Device Context" selector at the top bar for multi-select.
- The Shell Commands page includes:
  - A global toolbar with:
    - "Connect Selected" / "Disconnect Selected" actions (based on current Device Context selection).
    - A broadcast input + "Broadcast" button that sends to all CONNECTED active sessions.
  - An "Active Sessions" list (not tied to current selection):
    - Sessions are "pinned" and persist across restarts.
    - Each row shows serial + model (if known) + status pill + actions (Connect/Disconnect/Remove).
    - Clicking a row focuses that device (updates selection to that serial).
  - A main content area that shows terminal panels for ALL active sessions.
    - Each panel has: status, Connect/Disconnect, Ctrl+C, Clear, Auto-scroll toggle, output area, input line (Enter sends).

Persistence requirements
- Active sessions list and per-device output buffers are persisted into `~/.lazy_blacktea_config.json`.
- Buffer is persisted as the last 500 lines per device (truncate older lines); each line is capped to 8000 characters.
- On app startup, after the first device refresh, the app attempts to restore (connect) sessions ONCE, only for devices currently online ("device" state).

Constraints / non-goals
- Non-goal: full TTY emulation (no xterm.js / PTY). Interactive full-screen apps like `top`/`vi` are NOT required.
- Must remain keyboard accessible (focus order, Enter to send, visible focus).
- Must scale to many devices (e.g., 8–20 sessions): scanning, monitoring, and batch/broadcast should stay efficient.
- Keep the existing visual language (dark panels, subtle borders, compact density).

Observed UI problems (from screenshot + current layout)
- The global toolbar/header can still feel visually heavy relative to terminal content.
- Multi-device layout needs clear hierarchy: session management vs. terminal viewing.
- Active sessions list should support fast scanning: status, device name/model, and quick actions.
- Terminal panels should maximize output visibility (data density), while keeping essential controls discoverable.

Goal
Produce implementation-ready UI/UX recommendations to optimize the Shell Commands page for:
- Density and clarity (less wasted space; consistent alignment).
- Multi-device monitoring (clear status, easy compare, easy to broadcast).
- Session lifecycle (pin/restore/remove) without confusion.
- Accessibility (keyboard and screen reader support).

Deliverables requested
- Issues with evidence + impact.
- Prioritized backlog with acceptance criteria.
- Component inventory and component states for this page:
  - Global toolbar
  - Active sessions list item
  - Terminal panel
  - Empty states (no devices, no sessions), error states (unauthorized/offline), loading states (connecting)
- Design tokens suggestions (if any) and microcopy improvements.
- Layout spec: recommended widths, breakpoints, sticky behaviors, and scroll strategy.

Output JSON contract (must follow exactly)
- version: string
- mode: \"optimize\"
- assumptions: string[]
- open_questions: string[]
- ux_goals: { primary_goals: string[], success_metrics: string[] }
- information_architecture: { sitemap: string[], navigation_rules: string[] }
- user_flows: { name: string, steps: string[] }[]
- screens: { id: string, name: string, layout_notes: string[], states: { empty: string[], loading: string[], error: string[], success: string[] } }[]
- issues: { id: string, title: string, severity: \"low\"|\"medium\"|\"high\", evidence: string, recommendation: string, acceptance_criteria: string[] }[]
- backlog: { id: string, title: string, type: \"ux\"|\"ui\"|\"a11y\"|\"bug\"|\"perf\", impact: 1|2|3|4|5, effort: 1|2|3|4|5, risk: 1|2|3|4|5, dependencies: string[], acceptance_criteria: string[] }[]
- components: { name: string, purpose: string, variants: string[], states: string[], a11y_notes: string[] }[]
- design_tokens: { css_variables: string, notes: string[] }
- microcopy: { tone: string, messages: { key: string, text: string }[] }
- rollout: { phases: string[], feature_flags: string[], monitoring: string[] }
- experiments: { hypothesis: string, metric: string, success_criteria: string, variants: string[] }[]
