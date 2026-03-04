import type { CommandResult } from "./types";

export type DeveloperOptionKey =
  | "log_buffer_size"
  | "stay_on_while_plugged_in"
  | "bluetooth_btsnoop_default_mode"
  | "show_touches"
  | "pointer_location"
  | "window_animation_scale"
  | "transition_animation_scale"
  | "animator_duration_scale"
  | "always_finish_activities"
  | "mobile_data_always_on"
  | "development_settings_enabled"
  | "adb_enabled"
  | "adb_wifi_enabled"
  | "verifier_verify_adb_installs";

export type DeveloperOptionControlType = "toggle" | "select";

export type DeveloperOptionValue = boolean | string | null;

export type DeveloperOptionSnapshot = Record<DeveloperOptionKey, DeveloperOptionValue>;

export type DeveloperOptionDefinition = {
  key: DeveloperOptionKey;
  label: string;
  description: string;
  category: "logging" | "input" | "animation" | "lifecycle" | "network" | "debugging";
  control: DeveloperOptionControlType;
  highRisk: boolean;
  options?: Array<{ value: string; label: string }>;
};

export type DeveloperOptionSettingsNamespace = "global" | "system";

type ToggleMeta = {
  type: "toggle";
  namespace: DeveloperOptionSettingsNamespace;
  settingKey: string;
  trueValue: string;
  falseValue: string;
};

type SelectMeta = {
  type: "select";
  namespace: DeveloperOptionSettingsNamespace;
  settingKey: string;
  allowedValues: readonly string[];
  normalizeReadValue?: (raw: string) => string | null;
};

type LogBufferMeta = {
  type: "log_buffer";
  allowedValues: readonly string[];
};

type OptionMeta = ToggleMeta | SelectMeta | LogBufferMeta;

type OptionRecord = {
  definition: DeveloperOptionDefinition;
  meta: OptionMeta;
  fallbackReadCommands?: string[];
};

export type DeveloperOptionReadCommand = {
  optionKey: DeveloperOptionKey;
  command: string;
  fallbackCommands?: string[];
};

export type DeveloperOptionReadParse = {
  optionKey: DeveloperOptionKey;
  supported: boolean;
  value: DeveloperOptionValue;
  message?: string;
};

export type DeveloperOptionApplyRequest = {
  optionKey: DeveloperOptionKey;
  value: DeveloperOptionValue;
};

export type DeveloperOptionApplyCommand = {
  optionKey: DeveloperOptionKey;
  normalizedValue: DeveloperOptionValue;
  command: string;
};

export type DeveloperOptionSettingsTarget = {
  namespace: DeveloperOptionSettingsNamespace;
  settingKey: string;
};

export type DeveloperOptionSettingsKeysByNamespace = Record<DeveloperOptionSettingsNamespace, string[]>;

export type DeveloperOptionCommandBuildResult =
  | { ok: true; data: DeveloperOptionApplyCommand }
  | { ok: false; error: string };

export type DeveloperOptionCommandEvaluation = {
  success: boolean;
  unsupported: boolean;
  message: string;
};

export type DeveloperOptionReadFailureInfo = {
  message: string;
  timedOut: boolean;
  unauthorized: boolean;
  offline: boolean;
};

const LOG_BUFFER_OPTIONS = [
  { value: "256K", label: "256 KB" },
  { value: "1M", label: "1 MB" },
  { value: "4M", label: "4 MB" },
  { value: "16M", label: "16 MB" },
] as const;

const BT_SNOOP_OPTIONS = [
  { value: "disabled", label: "Disabled" },
  { value: "filtered", label: "Filtered" },
  { value: "full", label: "Full" },
] as const;

const SCALE_OPTIONS = [
  { value: "0", label: "Off (0x)" },
  { value: "0.5", label: "0.5x" },
  { value: "1", label: "1x" },
  { value: "1.5", label: "1.5x" },
  { value: "2", label: "2x" },
] as const;

