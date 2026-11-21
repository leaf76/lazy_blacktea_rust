import { describe, expect, it } from "vitest";
import {
  describeApkErrorCode,
  evaluateApkCompatibility,
  formatApkFileSize,
  formatApkInstallFailureMessage,
  parseDeviceApiLevel,
  resolveApkInstallEventPatch,
} from "./apkInspector";
import type { ApkInfo, DeviceInfo } from "./types";

const makeDevice = (serial: string, apiLevel?: string | null, model?: string): DeviceInfo => ({
  summary: {
    platform: "android",
    serial,
    state: "device",
    model: model ?? null,
  },
  detail: {
    serial,
    model: model ?? null,
    api_level: apiLevel ?? null,
  },
});

const makeApk = (overrides: Partial<ApkInfo> = {}): ApkInfo => ({
  path: "/tmp/demo.apk",
  package_name: "com.example.demo",
  version_code: 10,
  version_name: "1.2.3",
  min_sdk_version: 29,
  target_sdk_version: 34,
  is_split_apk: false,
  split_apk_paths: [],
  file_size_bytes: 5_242_880,
  error: null,
  ...overrides,
});

describe("apkInspector", () => {
  it("formats file sizes cleanly across units", () => {
    expect(formatApkFileSize(512)).toBe("512 B");
    expect(formatApkFileSize(2048)).toBe("2.0 KB");
    expect(formatApkFileSize(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  it("parses valid positive API levels and ignores empty/invalid strings", () => {
    expect(parseDeviceApiLevel("34")).toBe(34);
    expect(parseDeviceApiLevel(" 33 ")).toBe(33);
    expect(parseDeviceApiLevel("")).toBeNull();
    expect(parseDeviceApiLevel("unknown")).toBeNull();
    expect(parseDeviceApiLevel(null)).toBeNull();
  });

  it("flags selected devices below APK minSdkVersion", () => {
    const apk = makeApk({ min_sdk_version: 31 });
    const devices = [
      makeDevice("SER-OLD", "29", "Pixel 4"),
      makeDevice("SER-NEW", "34", "Pixel 8"),
      makeDevice("SER-UNK", null, "Mystery"),
    ];
    const summary = evaluateApkCompatibility(apk, devices);
    expect(summary.incompatibleCount).toBe(1);
    expect(summary.unknownCount).toBe(1);
    expect(summary.devices[0].compatible).toBe(false);
    expect(summary.devices[0].reason).toContain("API 29");
    expect(summary.devices[0].reason).toContain("minSdk 31");
    expect(summary.devices[1].compatible).toBe(true);
    expect(summary.devices[2].compatible).toBeNull();
  });

  it("maps known INSTALL_FAILED codes and formats readable messages", () => {
    expect(describeApkErrorCode("INSTALL_FAILED_OLDER_SDK")).toContain("too old");
    const msg = formatApkInstallFailureMessage(
      "INSTALL_FAILED_VERSION_DOWNGRADE",
      null,
      "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
    );
    expect(msg).toContain("Cannot downgrade");
    expect(msg).toContain("INSTALL_FAILED_VERSION_DOWNGRADE");
  });

  it("resolves progress, cancelled, and failure ApkInstallEvent patches", () => {
    const progressPatch = resolveApkInstallEventPatch({
      serial: "SER-1",
      event: "progress",
      stage: "pushing",
      progress: 42,
      trace_id: "t1",
    });
    expect(progressPatch).toEqual({
      status: "running",
      progress: 42,
      message: "Pushing APK... (42%)",
    });

    const cancelPatch = resolveApkInstallEventPatch({
      serial: "SER-1",
      event: "complete",
      stage: "cancelled",
      success: false,
      message: "Cancelled.",
      error_code: "INSTALL_FAILED_ABORTED",
      trace_id: "t1",
    });
    expect(cancelPatch).toEqual({
      status: "cancelled",
      progress: null,
      message: "Cancelled.",
    });

    const errorPatch = resolveApkInstallEventPatch({
      serial: "SER-1",
      event: "complete",
      stage: "complete",
      success: false,
      error_code: "INSTALL_FAILED_TEST_ONLY",
      error_description: "Test-only APK - use -t flag to install",
      raw_output: "Failure [INSTALL_FAILED_TEST_ONLY]",
      trace_id: "t1",
    });
    expect(errorPatch?.status).toBe("error");
    expect(errorPatch?.message).toContain("Test-only APK");
  });
});
