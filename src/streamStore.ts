import { useRef, useSyncExternalStore } from "react";
import type { LogcatLineEntry } from "./components/LogcatOutput";
import type { NetProfilerState } from "./netProfilerState";
import type { PerfMonitorState } from "./perfState";
import type { TerminalDeviceState } from "./terminalBuffer";

export type StreamStoreState = {
  logcatLines: Record<string, LogcatLineEntry[]>;
  logcatRetainedBySerial: Record<string, LogcatLineEntry[]>;
  perfBySerial: Record<string, PerfMonitorState>;
  netBySerial: Record<string, NetProfilerState>;
  terminalBySerial: Record<string, TerminalDeviceState>;
};

export type StreamStatusSummary = {
  perfRunningSerials: string[];
  netRunningSerials: string[];
  terminalConnectedSerials: string[];
};

type StateUpdater<T> = T | ((prev: T) => T);

const createInitialState = (): StreamStoreState => ({
  logcatLines: {},
  logcatRetainedBySerial: {},
  perfBySerial: {},
  netBySerial: {},
  terminalBySerial: {},
});

let state: StreamStoreState = createInitialState();
const listeners = new Set<() => void>();

const emitChange = () => {
  for (const listener of listeners) {
    listener();
  }
};

const applyUpdater = <T>(prev: T, updater: StateUpdater<T>): T =>
  typeof updater === "function" ? (updater as (current: T) => T)(prev) : updater;

export const getStreamState = (): StreamStoreState => state;

export const subscribeStreamStore = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setLogcatLinesState = (updater: StateUpdater<Record<string, LogcatLineEntry[]>>) => {
  const next = applyUpdater(state.logcatLines, updater);
  if (next === state.logcatLines) {
    return;
  }
  state = { ...state, logcatLines: next };
  emitChange();
};

export const setLogcatRetainedState = (
  updater: StateUpdater<Record<string, LogcatLineEntry[]>>,
) => {
  const next = applyUpdater(state.logcatRetainedBySerial, updater);
  if (next === state.logcatRetainedBySerial) {
    return;
  }
  state = { ...state, logcatRetainedBySerial: next };
  emitChange();
};

export const setPerfBySerialState = (updater: StateUpdater<Record<string, PerfMonitorState>>) => {
  const next = applyUpdater(state.perfBySerial, updater);
  if (next === state.perfBySerial) {
    return;
  }
  state = { ...state, perfBySerial: next };
  emitChange();
};

export const setNetBySerialState = (updater: StateUpdater<Record<string, NetProfilerState>>) => {
  const next = applyUpdater(state.netBySerial, updater);
  if (next === state.netBySerial) {
    return;
  }
  state = { ...state, netBySerial: next };
  emitChange();
};

export const setTerminalBySerialState = (
  updater: StateUpdater<Record<string, TerminalDeviceState>>,
) => {
  const next = applyUpdater(state.terminalBySerial, updater);
  if (next === state.terminalBySerial) {
    return;
  }
  state = { ...state, terminalBySerial: next };
  emitChange();
};

export const resetStreamStore = () => {
  state = createInitialState();
  emitChange();
};

const areStringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
};

export const selectStreamStatusSummary = (current: StreamStoreState): StreamStatusSummary => ({
  perfRunningSerials: Object.entries(current.perfBySerial)
    .filter(([, entry]) => entry.running)
    .map(([serial]) => serial)
    .sort(),
  netRunningSerials: Object.entries(current.netBySerial)
    .filter(([, entry]) => entry.running)
    .map(([serial]) => serial)
    .sort(),
  terminalConnectedSerials: Object.entries(current.terminalBySerial)
    .filter(([, entry]) => entry.connected)
    .map(([serial]) => serial)
    .sort(),
});

export const areStreamStatusSummariesEqual = (
  left: StreamStatusSummary,
  right: StreamStatusSummary,
): boolean =>
  areStringArraysEqual(left.perfRunningSerials, right.perfRunningSerials) &&
  areStringArraysEqual(left.netRunningSerials, right.netRunningSerials) &&
  areStringArraysEqual(left.terminalConnectedSerials, right.terminalConnectedSerials);

export function useStreamSelector<T>(
  selector: (current: StreamStoreState) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const lastSelectionRef = useRef<{ initialized: boolean; value: T }>({
    initialized: false,
    value: undefined as T,
  });

  return useSyncExternalStore(subscribeStreamStore, () => {
    const next = selector(state);
    if (lastSelectionRef.current.initialized && isEqual(lastSelectionRef.current.value, next)) {
      return lastSelectionRef.current.value;
    }
    lastSelectionRef.current = { initialized: true, value: next };
    return next;
  });
}

export function useStreamStatusSummary(): StreamStatusSummary {
  return useStreamSelector(selectStreamStatusSummary, areStreamStatusSummariesEqual);
}
