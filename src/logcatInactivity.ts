export const LOGCAT_INACTIVITY_TIMEOUT_MS = 120_000;

export const LOGCAT_INACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

export const normalizeLogcatLastActivityAt = (
  value: number,
  fallback: number,
): number => {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
};

export const hasLogcatInactivityTimedOut = (
  lastActivityAt: number,
  now: number,
  timeoutMs: number = LOGCAT_INACTIVITY_TIMEOUT_MS,
): boolean => {
  if (!Number.isFinite(now) || now < 0) {
    return false;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return false;
  }
  const normalizedLastActivityAt = normalizeLogcatLastActivityAt(lastActivityAt, now);
  return now - normalizedLastActivityAt >= timeoutMs;
};

export const getRunningLogcatSerials = (
  runningBySerial: Record<string, boolean>,
): string[] => {
  return Object.entries(runningBySerial)
    .filter(([, running]) => running)
    .map(([serial]) => serial);
};
