import type { DeviceDetail, DeviceInfo } from "./types";

export type DeviceRetentionReason = "reboot_initiated" | "connection_lost";

export type DeviceRetentionRecord = {
  serial: string;
  reason: DeviceRetentionReason;
  enteredRetentionAt: number;
  expiresAt: number;
  rebootMode?: string;
  lastKnownDetail?: DeviceDetail | null;
  lastKnownModel?: string | null;
  platform?: "android" | "ios";
};

export type DeviceDisplayStatusKind =
  | "online"
  | "rebooting"
  | "reconnecting"
  | "offline"
  | "unauthorized";

export type DeviceDisplayStatus = {
  kind: DeviceDisplayStatusKind;
  label: string;
  tone: "ok" | "warn" | "error" | "muted";
  title: string;
  isRetained: boolean;
  canExecuteCommands: boolean;
  elapsedSec?: number;
  remainingSec?: number;
  rebootMode?: string;
};

export type DeviceRetentionConfig = {
  enabled: boolean;
  rebootTimeoutSec: number;
  disconnectTimeoutSec: number;
};

export const DEFAULT_DEVICE_RETENTION_CONFIG: DeviceRetentionConfig = {
  enabled: true,
  rebootTimeoutSec: 90,
  disconnectTimeoutSec: 45,
};

export const clampRetentionTimeoutSec = (value: unknown, fallback: number): number => {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num) || num < 0) {
    return fallback;
  }
  return Math.min(600, Math.max(0, Math.round(num)));
};

export const markDevicesForReboot = (
  currentRetention: Record<string, DeviceRetentionRecord>,
  devices: DeviceInfo[],
  serials: string[],
  mode?: string,
  timeoutSec = DEFAULT_DEVICE_RETENTION_CONFIG.rebootTimeoutSec,
  now = Date.now(),
): Record<string, DeviceRetentionRecord> => {
  if (!serials.length) {
    return currentRetention;
  }
  const next = { ...currentRetention };
  const deviceMap = new Map(devices.map((d) => [d.summary.serial, d]));

  for (const serial of serials) {
    const existingDev = deviceMap.get(serial);
    const existingRec = currentRetention[serial];
    const durationMs = Math.max(5, timeoutSec) * 1000;

    next[serial] = {
      serial,
      reason: "reboot_initiated",
      enteredRetentionAt: now,
      expiresAt: now + durationMs,
      rebootMode: mode ?? existingRec?.rebootMode,
      lastKnownDetail: existingDev?.detail ?? existingRec?.lastKnownDetail ?? null,
      lastKnownModel:
        existingDev?.detail?.model ??
        existingDev?.summary.model ??
        existingRec?.lastKnownModel ??
        null,
      platform: (existingDev?.summary.platform ?? existingRec?.platform ?? "android") as "android" | "ios",
    };
  }

  return next;
};

