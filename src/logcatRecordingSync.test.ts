import { describe, expect, it } from "vitest";
import {
  createLogcatRecordingSyncSession,
  finalizeLogcatRecordingSyncSession,
  sliceLogcatLinesForRecording,
} from "./logcatRecordingSync";

describe("logcatRecordingSync", () => {
  it("slices only logcat lines captured within the recording window", () => {
    const initialLines = [
      { id: 1, text: "before-1" },
      { id: 2, text: "before-2" },
    ];
    const started = createLogcatRecordingSyncSession("SER-1", initialLines, 1000);
    expect(started.startLineId).toBe(3);

    const duringLines = [
      ...initialLines,
      { id: 3, text: "during-1" },
      { id: 4, text: "during-2" },
    ];
    const finalized = finalizeLogcatRecordingSyncSession(started, duringLines, 5000);
    expect(finalized.endLineId).toBe(4);

    const laterLines = [...duringLines, { id: 5, text: "after-1" }];
    expect(sliceLogcatLinesForRecording(laterLines, finalized)).toEqual(["during-1", "during-2"]);
  });

  it("handles empty logcat window cleanly", () => {
    const started = createLogcatRecordingSyncSession("SER-1", [], 1000);
    const finalized = finalizeLogcatRecordingSyncSession(started, [], 2000);
    expect(sliceLogcatLinesForRecording([], finalized)).toEqual([]);
  });
});