const OPTION_RECORDS: OptionRecord[] = [
  {
    definition: {
      key: "log_buffer_size",
      label: "Log buffer size",
      description: "Adjust the device logcat ring buffer size.",
      category: "logging",
      control: "select",
      highRisk: false,
      options: [...LOG_BUFFER_OPTIONS],
    },
    meta: {
      type: "log_buffer",
      allowedValues: LOG_BUFFER_OPTIONS.map((item) => item.value),
    },
  },
  {
    definition: {
      key: "stay_on_while_plugged_in",
      label: "Stay awake while charging",
      description: "Keep screen awake when the device is charging.",
      category: "debugging",
      control: "toggle",
      highRisk: false,
    },
    meta: {
      type: "toggle",
      namespace: "global",
      settingKey: "stay_on_while_plugged_in",
      trueValue: "7",
      falseValue: "0",
    },
  },
  {
    definition: {
      key: "bluetooth_btsnoop_default_mode",
      label: "Bluetooth HCI snoop",
      description: "Capture Bluetooth HCI snoop logs.",
      category: "logging",
      control: "select",
      highRisk: false,
      options: [...BT_SNOOP_OPTIONS],
    },
    meta: {
      type: "select",
      namespace: "global",
      settingKey: "bluetooth_btsnoop_default_mode",
      allowedValues: BT_SNOOP_OPTIONS.map((item) => item.value),
      normalizeReadValue: normalizeBtSnoopValue,
    },
    fallbackReadCommands: ["settings get global bluetooth_btsnoop_log_mode"],
  },
  {
    definition: {
      key: "show_touches",
      label: "Show taps",
      description: "Display visual touch indicators on screen.",
      category: "input",
      control: "toggle",
      highRisk: false,
    },
    meta: {
      type: "toggle",
      namespace: "system",
      settingKey: "show_touches",
      trueValue: "1",
      falseValue: "0",
    },
  },
  {
    definition: {
      key: "pointer_location",
      label: "Pointer location",
      description: "Show touch coordinates and movement path.",
      category: "input",
      control: "toggle",
      highRisk: false,
    },
    meta: {
      type: "toggle",
      namespace: "system",
      settingKey: "pointer_location",
      trueValue: "1",
      falseValue: "0",
    },
  },
  {
    definition: {
      key: "window_animation_scale",
      label: "Window animation scale",
      description: "Animation scale for window transitions.",
      category: "animation",
      control: "select",
      highRisk: false,
      options: [...SCALE_OPTIONS],
    },
    meta: {
      type: "select",
      namespace: "global",
      settingKey: "window_animation_scale",
      allowedValues: SCALE_OPTIONS.map((item) => item.value),
      normalizeReadValue: normalizeScaleValue,
    },
  },
  {
    definition: {
      key: "transition_animation_scale",
      label: "Transition animation scale",
      description: "Animation scale for activity transitions.",
      category: "animation",
      control: "select",
      highRisk: false,
      options: [...SCALE_OPTIONS],
    },
    meta: {
      type: "select",
      namespace: "global",
      settingKey: "transition_animation_scale",
      allowedValues: SCALE_OPTIONS.map((item) => item.value),
      normalizeReadValue: normalizeScaleValue,
    },
  },
  {
    definition: {
      key: "animator_duration_scale",
      label: "Animator duration scale",
      description: "Animation duration scale for property animators.",
      category: "animation",
      control: "select",
      highRisk: false,
      options: [...SCALE_OPTIONS],
    },
    meta: {
      type: "select",
      namespace: "global",
      settingKey: "animator_duration_scale",
      allowedValues: SCALE_OPTIONS.map((item) => item.value),
      normalizeReadValue: normalizeScaleValue,
    },
  },
  {
    definition: {
      key: "always_finish_activities",
      label: "Don't keep activities",
      description: "Destroy every activity as soon as the user leaves it.",
      category: "lifecycle",
      control: "toggle",
      highRisk: false,
    },
    meta: {
      type: "toggle",
      namespace: "global",
      settingKey: "always_finish_activities",
      trueValue: "1",
      falseValue: "0",
    },
  },
  {
    definition: {
      key: "mobile_data_always_on",
      label: "Mobile data always active",
      description: "Keep mobile data active even on Wi-Fi.",
      category: "network",
      control: "toggle",
      highRisk: false,
    },
    meta: {
      type: "toggle",
      namespace: "global",
      settingKey: "mobile_data_always_on",
      trueValue: "1",
      falseValue: "0",
    },
  },
  {
    definition: {
      key: "development_settings_enabled",
      label: "Developer options",
      description: "Master switch for developer options.",
      category: "debugging",
      control: "toggle",
      highRisk: true,
    },
    meta: {
      type: "toggle",
      namespace: "global",
      settingKey: "development_settings_enabled",
      trueValue: "1",
      falseValue: "0",
    },
  },
  {
    definition: {
      key: "adb_enabled",
      label: "USB debugging",
      description: "Allow USB debugging for ADB.",
      category: "debugging",
      control: "toggle",
      highRisk: true,
    },
    meta: {
      type: "toggle",
      namespace: "global",
      settingKey: "adb_enabled",
      trueValue: "1",
      falseValue: "0",
    },
  },
  {
    definition: {
      key: "adb_wifi_enabled",
      label: "Wireless debugging",
      description: "Allow wireless debugging over network.",
      category: "debugging",
      control: "toggle",
      highRisk: true,
    },
    meta: {
      type: "toggle",
      namespace: "global",
      settingKey: "adb_wifi_enabled",
      trueValue: "1",
      falseValue: "0",
    },
  },
  {
    definition: {
      key: "verifier_verify_adb_installs",
      label: "Verify apps over USB",
      description: "Verify apps before installing via USB.",
      category: "debugging",
      control: "toggle",
      highRisk: true,
    },
    meta: {
      type: "toggle",
      namespace: "global",
      settingKey: "verifier_verify_adb_installs",
      trueValue: "1",
      falseValue: "0",
    },
  },
];

