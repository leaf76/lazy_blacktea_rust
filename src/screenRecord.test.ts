import { describe, expect, it } from "vitest";

import { buildScreenRecordActionMeta, resolveScreenRecordSelectionState } from "./screenRecord";
import type { ScreenRecordStatus } from "./types";

const runningStatus = (serial: string): ScreenRecordStatus => ({
  serial,
  running: true,
  backend: "adb",
  display_path: `/sdcard/${serial}.mp4`,
  segment_count: 1,
});

describe("screenRecord helpers", () => {
  it("classifies all-idle selections as start", () => {
    const state = resolveScreenRecordSelectionState(
      ["alpha", "bravo"],
      { alpha: true, bravo: true },
      {},
    );
    expect(state.action).toBe("start");
    expect(state.idleSerials).toEqual(["alpha", "bravo"]);
    expect(state.runningSerials).toEqual([]);
    expect(state.skippedSerials).toEqual([]);
  });

  it("classifies all-running selections as stop", () => {
    const statusBySerial: Record<string, ScreenRecordStatus> = {
      alpha: runningStatus("alpha"),
      bravo: runningStatus("bravo"),
    };
    const state = resolveScreenRecordSelectionState(
      ["alpha", "bravo"],
      { alpha: true, bravo: true },
      statusBySerial,
    );
    expect(state.action).toBe("stop");
    expect(state.runningSerials).toEqual(["alpha", "bravo"]);
    expect(state.idleSerials).toEqual([]);
    expect(state.skippedSerials).toEqual([]);
  });

  it("classifies mixed selections as toggle", () => {
    const statusBySerial: Record<string, ScreenRecordStatus> = {
      alpha: runningStatus("alpha"),
    };
    const state = resolveScreenRecordSelectionState(
      ["alpha", "bravo"],
      { alpha: true, bravo: true },
      statusBySerial,
    );
    expect(state.action).toBe("toggle");
    expect(state.runningSerials).toEqual(["alpha"]);
    expect(state.idleSerials).toEqual(["bravo"]);
  });

  it("deduplicates selected serials and skips unavailable devices", () => {
    const state = resolveScreenRecordSelectionState(
      ["alpha", "alpha", "bravo", "charlie"],
      {
        alpha: true,
        bravo: true,
        charlie: false,
      },
      {
        alpha: runningStatus("alpha"),
      },
    );
    expect(state.selectedSerials).toEqual(["alpha", "bravo"]);
    expect(state.runningSerials).toEqual(["alpha"]);
    expect(state.idleSerials).toEqual(["bravo"]);
    expect(state.skippedSerials).toEqual(["charlie"]);
  });

  it("builds toggle action copy with mixed-state summary", () => {
    const meta = buildScreenRecordActionMeta(
      ["alpha", "bravo", "charlie"],
      {
        alpha: true,
        bravo: true,
        charlie: false,
      },
      {
        alpha: runningStatus("alpha"),
      },
    );
    expect(meta.title).toBe("Toggle Recording");
    expect(meta.description).toContain("Stop active recordings");
    expect(meta.description).toContain("1 running, 1 idle, 1 skipped");
    expect(meta.hint).toBe("Multi-device");
  });
});
