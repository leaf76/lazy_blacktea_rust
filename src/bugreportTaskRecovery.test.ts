import { describe, expect, it } from "vitest";
import { createTask } from "./tasks";
import {
  findMostRecentRunningTaskId,
  findMostRecentTaskId,
  findRunningBugreportTaskIdForSerial,
  resolveBugreportPanelTaskId,
} from "./bugreportTaskRecovery";

describe("bugreportTaskRecovery", () => {
  it("returns null when no matching tasks exist", () => {
    expect(findMostRecentTaskId([], "bugreport")).toBeNull();
    expect(findMostRecentRunningTaskId([], "bugreport")).toBeNull();
    expect(resolveBugreportPanelTaskId([], null)).toBeNull();
  });

  it("prefers the preferred bugreport task id when it exists", () => {
    const t1 = { ...createTask({ id: "1", kind: "bugreport", title: "Bugreport", serials: ["A"] }), started_at: 10 };
    const t2 = { ...createTask({ id: "2", kind: "bugreport", title: "Bugreport", serials: ["A"] }), started_at: 20 };
    const resolved = resolveBugreportPanelTaskId([t2, t1], "1");
    expect(resolved).toBe("1");
  });

  it("falls back to most recent running bugreport task id", () => {
    const done = { ...createTask({ id: "1", kind: "bugreport", title: "Bugreport", serials: ["A"] }), started_at: 10, status: "success" as const };
    const running = { ...createTask({ id: "2", kind: "bugreport", title: "Bugreport", serials: ["A"] }), started_at: 20 };
    const resolved = resolveBugreportPanelTaskId([done, running], null);
    expect(resolved).toBe("2");
  });

  it("finds running bugreport task id by device serial", () => {
    const task = createTask({ id: "1", kind: "bugreport", title: "Bugreport", serials: ["A", "B"] });
    const other = createTask({ id: "2", kind: "apk_install", title: "Install", serials: ["A"] });
    const resolved = findRunningBugreportTaskIdForSerial([other, task], "A");
    expect(resolved).toBe("1");
  });
});

