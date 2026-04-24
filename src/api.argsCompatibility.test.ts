import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

describe("api command args compatibility", () => {
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

  it("sends both snake_case and camelCase keys for captureScreenshot", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: "/tmp/out.png" });

    const { captureScreenshot } = await import("./api");
    await captureScreenshot("emulator-5554", "/tmp");

    expect(invoke).toHaveBeenCalledWith(
      "capture_screenshot",
      expect.objectContaining({
        serial: "emulator-5554",
        output_dir: "/tmp",
        outputDir: "/tmp",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends both snake_case and camelCase keys for adbPair", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: null });

    const { adbPair } = await import("./api");
    await adbPair("127.0.0.1:12345", "000000");

    expect(invoke).toHaveBeenCalledWith(
      "adb_pair",
      expect.objectContaining({
        address: "127.0.0.1:12345",
        pairing_code: "000000",
        pairingCode: "000000",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends both snake_case and camelCase keys for checkAdb optional commandPath", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: null });

    const { checkAdb } = await import("./api");
    await checkAdb("/usr/local/bin/adb");

    expect(invoke).toHaveBeenCalledWith(
      "check_adb",
      expect.objectContaining({
        command_path: "/usr/local/bin/adb",
        commandPath: "/usr/local/bin/adb",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends trace args for checkIosTools", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: null });

    const { checkIosTools } = await import("./api");
    await checkIosTools();

    expect(invoke).toHaveBeenCalledWith(
      "check_ios_tools",
      expect.objectContaining({
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends both snake_case and camelCase keys for startNetProfiler pinnedUids", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: true });

    const { startNetProfiler } = await import("./api");
    await startNetProfiler("emulator-5554", 2000, 20, [1000, 1001]);

    expect(invoke).toHaveBeenCalledWith(
      "start_net_profiler",
      expect.objectContaining({
        serial: "emulator-5554",
        interval_ms: 2000,
        intervalMs: 2000,
        top_n: 20,
        topN: 20,
        pinned_uids: [1000, 1001],
        pinnedUids: [1000, 1001],
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends both snake_case and camelCase keys for setNetProfilerPinnedUids", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: true });

    const { setNetProfilerPinnedUids } = await import("./api");
    await setNetProfilerPinnedUids("emulator-5554", [1000, 1001, 1002]);

    expect(invoke).toHaveBeenCalledWith(
      "set_net_profiler_pinned_uids",
      expect.objectContaining({
        serial: "emulator-5554",
        pinned_uids: [1000, 1001, 1002],
        pinnedUids: [1000, 1001, 1002],
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends trace args for getLogcatStatus", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({
      trace_id: "trace-123",
      data: { serial: "emulator-5554", running: true },
    });

    const { getLogcatStatus } = await import("./api");
    await getLogcatStatus("emulator-5554");

    expect(invoke).toHaveBeenCalledWith(
      "get_logcat_status",
      expect.objectContaining({
        serial: "emulator-5554",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends trace args for iOS syslog commands", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: true });

    const { startIosSyslog, stopIosSyslog, getIosSyslogStatus } = await import("./api");
    await startIosSyslog("ios-udid");
    await stopIosSyslog("ios-udid");
    await getIosSyslogStatus("ios-udid");

    expect(invoke).toHaveBeenCalledWith(
      "start_ios_syslog",
      expect.objectContaining({
        serial: "ios-udid",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "stop_ios_syslog",
      expect.objectContaining({
        serial: "ios-udid",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "get_ios_syslog_status",
      expect.objectContaining({
        serial: "ios-udid",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends both snake_case and camelCase keys for exportIosCrashReports", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: { stdout: "", stderr: "" } });

    const { exportIosCrashReports } = await import("./api");
    await exportIosCrashReports("ios-udid", "/tmp/crashes");

    expect(invoke).toHaveBeenCalledWith(
      "export_ios_crash_reports",
      expect.objectContaining({
        serial: "ios-udid",
        output_dir: "/tmp/crashes",
        outputDir: "/tmp/crashes",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends trace args for getScreenRecordStatus", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({
      trace_id: "trace-123",
      data: {
        serial: "emulator-5554",
        running: false,
        backend: "adb",
        display_path: "",
        segment_count: 0,
      },
    });

    const { getScreenRecordStatus } = await import("./api");
    await getScreenRecordStatus("emulator-5554");

    expect(invoke).toHaveBeenCalledWith(
      "get_screen_record_status",
      expect.objectContaining({
        serial: "emulator-5554",
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });

  it("sends trace args for loadLegacyLogcatPresets", async () => {
    const invokeMock = invoke as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    invokeMock.mockResolvedValue({ trace_id: "trace-123", data: [] });

    const { loadLegacyLogcatPresets } = await import("./api");
    await loadLegacyLogcatPresets();

    expect(invoke).toHaveBeenCalledWith(
      "load_legacy_logcat_presets",
      expect.objectContaining({
        trace_id: "trace-123",
        traceId: "trace-123",
      }),
    );
  });
});
