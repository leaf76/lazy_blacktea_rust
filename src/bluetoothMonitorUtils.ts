import type { BluetoothEventType, BluetoothState } from "./types";

const pad2 = (value: number) => String(value).padStart(2, "0");

export const isLikelyUnixSeconds = (timestampSeconds: number) => timestampSeconds > 1_000_000_000;

export const toUnixSeconds = (timestampSeconds: number, receivedAtMs: number) =>
  isLikelyUnixSeconds(timestampSeconds) ? timestampSeconds : receivedAtMs / 1000;

export const formatClockTime = (unixSeconds: number) => {
  const date = new Date(unixSeconds * 1000);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};

export const formatRelativeFromMs = (nowMs: number, thenMs: number | null) => {
  if (thenMs == null) {
    return "Never";
  }
  const deltaMs = Math.max(0, nowMs - thenMs);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

export const bluetoothEventLabel = (eventType: BluetoothEventType) => {
  switch (eventType) {
    case "AdvertisingStart":
      return "Advertising started";
    case "AdvertisingStop":
      return "Advertising stopped";
    case "ScanStart":
      return "Scan started";
    case "ScanStop":
      return "Scan stopped";
    case "ScanResult":
      return "Scan result";
    case "Connect":
      return "Connected";
    case "Disconnect":
      return "Disconnected";
    case "Error":
      return "Error";
    default: {
      const _exhaustive: never = eventType;
      return _exhaustive;
    }
  }
};

export type BluetoothEventCategory = "scan" | "advertising" | "connection" | "error";

export const bluetoothEventCategory = (eventType: BluetoothEventType): BluetoothEventCategory => {
  switch (eventType) {
    case "ScanStart":
    case "ScanStop":
    case "ScanResult":
      return "scan";
    case "AdvertisingStart":
    case "AdvertisingStop":
      return "advertising";
    case "Connect":
    case "Disconnect":
      return "connection";
    case "Error":
      return "error";
    default: {
      const _exhaustive: never = eventType;
      return _exhaustive;
    }
  }
};

export const bluetoothStateLabel = (state: BluetoothState) => {
  switch (state) {
    case "Idle":
      return "Idle";
    case "Scanning":
      return "Scanning";
    case "Advertising":
      return "Advertising";
    case "Connected":
      return "Connected";
    case "Off":
      return "Off";
    case "Unknown":
      return "Unknown";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
};
