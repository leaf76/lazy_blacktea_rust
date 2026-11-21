import { describe, expect, it } from "vitest";
import {
  getNextKeyboardDeviceIndex,
  matchesDeviceQuickFilters,
  toggleDeviceQuickFilter,
} from "./deviceQuickFilters";
import type { DeviceInfo } from "./types";

const makeDevice = (
  serial: string,
  opts: { wifi?: boolean; bt?: boolean; api?: string; platform?: "android" | "ios" } = {},
): DeviceInfo => ({
  summary: {
    serial,
    state: "device",
    platform: opts.platform ?? "android",
  },
  detail: {
    serial,
    wifi_is_on: opts.wifi ?? null,
    bt_is_on: opts.bt ?? null,
    api_level: opts.api ?? null,
  },
});

describe("deviceQuickFilters", () => {
  it("swaps mutually exclusive filter pairs on toggle", () => {
    let active = toggleDeviceQuickFilter([], "wifi_on");
    expect(active).toEqual(["wifi_on"]);
    active = toggleDeviceQuickFilter(active, "wifi_off");
    expect(active).toEqual(["wifi_off"]);
    active = toggleDeviceQuickFilter(active, "wifi_off");
    expect(active).toEqual([]);
  });

  it("filters devices accurately by connectivity, API level, selection, and recording", () => {
    const devA = makeDevice("A", { wifi: true, bt: false, api: "34" });
    const devB = makeDevice("B", { wifi: false, bt: true, api: "31" });
    const devIos = makeDevice("IOS-1", { platform: "ios" });
    const ctx = {
      selectedSerialSet: new Set(["A"]),
      screenRecordStatusBySerial: {
        A: {
          serial: "A",
          running: true,
          backend: "adb" as const,
          display_path: "/tmp/a.mp4",
          segment_count: 1,
        },
      },
    };

    expect(matchesDeviceQuickFilters(devA, ["wifi_on", "api_34_plus", "selected", "recording"], ctx)).toBe(true);
    expect(matchesDeviceQuickFilters(devB, ["wifi_on"], ctx)).toBe(false);
    expect(matchesDeviceQuickFilters(devB, ["wifi_off", "bt_on"], ctx)).toBe(true);
    expect(matchesDeviceQuickFilters(devIos, ["ios"], ctx)).toBe(true);
    expect(matchesDeviceQuickFilters(devIos, ["api_33_plus"], ctx)).toBe(false);
  });

  it("computes bounded keyboard navigation indices", () => {
    expect(getNextKeyboardDeviceIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(getNextKeyboardDeviceIndex(0, "ArrowDown", 3)).toBe(1);
    expect(getNextKeyboardDeviceIndex(2, "ArrowDown", 3)).toBe(2);
    expect(getNextKeyboardDeviceIndex(0, "ArrowUp", 3)).toBe(0);
    expect(getNextKeyboardDeviceIndex(-1, "ArrowUp", 3)).toBe(2);
    expect(getNextKeyboardDeviceIndex(1, "Home", 3)).toBe(0);
    expect(getNextKeyboardDeviceIndex(1, "End", 3)).toBe(2);
    expect(getNextKeyboardDeviceIndex(0, "ArrowDown", 0)).toBeNull();
  });
});
