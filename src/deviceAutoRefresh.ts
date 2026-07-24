import type { AppConfig } from "./types";

export const DEFAULT_DEVICE_REFRESH_INTERVAL_SEC = 5;
export const DEFAULT_IOS_REFRESH_INTERVAL_SEC = 15;
export const MIN_IOS_REFRESH_INTERVAL_SEC = 5;
export const MAX_IOS_REFRESH_INTERVAL_SEC = 300;

export const clampRefreshIntervalSec = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_DEVICE_REFRESH_INTERVAL_SEC;
  }

  const interval = Math.floor(value);
  if (interval < 1) {
    return DEFAULT_DEVICE_REFRESH_INTERVAL_SEC;
  }

  return interval;
};

export const clampIosRefreshIntervalSec = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_IOS_REFRESH_INTERVAL_SEC;
  }
  const interval = Math.floor(value);
  if (interval < MIN_IOS_REFRESH_INTERVAL_SEC) {
    return DEFAULT_IOS_REFRESH_INTERVAL_SEC;
  }
  if (interval > MAX_IOS_REFRESH_INTERVAL_SEC) {
    return MAX_IOS_REFRESH_INTERVAL_SEC;
  }
  return interval;
};

export const getAutoRefreshIntervalMs = (config: AppConfig | null): number | null => {
  if (!config?.device.auto_refresh_enabled) {
    return null;
  }

  return clampRefreshIntervalSec(config.device.refresh_interval) * 1000;
};

/** Interval for optional iOS inventory polling (full list_devices). */
export const getIosAutoRefreshIntervalMs = (config: AppConfig | null): number | null => {
  if (!config?.device.ios_auto_refresh_enabled) {
    return null;
  }
  return clampIosRefreshIntervalSec(config.device.ios_refresh_interval) * 1000;
};

