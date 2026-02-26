import { describe, expect, it } from "vitest";
import { createTask } from "./tasks";
import {
  buildBugreportDeviceCards,
  getBugreportGenerateLabel,
  summarizeBugreportCards,
} from "./bugreportPage";
import type { DeviceInfo } from "./types";

const makeDevices = (): DeviceInfo[] => [
  {
    summary: { serial: "A", state: "device", model: "Pixel 8" },
    detail: { serial: "A", model: "Pixel 8 Pro" },
  },
  {
    summary: { serial: "B", state: "offline", model: "Galaxy S24" },
    detail: null,
  },
  {
    summary: { serial: "C", state: "device", model: null },
    detail: null,
  },
];

describe("bugreportPage helpers", () => {
  it("builds idle cards from selected serials without duplicates", () => {
    const cards = buildBugreportDeviceCards(["A", "B", "A"], makeDevices(), null);
    expect(cards.map((item) => item.serial)).toEqual(["A", "B"]);
    expect(cards[0].status).toBe("idle");
    expect(cards[0].display_name).toBe("Pixel 8 Pro");
    expect(cards[1].status).toBe("idle");
    expect(cards[1].online).toBe(false);
  });

  it("maps latest task device states into cards and computes summary", () => {
    const task = createTask({
      id: "task-1",
      kind: "bugreport",
      title: "Bugreport",
      serials: ["A", "B"],
      started_at: 100,
    });
    task.devices.A = {
      ...task.devices.A,
      status: "success",
      progress: null,
      output_path: "/tmp/A.zip",
      message: "Bugreport completed.",
    };
    task.devices.B = {
      ...task.devices.B,
      status: "error",
      progress: null,
      message: "device unauthorized",
    };

    const cards = buildBugreportDeviceCards(["A", "B", "C"], makeDevices(), task);
    expect(cards.map((item) => item.status)).toEqual(["success", "error", "idle"]);
    expect(cards[0].progress).toBe(100);
    expect(cards[0].output_path).toBe("/tmp/A.zip");
    expect(cards[1].message).toBe("device unauthorized");

    const summary = summarizeBugreportCards(cards);
    expect(summary.selected).toBe(3);
    expect(summary.online).toBe(2);
    expect(summary.offline).toBe(1);
    expect(summary.success).toBe(1);
    expect(summary.error).toBe(1);
    expect(summary.idle).toBe(1);
    expect(summary.running).toBe(0);
    expect(summary.has_failures).toBe(true);
    expect(summary.has_outputs).toBe(true);
  });

  it("renders batch button labels from selected/running counts", () => {
    expect(getBugreportGenerateLabel(0, 0)).toBe("Generate Bugreport");
    expect(getBugreportGenerateLabel(2, 0)).toBe("Generate Bugreport (2)");
    expect(getBugreportGenerateLabel(5, 3)).toBe("Generating Bugreports (3/5)...");
  });
});
