import { describe, expect, it } from "vitest";

import {
  buildConnectivityActionMeta,
  buildFanOutActionMeta,
  buildSingletonActionMeta,
  resolveBatchAction,
} from "./batchActions";

describe("batchActions", () => {
  it("splits mixed stateful toggles into start and stop groups", () => {
    const meta = resolveBatchAction({
      kind: "stateful-toggle",
      selectedSerials: ["alpha", "bravo", "charlie"],
      availabilityBySerial: {
        alpha: true,
        bravo: true,
        charlie: false,
      },
      activeBySerial: {
        alpha: true,
        bravo: false,
      },
      taskGroupKeys: {
        start: "screen_record_start",
        stop: "screen_record_stop",
      },
      buildCopy: () => ({
        title: "Toggle Recording",
        description: "Stop active recordings and start recording on idle selected devices.",
        hint: "Multi-device",
        summary: null,
      }),
    });

    expect(meta.actionMode).toBe("toggle");
    expect(meta.eligibleSerials).toEqual(["alpha", "bravo"]);
    expect(meta.skippedSerials).toEqual(["charlie"]);
    expect(meta.activeSerials).toEqual(["alpha"]);
    expect(meta.idleSerials).toEqual(["bravo"]);
    expect(meta.taskGroups).toEqual([
      { action: "stop", key: "screen_record_stop", serials: ["alpha"] },
      { action: "start", key: "screen_record_start", serials: ["bravo"] },
    ]);
  });

  it("builds fan-out metadata with eligible and skipped counts", () => {
    const meta = buildFanOutActionMeta({
      selectedSerials: ["alpha", "bravo"],
      availabilityBySerial: {
        alpha: true,
        bravo: false,
      },
      title: "Screenshot",
      singleDescription: "Capture a screenshot from the selected device.",
      multiDescription: "Capture screenshots from eligible selected devices.",
    });

    expect(meta.actionMode).toBe("run");
    expect(meta.disabled).toBe(false);
    expect(meta.eligibleSerials).toEqual(["alpha"]);
    expect(meta.skippedSerials).toEqual(["bravo"]);
    expect(meta.description).toContain("1 eligible, 1 skipped");
    expect(meta.hint).toBe("Multi-device");
  });

  it("chooses enable for mixed connectivity state without toggling active devices off", () => {
    const meta = buildConnectivityActionMeta({
      capabilityLabel: "Wi-Fi",
      selectedSerials: ["alpha", "bravo", "charlie"],
      availabilityBySerial: {
        alpha: true,
        bravo: true,
        charlie: false,
      },
      activeBySerial: {
        alpha: true,
        bravo: false,
      },
    });

    expect(meta.title).toBe("Enable Wi-Fi");
    expect(meta.actionMode).toBe("set");
    expect(meta.eligibleSerials).toEqual(["alpha", "bravo"]);
    expect(meta.skippedSerials).toEqual(["charlie"]);
    expect(meta.description).toContain("2 eligible, 1 skipped");
    expect(meta.taskGroups).toEqual([{ action: "set", key: "set_active", serials: ["alpha", "bravo"] }]);
  });

  it("blocks singleton actions for multi-selection", () => {
    const meta = buildSingletonActionMeta({
      selectedSerials: ["alpha", "bravo"],
      availabilityBySerial: {
        alpha: true,
        bravo: true,
      },
      title: "Clear Logcat",
      readyDescription: "Clear the logcat buffer for the selected device.",
      blockedDescription: "Select exactly one online device to clear the logcat buffer.",
      hint: "Single device",
    });

    expect(meta.actionMode).toBe("blocked");
    expect(meta.disabled).toBe(true);
    expect(meta.taskGroups).toEqual([]);
    expect(meta.description).toContain("Select exactly one online device");
    expect(meta.hint).toBe("Single device");
  });
});
