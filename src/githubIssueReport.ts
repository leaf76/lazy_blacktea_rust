export type GithubIssuePrefillInput = {
  taskTitle: string;
  taskKind: string;
  serial: string;
  traceId?: string | null;
  message?: string | null;
  code?: string | null;
  exitCode?: number | null;
  outputPath?: string | null;
  diagnosticsPath?: string | null;
  diagnosticsError?: string | null;
  appVersion: string;
  osPlatform: string;
  adbVersion?: string | null;
};

export type GithubIssuePrefillPayload = {
  title: string;
  app_version: string;
  os: "macOS" | "Windows" | "Linux";
  adb_version: string;
  steps: string;
  expected: string;
  actual: string;
  logs: string;
};

const ISSUE_BASE_URL = "https://github.com/leaf76/lazy_blacktea_rust/issues/new";
const ISSUE_TEMPLATE = "bug_report.yml";
const DEFAULT_VALUE = "--";
const MAX_TITLE_LEN = 96;
const MAX_ACTUAL_LEN = 1200;
const MAX_LOGS_LEN = 4000;
const MAX_MESSAGE_LEN = 1200;

const toSingleLine = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeField = (value: string | null | undefined, fallback = DEFAULT_VALUE) => {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
};

const clampText = (value: string, maxLen: number) => {
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLen - 1))}…`;
};

export const mapOsToIssueOption = (platform: string): "macOS" | "Windows" | "Linux" => {
  const normalized = platform.trim().toLowerCase();
  if (normalized.includes("mac") || normalized.includes("darwin")) {
    return "macOS";
  }
  if (normalized.includes("win")) {
    return "Windows";
  }
  return "Linux";
};

export const buildIssuePrefillPayload = (
  input: GithubIssuePrefillInput,
): GithubIssuePrefillPayload => {
  const taskTitle = toSingleLine(normalizeField(input.taskTitle, "Operation"));
  const serial = toSingleLine(normalizeField(input.serial, "unknown-device"));
  const traceId = normalizeField(input.traceId);
  const taskKind = normalizeField(input.taskKind);
  const errorCode = normalizeField(input.code);
  const adbVersion = normalizeField(input.adbVersion);
  const appVersion = normalizeField(input.appVersion);
  const outputPath = normalizeField(input.outputPath);
  const errorMessage = normalizeField(input.message, "Unknown error");

  const steps = [
    "1. Open lazy_blacktea_rust.",
    `2. Run "${taskTitle}" on "${serial}".`,
    "3. Open Task Center and locate the failed row.",
    "4. Click Report to GitHub.",
  ].join("\n");

  const expected = "The selected operation should complete without errors.";
  const actual = clampText(
    [
      `Task "${taskTitle}" failed on "${serial}".`,
      `Kind: ${taskKind}.`,
      `Error: ${errorMessage}.`,
      `Code: ${errorCode}.`,
    ].join("\n"),
    MAX_ACTUAL_LEN,
  );

  const logs: string[] = [
    `trace_id: ${traceId}`,
    `task_kind: ${taskKind}`,
    `serial: ${serial}`,
    `error_code: ${errorCode}`,
    `exit_code: ${input.exitCode == null ? DEFAULT_VALUE : String(input.exitCode)}`,
    `output_path: ${outputPath}`,
    `adb_version: ${adbVersion}`,
    `error_message: ${clampText(errorMessage, MAX_MESSAGE_LEN)}`,
  ];

  if (input.diagnosticsPath && input.diagnosticsPath.trim()) {
    logs.push(`diagnostics_bundle: ${input.diagnosticsPath.trim()}`);
  } else {
    logs.push("diagnostics_bundle: unavailable");
  }
  if (input.diagnosticsError && input.diagnosticsError.trim()) {
    logs.push(`diagnostics_error: ${input.diagnosticsError.trim()}`);
  }

  const titleBody = clampText(toSingleLine(`${taskTitle} failed on ${serial}`), MAX_TITLE_LEN);

  return {
    title: `[Bug]: ${titleBody}`,
    app_version: appVersion,
    os: mapOsToIssueOption(input.osPlatform),
    adb_version: adbVersion,
    steps,
    expected,
    actual,
    logs: clampText(logs.join("\n"), MAX_LOGS_LEN),
  };
};

export const buildGithubBugIssueUrl = (input: GithubIssuePrefillInput): string => {
  const payload = buildIssuePrefillPayload(input);
  const query = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title: payload.title,
    app_version: payload.app_version,
    os: payload.os,
    adb_version: payload.adb_version,
    steps: payload.steps,
    expected: payload.expected,
    actual: payload.actual,
    logs: payload.logs,
  });
  return `${ISSUE_BASE_URL}?${query.toString()}`;
};