const OPTION_BY_KEY = new Map(OPTION_RECORDS.map((record) => [record.definition.key, record]));

const HIGH_RISK_OPTIONS = new Set<DeveloperOptionKey>(
  OPTION_RECORDS.filter((item) => item.definition.highRisk).map((item) => item.definition.key),
);

const TOGGLE_TRUE_VALUES = new Set(["1", "true", "on", "enabled", "yes"]);
const TOGGLE_FALSE_VALUES = new Set(["0", "false", "off", "disabled", "no"]);
const UNSUPPORTED_KEYWORDS = [
  "not found",
  "unknown",
  "invalid",
  "permission denied",
  "operation not supported",
  "securityexception",
  "does not exist",
  "can't find service",
];
const READ_TIMEOUT_KEYWORDS = ["timed out", "timeout"];
const READ_UNAUTHORIZED_KEYWORDS = ["unauthorized", "unauthorised"];
const READ_OFFLINE_KEYWORDS = ["device offline", "offline", "device not found", "no devices/emulators found"];

const LOG_BUFFER_SIZE_BYTES = new Map<string, number>([
  ["256K", 256 * 1024],
  ["1M", 1024 * 1024],
  ["4M", 4 * 1024 * 1024],
  ["16M", 16 * 1024 * 1024],
]);

const trimOutput = (value: string): string => value.trim();

function normalizeScaleValue(raw: string): string | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeBtSnoopValue(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value || value === "null") {
    return null;
  }
  if (value === "0" || value === "disabled") {
    return "disabled";
  }
  if (value === "1" || value === "filtered") {
    return "filtered";
  }
  if (value === "2" || value === "full") {
    return "full";
  }
  return null;
}

const parseLogBufferValue = (text: string): string | null => {
  const match = text.match(/ring buffer is\s+([0-9]+(?:\.[0-9]+)?)\s*([kmgti]?i?b?)/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const unit = (match[2] ?? "").toLowerCase();
  const multiplier =
    unit === "g" || unit === "gb" || unit === "gib"
      ? 1024 ** 3
      : unit === "m" || unit === "mb" || unit === "mib"
        ? 1024 ** 2
        : unit === "k" || unit === "kb" || unit === "kib"
          ? 1024
          : 1;

  const bytes = Math.round(value * multiplier);
  for (const [label, expectedBytes] of LOG_BUFFER_SIZE_BYTES.entries()) {
    if (expectedBytes === bytes) {
      return label;
    }
  }

  if (bytes % (1024 ** 2) === 0) {
    return `${bytes / (1024 ** 2)}M`;
  }
  if (bytes % 1024 === 0) {
    return `${bytes / 1024}K`;
  }
  return `${bytes}B`;
};

const parseToggleValue = (raw: string): boolean | null => {
  const value = raw.trim().toLowerCase();
  if (!value || value === "null") {
    return null;
  }
  if (TOGGLE_TRUE_VALUES.has(value)) {
    return true;
  }
  if (TOGGLE_FALSE_VALUES.has(value)) {
    return false;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 0;
  }
  return null;
};

const describeFailure = (result: CommandResult, fallback: string): string => {
  const stdout = trimOutput(result.stdout);
  const stderr = trimOutput(result.stderr);
  return stderr || stdout || fallback;
};

export const parseSettingsListOutput = (stdout: string): Record<string, string> => {
  const map: Record<string, string> = {};
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || line.startsWith("#")) {
        return;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        return;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (!key) {
        return;
      }
      map[key] = line.slice(separatorIndex + 1).trim();
    });
  return map;
};

