import { describe, expect, it } from "vitest";

import { isTauriRuntime } from "./tauriEnv";

describe("isTauriRuntime", () => {
  it("returns false in a plain test/browser environment", () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it("returns true when a Tauri global is present", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = g.__TAURI_INTERNALS__;
    g.__TAURI_INTERNALS__ = {};

    try {
      expect(isTauriRuntime()).toBe(true);
    } finally {
      if (prev == null) {
        delete g.__TAURI_INTERNALS__;
      } else {
        g.__TAURI_INTERNALS__ = prev;
      }
    }
  });
});

