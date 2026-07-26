import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAdbCommandRunErrorResult,
  buildAdbCommandRunResult,
  buildAdbCommandRunStartResult,
  buildCustomAdbCommandPack,
  buildAdbCommandLibraryEntries,
  createCustomAdbCommand,
  EXAMPLE_ADB_COMMAND_PACK,
  formatAdbCommandPackJson,
  mergeImportedAdbCommandPack,
  normalizeAdbCommandLibrarySettings,
  normalizeAdbShellCommand,
  parseAdbCommandPackJson,
  removeImportedAdbCommandPack,
  setAdbCommandFavorite,
  type AdbCommandLibraryEntry,
} from "./adbCommandLibrary";
import type { AdbCommandLibrarySettings } from "./types";

describe("ADB command library helpers", () => {
  const adbCommandEntry: AdbCommandLibraryEntry = {
    id: "wm-size",
    library_id: "built_in:android-debug-basics:wm-size",
    source: "built_in",
    pack_id: "android-debug-basics",
    pack_name: "Android Debug Basics",
    title: "Show screen size",
    category: "Display",
    command: "wm size",
    description: "Print the current physical and override display size.",
    tags: ["display", "wm"],
    risk: "normal",
    editable: false,
    removable: false,
    is_favorite: false,
  };

  it("normalizes plain shell commands and adb shell commands", () => {
    expect(normalizeAdbShellCommand("wm size")).toEqual({ ok: true, command: "wm size" });
    expect(normalizeAdbShellCommand(" adb shell wm density ")).toEqual({
      ok: true,
      command: "wm density",
    });
    expect(normalizeAdbShellCommand("adb.exe shell dumpsys battery")).toEqual({
      ok: true,
      command: "dumpsys battery",
    });
  });

  it("rejects full adb commands that are not adb shell", () => {
    expect(normalizeAdbShellCommand("adb install app.apk")).toEqual({
      ok: false,
      error: "Only adb shell commands are supported.",
    });
    expect(normalizeAdbShellCommand("adb pull /sdcard/a.txt .")).toEqual({
      ok: false,
      error: "Only adb shell commands are supported.",
    });
  });

  it("parses v1 JSON packs and normalizes commands", () => {
    const parsed = parseAdbCommandPackJson(
      JSON.stringify({
        version: 1,
        id: "android-debug-basics",
        name: "Android Debug Basics",
        commands: [
          {
            id: "wm-size",
            title: "Show screen size",
            category: "Display",
            command: "adb shell wm size",
            description: "Print the display size.",
            tags: ["display", "wm"],
            risk: "normal",
          },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.pack).toMatchObject({
        version: 1,
        id: "android-debug-basics",
        name: "Android Debug Basics",
      });
      expect(parsed.pack.commands[0]).toMatchObject({
        id: "wm-size",
        title: "Show screen size",
        category: "Display",
        command: "wm size",
        tags: ["display", "wm"],
        risk: "normal",
      });
    }
  });

  it("keeps the bundled example pack importable", () => {
    const formatted = formatAdbCommandPackJson(EXAMPLE_ADB_COMMAND_PACK);
    const parsed = parseAdbCommandPackJson(formatted);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.pack.id).toBe("lazy-blacktea-example-pack");
      expect(parsed.pack.commands).toHaveLength(2);
      expect(parsed.pack.commands[1]).toMatchObject({
        id: "battery-status",
        command: "dumpsys battery",
      });
    }
  });

  it("formats command pack JSON with stable indentation and trailing newline", () => {
    expect(formatAdbCommandPackJson(EXAMPLE_ADB_COMMAND_PACK)).toMatch(
      /^\{\n  "version": 1,[\s\S]*\n\}\n$/,
    );
  });

  it("keeps the docs example pack synchronized with the bundled example", () => {
    const docsExample = readFileSync(
      new URL("../docs/examples/adb-command-pack.example.json", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(docsExample).toBe(formatAdbCommandPackJson(EXAMPLE_ADB_COMMAND_PACK));
  });

  it("exports custom commands as a v1 command pack only", () => {
    const settings = normalizeAdbCommandLibrarySettings({
      custom_commands: [
        {
          id: "custom-prop",
          title: "Custom Prop",
          category: "Custom",
          command: "getprop ro.product.model",
          description: "Print model.",
          tags: ["custom"],
          risk: "normal",
        },
      ],
      imported_packs: [
        {
          version: 1,
          id: "pack-one",
          name: "Pack One",
          commands: [
            {
              id: "imported-one",
              title: "Imported One",
              category: "General",
              command: "id",
              description: "",
              tags: [],
              risk: "normal",
            },
          ],
        },
      ],
      favorite_ids: ["custom:custom-prop", "imported:pack-one:imported-one"],
    });

    const built = buildCustomAdbCommandPack(settings);

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.pack).toMatchObject({
        version: 1,
        id: "lazy-blacktea-custom-adb-shell",
        name: "Lazy Blacktea Custom ADB Shell",
      });
      expect(built.pack.commands).toEqual(settings.custom_commands);
      expect(built.pack.commands).toHaveLength(1);
      expect(formatAdbCommandPackJson(built.pack)).toContain('"custom-prop"');
      expect(formatAdbCommandPackJson(built.pack)).not.toContain('"imported-one"');
    }
  });

  it("does not build a custom export pack when there are no custom commands", () => {
    expect(buildCustomAdbCommandPack(normalizeAdbCommandLibrarySettings(null))).toEqual({
      ok: false,
      error: "Add a custom command before exporting.",
    });
  });

  it("builds a running result before the selected command completes", () => {
    expect(
      buildAdbCommandRunStartResult(adbCommandEntry, ["device-1"], "2026-04-30T01:00:00.000Z"),
    ).toMatchObject({
      command_library_id: "built_in:android-debug-basics:wm-size",
      command_title: "Show screen size",
      command: "wm size",
      status: "running",
      started_at: "2026-04-30T01:00:00.000Z",
      completed_at: null,
      trace_id: null,
      devices: [
        {
          serial: "device-1",
          status: "running",
          message: "Running command...",
          stdout: "",
          stderr: "",
          exit_code: null,
        },
      ],
    });
  });

  it("builds an inline success result with stdout and exit code", () => {
    const result = buildAdbCommandRunResult({
      entry: adbCommandEntry,
      targetSerials: ["device-1"],
      commandResults: [
        {
          serial: "device-1",
          stdout: "Physical size: 1080x1920\n",
          stderr: "",
          exit_code: 0,
        },
      ],
      traceId: "trace-1",
      startedAt: "2026-04-30T01:00:00.000Z",
      completedAt: "2026-04-30T01:00:01.000Z",
    });

    expect(result.status).toBe("success");
    expect(result.trace_id).toBe("trace-1");
    expect(result.devices[0]).toMatchObject({
      serial: "device-1",
      status: "success",
      message: "Completed.",
      stdout: "Physical size: 1080x1920\n",
      stderr: "",
      exit_code: 0,
    });
  });

  it("builds an inline failure result with stderr and non-zero exit code", () => {
    const result = buildAdbCommandRunResult({
      entry: adbCommandEntry,
      targetSerials: ["device-1"],
      commandResults: [
        {
          serial: "device-1",
          stdout: "",
          stderr: "cmd: inaccessible or not found\n",
          exit_code: 127,
        },
      ],
      traceId: "trace-2",
      startedAt: "2026-04-30T01:00:00.000Z",
      completedAt: "2026-04-30T01:00:01.000Z",
    });

    expect(result.status).toBe("error");
    expect(result.devices[0]).toMatchObject({
      status: "error",
      message: "cmd: inaccessible or not found",
      stderr: "cmd: inaccessible or not found\n",
      exit_code: 127,
    });
  });

  it("marks missing per-device command results as errors", () => {
    const result = buildAdbCommandRunResult({
      entry: adbCommandEntry,
      targetSerials: ["device-1", "device-2"],
      commandResults: [
        {
          serial: "device-1",
          stdout: "ok\n",
          stderr: "",
          exit_code: 0,
        },
      ],
      traceId: "trace-3",
      startedAt: "2026-04-30T01:00:00.000Z",
      completedAt: "2026-04-30T01:00:01.000Z",
    });

    expect(result.status).toBe("error");
    expect(result.devices[1]).toMatchObject({
      serial: "device-2",
      status: "error",
      message: "No command result returned.",
      stdout: "",
      stderr: "",
      exit_code: null,
    });
  });

  it("builds a safe error result when runShell throws", () => {
    const result = buildAdbCommandRunErrorResult({
      entry: adbCommandEntry,
      targetSerials: ["device-1", "device-2"],
      message: "ADB command failed.",
      startedAt: "2026-04-30T01:00:00.000Z",
      completedAt: "2026-04-30T01:00:01.000Z",
    });

    expect(result.status).toBe("error");
    expect(result.trace_id).toBeNull();
    expect(result.devices).toEqual([
      {
        serial: "device-1",
        status: "error",
        message: "ADB command failed.",
        stdout: "",
        stderr: "",
        exit_code: null,
      },
      {
        serial: "device-2",
        status: "error",
        message: "ADB command failed.",
        stdout: "",
        stderr: "",
        exit_code: null,
      },
    ]);
  });

  it("rejects invalid and oversized imported packs", () => {
    expect(parseAdbCommandPackJson("{").ok).toBe(false);
    expect(
      parseAdbCommandPackJson(
        JSON.stringify({
          version: 2,
          id: "future-pack",
          name: "Future Pack",
          commands: [{ id: "a", title: "A", category: "General", command: "id" }],
        }),
      ),
    ).toEqual({ ok: false, error: "Unsupported command pack version." });

    const tooManyCommands = Array.from({ length: 201 }, (_, index) => ({
      id: `cmd-${index}`,
      title: `Command ${index}`,
      category: "General",
      command: "id",
    }));
    expect(
      parseAdbCommandPackJson(
        JSON.stringify({
          version: 1,
          id: "too-many",
          name: "Too Many",
          commands: tooManyCommands,
        }),
      ),
    ).toEqual({ ok: false, error: "Command pack has too many commands." });
  });

  it("replaces imported packs while preserving favorites and custom commands", () => {
    const custom = createCustomAdbCommand(
      {
        title: "Custom Prop",
        category: "Custom",
        command: "getprop ro.product.model",
        description: "",
        tags: ["custom"],
        risk: "normal",
      },
      [],
    );
    expect(custom.ok).toBe(true);
    if (!custom.ok) {
      return;
    }

    const settings: AdbCommandLibrarySettings = {
      custom_commands: [custom.command],
      imported_packs: [
        {
          version: 1,
          id: "pack-a",
          name: "Pack A",
          commands: [
            {
              id: "old",
              title: "Old",
              category: "General",
              command: "id",
              description: "",
              tags: [],
              risk: "normal",
            },
          ],
        },
      ],
      favorite_ids: ["custom:custom-prop", "imported:pack-a:new"],
    };

    const next = mergeImportedAdbCommandPack(settings, {
      version: 1,
      id: "pack-a",
      name: "Pack A Updated",
      commands: [
        {
          id: "new",
          title: "New",
          category: "General",
          command: "whoami",
          description: "",
          tags: [],
          risk: "normal",
        },
      ],
    });

    expect(next.custom_commands).toHaveLength(1);
    expect(next.imported_packs).toHaveLength(1);
    expect(next.imported_packs[0].name).toBe("Pack A Updated");
    expect(next.imported_packs[0].commands[0].id).toBe("new");
    expect(next.favorite_ids).toEqual(["custom:custom-prop", "imported:pack-a:new"]);
  });

  it("builds entries with built-in, imported, custom, and favorite metadata", () => {
    const settings = normalizeAdbCommandLibrarySettings({
      custom_commands: [
        {
          id: "custom-one",
          title: "Custom One",
          category: "Custom",
          command: "id",
          description: "",
          tags: [],
          risk: "normal",
        },
      ],
      imported_packs: [
        {
          version: 1,
          id: "pack-one",
          name: "Pack One",
          commands: [
            {
              id: "imported-one",
              title: "Imported One",
              category: "General",
              command: "whoami",
              description: "",
              tags: [],
              risk: "dangerous",
            },
          ],
        },
      ],
      favorite_ids: ["custom:custom-one", "imported:pack-one:imported-one"],
    });

    const entries = buildAdbCommandLibraryEntries(settings);
    expect(entries.some((entry) => entry.source === "built_in")).toBe(true);
    expect(entries.find((entry) => entry.library_id === "custom:custom-one")).toMatchObject({
      title: "Custom One",
      source: "custom",
      editable: true,
      is_favorite: true,
    });
    expect(entries.find((entry) => entry.library_id === "imported:pack-one:imported-one")).toMatchObject({
      title: "Imported One",
      source: "imported",
      risk: "dangerous",
      is_favorite: true,
    });
  });

  it("normalizes settings and prunes invalid favorite ids when packs are removed", () => {
    const settings = normalizeAdbCommandLibrarySettings({
      custom_commands: [],
      imported_packs: [],
      favorite_ids: ["", "custom:missing", "built_in:android-debug-basics:wm-size"],
    });
    const favorited = setAdbCommandFavorite(settings, "built_in:android-debug-basics:wm-size", true);
    const removed = removeImportedAdbCommandPack(favorited, "missing-pack");

    expect(favorited.favorite_ids).toEqual(["built_in:android-debug-basics:wm-size"]);
    expect(removed.favorite_ids).toEqual(["built_in:android-debug-basics:wm-size"]);
  });
});
