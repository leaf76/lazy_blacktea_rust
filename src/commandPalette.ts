import type { DeviceInfo } from "./types";
import type { TaskItem } from "./tasks";

export type CommandPaletteCategory = "navigation" | "device" | "action" | "task";

export type CommandPaletteItem = {
  id: string;
  category: CommandPaletteCategory;
  title: string;
  subtitle?: string;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
};

export type KeyboardTargetLike = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
} | null;

export const isEditableKeyboardTarget = (target: KeyboardTargetLike): boolean => {
  if (!target) {
    return false;
  }
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (typeof target.getAttribute === "function" && target.getAttribute("role") === "textbox") {
    return true;
  }
  if (typeof target.closest === "function") {
    if (target.closest('input, textarea, select, [contenteditable="true"], [data-terminal-input="true"]')) {
      return true;
    }
  }
  return false;
};

const scoreMatch = (item: CommandPaletteItem, tokens: string[]): number => {
  if (tokens.length === 0) {
    return 1;
  }
  const titleLower = item.title.toLowerCase();
  const subtitleLower = (item.subtitle ?? "").toLowerCase();
  const keywordsLower = (item.keywords ?? []).join(" ").toLowerCase();
  const haystack = `${titleLower} ${subtitleLower} ${keywordsLower} ${item.category}`;

  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) {
      return 0;
    }
    if (titleLower === token) {
      score += 100;
    } else if (titleLower.startsWith(token)) {
      score += 50;
    } else if (titleLower.includes(token)) {
      score += 25;
    } else if (keywordsLower.includes(token)) {
      score += 15;
    } else {
      score += 5;
    }
  }
  return score;
};

export const filterCommandPaletteItems = (
  items: CommandPaletteItem[],
  query: string,
): CommandPaletteItem[] => {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return items;
  }

  return items
    .map((item, index) => ({ item, score: scoreMatch(item, tokens), index }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
};

export const buildDevicePaletteItems = (devices: DeviceInfo[]): CommandPaletteItem[] =>
  devices.map((device) => {
    const serial = device.summary.serial;
    const model = device.detail?.model || device.summary.model || device.detail?.device_name || "";
    const platform = device.summary.platform ?? "android";
    const api = device.detail?.api_level ? `API ${device.detail.api_level}` : "";
    const subtitleParts = [serial, platform.toUpperCase(), device.summary.state, api].filter(Boolean);
    return {
      id: `device:${serial}`,
      category: "device",
      title: model ? `${model} (${serial})` : serial,
      subtitle: subtitleParts.join(" · "),
      keywords: [serial, model, platform, device.summary.state, device.detail?.brand ?? "", api].filter(Boolean),
    };
  });

export const buildRecentTaskPaletteItems = (tasks: TaskItem[], limit = 8): CommandPaletteItem[] =>
  tasks.slice(0, limit).map((task) => ({
    id: `task:${task.id}`,
    category: "task",
    title: task.title,
    subtitle: `${task.status} · ${Object.keys(task.devices).length} device(s)`,
    keywords: [task.kind, task.status, task.trace_id ?? "", ...Object.keys(task.devices)].filter(Boolean),
  }));
