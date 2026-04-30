import type {
  AdbCommandLibraryCommand,
  AdbCommandLibraryPack,
  AdbCommandLibrarySettings,
  AdbCommandRisk,
  CommandResult,
} from "./types";

export type AdbCommandLibrarySource = "built_in" | "imported" | "custom";

export type AdbCommandLibraryEntry = AdbCommandLibraryCommand & {
  library_id: string;
  source: AdbCommandLibrarySource;
  pack_id: string | null;
  pack_name: string;
  editable: boolean;
  removable: boolean;
  is_favorite: boolean;
};

export type AdbShellCommandNormalizeResult =
  | { ok: true; command: string }
  | { ok: false; error: string };

export type AdbCommandPackParseResult =
  | { ok: true; pack: AdbCommandLibraryPack }
  | { ok: false; error: string };

export type AdbCustomCommandInput = {
  id?: string;
  title: string;
  category: string;
  command: string;
  description: string;
  tags: string[];
  risk: AdbCommandRisk;
};

export type AdbCustomCommandResult =
  | { ok: true; command: AdbCommandLibraryCommand }
  | { ok: false; error: string };

export type AdbCustomCommandPackBuildResult =
  | { ok: true; pack: AdbCommandLibraryPack }
  | { ok: false; error: string };

export type AdbCommandRunStatus = "running" | "success" | "error";

export type AdbCommandRunDeviceResult = {
  serial: string;
  status: AdbCommandRunStatus;
  message: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
};

export type AdbCommandRunResult = {
  command_library_id: string;
  command_title: string;
  command: string;
  status: AdbCommandRunStatus;
  started_at: string;
  completed_at: string | null;
  trace_id: string | null;
  devices: AdbCommandRunDeviceResult[];
};

export type AdbCommandRunResultInput = {
  entry: AdbCommandLibraryEntry;
  targetSerials: string[];
  commandResults: CommandResult[];
  traceId: string;
  startedAt: string;
  completedAt: string;
};

export type AdbCommandRunErrorInput = {
  entry: AdbCommandLibraryEntry;
  targetSerials: string[];
  message: string;
  startedAt: string;
  completedAt: string;
};

const COMMAND_PACK_VERSION = 1;
const MAX_PACKS = 20;
export const MAX_COMMANDS_PER_PACK = 200;
const MAX_CUSTOM_COMMANDS = 200;
const MAX_FAVORITES = 500;
const MAX_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 80;
const MAX_CATEGORY_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 240;
export const MAX_ADB_SHELL_COMMAND_LENGTH = 500;
const MAX_TAG_LENGTH = 32;
const MAX_TAGS = 8;
export const CUSTOM_ADB_COMMAND_PACK_ID = "lazy-blacktea-custom-adb-shell";
export const CUSTOM_ADB_COMMAND_PACK_NAME = "Lazy Blacktea Custom ADB Shell";
export const CUSTOM_ADB_COMMAND_PACK_FILENAME = `${CUSTOM_ADB_COMMAND_PACK_ID}-pack.json`;

export const EXAMPLE_ADB_COMMAND_PACK: AdbCommandLibraryPack = {
  version: COMMAND_PACK_VERSION,
  id: "lazy-blacktea-example-pack",
  name: "Lazy Blacktea Example Pack",
  commands: [
    {
      id: "screen-size",
      title: "Show screen size",
      category: "Display",
      command: "wm size",
      description: "Print the current physical and override display size.",
      tags: ["display", "wm"],
      risk: "normal",
    },
    {
      id: "battery-status",
      title: "Show battery status",
      category: "Device",
      command: "adb shell dumpsys battery",
      description: "Print battery, power, and charging state.",
      tags: ["battery", "dumpsys"],
      risk: "normal",
    },
  ],
};

export const emptyAdbCommandLibrarySettings = (): AdbCommandLibrarySettings => ({
  custom_commands: [],
  imported_packs: [],
  favorite_ids: [],
});

