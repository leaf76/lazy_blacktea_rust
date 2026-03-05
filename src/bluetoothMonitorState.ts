import type { BluetoothParsedSnapshot, BluetoothState, BluetoothStateSummary } from "./types";

export const BLUETOOTH_MONITOR_RECENT_DATA_MS = 15_000;

export type BluetoothMonitorSessionState = "stopped" | "starting" | "live" | "stale" | "paused";

export type BluetoothMonitorEmptyState = {
  title: string;
  body: string;
};

export const readBluetoothBooleanMetric = (
  metrics: Record<string, unknown> | null | undefined,
  key: string,
) => {
  const value = metrics?.[key];
  return typeof value === "boolean" ? value : null;
};

export const readBluetoothNumberMetric = (
  metrics: Record<string, unknown> | null | undefined,
  key: string,
) => {
  const value = metrics?.[key];
  return typeof value === "number" ? value : null;
};

export const valueToChipText = (value: unknown) => {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
};

export const inferBluetoothStatesFromSnapshot = (snapshot: BluetoothParsedSnapshot | null): BluetoothState[] => {
  if (!snapshot) {
    return ["Unknown"];
  }
  if (!snapshot.adapter_enabled) {
    return ["Off"];
  }
  const inferred: BluetoothState[] = [];
  if (snapshot.scanning.is_scanning) {
    inferred.push("Scanning");
  }
  if (snapshot.advertising.is_advertising) {
    inferred.push("Advertising");
  }
  const hasConnectedProfile = Object.values(snapshot.profiles ?? {}).some((value) => {
    const upper = value.toUpperCase();
    return upper.includes("CONNECTED") && !upper.includes("DISCONNECTED");
  });
  if (hasConnectedProfile) {
    inferred.push("Connected");
  }
  if (!inferred.length) {
    inferred.push("Idle");
  }
  return inferred;
};

export const resolveBluetoothAdapterEnabled = (
  snapshot: BluetoothParsedSnapshot | null,
  stateSummary: BluetoothStateSummary | null,
) => {
  const byMetric = readBluetoothBooleanMetric(stateSummary?.metrics, "adapter_enabled");
  if (byMetric != null) {
    return byMetric;
  }
  if (snapshot) {
    return snapshot.adapter_enabled;
  }
  return null;
};

export const resolveBluetoothActiveStates = (
  snapshot: BluetoothParsedSnapshot | null,
  stateSummary: BluetoothStateSummary | null,
) => {
  const states = stateSummary?.active_states ?? null;
  if (states && states.length) {
    return states;
  }
  return inferBluetoothStatesFromSnapshot(snapshot);
};

export const resolveBluetoothMonitorSessionState = ({
  serial,
  monitoringDesired,
  lastAnyDataAtMs,
  nowMs,
  recentDataMs = BLUETOOTH_MONITOR_RECENT_DATA_MS,
}: {
  serial: string | null;
  monitoringDesired: boolean;
  lastAnyDataAtMs: number | null;
  nowMs: number;
  recentDataMs?: number;
}): BluetoothMonitorSessionState => {
  if (!serial) {
    return "stopped";
  }
  if (!monitoringDesired) {
    return "paused";
  }
  if (lastAnyDataAtMs == null) {
    return "starting";
  }
  return nowMs - lastAnyDataAtMs <= recentDataMs ? "live" : "stale";
};

export const resolveBluetoothTimelineEmptyState = ({
  totalEvents,
  filteredEvents,
  hasFilters,
}: {
  totalEvents: number;
  filteredEvents: number;
  hasFilters: boolean;
}): BluetoothMonitorEmptyState => {
  if (filteredEvents > 0) {
    return {
      title: "",
      body: "",
    };
  }
  if (totalEvents === 0) {
    return {
      title: "No Bluetooth events yet.",
      body: "Try toggling Bluetooth, starting a scan, or connecting a headset to generate events.",
    };
  }
  if (hasFilters) {
    return {
      title: "No matching events.",
      body: "Adjust the search text or filters to show matching Bluetooth activity.",
    };
  }
  return {
    title: "No Bluetooth events yet.",
    body: "Try toggling Bluetooth, starting a scan, or connecting a headset to generate events.",
  };
};

export const resolveBluetoothBondedEmptyState = ({
  totalDevices,
  filteredDevices,
  hasSearch,
}: {
  totalDevices: number;
  filteredDevices: number;
  hasSearch: boolean;
}): BluetoothMonitorEmptyState => {
  if (filteredDevices > 0) {
    return {
      title: "",
      body: "",
    };
  }
  if (totalDevices === 0) {
    return {
      title: "No bonded devices in snapshot.",
      body: "Paired accessories will appear here after the next Bluetooth snapshot.",
    };
  }
  if (hasSearch) {
    return {
      title: "No matching bonded devices.",
      body: "Clear the search or use a different device name or address.",
    };
  }
  return {
    title: "No bonded devices in snapshot.",
    body: "Paired accessories will appear here after the next Bluetooth snapshot.",
  };
};
