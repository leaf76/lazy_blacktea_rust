# UI/UX Plan

## Assumptions
- Users are technical (QA/engineers) but prefer clear UI over CLI memorization.
- Multiple devices can be connected; a single "selected device" drives most views.
- Core features remain: device discovery, operations, logcat, file browsing, UI hierarchy.

## Decisions
- Wireless ADB pairing is required (QR/pairing code).
- No mandatory logcat presets or tag conventions.
- UI Inspector includes live mirror mode plus static capture fallback.

## UX Goals
- Reduce learning curve by showing one obvious next step at all times.
- Keep device context persistent and visible.
- Progressive disclosure for advanced commands.
- Keyboard-first navigation with clear focus states.

## Success Metrics
- First-time user completes "connect device + run a quick action" in < 3 minutes.
- Users can find logcat and UI inspector within 10 seconds from home.
- Error states are actionable and recovery guidance is visible.

## Information Architecture
### Sitemap
- Dashboard (Home)
- Actions
- Logcat
- Files
- UI Inspector
- Apps
- Settings

### Navigation Rules
- Top Bar: device selector, connection status, command palette.
- Sidebar: primary modules only; no nested menus by default.
- If no device, show global empty state and disable device-specific modules.

## User Flows
### Onboarding / First Run
1. App launch -> check ADB status.
2. If ADB missing: show install steps.
3. If no device: show connect steps (USB + wireless pairing).
4. When device connects: auto-select and land on Dashboard.

### Run a Common Action
1. Select device in top bar.
2. Go to Actions.
3. Click a Quick Action tile (e.g., Screenshot).
4. Show result toast + output location.

### Stream Logs
1. Go to Logcat.
2. Stream auto-starts.
3. Filter by level or tag.
4. Pause/Resume/Clear via toolbar or shortcuts.

### Inspect UI Hierarchy
1. Go to UI Inspector.
2. Choose Static Capture or Live Mirror.
3. Capture screenshot + XML (static) or start mirror stream.
4. View screenshot/mirror + node tree + properties.
4. Hover/select element to sync between panes.

### Pair Device (Wireless)
1. Open Connect Device from empty state or top bar.
2. Start pairing (QR or pairing code).
3. Confirm device appears and is selectable.

## Screen Specs (High Level)
### Dashboard
- Device status card (model, Android version, battery, WiFi IP).
- Quick Actions grid.
- Recent packages / recent filters.
- Empty state: connect device CTA.

### Actions
- Categorized action tiles with "Advanced" toggle.
- Inline parameters for actions that require input.

### Logcat
- Sticky filter bar (search, level toggles, tag presets).
- Virtualized log list.
- Empty/loading/error states.

### Files
- Two-pane (Local | Device) with breadcrumb path.
- Drag/drop push/pull, context menu.

### UI Inspector
- Three-pane: screenshot canvas | tree | properties.
- Toolbar: Capture, Refresh, Export, Live Mirror toggle.
- If live mirror dependency is missing, show setup instructions and fall back to static capture.

### Apps
- Searchable package list with actions (launch, clear data, uninstall).

### Settings
- ADB path, wireless pairing, log options, default output locations, keyboard shortcuts.

## Accessibility Requirements
- Keyboard-only flow for all primary tasks.
- Visible focus outline with sufficient contrast.
- ARIA labels for controls and tree items.
- Provide skip-to-content and command palette shortcut.
