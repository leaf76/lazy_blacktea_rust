import type { NetProfilerSnapshot } from "./types";

export type NetSeries = {
  tsMs: number[];
  rxBps: (number | null)[];
  txBps: (number | null)[];
};

export const sliceSnapshotsByWindowMs = (
  samples: NetProfilerSnapshot[],
  windowMs: number | null,
) => {
  if (windowMs == null) {
    return samples;
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return samples;
  }
  if (samples.length === 0) {
    return samples;
  }
  const latest = samples[samples.length - 1]?.ts_ms ?? null;
  if (latest == null || !Number.isFinite(latest)) {
    return samples;
  }
  const start = latest - windowMs;
  return samples.filter((sample) => sample.ts_ms >= start);
};

export const extractNetSeries = (
  samples: NetProfilerSnapshot[],
  focusUid: number | null,
): NetSeries => {
  const tsMs = samples.map((sample) => sample.ts_ms);
  if (focusUid == null) {
    return {
      tsMs,
      rxBps: samples.map((sample) =>
        sample.rows.reduce((sum, row) => sum + (row.rx_bps ?? 0), 0),
      ),
      txBps: samples.map((sample) =>
        sample.rows.reduce((sum, row) => sum + (row.tx_bps ?? 0), 0),
      ),
    };
  }

  return {
    tsMs,
    rxBps: samples.map((sample) => {
      const row = sample.rows.find((candidate) => candidate.uid === focusUid) ?? null;
      return row?.rx_bps ?? null;
    }),
    txBps: samples.map((sample) => {
      const row = sample.rows.find((candidate) => candidate.uid === focusUid) ?? null;
      return row?.tx_bps ?? null;
    }),
  };
};

export const buildLinePath = (
  values: (number | null)[],
  width: number,
  height: number,
  yMax: number,
) => {
  if (values.length < 2 || width <= 0 || height <= 0) {
    return "";
  }

  let validCount = 0;
  values.forEach((value) => {
    if (value != null && Number.isFinite(value)) {
      validCount += 1;
    }
  });

  if (validCount < 2) {
    return "";
  }

  const safeYMax = Number.isFinite(yMax) && yMax > 0 ? yMax : 1;
  const n = values.length;
  const stepX = n === 1 ? 0 : width / (n - 1);

  let inSegment = false;
  const parts: string[] = [];

  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) {
      inSegment = false;
      return;
    }
    const x = index * stepX;
    const clamped = Math.max(0, value);
    const y = height - Math.min(1, clamped / safeYMax) * height;
    const cmd = inSegment ? "L" : "M";
    parts.push(`${cmd}${x.toFixed(1)} ${y.toFixed(1)}`);
    inSegment = true;
  });

  return parts.join(" ");
};
