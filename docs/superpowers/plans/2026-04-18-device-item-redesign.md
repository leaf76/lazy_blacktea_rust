# Device Item Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `/devices` device row into an identity-first management row without changing selection semantics, quick-action behavior, or backend contracts.

**Architecture:** Keep the existing desktop list/table shell in `src/App.tsx`, but reorganize the row markup into clearer identity, capability, and status/action blocks. Confine visual changes to `src/App.css`, keep logic changes local to the device-manager row, and verify that the device popover still renders correctly after the CSS changes.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, existing dense console-style CSS in `src/App.css`

---

## File Structure

- Modify: `src/App.tsx`
  - Rework the `/devices` row JSX only
  - Add small local derived labels if needed for readability
  - Keep existing selection, keyboard, and context-menu handlers intact
- Modify: `src/App.css`
  - Replace the flat row treatment with identity-first row layout styles
  - Add state styling for selected, active, unauthorized, offline, hover, and focus-visible
  - Adjust responsive behavior for medium width and the existing horizontal-scroll breakpoint
- Verify only: `src/DeviceGroupPanel.tsx`
  - No code changes expected
  - Confirm the row redesign does not visually clash with the group panel

## Task 1: Restructure Device Manager Row Markup

**Files:**
- Modify: `src/App.tsx:14464-14553`
- Test: Manual verification in `/devices`

- [ ] **Step 1: Snapshot the current row contract before editing**

Review the current row responsibilities in `src/App.tsx` and confirm these behaviors must remain unchanged:

```tsx
onClick={(event) => handleDeviceRowSelect(event, serial, index)}
onKeyDown={(event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".device-check") || target?.closest(".device-primary-action")) {
    return;
  }
  openDeviceQuickContextMenuFromKeyboard(event, serial, {
    source: "device_manager",
    rowIndex: index,
  });
}}
onContextMenu={(event) =>
  openDeviceQuickContextMenuFromPointer(event, serial, {
    source: "device_manager",
    rowIndex: index,
    showSelectionHint: true,
  })
}
```

Expected result: clear confirmation that the redesign is layout-only and should not alter row interaction semantics.

- [ ] **Step 2: Introduce derived row labels for identity-first rendering**

Inside the `visibleDevices.map((device, index) => { ... })` block, add local labels that support the new hierarchy:

```tsx
const modelLabel = detail?.model ?? device.summary.model ?? serial;
const secondaryLabel =
  detail?.name && detail.name !== modelLabel ? detail.name : serial;
const platformLabel = detail?.android_version ? `Android ${detail.android_version}` : "Android --";
const apiLabel = detail?.api_level ? `API ${detail.api_level}` : "API --";
const groupLabel = groupMap[serial] ?? null;
```

Expected result: row markup can read from semantic labels instead of repeating fallback chains inline.

- [ ] **Step 3: Replace the flat row body with identity, capability, and status/action blocks**

Rework the row body from the current flat column layout to this structure:

```tsx
<div className={`device-row${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}>
  <label className="device-check">...</label>
  <div className="device-cell device-identity">
    <div className="device-identity-main">
      <div className="device-identity-heading">
        <strong>{modelLabel}</strong>
        {isActive && <span className="device-active-badge">Primary</span>}
        {groupLabel && <span className="group-tag">{groupLabel}</span>}
      </div>
      <div className="device-identity-sub">
        <span>{secondaryLabel}</span>
      </div>
    </div>
    <div className="device-identity-meta">
      <span className="device-serial">{serial}</span>
    </div>
  </div>
  <div className="device-cell device-capability">
    <div className="device-platform">
      <span>{platformLabel}</span>
      <span className="muted">{apiLabel}</span>
    </div>
    <div className="device-radios">...</div>
    <div className="device-battery">...</div>
  </div>
  <div className="device-cell device-status-actions">
    <div className="device-state">
      <span className={`status-pill ${stateTone}`}>{device.summary.state}</span>
    </div>
    <div className="device-actions">
      <button type="button" className={`ghost device-primary-action${isActive ? " is-primary" : ""}`}>...</button>
      <button type="button" className="ghost icon-only">⋯</button>
    </div>
  </div>