export const normalizeDeveloperOptionReadFailure = (
  rawMessage: string,
): DeveloperOptionReadFailureInfo => {
  const message = rawMessage.trim();
  const lower = message.toLowerCase();
  const timedOut = READ_TIMEOUT_KEYWORDS.some((keyword) => lower.includes(keyword));
  const unauthorized = READ_UNAUTHORIZED_KEYWORDS.some((keyword) => lower.includes(keyword));
  const offline = READ_OFFLINE_KEYWORDS.some((keyword) => lower.includes(keyword));

  if (timedOut) {
    return {
      message: "Developer Options read timed out. Check device responsiveness and refresh.",
      timedOut: true,
      unauthorized: false,
      offline: false,
    };
  }

  if (unauthorized) {
    return {
      message: "Device authorization is required. Reconnect and accept the ADB prompt, then refresh.",
      timedOut: false,
      unauthorized: true,
      offline: false,
    };
  }

  if (offline) {
    return {
      message: "Device is offline. Reconnect the device and refresh.",
      timedOut: false,
      unauthorized: false,
      offline: true,
    };
  }

  return {
    message: "Read command failed on this device.",
    timedOut: false,
    unauthorized: false,
    offline: false,
  };
};

export const DEVELOPER_OPTIONS: DeveloperOptionDefinition[] = OPTION_RECORDS.map(
  (item) => item.definition,
);

export const createDeveloperOptionSnapshot = (): DeveloperOptionSnapshot => ({
  log_buffer_size: null,
  stay_on_while_plugged_in: null,
  bluetooth_btsnoop_default_mode: null,
  show_touches: null,
  pointer_location: null,
  window_animation_scale: null,
  transition_animation_scale: null,
  animator_duration_scale: null,
  always_finish_activities: null,
  mobile_data_always_on: null,
  development_settings_enabled: null,
  adb_enabled: null,
  adb_wifi_enabled: null,
  verifier_verify_adb_installs: null,
});

export const isHighRiskOption = (optionKey: DeveloperOptionKey): boolean =>
  HIGH_RISK_OPTIONS.has(optionKey);

export const getDeveloperOptionSettingsTarget = (
  optionKey: DeveloperOptionKey,
): DeveloperOptionSettingsTarget | null => {
  const record = OPTION_BY_KEY.get(optionKey);
  if (!record || record.meta.type === "log_buffer") {
    return null;
  }
  return {
    namespace: record.meta.namespace,
    settingKey: record.meta.settingKey,
  };
};

