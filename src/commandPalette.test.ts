import { describe, expect, it } from "vitest";
import {
  buildDevicePaletteItems,
  buildRecentTaskPaletteItems,
  filterCommandPaletteItems,
  isEditableKeyboardTarget,
  type CommandPaletteItem,
} from "./commandPalette";
import type { DeviceInfo } from "./types";
import type { TaskItem } from "./tasks";

describe("commandPalette", () => {
  it("detects editable targets cleanly", () => {
    expect(isEditableKeyboardTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isEditableKeyboardTarget(null)).toBe(false);
  });

  it("ranks title prefix matches ahead of keyword matches", () => {
    const items: CommandPaletteItem[] = [
      { id: "1", category: "navigation", title: "Settings", keywords: ["logcat"] },
      { id: "2", category: "navigation", title: "Logcat Viewer", keywords: ["logs"] },
      { id: "3", category: "action", title: "Clear Logcat Buffer" },
    ];
    const results = filterCommandPaletteItems(items, "logcat");
    expect(results.map((item) => item.id)).toEqual(["2", "3", "1"]);
  });

  it("builds palette items for live devices and recent tasks", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "SER-99", state: "device", model: "Pixel 8", platform: "android" },
        detail: { serial: "SER-99", model: "Pixel 8", api_level: "34", brand: "Google" },
      },
    ];
    const deviceItems = buildDevicePaletteItems(devices);
    expect(deviceItems).toHaveLength(1);
    expect(deviceItems[0].id).toBe("device:SER-99");
    expect(deviceItems[0].subtitle).toContain("API 34");

    const tasks: TaskItem[] = [
      {
        id: "t-1",
        kind: "apk_install",
        title: "APK Install: demo.apk",
        status: "success",
        started_at: Date.now(),
        finished_at: Date.now(),
        devices: { "SER-99": { serial: "SER-99", status: "success", progress: 100, message: "Installed." } },
      },
    ];
    const taskItems = buildRecentTaskPaletteItems(tasks);
    expect(taskItems).toHaveLength(1);
    expect(taskItems[0].id).toBe("task:t-1");
  });
});
