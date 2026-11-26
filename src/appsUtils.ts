import type { AppInfo } from "./types";

export type AppIconCacheEntry = {
  status: "queued" | "loading" | "ready" | "error";
  dataUrl?: string;
  error?: string;
};

export type AppActionKind = "uninstall" | "forceStop" | "clear" | "enable" | "disable" | "info";

export type AppsContextMenuState = {
  x: number;
  y: number;
  app: AppInfo;
};

export type ContextMenuPosition = {
  top: number;
  left: number;
  maxHeight: number;
};

export function getAppDisplayName(packageName: string): string {
  const trimmed = packageName.trim();
  if (!trimmed) {
    return "(unknown)";
  }
  const last = trimmed.split(".").filter(Boolean).pop() ?? trimmed;
  const normalized = last.replace(/[_-]+/g, " ").trim();
  const words = normalized
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.length ? lower[0].toUpperCase() + lower.slice(1) : lower;
    });
  const candidate = words.join(" ").trim();
  return candidate || trimmed;
}

export function getAppAvatarLetters(packageName: string): string {
  const label = getAppDisplayName(packageName);
  const parts = label.split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? label[0] ?? "A";
  const second = parts.length > 1 ? parts[1]?.[0] : undefined;
  const letters = `${first}${second ?? ""}`.toUpperCase();
  return letters.slice(0, 2);
}

export function getStableToneIndex(value: string): number {
  let sum = 0;
  for (let i = 0; i < value.length; i += 1) {
    sum = (sum + value.charCodeAt(i) * (i + 1)) % 1_000_000;
  }
  return sum % 6;
}

export function getAppIconKey(serial: string, packageName: string): string {
  return `${serial}::${packageName}`;
}
