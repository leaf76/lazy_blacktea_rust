import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  APP_ERROR_RECORDED_EVENT,
  ERROR_RECORDS_STORAGE_KEY,
  parseStoredErrorState,
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

describe("api error reporting", () => {
  let prevTauriInternals: unknown;

  beforeEach(() => {
    prevTauriInternals = (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.stubGlobal("window", createMockWindow());
    vi.stubGlobal("crypto", { randomUUID: () => "trace-123" });
    window.localStorage.clear();
    (invoke as unknown as { mockReset: () => void }).mockReset();
  });

  afterEach(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (prevTauriInternals == null) {
      delete g.__TAURI_INTERNALS__;
    } else {
      g.__TAURI_INTERNALS__ = prevTauriInternals;
    }
  });

  it("records rejected tauri calls by default", async () => {
    const invokeMock = invoke as unknown as {
      mockRejectedValue: (value: unknown) => void;
    };
    invokeMock.mockRejectedValue({
      error: "ADB missing",
      code: "ERR_DEPENDENCY",
      trace_id: "trace-123",
    });
    const listener = vi.fn();
    window.addEventListener(APP_ERROR_RECORDED_EVENT, listener as EventListener);

    const { checkAdb } = await import("./api");
    await expect(checkAdb()).rejects.toMatchObject({ code: "ERR_DEPENDENCY" });

    const parsed = parseStoredErrorState(window.localStorage.getItem(ERROR_RECORDS_STORAGE_KEY) ?? "");
    expect(parsed?.items[0]).toMatchObject({
      title: "ADB Check",
      source: "adb.check",
      code: "ERR_DEPENDENCY",
      trace_id: "trace-123",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(APP_ERROR_RECORDED_EVENT, listener as EventListener);
  });

  it("supports opt-out for task-backed calls", async () => {
    const invokeMock = invoke as unknown as {
      mockRejectedValue: (value: unknown) => void;
    };
    invokeMock.mockRejectedValue({
      error: "UI capture failed",
      code: "ERR_DEPENDENCY",
      trace_id: "trace-123",
    });

    const { captureUiHierarchy } = await import("./api");
    await expect(captureUiHierarchy("serial-1", { recordError: false })).rejects.toMatchObject({
      code: "ERR_DEPENDENCY",
    });

    const parsed = parseStoredErrorState(window.localStorage.getItem(ERROR_RECORDS_STORAGE_KEY) ?? "");
    expect(parsed).toBeNull();
  });
});
