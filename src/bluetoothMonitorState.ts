import type {
  BluetoothDiscoveredDeviceRow,
  BluetoothMonitorEventEntry,
  BluetoothPairedDeviceRow,
  BluetoothParsedSnapshot,
  BluetoothState,
  BluetoothStateSummary,
} from "./types";

export const BLUETOOTH_MONITOR_RECENT_DATA_MS = 15_000;

export type BluetoothMonitorSessionState = "stopped" | "starting" | "live" | "stale" | "paused";

export type BluetoothMonitorEmptyState = {
  title: string;
  body: string;
};

const BLUETOOTH_ADDRESS_PATTERN = /([0-9a-fx]{2}(?::[0-9a-fx]{2}){5})/i;

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

const readBluetoothString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const normalizeBluetoothAddress = (value: unknown) => {
  const text = readBluetoothString(value);
  if (!text) {
    return null;
  }
  const match = text.match(BLUETOOTH_ADDRESS_PATTERN);
  return match ? match[1].toUpperCase() : null;
};

const readBluetoothInteger = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const metadataAddress = (entry: BluetoothMonitorEventEntry) =>
  normalizeBluetoothAddress(entry.event.metadata.address) ?? normalizeBluetoothAddress(entry.event.message);

const metadataName = (entry: BluetoothMonitorEventEntry) =>
  readBluetoothString(entry.event.metadata.name) ?? readBluetoothString(entry.event.metadata.device_name);

const metadataRssi = (entry: BluetoothMonitorEventEntry) => readBluetoothInteger(entry.event.metadata.rssi);

const hasConnectedProfile = (snapshot: BluetoothParsedSnapshot | null, stateSummary: BluetoothStateSummary | null) => {
  const summaryConnected = stateSummary?.active_states.includes("Connected") ?? false;
  if (summaryConnected) {
    return true;
  }
  if (!snapshot) {
    return false;
  }
  return Object.values(snapshot.profiles ?? {}).some((value) => {
    const upper = value.toUpperCase();
    return upper.includes("CONNECTED") && !upper.includes("DISCONNECTED");
  });
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

export const hasBluetoothMonitorSessionData = ({
  visibleEvents,
  sessionEvents,
  queuedEvents,
}: {
  visibleEvents: number;
  sessionEvents: number;
  queuedEvents: number;
}) => visibleEvents > 0 || sessionEvents > 0 || queuedEvents > 0;

export const buildBluetoothPairedDeviceRows = ({
  snapshot,
  stateSummary,
  events,
}: {
  snapshot: BluetoothParsedSnapshot | null;
  stateSummary: BluetoothStateSummary | null;
  events: BluetoothMonitorEventEntry[];
}): BluetoothPairedDeviceRow[] => {
  const bondedDevices = snapshot?.bonded_devices ?? [];
  if (!bondedDevices.length) {
    return [];
  }

  const latestConnectionByAddress = new Map<string, BluetoothMonitorEventEntry>();
  for (const entry of events) {
    if (entry.event.event_type !== "Connect" && entry.event.event_type !== "Disconnect") {
      continue;
    }
    const address = metadataAddress(entry);
    if (!address) {
      continue;
    }
    const previous = latestConnectionByAddress.get(address);
    if (!previous || entry.receivedAtMs >= previous.receivedAtMs) {
      latestConnectionByAddress.set(address, entry);
    }
  }

  const connectedProfileDetected = hasConnectedProfile(snapshot, stateSummary);

  return bondedDevices.map((device) => {
    const normalizedAddress = device.address.toUpperCase();
    const latestConnection = latestConnectionByAddress.get(normalizedAddress);
    if (latestConnection) {
      const eventName = latestConnection.event.event_type === "Connect" ? "Connected" : "Not connected";
      const detail = metadataName(latestConnection);
      return {
        address: normalizedAddress,
        name: device.name,
        bond_state: device.bond_state,
        connected: latestConnection.event.event_type === "Connect",
        connection_label: eventName,
        connection_tone: latestConnection.event.event_type === "Connect" ? "ok" : "idle",
        connection_detail: detail ? `Last event: ${detail}` : "From Bluetooth event",
      };
    }

    if (bondedDevices.length === 1 && connectedProfileDetected) {
      return {
        address: normalizedAddress,
        name: device.name,
        bond_state: device.bond_state,
        connected: true,
        connection_label: "Connected",
        connection_tone: "ok",
        connection_detail: "Inferred from active Bluetooth profile",
      };
    }

    if (connectedProfileDetected) {
      return {
        address: normalizedAddress,
        name: device.name,
        bond_state: device.bond_state,
        connected: false,
        connection_label: "Connection unknown",
        connection_tone: "warn",
        connection_detail: "A Bluetooth profile is connected, but no device-specific event was captured",
      };
    }

    return {
      address: normalizedAddress,
      name: device.name,
      bond_state: device.bond_state,
      connected: false,
      connection_label: "Not connected",
      connection_tone: "idle",
      connection_detail: null,
    };
  });
};

export const buildBluetoothDiscoveredDeviceRows = ({
  snapshot,
  events,
}: {
  snapshot: BluetoothParsedSnapshot | null;
  events: BluetoothMonitorEventEntry[];
}): BluetoothDiscoveredDeviceRow[] => {
  const bondedAddresses = new Set((snapshot?.bonded_devices ?? []).map((device) => device.address.toUpperCase()));
  const latestByAddress = new Map<string, BluetoothDiscoveredDeviceRow>();

  for (const entry of events) {
    if (entry.event.event_type !== "ScanResult") {
      continue;
    }
    const address = metadataAddress(entry);
    if (!address) {
      continue;
    }
    const nextRow: BluetoothDiscoveredDeviceRow = {
      address,
      name: metadataName(entry),
      last_rssi: metadataRssi(entry),
      last_seen_at_ms: entry.receivedAtMs,
      paired: bondedAddresses.has(address),
    };
    const previous = latestByAddress.get(address);
    if (!previous || nextRow.last_seen_at_ms >= previous.last_seen_at_ms) {
      latestByAddress.set(address, {
        ...previous,
        ...nextRow,
        name: nextRow.name ?? previous?.name ?? null,
        last_rssi: nextRow.last_rssi ?? previous?.last_rssi ?? null,
      });
    }
  }

  return [...latestByAddress.values()].sort((left, right) => right.last_seen_at_ms - left.last_seen_at_ms);
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
      title: "No paired devices in snapshot.",
      body: "Paired accessories will appear here after the next Bluetooth snapshot.",
    };
  }
  if (hasSearch) {
    return {
      title: "No matching paired devices.",
      body: "Clear the search or use a different device name or address.",
    };
  }
  return {
    title: "No paired devices in snapshot.",
    body: "Paired accessories will appear here after the next Bluetooth snapshot.",
  };
};
