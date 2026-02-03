# UI/UX Audit

## Context
- Evidence sources: user report ("completely can't understand the design"), no screenshots provided.
- Assumption: current UI exposes too many controls at once and lacks a clear starting point.

## Issues
### ISSUE: No clear entry point or guidance
- Severity: High
- Evidence: User cannot understand where to start; no onboarding guidance reported.
- Recommendation: Add a first-run guided state with device setup steps and a single primary action.
- Acceptance Criteria:
  - First run shows device setup checklist with a single CTA.
  - When a device connects, user is routed to Dashboard with status and quick actions.

### ISSUE: Information hierarchy is unclear
- Severity: High
- Evidence: User feedback indicates overall confusion.
- Recommendation: Introduce persistent navigation and a global device context header.
- Acceptance Criteria:
  - Sidebar navigation visible on all screens.
  - Selected device and connection status always visible.

### ISSUE: Overloaded screens with mixed tasks
- Severity: Medium
- Evidence: Likely multiple task types appear in one place (assumption).
- Recommendation: Separate modules (Actions, Logcat, Files, UI Inspector) into dedicated screens.
- Acceptance Criteria:
  - Each primary task has a dedicated screen with task-specific controls only.

### ISSUE: Poor discoverability of key actions
- Severity: Medium
- Evidence: User report suggests they cannot find what to do.
- Recommendation: Provide a Dashboard with "Quick Actions" and "Recent" sections.
- Acceptance Criteria:
  - Dashboard lists at least 6 common actions and recent packages/log filters.

### ISSUE: Accessibility and keyboard flow unclear
- Severity: Medium
- Evidence: No stated support; requirement is keyboard-first.
- Recommendation: Define focus order, shortcuts, and visible focus states.
- Acceptance Criteria:
  - Full keyboard access to navigation, device selection, and primary actions.
  - Visible focus ring and skip-to-content shortcut.
