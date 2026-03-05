import { describe, expect, it } from "vitest";
import {
  inferBluetoothStatesFromSnapshot,
  resolveBluetoothBondedEmptyState,
  resolveBluetoothMonitorSessionState,
  resolveBluetoothTimelineEmptyState,
} from "./bluetoothMonitorState";
import type { BluetoothParsedSnapshot } from "./types";

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
      title: "No bonded devices in snapshot.",
      body: "Paired accessories will appear here after the next Bluetooth snapshot.",
    });
    expect(resolveBluetoothBondedEmptyState({ totalDevices: 4, filteredDevices: 0, hasSearch: true })).toEqual({
      title: "No matching bonded devices.",
      body: "Clear the search or use a different device name or address.",
    });
  });
});
