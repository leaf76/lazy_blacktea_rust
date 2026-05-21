import type { ScreenRecordStatus } from "./types";
import {
  appendBatchSummary,
  formatStateSummary,
  resolveBatchAction,
} from "./batchActions";

export type ScreenRecordBatchAction = "start" | "stop" | "toggle";
export type ScreenRecordPendingAction = "starting" | "stopping";
export type ScreenRecordStatusTone = "busy" | "error";

export type ScreenRecordDeviceStatusView = {
  label: string;
  tone: ScreenRecordStatusTone;
  title: string;
};

export type ScreenRecordSelectionStatusView = {
  text: string;
  tone: ScreenRecordStatusTone;
};

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

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export const buildScreenRecordDeviceStatus = (
  serial: string,
  status: ScreenRecordStatus | undefined,
  pendingAction: ScreenRecordPendingAction | undefined,
  loading: boolean,
): ScreenRecordDeviceStatusView | null => {
  if (pendingAction === "starting") {
    return {
      label: "Starting...",
      tone: "busy",
      title: "Screen recording is starting.",
    };
  }
  if (pendingAction === "stopping") {
    return {
      label: "Stopping...",
      tone: "busy",
      title: "Screen recording is stopping.",
    };
  }
  if (loading) {
    return {
      label: "Checking...",
      tone: "busy",
      title: "Checking screen recording status.",
    };
  }
  if (status?.running) {
    const displayPath = status.display_path.trim();
    return {
      label: "Recording",
      tone: "error",
      title: displayPath ? `Recording to ${displayPath}` : `Recording on ${serial}`,
    };
  }
  return null;
};

export const buildScreenRecordSelectionStatus = (
  selectedSerials: string[],
  statusBySerial: Record<string, ScreenRecordStatus | undefined>,
  pendingBySerial: Record<string, ScreenRecordPendingAction | undefined>,
  loading: boolean,
): ScreenRecordSelectionStatusView | null => {
  const selected = Array.from(new Set(selectedSerials)).filter(Boolean);
  if (!selected.length) {
    return null;
  }

  const startingCount = selected.filter((serial) => pendingBySerial[serial] === "starting").length;
  const stoppingCount = selected.filter((serial) => pendingBySerial[serial] === "stopping").length;
  const runningStatuses = selected
    .map((serial) => statusBySerial[serial])
    .filter((status): status is ScreenRecordStatus => status?.running === true);
  const runningCount = runningStatuses.length;

  if (stoppingCount > 0 && runningCount <= stoppingCount && startingCount === 0) {
    return {
      text: "Stopping recording...",
      tone: "busy",
    };
  }

  if (startingCount > 0 && runningCount === 0 && stoppingCount === 0) {
    return {
      text: "Starting recording...",
      tone: "busy",
    };
  }

  if (runningCount > 0) {
    const parts =
      runningCount === 1 && startingCount === 0 && stoppingCount === 0
        ? [`Recording: ${runningStatuses[0].display_path}`]
        : [`Recording on ${pluralize(runningCount, "selected device")}.`];
    if (startingCount > 0) {
      parts.push(`Starting ${pluralize(startingCount, "recording")}.`);
    }
    if (stoppingCount > 0) {
      parts.push(`Stopping ${pluralize(stoppingCount, "recording")}.`);
    }
    return {
      text: parts.join(" "),
      tone: startingCount > 0 || stoppingCount > 0 ? "busy" : "error",
    };
  }

  if (loading) {
    return {
      text: "Checking recording status...",
      tone: "busy",
    };
  }

  return null;
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
