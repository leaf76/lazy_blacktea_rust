# UI/UX Audit

## Issues
### ISSUE-001: Visual Clutter and Hierarchy
- Severity: medium
- Evidence: Observed UI problems mention 'global toolbar/header can still feel visually heavy' and 'Multi-device layout needs clear hierarchy: session management vs. terminal viewing.'
- Recommendation: Implement a dedicated sidebar for session management and a main content area for terminal panels. Condense global toolbar.
- Acceptance Criteria:
  - Page is divided into distinct session management and terminal viewing areas.
  - Global toolbar is visually lighter and more compact.

### ISSUE-002: Session List Scanability
- Severity: medium
- Evidence: Observed UI problems state 'Active sessions list should support fast scanning: status, device name/model, and quick actions.'
- Recommendation: Enhance session list items with clear status indicators (color-coded pills/borders), device model, and easily accessible actions.
- Acceptance Criteria:
  - Session list items clearly display device status (connected, disconnected, error).
  - Device name/model is visible.
  - Quick actions (Connect/Disconnect/Remove) are present and visually distinct.

### ISSUE-003: Terminal Panel Controls Discoverability
- Severity: low
- Evidence: Observed UI problems mention 'Terminal panels should maximize output visibility (data density), while keeping essential controls discoverable.'
- Recommendation: Place terminal controls (Connect/Disconnect, Ctrl+C, Clear, Auto-scroll) in a dedicated, unobtrusive bar within the panel, possibly revealed on hover or persistently visible but compact.
- Acceptance Criteria:
  - Essential terminal controls are discoverable without cluttering the output area.
  - Controls remain accessible via keyboard.

### ISSUE-004: Ambiguity between Device Selection and Active Sessions
- Severity: medium
- Evidence: Current UX description mentions 'Device Context' selector and 'Active Sessions' list, implying two separate but related concepts that may cause confusion.
- Recommendation: Clarify the role of the 'Device Context' selector. If it's for discovering devices to *add* to active sessions, make this relationship explicit. Rename it to 'Available Devices'.
- Acceptance Criteria:
  - User understands how to discover devices and add them to active sessions.
  - The relationship between device discovery and active session management is clear.
  - The 'Device Context' selector is renamed to 'Available Devices'.

