import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_ERROR_RECORDED_EVENT,
  ERROR_RECORDS_MAX_ITEMS,
  ERROR_RECORDS_STORAGE_KEY,
  appendErrorRecordToStorage,
  createErrorRecord,
  createInitialErrorState,
  errorRecordsReducer,
  inflateStoredErrorState,
  normalizeStructuredError,
  parseStoredErrorState,
  recordExternalAppError,
  sanitizeErrorStateForStorage,
} from "./errorRecords";

const createMockWindow = () => {
  const storage = new Map<string, string>();
  const target = new EventTarget();
  return Object.assign(target, {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    },
    location: {
      hash: "#/devices",
      pathname: "/devices",
    },
    dispatchEvent: target.dispatchEvent.bind(target),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  });
};

describe("normalizeStructuredError", () => {
  it("extracts message, code, and trace id from tauri payloads", () => {
    expect(
      normalizeStructuredError({
        error: "Capture failed",
        code: "ERR_DEPENDENCY",
        trace_id: "trace-123",
      }),
    ).toEqual({
      message: "Capture failed",
      code: "ERR_DEPENDENCY",
      trace_id: "trace-123",
    });
  });

  it("handles Error instances and strings", () => {
    expect(normalizeStructuredError(new Error("Boom"))).toEqual({
      message: "Boom",
      code: null,
      trace_id: null,
    });
    expect(normalizeStructuredError("Nope")).toEqual({
      message: "Nope",
      code: null,
      trace_id: null,
    });
  });
});

describe("errorRecordsReducer", () => {
  it("adds newest records first and trims to max size", () => {
    const state = createInitialErrorState(2);
    const next1 = errorRecordsReducer(state, {
      type: "ERROR_ADD",
      record: createErrorRecord({ title: "One", source: "test.one", message: "1" }, { id: "1", created_at: 1 }),
    });
    const next2 = errorRecordsReducer(next1, {
      type: "ERROR_ADD",
      record: createErrorRecord({ title: "Two", source: "test.two", message: "2" }, { id: "2", created_at: 2 }),
    });
    const next3 = errorRecordsReducer(next2, {
      type: "ERROR_ADD",
      record: createErrorRecord({ title: "Three", source: "test.three", message: "3" }, { id: "3", created_at: 3 }),
    });

    expect(next3.items.map((item) => item.id)).toEqual(["3", "2"]);
  });

  it("clears items", () => {
    const state = errorRecordsReducer(createInitialErrorState(), {
      type: "ERROR_ADD",
      record: createErrorRecord({ title: "One", source: "test.one", message: "1" }, { id: "1", created_at: 1 }),
    });
    expect(errorRecordsReducer(state, { type: "ERROR_CLEAR" }).items).toEqual([]);
  });
});

describe("error record storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", createMockWindow());
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("sanitizes, parses, and inflates stored state", () => {
    const state = createInitialErrorState();
    const filled = errorRecordsReducer(state, {
      type: "ERROR_ADD",
      record: createErrorRecord(
        {
          title: "A".repeat(200),
          source: "source",
          message: "B".repeat(1400),
          trace_id: "trace-1",
        },
        { id: "1", created_at: 1 },
      ),
    });
    const stored = sanitizeErrorStateForStorage(filled);
    const raw = JSON.stringify(stored);
    const parsed = parseStoredErrorState(raw);
    expect(parsed).not.toBeNull();
    const inflated = inflateStoredErrorState(parsed!);
    expect(inflated.items[0].title.length).toBeLessThanOrEqual(160);
    expect(inflated.items[0].message.length).toBeLessThanOrEqual(1200);
  });

  it("appends to localStorage", () => {
    appendErrorRecordToStorage(
      createErrorRecord({ title: "Stored", source: "storage.test", message: "Oops" }, { id: "stored-1", created_at: 1 }),
    );
    const parsed = parseStoredErrorState(window.localStorage.getItem(ERROR_RECORDS_STORAGE_KEY) ?? "");
    expect(parsed?.items[0]?.id).toBe("stored-1");
  });

  it("records external errors to storage and emits window events", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "error-1" });
    const listener = vi.fn();
    window.addEventListener(APP_ERROR_RECORDED_EVENT, listener as EventListener);

    const record = recordExternalAppError({
      title: "Check ADB",
      source: "adb.check",
      error: { error: "ADB missing", code: "ERR_DEPENDENCY", trace_id: "trace-9" },
      serial: "device-1",
      route: "/devices",
    });

    const parsed = parseStoredErrorState(window.localStorage.getItem(ERROR_RECORDS_STORAGE_KEY) ?? "");
    expect(record.id).toBe("error-1");
    expect(parsed?.items[0]?.trace_id).toBe("trace-9");
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(APP_ERROR_RECORDED_EVENT, listener as EventListener);
  });

  it("caps stored errors at the configured maximum", () => {
    const state = createInitialErrorState(ERROR_RECORDS_MAX_ITEMS);
    let next = state;
    for (let index = 0; index < ERROR_RECORDS_MAX_ITEMS + 5; index += 1) {
      next = errorRecordsReducer(next, {
        type: "ERROR_ADD",
        record: createErrorRecord(
          { title: `Error ${index}`, source: "cap.test", message: "x" },
          { id: `id-${index}`, created_at: index },
        ),
      });
    }
    expect(next.items).toHaveLength(ERROR_RECORDS_MAX_ITEMS);
    expect(next.items[0].id).toBe(`id-${ERROR_RECORDS_MAX_ITEMS + 4}`);
  });
});
