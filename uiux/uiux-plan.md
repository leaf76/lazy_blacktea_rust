# UI/UX Plan

## Assumptions
- The "Device Context" selector is for discovering available ADB devices, and "Active Sessions" are devices the user has explicitly chosen to connect and monitor.
- The primary interaction for sending commands is via the input line at the bottom of each terminal panel, with broadcasting as a secondary, global action.
- The existing visual language is dark, compact, and uses subtle borders.
- The target audience is technically proficient and values efficiency.
- Sessions are 'pinned' by default when a device is connected and actively managed through the 'Active Sessions' list.

## Open Questions
- What is the exact relationship between the "Device Context" selector and the "Active Sessions" list? Are they intended to be different views or complementary?
- How does the user *pin* a session to the "Active Sessions" list? Is it automatic upon connection, or a separate action?
- What is the intended workflow for managing a large number of devices (e.g., >20)?
- Are there specific keyboard shortcuts currently implemented or desired for session management and interaction?
- What are the specific WCAG AA success criteria that are most relevant and challenging for this interface?

## UX Goals
- Streamline multi-device shell session management for technical users.
- Enhance clarity and density in the display of active terminal sessions and their statuses.
- Improve discoverability of session management actions and broadcasting capabilities.
- Ensure robust accessibility for keyboard and screen reader users.

## Success Metrics
- Reduction in time to connect/disconnect multiple sessions.
- Increased adoption of broadcast feature.
- Positive user feedback on session management clarity and efficiency.
- Passing automated accessibility checks (e.g., AXE-core).

## Information Architecture
### Sitemap
- Shell Commands

### Navigation Rules
- "Shell Commands" is a primary navigation item.
- Within "Shell Commands", focus shifts between the session list and individual terminal panels.
- Keyboard navigation should cycle through global toolbar, session list, broadcast input, and then terminal panels in order.

## User Flows
### Connect & Broadcast to Multiple Devices
- Navigate to Shell Commands page.
- Select multiple devices from the 'Available Devices' selector.
- Click 'Connect Selected' to establish sessions.
- Enter command in the global broadcast input.
- Click 'Broadcast' to send command to all connected sessions.
- Observe output in all terminal panels.

### Manage Pinned Sessions
- Connect to a device.
- Observe session automatically added to 'Active Sessions' list.
- Click 'Remove' action on a session in the list to unpin/disconnect.
- Disconnect a session manually via its terminal panel.
- Observe session remaining in 'Active Sessions' list.
- Restart application.
- Observe previously active sessions attempting to reconnect.

### Interact with a Single Terminal Session
- Navigate to Shell Commands page.
- Click on a session in the 'Active Sessions' list to focus it.
- Observe focus highlight on the terminal panel.
- Type command in the terminal panel's input line.
- Press Enter to send command.
- Observe output.
- Click 'Interrupt (Ctrl+C)' to interrupt the running command.
- Click 'Clear Output' to clear terminal output.

