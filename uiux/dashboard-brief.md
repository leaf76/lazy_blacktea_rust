# Dashboard UI/UX Optimization Brief

## Context
Lazy Blacktea (Tauri v2 + React) desktop app for Android device automation. Target users are QA and engineers. Visual direction: minimal tech, compact density, system theme (light/dark) via CSS variables.

## Page in Scope
Dashboard page. Screenshot shows:
- Header: "Dashboard" with subtitle and a top-right "Manage Devices" button.
- Card: "Device Overview" with primary device name + serial and a small grid of metrics (Android, API, Battery, WiFi, Bluetooth, GMS). "Copy Device Info" button at the bottom.
- Card: "Quick Actions" grid of 6 actions (Screenshot, Reboot, Start Recording, Clear Logcat, Live Mirror, APK Installer).
- Card: "Connection" with ADB status, connected device count, tasks, scrcpy availability.
- Card: "Recent Apps" showing empty state with "Load Apps" button.
- Overall layout is a 2x2 card grid.

## Problems to Solve (Observed)
- Hierarchy is flat; hard to distinguish primary device context vs. supporting cards.
- Quick actions are visually uniform and scan poorly; primary vs. secondary actions unclear.
- Connection health and device status are separated from device overview; glanceability is low.
- Empty states (Recent Apps) feel detached from the rest of the dashboard.
- Visual rhythm and density feel slightly heavy despite compact goals.

## Goals
- Improve glanceability for primary device health and connection status.
- Make quick actions more scannable and reduce choice friction.
- Strengthen hierarchy without adding visual noise or losing compactness.
- Keep layout responsive and keyboard-friendly.

## Constraints
- Preserve minimal tech style and system theme tokens.
- No new backend APIs required.
- Keep existing actions and data fields.

## Data & Actions (Existing)
- Device fields: model/name, serial, Android version, API, battery %, WiFi, Bluetooth, GMS, device state (online/offline/unauthorized).
- Connection fields: ADB available, devices connected, running tasks, scrcpy available.
- Actions: Screenshot, Reboot, Start/Stop Recording, Clear Logcat, Live Mirror, APK Installer.

## Assumptions
- Accessibility: basic keyboard focus and contrast; WCAG AA mindset.
- KPI focus: reduce time-to-task for common actions; faster device health scan.

## Deliverable
- UX audit + prioritized backlog
- Updated layout proposal (zones and hierarchy)
- Component inventory + states
- Design tokens + microcopy suggestions
- Rollout/experiment plan (if applicable)
