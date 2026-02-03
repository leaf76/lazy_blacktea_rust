# UI/UX Plan

## Assumptions
- Users are technical (QA/Devs) and understand ADB concepts.
- The app runs in a desktop environment where 'system' theme implies OS light/dark mode compliance.
- Scrcpy binary availability is managed outside the UI, or the UI needs to guide the path configuration.
-  'Lazy Blacktea' implies a need for efficiency/laziness in workflows (automation/scripts).

## Open Questions
- Are there existing specific brand colors, or should we rely entirely on semantic system colors?
- Does the 'Actions' page support custom user scripts or just predefined ADB commands?
- Should the wireless pairing support mDNS discovery if available?
- Is the 'UI Inspector' strictly for XML dumping or does it support interactive element selection?

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
### Wireless Connect via QR
- User opens 'Device Manager'
- Selects 'Pair New Device'
- Pastes QR payload or Types Pairing Code + Port
- System auto-fills connection address
- User clicks 'Pair' -> 'Connect'
- Device appears in Top Bar Selector

### Analyze UI Layout
- User selects target device in Top Bar
- Navigates to 'UI Inspector'
- Clicks 'Capture Hierarchy'
- View renders interactive tree + screenshot
- User hovers element to see attributes