export const reconcileDevicesWithRetention = ({
  currentDevices,
  incomingDevices,
  retentionMap,
  config = DEFAULT_DEVICE_RETENTION_CONFIG,
  now = Date.now(),
}: {
  currentDevices: DeviceInfo[];
  incomingDevices: DeviceInfo[];
  retentionMap: Record<string, DeviceRetentionRecord>;
  config?: DeviceRetentionConfig;
  now?: number;
}): {
  mergedDevices: DeviceInfo[];
  nextRetentionMap: Record<string, DeviceRetentionRecord>;
  restoredSerials: string[];
  expiredSerials: string[];
} => {
  const currentBySerial = new Map(currentDevices.map((d) => [d.summary.serial, d]));
  const incomingSerials = new Set(incomingDevices.map((d) => d.summary.serial));
  const nextRetentionMap: Record<string, DeviceRetentionRecord> = {};
  const restoredSerials: string[] = [];
  const expiredSerials: string[] = [];

  // 1. Process incoming (active) devices
  const mergedDevices: DeviceInfo[] = incomingDevices.map((incoming) => {
    const serial = incoming.summary.serial;
    if (retentionMap[serial]) {
      restoredSerials.push(serial);
    }
    const existing = currentBySerial.get(serial);
    return {
      summary: incoming.summary,
      detail: incoming.detail ?? existing?.detail ?? null,
      capabilities: incoming.capabilities ?? existing?.capabilities ?? null,
    };
  });

  if (!config.enabled) {
    return {
      mergedDevices,
      nextRetentionMap: {},
      restoredSerials,
      expiredSerials: Object.keys(retentionMap),
    };
  }

  // 2. Identify missing devices from currentDevices and retentionMap
  const allKnownSerials = new Set([
    ...Array.from(currentBySerial.keys()),
    ...Object.keys(retentionMap),
  ]);

  for (const serial of allKnownSerials) {
    if (incomingSerials.has(serial)) {
      continue;
    }

    const existingRec = retentionMap[serial];
    const existingDev = currentBySerial.get(serial);

    let rec: DeviceRetentionRecord;
    if (existingRec) {
      rec = existingRec;
    } else {
      const timeoutSec = config.disconnectTimeoutSec > 0 ? config.disconnectTimeoutSec : 0;

      if (timeoutSec <= 0) {
        expiredSerials.push(serial);
        continue;
      }

      rec = {
        serial,
        reason: "connection_lost",
        enteredRetentionAt: now,
        expiresAt: now + timeoutSec * 1000,
        lastKnownDetail: existingDev?.detail ?? null,
        lastKnownModel: existingDev?.detail?.model ?? existingDev?.summary.model ?? null,
        platform: (existingDev?.summary.platform ?? "android") as "android" | "ios",
      };
    }

    if (now >= rec.expiresAt) {
      expiredSerials.push(serial);
      continue;
    }

    nextRetentionMap[serial] = rec;

    // Synthesize retained DeviceInfo
    const state = rec.reason === "reboot_initiated" ? "rebooting" : "offline";
    const syntheticDevice: DeviceInfo = {
      summary: {
        serial,
        state,
        platform: rec.platform ?? "android",
        model: rec.lastKnownModel,
      },
      detail: rec.lastKnownDetail ?? existingDev?.detail ?? null,
      capabilities: existingDev?.capabilities ?? null,
    };

    mergedDevices.push(syntheticDevice);
  }

  return {
    mergedDevices,
    nextRetentionMap,
    restoredSerials,
    expiredSerials,
  };
};

export const tickRetentionRecords = ({
  currentDevices,
  retentionMap,
  now = Date.now(),
}: {
  currentDevices: DeviceInfo[];
  retentionMap: Record<string, DeviceRetentionRecord>;
  now?: number;
}): {
  mergedDevices: DeviceInfo[];
  nextRetentionMap: Record<string, DeviceRetentionRecord>;
  expiredSerials: string[];
} => {
  const nextRetentionMap: Record<string, DeviceRetentionRecord> = {};
  const expiredSerials: string[] = [];

  for (const [serial, rec] of Object.entries(retentionMap)) {
    if (now >= rec.expiresAt) {
      expiredSerials.push(serial);
    } else {
      nextRetentionMap[serial] = rec;
    }
  }

  if (!expiredSerials.length) {
    return {
      mergedDevices: currentDevices,
      nextRetentionMap,
      expiredSerials: [],
    };
  }

  const expiredSet = new Set(expiredSerials);
  const mergedDevices = currentDevices.filter((d) => !expiredSet.has(d.summary.serial));

  return {
    mergedDevices,
    nextRetentionMap,
    expiredSerials,
  };
};

export const dismissRetainedDevice = ({
  currentDevices,
  retentionMap,
  serial,
}: {
  currentDevices: DeviceInfo[];
  retentionMap: Record<string, DeviceRetentionRecord>;
  serial: string;
}): {
  mergedDevices: DeviceInfo[];
  nextRetentionMap: Record<string, DeviceRetentionRecord>;
} => {
  const nextRetentionMap = { ...retentionMap };
  delete nextRetentionMap[serial];
  const mergedDevices = currentDevices.filter((d) => d.summary.serial !== serial);
  return { mergedDevices, nextRetentionMap };
};

