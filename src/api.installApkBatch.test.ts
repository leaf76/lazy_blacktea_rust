import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

describe("api.installApkBatch", () => {
  let prevTauriInternals: unknown;

  beforeEach(() => {
    prevTauriInternals = (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.stubGlobal("crypto", { randomUUID: () => "trace-123" });
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

  it("sends both snake_case and camelCase keys for Tauri command args", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: null });

    const { installApkBatch } = await import("./api");
    await installApkBatch(
      ["emulator-5554"],
      "/tmp/app-debug.apk",
      true,
      false,
      true,
      false,
      "--foo bar",
    );

    expect(invoke).toHaveBeenCalledWith(
      "install_apk_batch",
      expect.objectContaining({
        serials: ["emulator-5554"],
        apk_path: "/tmp/app-debug.apk",
        apkPath: "/tmp/app-debug.apk",
        replace: true,
        allow_downgrade: false,
        allowDowngrade: false,
        grant: true,
        allow_test_packages: false,
        allowTestPackages: false,
        extra_args: "--foo bar",
        extraArgs: "--foo bar",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });
});