</div>
```

Expected result: the row reads left-to-right as identity -> capability -> operability.

- [ ] **Step 4: Keep existing action and checkbox handlers wired to the new structure**

After restructuring, ensure these handlers remain attached and unchanged in meaning:

```tsx
onClick={(event) => {
  event.stopPropagation();
  if (deviceSelectionMode === "multi") {
    toggleDevice(serial);
  } else {
    setSelectedSerials((prev) =>
      prev.length === 1 && prev[0] === serial ? prev : [serial],
    );
  }
  lastSelectedIndexRef.current = index;
}}
```

```tsx
onClick={(event) => {
  event.stopPropagation();
  if (!isActive) {
    handleSelectActiveSerial(serial);
  }
}}
```

Expected result: no change to checkbox selection, primary switching, or overflow menu opening.

## Task 2: Redesign Row Styles For Identity-First Hierarchy

**Files:**
- Modify: `src/App.css:1927-2160`
- Test: `npm run build`

- [ ] **Step 1: Update the row grid to support three functional content zones**

Replace the current equalized content columns with a more identity-weighted grid:

```css
.device-list-header,
.device-row {
  display: grid;
  min-width: 980px;
  grid-template-columns:
    34px
    minmax(320px, 2.4fr)
    minmax(260px, 1.5fr)
    minmax(210px, 1.1fr);
  gap: 12px;
  align-items: center;
}
```

Expected result: identity gets more width, while capability and actions stay compact.

- [ ] **Step 2: Add row-shell styling for clearer selection and active states**

Update the row shell styling to reinforce selection and active state:

```css
.device-row {
  position: relative;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--color-border);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0));
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease,
    background 120ms ease,
    transform 120ms ease;
}

.device-row::before {
  content: "";
  position: absolute;
  inset: 8px auto 8px 6px;
  width: 3px;
  border-radius: 999px;
  background: transparent;
}

.device-row.is-selected::before {
  background: var(--color-primary-600);
}

.device-row.is-selected {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.35);
}

.device-row.is-active {
  box-shadow: 0 0 0 1px var(--color-primary-600);
}
```

Expected result: selected and active rows are easier to scan without overwhelming the content.

- [ ] **Step 3: Add identity block styles**

Create styles for the new identity block:

```css
.device-identity {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.device-identity-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.device-identity-heading strong {
  font-size: 14px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-identity-sub {
  font-size: 12px;
  color: var(--color-text-muted);
}

.device-identity-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
```

Expected result: model becomes the strongest label, while serial and name become supporting metadata.

- [ ] **Step 4: Add capability and status/action block styles**

Add styles for the capability cluster and the right-side action area:

```css
.device-capability {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
}

.device-status-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  justify-items: end;
  min-width: 0;
}

.device-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
```

Expected result: status and row actions feel grouped and anchored to the right edge.

## Task 3: Refine State Styling And Narrow-Width Behavior

**Files:**
- Modify: `src/App.css:2403-2410` and nearby responsive rules
- Test: `npm run build`

- [ ] **Step 1: Strengthen status-specific affordances without changing status text**

Add state-specific row accents for non-ready devices:

```css
.device-state .status-pill.error {
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.25);
}

.device-row[data-device-state="unauthorized"] {
  border-color: rgba(239, 68, 68, 0.28);
}

