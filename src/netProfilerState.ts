import type { NetProfilerSnapshot } from "./types";

export type NetProfilerState = {
  running: boolean;
  traceId: string | null;
  samples: NetProfilerSnapshot[];
  lastError: string | null;
};

export const EMPTY_NET_PROFILER_STATE: NetProfilerState = {
  running: false,
  traceId: null,
  samples: [],
  lastError: null,
};
