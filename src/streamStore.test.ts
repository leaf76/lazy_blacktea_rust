import { describe, expect, it } from "vitest";
import {
  areStreamStatusSummariesEqual,
  getStreamState,
  resetStreamStore,
  selectStreamStatusSummary,
  setLogcatLinesState,
  setNetBySerialState,
  setPerfBySerialState,
  setTerminalBySerialState,
  subscribeStreamStore,
} from "./streamStore";

describe("streamStore", () => {
  it("updates slices independently and notifies subscribers only on change", () => {
    resetStreamStore();
    let notifications = 0;
    const unsubscribe = subscribeStreamStore(() => {
      notifications += 1;
    });

    setLogcatLinesState((prev) => ({
      ...prev,
      "dev-1": [{ id: 1, text: "I/Tag: hello" }],
    }));
    expect(notifications).toBe(1);
    expect(getStreamState().logcatLines["dev-1"]).toHaveLength(1);

    // No-op reference return does not trigger listeners.
    setLogcatLinesState((prev) => prev);
    expect(notifications).toBe(1);

    unsubscribe();
  });

  it("keeps StreamStatusSummary equal across steady-state sample and terminal output updates", () => {
    resetStreamStore();

    setPerfBySerialState({
      "dev-1": { running: true, traceId: "t1", samples: [], lastError: null },
    });
    setNetBySerialState({
      "dev-2": { running: true, traceId: "t2", samples: [], lastError: null },
    });
    setTerminalBySerialState({
      "dev-3": { connected: true, sessionId: "s1", lines: [], tail: "", autoScroll: true },
    });

    const before = selectStreamStatusSummary(getStreamState());

    setPerfBySerialState((prev) => ({
      ...prev,
      "dev-1": {
        ...prev["dev-1"],
        samples: [
          {
            ts_ms: 1000,
            cpu_total_percent_x100: 1200,
            cpu_cores_percent_x100: [],
            cpu_cores_freq_khz: [],
            mem_used_bytes: 100,
            mem_total_bytes: 200,
            battery_level: 80,
            battery_temp_decic: 300,
            net_rx_bps: 10,
            net_tx_bps: 20,
            display_refresh_hz_x100: 6000,
            missed_frames_per_sec_x100: 0,
          },
        ],
      },
    }));
    setTerminalBySerialState((prev) => ({
      ...prev,
      "dev-3": { ...prev["dev-3"], lines: ["line 1"], tail: "prompt$ " },
    }));
    setLogcatLinesState({
      "dev-1": [{ id: 1, text: "D/Test: streaming" }],
    });

    const afterSampleFlush = selectStreamStatusSummary(getStreamState());
    expect(areStreamStatusSummariesEqual(before, afterSampleFlush)).toBe(true);

    setPerfBySerialState((prev) => ({
      ...prev,
      "dev-1": { ...prev["dev-1"], running: false },
    }));
    const afterStop = selectStreamStatusSummary(getStreamState());
    expect(areStreamStatusSummariesEqual(before, afterStop)).toBe(false);
    expect(afterStop.perfRunningSerials).toEqual([]);
  });
});