.device-row[data-device-state="offline"] .device-identity-heading strong,
.device-row[data-device-state="offline"] .device-identity-sub {
  opacity: 0.9;
}
```

Then set the attribute in JSX:

```tsx
data-device-state={device.summary.state}
```

Expected result: `unauthorized` and `offline` become easier to distinguish at a glance without changing current labels.

- [ ] **Step 2: Make medium-width rows internally stack more gracefully**

Add a medium-width rule that preserves the list/table shell but relaxes internal alignment:

```css
@media (max-width: 1180px) {
  .device-row {
    align-items: start;
  }

  .device-status-actions {
    justify-items: stretch;
  }

  .device-actions {
    justify-content: flex-start;
  }
}
```

Expected result: the row remains readable before the narrow horizontal-scroll breakpoint.

- [ ] **Step 3: Keep the existing narrow horizontal-scroll fallback, but update the minimum width if needed**

Adjust the narrow breakpoint only if the new row needs slightly more room:

```css
@media (max-width: 980px) {
  .device-list-header,
  .device-row {
    min-width: 940px;
  }
}
```

Expected result: the redesign still works with the current desktop-first horizontal-scroll strategy.

## Task 4: Regression Guard For Device Popover And Shared Controls

**Files:**
- Verify only: `src/App.tsx:12321-12369`
- Verify only: `src/App.css` selectors touching `.device-check`, `.device-primary-action`, `.group-tag`
- Test: `npm run test`

- [ ] **Step 1: Confirm shared class names still behave correctly in the device popover**

Review the existing popover row markup:

```tsx
<div className={`device-popover-row${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}>
  <label className="device-check">...</label>
  <div className="device-popover-meta">...</div>
  <span className={`status-pill ${stateTone}`}>{device.summary.state}</span>
  <button type="button" className={`ghost device-primary-action${isActive ? " is-primary" : ""}`}>...</button>
</div>
```

Expected result: no accidental layout regressions caused by broad selectors.

- [ ] **Step 2: Narrow any new CSS selectors that should only affect the device-manager row**

If a new selector could bleed into the popover, scope it to the manager row:

```css
.device-row .device-primary-action { ... }
.device-row .device-check { ... }
.device-row .group-tag { ... }
```

Expected result: popover keeps its current compact rendering unless explicitly updated later.

## Task 5: Verify Build, Tests, And UI State Coverage

**Files:**
- Modify only if needed from prior tasks: `src/App.tsx`, `src/App.css`
- Test: repo root validation commands

- [ ] **Step 1: Run the frontend build**

Run:

```bash
npm run build
```

Expected: successful TypeScript compile and Vite production build with no new errors.

- [ ] **Step 2: Run the frontend test suite**

Run:

```bash
npm run test
```

Expected: all existing Vitest tests pass; no new regressions introduced by the row redesign.

- [ ] **Step 3: Perform manual UI verification in `/devices`**

Check these scenarios:

```text
- Ready device row
- Unauthorized device row
- Offline device row
- Selected row
- Multi-selected rows
- Primary row
- Grouped row
- Ungrouped row
- Battery known and unknown
- WiFi/Bluetooth on, off, and unknown
```

Expected: the row hierarchy reads as identity first, status second, capability third, actions last.

- [ ] **Step 4: Perform layout review at the required widths**

Check:

```text
- Common desktop width
- Medium width before narrow breakpoint
- Narrow width where the list becomes horizontally scrollable
```

Expected: no clipped primary status, no obscured overflow action, and no unreadable identity block.

- [ ] **Step 5: Commit the implementation**

Run:

```bash
git add src/App.tsx src/App.css
git commit -m "feat: redesign device manager rows"
```

Expected: commit contains only the device row redesign work.

## Self-Review

### Spec Coverage

- Identity-first hierarchy: covered by Task 1 and Task 2
- Stronger selection clarity: covered by Task 2
- Status emphasis: covered by Task 3
- Responsive behavior: covered by Task 3 and Task 5
- Preserve existing interactions: covered by Task 1 and Task 4

### Placeholder Scan

- No `TBD`, `TODO`, or unresolved placeholders included
- Each code-edit step includes concrete JSX or CSS targets
- Each verification step includes exact commands or explicit scenarios

### Type Consistency

- New JSX uses existing `detail`, `serial`, `groupMap`, `stateTone`, and `isActive` values
- New attribute `data-device-state` matches `device.summary.state`
- No new backend or shared helper contracts introduced
