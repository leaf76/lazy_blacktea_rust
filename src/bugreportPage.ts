import type { DeviceInfo } from "./types";
import type { DeviceTaskStatus, TaskItem } from "./tasks";

export type BugreportCardStatus = DeviceTaskStatus["status"] | "idle";

export type BugreportDeviceCard = {
  serial: string;
  display_name: string;
  online: boolean;
  status: BugreportCardStatus;
  progress: number | null;
  message: string | null;
  output_path: string | null;
  can_retry: boolean;
  can_cancel: boolean;
};

export type BugreportCardsSummary = {
  selected: number;
  online: number;
  offline: number;
  idle: number;
  running: number;
  success: number;
  error: number;
  cancelled: number;
  interrupted: number;
  completed: number;
  has_failures: boolean;
  has_outputs: boolean;
};

const uniqueSerials = (serials: string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  serials.forEach((serial) => {
    const normalized = serial.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    next.push(normalized);
  });
  return next;
};

const normalizeProgress = (status: BugreportCardStatus, progress: number | null | undefined): number | null => {
  if (typeof progress !== "number" || Number.isNaN(progress)) {
    return status === "success" ? 100 : null;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
};

const resolveCardMessage = (
  status: BugreportCardStatus,
  message: string | null | undefined,
  online: boolean,
): string | null => {
  const normalized = message?.trim() ?? "";
  if (normalized) {
    return normalized;
  }
  if (status === "idle") {
    return online ? "Ready to generate." : "Device offline. Bring it online to run bugreport.";
  }
  if (status === "running") {
    return "Generating bugreport...";
  }
  if (status === "success") {
    return "Bugreport completed.";
  }
  if (status === "error") {
    return "Bugreport failed.";
  }
  if (status === "cancelled") {
    return "Bugreport cancelled.";
  }
  if (status === "interrupted") {
    return "Task interrupted.";
  }
  return null;
};

export const buildBugreportDeviceCards = (
  selectedSerials: string[],
  devices: DeviceInfo[],
  latestTask: TaskItem | null,
): BugreportDeviceCard[] => {
  const selected = uniqueSerials(selectedSerials);
  const deviceBySerial = new Map(devices.map((device) => [device.summary.serial, device]));
  return selected.map((serial) => {
    const device = deviceBySerial.get(serial);
    const entry = latestTask?.devices?.[serial] ?? null;
    const status: BugreportCardStatus = entry?.status ?? "idle";
    const displayName = device?.detail?.model?.trim() || device?.summary.model?.trim() || serial;
    const online = device?.summary.state === "device";
    const outputPath = entry?.output_path?.trim() || null;
    const progress = normalizeProgress(status, entry?.progress ?? null);
    const message = resolveCardMessage(status, entry?.message ?? null, online);
    return {
      serial,
      display_name: displayName,
      online,
      status,
      progress,
      message,
      output_path: outputPath,
      can_retry: status === "error" || status === "cancelled" || status === "interrupted",
      can_cancel: status === "running",
    };
  });
};

export const summarizeBugreportCards = (cards: BugreportDeviceCard[]): BugreportCardsSummary => {
  const summary: BugreportCardsSummary = {
    selected: cards.length,
    online: 0,
    offline: 0,
    idle: 0,
    running: 0,
    success: 0,
    error: 0,
    cancelled: 0,
    interrupted: 0,
    completed: 0,
    has_failures: false,
    has_outputs: false,
  };

  cards.forEach((card) => {
    if (card.online) {
      summary.online += 1;
    } else {
      summary.offline += 1;
    }

    if (card.status === "idle") {
      summary.idle += 1;
    } else if (card.status === "running") {
      summary.running += 1;
    } else if (card.status === "success") {
      summary.success += 1;
      summary.completed += 1;
    } else if (card.status === "error") {
      summary.error += 1;
      summary.completed += 1;
      summary.has_failures = true;
    } else if (card.status === "cancelled") {
      summary.cancelled += 1;
      summary.completed += 1;
    } else if (card.status === "interrupted") {
      summary.interrupted += 1;
      summary.completed += 1;
      summary.has_failures = true;
    }

    if (card.output_path) {
      summary.has_outputs = true;
    }
  });

  return summary;
};

export const getBugreportGenerateLabel = (selectedCount: number, runningCount: number): string => {
  const selected = Math.max(0, selectedCount);
  const running = Math.max(0, Math.min(runningCount, selected));
  if (selected <= 0) {
    return "Generate Bugreport";
  }
  if (running > 0) {
    return `Generating Bugreports (${running}/${selected})...`;
  }
  return `Generate Bugreport (${selected})`;
};
