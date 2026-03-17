export const ERROR_RECORDS_STORAGE_KEY = "lazy_blacktea_errors_v1";
export const ERROR_RECORDS_MAX_ITEMS = 200;
export const APP_ERROR_RECORDED_EVENT = "lazy_blacktea:error-recorded";

export type ErrorRecord = {
  id: string;
  title: string;
  source: string;
  message: string;
  code: string | null;
  trace_id: string | null;
  serial: string | null;
  route: string | null;
  created_at: number;
};

export type ErrorState = {
  items: ErrorRecord[];
  max_items: number;
};

export type StoredErrorState = {
  items: ErrorRecord[];
  max_items: number;
};

export type StructuredErrorDetails = {
  message: string;
  code: string | null;
  trace_id: string | null;
};

export type ErrorRecordInput = {
  title: string;
  source: string;
  error?: unknown;
  message?: string | null;
  code?: string | null;
  trace_id?: string | null;
  serial?: string | null;
  route?: string | null;
};

export type ErrorAction =
  | { type: "ERROR_ADD"; record: ErrorRecord }
  | { type: "ERROR_SET_ALL"; items: ErrorRecord[]; max_items?: number }
  | { type: "ERROR_CLEAR" };

const DEFAULT_ERROR_MESSAGE = "Unexpected error";

const clampString = (value: string, maxLen: number) => {
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLen - 1))}…`;
};

const normalizeOptionalString = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
};

const resolveRoute = () => {
  if (typeof window === "undefined") {
    return null;
  }
  const hash = window.location.hash.trim();
  if (hash.startsWith("#")) {
    const route = hash.slice(1).trim();
    return route || "/";
  }
  const pathname = window.location.pathname.trim();
  return pathname || "/";
};

export const createInitialErrorState = (maxItems = ERROR_RECORDS_MAX_ITEMS): ErrorState => ({
  items: [],
  max_items: maxItems,
});

export const normalizeStructuredError = (error: unknown): StructuredErrorDetails => {
  if (typeof error === "string") {
    return { message: error || DEFAULT_ERROR_MESSAGE, code: null, trace_id: null };
  }
  if (error && typeof error === "object" && "error" in error) {
    const payload = error as {
      error?: unknown;
      code?: unknown;
      trace_id?: unknown;
    };
    const message =
      typeof payload.error === "string" && payload.error.trim() ? payload.error.trim() : DEFAULT_ERROR_MESSAGE;
    return {
      message,
      code: typeof payload.code === "string" && payload.code.trim() ? payload.code.trim() : null,
      trace_id:
        typeof payload.trace_id === "string" && payload.trace_id.trim() ? payload.trace_id.trim() : null,
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message.trim() || DEFAULT_ERROR_MESSAGE,
      code: null,
      trace_id: null,
    };
  }
  return { message: DEFAULT_ERROR_MESSAGE, code: null, trace_id: null };
};

export const createErrorRecord = (
  input: ErrorRecordInput,
  options: { id?: string; created_at?: number } = {},
): ErrorRecord => {
  const structured = input.error !== undefined ? normalizeStructuredError(input.error) : null;
  const title = clampString(input.title.trim() || "Application Error", 160);
  const source = clampString(input.source.trim() || "application", 120);
  const message = clampString(
    normalizeOptionalString(input.message) ?? structured?.message ?? DEFAULT_ERROR_MESSAGE,
    1200,
  );
  return {
    id: options.id ?? crypto.randomUUID(),
    title,
    source,
    message,
    code: normalizeOptionalString(input.code) ?? structured?.code ?? null,
    trace_id: normalizeOptionalString(input.trace_id) ?? structured?.trace_id ?? null,
    serial: normalizeOptionalString(input.serial),
    route: normalizeOptionalString(input.route) ?? resolveRoute(),
    created_at: options.created_at ?? Date.now(),
  };
};

export const errorRecordsReducer = (state: ErrorState, action: ErrorAction): ErrorState => {
  if (action.type === "ERROR_ADD") {
    return {
      ...state,
      items: [action.record, ...state.items].slice(0, state.max_items),
    };
  }
  if (action.type === "ERROR_SET_ALL") {
    const maxItems = action.max_items ?? state.max_items;
    return {
      items: action.items.slice(0, maxItems),
      max_items: maxItems,
    };
  }
  if (action.type === "ERROR_CLEAR") {
    return {
      ...state,
      items: [],
    };
  }
  return state;
};

export const sanitizeErrorStateForStorage = (state: ErrorState): StoredErrorState => {
  const maxItems = Math.max(1, Math.min(ERROR_RECORDS_MAX_ITEMS, state.max_items));
  const items = state.items.slice(0, maxItems).map((item) => ({
    id: item.id,
    title: clampString(item.title, 160),
    source: clampString(item.source, 120),
    message: clampString(item.message, 1200),
    code: item.code ? clampString(item.code, 80) : null,
    trace_id: item.trace_id ? clampString(item.trace_id, 120) : null,
    serial: item.serial ? clampString(item.serial, 120) : null,
    route: item.route ? clampString(item.route, 240) : null,
    created_at: item.created_at,
  }));
  return { items, max_items: maxItems };
};

export const parseStoredErrorState = (raw: string): StoredErrorState | null => {
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
        typeof item.source === "string" &&
        typeof item.message === "string" &&
        typeof item.created_at === "number"
      );
    }) as ErrorRecord[];
    return {
      items,
      max_items: record.max_items,
    };
  } catch {
    return null;
  }
};

export const inflateStoredErrorState = (
  stored: StoredErrorState,
  fallbackMaxItems = ERROR_RECORDS_MAX_ITEMS,
): ErrorState => {
  const maxItems =
    typeof stored.max_items === "number" ? Math.max(1, Math.min(ERROR_RECORDS_MAX_ITEMS, stored.max_items)) : fallbackMaxItems;
  const items = stored.items.slice(0, maxItems).map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    message: item.message,
    code: normalizeOptionalString(item.code),
    trace_id: normalizeOptionalString(item.trace_id),
    serial: normalizeOptionalString(item.serial),
    route: normalizeOptionalString(item.route),
    created_at: item.created_at,
  }));
  return { items, max_items: maxItems };
};

export const appendErrorRecordToStorage = (record: ErrorRecord) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const raw = window.localStorage.getItem(ERROR_RECORDS_STORAGE_KEY);
    const parsed = raw ? parseStoredErrorState(raw) : null;
    const current = parsed ? inflateStoredErrorState(parsed) : createInitialErrorState();
    const next = errorRecordsReducer(current, { type: "ERROR_ADD", record });
    window.localStorage.setItem(
      ERROR_RECORDS_STORAGE_KEY,
      JSON.stringify(sanitizeErrorStateForStorage(next)),
    );
  } catch (error) {
    console.warn("Failed to persist error records.", error);
  }
};

export const emitRecordedErrorEvent = (record: ErrorRecord) => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ErrorRecord>(APP_ERROR_RECORDED_EVENT, {
      detail: record,
    }),
  );
};

export const recordExternalAppError = (input: ErrorRecordInput): ErrorRecord => {
  const record = createErrorRecord(input);
  appendErrorRecordToStorage(record);
  emitRecordedErrorEvent(record);
  return record;
};