export const resolveDeviceDisplayStatus = (
  device: DeviceInfo | null | undefined,
  retentionRecord?: DeviceRetentionRecord | null,
  now = Date.now(),
): DeviceDisplayStatus => {
  if (!device) {
    return {
      kind: "offline",
      label: "offline",
      tone: "muted",
      title: "No device selected.",
      isRetained: false,
      canExecuteCommands: false,
    };
  }

  const rawState = device.summary.state;
  const isRetained = retentionRecord != null || rawState === "rebooting";
  const reason = retentionRecord?.reason;

  if (reason === "reboot_initiated" || rawState === "rebooting") {
    const enteredAt = retentionRecord?.enteredRetentionAt ?? now;
    const expiresAt = retentionRecord?.expiresAt ?? now + 90_000;
    const elapsedSec = Math.max(0, Math.floor((now - enteredAt) / 1000));
    const remainingSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
    const modeSuffix = retentionRecord?.rebootMode ? ` (${retentionRecord.rebootMode})` : "";

    return {
      kind: "rebooting",
      label: `Rebooting (${elapsedSec}s)`,
      tone: "warn",
      title: `Device is rebooting${modeSuffix}. Waiting for device to come back online (retaining for ${remainingSec}s).`,
      isRetained: true,
      canExecuteCommands: false,
      elapsedSec,
      remainingSec,
      rebootMode: retentionRecord?.rebootMode,
    };
  }

  if (reason === "connection_lost" || (isRetained && rawState === "offline")) {
    const enteredAt = retentionRecord?.enteredRetentionAt ?? now;
    const expiresAt = retentionRecord?.expiresAt ?? now + 45_000;
    const elapsedSec = Math.max(0, Math.floor((now - enteredAt) / 1000));
    const remainingSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));

    return {
      kind: "reconnecting",
      label: `Reconnecting (${remainingSec}s)`,
      tone: "warn",
      title: `Connection lost. Retaining device for ${remainingSec}s while waiting for reconnect.`,
      isRetained: true,
      canExecuteCommands: false,
      elapsedSec,
      remainingSec,
    };
  }

  if (rawState === "device") {
    return {
      kind: "online",
      label: "device",
      tone: "ok",
      title: "Device is online and ready.",
      isRetained: false,
      canExecuteCommands: true,
    };
  }

  if (rawState === "unauthorized") {
    return {
      kind: "unauthorized",
      label: "unauthorized",
      tone: "error",
      title: "Device is unauthorized. Please unlock screen and accept the USB debugging prompt.",
      isRetained: false,
      canExecuteCommands: false,
    };
  }

  return {
    kind: "offline",
    label: rawState || "offline",
    tone: "warn",
    title: `Device state: ${rawState || "offline"}.`,
    isRetained: false,
    canExecuteCommands: false,
  };
};

export const filterEligibleCommandSerials = (
  serials: string[],
  devices: DeviceInfo[],
  retentionMap: Record<string, DeviceRetentionRecord> = {},
): {
  eligibleSerials: string[];
  skippedRetainedSerials: string[];
  skippedOfflineSerials: string[];
} => {
  const deviceBySerial = new Map(devices.map((d) => [d.summary.serial, d]));
  const eligibleSerials: string[] = [];
  const skippedRetainedSerials: string[] = [];
  const skippedOfflineSerials: string[] = [];

  for (const serial of serials) {
    const dev = deviceBySerial.get(serial);
    if (!dev) {
      skippedOfflineSerials.push(serial);
      continue;
    }
    if (retentionMap[serial] || dev.summary.state === "rebooting") {
      skippedRetainedSerials.push(serial);
      continue;
    }
    if (dev.summary.state === "device") {
      eligibleSerials.push(serial);
    } else {
      skippedOfflineSerials.push(serial);
    }
  }

  return {
    eligibleSerials,
    skippedRetainedSerials,
    skippedOfflineSerials,
  };
};
