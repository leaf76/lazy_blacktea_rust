Device Context Popover Iteration Brief

Context
- Desktop app (Tauri + React) for Android device automation.
- Global multi-device selection lives in a top-bar "Device Context" popover.
- Users select multiple devices via checkboxes; a primary device is set by clicking a row.

Goals
- Make selection affordances clear in the popover.
- Improve small-window behavior for the popover.
- Add grouping and a "Recent" section to reduce scanning time.
- Improve keyboard accessibility and focus visibility.

Required changes
- Popover alignment: center it to the trigger by default; if it would overflow the viewport, align the popover left with the trigger.
- Small window constraints: cap list height so it never consumes the full view; allow scrolling inside the list.
- "Recent devices": show a recent section based on most recent tasks executed (task history), limited to the first 5 connected devices.
- "Groups": segment device list using existing device group assignments (groupMap). Include an "Ungrouped" section for devices without a group.
- Keyboard: Tab into the popover list; Enter/Space on a row sets primary; Esc closes; visible focus ring on rows and on the trigger.

Constraints
- Keep overall layout and theming consistent with the existing UI.
- No backend changes.
- UI strings must be English.
