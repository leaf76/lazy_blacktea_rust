# Rollout Plan

## Phases
- Internal testing with core users.
- Beta release to a subset of users for feedback.
- Full release.

## Feature Flags
- enable-shell-commands-v2-ui

## Monitoring
- Track session connection/disconnection rates.
- Monitor broadcast command usage and success rates.
- Collect user feedback via in-app surveys and analytics.
- Monitor performance metrics for large numbers of active sessions.

## Experiments
### Hypothesis: Making terminal controls persistently visible rather than on hover will increase discoverability and reduce user errors in controlling terminal sessions.
- Metric: Interaction rate with terminal controls (Ctrl+C, Clear, Connect/Disconnect) and reported errors.
- Success criteria: A 15% increase in terminal control interactions and a 10% decrease in reported terminal control issues within the first two weeks post-launch.
- Variants:
  - Controls always visible in a dedicated bar
  - Controls appear on terminal panel hover

