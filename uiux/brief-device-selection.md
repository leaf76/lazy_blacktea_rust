Project: Lazy Blacktea (Tauri v2 + React desktop app for Android device automation via ADB).

Objective:
Improve the global device selection UX. The current multi-select panel (checkbox list) is squeezed at the bottom-left sidebar and hard to notice. The user wants a layout where the multi-select affordance is obvious at a glance and feels spacious.

Context & Constraints:
- Desktop app with a left sidebar (nav links), a top bar (primary device selector + global actions), and main content pages.
- Multi-device actions should work for Screenshot, Reboot, Bugreport.
- Some pages must be single-device only (File Explorer, UI Inspector, Logcat, Bluetooth Monitor, App Manager).
- Primary device concept still required for single-device pages.
- Keep the overall visual style (dark, compact, card-based).
- Avoid adding heavy new dependencies or complex IA changes; prefer UI layout shifts and clear hierarchy.

Current Layout Summary (from screenshot):
- Left sidebar includes nav groups and footer buttons.
- A small "Devices" panel is pinned at the bottom left with "Select all", "Clear", and a single device row.
- The panel competes with footer buttons and appears cramped.
- Top bar shows primary device selector + "Manage".
- Bugreport page shows actions but doesn't clearly present multi-device selection.

Problems Observed:
- Multi-select area is visually buried (bottom-left) and easy to miss.
- Competes with sidebar footer; poor visual priority.
- No clear separation between navigation and device selection context.

Goals:
- Make multi-select device control obvious and discoverable.
- Reduce crowding in the sidebar.
- Preserve fast access to navigation and global actions.
- Clearly communicate single-device-only pages.

Deliverable:
Provide an optimization plan with issues, backlog, component recommendations, and token suggestions focused on device selection placement, hierarchy, and clarity.