export const BUILT_IN_ADB_COMMAND_PACKS: AdbCommandLibraryPack[] = [
  {
    version: COMMAND_PACK_VERSION,
    id: "android-debug-basics",
    name: "Android Debug Basics",
    commands: [
      {
        id: "wm-size",
        title: "Show screen size",
        category: "Display",
        command: "wm size",
        description: "Print the current physical and override display size.",
        tags: ["display", "wm"],
        risk: "normal",
      },
      {
        id: "wm-density",
        title: "Show screen density",
        category: "Display",
        command: "wm density",
        description: "Print the current physical and override display density.",
        tags: ["display", "wm"],
        risk: "normal",
      },
      {
        id: "battery-status",
        title: "Show battery status",
        category: "Device",
        command: "dumpsys battery",
        description: "Print battery, power, and charging state.",
        tags: ["battery", "dumpsys"],
        risk: "normal",
      },
      {
        id: "wifi-status",
        title: "Show Wi-Fi status",
        category: "Network",
        command: "dumpsys wifi",
        description: "Print Wi-Fi service state.",
        tags: ["wifi", "dumpsys"],
        risk: "normal",
      },
      {
        id: "android-version",
        title: "Show Android version",
        category: "Device",
        command: "getprop ro.build.version.release",
        description: "Print the Android release version.",
        tags: ["getprop", "version"],
        risk: "normal",
      },
      {
        id: "screen-off",
        title: "Turn screen off",
        category: "Input",
        command: "input keyevent 26",
        description: "Send the power key event to toggle the screen.",
        tags: ["input", "screen"],
        risk: "dangerous",
      },
    ],
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const trimAndClamp = (value: string, maxLength: number): string => value.trim().slice(0, maxLength);

const normalizeOptionalText = (value: unknown, maxLength: number): string =>
  typeof value === "string" ? trimAndClamp(value, maxLength) : "";

const normalizeId = (value: unknown, fallback: string): string => {
  const source = typeof value === "string" && value.trim() ? value : fallback;
  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, MAX_ID_LENGTH);
  return normalized || fallback.slice(0, MAX_ID_LENGTH);
};

const makeUniqueId = (baseId: string, seen: Set<string>): string => {
  let candidate = baseId;
  let suffix = 2;
  while (seen.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${baseId.slice(0, MAX_ID_LENGTH - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
};

const normalizeRisk = (value: unknown): AdbCommandRisk => (value === "dangerous" ? "dangerous" : "normal");

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  value.forEach((item) => {
    if (typeof item !== "string") {
      return;
    }
    const tag = trimAndClamp(item, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag)) {
      return;
    }
    seen.add(tag);
    tags.push(tag);
  });
  return tags.slice(0, MAX_TAGS);
};

export const normalizeAdbShellCommand = (rawCommand: string): AdbShellCommandNormalizeResult => {
  const normalized = rawCommand.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return { ok: false, error: "Command is required." };
  }
  if (normalized.includes("\0")) {
    return { ok: false, error: "Command contains invalid characters." };
  }

  const adbShellPrefix = normalized.match(/^adb(?:\.exe)?\s+shell(?:\s+|$)([\s\S]*)$/i);
  if (adbShellPrefix) {
    const shellCommand = adbShellPrefix[1].trim();
    if (!shellCommand) {
      return { ok: false, error: "Shell command is required." };
    }
    if (shellCommand.length > MAX_ADB_SHELL_COMMAND_LENGTH) {
      return { ok: false, error: "Command is too long." };
    }
    return { ok: true, command: shellCommand };
  }

  if (/^adb(?:\.exe)?(?:\s+|$)/i.test(normalized)) {
    return { ok: false, error: "Only adb shell commands are supported." };
  }

  if (normalized.length > MAX_ADB_SHELL_COMMAND_LENGTH) {
    return { ok: false, error: "Command is too long." };
  }
  return { ok: true, command: normalized };
};

const normalizeCommandRecord = (
  record: unknown,
  index: number,
  seenIds: Set<string>,
): AdbCustomCommandResult => {
  if (!isRecord(record)) {
    return { ok: false, error: "Command entry must be an object." };
  }

  const title = normalizeOptionalText(record.title, MAX_TITLE_LENGTH);
  if (!title) {
    return { ok: false, error: "Command title is required." };
  }

  const commandResult = normalizeAdbShellCommand(
    typeof record.command === "string" ? record.command : "",
  );
  if (!commandResult.ok) {
    return { ok: false, error: commandResult.error };
  }

  const baseId = normalizeId(record.id, title || `command-${index + 1}`);
  const id = makeUniqueId(baseId, seenIds);
  const category = normalizeOptionalText(record.category, MAX_CATEGORY_LENGTH) || "General";

  return {
    ok: true,
    command: {
      id,
      title,
      category,
      command: commandResult.command,
      description: normalizeOptionalText(record.description, MAX_DESCRIPTION_LENGTH),
      tags: normalizeTags(record.tags),
      risk: normalizeRisk(record.risk),
    },
  };
};

const normalizePackRecord = (record: unknown): AdbCommandPackParseResult => {
  if (!isRecord(record)) {
    return { ok: false, error: "Command pack must be an object." };
  }
  if (record.version !== COMMAND_PACK_VERSION) {
    return { ok: false, error: "Unsupported command pack version." };
  }

  const id = normalizeId(record.id, "imported-pack");
  const name = normalizeOptionalText(record.name, MAX_TITLE_LENGTH);
  if (!name) {
    return { ok: false, error: "Command pack name is required." };
  }
  if (!Array.isArray(record.commands) || record.commands.length === 0) {
    return { ok: false, error: "Command pack must include at least one command." };
  }
  if (record.commands.length > MAX_COMMANDS_PER_PACK) {
    return { ok: false, error: "Command pack has too many commands." };
  }

  const seenIds = new Set<string>();
  const commands: AdbCommandLibraryCommand[] = [];
  for (let index = 0; index < record.commands.length; index += 1) {
    const normalized = normalizeCommandRecord(record.commands[index], index, seenIds);
    if (!normalized.ok) {
      return { ok: false, error: `Command ${index + 1}: ${normalized.error}` };
    }
    commands.push(normalized.command);
  }

  return {
    ok: true,
    pack: {
      version: COMMAND_PACK_VERSION,
      id,
      name,
      commands,
    },
  };
};

export const parseAdbCommandPackJson = (content: string): AdbCommandPackParseResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: "Command pack JSON is invalid." };
  }
  return normalizePackRecord(parsed);
};

