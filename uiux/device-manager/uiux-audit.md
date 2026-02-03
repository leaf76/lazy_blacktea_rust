# UI/UX Audit

## Issues
### ambiguous_selection: Active vs Selected ambiguity
- Severity: High
- Evidence: Device list uses a single highlight/checkbox pattern; users confuse focused row with selected rows.
- Recommendation: Distinguish focus vs selection with different visual treatments (focus border + glow, selection checkbox + row tint).
- Acceptance Criteria:
  - Focused row has a distinct border or glow.
  - Selected rows show checkbox and a consistent background tint.
  - Users can identify active vs selected at a glance.

### scattered_controls: Selection, grouping, actions spread out
- Severity: Medium
- Evidence: Selection controls in top-right, group assignment in filter area, action buttons at the bottom.
- Recommendation: Consolidate selection helpers next to filters; move group assignment + bulk actions into a unified Command Bar.
- Acceptance Criteria:
  - Filter bar contains search, group filter, select visible, clear selection, and selection count.
  - Command Bar contains group assignment and all bulk actions.

### scanability: Inline text noise for status
- Severity: Medium
- Evidence: WiFi/BT text (On/Off) in the same line as model/serial increases cognitive load.
- Recommendation: Replace status text with icons and semantic colors; align key data in columns.
- Acceptance Criteria:
  - WiFi/BT/connection states use icons with color and tooltip labels.
  - Model, serial, Android/API appear in consistent columns.