export const getDeveloperOptionSettingsKeysByNamespace = (): DeveloperOptionSettingsKeysByNamespace => {
  const byNamespace: DeveloperOptionSettingsKeysByNamespace = {
    global: [],
    system: [],
  };

  const seen = new Set<string>();
  OPTION_RECORDS.forEach((record) => {
    if (record.meta.type === "log_buffer") {
      return;
    }
    const key = `${record.meta.namespace}:${record.meta.settingKey}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    byNamespace[record.meta.namespace].push(record.meta.settingKey);
  });

  // Explicit fallback key for Bluetooth snoop modes on older Android/OEM builds.
  const btFallback = "bluetooth_btsnoop_log_mode";
  if (!byNamespace.global.includes(btFallback)) {
    byNamespace.global.push(btFallback);
  }

  return byNamespace;
};

export const buildDeveloperOptionSettingsProbeCommand = (
  namespace: DeveloperOptionSettingsNamespace,
  keys: readonly string[],
): string => {
  const safeKeys = keys.filter((key) => /^[A-Za-z0-9_.-]+$/.test(key));
  if (safeKeys.length === 0) {
    return "printf ''";
  }

  const joined = safeKeys.join(" ");
  return `for k in ${joined}; do v=\"$(settings get ${namespace} \"$k\" 2>/dev/null || true)\"; printf '%s=%s\\n' \"$k\" \"$v\"; done`;
};

export const buildReadCommands = (): DeveloperOptionReadCommand[] => {
  return OPTION_RECORDS.map((record) => {
    if (record.meta.type === "log_buffer") {
      return {
        optionKey: record.definition.key,
        command: "logcat -g 2>/dev/null || logcat -g",
      };
    }

    return {
      optionKey: record.definition.key,
      command: `settings get ${record.meta.namespace} ${record.meta.settingKey}`,
      ...(record.fallbackReadCommands && record.fallbackReadCommands.length
        ? { fallbackCommands: [...record.fallbackReadCommands] }
        : {}),
    };
  });
};

export const parseReadResult = (
  optionKey: DeveloperOptionKey,
  result: CommandResult,
): DeveloperOptionReadParse => {
  const record = OPTION_BY_KEY.get(optionKey);
  if (!record) {
    return {
      optionKey,
      supported: false,
      value: null,
      message: "Unknown option key.",
    };
  }

  const stdout = trimOutput(result.stdout);
  const stderr = trimOutput(result.stderr);

  if ((result.exit_code ?? 0) !== 0 && !stdout) {
    return {
      optionKey,
      supported: false,
      value: null,
      message: describeFailure(result, "Read command failed."),
    };
  }

  if (record.meta.type === "log_buffer") {
    const parsed = parseLogBufferValue(stdout || stderr);
    if (!parsed) {
      return {
        optionKey,
        supported: false,
        value: null,
        message: "Unable to parse log buffer size.",
      };
    }
    return {
      optionKey,
      supported: true,
      value: parsed,
    };
  }

  if (record.meta.type === "toggle") {
    const parsed = parseToggleValue(stdout);
    if (parsed == null) {
      return {
        optionKey,
        supported: false,
        value: null,
        message: stdout ? "Option is unavailable on this device." : "No value returned.",
      };
    }
    return {
      optionKey,
      supported: true,
      value: parsed,
    };
  }

  const rawValue = stdout;
  if (!rawValue || rawValue.toLowerCase() === "null") {
    return {
      optionKey,
      supported: false,
      value: null,
      message: "Option is unavailable on this device.",
    };
  }

  const normalized = record.meta.normalizeReadValue
    ? record.meta.normalizeReadValue(rawValue)
    : rawValue;
  if (normalized == null) {
    return {
      optionKey,
      supported: false,
      value: null,
      message: "Unexpected option value.",
    };
  }

  return {
    optionKey,
    supported: true,
    value: normalized,
  };
};

export const buildApplyCommand = (
  request: DeveloperOptionApplyRequest,
): DeveloperOptionCommandBuildResult => {
  const record = OPTION_BY_KEY.get(request.optionKey);
  if (!record) {
    return {
      ok: false,
      error: "Unknown option key.",
    };
  }

  if (record.meta.type === "toggle") {
    if (typeof request.value !== "boolean") {
      return {
        ok: false,
        error: `Option ${request.optionKey} requires a boolean value.`,
      };
    }
    const putValue = request.value ? record.meta.trueValue : record.meta.falseValue;
    return {
      ok: true,
      data: {
        optionKey: request.optionKey,
        normalizedValue: request.value,
        command: `settings put ${record.meta.namespace} ${record.meta.settingKey} ${putValue}`,
      },
    };
  }

  if (typeof request.value !== "string") {
    return {
      ok: false,
      error: `Option ${request.optionKey} requires a string value.`,
    };
  }

  if (!record.meta.allowedValues.includes(request.value)) {
    return {
      ok: false,
      error: `Value ${request.value} is not allowed for ${request.optionKey}.`,
    };
  }

  if (record.meta.type === "log_buffer") {
    return {
      ok: true,
      data: {
        optionKey: request.optionKey,
        normalizedValue: request.value,
        command: `logcat -G ${request.value}`,
      },
    };
  }

  return {
    ok: true,
    data: {
      optionKey: request.optionKey,
      normalizedValue: request.value,
      command: `settings put ${record.meta.namespace} ${record.meta.settingKey} ${request.value}`,
    },
  };
};

export const evaluateApplyResult = (
  result: CommandResult,
): DeveloperOptionCommandEvaluation => {
  const message = describeFailure(result, "Command failed.");
  const success = (result.exit_code ?? 0) === 0;
  if (success) {
    return {
      success: true,
      unsupported: false,
      message: message || "Applied.",
    };
  }

  const lower = message.toLowerCase();
  const unsupported = UNSUPPORTED_KEYWORDS.some((keyword) => lower.includes(keyword));
  return {
    success: false,
    unsupported,
    message,
  };
};
