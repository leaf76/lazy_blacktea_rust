export type DeviceQuickActionKind =
  | "screenshot"
  | "wifi_on"
  | "wifi_off"
  | "bluetooth_on"
  | "bluetooth_off"
  | "mirror_launch"
  | "reboot";

export type DeviceQuickActionPhase = "pending" | "success" | "error";
export type DeviceQuickActionTone = "busy" | "ok" | "error";

export type DeviceQuickActionStatus = {
  id: string;
  kind: DeviceQuickActionKind;
  phase: DeviceQuickActionPhase;
};

export type DeviceQuickActionStatusView = {
  label: string;
  tone: DeviceQuickActionTone;
  title: string;
};

export type DeviceCommandStatusTone = DeviceQuickActionTone;

export type DeviceCommandStatusView = {
  text: string;
  tone: DeviceCommandStatusTone;
};

export type DeviceCommandStatusStackItem = DeviceCommandStatusView & {
  id: "quick-action" | "screen-record";
};

type QuickActionCopy = {
  row: Record<DeviceQuickActionPhase, string>;
  title: Record<DeviceQuickActionPhase, string>;
  pendingSummary: (count: number) => string;
  successSummary: (count: number) => string;
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const selectedDeviceCount = (count: number) => pluralize(count, "selected device");

const ACTION_COPY: Record<DeviceQuickActionKind, QuickActionCopy> = {
  screenshot: {
    row: {
      pending: "Capturing...",
      success: "Screenshot saved",
      error: "Screenshot failed",
    },
    title: {
      pending: "Screenshot capture is running.",
      success: "Screenshot saved.",
      error: "Screenshot failed.",
    },
    pendingSummary: (count) =>
      `Capturing screenshot${count === 1 ? "" : "s"} on ${selectedDeviceCount(count)}...`,
    successSummary: (count) => `Screenshot saved on ${selectedDeviceCount(count)}.`,
  },
  wifi_on: {
    row: {
      pending: "WiFi on...",
      success: "WiFi on",
      error: "WiFi failed",
    },
    title: {
      pending: "Turning WiFi on.",
      success: "WiFi turned on.",
      error: "WiFi change failed.",
    },
    pendingSummary: (count) => `Turning WiFi on for ${selectedDeviceCount(count)}...`,
    successSummary: (count) => `WiFi turned on for ${selectedDeviceCount(count)}.`,
  },
  wifi_off: {
    row: {
      pending: "WiFi off...",
      success: "WiFi off",
      error: "WiFi failed",
    },
    title: {
      pending: "Turning WiFi off.",
      success: "WiFi turned off.",
      error: "WiFi change failed.",
    },
    pendingSummary: (count) => `Turning WiFi off for ${selectedDeviceCount(count)}...`,
    successSummary: (count) => `WiFi turned off for ${selectedDeviceCount(count)}.`,
  },
  bluetooth_on: {
    row: {
      pending: "Bluetooth on...",
      success: "Bluetooth on",
      error: "Bluetooth failed",
    },
    title: {
      pending: "Turning Bluetooth on.",
      success: "Bluetooth turned on.",
      error: "Bluetooth change failed.",
    },
    pendingSummary: (count) => `Turning Bluetooth on for ${selectedDeviceCount(count)}...`,
    successSummary: (count) => `Bluetooth turned on for ${selectedDeviceCount(count)}.`,
  },
  bluetooth_off: {
    row: {
      pending: "Bluetooth off...",
      success: "Bluetooth off",
      error: "Bluetooth failed",
    },
    title: {
      pending: "Turning Bluetooth off.",
      success: "Bluetooth turned off.",
      error: "Bluetooth change failed.",
    },
    pendingSummary: (count) => `Turning Bluetooth off for ${selectedDeviceCount(count)}...`,
    successSummary: (count) => `Bluetooth turned off for ${selectedDeviceCount(count)}.`,
  },
  mirror_launch: {
    row: {
      pending: "Launching...",
      success: "Mirror launched",
      error: "Mirror failed",
    },
    title: {
      pending: "Live Mirror launch is running.",
      success: "Live Mirror launched.",
      error: "Live Mirror failed.",
    },
    pendingSummary: (count) => `Launching mirror for ${selectedDeviceCount(count)}...`,
    successSummary: (count) => `Mirror launched for ${selectedDeviceCount(count)}.`,
  },
  reboot: {
    row: {
      pending: "Sending...",
      success: "Reboot sent",
      error: "Reboot failed",
    },
    title: {
      pending: "Sending reboot command.",
      success: "Reboot command sent.",
      error: "Reboot command failed.",
    },
    pendingSummary: (count) => `Sending reboot to ${selectedDeviceCount(count)}...`,
    successSummary: (count) => `Reboot sent to ${selectedDeviceCount(count)}.`,
  },
};

const PHASE_TONE: Record<DeviceQuickActionPhase, DeviceQuickActionTone> = {
  pending: "busy",
  success: "ok",
  error: "error",
};

export const buildDeviceQuickActionDeviceStatus = (
  status: DeviceQuickActionStatus | undefined,
): DeviceQuickActionStatusView | null => {
  if (!status) {
    return null;
  }
  const copy = ACTION_COPY[status.kind];
  return {
    label: copy.row[status.phase],
    tone: PHASE_TONE[status.phase],
    title: copy.title[status.phase],
  };
};

export const buildDeviceQuickActionSelectionStatus = (
  selectedSerials: string[],
  statusBySerial: Record<string, DeviceQuickActionStatus | undefined>,
): DeviceCommandStatusView | null => {
  const selected = Array.from(new Set(selectedSerials)).filter(Boolean);
  const statuses = selected
    .map((serial) => statusBySerial[serial])
    .filter((status): status is DeviceQuickActionStatus => status != null);
  if (!statuses.length) {
    return null;
  }

  const pendingStatuses = statuses.filter((status) => status.phase === "pending");
  const [firstStatus] = pendingStatuses.length ? pendingStatuses : statuses;
  const matching = statuses.filter((status) => status.kind === firstStatus.kind);
  const relevant = matching.length ? matching : statuses;
  const copy = ACTION_COPY[relevant[0].kind];
  const pendingCount = relevant.filter((status) => status.phase === "pending").length;
  const successCount = relevant.filter((status) => status.phase === "success").length;
  const errorCount = relevant.filter((status) => status.phase === "error").length;

  if (pendingCount > 0) {
    return {
      text: copy.pendingSummary(pendingCount),
      tone: "busy",
    };
  }

  const parts: string[] = [];
  if (successCount > 0) {
    parts.push(copy.successSummary(successCount));
  }
  if (errorCount > 0) {
    parts.push(`Failed on ${selectedDeviceCount(errorCount)}.`);
  }
  if (!parts.length) {
    return null;
  }
  return {
    text: parts.join(" "),
    tone: errorCount > 0 ? "error" : "ok",
  };
};

export const hasPendingDeviceQuickAction = (
  selectedSerials: string[],
  statusBySerial: Record<string, DeviceQuickActionStatus | undefined>,
  kinds: DeviceQuickActionKind[],
) => {
  const kindSet = new Set(kinds);
  return selectedSerials.some((serial) => {
    const status = statusBySerial[serial];
    return status?.phase === "pending" && kindSet.has(status.kind);
  });
};

export const buildDeviceQuickActionButtonLabel = (
  baseLabel: string,
  pendingLabel: string,
  selectedSerials: string[],
  statusBySerial: Record<string, DeviceQuickActionStatus | undefined>,
  pendingKinds: DeviceQuickActionKind[],
) =>
  hasPendingDeviceQuickAction(selectedSerials, statusBySerial, pendingKinds)
    ? pendingLabel
    : baseLabel;

export const buildDeviceCommandStatusStack = (
  quickActionStatus: DeviceCommandStatusView | null,
  screenRecordStatus: DeviceCommandStatusView | null,
): DeviceCommandStatusStackItem[] => {
  const items: DeviceCommandStatusStackItem[] = [];
  if (quickActionStatus) {
    items.push({ id: "quick-action", ...quickActionStatus });
  }
  if (screenRecordStatus) {
    items.push({ id: "screen-record", ...screenRecordStatus });
  }
  return items;
};
