import { describe, expect, it } from "vitest";
import type { AppConfig } from "./types";
import { clampRefreshIntervalSec, getAutoRefreshIntervalMs } from "./deviceAutoRefresh";

describe("deviceAutoRefresh", () => {
  it("clamps invalid values to the default interval", () => {
    expect(clampRefreshIntervalSec(0)).toBe(5);
    expect(clampRefreshIntervalSec(-10)).toBe(5);
    expect(clampRefreshIntervalSec(Number.NaN)).toBe(5);
    expect(clampRefreshIntervalSec(Number.POSITIVE_INFINITY)).toBe(5);
  });

  it("returns null when config is missing or disabled", () => {
    expect(getAutoRefreshIntervalMs(null)).toBeNull();

    const config = {
      device: { refresh_interval: 5, auto_refresh_enabled: false },
    } as unknown as AppConfig;

    expect(getAutoRefreshIntervalMs(config)).toBeNull();
  });

  it("returns milliseconds when enabled", () => {
    const config = {
      device: { refresh_interval: 5, auto_refresh_enabled: true },
    } as unknown as AppConfig;

    expect(getAutoRefreshIntervalMs(config)).toBe(5000);
  });

  it("falls back to default milliseconds when interval is invalid", () => {
    const config = {
      device: { refresh_interval: 0, auto_refresh_enabled: true },
    } as unknown as AppConfig;

    expect(getAutoRefreshIntervalMs(config)).toBe(5000);
  });
});

