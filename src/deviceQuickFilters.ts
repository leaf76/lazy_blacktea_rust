import type { DeviceInfo, ScreenRecordStatus } from "./types";
import { parseDeviceApiLevel } from "./apkInspector";

export type DeviceQuickFilterId =
  | "wifi_on"
  | "wifi_off"
  | "bt_on"
  | "bt_off"
  | "selected"
  | "recording"
  | "api_33_plus"
  | "api_34_plus"
  | "android"
  | "ios";

export type DeviceQuickFilterOption = {
  id: DeviceQuickFilterId;
  label: string;
};

export const DEVICE_QUICK_FILTER_OPTIONS: DeviceQuickFilterOption[] = [
  { id: "selected", label: "Selected" },
  { id: "recording", label: "Recording" },
  { id: "wifi_on", label: "Wi-Fi On" },
  { id: "wifi_off", label: "Wi-Fi Off" },
  { id: "bt_on", label: "BT On" },
  { id: "bt_off", label: "BT Off" },
  { id: "api_33_plus", label: "API 33+" },
  { id: "api_34_plus", label: "API 34+" },
  { id: "android", label: "Android" },
  { id: "ios", label: "iOS" },
];

const EXCLUSIVE_PAIRS: Array<[DeviceQuickFilterId, DeviceQuickFilterId]> = [
  ["wifi_on", "wifi_off"],
  ["bt_on", "bt_off"],
  ["android", "ios"],
  ["api_33_plus", "api_34_plus"],
];

export const toggleDeviceQuickFilter = (
  active: DeviceQuickFilterId[],
  target: DeviceQuickFilterId,
): DeviceQuickFilterId[] => {
  if (active.includes(target)) {
    return active.filter((id) => id !== target);
  }
  const exclusive = EXCLUSIVE_PAIRS.find(([a, b]) => a === target || b === target);
  const cleaned = exclusive
    ? active.filter((id) => id !== exclusive[0] && id !== exclusive[1])
    : active;
  return [...cleaned, target];
};

export const matchesDeviceQuickFilters = (
  device: DeviceInfo,
  activeFilters: DeviceQuickFilterId[],
  context: {
    selectedSerialSet: Set<string>;
    screenRecordStatusBySerial: Record<string, ScreenRecordStatus>;
  },
): boolean => {
  if (activeFilters.length === 0) {
    return true;
  }
  const serial = device.summary.serial;
  const platform = device.summary.platform ?? "android";
  const apiLevel = parseDeviceApiLevel(device.detail?.api_level);

  for (const filter of activeFilters) {
    switch (filter) {
      case "selected":
        if (!context.selectedSerialSet.has(serial)) {
          return false;
        }
        break;
      case "recording":
        if (!context.screenRecordStatusBySerial[serial]?.running) {
          return false;
        }
        break;
      case "wifi_on":
        if (device.detail?.wifi_is_on !== true) {
          return false;
        }
        break;
      case "wifi_off":
        if (device.detail?.wifi_is_on !== false) {
          return false;
        }
        break;
      case "bt_on":
        if (device.detail?.bt_is_on !== true) {
          return false;
        }
        break;
      case "bt_off":
        if (device.detail?.bt_is_on !== false) {
          return false;
        }
        break;
      case "api_33_plus":
        if (platform !== "android" || apiLevel == null || apiLevel < 33) {
          return false;
        }
        break;
      case "api_34_plus":
        if (platform !== "android" || apiLevel == null || apiLevel < 34) {
          return false;
        }
        break;
      case "android":
        if (platform !== "android") {
          return false;
        }
        break;
      case "ios":
        if (platform !== "ios") {
          return false;
        }
        break;
    }
  }
  return true;
};

export const getNextKeyboardDeviceIndex = (
  currentIndex: number,
  key: string,
  total: number,
): number | null => {
  if (total <= 0) {
    return null;
  }
  if (key === "ArrowDown") {
    return currentIndex < 0 ? 0 : Math.min(total - 1, currentIndex + 1);
  }
  if (key === "ArrowUp") {
    return currentIndex < 0 ? total - 1 : Math.max(0, currentIndex - 1);
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return total - 1;
  }
  return null;
};
