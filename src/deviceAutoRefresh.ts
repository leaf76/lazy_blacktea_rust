import type { AppConfig } from "./types";

export const DEFAULT_DEVICE_REFRESH_INTERVAL_SEC = 5;

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

export const getAutoRefreshIntervalMs = (config: AppConfig | null): number | null => {
  if (!config?.device.auto_refresh_enabled) {
    return null;
  }

  return clampRefreshIntervalSec(config.device.refresh_interval) * 1000;
};

