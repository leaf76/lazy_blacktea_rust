import { describe, expect, it } from "vitest";
import type { DeviceInfo } from "./types";
import { buildLogcatPopupCandidates, partitionLogcatPopupTargets } from "./logcatPopup";

describe("logcatPopup", () => {
  it("builds candidates with online selected defaults from global selection", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "device", model: "Pixel 8" }, detail: null },
      { summary: { serial: "bravo", state: "offline", model: "Pixel 6" }, detail: null },
      { summary: { serial: "charlie", state: "device", model: "Nexus" }, detail: null },
    ];

    const candidates = buildLogcatPopupCandidates(devices, ["bravo", "charlie"], "alpha");

    expect(candidates.map((item) => item.serial)).toEqual(["alpha", "bravo", "charlie"]);
    expect(candidates.map((item) => item.defaultSelected)).toEqual([false, false, true]);
    expect(candidates.map((item) => item.selectable)).toEqual([true, false, true]);
  });

  it("falls back to active serial when global selection has no online candidates", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "device" }, detail: null },
      { summary: { serial: "bravo", state: "offline" }, detail: null },
    ];

    const candidates = buildLogcatPopupCandidates(devices, ["bravo"], "alpha");

    expect(candidates.map((item) => item.defaultSelected)).toEqual([true, false]);
  });

  it("partitions selected serials into online and skipped while preserving order", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "device" }, detail: null },
      { summary: { serial: "bravo", state: "offline" }, detail: null },
      { summary: { serial: "charlie", state: "device" }, detail: null },
    ];

    const result = partitionLogcatPopupTargets(["alpha", "bravo", "charlie"], devices);

    expect(result.openable).toEqual(["alpha", "charlie"]);
    expect(result.skipped).toEqual(["bravo"]);
  });

  it("deduplicates selected serials", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "device" }, detail: null },
      { summary: { serial: "bravo", state: "device" }, detail: null },
    ];

    const result = partitionLogcatPopupTargets(["alpha", "alpha", "bravo", "alpha"], devices);

    expect(result.openable).toEqual(["alpha", "bravo"]);
    expect(result.skipped).toEqual([]);
  });

  it("treats missing devices as skipped", () => {
    const devices: DeviceInfo[] = [{ summary: { serial: "alpha", state: "device" }, detail: null }];

    const result = partitionLogcatPopupTargets(["alpha", "missing"], devices);

    expect(result.openable).toEqual(["alpha"]);
    expect(result.skipped).toEqual(["missing"]);
  });
});
