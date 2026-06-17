import { describe, expect, it } from "vitest";
import {
  buildBluetoothDiscoveredDeviceRows,
  buildBluetoothPairedDeviceRows,
  hasBluetoothMonitorSessionData,
  inferBluetoothStatesFromSnapshot,
  resolveBluetoothBondedEmptyState,
  resolveBluetoothMonitorSessionState,
  resolveBluetoothTimelineEmptyState,
} from "./bluetoothMonitorState";
import type { BluetoothMonitorEventEntry, BluetoothParsedSnapshot, BluetoothStateSummary } from "./types";

const buildSnapshot = (overrides: Partial<BluetoothParsedSnapshot> = {}): BluetoothParsedSnapshot => ({
  serial: "device-1",
  timestamp: 1_700_000_000,
  adapter_enabled: true,
  address: "AA:BB:CC:DD:EE:FF",
  scanning: {
    is_scanning: false,
    clients: [],
  },
  advertising: {
    is_advertising: false,
    sets: [],
  },
  profiles: {},
  bonded_devices: [],
  raw_text: "",
  ...overrides,
});

const buildStateSummary = (overrides: Partial<BluetoothStateSummary> = {}): BluetoothStateSummary => ({
  serial: "device-1",
  active_states: ["Idle"],
  metrics: {},
  timestamp: 1_700_000_000,
  ...overrides,
});

const buildMonitorEvent = (overrides: Partial<BluetoothMonitorEventEntry> = {}): BluetoothMonitorEventEntry => ({
  id: 0,
  receivedAtMs: 1_700_000_500_000,
  ...overrides,
  event: {
    serial: "device-1",
    timestamp: 1_700_000_500,
    event_type: "ScanResult",
    message: "onScanResult",
    tag: "BluetoothGatt",
    metadata: {},
    raw_line: "BluetoothGatt: onScanResult",
    ...(overrides.event ?? {}),
  },
});

