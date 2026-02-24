import { describe, expect, it } from "vitest";
import {
  buildGithubBugIssueUrl,
  buildIssuePrefillPayload,
  mapOsToIssueOption,
} from "./githubIssueReport";

describe("mapOsToIssueOption", () => {
  it("maps mac platform values to macOS", () => {
    expect(mapOsToIssueOption("MacIntel")).toBe("macOS");
    expect(mapOsToIssueOption("darwin")).toBe("macOS");
  });

  it("maps windows platform values to Windows", () => {
    expect(mapOsToIssueOption("Win32")).toBe("Windows");
    expect(mapOsToIssueOption("windows-nt")).toBe("Windows");
  });

  it("falls back to Linux", () => {
    expect(mapOsToIssueOption("Linux x86_64")).toBe("Linux");
    expect(mapOsToIssueOption("")).toBe("Linux");
  });
});

describe("buildIssuePrefillPayload", () => {
  it("fills all required issue template fields", () => {
    const payload = buildIssuePrefillPayload({
      taskTitle: "Install APK",
      taskKind: "apk_install",
      serial: "emulator-5554",
      traceId: "trace-123",
      message: "Install failed (ERR_DEPENDENCY) trace-123",
      code: "ERR_DEPENDENCY",
      exitCode: 1,
      outputPath: "/tmp/output",
      diagnosticsPath: "/tmp/diag.zip",
      diagnosticsError: null,
      appVersion: "0.0.50",
      osPlatform: "MacIntel",
      adbVersion: "Android Debug Bridge version 1.0.41",
    });

    expect(payload.title).toContain("[Bug]:");
    expect(payload.app_version).toBe("0.0.50");
    expect(payload.os).toBe("macOS");
    expect(payload.adb_version).toContain("Android Debug Bridge version");
    expect(payload.steps).toContain("Task Center");
    expect(payload.expected.length).toBeGreaterThan(0);
    expect(payload.actual).toContain("Install failed");
    expect(payload.logs).toContain("trace_id: trace-123");
    expect(payload.logs).toContain("diagnostics_bundle: /tmp/diag.zip");
  });

  it("uses safe defaults when values are empty", () => {
    const payload = buildIssuePrefillPayload({
      taskTitle: "",
      taskKind: "shell",
      serial: "",
      traceId: "",
      message: "",
      code: "",
      exitCode: null,
      outputPath: "",
      diagnosticsPath: null,
      diagnosticsError: "failed to export",
      appVersion: "",
      osPlatform: "",
      adbVersion: "",
    });

    expect(payload.app_version).toBe("--");
    expect(payload.os).toBe("Linux");
    expect(payload.adb_version).toBe("--");
    expect(payload.logs).toContain("diagnostics_bundle: unavailable");
    expect(payload.logs).toContain("diagnostics_error: failed to export");
  });

  it("clamps log output to prevent oversized URLs", () => {
    const payload = buildIssuePrefillPayload({
      taskTitle: "Shell",
      taskKind: "shell",
      serial: "serial-1",
      traceId: "trace-1",
      message: "x".repeat(7000),
      code: "ERR_SYSTEM",
      exitCode: 9,
      outputPath: "/tmp/out",
      diagnosticsPath: null,
      diagnosticsError: null,
      appVersion: "0.0.50",
      osPlatform: "linux",
      adbVersion: "adb",
    });

    expect(payload.logs.length).toBeLessThanOrEqual(4000);
  });
});

describe("buildGithubBugIssueUrl", () => {
  it("builds URL with bug template and prefilled fields", () => {
    const url = buildGithubBugIssueUrl({
      taskTitle: "Run shell",
      taskKind: "shell",
      serial: "device-001",
      traceId: "trace-abc",
      message: "Command failed",
      code: "ERR_SYSTEM",
      exitCode: 1,
      outputPath: "/tmp/log.txt",
      diagnosticsPath: "/tmp/diag.zip",
      diagnosticsError: null,
      appVersion: "0.0.51",
      osPlatform: "Win32",
      adbVersion: "Android Debug Bridge version 1.0.41",
    });

    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      "https://github.com/leaf76/lazy_blacktea_rust/issues/new",
    );
    expect(parsed.searchParams.get("template")).toBe("bug_report.yml");
    expect(parsed.searchParams.get("app_version")).toBe("0.0.51");
    expect(parsed.searchParams.get("os")).toBe("Windows");
    expect(parsed.searchParams.get("logs")).toContain("trace_id: trace-abc");
  });
});
