import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

describe("api device utilities", () => {
  let prevTauriInternals: unknown;

  beforeEach(() => {
    prevTauriInternals = (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.stubGlobal("crypto", { randomUUID: () => "trace-util-1" });
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

  it("invokes ADB server, root, buffer size, DCIM pull, and DiscoveryService dump commands", async () => {
    const invokeMock = invoke as unknown as { mockResolvedValue: (value: unknown) => void };
    invokeMock.mockResolvedValue({ trace_id: "trace-util-1", data: [] });

    const {
      adbServerControl,
      adbRootDevices,
      setLogcatBufferSize,
      pullDeviceDcimBatch,
      exportDiscoveryServiceDump,
    } = await import("./api");

    await adbServerControl("restart");
    expect(invoke).toHaveBeenCalledWith(
      "adb_server_control",
      expect.objectContaining({ action: "restart", trace_id: "trace-util-1", traceId: "trace-util-1" }),
    );

    await adbRootDevices(["SER-1"]);
    expect(invoke).toHaveBeenCalledWith(
      "adb_root_devices",
      expect.objectContaining({ serials: ["SER-1"] }),
    );

    await setLogcatBufferSize(["SER-1"], "16M");
    expect(invoke).toHaveBeenCalledWith(
      "set_logcat_buffer_size",
      expect.objectContaining({ serials: ["SER-1"], size: "16M" }),
    );

    await pullDeviceDcimBatch(["SER-1"], "/tmp/out");
    expect(invoke).toHaveBeenCalledWith(
      "pull_device_dcim_batch",
      expect.objectContaining({ serials: ["SER-1"], output_dir: "/tmp/out", outputDir: "/tmp/out" }),
    );

    await exportDiscoveryServiceDump(["SER-1"], "/tmp/out");
    expect(invoke).toHaveBeenCalledWith(
      "export_discovery_service_dump",
      expect.objectContaining({ serials: ["SER-1"], output_dir: "/tmp/out", outputDir: "/tmp/out" }),
    );
  });
});