describe("bluetoothMonitorState", () => {
  it("infers adapter off when snapshot reports disabled", () => {
    expect(inferBluetoothStatesFromSnapshot(buildSnapshot({ adapter_enabled: false }))).toEqual(["Off"]);
  });

  it("treats monitoring without recent data as starting before any events arrive", () => {
    expect(
      resolveBluetoothMonitorSessionState({
        serial: "device-1",
        monitoringDesired: true,
        lastAnyDataAtMs: null,
        nowMs: 20_000,
      }),
    ).toBe("starting");
  });

  it("treats monitoring with recent data as live", () => {
    expect(
      resolveBluetoothMonitorSessionState({
        serial: "device-1",
        monitoringDesired: true,
        lastAnyDataAtMs: 10_000,
        nowMs: 20_000,
      }),
    ).toBe("live");
  });

  it("treats monitoring with old data as stale", () => {
    expect(
      resolveBluetoothMonitorSessionState({
        serial: "device-1",
        monitoringDesired: true,
        lastAnyDataAtMs: 1_000,
        nowMs: 20_000,
      }),
    ).toBe("stale");
  });

  it("treats selected device with stopped monitor as paused", () => {
    expect(
      resolveBluetoothMonitorSessionState({
        serial: "device-1",
        monitoringDesired: false,
        lastAnyDataAtMs: 19_000,
        nowMs: 20_000,
      }),
    ).toBe("paused");
  });

  it("distinguishes event empty state from filtered-empty state", () => {
    expect(resolveBluetoothTimelineEmptyState({ totalEvents: 0, filteredEvents: 0, hasFilters: false })).toEqual({
      title: "No Bluetooth events yet.",
      body: "Try toggling Bluetooth, starting a scan, or connecting a headset to generate events.",
    });
    expect(resolveBluetoothTimelineEmptyState({ totalEvents: 8, filteredEvents: 0, hasFilters: true })).toEqual({
      title: "No matching events.",
      body: "Adjust the search text or filters to show matching Bluetooth activity.",
    });
  });

  it("distinguishes bonded-device empty state from filtered-empty state", () => {
    expect(resolveBluetoothBondedEmptyState({ totalDevices: 0, filteredDevices: 0, hasSearch: false })).toEqual({
      title: "No paired devices in snapshot.",
      body: "Paired accessories will appear here after the next Bluetooth snapshot.",
    });
    expect(resolveBluetoothBondedEmptyState({ totalDevices: 4, filteredDevices: 0, hasSearch: true })).toEqual({
      title: "No matching paired devices.",
      body: "Clear the search or use a different device name or address.",
    });
  });

  it("marks bonded devices as connected when recent connect events include the device address", () => {
    const snapshot = buildSnapshot({
      bonded_devices: [
        { address: "AA:BB:CC:DD:EE:FF", name: "Sony WH", bond_state: "Bonded" },
        { address: "11:22:33:44:55:66", name: "Keyboard", bond_state: "Bonded" },
      ],
    });
    const rows = buildBluetoothPairedDeviceRows({
      snapshot,
      stateSummary: buildStateSummary(),
      events: [
        buildMonitorEvent({
          receivedAtMs: 100,
          event: {
            serial: "device-1",
            timestamp: 100,
            event_type: "Connect",
            metadata: { address: "AA:BB:CC:DD:EE:FF", name: "Sony WH" },
            message: "BluetoothGatt: connect address=AA:BB:CC:DD:EE:FF name=Sony WH",
            raw_line: "BluetoothGatt: connect address=AA:BB:CC:DD:EE:FF name=Sony WH",
          },
        }),
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        address: "AA:BB:CC:DD:EE:FF",
        connected: true,
        connection_label: "Connected",
        connection_tone: "ok",
      }),
      expect.objectContaining({
        address: "11:22:33:44:55:66",
        connected: false,
        connection_label: "Not connected",
        connection_tone: "idle",
      }),
    ]);
  });

  it("falls back to profile state when a single bonded device is present", () => {
    const rows = buildBluetoothPairedDeviceRows({
      snapshot: buildSnapshot({
        profiles: { A2DP: "CONNECTED" },
        bonded_devices: [{ address: "AA:BB:CC:DD:EE:FF", name: "Sony WH", bond_state: "Bonded" }],
      }),
      stateSummary: buildStateSummary({ active_states: ["Connected"] }),
      events: [],
    });
    expect(rows[0]).toEqual(
      expect.objectContaining({
        address: "AA:BB:CC:DD:EE:FF",
        connected: true,
        connection_label: "Connected",
        connection_tone: "ok",
      }),
    );
  });

  it("uses an unknown state when profiles show a connection but multiple paired devices have no address-specific event", () => {
    const rows = buildBluetoothPairedDeviceRows({
      snapshot: buildSnapshot({
        profiles: { A2DP: "CONNECTED" },
        bonded_devices: [
          { address: "AA:BB:CC:DD:EE:FF", name: "Sony WH", bond_state: "Bonded" },
          { address: "11:22:33:44:55:66", name: "Galaxy Watch", bond_state: "Bonded" },
        ],
      }),
      stateSummary: buildStateSummary({ active_states: ["Connected"] }),
      events: [],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        address: "AA:BB:CC:DD:EE:FF",
        connected: false,
        connection_label: "Connection unknown",
        connection_tone: "warn",
      }),
      expect.objectContaining({
        address: "11:22:33:44:55:66",
        connected: false,
        connection_label: "Connection unknown",
        connection_tone: "warn",
      }),
    ]);
  });

  it("deduplicates discovered devices by address and keeps the latest name and RSSI", () => {
    const rows = buildBluetoothDiscoveredDeviceRows({
      snapshot: buildSnapshot({
        bonded_devices: [{ address: "AA:BB:CC:DD:EE:FF", name: "Sony WH", bond_state: "Bonded" }],
      }),
      events: [
        buildMonitorEvent({
          receivedAtMs: 100,
          event: {
            serial: "device-1",
            timestamp: 100,
            event_type: "ScanResult",
            metadata: { address: "AA:BB:CC:DD:EE:FF", name: "Sony WH", rssi: -67 },
            message: "onScanResult address=AA:BB:CC:DD:EE:FF name=Sony WH rssi=-67",
            raw_line: "onScanResult address=AA:BB:CC:DD:EE:FF name=Sony WH rssi=-67",
          },
        }),
        buildMonitorEvent({
          receivedAtMs: 200,
          event: {
            serial: "device-1",
            timestamp: 200,
            event_type: "ScanResult",
            metadata: { address: "AA:BB:CC:DD:EE:FF", name: "Sony WH-1000XM5", rssi: -54 },
            message: "onScanResult address=AA:BB:CC:DD:EE:FF name=Sony WH-1000XM5 rssi=-54",
            raw_line: "onScanResult address=AA:BB:CC:DD:EE:FF name=Sony WH-1000XM5 rssi=-54",
          },
        }),
        buildMonitorEvent({
          receivedAtMs: 150,
          event: {
            serial: "device-1",
            timestamp: 150,
            event_type: "ScanResult",
            metadata: { address: "11:22:33:44:55:66", name: "Keyboard", rssi: -71 },
            message: "onScanResult address=11:22:33:44:55:66 name=Keyboard rssi=-71",
            raw_line: "onScanResult address=11:22:33:44:55:66 name=Keyboard rssi=-71",
          },
        }),
      ],
    });
    expect(rows).toEqual([
      {
        address: "AA:BB:CC:DD:EE:FF",
        name: "Sony WH-1000XM5",
        last_rssi: -54,
        last_seen_at_ms: 200,
        paired: true,
      },
      {
        address: "11:22:33:44:55:66",
        name: "Keyboard",
        last_rssi: -71,
        last_seen_at_ms: 150,
        paired: false,
      },
    ]);
  });

  it("keeps discovered devices with masked samsung-style addresses", () => {
    const rows = buildBluetoothDiscoveredDeviceRows({
      snapshot: buildSnapshot(),
      events: [
        buildMonitorEvent({
          receivedAtMs: 300,
          event: {
            serial: "device-1",
            timestamp: 300,
            event_type: "ScanResult",
            metadata: { address: "XX:XX:XX:XX:33:42", rssi: -73 },
            message:
              "onScanResult to scannerId: 2- eventType=0x10, addressType=1, address=XX:XX:XX:XX:33:42, rssi=-73",
            raw_line:
              "04-18 23:07:32.929  5254  6440 I ScanController: onScanResult to scannerId: 2- eventType=0x10, addressType=1, address=XX:XX:XX:XX:33:42, rssi=-73",
          },
        }),
      ],
    });
    expect(rows).toEqual([
      {
        address: "XX:XX:XX:XX:33:42",
        name: null,
        last_rssi: -73,
        last_seen_at_ms: 300,
        paired: false,
      },
    ]);
  });

  it("returns no discovered devices after session events are cleared", () => {
    expect(buildBluetoothDiscoveredDeviceRows({ snapshot: buildSnapshot(), events: [] })).toEqual([]);
  });

  it("treats queued or session data as clearable monitor state", () => {
    expect(hasBluetoothMonitorSessionData({ visibleEvents: 0, sessionEvents: 0, queuedEvents: 0 })).toBe(false);
    expect(hasBluetoothMonitorSessionData({ visibleEvents: 2, sessionEvents: 0, queuedEvents: 0 })).toBe(true);
    expect(hasBluetoothMonitorSessionData({ visibleEvents: 0, sessionEvents: 3, queuedEvents: 0 })).toBe(true);
    expect(hasBluetoothMonitorSessionData({ visibleEvents: 0, sessionEvents: 0, queuedEvents: 1 })).toBe(true);
  });
});
