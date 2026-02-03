import { describe, expect, it } from "vitest";
import {
  createInitialTaskState,
  createTask,
  inflateStoredTaskState,
  parseStoredTaskState,
  sanitizeTaskStateForStorage,
  tasksReducer,
} from "./tasks";

describe("tasksReducer", () => {
  it("adds tasks and trims to max", () => {
    const state = createInitialTaskState(2);
    const t1 = createTask({ id: "1", kind: "shell", title: "Shell", serials: ["A"] });
    const t2 = createTask({ id: "2", kind: "shell", title: "Shell", serials: ["A"] });
    const t3 = createTask({ id: "3", kind: "shell", title: "Shell", serials: ["A"] });

    const next1 = tasksReducer(state, { type: "TASK_ADD", task: t1 });
    const next2 = tasksReducer(next1, { type: "TASK_ADD", task: t2 });
    const next3 = tasksReducer(next2, { type: "TASK_ADD", task: t3 });

    expect(next3.items.map((t) => t.id)).toEqual(["3", "2"]);
  });

  it("updates device status and keeps other devices", () => {
    const state = createInitialTaskState();
    const task = createTask({ id: "1", kind: "apk_install", title: "Install", serials: ["A", "B"] });
    const next = tasksReducer({ ...state, items: [task] }, {
      type: "TASK_UPDATE_DEVICE",
      id: "1",
      serial: "A",
      patch: { status: "success", output_path: "/tmp/out.apk" },
    });

    expect(next.items[0].devices.A.status).toBe("success");
    expect(next.items[0].devices.A.output_path).toBe("/tmp/out.apk");
    expect(next.items[0].devices.B.status).toBe("running");
  });

  it("clears completed but keeps running", () => {
    const t1 = createTask({ id: "1", kind: "shell", title: "Shell", serials: ["A"] });
    const t2 = createTask({ id: "2", kind: "shell", title: "Shell", serials: ["A"] });
    const state = createInitialTaskState();
    const withTasks = { ...state, items: [t1, t2] };
    const completed = tasksReducer(withTasks, { type: "TASK_SET_STATUS", id: "1", status: "success" });
    const cleared = tasksReducer(completed, { type: "TASK_CLEAR_COMPLETED" });
    expect(cleared.items.map((t) => t.id)).toEqual(["2"]);
  });

  it("sanitizes and inflates stored tasks", () => {
    const state = createInitialTaskState();
    const longMessage = "x".repeat(500);
    const task = createTask({ id: "1", kind: "shell", title: "Shell title", serials: ["A"] });
    const withMessage = tasksReducer({ ...state, items: [task] }, {
      type: "TASK_UPDATE_DEVICE",
      id: "1",
      serial: "A",
      patch: { status: "success", message: longMessage, stdout: "y".repeat(50_000) },
    });
    const stored = sanitizeTaskStateForStorage(withMessage);
    expect(stored.items[0].devices.A.message?.length).toBeLessThanOrEqual(240);

    const parsed = parseStoredTaskState(JSON.stringify(stored));
    expect(parsed).not.toBeNull();
    const inflated = inflateStoredTaskState(parsed!, 50);
    expect(inflated.items[0].devices.A.stdout ?? null).toBeNull();
  });
});
