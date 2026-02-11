import { describe, expect, it } from "vitest";
import { createTask, tasksReducer } from "./tasks";
import { buildDesktopNotificationForTask, detectNewlyCompletedTasks } from "./taskNotificationRules";

describe("detectNewlyCompletedTasks", () => {
  it("detects running -> success transition", () => {
    const t1 = createTask({ id: "1", kind: "shell", title: "Shell", serials: ["A"] });
    const prev = [t1];
    const next = [tasksReducer({ items: [t1], max_items: 50 }, { type: "TASK_SET_STATUS", id: "1", status: "success" }).items[0]];

    const completed = detectNewlyCompletedTasks(prev, next);
    expect(completed.map((t) => t.id)).toEqual(["1"]);
  });

  it("ignores tasks that did not exist previously", () => {
    const prev: ReturnType<typeof createTask>[] = [];
    const next = [createTask({ id: "1", kind: "shell", title: "Shell", serials: ["A"] })];
    const completed = detectNewlyCompletedTasks(prev, next);
    expect(completed).toEqual([]);
  });

  it("ignores tasks that were already completed", () => {
    const t1 = createTask({ id: "1", kind: "shell", title: "Shell", serials: ["A"] });
    const completedTask = tasksReducer({ items: [t1], max_items: 50 }, { type: "TASK_SET_STATUS", id: "1", status: "error" }).items[0];
    const prev = [completedTask];
    const next = [completedTask];
    expect(detectNewlyCompletedTasks(prev, next)).toEqual([]);
  });
});

describe("buildDesktopNotificationForTask", () => {
  it("returns null for running tasks", () => {
    const t1 = createTask({ id: "1", kind: "shell", title: "Shell", serials: ["A"] });
    expect(buildDesktopNotificationForTask(t1)).toBeNull();
  });

  it("builds a compact notification for completed tasks", () => {
    const t1 = createTask({ id: "1", kind: "shell", title: "Shell", serials: ["A", "B"] });
    const done = tasksReducer({ items: [t1], max_items: 50 }, { type: "TASK_SET_STATUS", id: "1", status: "success" }).items[0];
    const notif = buildDesktopNotificationForTask(done);
    expect(notif).not.toBeNull();
    expect(notif!.title).toBe("Shell");
    expect(notif!.body).toContain("Check Task Center");
    expect(notif!.body).toContain("2 devices");
  });
});
