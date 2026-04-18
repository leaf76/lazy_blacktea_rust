# Device Item Redesign

- Date: 2026-04-18
- Surface: `Device Manager` device row in `/devices`
- Status: Approved for implementation

## Goal

Redesign the device item UI so each row is easier to scan and understand at a glance, while preserving the current list/table operating model and the existing selection and quick-action behavior.

The primary emphasis is information hierarchy. The secondary emphasis is smoother, more obvious interaction affordances.

## Non-Goals

- No backend or Tauri command changes
- No config schema changes
- No redesign of the device context menu model
- No redesign of the `DeviceGroupPanel`
- No full redesign of the device popover list
- No change to existing selection semantics, keyboard shortcuts, or right-click scope rules

## Current Problems

1. The current device row reads like a flat table instead of a management unit.
2. Identity, capability, and action information are spread across columns with equal visual weight.
3. `Primary`, group, status, and operability cues compete for attention instead of forming a clear scan order.
4. Multi-selection is functional but not visually obvious enough when scanning a large list.
5. In narrower widths, the row remains technically usable but loses hierarchy quickly.

## Design Direction

Use an `Identity-First Row` while keeping the outer list/table skeleton.

The row should read in this order:

1. Which device is this
2. What condition or capability does it currently have
3. Can it be acted on right now
4. What can I do next

## Row Structure

Each device row remains inside the existing desktop list/table surface, but the internal content is reorganized into four functional blocks.

### 1. Selection Rail

- Keep the checkbox in the far-left column
- Add a stronger selected-state cue beyond the checkbox alone
- Use a left-edge visual rail or equivalent accent so selected rows are easier to scan in multi-select mode
- Preserve the existing single-select and multi-select behavior

### 2. Identity Block

This is the most visually prominent block in the row.

Contents:

- Primary label: device model
- Secondary label: device name when available, otherwise serial
- Supporting metadata: serial in subdued monospace styling
- Supporting pills: `Primary`, group tag

Rules:

- Model is always the first thing the eye lands on
- `Primary` and group remain visible but must not overpower the model
- Serial stays easy to copy/read, but should become secondary metadata instead of a full standalone dominant column

### 3. Capability Block

This block combines device condition details that are currently fragmented across `Platform`, `Radios`, and `Battery`.

Contents:

- Android version and API level
- WiFi and Bluetooth status indicators
- Battery percentage and battery bar

Rules:

- Present these as a compact capability summary rather than three unrelated columns
- Android/API should stay readable as text
- Radios should remain chip-like or indicator-like
- Battery should keep both numeric value and progress bar

### 4. Status And Actions Block

This stays anchored on the right side of the row.

Contents:

- Connection state pill: `device`, `unauthorized`, `offline`, or equivalent current values
- `Set Primary` or `Primary` control
- Overflow actions trigger `…`

Rules:

- Status is the strongest operability signal in the row
- Actions should feel attached to the status area, not floating separately
- `Primary` as a state should be visually calmer than an active CTA
- The overflow action remains the gateway to quick actions and context-menu parity

## Visual Hierarchy Rules

### Identity First

- The identity block receives the strongest text contrast and typographic emphasis
- The row should no longer look like every column is equally important

### Status Second

- Status must be immediately legible, especially for `unauthorized` and `offline`
- `device` should read as stable and ready
- `unauthorized` should stand out clearly as a blocking or warning state

### Capability Third

- Platform, radios, and battery should be compact but readable
- These should support decision-making without competing with identity

### Actions Last

- Actions should be easy to discover, but must not visually dominate the row
- The row remains primarily a management/read surface, not a toolbar

## Interaction Rules

### Selection

- Keep current click, meta-click, shift-click, and keyboard behavior unchanged
- Increase clarity through row-state styling rather than behavior changes
- Selected rows use both background-state change and a clearer left-edge emphasis

### Primary

- Show `Primary` in the identity block as a status marker
- Keep the right-side primary control for explicit action
- When already primary, render the action in a lower-emphasis state so it reads as current state first, action second

### Context Menu

- Keep right-click behavior unchanged
- Keep keyboard context-menu access unchanged
- Keep the overflow button on the right as the visible row-level action entrypoint

### Hover / Focus / Disabled

- Hover should clarify row boundaries and reveal interaction readiness without over-highlighting
- Focus states must remain keyboard-visible
- Disabled actions must remain visually obvious and consistent with the existing dense desktop UI

## Responsive Behavior

This remains a desktop-first management surface.

### Wide Desktop

- Preserve the list/table shell
- Rebalance column widths in favor of the identity block
- Keep capability and status/action zones compact and aligned

### Medium Width

- Keep the row in list form
- Allow more internal stacking inside blocks where needed
- Reduce the sense of rigid equal-width columns

### Narrow Desktop / Current Scroll Breakpoint

- Keep horizontal scrolling as the fallback strategy
- Do not convert the device manager into a card wall
- Ensure identity, status, and primary action remain understandable even before full horizontal scan

## Implementation Scope

### Files Expected To Change

- `src/App.tsx`
- `src/App.css`

### Optional Minimal Supporting Change

If needed, add a very small helper or local extraction only when it directly improves readability of the row render. Avoid broad refactoring.

### Files Explicitly Out Of Scope

- `src/DeviceGroupPanel.tsx`
- backend Rust files
- updater, tasks, or unrelated pages

## Verification Plan

### Automated

- `npm run build`
- `npm run test`

### Manual UI Checks

Check these row states in `Device Manager`:

- online / ready device
- unauthorized device
- offline device
- selected row
- multi-selected rows
- primary row
- grouped and ungrouped row
- battery known and unknown
- radios on / off / unknown

### Layout Review

Review at least:

- common desktop width
- medium width before the narrow breakpoint
- current narrow horizontal-scroll state

### Interaction Review

Confirm:

- row click still selects correctly
- checkbox behavior remains unchanged
- `Set Primary` still works
- overflow menu still opens correctly
- keyboard focus and context menu access still work

## Risks

1. The row can become visually overloaded if identity, capability, and action blocks are all emphasized too strongly.
2. Over-stylizing the row could conflict with the existing dense console-like product language.
3. Shared styles may unintentionally affect the device popover or nearby list surfaces if selectors are too broad.

## Risk Mitigation

- Keep the redesign limited to device-manager row selectors
- Preserve current interaction logic and only change hierarchy and layout
- Favor tighter spacing and restrained accents over card-heavy decoration
- Verify the device popover is not unintentionally regressed

## Acceptance Criteria

1. The `/devices` row remains in list/table form, not a card wall.
2. The device identity becomes the clearest visual anchor in each row.
3. Connection status becomes easier to distinguish at a glance.
4. `Primary`, group, battery, and radio information remain visible but are visually subordinate to identity.
5. Existing selection and quick-action behavior remain functionally unchanged.
6. The updated row remains usable across the current desktop width range, including the narrow horizontal-scroll state.
