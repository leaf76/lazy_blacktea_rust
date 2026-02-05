# Component Inventory

## Global Toolbar
- Purpose: Header for global actions and context.
- Variants:
  - Default
  - Compact
- States:
  - Default
  - Scanning Devices
  - Broadcast Active
- Accessibility:
  - Ensure all interactive elements are keyboard focusable and have clear, descriptive labels (e.g., using `aria-label`).
  - Use ARIA attributes for status updates (e.g., `aria-live` for scanning status).

## Available Devices Selector
- Purpose: Allows users to discover and select available ADB devices to add to active sessions.
- Variants:
  - Multi-select enabled
  - Single-select
- States:
  - No devices found
  - Devices found
  - Loading devices
- Accessibility:
  - Use accessible form elements (e.g., checkboxes for multi-select, ARIA for listbox).
  - Provide clear labels and instructions.
  - Ensure focus management within the selector is logical.

## Active Sessions List
- Purpose: Displays and manages the list of pinned, active shell sessions.
- Variants:
  - With pinned sessions
  - Empty state
- States:
  - Empty
  - Loading sessions
  - Sessions restored
- Accessibility:
  - Each session item must be focusable and keyboard navigable.
  - Use ARIA live regions for status updates (e.g., when a session connects/disconnects).
  - Visually distinguish the currently focused session.

## Session List Item
- Purpose: Represents a single pinned session in the Active Sessions List.
- Variants:
  - Connected
  - Disconnected
  - Error
  - Selected
- States:
  - Connected
  - Disconnected
  - Error
  - Connecting
  - Selected
- Accessibility:
  - Clear visual distinction for selected state.
  - Status pill should have sufficient contrast and be screen-reader accessible.
  - Action buttons (Connect/Disconnect/Remove) within the item must be clearly labeled and focusable.

## Terminal Panel
- Purpose: Displays interactive shell output and input for a single device.
- Variants:
  - Output view
  - Input view
  - With controls visible
  - With controls hidden (hover)
- States:
  - Connecting
  - Connected (Active)
  - Connected (Inactive)
  - Disconnected
  - Error
  - Empty output
- Accessibility:
  - Terminal output should be readable by screen readers (e.g., using `aria-live` for new output).
  - Input line must be clearly focusable and indicate focus.
  - All controls must be keyboard accessible and have clear labels.
  - Ensure sufficient contrast for text and controls.

## Broadcast Input/Button
- Purpose: Allows sending a command to all connected sessions.
- Variants:
  - Enabled
  - Disabled
- States:
  - Enabled
  - Disabled (no connected sessions)
- Accessibility:
  - Input field must be clearly labeled (e.g., 'Broadcast command').
  - Button must be keyboard focusable and accessible.
  - Provide feedback if broadcast fails.

