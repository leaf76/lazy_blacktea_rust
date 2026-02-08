# UI/UX Artifacts (uiux/) Agent Notes

## OVERVIEW
Design and planning artifacts (Markdown/JSON) used to guide UI iteration; not runtime code.

## WHERE TO LOOK

| Topic | Location | Notes |
| --- | --- | --- |
| Redesign brief | `brief.md` | Product goals + assumptions |
| Layout notes | `brief-layout.md` | Layout-specific guidance |
| Layout tokens/backlog | `uiux/layout/` | Design tokens and layout decisions |
| Device manager iteration | `uiux/device-manager/` | Optimization artifacts |
| Device selection iteration | `uiux/device-selection-iterate/` | Exploration notes and iterations |

## CONVENTIONS

- Keep content actionable (decisions, constraints, rationale); avoid generic design advice.
- Treat these docs as guidance; validate against actual UI behavior before changing UX.

## ANTI-PATTERNS

- Do not treat plans as implementation truth if code has diverged; reconcile with `src/` before acting.
- Do not store secrets, tokens, or personal data in design artifacts.