export const formatAdbCommandPackJson = (pack: AdbCommandLibraryPack): string =>
  `${JSON.stringify(pack, null, 2)}\n`;

export const buildCustomAdbCommandPack = (
  settings?: Partial<AdbCommandLibrarySettings> | null,
): AdbCustomCommandPackBuildResult => {
  const normalized = normalizeAdbCommandLibrarySettings(settings);
  if (normalized.custom_commands.length === 0) {
    return { ok: false, error: "Add a custom command before exporting." };
  }
  return {
    ok: true,
    pack: {
      version: COMMAND_PACK_VERSION,
      id: CUSTOM_ADB_COMMAND_PACK_ID,
      name: CUSTOM_ADB_COMMAND_PACK_NAME,
      commands: normalized.custom_commands,
    },
  };
};

const buildRunResultBase = (
  entry: AdbCommandLibraryEntry,
  startedAt: string,
): Omit<AdbCommandRunResult, "status" | "completed_at" | "trace_id" | "devices"> => ({
  command_library_id: entry.library_id,
  command_title: entry.title,
  command: entry.command,
  started_at: startedAt,
});

export const buildAdbCommandRunStartResult = (
  entry: AdbCommandLibraryEntry,
  targetSerials: string[],
  startedAt: string,
): AdbCommandRunResult => ({
  ...buildRunResultBase(entry, startedAt),
  status: "running",
  completed_at: null,
  trace_id: null,
  devices: targetSerials.map((serial) => ({
    serial,
    status: "running",
    message: "Running command...",
    stdout: "",
    stderr: "",
    exit_code: null,
  })),
});

