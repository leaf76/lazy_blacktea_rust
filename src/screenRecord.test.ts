import { describe, expect, it } from "vitest";

import {
  buildScreenRecordActionMeta,
  buildScreenRecordDeviceStatus,
  buildScreenRecordSelectionStatus,
  resolveScreenRecordSelectionState,
} from "./screenRecord";
import { buildDeviceCommandStatusStack } from "./deviceActionStatus";
import type { ScreenRecordStatus } from "./types";

const runningStatus = (serial: string): ScreenRecordStatus => ({
  serial,
  running: true,
  backend: "adb",
  display_path: `/sdcard/${serial}.mp4`,
  segment_count: 1,
});

const runningStatusWithLogcat = (serial: string): ScreenRecordStatus => ({
  ...runningStatus(serial),
  logcat_output_path: `/tmp/${serial}_logcat.txt`,
  logcat_running: true,
  artifact_dir: `/tmp/screenrecord_${serial}`,
  artifact_paths: [],
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

  it("does not show a device recording status for idle devices", () => {
    expect(buildScreenRecordDeviceStatus("alpha", undefined, undefined, false)).toBeNull();
  });

  it("shows starting feedback before the backend status refresh completes", () => {
    expect(buildScreenRecordDeviceStatus("alpha", undefined, "starting", false)).toEqual({
      label: "Starting...",
      tone: "busy",
      title: "Screen recording is starting.",
    });
    expect(buildScreenRecordSelectionStatus(["alpha"], {}, { alpha: "starting" }, false)).toEqual({
      text: "Starting recording...",
      tone: "busy",
    });
  });

  it("shows running feedback with the display path", () => {
    expect(buildScreenRecordDeviceStatus("alpha", runningStatus("alpha"), undefined, false)).toEqual({
      label: "Recording",
      tone: "error",
      title: "Recording to /sdcard/alpha.mp4",
    });
    expect(buildScreenRecordSelectionStatus(["alpha"], { alpha: runningStatus("alpha") }, {}, false)).toEqual({
      text: "Recording: /sdcard/alpha.mp4",
      tone: "error",
    });
  });

  it("shows linked logcat capture feedback while recording", () => {
    expect(buildScreenRecordDeviceStatus("alpha", runningStatusWithLogcat("alpha"), undefined, false)).toEqual({
      label: "Recording + Logs",
      tone: "error",
      title: "Recording to /sdcard/alpha.mp4. Capturing logcat to /tmp/alpha_logcat.txt. Artifacts: /tmp/screenrecord_alpha",
    });
    expect(
      buildScreenRecordSelectionStatus(["alpha"], { alpha: runningStatusWithLogcat("alpha") }, {}, false),
    ).toEqual({
      text: "Recording: /sdcard/alpha.mp4. Logcat: /tmp/alpha_logcat.txt. Artifacts: /tmp/screenrecord_alpha",
      tone: "error",
    });
  });

  it("surfaces linked logcat capture errors without hiding the recording path", () => {
    const status: ScreenRecordStatus = {
      ...runningStatusWithLogcat("alpha"),
      logcat_running: false,
      logcat_error: "Logcat capture exited before recording stopped.",
    };

    expect(buildScreenRecordDeviceStatus("alpha", status, undefined, false)).toEqual({
      label: "Recording",
      tone: "error",
      title:
        "Recording to /sdcard/alpha.mp4. Logcat capture issue: Logcat capture exited before recording stopped. Artifacts: /tmp/screenrecord_alpha",
    });
  });

  it("shows stopping feedback while a stop command is in progress", () => {
    expect(buildScreenRecordDeviceStatus("alpha", runningStatus("alpha"), "stopping", false)).toEqual({
      label: "Stopping...",
      tone: "busy",
      title: "Screen recording is stopping.",
    });
    expect(buildScreenRecordSelectionStatus(["alpha"], { alpha: runningStatus("alpha") }, { alpha: "stopping" }, false)).toEqual({
      text: "Stopping recording...",
      tone: "busy",
    });
  });

  it("summarizes mixed selected recording state", () => {
    expect(
      buildScreenRecordSelectionStatus(
        ["alpha", "bravo", "charlie"],
        { alpha: runningStatus("alpha") },
        { bravo: "starting" },
        false,
      ),
    ).toEqual({
      text: "Recording on 1 selected device. Starting 1 recording.",
      tone: "busy",
    });
  });

  it("shows checking feedback while selected statuses are loading", () => {
    expect(buildScreenRecordDeviceStatus("alpha", undefined, undefined, true)).toEqual({
      label: "Checking...",
      tone: "busy",
      title: "Checking screen recording status.",
    });
  });

  it("keeps recording summary visible alongside quick action status", () => {
    const recordingStatus = buildScreenRecordSelectionStatus(
      ["alpha"],
      { alpha: runningStatus("alpha") },
      {},
      false,
    );
    expect(
      buildDeviceCommandStatusStack(
        { text: "Capturing screenshots on 1 selected device...", tone: "busy" },
        recordingStatus,
      ),
    ).toEqual([
      { id: "quick-action", text: "Capturing screenshots on 1 selected device...", tone: "busy" },
      { id: "screen-record", text: "Recording: /sdcard/alpha.mp4", tone: "error" },
    ]);
  });
});
