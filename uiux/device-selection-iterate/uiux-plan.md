# UI/UX Plan

## Assumptions
- Device group assignments (groupMap) and task execution history are available in the frontend state.
- A device can appear in both 'Recent' and its specific 'Group' section (duplicates allowed for quick access).
- The 'Primary' device concept is distinct from 'Selected' devices (active vs. target set).
- The trigger button for the popover already exists in the top bar.

## Open Questions
- Should the 'Recent' list persist across app restarts?
- How should the UI handle a device that is in 'Recent' but currently disconnected?
- Is there a maximum height pixel value for the popover, or should it be viewport relative (e.g., 80vh)?
- Does clicking a checkbox in the 'Recent' section also check the same device in its Group section?

## UX Goals
- (missing)

## Success Metrics
- (missing)

## Information Architecture
### Sitemap
- (missing)

### Navigation Rules
- (missing)

## User Flows
### Select Primary Device
- User clicks or tabs to Device Context trigger
- Popover opens centered to trigger
- User navigates to desired device in 'Recent' or Group list
- User clicks row body OR presses Enter/Space
- Row highlights as Primary
- Popover closes (optional) or stays open for multi-selection

### Multi-select Targets
- User opens popover
- User clicks checkboxes for multiple devices
- Counter updates in footer/header
- User presses Esc or clicks outside to close

