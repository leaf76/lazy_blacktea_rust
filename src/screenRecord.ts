import type { ScreenRecordStatus } from "./types";
import {
  appendBatchSummary,
  formatStateSummary,
  resolveBatchAction,
} from "./batchActions";

export type ScreenRecordBatchAction = "start" | "stop" | "toggle";

export type ScreenRecordSelectionState = {
  action: ScreenRecordBatchAction;
  skippedSerials: string[];
  idleSerials: string[];
  runningSerials: string[];
  selectedSerials: string[];
};

export const resolveScreenRecordSelectionState = (
  selectedSerials: string[],
  availabilityBySerial: Record<string, boolean | undefined>,
  statusBySerial: Record<string, ScreenRecordStatus | undefined>,
): ScreenRecordSelectionState => {
  const meta = resolveBatchAction({
    kind: "stateful-toggle",
    selectedSerials,
    availabilityBySerial,
    activeBySerial: Object.fromEntries(
      Object.entries(statusBySerial).map(([serial, status]) => [serial, status?.running === true]),
    ),
    taskGroupKeys: {
      start: "screen_record_start",
      stop: "screen_record_stop",
    },
    buildCopy: () => ({
      title: "",
      description: "",
      hint: "Multi-device",
      summary: null,
    }),
  });
  const action: ScreenRecordBatchAction =
    meta.actionMode === "stop" ? "stop" : meta.actionMode === "toggle" ? "toggle" : "start";
  return {
    action,
    skippedSerials: meta.skippedSerials,
    idleSerials: meta.idleSerials,
    runningSerials: meta.activeSerials,
    selectedSerials: meta.eligibleSerials,
  };
};

export const buildScreenRecordActionMeta = (
  selectedSerials: string[],
  availabilityBySerial: Record<string, boolean | undefined>,
  statusBySerial: Record<string, ScreenRecordStatus | undefined>,
) => {
  const meta = resolveBatchAction({
    kind: "stateful-toggle",
    selectedSerials,
    availabilityBySerial,
    activeBySerial: Object.fromEntries(
      Object.entries(statusBySerial).map(([serial, status]) => [serial, status?.running === true]),
    ),
    taskGroupKeys: {
      start: "screen_record_start",
      stop: "screen_record_stop",
    },
    buildCopy: (context) => {
      const summary =
        context.requestedCount === 0
          ? null
          : formatStateSummary(
              {
                activeSerials: context.activeSerials,
                idleSerials: context.idleSerials,
                skippedSerials: context.skippedSerials,
              },
              { active: "running", idle: "idle" },
            );
      const base =
        context.requestedCount === 0
          ? "Record the screens of selected devices."
          : context.eligibleCount === 0
            ? "No eligible devices selected."
            : context.actionMode === "stop"
              ? context.requestedCount === 1 && context.skippedCount === 0
                ? "Finish and save the ongoing screen recording."
                : "Finish and save recordings for eligible selected devices."
              : context.actionMode === "toggle"
                ? "Stop active recordings and start recording on idle eligible devices."
                : context.requestedCount === 1 && context.skippedCount === 0
                  ? "Record the screen of the selected device."
                  : "Record the screens of eligible selected devices.";

      return {
        title:
          context.actionMode === "stop"
            ? "Stop Recording"
            : context.actionMode === "toggle"
              ? "Toggle Recording"
              : "Start Recording",
        description: appendBatchSummary(base, summary),
        hint: "Multi-device",
        summary,
      };
    },
  });

  return {
    ...meta,
    action: meta.actionMode === "stop" ? "stop" : meta.actionMode === "toggle" ? "toggle" : "start",
    idleSerials: meta.idleSerials,
    runningSerials: meta.activeSerials,
    selectedSerials: meta.eligibleSerials,
  };
};