export const buildAdbCommandRunResult = ({
  entry,
  targetSerials,
  commandResults,
  traceId,
  startedAt,
  completedAt,
}: AdbCommandRunResultInput): AdbCommandRunResult => {
  const resultBySerial = new Map(commandResults.map((result) => [result.serial, result]));
  const devices = targetSerials.map((serial): AdbCommandRunDeviceResult => {
    const result = resultBySerial.get(serial);
    if (!result) {
      return {
        serial,
        status: "error",
        message: "No command result returned.",
        stdout: "",
        stderr: "",
        exit_code: null,
      };
    }

    const exitCode = result.exit_code ?? 0;
    const success = exitCode === 0;
    return {
      serial,
      status: success ? "success" : "error",
      message: success
        ? "Completed."
        : result.stderr.trim() || result.stdout.trim() || "Command failed.",
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: exitCode,
    };
  });

  return {
    ...buildRunResultBase(entry, startedAt),
    status: devices.every((device) => device.status === "success") ? "success" : "error",
    completed_at: completedAt,
    trace_id: traceId,
    devices,
  };
};

export const buildAdbCommandRunErrorResult = ({
  entry,
  targetSerials,
  message,
  startedAt,
  completedAt,
}: AdbCommandRunErrorInput): AdbCommandRunResult => ({
  ...buildRunResultBase(entry, startedAt),
  status: "error",
  completed_at: completedAt,
  trace_id: null,
  devices: targetSerials.map((serial) => ({
    serial,
    status: "error",
    message,
    stdout: "",
    stderr: "",
    exit_code: null,
  })),
});

export const normalizeAdbCommandLibrarySettings = (
  settings?: Partial<AdbCommandLibrarySettings> | null,
): AdbCommandLibrarySettings => {
  if (!settings) {
    return emptyAdbCommandLibrarySettings();
  }

  const importedPacks = Array.isArray(settings.imported_packs)
    ? settings.imported_packs
        .slice(0, MAX_PACKS)
        .map((pack) => normalizePackRecord(pack))
        .filter((result): result is { ok: true; pack: AdbCommandLibraryPack } => result.ok)
        .map((result) => result.pack)
    : [];

  const customSeenIds = new Set<string>();
  const customCommands = Array.isArray(settings.custom_commands)
    ? settings.custom_commands
        .slice(0, MAX_CUSTOM_COMMANDS)
        .map((command, index) => normalizeCommandRecord(command, index, customSeenIds))
        .filter((result): result is { ok: true; command: AdbCommandLibraryCommand } => result.ok)
        .map((result) => result.command)
    : [];

  const validIds = new Set<string>();
  BUILT_IN_ADB_COMMAND_PACKS.forEach((pack) => {
    pack.commands.forEach((command) => validIds.add(buildLibraryId("built_in", pack.id, command.id)));
  });
  importedPacks.forEach((pack) => {
    pack.commands.forEach((command) => validIds.add(buildLibraryId("imported", pack.id, command.id)));
  });
  customCommands.forEach((command) => validIds.add(buildLibraryId("custom", null, command.id)));

  const seenFavorites = new Set<string>();
  const favoriteIds = Array.isArray(settings.favorite_ids)
    ? settings.favorite_ids
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item && validIds.has(item) && !seenFavorites.has(item) && seenFavorites.add(item))
        .slice(0, MAX_FAVORITES)
    : [];

  return {
    custom_commands: customCommands,
    imported_packs: importedPacks,
    favorite_ids: favoriteIds,
  };
};

export const buildLibraryId = (
  source: AdbCommandLibrarySource,
  packId: string | null,
  commandId: string,
): string => (source === "custom" ? `custom:${commandId}` : `${source}:${packId ?? "unknown"}:${commandId}`);

const buildEntriesForPack = (
  source: Exclude<AdbCommandLibrarySource, "custom">,
  pack: AdbCommandLibraryPack,
  favoriteIds: Set<string>,
): AdbCommandLibraryEntry[] =>
  pack.commands.map((command) => {
    const libraryId = buildLibraryId(source, pack.id, command.id);
    return {
      ...command,
      library_id: libraryId,
      source,
      pack_id: pack.id,
      pack_name: pack.name,
      editable: false,
      removable: source === "imported",
      is_favorite: favoriteIds.has(libraryId),
    };
  });

