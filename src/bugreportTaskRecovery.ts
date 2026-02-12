import type { TaskItem, TaskKind } from "./tasks";

export function findMostRecentTaskId(tasks: TaskItem[], kind: TaskKind): string | null {
  const candidates = tasks.filter((task) => task.kind === kind);
  if (!candidates.length) {
    return null;
  }
  return candidates.reduce((best, task) => (task.started_at > best.started_at ? task : best)).id;
}

export function findMostRecentRunningTaskId(tasks: TaskItem[], kind: TaskKind): string | null {
  const candidates = tasks.filter((task) => {
    if (task.kind !== kind) {
      return false;
    }
    if (task.status === "running") {
      return true;
    }
    // Be tolerant to slightly inconsistent states.
    return Object.values(task.devices).some((entry) => entry.status === "running");
  });
  if (!candidates.length) {
    return null;
  }
  return candidates.reduce((best, task) => (task.started_at > best.started_at ? task : best)).id;
}

export function resolveBugreportPanelTaskId(tasks: TaskItem[], preferredId: string | null): string | null {
  if (preferredId && tasks.some((task) => task.id === preferredId && task.kind === "bugreport")) {
    return preferredId;
  }
  return findMostRecentRunningTaskId(tasks, "bugreport") ?? findMostRecentTaskId(tasks, "bugreport");
}

export function findRunningBugreportTaskIdForSerial(tasks: TaskItem[], serial: string): string | null {
  const candidates = tasks.filter((task) => {
    if (task.kind !== "bugreport") {
      return false;
    }
    const entry = task.devices[serial];
    if (!entry) {
      return false;
    }
    // For event routing, we care about tasks that still have work for this device.
    return entry.status === "running" || task.status === "running";
  });
  if (!candidates.length) {
    return null;
  }
  return candidates.reduce((best, task) => (task.started_at > best.started_at ? task : best)).id;
}

