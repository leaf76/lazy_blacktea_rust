import type { PerfSnapshot } from "./types";

export type PerfMonitorState = {
  running: boolean;
  traceId: string | null;
  samples: PerfSnapshot[];
  lastError: string | null;
};

export const EMPTY_PERF_MONITOR_STATE: PerfMonitorState = {
  running: false,
  traceId: null,
  samples: [],
  lastError: null,
};
