export type TaskKind =
  | "shell"
  | "apk_install"
  | "bugreport"
  | "screenshot"
  | "screen_record_start"
  | "screen_record_stop"
  | "file_pull"
  | "file_push"
  | "file_mkdir"
  | "file_rename"
  | "file_delete";

export type TaskStatus = "running" | "success" | "error" | "cancelled";

export type DeviceTaskStatus = {
  serial: string;
  status: TaskStatus;
  progress?: number | null;
  message?: string | null;
  output_path?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  exit_code?: number | null;
};

export type TaskItem = {
  id: string;
  trace_id?: string | null;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  started_at: number;
  finished_at?: number | null;
  devices: Record<string, DeviceTaskStatus>;
};

export type TaskState = {
  items: TaskItem[];
  max_items: number;
};

export const createInitialTaskState = (maxItems = 50): TaskState => ({
  items: [],
  max_items: maxItems,
});

export type TaskAction =
  | { type: "TASK_ADD"; task: TaskItem }
  | { type: "TASK_SET_ALL"; items: TaskItem[]; max_items?: number }
  | {
      type: "TASK_SET_TRACE";
      id: string;
      trace_id: string;
    }
  | {
      type: "TASK_SET_STATUS";
      id: string;
      status: TaskStatus;
      finished_at?: number;
    }
  | {
      type: "TASK_UPDATE_DEVICE";
      id: string;
      serial: string;
      patch: Partial<DeviceTaskStatus>;
    }
  | { type: "TASK_CLEAR_COMPLETED" };

export const tasksReducer = (state: TaskState, action: TaskAction): TaskState => {
  if (action.type === "TASK_ADD") {
    const next = [action.task, ...state.items];
    return { ...state, items: next.slice(0, state.max_items) };
  }
  if (action.type === "TASK_SET_ALL") {
    const maxItems = action.max_items ?? state.max_items;
    return {
      ...state,
      max_items: maxItems,
      items: action.items.slice(0, maxItems),
    };
  }
  if (action.type === "TASK_SET_TRACE") {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === action.id ? { ...item, trace_id: action.trace_id } : item,
      ),
    };
  }
  if (action.type === "TASK_SET_STATUS") {
    const finishedAt = action.finished_at ?? Date.now();
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === action.id
          ? { ...item, status: action.status, finished_at: finishedAt }
          : item,
      ),
    };
  }
  if (action.type === "TASK_UPDATE_DEVICE") {
    return {
      ...state,
      items: state.items.map((item) => {
        if (item.id !== action.id) {
          return item;
        }
        const current = item.devices[action.serial] ?? {
          serial: action.serial,
          status: "running" as TaskStatus,
        };
        return {
          ...item,
          devices: {
            ...item.devices,
            [action.serial]: { ...current, ...action.patch, serial: action.serial },
          },
        };
      }),
    };
  }
  if (action.type === "TASK_CLEAR_COMPLETED") {
    return {
      ...state,
      items: state.items.filter((item) => item.status === "running"),
    };
  }
  return state;
};

export const createTask = (params: {
  id: string;
  kind: TaskKind;
  title: string;
  serials: string[];
  trace_id?: string | null;
  started_at?: number;
}): TaskItem => {
  const startedAt = params.started_at ?? Date.now();
  const devices: Record<string, DeviceTaskStatus> = {};
  params.serials.forEach((serial) => {
    devices[serial] = { serial, status: "running" };
  });
  return {
    id: params.id,
    trace_id: params.trace_id ?? null,
    kind: params.kind,
    title: params.title,
    status: "running",
    started_at: startedAt,
    devices,
    finished_at: null,
  };
};

export const summarizeTask = (task: TaskItem) => {
  const serials = Object.keys(task.devices);
  const counts = { running: 0, success: 0, error: 0, cancelled: 0 } as Record<TaskStatus, number>;
  serials.forEach((serial) => {
    const status = task.devices[serial]?.status ?? "running";
    counts[status] += 1;
  });
  return { serials, counts };
};

export type StoredDeviceTaskStatus = {
  serial: string;
  status: TaskStatus;
  message?: string | null;
  output_path?: string | null;
  exit_code?: number | null;
};

export type StoredTaskItem = {
  id: string;
  trace_id?: string | null;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  started_at: number;
  finished_at?: number | null;
  devices: Record<string, StoredDeviceTaskStatus>;
};

export type StoredTaskState = {
  max_items: number;
  items: StoredTaskItem[];
};

const truncateString = (value: string, maxLen: number) => {
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLen - 1))}…`;
};

export const sanitizeTaskStateForStorage = (state: TaskState): StoredTaskState => {
  const maxItems = Math.max(1, Math.min(200, state.max_items));
  const items: StoredTaskItem[] = state.items.slice(0, maxItems).map((item) => {
    const devices: Record<string, StoredDeviceTaskStatus> = {};
    Object.entries(item.devices).forEach(([serial, entry]) => {
      devices[serial] = {
        serial,
        status: entry.status,
        message: entry.message ? truncateString(entry.message, 240) : entry.message ?? null,
        output_path: entry.output_path ? truncateString(entry.output_path, 500) : entry.output_path ?? null,
        exit_code: entry.exit_code ?? null,
      };
    });
    return {
      id: item.id,
      trace_id: item.trace_id ?? null,
      kind: item.kind,
      title: truncateString(item.title, 160),
      status: item.status,
      started_at: item.started_at,
      finished_at: item.finished_at ?? null,
      devices,
    };
  });
  return { max_items: maxItems, items };
};

export const parseStoredTaskState = (raw: string): StoredTaskState | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.max_items !== "number" || !Array.isArray(record.items)) {
      return null;
    }
    const items = record.items.filter((value) => {
      if (!value || typeof value !== "object") {
        return false;
      }
      const item = value as Record<string, unknown>;
      return (
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.kind === "string" &&
        typeof item.status === "string" &&
        typeof item.started_at === "number" &&
        item.devices != null &&
        typeof item.devices === "object"
      );
    }) as StoredTaskItem[];
    return { max_items: record.max_items, items };
  } catch {
    return null;
  }
};

export const inflateStoredTaskState = (stored: StoredTaskState, fallbackMaxItems = 50): TaskState => {
  const maxItems = typeof stored.max_items === "number" ? stored.max_items : fallbackMaxItems;
  const items = stored.items.map((item) => {
    const devices: Record<string, DeviceTaskStatus> = {};
    Object.entries(item.devices || {}).forEach(([serial, entry]) => {
      devices[serial] = {
        serial,
        status: entry.status,
        message: entry.message ?? null,
        output_path: entry.output_path ?? null,
        exit_code: entry.exit_code ?? null,
        progress: null,
        stdout: null,
        stderr: null,
      };
    });
    return {
      id: item.id,
      trace_id: item.trace_id ?? null,
      kind: item.kind,
      title: item.title,
      status: item.status,
      started_at: item.started_at,
      finished_at: item.finished_at ?? null,
      devices,
    } as TaskItem;
  });
  return { max_items: maxItems, items: items.slice(0, maxItems) };
};