export const buildAdbCommandLibraryEntries = (
  settings?: Partial<AdbCommandLibrarySettings> | null,
): AdbCommandLibraryEntry[] => {
  const normalized = normalizeAdbCommandLibrarySettings(settings);
  const favoriteIds = new Set(normalized.favorite_ids);
  return [
    ...BUILT_IN_ADB_COMMAND_PACKS.flatMap((pack) => buildEntriesForPack("built_in", pack, favoriteIds)),
    ...normalized.imported_packs.flatMap((pack) => buildEntriesForPack("imported", pack, favoriteIds)),
    ...normalized.custom_commands.map((command) => {
      const libraryId = buildLibraryId("custom", null, command.id);
      return {
        ...command,
        library_id: libraryId,
        source: "custom" as const,
        pack_id: null,
        pack_name: "Custom Commands",
        editable: true,
        removable: true,
        is_favorite: favoriteIds.has(libraryId),
      };
    }),
  ];
};

export const mergeImportedAdbCommandPack = (
  settings: Partial<AdbCommandLibrarySettings> | null | undefined,
  pack: AdbCommandLibraryPack,
): AdbCommandLibrarySettings => {
  const normalized = normalizeAdbCommandLibrarySettings(settings);
  const rawFavoriteIds = Array.isArray(settings?.favorite_ids)
    ? settings.favorite_ids.filter((item): item is string => typeof item === "string")
    : normalized.favorite_ids;
  const nextPacks = [
    ...normalized.imported_packs.filter((candidate) => candidate.id !== pack.id),
    pack,
  ].slice(-MAX_PACKS);
  return normalizeAdbCommandLibrarySettings({
    ...normalized,
    imported_packs: nextPacks,
    favorite_ids: rawFavoriteIds,
  });
};

export const removeImportedAdbCommandPack = (
  settings: Partial<AdbCommandLibrarySettings> | null | undefined,
  packId: string,
): AdbCommandLibrarySettings => {
  const normalized = normalizeAdbCommandLibrarySettings(settings);
  return normalizeAdbCommandLibrarySettings({
    ...normalized,
    imported_packs: normalized.imported_packs.filter((pack) => pack.id !== packId),
  });
};

export const setAdbCommandFavorite = (
  settings: Partial<AdbCommandLibrarySettings> | null | undefined,
  libraryId: string,
  favorite: boolean,
): AdbCommandLibrarySettings => {
  const normalized = normalizeAdbCommandLibrarySettings(settings);
  const current = new Set(normalized.favorite_ids);
  if (favorite) {
    current.add(libraryId);
  } else {
    current.delete(libraryId);
  }
  return normalizeAdbCommandLibrarySettings({
    ...normalized,
    favorite_ids: [...current],
  });
};

export const createCustomAdbCommand = (
  input: AdbCustomCommandInput,
  existingCommands: AdbCommandLibraryCommand[],
): AdbCustomCommandResult => {
  const seenIds = new Set(existingCommands.map((command) => command.id));
  return normalizeCommandRecord(input, existingCommands.length, seenIds);
};

export const upsertCustomAdbCommand = (
  settings: Partial<AdbCommandLibrarySettings> | null | undefined,
  command: AdbCommandLibraryCommand,
): AdbCommandLibrarySettings => {
  const normalized = normalizeAdbCommandLibrarySettings(settings);
  const nextCustomCommands = [
    ...normalized.custom_commands.filter((candidate) => candidate.id !== command.id),
    command,
  ].slice(-MAX_CUSTOM_COMMANDS);
  return normalizeAdbCommandLibrarySettings({
    ...normalized,
    custom_commands: nextCustomCommands,
  });
};

export const removeCustomAdbCommand = (
  settings: Partial<AdbCommandLibrarySettings> | null | undefined,
  commandId: string,
): AdbCommandLibrarySettings => {
  const normalized = normalizeAdbCommandLibrarySettings(settings);
  return normalizeAdbCommandLibrarySettings({
    ...normalized,
    custom_commands: normalized.custom_commands.filter((command) => command.id !== commandId),
  });
};
