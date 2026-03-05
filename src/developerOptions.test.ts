import { describe, expect, it } from "vitest";
import type { CommandResult } from "./types";
import {
  buildDeveloperOptionSettingsProbeCommand,
  buildApplyCommand,
  buildReadCommands,
  evaluateApplyResult,
  getDeveloperOptionSettingsTarget,
  getDeveloperOptionSettingsKeysByNamespace,
  isHighRiskOption,
  normalizeDeveloperOptionReadFailure,
  parseSettingsListOutput,
  parseReadResult,
  type DeveloperOptionApplyRequest,
} from "./developerOptions";

const makeResult = (partial: Partial<CommandResult>): CommandResult => ({
  serial: partial.serial ?? "emulator-5554",
  stdout: partial.stdout ?? "",
  stderr: partial.stderr ?? "",
  exit_code: partial.exit_code ?? 0,
});

describe("developerOptions helpers", () => {
  it("builds read commands for all supported options", () => {
    const commands = buildReadCommands();
    expect(commands).toHaveLength(14);

    const logBuffer = commands.find((item) => item.optionKey === "log_buffer_size");
    expect(logBuffer?.command).toContain("logcat -g");

    const btSnoop = commands.find((item) => item.optionKey === "bluetooth_btsnoop_default_mode");
    expect(btSnoop?.command).toBe("settings get global bluetooth_btsnoop_default_mode");
    expect(btSnoop?.fallbackCommands).toEqual(["settings get global bluetooth_btsnoop_log_mode"]);
  });

  it("exposes settings target metadata for non-log-buffer options", () => {
    expect(getDeveloperOptionSettingsTarget("show_touches")).toEqual({
      namespace: "system",
      settingKey: "show_touches",
    });
    expect(getDeveloperOptionSettingsTarget("adb_enabled")).toEqual({
      namespace: "global",
      settingKey: "adb_enabled",
    });
    expect(getDeveloperOptionSettingsTarget("log_buffer_size")).toBeNull();
  });

  it("parses settings list output into key-value map", () => {
    const parsed = parseSettingsListOutput(`
# comment
adb_enabled=1
window_animation_scale=1.0
invalid-line-without-equals
bluetooth_btsnoop_default_mode=full
`);
    expect(parsed).toEqual({
      adb_enabled: "1",
      window_animation_scale: "1.0",
      bluetooth_btsnoop_default_mode: "full",
    });
  });

  it("builds namespace key list and safe probe commands", () => {
    const keysByNamespace = getDeveloperOptionSettingsKeysByNamespace();
    expect(keysByNamespace.global).toContain("adb_enabled");
    expect(keysByNamespace.system).toContain("show_touches");
    expect(keysByNamespace.global).toContain("bluetooth_btsnoop_log_mode");

    const probe = buildDeveloperOptionSettingsProbeCommand("global", [
      "adb_enabled",
      "bluetooth_btsnoop_default_mode",
      "invalid key with space",
    ]);
    expect(probe).toContain("settings get global");
    expect(probe).toContain("adb_enabled");
    expect(probe).toContain("bluetooth_btsnoop_default_mode");
    expect(probe).not.toContain("invalid key with space");
  });

  it("builds apply commands from a strict whitelist", () => {
    const valid = buildApplyCommand({
      optionKey: "window_animation_scale",
      value: "0.5",
    });
    expect(valid).toEqual({
      ok: true,
      data: {
        optionKey: "window_animation_scale",
        normalizedValue: "0.5",
        command: "settings put global window_animation_scale 0.5",
      },
    });

    const invalidValue = buildApplyCommand({
      optionKey: "window_animation_scale",
      value: "3",
    });
    expect(invalidValue.ok).toBe(false);

    const invalidKey = buildApplyCommand({
      optionKey: "__invalid__" as DeveloperOptionApplyRequest["optionKey"],
      value: "1",
    });
    expect(invalidKey.ok).toBe(false);
  });

  it("builds log buffer apply command only for allowed sizes", () => {
    expect(
      buildApplyCommand({ optionKey: "log_buffer_size", value: "4M" }),
    ).toEqual({
      ok: true,
      data: {
        optionKey: "log_buffer_size",
        normalizedValue: "4M",
        command: "logcat -G 4M",
      },
    });

    const rejected = buildApplyCommand({ optionKey: "log_buffer_size", value: "64M" });
    expect(rejected.ok).toBe(false);
  });

  it("builds plain shell snippets without outer quote wrapping", () => {
    const toggle = buildApplyCommand({ optionKey: "show_touches", value: true });
    expect(toggle.ok).toBe(true);
    if (toggle.ok) {
      expect(toggle.data.command.startsWith("'")).toBe(false);
      expect(toggle.data.command).toBe("settings put system show_touches 1");
    }

    const logBuffer = buildApplyCommand({ optionKey: "log_buffer_size", value: "1M" });
    expect(logBuffer.ok).toBe(true);
    if (logBuffer.ok) {
      expect(logBuffer.data.command.startsWith("'")).toBe(false);
      expect(logBuffer.data.command).toBe("logcat -G 1M");
    }
  });

  it("parses logcat -g output into normalized log buffer value", () => {
    const output = `
main: ring buffer is 1024 KiB (256 KiB consumed)
system: ring buffer is 1024 KiB (100 KiB consumed)
`;
    const parsed = parseReadResult("log_buffer_size", makeResult({ stdout: output }));
    expect(parsed).toEqual({
      optionKey: "log_buffer_size",
      supported: true,
      value: "1M",
    });
  });

  it("parses settings get output for toggle/select options", () => {
    expect(
      parseReadResult(
        "show_touches",
        makeResult({ stdout: "1\n" }),
      ),
    ).toEqual({
      optionKey: "show_touches",
      supported: true,
      value: true,
    });

    expect(
      parseReadResult(
        "bluetooth_btsnoop_default_mode",
        makeResult({ stdout: "full\n" }),
      ),
    ).toEqual({
      optionKey: "bluetooth_btsnoop_default_mode",
      supported: true,
      value: "full",
    });

    expect(
      parseReadResult(
        "bluetooth_btsnoop_default_mode",
        makeResult({ stdout: "2\n" }),
      ),
    ).toEqual({
      optionKey: "bluetooth_btsnoop_default_mode",
      supported: true,
      value: "full",
    });
  });

  it("classifies high-risk options", () => {
    expect(isHighRiskOption("development_settings_enabled")).toBe(true);
    expect(isHighRiskOption("adb_enabled")).toBe(true);
    expect(isHighRiskOption("adb_wifi_enabled")).toBe(true);
    expect(isHighRiskOption("verifier_verify_adb_installs")).toBe(true);
    expect(isHighRiskOption("show_touches")).toBe(false);
  });

  it("evaluates command result status with unsupported detection", () => {
    expect(
      evaluateApplyResult(
        makeResult({
          exit_code: 0,
          stdout: "OK",
        }),
      ),
    ).toEqual({ success: true, unsupported: false, message: "OK" });

    expect(
      evaluateApplyResult(
        makeResult({
          exit_code: 1,
          stderr: "Error: unknown setting",
        }),
      ),
    ).toEqual({
      success: false,
      unsupported: true,
      message: "Error: unknown setting",
    });

    expect(
      evaluateApplyResult(
        makeResult({
          exit_code: 1,
          stderr: "Permission denied",
        }),
      ),
    ).toEqual({
      success: false,
      unsupported: true,
      message: "Permission denied",
    });
  });

  it("normalizes read failure messages for user-safe errors", () => {
    expect(
      normalizeDeveloperOptionReadFailure("Command timed out (ERR_SYSTEM) d0341108-15a2-45d0-a6d7-f4e5743b3f16"),
    ).toEqual({
      message: "Developer Options read timed out. Check device responsiveness and refresh.",
      timedOut: true,
      unauthorized: false,
      offline: false,
    });

    expect(
      normalizeDeveloperOptionReadFailure("error: device unauthorized"),
    ).toEqual({
      message: "Device authorization is required. Reconnect and accept the ADB prompt, then refresh.",
      timedOut: false,
      unauthorized: true,
      offline: false,
    });

    expect(
      normalizeDeveloperOptionReadFailure("Some unexpected failure details"),
    ).toEqual({
      message: "Read command failed on this device.",
      timedOut: false,
      unauthorized: false,
      offline: false,
    });
  });
});
