# Device Manager UI/UX Optimization Brief

## Context
Lazy Blacktea (Tauri v2 + React) desktop app for Android device automation. Target users are QA and engineers. Visual direction: minimal tech, compact density. System theme (light/dark) via CSS variables.

## Page in Scope
Device Manager page (devices list, grouping, multi-select, quick actions). Screenshot shows:
- Header: "Device Manager" with subtitle and a top-right "Refresh Devices" button.
- Devices panel with "Devices" title and "1 connected".
- Search input (serial/model), group filter dropdown, group name input, Assign button.
- Multi-select list with one device; shows model, serial, Android/API + WiFi/BT status inline.
- Action buttons row: Reboot / Recovery / Bootloader / WiFi On/Off / Bluetooth On/Off / Copy Device Info.
- Right side top buttons: "Select Visible" and "Clear".

## Problems to Solve (Observed)
- Users can’t easily find device selection controls; active vs selected device is unclear.
- Information density is high; key status is hard to scan.
- Controls feel scattered (selection, group assignment, actions).

## Goals
- Make selection and active device state obvious.
- Improve scanability with clearer hierarchy and spacing without losing compactness.
- Consolidate controls into predictable zones (filter/select, bulk actions, per-device actions).
- Preserve existing functionality and data fields.

## Constraints
- Keep minimal tech style.
- Keep compact layout; support 1-screen usage.
- Must support multi-select and group assignment.
- No new backend APIs required.

## Data & Actions (Existing)
- Device fields: model/name, serial, Android version, API, WiFi, Bluetooth, state (online/offline/unauthorized), battery (if available), GMS (if available).
- Actions: Select Visible, Clear Selection, Assign Group, Reboot, Reboot Recovery, Reboot Bootloader, WiFi On/Off, Bluetooth On/Off, Copy Device Info.

## Assumptions
- Accessibility: basic keyboard focus and contrast; no strict WCAG requirement specified.
- KPI focus: reduce time to select a device and perform an action.

## Deliverable
- UX audit + prioritized backlog
- Updated layout proposal (zones and hierarchy)
- Component inventory + states
- Design tokens and microcopy suggestions
- Rollout/experiments plan (if applicable)
