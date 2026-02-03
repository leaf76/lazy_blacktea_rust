export type TaskKind =
  | "shell"
  | "apk_install"
  | "bugreport"
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
