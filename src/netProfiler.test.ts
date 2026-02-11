import { describe, expect, it } from "vitest";

import {
  buildLinePath,
  extractNetSeries,
  sliceSnapshotsByWindowMs,
} from "./netProfiler";
import type { NetProfilerSnapshot } from "./types";

describe("netProfiler", () => {
  it("sliceSnapshotsByWindowMs returns all samples when window is null", () => {
    const samples: NetProfilerSnapshot[] = [
      { ts_ms: 1000, rows: [], unsupported: false },
      { ts_ms: 2000, rows: [], unsupported: false },
    ];
    expect(sliceSnapshotsByWindowMs(samples, null)).toEqual(samples);
  });

  it("sliceSnapshotsByWindowMs filters by latest timestamp minus window", () => {
    const samples: NetProfilerSnapshot[] = [
      { ts_ms: 0, rows: [], unsupported: false },
      { ts_ms: 1000, rows: [], unsupported: false },
      { ts_ms: 2000, rows: [], unsupported: false },
      { ts_ms: 3000, rows: [], unsupported: false },
    ];
    expect(sliceSnapshotsByWindowMs(samples, 1500).map((s) => s.ts_ms)).toEqual([
      2000,
      3000,
    ]);
  });

  it("extractNetSeries sums total rx/tx when focusUid is null", () => {
    const samples: NetProfilerSnapshot[] = [
      {
        ts_ms: 1000,
        rows: [
          { uid: 100, rx_bytes: 0, tx_bytes: 0, rx_bps: 100, tx_bps: 50 },
          { uid: 101, rx_bytes: 0, tx_bytes: 0, rx_bps: null, tx_bps: 20 },
        ],
        unsupported: false,
      },
      {
        ts_ms: 2000,
        rows: [{ uid: 100, rx_bytes: 0, tx_bytes: 0, rx_bps: 10, tx_bps: 5 }],
        unsupported: false,
      },
    ];

    const series = extractNetSeries(samples, null);
    expect(series.tsMs).toEqual([1000, 2000]);
    expect(series.rxBps).toEqual([100, 10]);
    expect(series.txBps).toEqual([70, 5]);
  });

  it("extractNetSeries returns per-uid rx/tx and null when missing", () => {
    const samples: NetProfilerSnapshot[] = [
      {
        ts_ms: 1000,
        rows: [{ uid: 100, rx_bytes: 0, tx_bytes: 0, rx_bps: 100, tx_bps: 50 }],
        unsupported: false,
      },
      {
        ts_ms: 2000,
        rows: [],
        unsupported: false,
      },
    ];

    const series = extractNetSeries(samples, 100);
    expect(series.rxBps).toEqual([100, null]);
    expect(series.txBps).toEqual([50, null]);
  });

  it("buildLinePath splits segments on null values", () => {
    const d = buildLinePath([0, 10, null, 5, 15], 100, 50, 15);
    expect(d).not.toBe("");
    expect(d.split("M").length - 1).toBe(2);
  });

  it("buildLinePath returns empty when fewer than 2 valid values", () => {
    expect(buildLinePath([null, 5, null], 120, 30, 10)).toBe("");
  });
});

