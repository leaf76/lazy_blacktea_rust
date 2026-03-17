import { summarizeTask, type TaskItem, type TaskStatus } from "./tasks";

const SUPPRESSED_COMPLETION_TASK_KINDS = new Set<TaskItem["kind"]>(["ui_inspector_auto_sync"]);

export type DesktopTaskNotification = {
  taskId: string;
  status: Exclude<TaskStatus, "running">;
  title: string;
  body: string;
};

export type TaskCompletionNotice = {
  taskId: string;
  status: Exclude<TaskStatus, "running">;
  title: string;
  taskKind: TaskItem["kind"];
  statusLabel: string;
  countsLabel: string;
  body: string;
  summary: ReturnType<typeof summarizeTask>;
  outputPaths: Array<{ serial: string; path: string }>;
  traceId: string | null;
  finishedAt: number | null;
};

export const isTerminalTaskStatus = (status: TaskStatus): status is Exclude<TaskStatus, "running"> =>
  status !== "running";

export const detectNewlyCompletedTasks = (prevItems: TaskItem[], nextItems: TaskItem[]): TaskItem[] => {
  const prevStatusById = new Map<string, TaskStatus>();
  prevItems.forEach((item) => {
    prevStatusById.set(item.id, item.status);
  });

  return nextItems.filter((item) => {
    const prevStatus = prevStatusById.get(item.id);
    return prevStatus === "running" && isTerminalTaskStatus(item.status);
  });
};

const buildCountsLabel = (summary: ReturnType<typeof summarizeTask>): string => {
  const total = summary.serials.length;
  const parts: string[] = [];

  if (summary.counts.success > 0) parts.push(`${summary.counts.success} ok`);
  if (summary.counts.error > 0) parts.push(`${summary.counts.error} error`);
  if (summary.counts.cancelled > 0) parts.push(`${summary.counts.cancelled} cancelled`);
  if (summary.counts.interrupted > 0) parts.push(`${summary.counts.interrupted} interrupted`);
  if (summary.counts.running > 0) parts.push(`${summary.counts.running} running`);

  const deviceLabel = total === 1 ? "1 device" : `${total} devices`;
  const details = parts.length ? ` (${parts.join(", ")})` : "";
  return `${deviceLabel}${details}`;
};

const buildStatusLabel = (status: Exclude<TaskStatus, "running">): string => {
  if (status === "success") return "Success";
  if (status === "interrupted") return "Interrupted";
  if (status === "cancelled") return "Cancelled";
  return "Error";
};

const collectOutputPaths = (task: TaskItem): Array<{ serial: string; path: string }> => {
  return Object.entries(task.devices)
    .map(([serial, entry]) => {
      const path = entry.output_path?.trim() ?? "";
      if (!path) {
        return null;
      }
      return { serial, path };
    })
    .filter((item): item is { serial: string; path: string } => item !== null)
    .sort((left, right) => left.serial.localeCompare(right.serial));
};

export const buildDesktopNotificationForTask = (task: TaskItem): DesktopTaskNotification | null => {
  if (SUPPRESSED_COMPLETION_TASK_KINDS.has(task.kind)) {
    return null;
  }
  const payload = buildTaskCompletionNotice(task);
  if (!payload) {
    return null;
  }
  return {
    taskId: payload.taskId,
    status: payload.status,
    title: payload.title,
    body: payload.body,
  };
};

export const buildTaskCompletionNotice = (task: TaskItem): TaskCompletionNotice | null => {
  if (!isTerminalTaskStatus(task.status)) {
    return null;
  }
  if (SUPPRESSED_COMPLETION_TASK_KINDS.has(task.kind)) {
    return null;
  }

  const summary = summarizeTask(task);
  const statusLabel = buildStatusLabel(task.status);
  const countsLabel = buildCountsLabel(summary);
  const body = `${statusLabel} - ${countsLabel}. Check Task Center.`;
  const outputPaths = collectOutputPaths(task);

  return {
    taskId: task.id,
    status: task.status,
    title: task.title,
    taskKind: task.kind,
    statusLabel,
    countsLabel,
    body,
    summary,
    outputPaths,
    traceId: task.trace_id ?? null,
    finishedAt: task.finished_at ?? null,
  };
};
