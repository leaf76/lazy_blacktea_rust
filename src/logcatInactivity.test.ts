import { describe, expect, it } from "vitest";
import {
  LOGCAT_INACTIVITY_TIMEOUT_MS,
  getRunningLogcatSerials,
  hasLogcatInactivityTimedOut,
  normalizeLogcatLastActivityAt,
} from "./logcatInactivity";

describe("logcatInactivity", () => {
  it("times out when elapsed milliseconds is at least the timeout", () => {
    const now = 500_000;
    const exactlyTimedOut = now - LOGCAT_INACTIVITY_TIMEOUT_MS;
    const overTimedOut = now - LOGCAT_INACTIVITY_TIMEOUT_MS - 1;

    expect(hasLogcatInactivityTimedOut(exactlyTimedOut, now)).toBe(true);
    expect(hasLogcatInactivityTimedOut(overTimedOut, now)).toBe(true);
  });

  it("does not time out when elapsed milliseconds is below the timeout", () => {
    const now = 500_000;
    const belowTimeout = now - LOGCAT_INACTIVITY_TIMEOUT_MS + 1;

    expect(hasLogcatInactivityTimedOut(belowTimeout, now)).toBe(false);
  });

  it("falls back safely for invalid timestamps", () => {
    const now = 500_000;
    expect(hasLogcatInactivityTimedOut(Number.NaN, now)).toBe(false);
    expect(hasLogcatInactivityTimedOut(-1, now)).toBe(false);
    expect(hasLogcatInactivityTimedOut(now - 10, Number.NaN)).toBe(false);
  });

  it("normalizes invalid last activity timestamps to fallback", () => {
    const fallback = 123_456;
    expect(normalizeLogcatLastActivityAt(Number.NaN, fallback)).toBe(fallback);
    expect(normalizeLogcatLastActivityAt(-100, fallback)).toBe(fallback);
    expect(normalizeLogcatLastActivityAt(100, fallback)).toBe(100);
  });

  it("returns only running serials", () => {
    expect(
      getRunningLogcatSerials({
        "emulator-5554": true,
        "192.168.0.9:5555": false,
        USB123: true,
      }),
    ).toEqual(["emulator-5554", "USB123"]);
  });
});
