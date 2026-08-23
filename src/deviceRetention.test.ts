import { describe, expect, it } from "vitest";
import type { DeviceInfo } from "./types";
import {
  clampRetentionTimeoutSec,
  DEFAULT_DEVICE_RETENTION_CONFIG,
  dismissRetainedDevice,
  filterEligibleCommandSerials,
  markDevicesForReboot,
  reconcileDevicesWithRetention,
  resolveDeviceDisplayStatus,
  tickRetentionRecords,
} from "./deviceRetention";

const sampleDevice = (serial: string, state = "device", model = "Pixel_7"): DeviceInfo => ({
  summary: {
    serial,
    state,
    platform: "android",
    model,
  },
  detail: {
    serial,
    model,
    device_name: `Phone_${serial}`,
    battery_level: 80,
  },
  capabilities: {
    reboot: true,
    logs: true,
  },
});

describe("deviceRetention", () => {
  it("clamps retention timeout values within reasonable bounds", () => {
    expect(clampRetentionTimeoutSec(120, 90)).toBe(120);
    expect(clampRetentionTimeoutSec(-10, 90)).toBe(90);
    expect(clampRetentionTimeoutSec("invalid", 45)).toBe(45);
    expect(clampRetentionTimeoutSec(9999, 90)).toBe(600);
  });

  it("marks devices for reboot with correct timestamp and expiry", () => {
    const devices = [sampleDevice("dev1"), sampleDevice("dev2")];
    const now = 1000000;
    const records = markDevicesForReboot({}, devices, ["dev1"], "bootloader", 90, now);

    expect(records.dev1).toBeDefined();
    expect(records.dev1.serial).toBe("dev1");
    expect(records.dev1.reason).toBe("reboot_initiated");
    expect(records.dev1.enteredRetentionAt).toBe(now);
    expect(records.dev1.expiresAt).toBe(now + 90000);
    expect(records.dev1.rebootMode).toBe("bootloader");
    expect(records.dev1.lastKnownModel).toBe("Pixel_7");
  });

  it("retains missing device marked for reboot when ADB snapshot drops it", () => {
    const dev1 = sampleDevice("dev1");
    const dev2 = sampleDevice("dev2");
    const currentDevices = [dev1, dev2];
    const incomingDevices = [dev2]; // dev1 dropped from ADB
    const now = 1000000;

    const retentionMap = markDevicesForReboot({}, currentDevices, ["dev1"], "normal", 90, now);
    const result = reconcileDevicesWithRetention({
      currentDevices,
      incomingDevices,
      retentionMap,
      config: { enabled: true, rebootTimeoutSec: 90, disconnectTimeoutSec: 45 },
      now: now + 5000,
    });

    expect(result.mergedDevices.length).toBe(2);
    const retained = result.mergedDevices.find((d) => d.summary.serial === "dev1");
    expect(retained).toBeDefined();
    expect(retained?.summary.state).toBe("rebooting");
    expect(retained?.detail?.battery_level).toBe(80);
    expect(result.nextRetentionMap.dev1).toBeDefined();
    expect(result.restoredSerials).toEqual([]);
    expect(result.expiredSerials).toEqual([]);
  });

  it("retains missing device as reconnecting on unexpected disconnect", () => {
    const dev1 = sampleDevice("dev1");
    const currentDevices = [dev1];
    const incomingDevices: DeviceInfo[] = []; // dev1 unexpectedly lost
    const now = 1000000;

    const result = reconcileDevicesWithRetention({
      currentDevices,
      incomingDevices,
      retentionMap: {},
      config: { enabled: true, rebootTimeoutSec: 90, disconnectTimeoutSec: 45 },
      now,
    });

    expect(result.mergedDevices.length).toBe(1);
    expect(result.mergedDevices[0].summary.serial).toBe("dev1");
    expect(result.mergedDevices[0].summary.state).toBe("offline");
    expect(result.nextRetentionMap.dev1).toBeDefined();
    expect(result.nextRetentionMap.dev1.reason).toBe("connection_lost");
    expect(result.nextRetentionMap.dev1.expiresAt).toBe(now + 45000);
  });

  it("restores retained device when it comes back online", () => {
    const dev1 = sampleDevice("dev1");
    const currentDevices = [{ ...dev1, summary: { ...dev1.summary, state: "rebooting" } }];
    const incomingDevices = [dev1]; // dev1 is back online in ADB
    const now = 1000000;

    const retentionMap = markDevicesForReboot({}, currentDevices, ["dev1"], "normal", 90, now - 30000);
    const result = reconcileDevicesWithRetention({
      currentDevices,
      incomingDevices,
      retentionMap,
      config: DEFAULT_DEVICE_RETENTION_CONFIG,
      now,
    });

    expect(result.mergedDevices.length).toBe(1);
    expect(result.mergedDevices[0].summary.state).toBe("device");
    expect(result.restoredSerials).toEqual(["dev1"]);
    expect(result.nextRetentionMap.dev1).toBeUndefined();
  });

  it("drops expired devices during reconciliation", () => {
    const dev1 = sampleDevice("dev1");
    const currentDevices = [dev1];
    const incomingDevices: DeviceInfo[] = [];
    const now = 1000000;

    const retentionMap = {
      dev1: {
        serial: "dev1",
        reason: "reboot_initiated" as const,
        enteredRetentionAt: now - 100000,
        expiresAt: now - 1000, // already expired
      },
    };

    const result = reconcileDevicesWithRetention({
      currentDevices,
      incomingDevices,
      retentionMap,
      config: DEFAULT_DEVICE_RETENTION_CONFIG,
      now,
    });

    expect(result.mergedDevices.length).toBe(0);
    expect(result.expiredSerials).toEqual(["dev1"]);
    expect(result.nextRetentionMap.dev1).toBeUndefined();
  });

  it("cleans up expired records with tickRetentionRecords", () => {
    const dev1 = sampleDevice("dev1", "rebooting");
    const dev2 = sampleDevice("dev2", "device");
    const now = 1000000;

    const retentionMap = {
      dev1: {
        serial: "dev1",
        reason: "reboot_initiated" as const,
        enteredRetentionAt: now - 95000,
        expiresAt: now - 5000, // expired
      },
    };

    const result = tickRetentionRecords({
      currentDevices: [dev1, dev2],
      retentionMap,
      now,
    });

    expect(result.mergedDevices.map((d) => d.summary.serial)).toEqual(["dev2"]);
    expect(result.expiredSerials).toEqual(["dev1"]);
    expect(result.nextRetentionMap.dev1).toBeUndefined();
  });

  it("manually dismisses retained device", () => {
    const dev1 = sampleDevice("dev1", "rebooting");
    const dev2 = sampleDevice("dev2", "device");
    const retentionMap = {
      dev1: {
        serial: "dev1",
        reason: "reboot_initiated" as const,
        enteredRetentionAt: 100,
        expiresAt: 200,
      },
    };

    const result = dismissRetainedDevice({
      currentDevices: [dev1, dev2],
      retentionMap,
      serial: "dev1",
    });

    expect(result.mergedDevices.map((d) => d.summary.serial)).toEqual(["dev2"]);
    expect(result.nextRetentionMap.dev1).toBeUndefined();
  });

  it("resolves display status properly for all states", () => {
    const now = 1000000;
    const onlineDev = sampleDevice("dev1", "device");
    const onlineStatus = resolveDeviceDisplayStatus(onlineDev, null, now);
    expect(onlineStatus.kind).toBe("online");
    expect(onlineStatus.tone).toBe("ok");
    expect(onlineStatus.canExecuteCommands).toBe(true);

    const rebootingDev = sampleDevice("dev2", "rebooting");
    const rebootRec = {
      serial: "dev2",
      reason: "reboot_initiated" as const,
      enteredRetentionAt: now - 20000,
      expiresAt: now + 70000,
      rebootMode: "recovery",
    };
    const rebootStatus = resolveDeviceDisplayStatus(rebootingDev, rebootRec, now);
    expect(rebootStatus.kind).toBe("rebooting");
    expect(rebootStatus.label).toBe("Rebooting (20s)");
    expect(rebootStatus.tone).toBe("warn");
    expect(rebootStatus.canExecuteCommands).toBe(false);
    expect(rebootStatus.remainingSec).toBe(70);

    const reconnectingDev = sampleDevice("dev3", "offline");
    const reconnectRec = {
      serial: "dev3",
      reason: "connection_lost" as const,
      enteredRetentionAt: now - 10000,
      expiresAt: now + 35000,
    };
    const reconnectStatus = resolveDeviceDisplayStatus(reconnectingDev, reconnectRec, now);
    expect(reconnectStatus.kind).toBe("reconnecting");
    expect(reconnectStatus.label).toBe("Reconnecting (35s)");
    expect(reconnectStatus.tone).toBe("warn");
    expect(reconnectStatus.canExecuteCommands).toBe(false);

    const unauthDev = sampleDevice("dev4", "unauthorized");
    const unauthStatus = resolveDeviceDisplayStatus(unauthDev, null, now);
    expect(unauthStatus.kind).toBe("unauthorized");
    expect(unauthStatus.tone).toBe("error");
    expect(unauthStatus.canExecuteCommands).toBe(false);
  });

  it("filters out retained and offline devices from batch command execution", () => {
    const dev1 = sampleDevice("dev1", "device");
    const dev2 = sampleDevice("dev2", "rebooting");
    const dev3 = sampleDevice("dev3", "unauthorized");
    const devices = [dev1, dev2, dev3];
    const retentionMap = {
      dev2: {
        serial: "dev2",
        reason: "reboot_initiated" as const,
        enteredRetentionAt: 100,
        expiresAt: 200,
      },
    };

    const filterResult = filterEligibleCommandSerials(["dev1", "dev2", "dev3"], devices, retentionMap);
    expect(filterResult.eligibleSerials).toEqual(["dev1"]);
    expect(filterResult.skippedRetainedSerials).toEqual(["dev2"]);
    expect(filterResult.skippedOfflineSerials).toEqual(["dev3"]);
  });
});
