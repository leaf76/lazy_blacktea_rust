import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

describe("api command args compatibility", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "trace-123" });
    (invoke as unknown as { mockReset: () => void }).mockReset();
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
});

