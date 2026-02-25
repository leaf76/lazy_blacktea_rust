import type { DeviceInfo } from "./types";

export type LogcatPopupTargets = {
  openable: string[];
  skipped: string[];
};

export type LogcatPopupCandidate = {
  serial: string;
  name: string;
  state: string;
  selectable: boolean;
  defaultSelected: boolean;
};

const resolveLogcatPopupCandidateName = (device: DeviceInfo): string => {
  const detailModel = device.detail?.model?.trim();
  if (detailModel) {
    return detailModel;
  }
  const summaryModel = device.summary.model?.trim();
  if (summaryModel) {
    return summaryModel;
  }
  return device.summary.serial;
};

export const buildLogcatPopupCandidates = (
  devices: DeviceInfo[],
  selectedSerials: string[],
  activeSerial: string | null,
): LogcatPopupCandidate[] => {
  const selectedSerialSet = new Set(selectedSerials.map((serial) => serial.trim()).filter(Boolean));
  let hasDefaultSelected = false;
  const candidates: LogcatPopupCandidate[] = [];

  devices.forEach((device) => {
    const serial = device.summary.serial.trim();
    if (!serial) {
      return;
    }
    const state = device.summary.state.trim() || "unknown";
    const selectable = state === "device";
    const defaultSelected = selectable && selectedSerialSet.has(serial);
    if (defaultSelected) {
      hasDefaultSelected = true;
    }
    candidates.push({
      serial,
      name: resolveLogcatPopupCandidateName(device),
      state,
      selectable,
      defaultSelected,
    });
  });

  if (hasDefaultSelected) {
    return candidates;
  }

  const normalizedActiveSerial = activeSerial?.trim();
  if (!normalizedActiveSerial) {
    return candidates;
  }

  return candidates.map((candidate) =>
    candidate.selectable && candidate.serial === normalizedActiveSerial
      ? { ...candidate, defaultSelected: true }
      : candidate,
  );
};

export const partitionLogcatPopupTargets = (
  selectedSerials: string[],
  devices: DeviceInfo[],
): LogcatPopupTargets => {
  const uniqueSelected = Array.from(new Set(selectedSerials.filter((serial) => serial.trim().length > 0)));
  if (!uniqueSelected.length) {
    return { openable: [], skipped: [] };
  }

  const stateBySerial = new Map(devices.map((device) => [device.summary.serial, device.summary.state] as const));
  const openable: string[] = [];
  const skipped: string[] = [];

  uniqueSelected.forEach((serial) => {
    if (stateBySerial.get(serial) === "device") {
      openable.push(serial);
      return;
    }
    skipped.push(serial);
  });

  return { openable, skipped };
};
