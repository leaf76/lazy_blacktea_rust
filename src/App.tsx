import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { ApkInspectionCard } from "./ApkInspectionCard";
import { CommandPaletteModal } from "./CommandPaletteModal";
import { DeviceUtilitiesPanel } from "./DeviceUtilitiesPanel";
import { ShortcutsOverlayModal } from "./ShortcutsOverlayModal";
import {
  buildDevicePaletteItems,
  buildRecentTaskPaletteItems,
  isEditableKeyboardTarget,
  type CommandPaletteItem,
} from "./commandPalette";
import {
  matchesDeviceQuickFilters,
  type DeviceQuickFilterId,
} from "./deviceQuickFilters";
import {
  createLogcatRecordingSyncSession,
  finalizeLogcatRecordingSyncSession,
  sliceLogcatLinesForRecording,
  type LogcatRecordingSyncSession,
} from "./logcatRecordingSync";
import {
  formatApkInstallFailureMessage,
  resolveApkInstallEventPatch,
  type ApkInstallEventPayload,
} from "./apkInspector";
import { getAdbIssueRecoveryMessages } from "./adbIssues";
import { isTauriRuntime } from "./tauriEnv";
import {
  getDesktopNotificationPermission,
  isAppUnfocused,
  requestDesktopNotificationPermission,
  sendDesktopNotification,
  type DesktopNotificationPermissionState,
} from "./desktopNotifications";
import type {
  AdbInfo,
  ApkInfo,
  AppConfig,
  AppBasicInfo,
  AdbCommandLibrarySettings,
  AppInfo,
  BugreportExtractIndexSummary,
  BugreportExtractTemplateKind,
  BugreportLogFilters,
  BugreportLogRow,
  BugreportLogSummary,
  BugreportResult,
  DeviceFileEntry,
  DeviceInfo,
  DashboardCardId,
  DashboardFieldId,
  DashboardSettings,
  FilePreview,
  IosProfileInstallResult,
  IosToolsInfo,
  LegacyLogcatPreset,
  LogcatEvent,
  MobileconfigSummary,
  NetProfilerEvent,
  PerfEvent,
  ScreenRecordStatus,
  TerminalEvent,
  ThemeBackgroundSource,
  ThemeStyleSettings,
  ScrcpyInfo,
} from "./types";
import {
  adbConnect,
  adbPair,
  adbServerControl,
  cancelApkInstall,
  cancelBugreport,
  captureScreenshot,
  captureUiHierarchy,
  checkAdb,
  checkIosTools,
  checkScrcpy,
  clearAppData,
  clearLogcat,
  exportDiagnosticsBundle,
  exportIosCrashReports,
  getAppBasicInfo,
  getAppIcon,
  getIosSyslogStatus,
  getLogcatStatus,
  exportLogcat,
  exportUiHierarchy,
  forceStopApp,
  generateBugreport,
  getConfig,
  getScreenRecordStatus,
  importThemeBackground,
  inspectApk,
  installApkBatch,
  installIosConfigurationProfile,
  launchApp,
  launchScrcpy,
  mkdirDeviceDir,
  prepareBugreportExtractIndex,
  prepareBugreportLogcat,
  deleteDevicePath,
  listApps,
  listDeviceFiles,
  listDevices,
  loadLegacyLogcatPresets,
  openAppInfo,
  previewLocalFile,
  pullDeviceFile,
  pushDeviceFile,
  queryBugreportExtract,
  renameDevicePath,
  rebootDevices,
  resetConfig,
  runShell,
  startPerfMonitor,
  startDeviceTracking,
  startNetProfiler,
  setNetProfilerPinnedUids,
  startTerminalSession,
  stopDeviceTracking,
  stopTerminalSession,
  stopPerfMonitor,
  stopNetProfiler,
  writeTerminalSession,
  persistTerminalState,
  queryBugreportLogcat,
  saveConfig,
  setAppEnabled,
  setBluetoothState,
  setWifiState,
  startBluetoothMonitor,
  startIosSyslog,
  startLogcat,
  startScreenRecord,
  stopBluetoothMonitor,
  stopIosSyslog,
  stopLogcat,
  stopScreenRecord,
  uninstallApp,
  validateMobileconfig,
} from "./api";
import {
  buildAdbCommandRunErrorResult,
  buildAdbCommandRunResult,
  normalizeAdbCommandLibrarySettings,
  type AdbCommandRunResult,
  type AdbCommandLibraryEntry,
} from "./adbCommandLibrary";
import {
  appendRetainedLogcatEntries,
  buildLogcatFilter,
  buildSearchRegex,
  defaultLogcatLevels,
  filterLogcatEntriesByBaseFilters,
  filterLogcatEntriesBySearch,
  isLogcatBaseFilterActive,
  mergeLogcatEntriesById,
  parsePidOutput,
  type LogcatBaseFilterState,
  type LogcatLevelsState,
  type LogcatSourceMode,
} from "./logcat";
import { LOG_LEVELS } from "./logLevels";
import {
  addLogTextChip,
  buildLogTextFilters,
  removeLogTextChip,
  type LogTextChip,
  type LogTextChipKind,
} from "./logTextFilters";
import {
  buildDashboardCardViews,
  buildDefaultDashboardSettings,
  getDashboardFieldLabel,
  moveDashboardField,
  normalizeDashboardSettings,
  resolveDashboardPrimaryDeviceParts,
  toggleDashboardCard,
  toggleDashboardField,
  type DashboardCardView,
} from "./dashboardConfig";
import {
  buildDashboardCardMarkdown,
  buildDashboardPlainValueText,
  buildDashboardVisibleMarkdown,
} from "./dashboardCopy";
import {
  initialPairingState,
  pairingReducer,
  parseAdbPairOutput,
  parseQrPayload,
} from "./pairing";
import {
  createInitialTaskState,
  createTask,
  finalizeRestoredTaskState,
  inflateStoredTaskState,
  parseStoredTaskState,
  sanitizeTaskStateForStorage,
  summarizeTask,
  tasksReducer,
  type TaskItem,
  type TaskKind,
  type TaskStatus,
} from "./tasks";
import {
  APP_ERROR_RECORDED_EVENT,
  ERROR_RECORDS_STORAGE_KEY,
  createInitialErrorState,
  errorRecordsReducer,
  inflateStoredErrorState,
  normalizeStructuredError,
  parseStoredErrorState,
  recordExternalAppError,
  sanitizeErrorStateForStorage,
  type ErrorRecord,
} from "./errorRecords";
import {
  buildDesktopNotificationForTask,
  buildTaskCompletionNotice,
  detectNewlyCompletedTasks,
  type TaskCompletionNotice,
} from "./taskNotificationRules";
import {
  DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS,
  applyGroupAssignment,
  applyDeviceDetailPatch,
  buildDeviceInfoCopyItems,
  buildDeviceGroupOptions,
  buildIosToolGuidanceRows,
  buildTopbarOverview,
  buildDeviceQuickMenuActions,
  computeContextMenuLayout,
  computeContextSubmenuLayout,
  filterDevicesBySearch,
  flattenDeviceGroups,
  countAvailableIosTools,
  countIosToolsTotal,
  getIosConfigurationProfileEligibleSerials,
  getIosCrashReportEligibleSerials,
  formatPrimaryDeviceLabel,
  getDevicePlatform,
  hasDeviceCapability,
  normalizeDeviceItemInfoFieldIds,
  reduceSelectionToOne,
  resolveDeviceQuickMenuSelection,
  resolveHostOs,
  resolvePrimarySerial,
  resolveSelectedSerials,
  setPrimarySelection,
  shouldCloseContextMenuOnScroll,
  splitDeviceSerialsByPlatform,
  withDeviceGroups,
  type DeviceContextActionId,
  type DeviceInfoCopyItem,
  type DeviceItemInfoFieldId,
  type DeviceQuickMenuSource,
} from "./deviceUtils";
import {
  clampRetentionTimeoutSec,
  dismissRetainedDevice,
  markDevicesForReboot,
  reconcileDevicesWithRetention,
  tickRetentionRecords,
  type DeviceRetentionConfig,
  type DeviceRetentionRecord,
} from "./deviceRetention";
import {
  buildConfigWithThemeStyleUpdate,
  buildThemeCssVariables,
  mergeSavedThemeBackgroundSourceIntoDraft,
  normalizeThemeFontSize,
  normalizeThemeStyleSettings,
  normalizeUiDensity,
  resolveThemeCopy,
} from "./theme";
import { clampRefreshIntervalSec, getIosAutoRefreshIntervalMs } from "./deviceAutoRefresh";
import {
  LOGCAT_INACTIVITY_EVENTS,
  LOGCAT_INACTIVITY_TIMEOUT_MS,
  getRunningLogcatSerials,
  hasLogcatInactivityTimedOut,
  normalizeLogcatLastActivityAt,
} from "./logcatInactivity";
import {
  findRunningBugreportTaskIdForSerial,
  resolveBugreportPanelTaskId,
} from "./bugreportTaskRecovery";
import {
  buildBugreportDeviceCards,
  getBugreportGenerateLabel,
  summarizeBugreportCards,
  type BugreportCardStatus,
} from "./bugreportPage";
import { parseUiNodes, pickUiNodeAtPoint } from "./ui_bounds";
import { buildUiInspectorXmlView, filterUiInspectorXmlLines } from "./uiInspectorXml";
import {
  applyDroppedPaths,
  sanitizeMultiPathsForStorage,
  sanitizeStoredState,
} from "./apkInstallerState";
import { buildGithubBugIssueUrl } from "./githubIssueReport";
import { openGithubIssueUrl } from "./githubIssueOpener";
import {
  buildLogcatPopupHash,
  buildLogcatPopupWindowLabel,
  parseLogcatPopupContext,
} from "./logcatWindow";
import {
  buildBugreportPopupHash,
  buildBugreportPopupWindowLabel,
  parseBugreportPopupContext,
} from "./bugreportWindow";
import {
  buildScreenRecordActionMeta,
  buildScreenRecordSelectionStatus,
  type ScreenRecordPendingAction,
} from "./screenRecord";
import {
  buildDeviceCommandStatusStack,
  buildDeviceQuickActionButtonLabel,
  buildDeviceQuickActionSelectionStatus,
  type DeviceQuickActionKind,
  type DeviceQuickActionPhase,
  type DeviceQuickActionStatus,
} from "./deviceActionStatus";
import {
  checkForUpdate,
  installUpdateAndRelaunch,
  markUpdatePromptDismissed,
  readUpdateLastCheckedMs,
  shouldPromptForUpdateVersion,
  shouldAutoCheck,
  type UpdateCheckResult,
  type UpdaterUpdateLike,
} from "./updater";
import { buildLogcatPopupCandidates, partitionLogcatPopupTargets } from "./logcatPopup";
import {
  BUGREPORT_CUSTOM_VIEW_TEMPLATE_KINDS,
  BUGREPORT_CUSTOM_VIEWS_STORAGE_KEY,
  DEFAULT_BUGREPORT_CUSTOM_VIEW_GROUP,
  groupBugreportCustomViews,
  hasBugreportCustomViewNameConflict,
  makeBugreportCustomViewId,
  parseBugreportCustomViewsFromStorage,
  type ActiveBugreportCustomViewSession,
  type BugreportCustomViewTemplate,
} from "./bugreportCustomViews";
import {
  type BatchActionMeta,
  buildConnectivityActionMeta,
  buildFanOutActionMeta,
  buildSingletonActionMeta,
} from "./batchActions";
import {
  DEVELOPER_OPTIONS,
  buildDeveloperOptionSettingsProbeCommand,
  buildApplyCommand,
  buildReadCommands,
  createDeveloperOptionSnapshot,
  evaluateApplyResult,
  getDeveloperOptionSettingsTarget,
  getDeveloperOptionSettingsKeysByNamespace,
  isHighRiskOption,
  normalizeDeveloperOptionReadFailure,
  parseSettingsListOutput,
  parseReadResult,
  type DeveloperOptionDefinition,
  type DeveloperOptionKey,
  type DeveloperOptionSnapshot,
  type DeveloperOptionValue,
} from "./developerOptions";
import type { DeveloperOptionsGroup } from "./DeveloperOptionsPage";
import {
  buildMatrixSerialSet,
  buildDeveloperOptionBatchPlan,
  buildDeveloperOptionDivergenceRows,
  countPendingDeveloperOptions,
  createDeveloperOptionDeviceSnapshot,
  createDeveloperOptionsMatrixState,
  pruneDeveloperOptionsMatrixState,
  resolveDeveloperOptionsMatrixStaleMessage,
  resolveDeveloperOptionsPrimaryAutoReadKey,
  resolveDeveloperOptionsMatrixSerials,
  resolveDeveloperOptionsScope,
  setPendingDeveloperOptionValue,
  shouldMarkMatrixStaleAfterApply,
  type DeveloperOptionBatchChange,
  type DeveloperOptionDeviceReadStatus,
  type DeveloperOptionPendingMap,
  type DeveloperOptionsApplyMode,
  type DeveloperOptionsMatrixLogBufferState,
  type DeveloperOptionsMatrixRefreshMode,
  type DeveloperOptionsMatrixStaleReason,
  type DeveloperOptionsMatrixState,
} from "./developerOptionsUiState";
import { BugreportLogOutput } from "./components/BugreportLogOutput";
import {
  DeviceTerminalPanel,
  appendTerminalBuffer,
  type TerminalDeviceState,
} from "./components/DeviceTerminalPanel";
import {
  LOGCAT_LINE_HEIGHT_PX,
  LOGCAT_OUTPUT_PADDING_PX,
  type LogcatLineEntry,
} from "./components/LogcatOutput";
import { AdvancedToggleButton, LogLiveFilterBar } from "./components/LogLiveFilterBar";
import { renderHighlightedSnippet } from "./components/logHighlighting";
import {
  EMPTY_NET_PROFILER_STATE,
  NetworkBreakdownPanel,
  type NetProfilerState,
} from "./components/NetworkBreakdownPanel";
import {
  EMPTY_PERF_MONITOR_STATE,
  PerformancePage,
  type PerfMonitorState,
} from "./components/PerformancePage";
import { AppsPage, getAppDisplayName, getAppIconKey } from "./pages/AppsPage";
import type { DeviceCatalogActionEntry } from "./pages/DevicesPage";
import { FilesPage, getFileKind } from "./pages/FilesPage";
import type { UpdateUiStatus } from "./pages/SettingsPage";
import appPackage from "../package.json";
import "./App.css";

type Toast = { id: string; message: string; tone: "info" | "error" };
type BugreportProgress = { serial: string; progress: number; trace_id: string };
type FileTransferProgress = {
  serial: string;
  direction: string;
  progress?: number | null;
  message?: string | null;
  trace_id: string;
};
type ApkInstallEvent = ApkInstallEventPayload;
type DeviceTrackingSnapshotPayload = { trace_id: string; devices: DeviceInfo[] };
type RebootMode = "normal" | "recovery" | "bootloader";
const ACTIONS_SHELL_TABS = [
  { id: "adb-shell", label: "ADB Shell" },
  { id: "shell", label: "Shell" },
  { id: "utilities", label: "Utilities" },
] as const;
type ActionsShellTabId = (typeof ACTIONS_SHELL_TABS)[number]["id"];

const TERMINAL_MAX_LINES = 500;
const NET_PROFILER_MAX_SAMPLES = 180;
const DEVICE_QUICK_ACTION_STATUS_TTL_MS = 3000;
const BUGREPORT_LOG_LOAD_PAGE_SIZE = 500;
const BUGREPORT_LOG_LOAD_ALL_MAX_ROWS = 20_000;
const APK_INSTALLER_STORAGE_KEY = "lazy_blacktea_apk_installer_v1";
const SHARED_LOG_FILTERS_STORAGE_KEY = "lazy_blacktea_shared_log_filters_v1";
const LOGCAT_PRESETS_STORAGE_KEY = "logcat_presets";
const LOGCAT_PRESETS_LEGACY_MIGRATION_KEY = "lazy_blacktea_logcat_presets_migrated_v1";
const BUGREPORT_PRESETS_STORAGE_KEY = "bugreport_log_presets_v1";
// TODO: Re-enable this entry after product discussion for extract-style custom views.
const BUGREPORT_CUSTOM_VIEW_ENTRY_VISIBLE = false;

const BUGREPORT_STATUS_LABEL: Record<BugreportCardStatus, string> = {
  idle: "Idle",
  running: "Running",
  success: "Success",
  error: "Error",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

const BUGREPORT_STATUS_TONE: Record<BugreportCardStatus, "idle" | "busy" | "ok" | "warn" | "error"> = {
  idle: "idle",
  running: "busy",
  success: "ok",
  error: "error",
  cancelled: "warn",
  interrupted: "warn",
};

const createDeveloperOptionSupportMap = (value: boolean): Record<DeveloperOptionKey, boolean> => {
  const map = {} as Record<DeveloperOptionKey, boolean>;
  DEVELOPER_OPTIONS.forEach((option) => {
    map[option.key] = value;
  });
  return map;
};

const createDeveloperOptionMessageMap = (): Record<DeveloperOptionKey, string | null> => {
  const map = {} as Record<DeveloperOptionKey, string | null>;
  DEVELOPER_OPTIONS.forEach((option) => {
    map[option.key] = null;
  });
  return map;
};

const formatDeveloperOptionValueLabel = (value: DeveloperOptionValue): string => {
  if (typeof value === "boolean") {
    return value ? "On" : "Off";
  }
  if (typeof value === "string") {
    return value;
  }
  return "Unknown";
};

const quoteShellCommandForAdbSh = (command: string): string => {
  const escaped = command.replace(/'/g, `'\"'\"'`);
  return `'${escaped}'`;
};

const runWithConcurrencyLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> => {
  if (items.length === 0) {
    return [];
  }

  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const runner = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      try {
        const value = await worker(items[index], index);
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runner()));
  return results;
};

type DeveloperOptionCategory = DeveloperOptionDefinition["category"];

const DEVELOPER_OPTION_CATEGORY_ORDER: DeveloperOptionCategory[] = [
  "debugging",
  "logging",
  "input",
  "animation",
  "lifecycle",
  "network",
];

const DEVELOPER_OPTION_CATEGORY_LABEL: Record<DeveloperOptionCategory, string> = {
  debugging: "Debugging",
  logging: "Logging",
  input: "Input",
  animation: "Animation",
  lifecycle: "Lifecycle",
  network: "Network",
};

const LazyDeveloperOptionsPage = lazy(() => import("./DeveloperOptionsPage"));
const LazyBluetoothMonitorPage = lazy(async () => {
  const module = await import("./BluetoothMonitorPage");
  return { default: module.BluetoothMonitorPage };
});
const LazyUiInspectorPage = lazy(() => import("./UiInspectorPage"));
const LazyBugreportPage = lazy(() => import("./BugreportMainPage"));
// Behind the "ADB Shell" actions tab; lazy-loaded to keep the ~24KB panel out of the initial chunk.
const LazyAdbCommandLibraryPanel = lazy(async () => {
  const module = await import("./AdbCommandLibraryPanel");
  return { default: module.AdbCommandLibraryPanel };
});
const LazyDevicesPage = lazy(async () => {
  const module = await import("./pages/DevicesPage");
  return { default: module.DevicesPage };
});
const LazyLogcatPage = lazy(async () => {
  const module = await import("./pages/LogcatPage");
  return { default: module.LogcatPage };
});
const LazySettingsPage = lazy(async () => {
  const module = await import("./pages/SettingsPage");
  return { default: module.SettingsPage };
});

// Stable wrapper for route content. The per-route views are defined inside App() (so they close
// over its state), which means using them directly as `element={<View />}` gives React a brand-new
// component type on every render and forces a full unmount/remount of the active page (losing DOM,
// scroll position, focus and child state). Routing through this stable component instead makes
// React reconcile the page in place. The views call no hooks, so invoking them as functions here
// is safe, and only the matched route's `render` actually runs.
const RouteView = ({ render }: { render: () => ReactNode }) => <>{render()}</>;

// Adds Escape-to-close for an open dialog/modal. Mirrors the existing context-menu dismissal
// behavior and is safe to compose with each modal's existing backdrop-click close handler.
function useEscapeToClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);
}

type StoredSharedLogFiltersV1 = {
  levels?: Record<string, unknown>;
  text_chips?: unknown;
};

function loadSharedLogFiltersFromStorage(): { levels: LogcatLevelsState; textChips: LogTextChip[] } {
  const fallback = { levels: { ...defaultLogcatLevels }, textChips: [] };
  try {
    const raw = localStorage.getItem(SHARED_LOG_FILTERS_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as StoredSharedLogFiltersV1;
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }
    const levels: LogcatLevelsState = { ...defaultLogcatLevels };
    if (parsed.levels && typeof parsed.levels === "object") {
      for (const level of LOG_LEVELS) {
        const value = parsed.levels[level];
        if (typeof value === "boolean") {
          levels[level] = value;
        }
      }
    }

    let textChips: LogTextChip[] = [];
    if (Array.isArray(parsed.text_chips)) {
      for (const item of parsed.text_chips.slice(0, 50)) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const kind = (item as { kind?: unknown }).kind;
        const value = (item as { value?: unknown }).value;
        if ((kind === "include" || kind === "exclude") && typeof value === "string") {
          textChips = addLogTextChip(textChips, kind, value);
        }
      }
    }

    return { levels, textChips };
  } catch (error) {
    console.warn("Failed to load shared log filters from storage.", error);
    return fallback;
  }
}

const normalizePresetLevels = (levels?: LogcatLevelsState): LogcatLevelsState => ({
  ...defaultLogcatLevels,
  ...(levels ?? {}),
});

const areStringArraysEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

const areLogLevelsEqual = (left: LogcatLevelsState, right: LogcatLevelsState) =>
  LOG_LEVELS.every((level) => left[level] === right[level]);

const summarizeLogLevels = (levels: LogcatLevelsState) => {
  const enabled = LOG_LEVELS.filter((level) => levels[level]);
  if (enabled.length === LOG_LEVELS.length) {
    return "All";
  }
  if (enabled.length === 0) {
    return "None";
  }
  return enabled.join(" ");
};

const normalizeBugreportTimestamp = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}$/.test(trimmed) ? trimmed : null;
};

const normalizeBugreportRegexPatterns = (patterns: string[]) =>
  patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .filter((pattern) => {
      try {
        // Keep bugreport filtering behavior aligned with case-insensitive regex matching.
        // eslint-disable-next-line no-new
        new RegExp(pattern, "i");
        return true;
      } catch {
        return false;
      }
    });

const LOGCAT_RAW_BUFFER_LIMIT = 2000;
const LOGCAT_RETAINED_LIMIT = 20000;
const DEVICE_TRACKING_MAX_NO_SNAPSHOT_RESTARTS = 3;
const DEVICE_TRACKING_RESTART_WINDOW_MS = 60_000;
const EMPTY_PINNED_UIDS: number[] = [];

function App() {
  type LogcatFilterPreset = LegacyLogcatPreset & {
    levels?: LogcatLevelsState;
  };
  type BugreportFilterPreset = LogcatFilterPreset & {
    buffer?: string;
    tag?: string;
    pid?: string;
    start?: string;
    end?: string;
  };
  type PresetContext = "logcat" | "bugreport";
  type BugreportCustomViewEditor = {
    id: string | null;
    group: string;
    name: string;
    templateKind: BugreportExtractTemplateKind;
    defaultInput: string;
  };
  type DeveloperOptionsConfirmChange = {
    optionKey: DeveloperOptionKey;
    label: string;
    value: DeveloperOptionValue;
    highRisk: boolean;
  };
  type DeveloperOptionsConfirmModal = {
    mode: "single" | "batch";
    changes: DeveloperOptionsConfirmChange[];
    highRiskChanges: DeveloperOptionsConfirmChange[];
    targetCount: number;
    skippedCount: number;
  };

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [retentionMap, setRetentionMap] = useState<Record<string, DeviceRetentionRecord>>({});
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [developerOptionsSnapshot, setDeveloperOptionsSnapshot] = useState<DeveloperOptionSnapshot>(
    createDeveloperOptionSnapshot(),
  );
  const [developerOptionSupportedByKey, setDeveloperOptionSupportedByKey] = useState<
    Record<DeveloperOptionKey, boolean>
  >(createDeveloperOptionSupportMap(false));
  const [developerOptionMessageByKey, setDeveloperOptionMessageByKey] = useState<
    Record<DeveloperOptionKey, string | null>
  >(createDeveloperOptionMessageMap());
  const [developerOptionsLoading, setDeveloperOptionsLoading] = useState(false);
  const [developerOptionsRefreshing, setDeveloperOptionsRefreshing] = useState(false);
  const [developerOptionsError, setDeveloperOptionsError] = useState<string | null>(null);
  const [developerOptionsApplyMode, setDeveloperOptionsApplyMode] =
    useState<DeveloperOptionsApplyMode>("primary_instant");
  const [developerOptionPendingByKey, setDeveloperOptionPendingByKey] = useState<DeveloperOptionPendingMap>({});
  const [developerOptionsLastReadAt, setDeveloperOptionsLastReadAt] = useState<number | null>(null);
  const [developerOptionsMatrixState, setDeveloperOptionsMatrixState] =
    useState<DeveloperOptionsMatrixState>(createDeveloperOptionsMatrixState());
  const [developerOptionsMatrixRefreshing, setDeveloperOptionsMatrixRefreshing] = useState(false);
  const [developerOptionsMatrixRefreshMode, setDeveloperOptionsMatrixRefreshMode] =
    useState<DeveloperOptionsMatrixRefreshMode>("fast");
  const [developerOptionsMatrixLogBufferState, setDeveloperOptionsMatrixLogBufferState] =
    useState<DeveloperOptionsMatrixLogBufferState>("idle");
  const [developerOptionsMatrixLogBufferError, setDeveloperOptionsMatrixLogBufferError] = useState<string | null>(null);
  const [developerOptionsMatrixLogBufferLastReadAt, setDeveloperOptionsMatrixLogBufferLastReadAt] =
    useState<number | null>(null);
  const [developerOptionsMatrixStale, setDeveloperOptionsMatrixStale] = useState(false);
  const [developerOptionsMatrixStaleReason, setDeveloperOptionsMatrixStaleReason] =
    useState<DeveloperOptionsMatrixStaleReason | null>(null);
  const [developerOptionsMatrixStaleAt, setDeveloperOptionsMatrixStaleAt] = useState<number | null>(null);
  const [developerOptionsBatchApplying, setDeveloperOptionsBatchApplying] = useState(false);
  const [developerOptionsApplyingKey, setDeveloperOptionsApplyingKey] = useState<DeveloperOptionKey | null>(null);
  const [developerOptionsConfirmModal, setDeveloperOptionsConfirmModal] =
    useState<DeveloperOptionsConfirmModal | null>(null);
  const developerOptionsRefreshTokenRef = useRef(0);
  const developerOptionsMatrixRefreshTokenRef = useRef(0);
  const developerOptionsPrimaryAutoReadKeyRef = useRef<string | null>(null);
  const developerOptionsSelectionSignatureRef = useRef<string | null>(null);
  type DeviceSelectionMode = "single" | "multi";
  const DEVICE_SELECTION_MODE_STORAGE_KEY = "lazy_blacktea_device_selection_mode_v1";
  const DEVICE_ITEM_INFO_FIELDS_STORAGE_KEY = "lazy_blacktea_device_item_info_fields_v1";
  const [deviceSelectionMode, setDeviceSelectionMode] = useState<DeviceSelectionMode>(() => {
    try {
      const raw = localStorage.getItem(DEVICE_SELECTION_MODE_STORAGE_KEY);
      return raw === "single" || raw === "multi" ? raw : "multi";
    } catch (error) {
      console.warn("Failed to load device selection mode from storage.", error);
      return "multi";
    }
  });
  const [deviceItemInfoFieldIds, setDeviceItemInfoFieldIds] = useState<DeviceItemInfoFieldId[]>(() => {
    try {
      const raw = localStorage.getItem(DEVICE_ITEM_INFO_FIELDS_STORAGE_KEY);
      return raw ? normalizeDeviceItemInfoFieldIds(JSON.parse(raw)) : [...DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS];
    } catch (error) {
      console.warn("Failed to load device item info fields from storage.", error);
      return [...DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS];
    }
  });
  const [terminalBySerial, setTerminalBySerial] = useState<Record<string, TerminalDeviceState>>({});
  const [terminalBroadcast, setTerminalBroadcast] = useState("");
  const [terminalActiveSerials, setTerminalActiveSerials] = useState<string[]>([]);
  const [activeActionsShellTab, setActiveActionsShellTab] = useState<ActionsShellTabId>("adb-shell");
  const terminalSessionIdBySerialRef = useRef<Record<string, string | null>>({});
  const terminalActiveSerialsRef = useRef<string[]>([]);
  const terminalBySerialRef = useRef<Record<string, TerminalDeviceState>>({});
  const terminalPendingRef = useRef<Record<string, string>>({});
  const terminalFlushTimerRef = useRef<number | null>(null);
  const terminalPersistTimerRef = useRef<number | null>(null);
  const terminalPersistInFlightRef = useRef(false);
  const terminalLoadedRef = useRef(false);
  const didRestoreTerminalRef = useRef(false);
  const didInitialDeviceRefreshRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [appVersion, setAppVersion] = useState(appPackage.version);
  const appVersionLabel = appVersion.trim() || "--";
  const UPDATE_AUTO_CHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const [updateStatus, setUpdateStatus] = useState<UpdateUiStatus>("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<UpdaterUpdateLike | null>(null);
  const [updatePublishingVersion, setUpdatePublishingVersion] = useState<string | null>(null);
  const [updateLastCheckedMs, setUpdateLastCheckedMs] = useState<number | null>(() => readUpdateLastCheckedMs());
  const [updateLastCheckSource, setUpdateLastCheckSource] = useState<"auto" | "manual" | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [taskCompletionNotices, setTaskCompletionNotices] = useState<TaskCompletionNotice[]>([]);
  const [taskCompletionPathsExpanded, setTaskCompletionPathsExpanded] = useState(false);
  const updatePublishingMessage = updatePublishingVersion
    ? `Latest: ${updatePublishingVersion}. Update artifacts are still publishing. Please try again shortly.`
    : "A newer release is available, but update artifacts are still publishing. Please try again shortly.";
  const showUpdateCheckAgainAction =
    updateStatus === "publishing_pending" ||
    (updateStatus === "checking" &&
      !updateAvailable &&
      updateLastCheckSource === "manual" &&
      updatePublishingVersion !== null);
  const applyUpdateCheckResult = (source: "auto" | "manual", result: UpdateCheckResult) => {
    if (result.status === "update_available") {
      setUpdateAvailable(result.update);
      setUpdatePublishingVersion(null);
      setUpdateError(null);
      setUpdateStatus("update_available");
      if (source === "manual" || shouldPromptForUpdateVersion(result.update.version)) {
        setUpdateModalOpen(true);
      }
      return;
    }

    if (result.status === "publishing_pending") {
      setUpdateAvailable(null);
      if (source === "manual") {
        setUpdatePublishingVersion(result.latestVersion ?? null);
        setUpdateStatus("publishing_pending");
        setUpdateError(null);
        return;
      }

      setUpdatePublishingVersion(null);
      setUpdateStatus("idle");
      setUpdateError(null);
      return;
    }

    if (result.status === "error") {
      setUpdateAvailable(null);
      setUpdatePublishingVersion(null);
      if (source === "manual") {
        setUpdateStatus("error");
        setUpdateError(result.message);
        return;
      }

      setUpdateStatus("idle");
      setUpdateError(null);
      return;
    }

    setUpdateAvailable(null);
    setUpdatePublishingVersion(null);
    setUpdateStatus(source === "manual" ? "up_to_date" : "idle");
    setUpdateError(null);
  };
  const [logcatLines, setLogcatLines] = useState<Record<string, LogcatLineEntry[]>>({});
  const [logcatRetainedBySerial, setLogcatRetainedBySerial] = useState<Record<string, LogcatLineEntry[]>>({});
  const [logcatSourceMode, setLogcatSourceMode] = useState<LogcatSourceMode>("tag");
  const [logcatSourceValue, setLogcatSourceValue] = useState("");
  const [logLevels, setLogLevels] = useState<LogcatLevelsState>(() => loadSharedLogFiltersFromStorage().levels);
  const [logcatLiveFilter, setLogcatLiveFilter] = useState("");
  const [logcatPresetName, setLogcatPresetName] = useState("");
  const [logcatPresets, setLogcatPresets] = useState<LogcatFilterPreset[]>([]);
  const [logcatPresetSelected, setLogcatPresetSelected] = useState("");
  const [bugreportPresetName, setBugreportPresetName] = useState("");
  const [bugreportPresets, setBugreportPresets] = useState<BugreportFilterPreset[]>([]);
  const [bugreportPresetSelected, setBugreportPresetSelected] = useState("");
  const [presetUpdateModal, setPresetUpdateModal] = useState<null | { context: PresetContext; name: string }>(null);
  const [presetDeleteModal, setPresetDeleteModal] = useState<null | { context: PresetContext; name: string }>(null);
  const [logcatSearchTerm, setLogcatSearchTerm] = useState("");
  const [logcatSearchRegex, setLogcatSearchRegex] = useState(false);
  const [logcatSearchCaseSensitive, setLogcatSearchCaseSensitive] = useState(false);
  const [logcatSearchOnly, setLogcatSearchOnly] = useState(false);
  const [logcatAutoScroll, setLogcatAutoScroll] = useState(true);
  const [logcatActiveFilterSummary, setLogcatActiveFilterSummary] = useState("");
  const [logcatLastExport, setLogcatLastExport] = useState("");
  const [logcatClearBufferModal, setLogcatClearBufferModal] = useState<null | { serial: string }>(null);
  const [appActionConfirm, setAppActionConfirm] = useState<
    null | { action: "uninstall" | "clear"; packageName: string }
  >(null);
  const [logcatPopupSelectorOpen, setLogcatPopupSelectorOpen] = useState(false);
  const [logcatPopupDraftSerials, setLogcatPopupDraftSerials] = useState<string[]>([]);
  const [logcatTextKind, setLogcatTextKind] = useState<LogTextChipKind>("include");
  const [logcatRunningBySerial, setLogcatRunningBySerial] = useState<Record<string, boolean>>({});
  const [logcatStatusLoadingBySerial, setLogcatStatusLoadingBySerial] = useState<Record<string, boolean>>({});
  const [bluetoothMonitorRunningBySerial, setBluetoothMonitorRunningBySerial] = useState<Record<string, boolean>>({});
  const [bluetoothMonitorBusy, setBluetoothMonitorBusy] = useState(false);
  const [bluetoothToggleBusy, setBluetoothToggleBusy] = useState(false);
  const [sharedLogTextChips, setSharedLogTextChips] = useState<LogTextChip[]>(
    () => loadSharedLogFiltersFromStorage().textChips,
  );
  const [perfBySerial, setPerfBySerial] = useState<Record<string, PerfMonitorState>>({});
  const perfBySerialRef = useRef<Record<string, PerfMonitorState>>({});
  const [netBySerial, setNetBySerial] = useState<Record<string, NetProfilerState>>({});
  const netBySerialRef = useRef<Record<string, NetProfilerState>>({});
  const [netProfilerIntervalMs, setNetProfilerIntervalMs] = useState(2000);
  const [netProfilerTopN, setNetProfilerTopN] = useState(20);
  const [netProfilerSearch, setNetProfilerSearch] = useState("");
  const [netProfilerWindowMs, setNetProfilerWindowMs] = useState(60_000);
  const [netProfilerFocusUidBySerial, setNetProfilerFocusUidBySerial] = useState<Record<string, number | null>>(
    {},
  );
  const [netProfilerPinnedUidsBySerial, setNetProfilerPinnedUidsBySerial] = useState<Record<string, number[]>>({});
  const [filesViewMode, setFilesViewMode] = useState<"list" | "grid">(() => {
    try {
      const raw = localStorage.getItem("lazy_blacktea_files_view_mode_v1");
      return raw === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });

  useEffect(() => {
    localStorage.setItem("lazy_blacktea_files_view_mode_v1", filesViewMode);
  }, [filesViewMode]);

  useEffect(() => {
    let cancelled = false;

    if (!isTauriRuntime()) {
      return;
    }

    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        if (!cancelled) {
          setAppVersion(version);
        }
      } catch (error) {
        console.warn("Failed to read app version from Tauri.", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!isTauriRuntime()) {
      return;
    }

    const nowMs = Date.now();
    const lastCheckedMs = readUpdateLastCheckedMs();
    setUpdateLastCheckedMs(lastCheckedMs);

    if (!shouldAutoCheck(nowMs, lastCheckedMs, UPDATE_AUTO_CHECK_MIN_INTERVAL_MS)) {
      return;
    }

    setUpdateLastCheckSource("auto");
    setUpdateStatus("checking");
    setUpdateError(null);

    void (async () => {
      const result = await checkForUpdate({
        nowMs,
        currentVersion: appVersionLabel !== "--" ? appVersionLabel : undefined,
      });
      if (cancelled) {
        return;
      }
      setUpdateLastCheckedMs(nowMs);
      applyUpdateCheckResult("auto", result);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const closeUpdateModal = () => {
    if (updateStatus === "installing") {
      return;
    }
    if (updateStatus === "update_available" && updateAvailable) {
      markUpdatePromptDismissed(updateAvailable.version);
    }
    setUpdateModalOpen(false);
  };

  const runUpdateCheck = async (source: "auto" | "manual") => {
    if (!isTauriRuntime()) {
      return;
    }
    if (updateStatus === "checking" || updateStatus === "installing") {
      return;
    }
    const nowMs = Date.now();
    setUpdateLastCheckSource(source);
    setUpdateStatus("checking");
    setUpdateError(null);

    const result = await checkForUpdate({
      nowMs,
      currentVersion: appVersionLabel !== "--" ? appVersionLabel : undefined,
    });
    setUpdateLastCheckedMs(nowMs);
    applyUpdateCheckResult(source, result);
  };

  const handleManualUpdateCheck = () => {
    void runUpdateCheck("manual");
  };

  const handleInstallUpdate = () => {
    if (!updateAvailable) {
      return;
    }
    if (updateStatus === "installing") {
      return;
    }
    setUpdateStatus("installing");
    setUpdateError(null);

    void (async () => {
      const result = await installUpdateAndRelaunch(updateAvailable);
      if (result.status === "publishing_pending") {
        setUpdateAvailable(null);
        setUpdatePublishingVersion(result.latestVersion ?? null);
        setUpdateStatus("publishing_pending");
        setUpdateError(null);
        return;
      }
      if (result.status === "error") {
        setUpdateStatus("error");
        setUpdateError(result.message);
        return;
      }
      if (result.status === "installed_needs_restart") {
        setUpdateStatus("installed_needs_restart");
        return;
      }
      setUpdateStatus("installed");
    })();
  };

  useEffect(() => {
    try {
      localStorage.setItem(
        SHARED_LOG_FILTERS_STORAGE_KEY,
        JSON.stringify({
          levels: LOG_LEVELS.reduce<Record<string, boolean>>((acc, level) => {
            acc[level] = logLevels[level];
            return acc;
          }, {}),
          text_chips: sharedLogTextChips.slice(0, 50).map((chip) => ({
            kind: chip.kind,
            value: chip.value,
          })),
        }),
      );
    } catch (error) {
      console.warn("Failed to persist shared log filters to storage.", error);
    }
  }, [logLevels, sharedLogTextChips]);

  const [filesPath, setFilesPath] = useState("/sdcard");
  const [files, setFiles] = useState<DeviceFileEntry[]>([]);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [filePreviewDevicePath, setFilePreviewDevicePath] = useState<string | null>(null);
  const [filesSelectedPaths, setFilesSelectedPaths] = useState<string[]>([]);
  const [filesSearchQuery, setFilesSearchQuery] = useState("");
  const FILES_LIST_PAGE_SIZE = 80;
  const FILES_GRID_PAGE_SIZE = 48;
  const [filesVisibleCount, setFilesVisibleCount] = useState(FILES_LIST_PAGE_SIZE);
  const [filesOverwriteEnabled, setFilesOverwriteEnabled] = useState(true);
  const [filesDropActive, setFilesDropActive] = useState(false);
  const [apkDropActive, setApkDropActive] = useState(false);
  const [filesModal, setFilesModal] = useState<
    | null
    | { type: "mkdir"; name: string }
    | { type: "rename"; entry: DeviceFileEntry; newName: string }
    | { type: "delete"; entry: DeviceFileEntry; recursive: boolean; confirm: string }
    | { type: "delete_many"; entries: DeviceFileEntry[]; recursive: boolean; confirm: string }
  >(null);
  const [filesContextMenu, setFilesContextMenu] = useState<null | { x: number; y: number; entry: DeviceFileEntry }>(
    null,
  );
  const filesContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [uiHtml, setUiHtml] = useState("");
  const [uiXml, setUiXml] = useState("");
  const [uiScreenshotDataUrl, setUiScreenshotDataUrl] = useState("");
  const [uiScreenshotError, setUiScreenshotError] = useState("");
  const [uiInspectorTab, setUiInspectorTab] = useState<"hierarchy" | "xml">("hierarchy");
  const [uiXmlViewMode, setUiXmlViewMode] = useState<"raw" | "pretty">("raw");
  const [uiInspectorSearch, setUiInspectorSearch] = useState("");
  const [filteredUiXml, setFilteredUiXml] = useState("");
  const [uiExportResult, setUiExportResult] = useState("");
  const [uiZoom, setUiZoom] = useState(() => {
    try {
      const raw = localStorage.getItem("lazy_blacktea_ui_inspector_zoom_v2");
      const parsed = raw ? Number(raw) : Number.NaN;
      if (Number.isFinite(parsed)) {
        return Math.max(0.5, Math.min(2, parsed));
      }
    } catch {
      // Fall back to default zoom.
    }
    return 0.5;
  });
  const [uiHierarchyFrameToken, setUiHierarchyFrameToken] = useState(0);
  const [uiBoundsEnabled, setUiBoundsEnabled] = useState(true);
  const [uiAutoSyncEnabled, setUiAutoSyncEnabled] = useState(false);
  const [uiAutoSyncIntervalMs, setUiAutoSyncIntervalMs] = useState(1000);
  const [uiAutoSyncError, setUiAutoSyncError] = useState("");
  const [uiAutoSyncLastAt, setUiAutoSyncLastAt] = useState<number | null>(null);
  const uiAutoSyncTaskIdRef = useRef<string | null>(null);
  const uiAutoSyncHadSuccessRef = useRef(false);
  const uiAutoSyncLastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem("lazy_blacktea_ui_inspector_zoom_v2", String(uiZoom));
  }, [uiZoom]);

  const [uiScreenshotSize, setUiScreenshotSize] = useState({ width: 0, height: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [desktopNotificationPermission, setDesktopNotificationPermission] =
    useState<DesktopNotificationPermissionState>("unknown");
  const tauriUnavailableToastShownRef = useRef(false);
  const [groupMap, setGroupMap] = useState<Record<string, string>>({});
  const [groupName, setGroupName] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [deviceContextMenu, setDeviceContextMenu] = useState<{
    x: number;
    y: number;
    serial: string;
    source: DeviceQuickMenuSource;
    outputPath: string | null;
    visibleActionIds: DeviceContextActionId[] | null;
  } | null>(null);
  const [deviceContextSubmenu, setDeviceContextSubmenu] = useState<{
    x: number;
    y: number;
    triggerLeft: number;
    triggerRight: number;
    title: string;
    items: DeviceInfoCopyItem[];
  } | null>(null);
  const deviceContextMenuRef = useRef<HTMLDivElement | null>(null);
  const deviceContextSubmenuRef = useRef<HTMLDivElement | null>(null);
  const deviceContextMenuTriggerRef = useRef<HTMLElement | null>(null);
  const deviceContextMenuWasOpenRef = useRef(false);
  const deviceQuickSelectionHintShownRef = useRef(false);
  const [searchText, setSearchText] = useState("");
  const [deviceQuickFilters, setDeviceQuickFilters] = useState<DeviceQuickFilterId[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);
  const [logcatSyncSessionBySerial, setLogcatSyncSessionBySerial] = useState<
    Record<string, LogcatRecordingSyncSession>
  >({});
  const deviceSearchInputRef = useRef<HTMLInputElement | null>(null);
  const deviceListRef = useRef<HTMLDivElement | null>(null);
  const [apkPath, setApkPath] = useState("");
  const [apkBundlePath, setApkBundlePath] = useState("");
  const [apkPaths, setApkPaths] = useState<string[]>([]);
  const [apkInstallMode, setApkInstallMode] = useState<"single" | "multiple" | "bundle">("single");
  const [apkExtraArgs, setApkExtraArgs] = useState("");
  const [apkAllowDowngrade, setApkAllowDowngrade] = useState(true);
  const [apkReplace, setApkReplace] = useState(true);
  const [apkGrant, setApkGrant] = useState(true);
  const [apkAllowTest, setApkAllowTest] = useState(false);
  const [apkLaunchAfterInstall, setApkLaunchAfterInstall] = useState(false);
  const [apkLaunchPackage, setApkLaunchPackage] = useState("");
  const [apkInstallSummary, setApkInstallSummary] = useState<string[]>([]);
  const [installBusy, setInstallBusy] = useState(false);
  const [activeApkInstallTraceId, setActiveApkInstallTraceId] = useState<string | null>(null);
  const [apkInspectionInfo, setApkInspectionInfo] = useState<ApkInfo | null>(null);
  const [apkInspectionLoading, setApkInspectionLoading] = useState(false);
  const [apkInspectionError, setApkInspectionError] = useState<string | null>(null);
  const [latestApkInstallTaskId, setLatestApkInstallTaskId] = useState<string | null>(null);
  const [screenRecordStatusBySerial, setScreenRecordStatusBySerial] = useState<Record<string, ScreenRecordStatus>>({});
  const [screenRecordPendingBySerial, setScreenRecordPendingBySerial] = useState<
    Record<string, ScreenRecordPendingAction | undefined>
  >({});
  const [screenRecordStatusLoadingBySerial, setScreenRecordStatusLoadingBySerial] = useState<
    Record<string, boolean>
  >({});
  const [deviceQuickActionStatusBySerial, setDeviceQuickActionStatusBySerial] = useState<
    Record<string, DeviceQuickActionStatus | undefined>
  >({});
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsFilter, setAppsFilter] = useState("");
  const [appsThirdPartyOnly, setAppsThirdPartyOnly] = useState(true);
  const [appsIncludeVersions, setAppsIncludeVersions] = useState(false);
  const APPS_PAGE_SIZE = 40;
  const [appsVisibleCount, setAppsVisibleCount] = useState(APPS_PAGE_SIZE);
  const [selectedApp, setSelectedApp] = useState<AppInfo | null>(null);
  const [selectedAppDetails, setSelectedAppDetails] = useState<AppBasicInfo | null>(null);
  const [appsDetailsBusy, setAppsDetailsBusy] = useState(false);
  const [appsContextMenu, setAppsContextMenu] = useState<null | { x: number; y: number; app: AppInfo }>(null);
  const appsContextMenuRef = useRef<HTMLDivElement | null>(null);
  type AppIconStatus = "queued" | "loading" | "ready" | "error";
  const [appIconsByKey, setAppIconsByKey] = useState<
    Record<string, { status: AppIconStatus; dataUrl?: string; error?: string }>
  >({});
  const appIconsByKeyRef = useRef(appIconsByKey);
  useEffect(() => {
    appIconsByKeyRef.current = appIconsByKey;
  }, [appIconsByKey]);
  const appIconQueueRef = useRef<{ key: string; serial: string; app: AppInfo }[]>([]);
  const appIconInFlightRef = useRef(0);
  const [bugreportResult, setBugreportResult] = useState<BugreportResult | null>(null);
  const [latestBugreportTaskId, setLatestBugreportTaskId] = useState<string | null>(null);
  const [bugreportLogSourcePath, setBugreportLogSourcePath] = useState("");
  const [bugreportLogSummary, setBugreportLogSummary] = useState<BugreportLogSummary | null>(null);
  const [bugreportExtractSummary, setBugreportExtractSummary] =
    useState<BugreportExtractIndexSummary | null>(null);
  const [bugreportLogRows, setBugreportLogRows] = useState<BugreportLogRow[]>([]);
  const [bugreportLogHasMore, setBugreportLogHasMore] = useState(false);
  const [bugreportLogOffset, setBugreportLogOffset] = useState(0);
  const [bugreportLogBusy, setBugreportLogBusy] = useState(false);
  const [bugreportExtractPreparing, setBugreportExtractPreparing] = useState(false);
  const [bugreportLogError, setBugreportLogError] = useState<string | null>(null);
  const [bugreportLogLoadAllRunning, setBugreportLogLoadAllRunning] = useState(false);
  const [bugreportLogLoadAllLimitReached, setBugreportLogLoadAllLimitReached] = useState(false);
  const [bugreportLogBuffer, setBugreportLogBuffer] = useState("");
  const [bugreportLogTag, setBugreportLogTag] = useState("");
  const [bugreportLogPid, setBugreportLogPid] = useState("");
  const [bugreportLogLiveFilter, setBugreportLogLiveFilter] = useState("");
  const [bugreportLogFilterKind, setBugreportLogFilterKind] = useState<LogTextChipKind>("include");
  const [bugreportLogFiltersExpanded, setBugreportLogFiltersExpanded] = useState(false);
  const [bugreportLogStart, setBugreportLogStart] = useState("");
  const [bugreportLogEnd, setBugreportLogEnd] = useState("");
  const [bugreportLogAdvancedOpen, setBugreportLogAdvancedOpen] = useState(false);
  const [bugreportCustomViews, setBugreportCustomViews] = useState<BugreportCustomViewTemplate[]>([]);
  const [bugreportCustomViewSelectedId, setBugreportCustomViewSelectedId] = useState("");
  const [bugreportCustomViewEditor, setBugreportCustomViewEditor] = useState<BugreportCustomViewEditor>({
    id: null,
    group: DEFAULT_BUGREPORT_CUSTOM_VIEW_GROUP,
    name: "",
    templateKind: "service",
    defaultInput: "",
  });
  const [bugreportCustomViewRunInput, setBugreportCustomViewRunInput] = useState("");
  const [bugreportCustomViewRunBusy, setBugreportCustomViewRunBusy] = useState(false);
  const [activeBugreportCustomViewSession, setActiveBugreportCustomViewSession] =
    useState<ActiveBugreportCustomViewSession | null>(null);
  const makeBugreportCustomViewEditor = (
    view: BugreportCustomViewTemplate | null,
  ): BugreportCustomViewEditor => {
    if (!view) {
      return {
        id: null,
        group: DEFAULT_BUGREPORT_CUSTOM_VIEW_GROUP,
        name: "",
        templateKind: "service",
        defaultInput: "",
      };
    }
    return {
      id: view.id,
      group: view.group,
      name: view.name,
      templateKind: view.template_kind,
      defaultInput: view.default_input ?? "",
    };
  };
  const [devicePopoverOpen, setDevicePopoverOpen] = useState(false);
  const [devicePopoverLeft, setDevicePopoverLeft] = useState<number | null>(null);
  const [devicePopoverSearch, setDevicePopoverSearch] = useState("");
  const [topActionsMenuOpen, setTopActionsMenuOpen] = useState(false);
  const [scrcpyInfo, setScrcpyInfo] = useState<ScrcpyInfo | null>(null);
  const [adbInfo, setAdbInfo] = useState<AdbInfo | null>(null);
  const [iosToolsInfo, setIosToolsInfo] = useState<IosToolsInfo | null>(null);
  const [mobileconfigPath, setMobileconfigPath] = useState("");
  const [mobileconfigSummary, setMobileconfigSummary] = useState<MobileconfigSummary | null>(null);
  const [mobileconfigValidationError, setMobileconfigValidationError] = useState<string | null>(null);
  const [profileTargetSerials, setProfileTargetSerials] = useState<string[]>([]);
  const [profileInstallResults, setProfileInstallResults] = useState<IosProfileInstallResult[]>([]);
  const [profileConfirmOpen, setProfileConfirmOpen] = useState(false);
  const [profileInstalling, setProfileInstalling] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeDashboardCardId, setActiveDashboardCardId] = useState<DashboardCardId>("overview");
  const [dashboardConfigOpen, setDashboardConfigOpen] = useState(false);
  const [dashboardDraft, setDashboardDraft] = useState<DashboardSettings>(buildDefaultDashboardSettings());
  const [dashboardCopiedKey, setDashboardCopiedKey] = useState<string | null>(null);
  const [dashboardVariantExpanded, setDashboardVariantExpanded] = useState<Record<string, boolean>>({});
  const [pairingState, dispatchPairing] = useReducer(pairingReducer, initialPairingState);
  const [rebootConfirmOpen, setRebootConfirmOpen] = useState(false);
  const [rebootConfirmMode, setRebootConfirmMode] = useState<RebootMode>("normal");
  const [taskState, dispatchTasks] = useReducer(tasksReducer, undefined, () => createInitialTaskState(50));
  const [errorState, dispatchErrors] = useReducer(
    errorRecordsReducer,
    undefined,
    () => createInitialErrorState(),
  );
  const hostOs = useMemo(
    () =>
      resolveHostOs(
        typeof navigator === "undefined" ? "" : navigator.platform,
        typeof navigator === "undefined" ? "" : navigator.userAgent,
      ),
    [],
  );
  const iosToolGuidanceRows = useMemo(
    () => buildIosToolGuidanceRows(iosToolsInfo, hostOs),
    [hostOs, iosToolsInfo],
  );
  const [githubReportPendingByKey, setGithubReportPendingByKey] = useState<Record<string, boolean>>({});
  const taskStateRef = useRef(taskState);
  const errorStateRef = useRef(errorState);
  useEffect(() => {
    taskStateRef.current = taskState;
  }, [taskState]);
  useEffect(() => {
    errorStateRef.current = errorState;
  }, [errorState]);
  const [logcatMatchIndex, setLogcatMatchIndex] = useState(0);
  const logcatOutputRef = useRef<HTMLDivElement>(null);
  const uiScreenshotImgRef = useRef<HTMLImageElement | null>(null);
  const uiBoundsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pairingCodeInputRef = useRef<HTMLInputElement | null>(null);
  const connectAddressInputRef = useRef<HTMLInputElement | null>(null);
  const uiHierarchyFrameRef = useRef<HTMLIFrameElement | null>(null);
  const uiHierarchySelectedIndexRef = useRef<number | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);
  const devicePopoverRef = useRef<HTMLDivElement | null>(null);
  const devicePopoverTriggerRef = useRef<HTMLDivElement | null>(null);
  const devicePopoverSearchRef = useRef<HTMLInputElement | null>(null);
  const topActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const topActionsMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const topActionsMenuWasOpenRef = useRef(false);
  const fileTransferTaskByTraceIdRef = useRef<Record<string, string>>({});
  const apkInstallTaskByTraceIdRef = useRef<Record<string, string>>({});
  const apkInstallCancelRequestedRef = useRef(false);
  const prevTaskItemsRef = useRef<TaskItem[] | null>(null);
  const notifiedTaskIdsRef = useRef<Set<string>>(new Set());
  const appsDetailsSeqRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const detailRefreshSeqRef = useRef(0);
  const detailRefreshTimerRef = useRef<number | null>(null);
  const deviceQuickActionStatusTimersRef = useRef<Record<string, number>>({});
  const deviceAutoRefreshLastWarnAtRef = useRef(0);
  const deviceTrackingLastSnapshotAtRef = useRef<number>(0);
  const deviceTrackingPendingSnapshotRef = useRef<DeviceInfo[] | null>(null);
  const deviceTrackingRestartInFlightRef = useRef(false);
  const deviceTrackingNoSnapshotRestartAttemptsRef = useRef(0);
  const deviceTrackingRestartWindowStartedAtRef = useRef<number>(0);
  const deviceTrackingFallbackInFlightRef = useRef(false);
  const deviceTrackingStartedAtRef = useRef<number>(0);
  const busyRef = useRef(false);
  const dashboardCopyTimerRef = useRef<number | null>(null);
  const adbInfoRef = useRef<AdbInfo | null>(null);
  const devicesRef = useRef<DeviceInfo[]>([]);
  const retentionMapRef = useRef<Record<string, DeviceRetentionRecord>>({});
  const configRef = useRef<AppConfig | null>(null);
  const bugreportLogRequestRef = useRef(0);
  const logcatPendingRef = useRef<Record<string, string[]>>({});
  const logcatNextIdRef = useRef<Record<string, number>>({});
  const logcatFlushTimerRef = useRef<number | null>(null);
  // Perf/net snapshots are coalesced into a single batched setState per flush window so that a
  // burst of per-device samples does not trigger a full-app re-render per sample.
  const perfPendingRef = useRef<PerfEvent[]>([]);
  const perfFlushTimerRef = useRef<number | null>(null);
  const netPendingRef = useRef<NetProfilerEvent[]>([]);
  const netFlushTimerRef = useRef<number | null>(null);
  const monitoringIdleLastActivityAtRef = useRef<number>(Date.now());
  const monitoringIdleTimerRef = useRef<number | null>(null);
  const monitoringIdleStoppingRef = useRef(false);
  const logcatRunningBySerialRef = useRef<Record<string, boolean>>({});
  const bluetoothMonitorRunningBySerialRef = useRef<Record<string, boolean>>({});
  const logcatBaseFilterRef = useRef<{ active: boolean; state: LogcatBaseFilterState }>({
    active: false,
    state: {
      levels: { ...defaultLogcatLevels },
      activePatterns: [],
      excludePatterns: [],
      livePattern: "",
    },
  });

  useEffect(() => {
    return () => {
      Object.values(deviceQuickActionStatusTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      deviceQuickActionStatusTimersRef.current = {};
    };
  }, []);
  const perfLastSerialRef = useRef<string | null>(null);
  const netLastSerialRef = useRef<string | null>(null);
  const filesDragContextRef = useRef<{
    pathname: string;
    serial: string;
    path: string;
    overwrite: boolean;
    existingNames: string[];
  }>({ pathname: "/", serial: "", path: "/sdcard", overwrite: true, existingNames: [] });
  const apkDragContextRef = useRef<{ pathname: string; mode: "single" | "multiple" | "bundle" }>({
    pathname: "/",
    mode: "single",
  });
  const bugreportLogLastReportIdRef = useRef<string | null>(null);
  const bugreportLogLoadAllTokenRef = useRef(0);
  const bugreportLogLoadAllRunningRef = useRef(false);
  const bugreportPopupLoadedSourceRef = useRef<string | null>(null);
  const bugreportPopupInstanceCounterRef = useRef(0);

  const location = useLocation();
  const navigate = useNavigate();
  const logcatPopupContext = useMemo(() => parseLogcatPopupContext(location.search), [location.search]);
  const isLogcatPopupWindow = logcatPopupContext.isPopup;
  const logcatPopupSerial = logcatPopupContext.serial;
  const bugreportPopupContext = useMemo(() => parseBugreportPopupContext(location.search), [location.search]);
  const isBugreportPopupSession = bugreportPopupContext.isPopup && !isLogcatPopupWindow;
  const bugreportPopupSourcePath = bugreportPopupContext.sourcePath;
  const currentRoute = `${location.pathname}${location.search}`;
  const isBugreportLogViewer = location.pathname === "/bugreport-logviewer";
  const isDetachedPopupWindow = isLogcatPopupWindow || isBugreportPopupSession;
  const isLogcatView = location.pathname === "/logcat";
  const isPerformanceView = location.pathname === "/performance";
  const isNetworkView = location.pathname === "/network";
  const isUiInspectorView = location.pathname === "/ui-inspector";
  const isDeveloperOptionsView = location.pathname === "/developer-options";
  useEffect(() => {
    if (location.pathname === "/actions") {
      setActiveActionsShellTab("adb-shell");
    }
  }, [location.key, location.pathname]);
  useEffect(() => {
    const handleActionsHashEntry = () => {
      const hashPath = window.location.hash.replace(/^#/, "").split("?")[0];
      if (hashPath === "/actions") {
        setActiveActionsShellTab("adb-shell");
      }
    };

    window.addEventListener("hashchange", handleActionsHashEntry);
    return () => window.removeEventListener("hashchange", handleActionsHashEntry);
  }, []);
  useEffect(() => {
    const handleRecordedError = (event: Event) => {
      const detail = (event as CustomEvent<ErrorRecord>).detail;
      if (!detail?.id) {
        return;
      }
      dispatchErrors({ type: "ERROR_ADD", record: detail });
    };

    window.addEventListener(APP_ERROR_RECORDED_EVENT, handleRecordedError as EventListener);
    return () => {
      window.removeEventListener(APP_ERROR_RECORDED_EVENT, handleRecordedError as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      recordExternalAppError({
        title: "Unhandled Window Error",
        source: "frontend.onerror",
        error: event.error ?? event.message,
        route: currentRoute,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      recordExternalAppError({
        title: "Unhandled Promise Rejection",
        source: "frontend.unhandledrejection",
        error: event.reason,
        route: currentRoute,
      });
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [currentRoute]);

  useEffect(() => {
    if (!isBugreportLogViewer) {
      setBugreportLogAdvancedOpen(false);
    }
  }, [isBugreportLogViewer]);

  useEffect(() => {
    if (!isLogcatPopupWindow) {
      return;
    }
    if (location.pathname !== "/logcat") {
      navigate(`/logcat${location.search}`, { replace: true });
      return;
    }
    if (!logcatPopupSerial) {
      return;
    }
    setSelectedSerials((prev) => (prev.length === 1 && prev[0] === logcatPopupSerial ? prev : [logcatPopupSerial]));
    setDevicePopoverOpen(false);
  }, [isLogcatPopupWindow, location.pathname, location.search, navigate, logcatPopupSerial]);

  useEffect(() => {
    if (!isBugreportPopupSession) {
      return;
    }
    if (location.pathname !== "/bugreport-logviewer") {
      navigate(`/bugreport-logviewer${location.search}`, { replace: true });
      return;
    }
    setDevicePopoverOpen(false);
  }, [isBugreportPopupSession, location.pathname, location.search, navigate]);

  const resolveSelectedSerialsForContext = useCallback(
    (previous: string[], nextDevices: DeviceInfo[]): string[] => {
      if (!isLogcatPopupWindow || !logcatPopupSerial) {
        return resolveSelectedSerials(previous, nextDevices);
      }
      const exists = nextDevices.some((device) => device.summary.serial === logcatPopupSerial);
      return exists ? [logcatPopupSerial] : [];
    },
    [isLogcatPopupWindow, logcatPopupSerial],
  );

  const activeSerial = resolvePrimarySerial(selectedSerials);
  const activeLogcatRunning = activeSerial ? (logcatRunningBySerial[activeSerial] ?? false) : false;
  const activeLogcatStatusLoading = activeSerial
    ? (logcatStatusLoadingBySerial[activeSerial] ?? false)
    : false;
  const screenRecordStatusLoading = selectedSerials.some((serial) => screenRecordStatusLoadingBySerial[serial]);
  useEffect(() => {
    logcatRunningBySerialRef.current = logcatRunningBySerial;
  }, [logcatRunningBySerial]);
  useEffect(() => {
    bluetoothMonitorRunningBySerialRef.current = bluetoothMonitorRunningBySerial;
  }, [bluetoothMonitorRunningBySerial]);
  const activeDevice = useMemo(
    () => devices.find((device) => device.summary.serial === activeSerial) ?? null,
    [devices, activeSerial],
  );
  const popupTargetDevice = useMemo(
    () =>
      isLogcatPopupWindow && logcatPopupSerial
        ? devices.find((device) => device.summary.serial === logcatPopupSerial) ?? null
        : null,
    [devices, isLogcatPopupWindow, logcatPopupSerial],
  );
  const popupTargetConnected = popupTargetDevice?.summary.state === "device";
  const latestApkInstallTask = latestApkInstallTaskId
    ? taskState.items.find((task) => task.id === latestApkInstallTaskId) ?? null
    : null;
  const hasDevices = devices.length > 0;
  const selectedCount = selectedSerials.length;
  const onlineDeviceSerials = useMemo(
    () =>
      devices
        .filter((device) => device.summary.state === "device")
        .map((device) => device.summary.serial),
    [devices],
  );
  const developerOptionsScope = useMemo(
    () =>
      resolveDeveloperOptionsScope({
        activeSerial: activeSerial ?? null,
        selectedSerials,
        onlineSerials: onlineDeviceSerials,
        applyMode: developerOptionsApplyMode,
      }),
    [activeSerial, selectedSerials, onlineDeviceSerials, developerOptionsApplyMode],
  );
  const developerOptionsMatrixSerials = useMemo(
    () =>
      resolveDeveloperOptionsMatrixSerials({
        activeSerial: activeSerial ?? null,
        selectedSerials,
        onlineSerials: onlineDeviceSerials,
      }),
    [activeSerial, selectedSerials, onlineDeviceSerials],
  );
  const developerOptionsSelectedSerialsSignature = useMemo(
    () => developerOptionsScope.uniqueSelectedSerials.join("|"),
    [developerOptionsScope.uniqueSelectedSerials],
  );
  const developerOptionsPrimaryAutoReadKey = useMemo(
    () => resolveDeveloperOptionsPrimaryAutoReadKey(activeSerial ?? null, isDeveloperOptionsView),
    [activeSerial, isDeveloperOptionsView],
  );
  const developerOptionsDivergenceByKey = useMemo(
    () =>
      buildDeveloperOptionDivergenceRows({
        baselineSerial: activeSerial ?? null,
        compareSerials: developerOptionsMatrixSerials.onlineSerials,
        snapshotsBySerial: developerOptionsMatrixState.bySerial,
      }),
    [activeSerial, developerOptionsMatrixSerials.onlineSerials, developerOptionsMatrixState.bySerial],
  );
  const developerOptionsMatrixLoadingSerialSet = useMemo(
    () => buildMatrixSerialSet(developerOptionsMatrixState.loadingSerials),
    [developerOptionsMatrixState.loadingSerials],
  );
  const developerOptionsDivergentSerialSetByKey = useMemo(() => {
    const map = {} as Record<DeveloperOptionKey, Set<string>>;
    DEVELOPER_OPTIONS.forEach((option) => {
      map[option.key] = buildMatrixSerialSet(
        developerOptionsDivergenceByKey[option.key]?.divergentSerials ?? [],
      );
    });
    return map;
  }, [developerOptionsDivergenceByKey]);
  const developerOptionsPendingPlan = useMemo(
    () => buildDeveloperOptionBatchPlan(developerOptionPendingByKey),
    [developerOptionPendingByKey],
  );
  const developerOptionsPendingCount = useMemo(
    () => countPendingDeveloperOptions(developerOptionPendingByKey),
    [developerOptionPendingByKey],
  );
  const developerOptionsLastReadLabel = useMemo(
    () =>
      developerOptionsLastReadAt
        ? new Date(developerOptionsLastReadAt).toLocaleTimeString()
        : "Not loaded yet",
    [developerOptionsLastReadAt],
  );
  const developerOptionsMatrixLogBufferLastReadLabel = useMemo(
    () =>
      developerOptionsMatrixLogBufferLastReadAt
        ? new Date(developerOptionsMatrixLogBufferLastReadAt).toLocaleTimeString()
        : "Not loaded yet",
    [developerOptionsMatrixLogBufferLastReadAt],
  );
  const selectedConnectedCount = selectedSerials.reduce(
    (total, serial) => total + (terminalBySerial[serial]?.connected ? 1 : 0),
    0,
  );
  const selectedOnlineCount = useMemo(
    () =>
      selectedSerials.reduce((total, serial) => {
        const summary = devices.find((device) => device.summary.serial === serial)?.summary;
        return total + (summary?.state === "device" ? 1 : 0);
      }, 0),
    [devices, selectedSerials],
  );
  const adbCommandTargetSerials = useMemo(
    () =>
      selectedSerials.filter((serial) => {
        const device = devices.find((item) => item.summary.serial === serial);
        return (
          device?.summary.state === "device" &&
          getDevicePlatform(device) === "android" &&
          hasDeviceCapability(device, "shell")
        );
      }),
    [devices, selectedSerials],
  );
  const perfRunningSerialsSignature = useMemo(
    () =>
      Object.entries(perfBySerial)
        .filter(([, state]) => state.running)
        .map(([serial]) => serial)
        .sort()
        .join("|"),
    [perfBySerial],
  );
  const netProfilerRunningSerialsSignature = useMemo(
    () =>
      Object.entries(netBySerial)
        .filter(([, state]) => state.running)
        .map(([serial]) => serial)
        .sort()
        .join("|"),
    [netBySerial],
  );
  const terminalConnectedSerialsSignature = useMemo(
    () =>
      Object.entries(terminalBySerial)
        .filter(([, state]) => state.connected)
        .map(([serial]) => serial)
        .sort()
        .join("|"),
    [terminalBySerial],
  );
  const logcatRunningSerialsSignature = useMemo(
    () => getRunningLogcatSerials(logcatRunningBySerial).sort().join("|"),
    [logcatRunningBySerial],
  );
  const bluetoothMonitorRunningSerialsSignature = useMemo(
    () => getRunningLogcatSerials(bluetoothMonitorRunningBySerial).sort().join("|"),
    [bluetoothMonitorRunningBySerial],
  );
  const monitoringWatchSignature = useMemo(
    () =>
      [
        `logcat:${logcatRunningSerialsSignature}`,
        `perf:${perfRunningSerialsSignature}`,
        `net:${netProfilerRunningSerialsSignature}`,
        `terminal:${terminalConnectedSerialsSignature}`,
        `bluetooth:${bluetoothMonitorRunningSerialsSignature}`,
      ].join("||"),
    [
      logcatRunningSerialsSignature,
      perfRunningSerialsSignature,
      netProfilerRunningSerialsSignature,
      terminalConnectedSerialsSignature,
      bluetoothMonitorRunningSerialsSignature,
    ],
  );
  const deviceStatus = activeDevice?.summary.state ?? "offline";
  const activeDeviceIsIos = getDevicePlatform(activeDevice) === "ios";
  const selectedSummaryLabel =
    selectedCount === 0
      ? "No devices selected"
      : selectedCount === 1
        ? activeSerial ?? "No device selected"
        : `${selectedCount} devices selected`;
  const logcatPopupCandidates = useMemo(
    () => buildLogcatPopupCandidates(devices, selectedSerials, activeSerial ?? null),
    [devices, selectedSerials, activeSerial],
  );
  const logcatPopupPreviewTargets = useMemo(
    () => partitionLogcatPopupTargets(logcatPopupDraftSerials, devices),
    [logcatPopupDraftSerials, devices],
  );
  const hasLogcatPopupSelectableCandidate = logcatPopupCandidates.some((candidate) => candidate.selectable);
  const logcatPopupSelectableSerials = useMemo(
    () => logcatPopupCandidates.filter((candidate) => candidate.selectable).map((candidate) => candidate.serial),
    [logcatPopupCandidates],
  );
  const logcatPopupSelectedCount = logcatPopupPreviewTargets.openable.length;
  const logcatPopupSelectableCount = logcatPopupSelectableSerials.length;
  const logcatPopupAllSelectableSelected =
    logcatPopupSelectableCount > 0 && logcatPopupSelectedCount === logcatPopupSelectableCount;

  useEffect(() => {
    if (!logcatPopupSelectorOpen) {
      return;
    }
    if (isLogcatPopupWindow || !isLogcatView) {
      setLogcatPopupSelectorOpen(false);
      return;
    }
    const selectableSet = new Set(
      logcatPopupCandidates.filter((candidate) => candidate.selectable).map((candidate) => candidate.serial),
    );
    setLogcatPopupDraftSerials((prev) => prev.filter((serial) => selectableSet.has(serial)));
  }, [isLogcatPopupWindow, isLogcatView, logcatPopupCandidates, logcatPopupSelectorOpen]);

  const canStartLogcat =
    !busy &&
    !!activeSerial &&
    hasDeviceCapability(activeDevice, "logs") &&
    !activeLogcatStatusLoading &&
    !activeLogcatRunning;
  const canStopLogcat =
    !busy &&
    !!activeSerial &&
    !activeLogcatStatusLoading &&
    activeLogcatRunning;
  const logcatStatusLabel =
    !activeSerial
      ? "Select a device"
      : activeLogcatStatusLoading
        ? "Checking..."
        : activeLogcatRunning
          ? "Running"
          : "Stopped";
  const logcatStatusTone =
    !activeSerial
      ? "idle"
      : activeLogcatStatusLoading
        ? "busy"
        : activeLogcatRunning
          ? "ok"
          : "idle";
  const hasFileSelection = filesSelectedPaths.length > 0;
  const fileSelectionLabel = hasFileSelection
    ? `${filesSelectedPaths.length} items selected`
    : "Select files to enable bulk actions.";
  const requiresSingleSelection = useMemo(
    () =>
      ["/files", "/ui-inspector", "/apps", "/bluetooth", "/logcat", "/performance", "/network", "/developer-options"].includes(
        location.pathname,
      ),
    [location.pathname],
  );
  const singleSelectionWarning = requiresSingleSelection && selectedCount > 1 && !!activeSerial;
  const singleSelectionWarningMessage = singleSelectionWarning
    ? `Multiple devices selected. Using primary device: ${formatPrimaryDeviceLabel(activeSerial, activeDevice)}.`
    : "";
  useEffect(() => {
    const prevSerial = perfLastSerialRef.current;
    const prevNetSerial = netLastSerialRef.current;
    const nextPerfSerial = isPerformanceView ? activeSerial ?? null : null;
    const nextNetSerial = isPerformanceView || isNetworkView ? activeSerial ?? null : null;
    if (prevSerial && prevSerial !== nextPerfSerial) {
      const running = perfBySerialRef.current[prevSerial]?.running ?? false;
      if (running) {
        void stopPerfMonitor(prevSerial)
          .then(() => {
            setPerfBySerial((prev) => {
              const existing = prev[prevSerial];
              if (!existing) {
                return prev;
              }
              return {
                ...prev,
                [prevSerial]: {
                  ...existing,
                  running: false,
                },
              };
            });
          })
          .catch((error) => pushToast(formatError(error), "error"));
      }
    }

    if (prevNetSerial && prevNetSerial !== nextNetSerial) {
      const running = netBySerialRef.current[prevNetSerial]?.running ?? false;
      if (running) {
        void stopNetProfiler(prevNetSerial)
          .then(() => {
            setNetBySerial((prev) => {
              const existing = prev[prevNetSerial];
              if (!existing) {
                return prev;
              }
              return {
                ...prev,
                [prevNetSerial]: {
                  ...existing,
                  running: false,
                },
              };
            });
          })
          .catch((error) => pushToast(formatError(error), "error"));
      }
    }

    perfLastSerialRef.current = nextPerfSerial;
    netLastSerialRef.current = nextNetSerial;
  }, [isPerformanceView, isNetworkView, activeSerial]);
  const groupedDevices = useMemo(() => {
    const filtered = filterDevicesBySearch(devices, devicePopoverSearch);
    const filteredBySerial = new Map(filtered.map((device) => [device.summary.serial, device]));
    const selected = selectedSerials
      .map((serial) => filteredBySerial.get(serial))
      .filter((device): device is DeviceInfo => Boolean(device));
    const selectedSet = new Set(selected.map((device) => device.summary.serial));

    const grouped = new Map<string, DeviceInfo[]>();
    const ungrouped: DeviceInfo[] = [];
    filtered.forEach((device) => {
      const serial = device.summary.serial;
      if (selectedSet.has(serial)) {
        return;
      }
      const group = groupMap[serial];
      if (group) {
        const list = grouped.get(group) ?? [];
        list.push(device);
        grouped.set(group, list);
      } else {
        ungrouped.push(device);
      }
    });
    const groupNames = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    return { filteredCount: filtered.length, selected, groupNames, grouped, ungrouped };
  }, [devices, devicePopoverSearch, groupMap, selectedSerials]);
  const resolvedBugreportTaskId = useMemo(
    () => resolveBugreportPanelTaskId(taskState.items, latestBugreportTaskId),
    [taskState.items, latestBugreportTaskId],
  );
  useEffect(() => {
    if (!resolvedBugreportTaskId) {
      return;
    }
    if (resolvedBugreportTaskId !== latestBugreportTaskId) {
      setLatestBugreportTaskId(resolvedBugreportTaskId);
    }
  }, [resolvedBugreportTaskId, latestBugreportTaskId]);
  const latestBugreportTask = useMemo(() => {
    if (!resolvedBugreportTaskId) {
      return null;
    }
    return taskState.items.find((task) => task.id === resolvedBugreportTaskId) ?? null;
  }, [resolvedBugreportTaskId, taskState.items]);
  const latestBugreportEntries = useMemo(() => {
    if (!latestBugreportTask) {
      return [];
    }
    return Object.values(latestBugreportTask.devices).sort((a, b) => a.serial.localeCompare(b.serial));
  }, [latestBugreportTask]);
  const bugreportCards = useMemo(
    () => buildBugreportDeviceCards(selectedSerials, devices, latestBugreportTask),
    [selectedSerials, devices, latestBugreportTask],
  );
  const bugreportCardSummary = useMemo(
    () => summarizeBugreportCards(bugreportCards),
    [bugreportCards],
  );
  const bugreportGenerateLabel = useMemo(
    () => getBugreportGenerateLabel(bugreportCardSummary.selected, bugreportCardSummary.running),
    [bugreportCardSummary.selected, bugreportCardSummary.running],
  );
  const bugreportOutputPaths = useMemo(
    () =>
      Array.from(
        new Set(
          bugreportCards
            .map((card) => card.output_path)
            .filter((path): path is string => Boolean(path)),
        ),
      ),
    [bugreportCards],
  );
  const bugreportAnalysisTargets = useMemo(() => {
    const entries = latestBugreportEntries.filter((entry) => entry.output_path);
    if (entries.length > 0) {
      return entries.map((entry) => ({
        serial: entry.serial,
        output_path: entry.output_path!,
      }));
    }
    if (bugreportResult?.output_path && activeSerial) {
      return [{ serial: activeSerial, output_path: bugreportResult.output_path }];
    }
    return [];
  }, [latestBugreportEntries, bugreportResult, activeSerial]);
  const bugreportBufferOptions = useMemo(() => {
    const summary = bugreportLogSummary;
    if (!summary) {
      return [] as Array<{ key: string; count: number }>;
    }
    const preferredOrder = ["main", "system", "crash", "events", "radio"];
    const seen = new Set(preferredOrder);
    const extraKeys = Object.keys(summary.buffers ?? {})
      .filter((key) => !seen.has(key))
      .sort((a, b) => a.localeCompare(b));
    const orderedKeys = [...preferredOrder, ...extraKeys];
    return orderedKeys
      .map((key) => ({ key, count: summary.buffers?.[key] ?? 0 }))
      .filter((item) => item.count > 0);
  }, [bugreportLogSummary]);
  const bugreportLogFilters = useMemo<BugreportLogFilters>(() => {
    const pidValue = Number.parseInt(bugreportLogPid.trim(), 10);
    const enabledLevels = LOG_LEVELS.filter((level) => logLevels[level]);
    const sharedFilters = buildLogTextFilters(sharedLogTextChips);
    const liveInclude = bugreportLogFilterKind === "include" ? bugreportLogLiveFilter : "";
    const liveExclude = bugreportLogFilterKind === "exclude" ? bugreportLogLiveFilter : "";
    const regex_terms = normalizeBugreportRegexPatterns([...sharedFilters.text_terms, liveInclude]);
    const regex_excludes = normalizeBugreportRegexPatterns([...sharedFilters.text_excludes, liveExclude]);
    return {
      levels: enabledLevels,
      buffer: bugreportLogBuffer.trim() || null,
      tag: bugreportLogTag.trim() || null,
      pid: Number.isNaN(pidValue) ? null : pidValue,
      text_terms: [],
      text_excludes: [],
      text: null,
      regex_terms,
      regex_excludes,
      start_ts: normalizeBugreportTimestamp(bugreportLogStart),
      end_ts: normalizeBugreportTimestamp(bugreportLogEnd),
    };
  }, [
    bugreportLogBuffer,
    bugreportLogPid,
    bugreportLogTag,
    bugreportLogStart,
    bugreportLogEnd,
    bugreportLogLiveFilter,
    bugreportLogFilterKind,
    logLevels,
    sharedLogTextChips,
  ]);
  const effectiveBugreportLogFilters = bugreportLogFilters;
  const bugreportLogSearchPattern = useMemo(() => {
    const liveInclude = bugreportLogFilterKind === "include" ? bugreportLogLiveFilter.trim() : "";
    const patterns = [
      ...sharedLogTextChips
        .filter((chip) => chip.kind === "include")
        .map((chip) => chip.value.trim())
        .filter(Boolean),
      liveInclude,
    ].filter(Boolean);
    const valid = normalizeBugreportRegexPatterns(patterns);
    if (valid.length === 0) {
      return null;
    }
    const combined = valid.map((pattern) => `(?:${pattern})`).join("|");
    return buildSearchRegex(combined, { caseSensitive: false, regex: true });
  }, [bugreportLogFilterKind, bugreportLogLiveFilter, sharedLogTextChips]);
  const bugreportLogOutputPaths = useMemo(
    () => new Set(bugreportAnalysisTargets.map((item) => item.output_path)),
    [bugreportAnalysisTargets],
  );

  useEffect(() => {
    bugreportLogLoadAllRunningRef.current = bugreportLogLoadAllRunning;
  }, [bugreportLogLoadAllRunning]);

  useEffect(() => {
    if (!bugreportLogSourcePath && bugreportAnalysisTargets.length > 0) {
      setBugreportLogSourcePath(bugreportAnalysisTargets[0].output_path);
    }
  }, [bugreportAnalysisTargets, bugreportLogSourcePath]);

  useEffect(() => {
    filesDragContextRef.current = {
      pathname: location.pathname,
      serial: activeSerial ?? "",
      path: filesPath,
      overwrite: filesOverwriteEnabled,
      existingNames: files.map((entry) => entry.name),
    };
  }, [activeSerial, files, filesOverwriteEnabled, filesPath, location.pathname]);

  useEffect(() => {
    apkDragContextRef.current = {
      pathname: location.pathname,
      mode: apkInstallMode,
    };
  }, [apkInstallMode, location.pathname]);

  useEffect(() => {
    if (!devicePopoverOpen) {
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (
        devicePopoverRef.current?.contains(target) ||
        devicePopoverTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setDevicePopoverOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDevicePopoverOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [devicePopoverOpen]);

  useEffect(() => {
    if (!topActionsMenuOpen) {
      return;
    }
    topActionsMenuWasOpenRef.current = true;
    const focusFrame = window.requestAnimationFrame(() => {
      const firstItem = topActionsMenuRef.current?.querySelector<HTMLButtonElement>(
        ".context-menu-item:not(:disabled)",
      );
      firstItem?.focus();
    });
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (topActionsMenuRef.current?.contains(target) || topActionsMenuButtonRef.current?.contains(target)) {
        return;
      }
      setTopActionsMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTopActionsMenuOpen(false);
      }
    };
    const handleScroll = () => setTopActionsMenuOpen(false);
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [topActionsMenuOpen]);

  useEffect(() => {
    if (topActionsMenuOpen) {
      return;
    }
    if (!topActionsMenuWasOpenRef.current) {
      return;
    }
    topActionsMenuWasOpenRef.current = false;
    topActionsMenuButtonRef.current?.focus();
  }, [topActionsMenuOpen]);

  useLayoutEffect(() => {
    if (!devicePopoverOpen) {
      setDevicePopoverLeft(null);
      return;
    }
    const updatePosition = () => {
      const popover = devicePopoverRef.current;
      const trigger = devicePopoverTriggerRef.current;
      if (!popover || !trigger) {
        return;
      }
      const container = popover.offsetParent as HTMLElement | null;
      const containerLeft = container?.getBoundingClientRect().left ?? 0;
      const popoverRect = popover.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const margin = 16;
      const centeredLeft = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2;
      const maxLeft = window.innerWidth - popoverRect.width - margin;
      const shouldAlignLeft = centeredLeft < margin || centeredLeft > maxLeft;
      const left = (shouldAlignLeft ? triggerRect.left : centeredLeft) - containerLeft;
      setDevicePopoverLeft(Math.max(0, left));
    };
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
    };
  }, [devicePopoverOpen, devices, groupMap, taskState.items]);

  useEffect(() => {
    setDevicePopoverOpen(false);
    setTopActionsMenuOpen(false);
    setDashboardConfigOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setFilesDropActive(false);
    setApkDropActive(false);
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      if (detailRefreshTimerRef.current != null) {
        window.clearTimeout(detailRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DEVICE_SELECTION_MODE_STORAGE_KEY, deviceSelectionMode);
    } catch (error) {
      console.warn("Failed to persist device selection mode to storage.", error);
    }
  }, [DEVICE_SELECTION_MODE_STORAGE_KEY, deviceSelectionMode]);

  useEffect(() => {
    try {
      localStorage.setItem(DEVICE_ITEM_INFO_FIELDS_STORAGE_KEY, JSON.stringify(deviceItemInfoFieldIds));
    } catch (error) {
      console.warn("Failed to persist device item info fields to storage.", error);
    }
  }, [DEVICE_ITEM_INFO_FIELDS_STORAGE_KEY, deviceItemInfoFieldIds]);

  const handleSetDeviceSelectionMode = (mode: DeviceSelectionMode) => {
    setDeviceSelectionMode(mode);
    if (mode === "single") {
      setSelectedSerials((prev) => (prev.length > 0 ? [prev[0]] : []));
    }
  };

  const selectedDeviceItemInfoFieldSet = useMemo(
    () => new Set(deviceItemInfoFieldIds),
    [deviceItemInfoFieldIds],
  );
  const handleToggleDeviceItemInfoField = (fieldId: DeviceItemInfoFieldId, checked: boolean) => {
    setDeviceItemInfoFieldIds((prev) => {
      if (checked) {
        return normalizeDeviceItemInfoFieldIds([...prev, fieldId]);
      }
      if (prev.length <= 1 && prev.includes(fieldId)) {
        return prev;
      }
      return normalizeDeviceItemInfoFieldIds(prev.filter((item) => item !== fieldId));
    });
  };
  const handleResetDeviceItemInfoFields = () => {
    setDeviceItemInfoFieldIds([...DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS]);
  };

  const handleSelectActiveSerial = (serial: string) => {
    setSelectedSerials((prev) => setPrimarySelection(prev, serial));
  };

  const getDeviceTone = (state: string) => {
    if (state === "device") {
      return "ok";
    }
    if (state === "unauthorized") {
      return "error";
    }
    if (state === "offline") {
      return "warn";
    }
    return "warn";
  };

  useEffect(() => {
    const key = "lazy_blacktea_tasks_v1";
    const load = () => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) {
          return;
        }
        if (raw.length > 800_000) {
          console.warn("Task Center storage is too large; skipping load.");
          localStorage.removeItem(key);
          return;
        }
        const parsed = parseStoredTaskState(raw);
        if (!parsed) {
          return;
        }
        const inflated = inflateStoredTaskState(parsed, 50);
        const restored = finalizeRestoredTaskState(inflated);
        dispatchTasks({ type: "TASK_SET_ALL", items: restored.items, max_items: restored.max_items });
      } catch (error) {
        console.warn("Failed to load Task Center state from storage.", error);
      }
    };
    const handle = window.setTimeout(load, 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(ERROR_RECORDS_STORAGE_KEY);
        if (!raw) {
          return;
        }
        if (raw.length > 800_000) {
          console.warn("Task Center error storage is too large; skipping load.");
          localStorage.removeItem(ERROR_RECORDS_STORAGE_KEY);
          return;
        }
        const parsed = parseStoredErrorState(raw);
        if (!parsed) {
          return;
        }
        const inflated = inflateStoredErrorState(parsed);
        dispatchErrors({ type: "ERROR_SET_ALL", items: inflated.items, max_items: inflated.max_items });
      } catch (error) {
        console.warn("Failed to load Task Center error state from storage.", error);
      }
    };
    const handle = window.setTimeout(load, 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    const key = APK_INSTALLER_STORAGE_KEY;
    const load = () => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) {
          return;
        }
        if (raw.length > 200_000) {
          console.warn("APK installer storage is too large; skipping load.");
          localStorage.removeItem(key);
          return;
        }
        const parsed = JSON.parse(raw) as unknown;
        const stored = sanitizeStoredState(parsed);
        if (!stored) {
          localStorage.removeItem(key);
          return;
        }
        setApkInstallMode(stored.mode);
        setApkPath(stored.single_path);
        setApkBundlePath(stored.bundle_path);
        setApkPaths(stored.multi_paths);
      } catch (error) {
        console.warn("Failed to load APK installer state from storage.", error);
      }
    };
    const handle = window.setTimeout(load, 0);
    return () => window.clearTimeout(handle);
  }, []);

  const taskPersistTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const key = "lazy_blacktea_tasks_v1";
    if (taskPersistTimerRef.current != null) {
      window.clearTimeout(taskPersistTimerRef.current);
    }
    taskPersistTimerRef.current = window.setTimeout(() => {
      try {
        const stored = sanitizeTaskStateForStorage(taskState);
        localStorage.setItem(key, JSON.stringify(stored));
      } catch (error) {
        console.warn("Failed to persist Task Center state to storage.", error);
      }
    }, 1200);
    return () => {
      if (taskPersistTimerRef.current != null) {
        window.clearTimeout(taskPersistTimerRef.current);
      }
    };
  }, [taskState]);

  useEffect(() => {
    const key = "lazy_blacktea_tasks_v1";
    const flush = () => {
      try {
        const stored = sanitizeTaskStateForStorage(taskStateRef.current);
        localStorage.setItem(key, JSON.stringify(stored));
      } catch (error) {
        console.warn("Failed to persist Task Center state to storage.", error);
      }
    };
    // Ensure we don't lose running task state if the app is reloaded/closed before the debounce fires.
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const errorPersistTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (errorPersistTimerRef.current != null) {
      window.clearTimeout(errorPersistTimerRef.current);
    }
    errorPersistTimerRef.current = window.setTimeout(() => {
      try {
        const stored = sanitizeErrorStateForStorage(errorState);
        localStorage.setItem(ERROR_RECORDS_STORAGE_KEY, JSON.stringify(stored));
      } catch (error) {
        console.warn("Failed to persist Task Center error state to storage.", error);
      }
    }, 1200);
    return () => {
      if (errorPersistTimerRef.current != null) {
        window.clearTimeout(errorPersistTimerRef.current);
      }
    };
  }, [errorState]);

  useEffect(() => {
    const flush = () => {
      try {
        const stored = sanitizeErrorStateForStorage(errorStateRef.current);
        localStorage.setItem(ERROR_RECORDS_STORAGE_KEY, JSON.stringify(stored));
      } catch (error) {
        console.warn("Failed to persist Task Center error state to storage.", error);
      }
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const apkInstallerPersistTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const key = APK_INSTALLER_STORAGE_KEY;
    if (apkInstallerPersistTimerRef.current != null) {
      window.clearTimeout(apkInstallerPersistTimerRef.current);
    }
    apkInstallerPersistTimerRef.current = window.setTimeout(() => {
      try {
        const candidate = {
          mode: apkInstallMode,
          single_path: apkPath,
          bundle_path: apkBundlePath,
          multi_paths: sanitizeMultiPathsForStorage(apkPaths),
        };
        const sanitized = sanitizeStoredState(candidate);
        if (!sanitized) {
          localStorage.removeItem(key);
          return;
        }
        localStorage.setItem(key, JSON.stringify(sanitized));
      } catch (error) {
        console.warn("Failed to persist APK installer state to storage.", error);
      }
    }, 300);
    return () => {
      if (apkInstallerPersistTimerRef.current != null) {
        window.clearTimeout(apkInstallerPersistTimerRef.current);
      }
    };
  }, [apkBundlePath, apkInstallMode, apkPath, apkPaths]);

  useEffect(() => {
    const targetPath = (
      apkInstallMode === "single"
        ? apkPath
        : apkInstallMode === "bundle"
          ? apkBundlePath
          : apkPaths[0] ?? ""
    ).trim();
    if (!targetPath || !isTauriRuntime()) {
      setApkInspectionInfo(null);
      setApkInspectionError(null);
      setApkInspectionLoading(false);
      return;
    }
    let cancelled = false;
    setApkInspectionLoading(true);
    setApkInspectionError(null);
    const timer = window.setTimeout(() => {
      void inspectApk(targetPath, { recordError: false })
        .then((response) => {
          if (cancelled) {
            return;
          }
          setApkInspectionInfo(response.data);
          setApkInspectionError(null);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          setApkInspectionInfo(null);
          setApkInspectionError(formatError(error));
        })
        .finally(() => {
          if (!cancelled) {
            setApkInspectionLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apkBundlePath, apkInstallMode, apkPath, apkPaths]);

  const rawLogcatLines = useMemo<LogcatLineEntry[]>(
    () => (activeSerial ? logcatLines[activeSerial] ?? [] : []),
    [activeSerial, logcatLines],
  );

  const logcatSearchPattern = useMemo(
    () =>
      buildSearchRegex(logcatSearchTerm, {
        caseSensitive: logcatSearchCaseSensitive,
        regex: logcatSearchRegex,
      }),
    [logcatSearchTerm, logcatSearchCaseSensitive, logcatSearchRegex],
  );

  const sharedLogRegexFilters = useMemo(
    () => buildLogTextFilters(sharedLogTextChips),
    [sharedLogTextChips],
  );

  const logcatBaseFilterState = useMemo<LogcatBaseFilterState>(() => {
    const liveInclude = logcatTextKind === "include" ? logcatLiveFilter : "";
    const liveExclude = logcatTextKind === "exclude" ? logcatLiveFilter : "";
    return {
      levels: logLevels,
      activePatterns: sharedLogRegexFilters.text_terms,
      excludePatterns: [...sharedLogRegexFilters.text_excludes, liveExclude].filter(Boolean),
      livePattern: liveInclude,
    };
  }, [
    logLevels,
    logcatLiveFilter,
    logcatTextKind,
    sharedLogRegexFilters.text_terms,
    sharedLogRegexFilters.text_excludes,
  ]);

  const logcatBaseFilterActive = useMemo(
    () => isLogcatBaseFilterActive(logcatBaseFilterState),
    [logcatBaseFilterState],
  );

  useEffect(() => {
    logcatBaseFilterRef.current = {
      active: logcatBaseFilterActive,
      state: logcatBaseFilterState,
    };
  }, [logcatBaseFilterActive, logcatBaseFilterState]);

  const logcatRawBaseFiltered = useMemo(
    () => filterLogcatEntriesByBaseFilters(rawLogcatLines, logcatBaseFilterState),
    [rawLogcatLines, logcatBaseFilterState],
  );

  const logcatRetainedEntries = useMemo<LogcatLineEntry[]>(
    () => (activeSerial ? logcatRetainedBySerial[activeSerial] ?? [] : []),
    [activeSerial, logcatRetainedBySerial],
  );

  const logcatBaseDisplayLines = useMemo(
    () =>
      logcatBaseFilterActive
        ? mergeLogcatEntriesById(logcatRetainedEntries, logcatRawBaseFiltered)
        : rawLogcatLines,
    [logcatBaseFilterActive, logcatRetainedEntries, logcatRawBaseFiltered, rawLogcatLines],
  );

  const logcatFiltered = useMemo(
    () =>
      filterLogcatEntriesBySearch(logcatBaseDisplayLines, {
        searchTerm: logcatSearchTerm,
        searchCaseSensitive: logcatSearchCaseSensitive,
        searchRegex: logcatSearchRegex,
        searchOnly: logcatSearchOnly,
      }),
    [
      logcatBaseDisplayLines,
      logcatSearchTerm,
      logcatSearchCaseSensitive,
      logcatSearchRegex,
      logcatSearchOnly,
    ],
  );

  const logcatLineIndexById = useMemo(() => {
    const map = new Map<number, number>();
    logcatFiltered.lines.forEach((entry, index) => {
      map.set(entry.id, index);
    });
    return map;
  }, [logcatFiltered.lines]);

  const selectedLogcatPreset = useMemo(
    () => logcatPresets.find((preset) => preset.name === logcatPresetSelected) ?? null,
    [logcatPresets, logcatPresetSelected],
  );
  const selectedBugreportPreset = useMemo(
    () => bugreportPresets.find((preset) => preset.name === bugreportPresetSelected) ?? null,
    [bugreportPresets, bugreportPresetSelected],
  );
  const groupedBugreportCustomViews = useMemo(
    () => groupBugreportCustomViews(bugreportCustomViews),
    [bugreportCustomViews],
  );
  const selectedBugreportCustomView = useMemo(
    () => bugreportCustomViews.find((view) => view.id === bugreportCustomViewSelectedId) ?? null,
    [bugreportCustomViews, bugreportCustomViewSelectedId],
  );
  const activeBugreportCustomView = useMemo(
    () =>
      activeBugreportCustomViewSession
        ? bugreportCustomViews.find((view) => view.id === activeBugreportCustomViewSession.template_id) ?? null
        : null,
    [activeBugreportCustomViewSession, bugreportCustomViews],
  );
  const bugreportCustomViewEditorDirty = useMemo(() => {
    if (!selectedBugreportCustomView) {
      const hasAnyText = Boolean(
        bugreportCustomViewEditor.name.trim() ||
          bugreportCustomViewEditor.group.trim() ||
          bugreportCustomViewEditor.defaultInput.trim(),
      );
      const hasKindOverride = bugreportCustomViewEditor.templateKind !== "service";
      return hasAnyText || hasKindOverride;
    }
    return (
      selectedBugreportCustomView.group.trim() !== bugreportCustomViewEditor.group.trim() ||
      selectedBugreportCustomView.name.trim() !== bugreportCustomViewEditor.name.trim() ||
      selectedBugreportCustomView.template_kind !== bugreportCustomViewEditor.templateKind ||
      (selectedBugreportCustomView.default_input ?? "").trim() !==
        bugreportCustomViewEditor.defaultInput.trim()
    );
  }, [bugreportCustomViewEditor, selectedBugreportCustomView]);
  const activeBugreportExtractResult = activeBugreportCustomViewSession?.result_snapshot ?? null;
  const activeBugreportExtractHighlightPattern = useMemo(() => {
    if (!activeBugreportCustomViewSession) {
      return null;
    }
    return buildSearchRegex(activeBugreportCustomViewSession.input_value, {
      caseSensitive: false,
      regex: false,
    });
  }, [activeBugreportCustomViewSession]);
  const logLevelsSummary = useMemo(() => summarizeLogLevels(logLevels), [logLevels]);
  const logcatPresetDirty = useMemo(() => {
    if (!selectedLogcatPreset) {
      return false;
    }
    return (
      !areStringArraysEqual(selectedLogcatPreset.include, sharedLogRegexFilters.text_terms) ||
      !areStringArraysEqual(selectedLogcatPreset.exclude, sharedLogRegexFilters.text_excludes) ||
      !areLogLevelsEqual(normalizePresetLevels(selectedLogcatPreset.levels), logLevels)
    );
  }, [
    selectedLogcatPreset,
    sharedLogRegexFilters.text_terms,
    sharedLogRegexFilters.text_excludes,
    logLevels,
  ]);
  const bugreportPresetDirty = useMemo(() => {
    if (!selectedBugreportPreset) {
      return false;
    }
    return (
      !areStringArraysEqual(selectedBugreportPreset.include, sharedLogRegexFilters.text_terms) ||
      !areStringArraysEqual(selectedBugreportPreset.exclude, sharedLogRegexFilters.text_excludes) ||
      !areLogLevelsEqual(normalizePresetLevels(selectedBugreportPreset.levels), logLevels) ||
      (selectedBugreportPreset.buffer ?? "").trim() !== bugreportLogBuffer.trim() ||
      (selectedBugreportPreset.tag ?? "").trim() !== bugreportLogTag.trim() ||
      (selectedBugreportPreset.pid ?? "").trim() !== bugreportLogPid.trim() ||
      (selectedBugreportPreset.start ?? "").trim() !== bugreportLogStart.trim() ||
      (selectedBugreportPreset.end ?? "").trim() !== bugreportLogEnd.trim()
    );
  }, [
    selectedBugreportPreset,
    sharedLogRegexFilters.text_terms,
    sharedLogRegexFilters.text_excludes,
    logLevels,
    bugreportLogBuffer,
    bugreportLogTag,
    bugreportLogPid,
    bugreportLogStart,
    bugreportLogEnd,
  ]);

  const runningTaskCount = useMemo(
    () => taskState.items.filter((task) => task.status === "running").length,
    [taskState.items],
  );
  const activeTaskCompletionNotice = taskCompletionNotices[0] ?? null;
  const activeCompletionOutputPaths = activeTaskCompletionNotice?.outputPaths ?? [];
  const visibleCompletionOutputPaths = useMemo(
    () =>
      taskCompletionPathsExpanded
        ? activeCompletionOutputPaths
        : activeCompletionOutputPaths.slice(0, 3),
    [activeCompletionOutputPaths, taskCompletionPathsExpanded],
  );

  useEffect(() => {
    setTaskCompletionPathsExpanded(false);
  }, [activeTaskCompletionNotice?.taskId]);

  useEffect(() => {
    if (!logcatPresetSelected) {
      return;
    }
    if (!logcatPresets.some((preset) => preset.name === logcatPresetSelected)) {
      setLogcatPresetSelected("");
    }
  }, [logcatPresets, logcatPresetSelected]);

  useEffect(() => {
    if (!bugreportPresetSelected) {
      return;
    }
    if (!bugreportPresets.some((preset) => preset.name === bugreportPresetSelected)) {
      setBugreportPresetSelected("");
    }
  }, [bugreportPresets, bugreportPresetSelected]);

  const uiScreenshotSrc = uiScreenshotDataUrl;
  const uiNodesParse = useMemo(() => parseUiNodes(uiXml), [uiXml]);
  const uiXmlView = useMemo(() => buildUiInspectorXmlView(uiXml), [uiXml]);
  const uiActiveXmlView = uiXmlViewMode === "pretty" ? uiXmlView.pretty : uiXmlView.raw;
  const uiFilterTokenRef = useRef(0);
  const uiAutoSyncTokenRef = useRef(0);

  useEffect(() => {
    if (!isUiInspectorView && uiAutoSyncEnabled) {
      setUiAutoSyncEnabled(false);
    }
  }, [isUiInspectorView, uiAutoSyncEnabled]);

  useEffect(() => {
    const token = uiFilterTokenRef.current + 1;
    uiFilterTokenRef.current = token;
    const query = uiInspectorSearch.trim().toLowerCase();
    const delay = query ? 200 : 0;
    const handle = window.setTimeout(() => {
      if (uiFilterTokenRef.current !== token) {
        return;
      }
      if (!query) {
        setFilteredUiXml(uiActiveXmlView);
        return;
      }
      const next = filterUiInspectorXmlLines(uiActiveXmlView, query);
      setFilteredUiXml(next);
    }, delay);
    return () => window.clearTimeout(handle);
  }, [uiActiveXmlView, uiInspectorSearch]);

  useEffect(() => {
    if (!uiScreenshotSrc) {
      setUiScreenshotSize({ width: 0, height: 0 });
    }
  }, [uiScreenshotSrc]);

  useEffect(() => {
    if (!uiAutoSyncEnabled) {
      return;
    }
    if (!isUiInspectorView) {
      return;
    }
    if (!activeSerial) {
      setUiAutoSyncEnabled(false);
      return;
    }

    const serial = activeSerial;
    const intervalMs = Math.max(250, uiAutoSyncIntervalMs);
    const token = uiAutoSyncTokenRef.current + 1;
    uiAutoSyncTokenRef.current = token;
    const taskId = beginUiAutoSyncTask(serial);
    let stopped = false;

    const runOnce = async () => {
      try {
        const response = await captureUiHierarchy(serial, { recordError: false });
        if (stopped || uiAutoSyncTokenRef.current !== token) {
          return;
        }
        const syncedAt = Date.now();
        if (response.trace_id) {
          dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
        }
        setUiHtml(response.data.html);
        setUiXml(response.data.xml);
        setUiScreenshotDataUrl(response.data.screenshot_data_url ?? "");
        setUiScreenshotError(response.data.screenshot_error ?? "");
        setUiAutoSyncLastAt(syncedAt);
        uiAutoSyncHadSuccessRef.current = true;

        const screenshotIssue = response.data.screenshot_error?.trim() ?? "";
        if (screenshotIssue) {
          const message = `Last error: Screenshot unavailable: ${screenshotIssue}`;
          setUiAutoSyncError(`Screenshot unavailable: ${screenshotIssue}`);
          uiAutoSyncLastErrorRef.current = message;
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: { status: "running", message },
          });
          return;
        }

        setUiAutoSyncError("");
        uiAutoSyncLastErrorRef.current = null;
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial,
          patch: {
            status: "running",
            message: `Last sync ${new Date(syncedAt).toLocaleTimeString()}`,
          },
        });
      } catch (error) {
        if (stopped || uiAutoSyncTokenRef.current !== token) {
          return;
        }
        const structured = normalizeStructuredError(error);
        const message = `Last error: ${formatError(error)}`;
        if (structured.trace_id) {
          dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: structured.trace_id });
        }
        setUiAutoSyncError(formatError(error));
        uiAutoSyncLastErrorRef.current = message;
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial,
          patch: { status: "running", message },
        });
      }
    };

    void (async () => {
      while (!stopped && uiAutoSyncTokenRef.current === token) {
        const startedAt = Date.now();
        await runOnce();
        const elapsed = Date.now() - startedAt;
        const delay = Math.max(200, intervalMs - elapsed);
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    })();

    return () => {
      stopped = true;
      uiAutoSyncTokenRef.current = token + 1;
      finishUiAutoSyncTask(serial);
    };
  }, [activeSerial, isUiInspectorView, uiAutoSyncEnabled, uiAutoSyncIntervalMs]);

  const [uiHoveredNodeIndex, setUiHoveredNodeIndex] = useState<number>(-1);
  const [uiSelectedNodeIndex, setUiSelectedNodeIndex] = useState<number>(-1);
  const uiHoverRafRef = useRef<number | null>(null);
  const uiLastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const uiHoveredNode = uiHoveredNodeIndex >= 0 ? uiNodesParse.nodes[uiHoveredNodeIndex] : null;
  const uiSelectedNode = uiSelectedNodeIndex >= 0 ? uiNodesParse.nodes[uiSelectedNodeIndex] : null;

  useEffect(() => {
    setUiHoveredNodeIndex(-1);
    if (!uiAutoSyncEnabled) {
      setUiSelectedNodeIndex(-1);
      return;
    }
    setUiSelectedNodeIndex((prev) => {
      if (prev < 0) {
        return prev;
      }
      return prev < uiNodesParse.nodes.length ? prev : -1;
    });
  }, [uiAutoSyncEnabled, uiNodesParse.nodes.length, uiXml]);

  useEffect(() => {
    if (uiInspectorTab !== "hierarchy") {
      return;
    }
    const doc = uiHierarchyFrameRef.current?.contentDocument;
    if (!doc) {
      return;
    }

    const prevSelectedIndex = uiHierarchySelectedIndexRef.current;
    if (prevSelectedIndex != null && prevSelectedIndex !== uiSelectedNodeIndex) {
      doc.getElementById(`ui-node-${prevSelectedIndex}`)?.classList.remove("is-selected");
    }

    if (uiSelectedNodeIndex < 0) {
      uiHierarchySelectedIndexRef.current = null;
      return;
    }

    uiHierarchySelectedIndexRef.current = uiSelectedNodeIndex;
    const el = doc.getElementById(`ui-node-${uiSelectedNodeIndex}`);
    if (!el) {
      return;
    }
    el.classList.add("is-selected");
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [uiInspectorTab, uiSelectedNodeIndex, uiHierarchyFrameToken]);

  useEffect(() => {
    const canvas = uiBoundsCanvasRef.current;
    const { width, height } = uiScreenshotSize;
    if (!canvas || width <= 0 || height <= 0) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, width, height);
    if (!uiBoundsEnabled) {
      return;
    }
    if (!uiNodesParse.nodes.length) {
      return;
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(59, 130, 246, 0.9)";
    ctx.fillStyle = "rgba(59, 130, 246, 0.06)";

    for (const node of uiNodesParse.nodes) {
      const rect = node.rect;
      const x1 = Math.max(0, Math.min(width, rect.x));
      const y1 = Math.max(0, Math.min(height, rect.y));
      const x2 = Math.max(0, Math.min(width, rect.x + rect.w));
      const y2 = Math.max(0, Math.min(height, rect.y + rect.h));
      const w = x2 - x1;
      const h = y2 - y1;
      if (w <= 0 || h <= 0) {
        continue;
      }
      ctx.fillRect(x1, y1, w, h);
      ctx.strokeRect(x1 + 0.5, y1 + 0.5, w, h);
    }

    if (uiHoveredNode) {
      const rect = uiHoveredNode.rect;
      const x1 = Math.max(0, Math.min(width, rect.x));
      const y1 = Math.max(0, Math.min(height, rect.y));
      const x2 = Math.max(0, Math.min(width, rect.x + rect.w));
      const y2 = Math.max(0, Math.min(height, rect.y + rect.h));
      const w = x2 - x1;
      const h = y2 - y1;
      if (w > 0 && h > 0) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
        ctx.fillStyle = "rgba(245, 158, 11, 0.08)";
        ctx.fillRect(x1, y1, w, h);
        ctx.strokeRect(x1 + 0.5, y1 + 0.5, w, h);
      }
    }

    if (uiSelectedNode) {
      const rect = uiSelectedNode.rect;
      const x1 = Math.max(0, Math.min(width, rect.x));
      const y1 = Math.max(0, Math.min(height, rect.y));
      const x2 = Math.max(0, Math.min(width, rect.x + rect.w));
      const y2 = Math.max(0, Math.min(height, rect.y + rect.h));
      const w = x2 - x1;
      const h = y2 - y1;
      if (w > 0 && h > 0) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(239, 68, 68, 0.95)";
        ctx.fillStyle = "rgba(239, 68, 68, 0.06)";
        ctx.fillRect(x1, y1, w, h);
        ctx.strokeRect(x1 + 0.5, y1 + 0.5, w, h);
      }
    }
  }, [
    uiBoundsEnabled,
    uiHoveredNode,
    uiNodesParse,
    uiScreenshotSize,
    uiSelectedNode,
  ]);

  const ensureSingleSelection = (context: string) => {
    if (!activeSerial) {
      pushToast(`Select a device for ${context}.`, "error");
      return null;
    }
    return activeSerial;
  };

  useEffect(() => {
    if (!appsContextMenu) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAppsContextMenu(null);
      }
    };
    const handleScroll = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!shouldCloseContextMenuOnScroll(target, [appsContextMenuRef.current])) {
        return;
      }
      setAppsContextMenu(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [appsContextMenu]);

  useEffect(() => {
    if (!deviceContextMenu) {
      return;
    }
    deviceContextMenuWasOpenRef.current = true;
    const focusFrame = window.requestAnimationFrame(() => {
      const firstItem = deviceContextMenuRef.current?.querySelector<HTMLButtonElement>(
        ".context-menu-item:not(:disabled)",
      );
      firstItem?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (deviceContextSubmenu) {
          setDeviceContextSubmenu(null);
          return;
        }
        setDeviceContextMenu(null);
      }
    };
    const handleScroll = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (
        !shouldCloseContextMenuOnScroll(target, [
          deviceContextMenuRef.current,
          deviceContextSubmenuRef.current,
        ])
      ) {
        return;
      }
      setDeviceContextMenu(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [deviceContextMenu, deviceContextSubmenu]);

  useEffect(() => {
    if (!deviceContextSubmenu) {
      return;
    }
    const focusFrame = window.requestAnimationFrame(() => {
      const firstItem = deviceContextSubmenuRef.current?.querySelector<HTMLButtonElement>(
        ".context-menu-item:not(:disabled)",
      );
      firstItem?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
    };
  }, [deviceContextSubmenu]);

  useEffect(() => {
    if (deviceContextMenu) {
      return;
    }
    if (!deviceContextMenuWasOpenRef.current) {
      return;
    }
    deviceContextMenuWasOpenRef.current = false;
    const trigger = deviceContextMenuTriggerRef.current;
    if (trigger && document.contains(trigger)) {
      trigger.focus();
    }
    deviceContextMenuTriggerRef.current = null;
    setDeviceContextSubmenu(null);
  }, [deviceContextMenu]);

  useEffect(() => {
    if (!filesContextMenu) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFilesContextMenu(null);
      }
    };
    const handleScroll = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!shouldCloseContextMenuOnScroll(target, [filesContextMenuRef.current])) {
        return;
      }
      setFilesContextMenu(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [filesContextMenu]);

  const openPairingModal = () => dispatchPairing({ type: "OPEN" });
  const closePairingModal = () => dispatchPairing({ type: "CLOSE" });

  const requestRebootConfirm = () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device to reboot.", "error");
      return;
    }
    if (rebootActionMeta.disabled) {
      pushToast("No eligible devices selected to reboot.", "error");
      return;
    }
    setRebootConfirmMode("normal");
    setRebootConfirmOpen(true);
  };

  const closeRebootConfirm = () => setRebootConfirmOpen(false);

  const validateHostPort = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Address is required (host:port).";
    }
    const [host, port] = trimmed.split(":");
    if (!host || !port) {
      return "Use host:port format.";
    }
    if (!Number.isInteger(Number(port)) || Number(port) <= 0) {
      return "Port must be a positive number.";
    }
    return null;
  };

  const validatePairingCode = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Pairing code is required.";
    }
    if (!/^[0-9]{6}$/.test(trimmed)) {
      return "Pairing code should be 6 digits.";
    }
    return null;
  };

  const validatePackageName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Package name is required.";
    }
    if (!/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/.test(trimmed)) {
      return "Invalid package name format.";
    }
    return null;
  };

  const pushToast = (message: string, tone: Toast["tone"]) => {
    if (
      message.startsWith('Tauri runtime not available. Run this app using "npm run tauri dev".') &&
      tauriUnavailableToastShownRef.current
    ) {
      return;
    }
    if (message.startsWith('Tauri runtime not available. Run this app using "npm run tauri dev".')) {
      tauriUnavailableToastShownRef.current = true;
    }

    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, tone }]);
    // Errors linger longer than informational toasts so they are not missed.
    const dismissAfterMs = tone === "error" ? 8000 : 4000;
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, dismissAfterMs);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const pushToastRef = useRef(pushToast);
  useEffect(() => {
    pushToastRef.current = pushToast;
  }, [pushToast]);

  const buildGithubReportKey = (taskId: string, serial: string) => `${taskId}:${serial}`;
  const buildGithubErrorReportKey = (errorId: string) => `error:${errorId}`;

  const parseErrorCode = (value: string | null | undefined) => {
    if (!value) {
      return null;
    }
    const match = value.match(/\((ERR_[A-Z0-9_]+)\)/);
    return match ? match[1] : null;
  };

  const recordAppError = (input: {
    title: string;
    source: string;
    error?: unknown;
    message?: string | null;
    code?: string | null;
    trace_id?: string | null;
    serial?: string | null;
  }) =>
    recordExternalAppError({
      ...input,
      route: currentRoute,
    });

  const openIssueUrl = async (url: string) => {
    const result = await openGithubIssueUrl(url, {
      openUrl,
      openWindow: (targetUrl) => window.open(targetUrl, "_blank", "noopener,noreferrer"),
      copyText: writeText,
      warn: (message, error) => {
        console.warn(message, error);
      },
      recordFailure: (error) => {
        recordAppError({
          title: "Open GitHub Issue",
          source: "github.open_issue",
          error,
          message: "Failed to open GitHub issue in browser.",
        });
      },
    });
    return result;
  };

  const openGithubIssueWithPrefill = async (
    key: string,
    input: {
      taskTitle: string;
      taskKind: string;
      serial: string;
      traceId?: string | null;
      message?: string | null;
      code?: string | null;
      exitCode?: number | null;
      outputPath?: string | null;
    },
  ) => {
    if (githubReportPendingByKey[key]) {
      return;
    }
    setGithubReportPendingByKey((prev) => ({ ...prev, [key]: true }));

    let diagnosticsPath: string | null = null;
    let diagnosticsError: string | null = null;

    try {
      const response = await exportDiagnosticsBundle();
      diagnosticsPath = response.data.trim() || null;
    } catch (error) {
      diagnosticsError = formatError(error);
    }

    const adbVersion = adbInfoRef.current?.version_output?.trim() || adbInfoRef.current?.error?.trim() || null;
    const issueUrl = buildGithubBugIssueUrl({
      ...input,
      diagnosticsPath,
      diagnosticsError,
      appVersion: appVersionLabel,
      osPlatform: typeof navigator === "undefined" ? "" : navigator.platform,
      adbVersion,
    });

    try {
      const openResult = await openIssueUrl(issueUrl);
      if (openResult.status === "failed") {
        pushToast("Unable to open or copy the GitHub issue URL. Please report it manually.", "error");
        return;
      }

      const baseMessage =
        openResult.status === "copied"
          ? "GitHub issue URL copied to clipboard. Open it manually."
          : "GitHub issue form opened.";

      if (diagnosticsPath) {
        pushToast(`${baseMessage} Attach diagnostics bundle: ${diagnosticsPath}`, "info");
      } else if (diagnosticsError) {
        pushToast(`${baseMessage} Diagnostics bundle unavailable.`, "info");
      } else {
        pushToast(baseMessage, "info");
      }
    } finally {
      setGithubReportPendingByKey((prev) => {
        if (!prev[key]) {
          return prev;
        }
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleReportTaskIssue = async (task: TaskItem, serial: string) => {
    const entry = task.devices[serial];
    if (!entry || entry.status !== "error") {
      return;
    }

    await openGithubIssueWithPrefill(buildGithubReportKey(task.id, serial), {
      taskTitle: task.title,
      taskKind: task.kind,
      serial,
      traceId: task.trace_id ?? null,
      message: entry.message ?? entry.stderr ?? null,
      code: parseErrorCode(entry.message) ?? parseErrorCode(entry.stderr),
      exitCode: entry.exit_code ?? null,
      outputPath: entry.output_path ?? null,
    });
  };

  const handleReportErrorRecord = async (record: ErrorRecord) => {
    await openGithubIssueWithPrefill(buildGithubErrorReportKey(record.id), {
      taskTitle: record.title,
      taskKind: record.source,
      serial: record.serial ?? "",
      traceId: record.trace_id ?? null,
      message: record.message,
      code: record.code ?? parseErrorCode(record.message),
      exitCode: null,
      outputPath: null,
    });
  };

  const hasRunningTasksRef = useRef(false);
  useEffect(() => {
    hasRunningTasksRef.current = taskState.items.some(
      (task) => task.status === "running" || Object.values(task.devices).some((entry) => entry.status === "running"),
    );
  }, [taskState.items]);

  const reloadBlockLastToastAtRef = useRef(0);
  useEffect(() => {
    // In production, prevent accidental full reloads that reset the UI and hide running task progress.
    // Dev builds keep default reload behavior for fast iteration.
    if (!isTauriRuntime() || !import.meta.env.PROD) {
      return;
    }

    const maybeToastBlocked = () => {
      const now = Date.now();
      if (now - reloadBlockLastToastAtRef.current < 4000) {
        return;
      }
      reloadBlockLastToastAtRef.current = now;
      pushToastRef.current("Reload is disabled in production to avoid interrupting tasks.", "info");
    };

    const allowNativeContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return false;
      }
      // Preserve basic editing UX for text inputs.
      return Boolean(target.closest('input, textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]'));
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (!hasRunningTasksRef.current) {
        return;
      }
      if (allowNativeContextMenu(event)) {
        return;
      }
      event.preventDefault();
      maybeToastBlocked();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hasRunningTasksRef.current) {
        return;
      }
      const key = event.key.toLowerCase();
      const isReloadShortcut =
        event.key === "F5" || (key === "r" && (event.metaKey || event.ctrlKey));
      if (!isReloadShortcut) {
        return;
      }
      event.preventDefault();
      maybeToastBlocked();
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasRunningTasksRef.current) {
        return;
      }
      // Attempt to warn users if something still triggers a reload/navigation.
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      event.returnValue = "";
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown, { capture: true } as AddEventListenerOptions);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const refreshDesktopNotificationsPermission = async () => {
    const state = await getDesktopNotificationPermission();
    setDesktopNotificationPermission(state);
    return state;
  };

  const handleRequestDesktopNotificationsPermission = async () => {
    const requested = await requestDesktopNotificationPermission();
    setDesktopNotificationPermission(requested);
    if (requested !== "granted") {
      pushToast("Desktop notification permission was not granted.", "error");
    } else {
      pushToast("Desktop notification permission granted.", "info");
    }
  };

  const handleSendTestDesktopNotification = async () => {
    const permission = await refreshDesktopNotificationsPermission();
    if (permission !== "granted") {
      const requested = await requestDesktopNotificationPermission();
      setDesktopNotificationPermission(requested);
      if (requested !== "granted") {
        pushToast("Desktop notification permission is required to send notifications.", "error");
        return;
      }
    }

    const ok = await sendDesktopNotification({
      title: "Lazy Blacktea",
      body: "Desktop notifications are enabled.",
    });
    pushToast(ok ? "Test notification sent." : "Failed to send desktop notification.", ok ? "info" : "error");
  };

  useEffect(() => {
    void refreshDesktopNotificationsPermission();
  }, []);

  const beginTask = (params: { kind: TaskKind; title: string; serials: string[] }) => {
    const id = crypto.randomUUID();
    dispatchTasks({
      type: "TASK_ADD",
      task: createTask({
        id,
        kind: params.kind,
        title: params.title,
        serials: params.serials,
      }),
    });
    return id;
  };

  const setDeviceQuickActionStatuses = (
    serials: string[],
    kind: DeviceQuickActionKind,
    phase: DeviceQuickActionPhase,
    operationId: string,
  ) => {
    setDeviceQuickActionStatusBySerial((prev) => {
      const next = { ...prev };
      serials.forEach((serial) => {
        next[serial] = { id: operationId, kind, phase };
      });
      return next;
    });
  };

  const clearDeviceQuickActionOperation = (operationId: string, serials: string[]) => {
    const timer = deviceQuickActionStatusTimersRef.current[operationId];
    if (timer != null) {
      window.clearTimeout(timer);
      delete deviceQuickActionStatusTimersRef.current[operationId];
    }
    setDeviceQuickActionStatusBySerial((prev) => {
      const next = { ...prev };
      serials.forEach((serial) => {
        if (next[serial]?.id === operationId) {
          delete next[serial];
        }
      });
      return next;
    });
  };

  const scheduleDeviceQuickActionStatusClear = (operationId: string, serials: string[]) => {
    const existingTimer = deviceQuickActionStatusTimersRef.current[operationId];
    if (existingTimer != null) {
      window.clearTimeout(existingTimer);
    }
    deviceQuickActionStatusTimersRef.current[operationId] = window.setTimeout(() => {
      clearDeviceQuickActionOperation(operationId, serials);
    }, DEVICE_QUICK_ACTION_STATUS_TTL_MS);
  };

  const finishDeviceQuickActionOperation = ({
    operationId,
    kind,
    successSerials,
    errorSerials,
  }: {
    operationId: string;
    kind: DeviceQuickActionKind;
    successSerials: string[];
    errorSerials: string[];
  }) => {
    const affectedSerials = Array.from(new Set([...successSerials, ...errorSerials]));
    setDeviceQuickActionStatusBySerial((prev) => {
      const next = { ...prev };
      successSerials.forEach((serial) => {
        next[serial] = { id: operationId, kind, phase: "success" };
      });
      errorSerials.forEach((serial) => {
        next[serial] = { id: operationId, kind, phase: "error" };
      });
      return next;
    });
    if (affectedSerials.length) {
      scheduleDeviceQuickActionStatusClear(operationId, affectedSerials);
    }
  };

  const beginUiAutoSyncTask = (serial: string) => {
    const existingTaskId = uiAutoSyncTaskIdRef.current;
    if (existingTaskId) {
      return existingTaskId;
    }
    const taskId = beginTask({
      kind: "ui_inspector_auto_sync",
      title: "UI Auto Sync",
      serials: [serial],
    });
    uiAutoSyncTaskIdRef.current = taskId;
    uiAutoSyncHadSuccessRef.current = false;
    uiAutoSyncLastErrorRef.current = null;
    dispatchTasks({
      type: "TASK_UPDATE_DEVICE",
      id: taskId,
      serial,
      patch: { status: "running", message: "Auto sync running..." },
    });
    return taskId;
  };

  const finishUiAutoSyncTask = (serial: string) => {
    const taskId = uiAutoSyncTaskIdRef.current;
    if (!taskId) {
      return;
    }
    const finalStatus =
      uiAutoSyncHadSuccessRef.current && !uiAutoSyncLastErrorRef.current ? "success" : "error";
    dispatchTasks({
      type: "TASK_UPDATE_DEVICE",
      id: taskId,
      serial,
      patch: {
        status: finalStatus,
        message:
          finalStatus === "success"
            ? "Auto sync stopped."
            : uiAutoSyncLastErrorRef.current ?? "Auto sync stopped with errors.",
      },
    });
    dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: finalStatus });
    uiAutoSyncTaskIdRef.current = null;
    uiAutoSyncHadSuccessRef.current = false;
    uiAutoSyncLastErrorRef.current = null;
  };

  const maybeNotifyTaskCompletion = async (task: TaskItem) => {
    const settings = config?.notifications;
    if (!settings?.enabled || !settings.desktop_enabled) {
      return;
    }

    if (settings.desktop_only_when_unfocused && !isAppUnfocused()) {
      return;
    }

    if (task.status === "success" && !settings.desktop_on_success) {
      return;
    }
    if (task.status === "error" && !settings.desktop_on_error) {
      return;
    }
    if ((task.status === "cancelled" || task.status === "interrupted") && !settings.desktop_on_cancelled) {
      return;
    }

    const payload = buildDesktopNotificationForTask(task);
    if (!payload) {
      return;
    }

    const permission = await getDesktopNotificationPermission();
    if (permission !== "granted") {
      return;
    }

    await sendDesktopNotification({
      title: payload.title,
      body: payload.body,
    });
  };

  const maybeShowTaskCompletionModal = (task: TaskItem) => {
    const settings = config?.notifications;
    if (!settings?.enabled || !settings.in_app_modal_enabled) {
      return;
    }

    const payload = buildTaskCompletionNotice(task);
    if (!payload) {
      return;
    }

    setTaskCompletionNotices((prev) => {
      if (prev.some((notice) => notice.taskId === payload.taskId)) {
        return prev;
      }
      return [...prev, payload];
    });
  };

  const closeTaskCompletionModal = () => {
    setTaskCompletionPathsExpanded(false);
    setTaskCompletionNotices((prev) => prev.slice(1));
  };

  const openTaskCenterFromCompletionModal = () => {
    closeTaskCompletionModal();
    navigate("/tasks");
  };

  const openExternalPath = async (path: string) => {
    try {
      await openPath(path);
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const handleCopyCompletionOutputPath = async (path: string) => {
    try {
      await writeText(path);
      pushToast("Path copied.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  useEffect(() => {
    const prev = prevTaskItemsRef.current;
    const next = taskState.items;
    if (!prev) {
      prevTaskItemsRef.current = next;
      return;
    }

    const newlyCompleted = detectNewlyCompletedTasks(prev, next);
    newlyCompleted.forEach((task) => {
      if (notifiedTaskIdsRef.current.has(task.id)) {
        return;
      }
      notifiedTaskIdsRef.current.add(task.id);
      void maybeNotifyTaskCompletion(task);
      maybeShowTaskCompletionModal(task);
    });

    prevTaskItemsRef.current = next;
  }, [taskState.items]);

  const getDeviceRetentionConfig = (): DeviceRetentionConfig => ({
    enabled: configRef.current?.device.device_retention_enabled !== false,
    rebootTimeoutSec: clampRetentionTimeoutSec(configRef.current?.device.device_reboot_retention_timeout_sec, 90),
    disconnectTimeoutSec: clampRetentionTimeoutSec(configRef.current?.device.device_disconnect_retention_timeout_sec, 45),
  });

  const handleDismissRetainedDevice = (serial: string) => {
    const { mergedDevices, nextRetentionMap } = dismissRetainedDevice({
      currentDevices: devicesRef.current,
      retentionMap: retentionMapRef.current,
      serial,
    });
    setRetentionMap(nextRetentionMap);
    setDevices(mergedDevices);
    setSelectedSerials((prev) => resolveSelectedSerialsForContext(prev, mergedDevices));
  };

  const refreshDeviceDetails = async (options: { notifyOnError?: boolean } = {}) => {
    const refreshId = ++detailRefreshSeqRef.current;
    try {
      const response = await listDevices(true, { recordError: false });
      if (refreshId !== detailRefreshSeqRef.current) {
        return;
      }
      const { mergedDevices, nextRetentionMap } = reconcileDevicesWithRetention({
        currentDevices: devicesRef.current,
        incomingDevices: response.data,
        retentionMap: retentionMapRef.current,
        config: getDeviceRetentionConfig(),
      });
      setRetentionMap(nextRetentionMap);
      setDevices(mergedDevices);
    } catch (error) {
      if (options.notifyOnError) {
        pushToast(`Detail refresh failed: ${formatError(error)}`, "error");
      } else {
        console.warn("Device detail refresh failed.", error);
      }
    }
  };

  const scheduleDeviceDetailRefresh = (delayMs = 600, options: { notifyOnError?: boolean } = {}) => {
    if (detailRefreshTimerRef.current != null) {
      window.clearTimeout(detailRefreshTimerRef.current);
    }
    detailRefreshTimerRef.current = window.setTimeout(() => {
      void refreshDeviceDetails(options);
    }, delayMs);
  };

  const applyDeviceTrackingSnapshot = (
    nextDevices: DeviceInfo[],
    options: { allowDetailRefresh: boolean; forceDetailRefresh?: boolean },
  ) => {
    const previousAndroidDevices = devicesRef.current.filter((device) => getDevicePlatform(device) === "android");
    const prevBySerial = new Map(
      previousAndroidDevices.map((device) => [device.summary.serial, device.summary.state] as const),
    );
    const nextBySerial = new Map(
      nextDevices.map((device) => [device.summary.serial, device.summary.state] as const),
    );
    const serialsChanged =
      prevBySerial.size !== nextBySerial.size || Array.from(nextBySerial.keys()).some((serial) => !prevBySerial.has(serial));
    const statesChanged = Array.from(nextBySerial.entries()).some(([serial, state]) => prevBySerial.get(serial) !== state);
    const shouldRefreshDetail = options.forceDetailRefresh === true || serialsChanged || statesChanged;

    // Tracking snapshots contain summaries only; reconcile with retention to keep rebooting/offline devices.
    const { mergedDevices, nextRetentionMap, restoredSerials } = reconcileDevicesWithRetention({
      currentDevices: devicesRef.current,
      incomingDevices: nextDevices,
      retentionMap: retentionMapRef.current,
      config: getDeviceRetentionConfig(),
    });
    setRetentionMap(nextRetentionMap);
    setDevices(mergedDevices);
    setSelectedSerials((prev) => resolveSelectedSerialsForContext(prev, mergedDevices));
    if (restoredSerials.length > 0) {
      scheduleDeviceDetailRefresh(500, { notifyOnError: false });
    }
    if (options.allowDetailRefresh && shouldRefreshDetail) {
      scheduleDeviceDetailRefresh(800, { notifyOnError: false });
    }
  };

  const flushPendingDeviceTrackingSnapshot = (
    options: { allowDetailRefresh: boolean; forceDetailRefresh?: boolean },
  ) => {
    const pending = deviceTrackingPendingSnapshotRef.current;
    if (!pending) {
      return;
    }
    deviceTrackingPendingSnapshotRef.current = null;
    applyDeviceTrackingSnapshot(pending, options);
  };

  const refreshDeviceSummaryOnce = async (notifyOnError = false) => {
    if (busyRef.current || deviceTrackingFallbackInFlightRef.current) {
      return;
    }

    deviceTrackingFallbackInFlightRef.current = true;
    try {
      const response = await listDevices(false, { recordError: false });
      const { mergedDevices, nextRetentionMap, restoredSerials } = reconcileDevicesWithRetention({
        currentDevices: devicesRef.current,
        incomingDevices: response.data,
        retentionMap: retentionMapRef.current,
        config: getDeviceRetentionConfig(),
      });
      setRetentionMap(nextRetentionMap);
      setDevices(mergedDevices);
      setSelectedSerials((prev) => resolveSelectedSerialsForContext(prev, mergedDevices));
      if (restoredSerials.length > 0 || configRef.current?.device.auto_refresh_enabled) {
        scheduleDeviceDetailRefresh(800, { notifyOnError });
      }
    } catch (error) {
      if (notifyOnError) {
        pushToast(`Device summary refresh failed: ${formatError(error)}`, "error");
      } else {
        console.warn("Device summary refresh failed.", error);
      }
    } finally {
      deviceTrackingFallbackInFlightRef.current = false;
    }
  };

  const refreshDevices = async () => {
    const refreshId = ++refreshSeqRef.current;
    setBusy(true);
    try {
      try {
        const adbResponse = await checkAdb();
        if (refreshId !== refreshSeqRef.current) {
          return;
        }
        setAdbInfo(adbResponse.data);
      } catch (error) {
        console.warn("ADB availability check failed.", error);
      }
      if (refreshId !== refreshSeqRef.current) {
        return;
      }
      const response = await listDevices(false);
      if (refreshId !== refreshSeqRef.current) {
        return;
      }
      const { mergedDevices, nextRetentionMap } = reconcileDevicesWithRetention({
        currentDevices: devicesRef.current,
        incomingDevices: response.data,
        retentionMap: retentionMapRef.current,
        config: getDeviceRetentionConfig(),
      });
      setRetentionMap(nextRetentionMap);
      setDevices(mergedDevices);
      setSelectedSerials((prev) => resolveSelectedSerialsForContext(prev, mergedDevices));
      void refreshDeviceDetails({ notifyOnError: false });
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      if (refreshId === refreshSeqRef.current) {
        setBusy(false);
      }
    }
  };

  const handlePairSubmit = async () => {
    const addressError = validateHostPort(pairingState.pairAddress);
    const codeError = validatePairingCode(pairingState.pairingCode);
    if (addressError || codeError) {
      dispatchPairing({ type: "PAIR_ERROR", error: [addressError, codeError].filter(Boolean).join(" ") });
      return;
    }
    setBusy(true);
    dispatchPairing({ type: "PAIR_START" });
    try {
      const response = await adbPair(pairingState.pairAddress.trim(), pairingState.pairingCode.trim());
      const combined = `${response.data.stdout}\n${response.data.stderr}`;
      const parsed = parseAdbPairOutput(combined);
      const message = parsed.message || response.data.stdout.trim() || "Paired successfully.";
      const nextConnectAddress = parsed.connectAddress || pairingState.connectAddress;
      dispatchPairing({
        type: "PAIR_SUCCESS",
        message,
        connectAddress: nextConnectAddress,
      });
      pushToast("Wireless pairing succeeded.", "info");
      window.setTimeout(() => {
        connectAddressInputRef.current?.focus();
      }, 0);
    } catch (error) {
      const message = formatError(error);
      dispatchPairing({ type: "PAIR_ERROR", error: message });
      pushToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleConnectSubmit = async (addressOverride?: string) => {
    const connectAddress = (addressOverride ?? pairingState.connectAddress).trim();
    const addressError = validateHostPort(connectAddress);
    if (addressError) {
      dispatchPairing({ type: "CONNECT_ERROR", error: addressError });
      return false;
    }
    setBusy(true);
    dispatchPairing({ type: "CONNECT_START" });
    try {
      const response = await adbConnect(connectAddress);
      const message = response.data.stdout.trim() || "Connected.";
      dispatchPairing({ type: "CONNECT_SUCCESS", message });
      pushToast("Wireless connect succeeded.", "info");
      await refreshDevices();
      return true;
    } catch (error) {
      const message = formatError(error);
      dispatchPairing({ type: "CONNECT_ERROR", error: message });
      pushToast(message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const syncPairingFieldsFromQrPayload = (payload: string) => {
    const parsed = parseQrPayload(payload);
    if (parsed.pairAddress) {
      dispatchPairing({ type: "SET_PAIR_ADDRESS", value: parsed.pairAddress });
    }
    if (parsed.pairingCode) {
      dispatchPairing({ type: "SET_PAIR_CODE", value: parsed.pairingCode });
    }
    return Boolean(parsed.pairAddress || parsed.pairingCode);
  };

  const handlePairAndConnectSubmit = async () => {
    const addressError = validateHostPort(pairingState.pairAddress);
    const codeError = validatePairingCode(pairingState.pairingCode);
    if (addressError || codeError) {
      dispatchPairing({ type: "PAIR_ERROR", error: [addressError, codeError].filter(Boolean).join(" ") });
      return;
    }

    setBusy(true);
    dispatchPairing({ type: "PAIR_START" });
    try {
      const pairResponse = await adbPair(pairingState.pairAddress.trim(), pairingState.pairingCode.trim());
      const pairCombined = `${pairResponse.data.stdout}\n${pairResponse.data.stderr}`;
      const parsedPair = parseAdbPairOutput(pairCombined);
      const pairMessage = parsedPair.message || pairResponse.data.stdout.trim() || "Paired successfully.";
      const nextConnectAddress = (parsedPair.connectAddress || pairingState.connectAddress).trim();

      dispatchPairing({
        type: "PAIR_SUCCESS",
        message: pairMessage,
        connectAddress: nextConnectAddress,
      });

      if (!nextConnectAddress) {
        dispatchPairing({ type: "PAIR_ERROR", error: "Pairing succeeded, but connect address is missing." });
        pushToast("Pairing succeeded, but connect address is missing.", "error");
        return;
      }

      dispatchPairing({ type: "CONNECT_START" });
      const connectResponse = await adbConnect(nextConnectAddress);
      const connectMessage = connectResponse.data.stdout.trim() || "Connected.";
      dispatchPairing({ type: "CONNECT_SUCCESS", message: connectMessage });
      pushToast("Wireless pairing and connect succeeded.", "info");
      await refreshDevices();
    } catch (error) {
      const message = formatError(error);
      dispatchPairing({ type: "CONNECT_ERROR", error: message });
      pushToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const loadConfig = async () => {
    try {
      const response = await getConfig();
      setConfig(response.data);
      setApkExtraArgs(response.data.apk_install.extra_args);
      setApkAllowDowngrade(response.data.apk_install.allow_downgrade);
      setApkReplace(response.data.apk_install.replace_existing);
      setApkGrant(response.data.apk_install.grant_permissions);
      setApkAllowTest(response.data.apk_install.allow_test_packages);
      setGroupMap(flattenDeviceGroups(response.data.device_groups));

      const restoreSessions = response.data.terminal?.restore_sessions ?? [];
      const buffers = response.data.terminal?.buffers ?? {};
      setTerminalActiveSerials(restoreSessions);
      setTerminalBySerial((prev) => {
        const next: Record<string, TerminalDeviceState> = { ...prev };
        restoreSessions.forEach((serial) => {
          const existing = next[serial] ?? createDefaultTerminalState();
          const lines = buffers[serial] ?? [];
          next[serial] = {
            ...existing,
            connected: false,
            sessionId: null,
            lines,
            tail: "",
          };
        });
        return next;
      });
      terminalLoadedRef.current = true;
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    adbInfoRef.current = adbInfo;
  }, [adbInfo]);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  useEffect(() => {
    retentionMapRef.current = retentionMap;
  }, [retentionMap]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (Object.keys(retentionMapRef.current).length === 0) {
        return;
      }
      const { mergedDevices, nextRetentionMap, expiredSerials } = tickRetentionRecords({
        currentDevices: devicesRef.current,
        retentionMap: retentionMapRef.current,
        now: Date.now(),
      });
      setRetentionMap(nextRetentionMap);
      if (expiredSerials.length > 0) {
        setDevices(mergedDevices);
        setSelectedSerials((prev) => resolveSelectedSerialsForContext(prev, mergedDevices));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (config?.notifications.enabled && config.notifications.in_app_modal_enabled) {
      return;
    }
    setTaskCompletionNotices((prev) => (prev.length > 0 ? [] : prev));
  }, [config?.notifications.enabled, config?.notifications.in_app_modal_enabled]);

  useEffect(() => {
    return () => {
      if (dashboardCopyTimerRef.current !== null) {
        window.clearTimeout(dashboardCopyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (dashboardConfigOpen) {
      return;
    }
    setDashboardDraft(normalizeDashboardSettings(config?.dashboard));
  }, [config?.dashboard, dashboardConfigOpen]);

  useEffect(() => {
    terminalActiveSerialsRef.current = terminalActiveSerials;
  }, [terminalActiveSerials]);

  useEffect(() => {
    terminalBySerialRef.current = terminalBySerial;
  }, [terminalBySerial]);

  useEffect(() => {
    perfBySerialRef.current = perfBySerial;
  }, [perfBySerial]);

  useEffect(() => {
    netBySerialRef.current = netBySerial;
  }, [netBySerial]);

	  useEffect(() => {
      if (!config) {
        return;
      }

    const warnThrottled = (error: unknown, message: string) => {
      const now = Date.now();
      if (now - deviceAutoRefreshLastWarnAtRef.current < 30_000) {
        return;
      }
      deviceAutoRefreshLastWarnAtRef.current = now;
      console.warn(message, error);
    };

    const unlisten = listen<DeviceTrackingSnapshotPayload>("device-tracking-snapshot", (event) => {
      const nextDevices = event.payload?.devices;
      if (!Array.isArray(nextDevices)) {
        return;
      }
      deviceTrackingLastSnapshotAtRef.current = Date.now();
      deviceTrackingNoSnapshotRestartAttemptsRef.current = 0;
      deviceTrackingRestartWindowStartedAtRef.current = 0;
      deviceTrackingPendingSnapshotRef.current = nextDevices;
      if (busyRef.current) {
        applyDeviceTrackingSnapshot(nextDevices, { allowDetailRefresh: false });
        return;
      }
      flushPendingDeviceTrackingSnapshot({
        allowDetailRefresh: Boolean(configRef.current?.device.auto_refresh_enabled),
      });
	    });

    deviceTrackingStartedAtRef.current = Date.now();
    deviceTrackingLastSnapshotAtRef.current = 0;
    deviceTrackingNoSnapshotRestartAttemptsRef.current = 0;
    deviceTrackingRestartWindowStartedAtRef.current = 0;
    void startDeviceTracking().catch((error) => warnThrottled(error, "Device tracking start failed."));
    void refreshDeviceSummaryOnce(false);
    return () => {
      void unlisten.then((unlisten) => unlisten());
      void stopDeviceTracking().catch(() => null);
    };
  }, [config?.adb.command_path]);

  useEffect(() => {
    if (!config) {
      return;
    }
    if (busy) {
      return;
    }
    const allowDetailRefresh = config.device.auto_refresh_enabled;
    flushPendingDeviceTrackingSnapshot({
      allowDetailRefresh,
      forceDetailRefresh: allowDetailRefresh,
    });
  }, [busy, config?.device.auto_refresh_enabled]);

  // Optional iOS inventory poll — full list_devices so plug/unplug is visible without manual refresh.
  useEffect(() => {
    const intervalMs = getIosAutoRefreshIntervalMs(config);
    if (intervalMs == null) {
      return;
    }
    const handle = window.setInterval(() => {
      if (busyRef.current || deviceTrackingFallbackInFlightRef.current) {
        return;
      }
      void refreshDeviceSummaryOnce(false);
    }, intervalMs);
    return () => {
      window.clearInterval(handle);
    };
  }, [config?.device.ios_auto_refresh_enabled, config?.device.ios_refresh_interval]);

  useEffect(() => {
    if (!config) {
      return;
    }

    const intervalMs = clampRefreshIntervalSec(config.device.refresh_interval) * 1000;
    const handle = window.setInterval(() => {
      if (busyRef.current) {
        return;
      }
      if (deviceTrackingRestartInFlightRef.current) {
        return;
      }

      const now = Date.now();
      const lastSnapshotAt = deviceTrackingLastSnapshotAtRef.current;
      const startedAt = deviceTrackingStartedAtRef.current;
      const warmupMs = Math.max(3_000, intervalMs);
      const maxStartWaitMs = Math.max(10_000, intervalMs * 2);

      if (now - startedAt < warmupMs) {
        return;
      }

      if (lastSnapshotAt !== 0) {
        return;
      }
      if (now - startedAt < maxStartWaitMs) {
        return;
      }

      const restartWindowStartedAt = deviceTrackingRestartWindowStartedAtRef.current;
      if (
        restartWindowStartedAt === 0 ||
        now - restartWindowStartedAt >= DEVICE_TRACKING_RESTART_WINDOW_MS
      ) {
        deviceTrackingRestartWindowStartedAtRef.current = now;
        deviceTrackingNoSnapshotRestartAttemptsRef.current = 0;
      }

      if (
        deviceTrackingNoSnapshotRestartAttemptsRef.current >=
        DEVICE_TRACKING_MAX_NO_SNAPSHOT_RESTARTS
      ) {
        return;
      }

      deviceTrackingRestartInFlightRef.current = true;
      deviceTrackingNoSnapshotRestartAttemptsRef.current += 1;
      void (async () => {
        try {
          await stopDeviceTracking();
        } catch (error) {
          console.warn("Device tracking stop failed.", error);
        }
        try {
          deviceTrackingStartedAtRef.current = Date.now();
          await startDeviceTracking();
          deviceTrackingLastSnapshotAtRef.current = 0;
          void refreshDeviceSummaryOnce(false);
        } catch (error) {
          console.warn("Device tracking restart failed.", error);
          void refreshDeviceSummaryOnce(false);
        } finally {
          deviceTrackingRestartInFlightRef.current = false;
        }
      })();
    }, intervalMs);
    return () => window.clearInterval(handle);
  }, [config?.device.refresh_interval]);

  useEffect(() => {
    void (async () => {
      await loadConfig();
      await refreshDevices();
      didInitialDeviceRefreshRef.current = true;
      void checkScrcpy().then((response) => setScrcpyInfo(response.data)).catch(() => null);
    })();
  }, []);

  useEffect(() => {
    if (!config || !didInitialDeviceRefreshRef.current || didRestoreTerminalRef.current) {
      return;
    }
    didRestoreTerminalRef.current = true;
    const restoreSessions = config.terminal?.restore_sessions ?? [];
    if (!restoreSessions.length) {
      return;
    }
    const deviceStateBySerial = new Map(
      devices.map((device) => [device.summary.serial, device.summary.state] as const),
    );
    restoreSessions.forEach((serial) => {
      if (deviceStateBySerial.get(serial) !== "device") {
        return;
      }
      void connectTerminalInternal(serial)
        .then(() => appendTerminal(serial, "\n[restored]\n"))
        .catch((error) =>
          appendTerminal(serial, `\n[restore error] ${formatError(error)}\n`),
        );
    });
  }, [config, devices]);

  useEffect(() => {
    if (!terminalLoadedRef.current) {
      return;
    }
    schedulePersistTerminalState();
  }, [terminalActiveSerials, terminalBySerial]);

  useEffect(() => {
    return () => {
      if (terminalPersistTimerRef.current != null) {
        window.clearTimeout(terminalPersistTimerRef.current);
        terminalPersistTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const asStringArray = (value: unknown) => {
      if (!Array.isArray(value)) {
        return [];
      }
      return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 50);
    };

    const parseLogcatPreset = (item: unknown): LogcatFilterPreset | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) {
        return null;
      }

      let include = asStringArray(record.include);
      let exclude = asStringArray(record.exclude);

      const legacyPatterns = asStringArray(record.patterns);
      if (include.length === 0 && exclude.length === 0 && legacyPatterns.length > 0) {
        include = legacyPatterns;
      }

      let levels: LogcatLevelsState | undefined;
      if (record.levels && typeof record.levels === "object") {
        const levelsRecord = record.levels as Record<string, unknown>;
        const parsedLevels: Partial<LogcatLevelsState> = {};
        let ok = true;
        LOG_LEVELS.forEach((level) => {
          const value = levelsRecord[level];
          if (typeof value !== "boolean") {
            ok = false;
          } else {
            parsedLevels[level] = value;
          }
        });
        if (ok) {
          levels = parsedLevels as LogcatLevelsState;
        }
      }

      return {
        name,
        include,
        exclude,
        ...(levels ? { levels } : {}),
      };
    };

    const parseStoredPresets = (stored: string | null): LogcatFilterPreset[] => {
      if (!stored) {
        return [];
      }
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (!Array.isArray(parsed)) {
          return [];
        }
        const nextPresets: LogcatFilterPreset[] = [];
        parsed.forEach((item) => {
          const preset = parseLogcatPreset(item);
          if (preset) {
            nextPresets.push(preset);
          }
        });
        return nextPresets;
      } catch {
        return [];
      }
    };

    void (async () => {
      const localPresets = parseStoredPresets(localStorage.getItem(LOGCAT_PRESETS_STORAGE_KEY));
      let nextPresets = localPresets;

      if (isTauriRuntime()) {
        let shouldImportLegacy = false;
        try {
          shouldImportLegacy =
            localStorage.getItem(LOGCAT_PRESETS_LEGACY_MIGRATION_KEY) !== "1";
        } catch (error) {
          console.warn("Failed to read logcat preset migration flag.", error);
        }

        if (shouldImportLegacy) {
          try {
            const response = await loadLegacyLogcatPresets();
            if (response.data.length > 0) {
              const merged = [...localPresets];
              const names = new Set(localPresets.map((preset) => preset.name));
              response.data.forEach((legacyPreset) => {
                const parsedPreset = parseLogcatPreset(legacyPreset);
                if (!parsedPreset || names.has(parsedPreset.name)) {
                  return;
                }
                merged.push(parsedPreset);
                names.add(parsedPreset.name);
              });
              nextPresets = merged;
            }
            try {
              localStorage.setItem(LOGCAT_PRESETS_LEGACY_MIGRATION_KEY, "1");
            } catch (error) {
              console.warn("Failed to persist logcat preset migration flag.", error);
            }
          } catch (error) {
            console.warn("Failed to import legacy logcat presets.", error);
          }
        }
      }

      if (!cancelled) {
        setLogcatPresets(nextPresets);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(LOGCAT_PRESETS_STORAGE_KEY, JSON.stringify(logcatPresets));
  }, [logcatPresets]);

  useEffect(() => {
    const asStringArray = (value: unknown) => {
      if (!Array.isArray(value)) {
        return [];
      }
      return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 50);
    };

    const parseLogcatPreset = (item: unknown): LogcatFilterPreset | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) {
        return null;
      }

      let include = asStringArray(record.include);
      let exclude = asStringArray(record.exclude);

      const legacyPatterns = asStringArray(record.patterns);
      if (include.length === 0 && exclude.length === 0 && legacyPatterns.length > 0) {
        include = legacyPatterns;
      }

      let levels: LogcatLevelsState | undefined;
      if (record.levels && typeof record.levels === "object") {
        const levelsRecord = record.levels as Record<string, unknown>;
        const parsedLevels: Partial<LogcatLevelsState> = {};
        let ok = true;
        LOG_LEVELS.forEach((level) => {
          const value = levelsRecord[level];
          if (typeof value !== "boolean") {
            ok = false;
          } else {
            parsedLevels[level] = value;
          }
        });
        if (ok) {
          levels = parsedLevels as LogcatLevelsState;
        }
      }

      return {
        name,
        include,
        exclude,
        ...(levels ? { levels } : {}),
      };
    };

    const parseOptionalText = (value: unknown) =>
      typeof value === "string" ? value.trim() : "";

    const parseBugreportPreset = (item: unknown): BugreportFilterPreset | null => {
      const base = parseLogcatPreset(item);
      if (!base) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const buffer = parseOptionalText(record.buffer);
      const tag = parseOptionalText(record.tag);
      const pid = parseOptionalText(record.pid);
      const start = parseOptionalText(record.start);
      const end = parseOptionalText(record.end);
      return {
        ...base,
        ...(buffer ? { buffer } : {}),
        ...(tag ? { tag } : {}),
        ...(pid ? { pid } : {}),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
      };
    };

    const parseStoredPresets = (stored: string | null): BugreportFilterPreset[] => {
      if (!stored) {
        return [];
      }
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (!Array.isArray(parsed)) {
          return [];
        }
        const nextPresets: BugreportFilterPreset[] = [];
        parsed.forEach((item) => {
          const preset = parseBugreportPreset(item);
          if (preset) {
            nextPresets.push(preset);
          }
        });
        return nextPresets;
      } catch {
        return [];
      }
    };

    const storedBugreportPresets = localStorage.getItem(BUGREPORT_PRESETS_STORAGE_KEY);
    if (storedBugreportPresets) {
      setBugreportPresets(parseStoredPresets(storedBugreportPresets));
      return;
    }

    const logcatPresetFallback = localStorage.getItem(LOGCAT_PRESETS_STORAGE_KEY);
    const fallbackPresets = parseStoredPresets(logcatPresetFallback);
    if (fallbackPresets.length > 0) {
      setBugreportPresets(fallbackPresets);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(BUGREPORT_PRESETS_STORAGE_KEY, JSON.stringify(bugreportPresets));
  }, [bugreportPresets]);

  useEffect(() => {
    const stored = localStorage.getItem(BUGREPORT_CUSTOM_VIEWS_STORAGE_KEY);
    setBugreportCustomViews(parseBugreportCustomViewsFromStorage(stored));
  }, []);

  useEffect(() => {
    localStorage.setItem(BUGREPORT_CUSTOM_VIEWS_STORAGE_KEY, JSON.stringify(bugreportCustomViews));
  }, [bugreportCustomViews]);

  useEffect(() => {
    if (!bugreportCustomViewSelectedId) {
      return;
    }
    if (!bugreportCustomViews.some((view) => view.id === bugreportCustomViewSelectedId)) {
      setBugreportCustomViewSelectedId("");
    }
  }, [bugreportCustomViews, bugreportCustomViewSelectedId]);

  useEffect(() => {
    if (!bugreportCustomViewSelectedId) {
      setBugreportCustomViewEditor(makeBugreportCustomViewEditor(null));
      setBugreportCustomViewRunInput("");
      return;
    }
    const selected = bugreportCustomViews.find((view) => view.id === bugreportCustomViewSelectedId) ?? null;
    setBugreportCustomViewEditor(makeBugreportCustomViewEditor(selected));
    setBugreportCustomViewRunInput(selected?.default_input ?? "");
  }, [bugreportCustomViewSelectedId, bugreportCustomViews]);

  useEffect(() => {
    if (!activeBugreportCustomViewSession) {
      return;
    }
    const view = bugreportCustomViews.find(
      (entry) => entry.id === activeBugreportCustomViewSession.template_id,
    );
    if (!view) {
      setActiveBugreportCustomViewSession(null);
      return;
    }
    const overlayName = activeBugreportCustomViewSession.overlay_preset_name;
    if (!overlayName) {
      return;
    }
    if (!bugreportPresets.some((preset) => preset.name === overlayName)) {
      setActiveBugreportCustomViewSession((prev) =>
        prev ? { ...prev, overlay_preset_name: null } : prev,
      );
    }
  }, [activeBugreportCustomViewSession, bugreportCustomViews, bugreportPresets]);

  useEffect(() => {
    if (!config) {
      return;
    }
    setConfig((prev) =>
      prev ? withDeviceGroups(prev, groupMap) : prev,
    );
  }, [groupMap]);

  useEffect(() => {
    setLogcatMatchIndex(0);
  }, [logcatSearchTerm, logcatSearchRegex, logcatSearchCaseSensitive, logcatSearchOnly]);


  useEffect(() => {
    if (logcatFiltered.matchIds.length === 0) {
      setLogcatMatchIndex(0);
      return;
    }
    if (logcatMatchIndex >= logcatFiltered.matchIds.length) {
      setLogcatMatchIndex(logcatFiltered.matchIds.length - 1);
    }
  }, [logcatFiltered.matchIds.length, logcatMatchIndex]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const flushLogcatPending = () => {
      logcatFlushTimerRef.current = null;
      const pending = logcatPendingRef.current;
      const serials = Object.keys(pending);
      if (!serials.length) {
        return;
      }
      logcatPendingRef.current = {};
      const appendedEntriesBySerial: Record<string, LogcatLineEntry[]> = {};
      serials.forEach((serial) => {
        const appended = pending[serial] ?? [];
        let nextId = logcatNextIdRef.current[serial] ?? 0;
        const appendedEntries: LogcatLineEntry[] = appended.map((text) => {
          nextId += 1;
          return { id: nextId, text };
        });
        logcatNextIdRef.current[serial] = nextId;
        appendedEntriesBySerial[serial] = appendedEntries;
      });

      setLogcatLines((prev) => {
        const next: Record<string, LogcatLineEntry[]> = { ...prev };
        serials.forEach((serial) => {
          const existing = next[serial] ?? [];
          const appendedEntries = appendedEntriesBySerial[serial] ?? [];
          next[serial] = [...existing, ...appendedEntries].slice(-LOGCAT_RAW_BUFFER_LIMIT);
        });
        return next;
      });

      const baseFilterSnapshot = logcatBaseFilterRef.current;
      if (!baseFilterSnapshot.active) {
        return;
      }

      setLogcatRetainedBySerial((prev) => {
        let next = prev;
        serials.forEach((serial) => {
          const appendedEntries = appendedEntriesBySerial[serial] ?? [];
          if (!appendedEntries.length) {
            return;
          }
          const matchedEntries = filterLogcatEntriesByBaseFilters(
            appendedEntries,
            baseFilterSnapshot.state,
          );
          if (!matchedEntries.length) {
            return;
          }
          const existing = prev[serial] ?? [];
          const retained = appendRetainedLogcatEntries(
            existing,
            matchedEntries,
            LOGCAT_RETAINED_LIMIT,
          );
          if (retained === existing) {
            return;
          }
          if (next === prev) {
            next = { ...prev };
          }
          next[serial] = retained;
        });
        return next;
      });
    };

    const scheduleLogcatFlush = () => {
      if (logcatFlushTimerRef.current != null) {
        return;
      }
      logcatFlushTimerRef.current = window.setTimeout(flushLogcatPending, 120);
    };

    const flushPerfPending = () => {
      perfFlushTimerRef.current = null;
      const pending = perfPendingRef.current;
      if (!pending.length) {
        return;
      }
      perfPendingRef.current = [];
      setPerfBySerial((prev) => {
        const next = { ...prev };
        for (const payload of pending) {
          const existing =
            next[payload.serial] ??
            ({ running: false, traceId: null, samples: [], lastError: null } satisfies PerfMonitorState);
          const nextSamples = payload.snapshot
            ? [...existing.samples, payload.snapshot].slice(-60)
            : existing.samples;
          next[payload.serial] = {
            ...existing,
            traceId: payload.trace_id || existing.traceId,
            samples: nextSamples,
            lastError: payload.error ?? (payload.snapshot ? null : existing.lastError),
          };
        }
        return next;
      });
    };

    const schedulePerfFlush = () => {
      if (perfFlushTimerRef.current != null) {
        return;
      }
      perfFlushTimerRef.current = window.setTimeout(flushPerfPending, 250);
    };

    const flushNetPending = () => {
      netFlushTimerRef.current = null;
      const pending = netPendingRef.current;
      if (!pending.length) {
        return;
      }
      netPendingRef.current = [];
      setNetBySerial((prev) => {
        const next = { ...prev };
        for (const payload of pending) {
          const unsupported = payload.snapshot?.unsupported === true;
          const existing =
            next[payload.serial] ??
            ({ running: false, traceId: null, samples: [], lastError: null } satisfies NetProfilerState);
          const nextSamples = unsupported
            ? []
            : payload.snapshot
              ? [...existing.samples, payload.snapshot].slice(-NET_PROFILER_MAX_SAMPLES)
              : existing.samples;
          next[payload.serial] = {
            ...existing,
            running: unsupported ? false : existing.running,
            traceId: payload.trace_id || existing.traceId,
            samples: nextSamples,
            lastError: payload.error ?? (payload.snapshot ? null : existing.lastError),
          };
        }
        return next;
      });
    };

    const scheduleNetFlush = () => {
      if (netFlushTimerRef.current != null) {
        return;
      }
      netFlushTimerRef.current = window.setTimeout(flushNetPending, 250);
    };

    const unlistenLogcat = listen<LogcatEvent>("logcat-line", (event) => {
      const payload = event.payload;
      const lines = payload.lines?.length
        ? payload.lines
        : payload.line
          ? [payload.line]
          : [];
      if (!lines.length) {
        return;
      }
      const bucket = (logcatPendingRef.current[payload.serial] ??= []);
      bucket.push(...lines);
      scheduleLogcatFlush();
    });

    const unlistenPerf = listen<PerfEvent>("perf-snapshot", (event) => {
      const payload = event.payload;
      // Error toasts stay immediate (and deduped against the last committed state); only the
      // sample accumulation is batched. The poll cadence (>=500ms) exceeds the 250ms flush
      // window, so the ref stays current for dedup.
      if (payload.error) {
        const prevError = perfBySerialRef.current[payload.serial]?.lastError ?? null;
        if (payload.error !== prevError) {
          pushToast(payload.error, "error");
        }
      }

      perfPendingRef.current.push(payload);
      schedulePerfFlush();
    });

    const unlistenNetProfiler = listen<NetProfilerEvent>("net-profiler-snapshot", (event) => {
      const payload = event.payload;
      const unsupported = payload.snapshot?.unsupported === true;
      if (payload.error) {
        const prevError = netBySerialRef.current[payload.serial]?.lastError ?? null;
        if (payload.error !== prevError) {
          pushToast(payload.error, "error");
        }
      }

      if (unsupported) {
        const running = netBySerialRef.current[payload.serial]?.running ?? false;
        if (running) {
          void stopNetProfiler(payload.serial)
            .then(() => {
              setNetBySerial((prev) => {
                const existing = prev[payload.serial];
                if (!existing) {
                  return prev;
                }
                return {
                  ...prev,
                  [payload.serial]: {
                    ...existing,
                    running: false,
                  },
                };
              });
            })
            .catch((error) => pushToast(formatError(error), "error"));
        }
      }

      netPendingRef.current.push(payload);
      scheduleNetFlush();
    });

    const flushTerminalPending = () => {
      terminalFlushTimerRef.current = null;
      const pending = terminalPendingRef.current;
      const serials = Object.keys(pending);
      if (!serials.length) {
        return;
      }
      terminalPendingRef.current = {};
      setTerminalBySerial((prev) => {
        const next: Record<string, TerminalDeviceState> = { ...prev };
        serials.forEach((serial) => {
          const chunk = pending[serial] ?? "";
          if (!chunk) {
            return;
          }
          const existing =
            next[serial] ??
            ({
              connected: true,
              sessionId: terminalSessionIdBySerialRef.current[serial] ?? null,
              lines: [],
              tail: "",
              autoScroll: true,
            } satisfies TerminalDeviceState);
          const updated = appendTerminalBuffer(
            existing.lines,
            existing.tail,
            chunk,
            TERMINAL_MAX_LINES,
          );
          next[serial] = {
            ...existing,
            lines: updated.lines,
            tail: updated.tail,
          };
        });
        return next;
      });
    };

    const scheduleTerminalFlush = () => {
      if (terminalFlushTimerRef.current != null) {
        return;
      }
      terminalFlushTimerRef.current = window.setTimeout(flushTerminalPending, 120);
    };

    const unlistenTerminal = listen<TerminalEvent>("terminal-event", (event) => {
      const payload = event.payload;
      const currentSession = terminalSessionIdBySerialRef.current[payload.serial];
      if (!currentSession || currentSession !== payload.session_id) {
        return;
      }

      if (payload.event === "output") {
        const chunk = payload.chunk ?? "";
        if (!chunk) {
          return;
        }
        terminalPendingRef.current[payload.serial] =
          (terminalPendingRef.current[payload.serial] ?? "") + chunk;
        scheduleTerminalFlush();
        return;
      }

      if (payload.event === "exit" || payload.event === "stopped") {
        terminalSessionIdBySerialRef.current[payload.serial] = null;
        setTerminalBySerial((prev) => {
          const existing =
            prev[payload.serial] ??
            ({
              connected: false,
              sessionId: null,
              lines: [],
              tail: "",
              autoScroll: true,
            } satisfies TerminalDeviceState);
          const suffix =
            payload.event === "exit"
              ? `\n[process exited${payload.exit_code != null ? ` ${payload.exit_code}` : ""}]\n`
              : "\n[session stopped]\n";
          const updated = appendTerminalBuffer(
            existing.lines,
            existing.tail,
            suffix,
            TERMINAL_MAX_LINES,
          );
          return {
            ...prev,
            [payload.serial]: {
              ...existing,
              connected: false,
              sessionId: null,
              lines: updated.lines,
              tail: updated.tail,
            },
          };
        });
      }
    });
    const unlistenFileTransferProgress = listen<FileTransferProgress>("file-transfer-progress", (event) => {
      const payload = event.payload;
      const taskId = fileTransferTaskByTraceIdRef.current[payload.trace_id];
      if (!taskId) {
        return;
      }
      const progress = payload.progress ?? null;
      const patch = {
        progress,
        ...(progress != null && progress < 100 ? { message: payload.message ?? null } : {}),
      };
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial: payload.serial,
        patch,
      });
    });
    const unlistenApkInstallEvent = listen<ApkInstallEvent>("apk-install-event", (event) => {
      const payload = event.payload;
      const taskId = apkInstallTaskByTraceIdRef.current[payload.trace_id];
      if (!taskId) {
        return;
      }
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: payload.trace_id });

      const serial = payload.serial;
      if (!serial) {
        return;
      }

      const patch = resolveApkInstallEventPatch(payload);
      if (patch) {
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial,
          patch,
        });
      }
    });
    const unlistenBugreportProgress = listen<BugreportProgress>("bugreport-progress", (event) => {
      const payload = event.payload;
      const taskId = findRunningBugreportTaskIdForSerial(taskStateRef.current.items, payload.serial);
      if (taskId) {
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: payload.trace_id });
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial: payload.serial,
          patch: {
            status: "running",
            progress: payload.progress,
            message: "Generating bugreport…",
          },
        });
      }
    });
    const unlistenBugreportComplete = listen("bugreport-complete", (event) => {
      const payload = event.payload as { trace_id?: string; result?: BugreportResult };
      if (payload?.result) {
        setBugreportResult(payload.result);
      }
      const serial = payload?.result?.serial;
      if (!serial) {
        return;
      }
      const taskId = findRunningBugreportTaskIdForSerial(taskStateRef.current.items, serial);
      if (!taskId || !payload.result) {
        return;
      }

      if (payload.trace_id) {
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: payload.trace_id });
      }
      const errorText = payload.result.error?.trim() ?? "";
      const cancelled = errorText.toLowerCase().includes("cancel");
      const status: TaskStatus = payload.result.success ? "success" : cancelled ? "cancelled" : "error";
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: {
          status,
          progress: payload.result.progress ?? null,
          output_path: payload.result.output_path ?? null,
          message: payload.result.success
            ? "Bugreport completed."
            : cancelled
              ? "Bugreport cancelled."
              : payload.result.error ?? "Bugreport failed.",
        },
      });
      dispatchTasks({ type: "TASK_RECOMPUTE_STATUS", id: taskId });
    });

    return () => {
      void unlistenLogcat.then((unlisten) => unlisten());
      if (logcatFlushTimerRef.current != null) {
        window.clearTimeout(logcatFlushTimerRef.current);
        logcatFlushTimerRef.current = null;
      }
      logcatPendingRef.current = {};
      void unlistenPerf.then((unlisten) => unlisten());
      if (perfFlushTimerRef.current != null) {
        window.clearTimeout(perfFlushTimerRef.current);
        perfFlushTimerRef.current = null;
      }
      perfPendingRef.current = [];
      void unlistenNetProfiler.then((unlisten) => unlisten());
      if (netFlushTimerRef.current != null) {
        window.clearTimeout(netFlushTimerRef.current);
        netFlushTimerRef.current = null;
      }
      netPendingRef.current = [];
      void unlistenTerminal.then((unlisten) => unlisten());
      if (terminalFlushTimerRef.current != null) {
        window.clearTimeout(terminalFlushTimerRef.current);
        terminalFlushTimerRef.current = null;
      }
      terminalPendingRef.current = {};
      void unlistenFileTransferProgress.then((unlisten) => unlisten());
      void unlistenApkInstallEvent.then((unlisten) => unlisten());
      void unlistenBugreportProgress.then((unlisten) => unlisten());
      void unlistenBugreportComplete.then((unlisten) => unlisten());
    };
  }, [activeSerial]);

  useEffect(() => {
    if (!selectedSerials.length) {
      return;
    }
    setTerminalBySerial((prev) => {
      let next = prev;
      for (const serial of selectedSerials) {
        if (next[serial]) {
          continue;
        }
        if (next === prev) {
          next = { ...prev };
        }
        next[serial] = {
          connected: false,
          sessionId: null,
          lines: [],
          tail: "",
          autoScroll: true,
        };
      }
      return next;
    });
  }, [selectedSerials]);

  const groupOptions = useMemo(
    () => Array.from(new Set(Object.values(groupMap))).filter(Boolean).sort(),
    [groupMap],
  );
  const groupPanelGroups = useMemo(
    () => buildDeviceGroupOptions(groupMap, groupFilter),
    [groupFilter, groupMap],
  );
  const selectedDevices = useMemo(
    () =>
      selectedSerials
        .map((serial) => devices.find((device) => device.summary.serial === serial) ?? null)
        .filter((device): device is DeviceInfo => Boolean(device)),
    [devices, selectedSerials],
  );

  useEffect(() => {
    if (groupFilter !== "all" && !groupOptions.includes(groupFilter)) {
      setGroupFilter("all");
    }
  }, [groupFilter, groupOptions]);

  const selectedSerialSet = useMemo(() => new Set(selectedSerials), [selectedSerials]);

  const visibleDevices = useMemo(() => {
    const bySearch = filterDevicesBySearch(devices, searchText);
    const byGroup =
      groupFilter === "all"
        ? bySearch
        : bySearch.filter((device) => groupMap[device.summary.serial] === groupFilter);
    if (deviceQuickFilters.length === 0) {
      return byGroup;
    }
    return byGroup.filter((device) =>
      matchesDeviceQuickFilters(device, deviceQuickFilters, {
        selectedSerialSet,
        screenRecordStatusBySerial,
      }),
    );
  }, [
    devices,
    deviceQuickFilters,
    groupFilter,
    groupMap,
    screenRecordStatusBySerial,
    searchText,
    selectedSerialSet,
  ]);

  const connectedDevicesCount = useMemo(
    () => devices.filter((device) => device.summary.state === "device").length,
    [devices],
  );

  const hasDeviceFilters =
    searchText.trim().length > 0 || groupFilter !== "all" || deviceQuickFilters.length > 0;

  const clearDeviceFilters = () => {
    setSearchText("");
    setGroupFilter("all");
    setDeviceQuickFilters([]);
  };

  const applyDeviceGroupFilter = (group: string) => {
    setGroupFilter(group);
  };

  const clearDeviceGroupFilter = () => {
    setGroupFilter("all");
  };

  const toggleDevice = (serial: string) => {
    setSelectedSerials((prev) => {
      if (!prev.includes(serial)) {
        return [...prev, serial];
      }
      if (prev.length === 1) {
        return prev;
      }
      return prev.filter((item) => item !== serial);
    });
  };

  const toggleDeviceInContextPopover = (serial: string) => {
    if (deviceSelectionMode === "multi") {
      toggleDevice(serial);
      return;
    }
    setSelectedSerials((prev) => (prev.length === 1 && prev[0] === serial ? prev : [serial]));
  };

  const isContextMenuShortcut = (event: ReactKeyboardEvent<HTMLElement>) =>
    event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");

  const openDeviceQuickContextMenu = (
    serial: string,
    options?: {
      source?: DeviceQuickMenuSource;
      outputPath?: string | null;
      rowIndex?: number | null;
      triggerElement?: HTMLElement | null;
      anchorX?: number;
      anchorY?: number;
      showSelectionHint?: boolean;
      visibleActionIds?: DeviceContextActionId[] | null;
    },
  ) => {
    const triggerElement = options?.triggerElement ?? null;
    const rect = triggerElement?.getBoundingClientRect();
    const anchorX = options?.anchorX ?? (rect ? rect.right - 12 : 24);
    const anchorY = options?.anchorY ?? (rect ? rect.top + Math.min(rect.height, 20) : 24);
    const source = options?.source ?? "device_manager";
    const resolvedSelection = resolveDeviceQuickMenuSelection({
      source,
      clickedSerial: serial,
      selectedSerials,
    });

    deviceContextMenuTriggerRef.current = triggerElement;

    if (options?.showSelectionHint && !deviceQuickSelectionHintShownRef.current) {
      deviceQuickSelectionHintShownRef.current = true;
      pushToast("Right-click uses the clicked device or the current selection for quick actions.", "info");
    }

    setSelectedSerials(resolvedSelection.selectedSerials);
    if (typeof options?.rowIndex === "number") {
      lastSelectedIndexRef.current = options.rowIndex;
    } else {
      lastSelectedIndexRef.current = null;
    }
    setDeviceContextMenu({
      x: anchorX,
      y: anchorY,
      serial,
      source,
      outputPath: options?.outputPath ?? null,
      visibleActionIds: options?.visibleActionIds ?? null,
    });
  };

  const openSelectedDeviceActionMenu = (
    event: ReactMouseEvent<HTMLElement>,
    visibleActionIds: DeviceContextActionId[],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const primarySerial = selectedSerials[0];
    if (!primarySerial) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    deviceContextMenuTriggerRef.current = event.currentTarget;
    setDeviceContextMenu({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 6,
      serial: primarySerial,
      source: "device_manager",
      outputPath: null,
      visibleActionIds,
    });
  };

  const openDeviceQuickContextMenuFromPointer = (
    event: ReactMouseEvent<HTMLElement>,
    serial: string,
    options?: {
      source?: DeviceQuickMenuSource;
      outputPath?: string | null;
      rowIndex?: number | null;
      showSelectionHint?: boolean;
      visibleActionIds?: DeviceContextActionId[] | null;
    },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    openDeviceQuickContextMenu(serial, {
      ...options,
      triggerElement: event.currentTarget,
      anchorX: event.clientX,
      anchorY: event.clientY,
    });
  };

  const openDeviceQuickContextMenuFromKeyboard = (
    event: ReactKeyboardEvent<HTMLElement>,
    serial: string,
    options?: {
      source?: DeviceQuickMenuSource;
      outputPath?: string | null;
      rowIndex?: number | null;
      visibleActionIds?: DeviceContextActionId[] | null;
    },
  ) => {
    if (!isContextMenuShortcut(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openDeviceQuickContextMenu(serial, {
      ...options,
      triggerElement: event.currentTarget,
    });
  };

  const handleDeviceRowSelect = (
    event: React.MouseEvent<HTMLElement>,
    serial: string,
    index: number,
  ) => {
    event.preventDefault();
    const isMeta = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;

    if (deviceSelectionMode === "multi") {
      if (isShift && lastSelectedIndexRef.current != null) {
        const start = Math.min(lastSelectedIndexRef.current, index);
        const end = Math.max(lastSelectedIndexRef.current, index);
        const rangeSerials = visibleDevices.slice(start, end + 1).map((device) => device.summary.serial);
        setSelectedSerials((prev) => Array.from(new Set([...prev, ...rangeSerials])));
      } else if (isMeta) {
        toggleDevice(serial);
        lastSelectedIndexRef.current = index;
        return;
      } else {
        // Default click toggles selection without reordering.
        // Double click will handle setting primary.
        if (event.detail > 1) {
          return;
        }

        setSelectedSerials((prev) => {
          if (prev.includes(serial)) {
            if (prev.length === 1) {
              return prev;
            }
            return prev.filter((item) => item !== serial);
          }
          // Add to end (don't change current primary)
          return [...prev, serial];
        });
      }

      lastSelectedIndexRef.current = index;
      return;
    }

    if (isMeta) {
      setSelectedSerials((prev) => (prev.length === 1 && prev[0] === serial ? prev : [serial]));
      lastSelectedIndexRef.current = index;
      return;
    }

    setSelectedSerials((prev) => {
      if (prev.length === 1 && prev[0] === serial) {
        return prev;
      }
      return [serial];
    });

    lastSelectedIndexRef.current = index;
  };

  const selectAllVisible = () => {
    if (deviceSelectionMode === "single") {
      setSelectedSerials(visibleDevices.length ? [visibleDevices[0].summary.serial] : []);
      return;
    }
    setSelectedSerials(visibleDevices.map((device) => device.summary.serial));
  };

  const selectAllDevicesInPopover = () => {
    const filtered = filterDevicesBySearch(devices, devicePopoverSearch);
    const filteredSerials = filtered.map((device) => device.summary.serial);
    if (deviceSelectionMode === "single") {
      setSelectedSerials(filteredSerials.length ? [filteredSerials[0]] : []);
      return;
    }
    setSelectedSerials((prev) => {
      const existing = new Set(prev);
      const toAdd = filteredSerials.filter((serial) => !existing.has(serial));
      return [...prev, ...toAdd];
    });
  };

  const clearSelection = () => {
    setSelectedSerials((prev) => reduceSelectionToOne(prev, devices));
    lastSelectedIndexRef.current = null;
  };

  const persistGroupMap = async (
    nextGroupMap: Record<string, string>,
    successMessage: string,
  ) => {
    if (!config) {
      pushToast("Settings are still loading. Try again in a moment.", "error");
      return;
    }

    setBusy(true);
    try {
      const updated = buildConfigForSave(config, { groupMap: nextGroupMap });
      const response = await saveConfig(updated);
      setConfig(response.data);
      setGroupMap(flattenDeviceGroups(response.data.device_groups));
      pushToast(successMessage, "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleAssignGroupWithName = async (nextGroupName: string) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device to assign group.", "error");
      return;
    }
    const trimmed = nextGroupName.trim();
    setGroupName(trimmed);
    const nextGroupMap = applyGroupAssignment(groupMap, selectedSerials, trimmed);
    await persistGroupMap(
      nextGroupMap,
      trimmed ? `Assigned ${trimmed}.` : "Cleared group assignment.",
    );
  };

  const handleAssignGroup = async () => {
    await handleAssignGroupWithName(groupName);
  };

  const handleClearGroupAssignment = async () => {
    await handleAssignGroupWithName("");
  };

  const createDefaultTerminalState = (): TerminalDeviceState => ({
    connected: false,
    sessionId: null,
    lines: [],
    tail: "",
    autoScroll: true,
  });

  const flushPersistTerminalState = async () => {
    if (terminalPersistInFlightRef.current) {
      terminalPersistTimerRef.current = window.setTimeout(() => {
        void flushPersistTerminalState();
      }, 800);
      return;
    }

    terminalPersistInFlightRef.current = true;
    try {
      const restoreSessions = terminalActiveSerialsRef.current;
      const bySerial = terminalBySerialRef.current;
      const buffers: Record<string, string[]> = {};
      restoreSessions.forEach((serial) => {
        const state = bySerial[serial];
        const lines = state?.lines ?? [];
        buffers[serial] = state?.tail ? [...lines, state.tail] : [...lines];
      });

      await persistTerminalState(restoreSessions, buffers);
      setConfig((prev) =>
        prev
          ? { ...prev, terminal: { restore_sessions: restoreSessions, buffers } }
          : prev,
      );
    } catch (error) {
      console.warn("Failed to persist terminal state.", error);
    } finally {
      terminalPersistInFlightRef.current = false;
    }
  };

  const schedulePersistTerminalState = () => {
    if (terminalPersistTimerRef.current != null) {
      return;
    }
    terminalPersistTimerRef.current = window.setTimeout(() => {
      terminalPersistTimerRef.current = null;
      void flushPersistTerminalState();
    }, 1500);
  };

  const connectTerminalInternal = async (serial: string) => {
    const response = await startTerminalSession(serial);
    terminalSessionIdBySerialRef.current[serial] = response.data.session_id;
    setTerminalActiveSerials((prev) => (prev.includes(serial) ? prev : [...prev, serial]));
    setTerminalBySerial((prev) => {
      const existing = prev[serial] ?? createDefaultTerminalState();
      return {
        ...prev,
        [serial]: {
          ...existing,
          connected: true,
          sessionId: response.data.session_id,
        },
      };
    });
    return response.data.session_id;
  };

  const disconnectTerminalInternal = async (serial: string) => {
    await stopTerminalSession(serial);
    terminalSessionIdBySerialRef.current[serial] = null;
    setTerminalBySerial((prev) => {
      const existing = prev[serial] ?? createDefaultTerminalState();
      return {
        ...prev,
        [serial]: {
          ...existing,
          connected: false,
          sessionId: null,
        },
      };
    });
  };

  const appendTerminal = (serial: string, chunk: string) => {
    setTerminalBySerial((prev) => {
      const existing = prev[serial] ?? createDefaultTerminalState();
      const updated = appendTerminalBuffer(
        existing.lines,
        existing.tail,
        chunk,
        TERMINAL_MAX_LINES,
      );
      return {
        ...prev,
        [serial]: {
          ...existing,
          lines: updated.lines,
          tail: updated.tail,
        },
      };
    });
  };

  const clearTerminal = (serial: string) => {
    setTerminalBySerial((prev) => {
      const existing = prev[serial] ?? createDefaultTerminalState();
      return {
        ...prev,
        [serial]: {
          ...existing,
          lines: [],
          tail: "",
        },
      };
    });
  };

  const setTerminalAutoScroll = (serial: string, enabled: boolean) => {
    setTerminalBySerial((prev) => {
      const existing = prev[serial] ?? createDefaultTerminalState();
      return {
        ...prev,
        [serial]: {
          ...existing,
          autoScroll: enabled,
        },
      };
    });
  };

  const handleConnectTerminal = async (serial: string) => {
    setBusy(true);
    try {
      await connectTerminalInternal(serial);
      appendTerminal(serial, "\n[connected]\n");
    } catch (error) {
      appendTerminal(serial, `\n[connect error] ${formatError(error)}\n`);
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnectTerminal = async (serial: string) => {
    setBusy(true);
    try {
      await disconnectTerminalInternal(serial);
      appendTerminal(serial, "\n[disconnected]\n");
    } catch (error) {
      appendTerminal(serial, `\n[disconnect error] ${formatError(error)}\n`);
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveTerminalSession = async (serial: string) => {
    setBusy(true);
    try {
      if (terminalBySerial[serial]?.connected) {
        await disconnectTerminalInternal(serial);
      }
      setTerminalActiveSerials((prev) => prev.filter((value) => value !== serial));
      clearTerminal(serial);
      pushToast("Terminal session removed.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleWriteTerminal = async (
    serial: string,
    data: string,
    newline: boolean,
  ) => {
    const trimmed = data;
    if (!trimmed && !newline) {
      return;
    }
    if (!(data === "\u0003" && !newline)) {
      appendTerminal(serial, `${newline ? "$ " : ""}${trimmed}${newline ? "\n" : ""}`);
    }
    try {
      await writeTerminalSession(serial, data, newline);
    } catch (error) {
      appendTerminal(serial, `[write error] ${formatError(error)}\n`);
      pushToast(formatError(error), "error");
    }
  };

  const handleInterruptTerminal = async (serial: string) => {
    appendTerminal(serial, "^C\n");
    await handleWriteTerminal(serial, "\u0003", false);
  };

  const handleConnectSelectedTerminals = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      for (const serial of selectedSerials) {
        setTerminalActiveSerials((prev) => (prev.includes(serial) ? prev : [...prev, serial]));
        const existing = terminalBySerial[serial];
        if (existing?.connected) {
          continue;
        }
        await connectTerminalInternal(serial);
        appendTerminal(serial, "\n[connected]\n");
      }
      pushToast("Terminal sessions connected.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnectSelectedTerminals = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      for (const serial of selectedSerials) {
        const existing = terminalBySerial[serial];
        if (!existing?.connected) {
          continue;
        }
        await disconnectTerminalInternal(serial);
        appendTerminal(serial, "\n[disconnected]\n");
      }
      pushToast("Terminal sessions disconnected.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleBroadcastSend = async () => {
    const command = terminalBroadcast.trimEnd();
    if (!command.trim()) {
      pushToast("Please enter a command to broadcast.", "error");
      return;
    }
    const targets = terminalActiveSerials.filter((serial) => terminalBySerial[serial]?.connected);
    if (!targets.length) {
      pushToast("No connected terminal sessions.", "error");
      return;
    }
    setBusy(true);
    try {
      await Promise.all(targets.map((serial) => handleWriteTerminal(serial, command, true)));
      setTerminalBroadcast("");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAdbCommandLibrary = async (
    nextLibrary: AdbCommandLibrarySettings,
    message: string,
  ): Promise<boolean> => {
    if (!config) {
      pushToast("Settings are still loading.", "error");
      return false;
    }
    setBusy(true);
    try {
      const latest = await getConfig();
      const updated = {
        ...latest.data,
        adb_command_library: normalizeAdbCommandLibrarySettings(nextLibrary),
      };
      const response = await saveConfig(updated);
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              adb_command_library: response.data.adb_command_library,
            }
          : response.data,
      );
      pushToast(message, "info");
      return true;
    } catch (error) {
      pushToast(formatError(error), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const copyAdbCommandLibraryText = async (text: string, successMessage: string) => {
    try {
      await writeText(text);
      pushToast(successMessage, "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const handleRunAdbCommandLibraryEntry = async (
    entry: AdbCommandLibraryEntry,
    startedAt: string,
  ): Promise<AdbCommandRunResult | null> => {
    const targetSerials = adbCommandTargetSerials;
    if (!targetSerials.length) {
      pushToast("Select at least one online Android device.", "error");
      return null;
    }
    if (
      entry.risk === "dangerous" &&
      !window.confirm(`Run "${entry.title}" on ${targetSerials.length} selected device${targetSerials.length > 1 ? "s" : ""}?`)
    ) {
      return null;
    }

    const taskId = beginTask({
      kind: "shell",
      title: `ADB Command: ${entry.title}`,
      serials: targetSerials,
    });
    targetSerials.forEach((serial) => {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "running", message: "Running command..." },
      });
    });

    setBusy(true);
    try {
      const response = await runShell(
        targetSerials,
        quoteShellCommandForAdbSh(entry.command),
        true,
        { recordError: false },
      );
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });

      const runResult = buildAdbCommandRunResult({
        entry,
        targetSerials,
        commandResults: response.data,
        traceId: response.trace_id,
        startedAt,
        completedAt: new Date().toISOString(),
      });
      let successCount = 0;
      let failureCount = 0;
      runResult.devices.forEach((device) => {
        if (device.status === "success") {
          successCount += 1;
        } else {
          failureCount += 1;
        }
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial: device.serial,
          patch: {
            status: device.status === "success" ? "success" : "error",
            message: device.message,
            stdout: device.stdout,
            stderr: device.stderr,
            exit_code: device.exit_code,
          },
        });
      });
      dispatchTasks({ type: "TASK_RECOMPUTE_STATUS", id: taskId });

      if (failureCount === 0) {
        pushToast(
          `Ran ${entry.title} on ${successCount} device${successCount > 1 ? "s" : ""}.`,
          "info",
        );
      } else if (successCount > 0) {
        pushToast(
          `Ran ${entry.title} on ${successCount} device${successCount > 1 ? "s" : ""}; ${failureCount} failed.`,
          "error",
        );
      } else {
        pushToast(`Failed to run ${entry.title}.`, "error");
      }
      return runResult;
    } catch (error) {
      const message = formatError(error);
      const runResult = buildAdbCommandRunErrorResult({
        entry,
        targetSerials,
        message,
        startedAt,
        completedAt: new Date().toISOString(),
      });
      runResult.devices.forEach((device) => {
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial: device.serial,
          patch: { status: "error", message: device.message },
        });
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(message, "error");
      return runResult;
    } finally {
      setBusy(false);
    }
  };

  const handleReboot = async (mode?: string) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    const targetSerials = rebootActionMeta.eligibleSerials;
    const skippedCount = rebootActionMeta.skippedSerials.length;
    if (!targetSerials.length) {
      pushToast("No eligible devices selected.", "error");
      return;
    }
    const operationId = crypto.randomUUID();
    const timeoutSec = clampRetentionTimeoutSec(configRef.current?.device.device_reboot_retention_timeout_sec, 90);
    setRetentionMap((prev) => markDevicesForReboot(prev, devicesRef.current, targetSerials, mode, timeoutSec));
    setDeviceQuickActionStatuses(targetSerials, "reboot", "pending", operationId);
    setBusy(true);
    try {
      await rebootDevices(targetSerials, mode);
      finishDeviceQuickActionOperation({
        operationId,
        kind: "reboot",
        successSerials: targetSerials,
        errorSerials: [],
      });
      pushToast(
        `Reboot command sent.${skippedCount > 0 ? ` Skipped ${skippedCount} unavailable device(s).` : ""}`,
        "info",
      );
    } catch (error) {
      finishDeviceQuickActionOperation({
        operationId,
        kind: "reboot",
        successSerials: [],
        errorSerials: targetSerials,
      });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleWifi = async (enableOrMeta: boolean | BatchActionMeta = wifiActionMeta) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    const actionMeta =
      typeof enableOrMeta === "boolean"
        ? {
            targetActive: enableOrMeta,
            eligibleSerials: selectedSerials.filter((serial) => batchAvailabilityBySerial[serial] !== false),
            skippedSerials: selectedSerials.filter((serial) => batchAvailabilityBySerial[serial] === false),
          }
        : enableOrMeta;
    const enable = actionMeta.targetActive === true;
    const targetSerials = actionMeta.eligibleSerials;
    const skippedCount = actionMeta.skippedSerials.length;
    if (!targetSerials.length) {
      pushToast("No eligible devices selected.", "error");
      return;
    }
    const operationId = crypto.randomUUID();
    const actionKind: DeviceQuickActionKind = enable ? "wifi_on" : "wifi_off";
    setDeviceQuickActionStatuses(targetSerials, actionKind, "pending", operationId);
    setBusy(true);
    try {
      const response = await setWifiState(targetSerials, enable);
      const successes = response.data.filter((item) => item.exit_code === 0).map((item) => item.serial);
      const failures = response.data.filter((item) => item.exit_code !== 0);
      const reportedSerials = new Set(response.data.map((item) => item.serial));
      const failureSerials = [
        ...failures.map((item) => item.serial),
        ...targetSerials.filter((serial) => !reportedSerials.has(serial)),
      ];
      finishDeviceQuickActionOperation({
        operationId,
        kind: actionKind,
        successSerials: successes,
        errorSerials: failureSerials,
      });
      if (successes.length) {
        setDevices((prev) => applyDeviceDetailPatch(prev, successes, { wifi_is_on: enable }));
        scheduleDeviceDetailRefresh(800, { notifyOnError: false });
      }
      if (failures.length) {
        pushToast(
          `WiFi ${enable ? "enable" : "disable"} failed for ${failures.length} device(s).${
            skippedCount > 0 ? ` Skipped ${skippedCount} unavailable device(s).` : ""
          }`,
          "error",
        );
      } else {
        pushToast(
          `${enable ? "WiFi enabled." : "WiFi disabled."}${
            skippedCount > 0 ? ` Skipped ${skippedCount} unavailable device(s).` : ""
          }`,
          "info",
        );
      }
    } catch (error) {
      finishDeviceQuickActionOperation({
        operationId,
        kind: actionKind,
        successSerials: [],
        errorSerials: targetSerials,
      });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBluetooth = async (enableOrMeta: boolean | BatchActionMeta = bluetoothActionMeta) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    const actionMeta =
      typeof enableOrMeta === "boolean"
        ? {
            targetActive: enableOrMeta,
            eligibleSerials: selectedSerials.filter((serial) => batchAvailabilityBySerial[serial] !== false),
            skippedSerials: selectedSerials.filter((serial) => batchAvailabilityBySerial[serial] === false),
          }
        : enableOrMeta;
    const enable = actionMeta.targetActive === true;
    const targetSerials = actionMeta.eligibleSerials;
    const skippedCount = actionMeta.skippedSerials.length;
    if (!targetSerials.length) {
      pushToast("No eligible devices selected.", "error");
      return;
    }
    const operationId = crypto.randomUUID();
    const actionKind: DeviceQuickActionKind = enable ? "bluetooth_on" : "bluetooth_off";
    setDeviceQuickActionStatuses(targetSerials, actionKind, "pending", operationId);
    setBusy(true);
    try {
      const response = await setBluetoothState(targetSerials, enable);
      const successes = response.data.filter((item) => item.exit_code === 0).map((item) => item.serial);
      const failures = response.data.filter((item) => item.exit_code !== 0);
      const reportedSerials = new Set(response.data.map((item) => item.serial));
      const failureSerials = [
        ...failures.map((item) => item.serial),
        ...targetSerials.filter((serial) => !reportedSerials.has(serial)),
      ];
      finishDeviceQuickActionOperation({
        operationId,
        kind: actionKind,
        successSerials: successes,
        errorSerials: failureSerials,
      });
      if (successes.length) {
        setDevices((prev) => applyDeviceDetailPatch(prev, successes, { bt_is_on: enable }));
        scheduleDeviceDetailRefresh(800, { notifyOnError: false });
      }
      if (failures.length) {
        pushToast(
          `Bluetooth ${enable ? "enable" : "disable"} failed for ${failures.length} device(s).${
            skippedCount > 0 ? ` Skipped ${skippedCount} unavailable device(s).` : ""
          }`,
          "error",
        );
      } else {
        pushToast(
          `${enable ? "Bluetooth enabled." : "Bluetooth disabled."}${
            skippedCount > 0 ? ` Skipped ${skippedCount} unavailable device(s).` : ""
          }`,
          "info",
        );
      }
    } catch (error) {
      finishDeviceQuickActionOperation({
        operationId,
        kind: actionKind,
        successSerials: [],
        errorSerials: targetSerials,
      });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const setBluetoothMonitorDesired = useCallback(
    async (
      serial: string,
      enable: boolean,
      options: { announce?: boolean } = {},
    ): Promise<{ ok: boolean; running: boolean; message?: string }> => {
      const announce = options.announce ?? true;
      setBluetoothMonitorBusy(true);
      try {
        if (enable) {
          await startBluetoothMonitor(serial);
        } else {
          await stopBluetoothMonitor(serial);
        }
        setBluetoothMonitorRunningBySerial((prev) => ({ ...prev, [serial]: enable }));
        bluetoothMonitorRunningBySerialRef.current = {
          ...bluetoothMonitorRunningBySerialRef.current,
          [serial]: enable,
        };
        if (announce) {
          pushToast(enable ? "Bluetooth monitor started." : "Bluetooth monitor stopped.", "info");
        }
        return { ok: true, running: enable };
      } catch (error) {
        const message = formatError(error);
        const lower = message.toLowerCase();
        if (enable && lower.includes("already running")) {
          setBluetoothMonitorRunningBySerial((prev) => ({ ...prev, [serial]: true }));
          bluetoothMonitorRunningBySerialRef.current = {
            ...bluetoothMonitorRunningBySerialRef.current,
            [serial]: true,
          };
          if (announce) {
            pushToast("Bluetooth monitor is already running.", "info");
          }
          return { ok: true, running: true, message };
        }
        if (!enable && lower.includes("not running")) {
          setBluetoothMonitorRunningBySerial((prev) => ({ ...prev, [serial]: false }));
          bluetoothMonitorRunningBySerialRef.current = {
            ...bluetoothMonitorRunningBySerialRef.current,
            [serial]: false,
          };
          if (announce) {
            pushToast("Bluetooth monitor is already stopped.", "info");
          }
          return { ok: true, running: false, message };
        }
        if (announce) {
          pushToast(message, "error");
        }
        return { ok: false, running: !enable, message };
      } finally {
        setBluetoothMonitorBusy(false);
      }
    },
    [],
  );

  const enableBluetoothForSerial = async (
    serial: string,
  ): Promise<{ ok: boolean; message?: string }> => {
    setBluetoothToggleBusy(true);
    try {
      const response = await setBluetoothState([serial], true);
      const result = response.data[0];
      if (result?.exit_code === 0) {
        setDevices((prev) => applyDeviceDetailPatch(prev, [serial], { bt_is_on: true }));
        scheduleDeviceDetailRefresh(800, { notifyOnError: false });
        pushToast("Bluetooth enabled.", "info");
        return { ok: true };
      }
      const message = result?.stderr?.trim() || result?.stdout?.trim() || "Bluetooth enable failed.";
      pushToast(message, "error");
      return { ok: false, message };
    } catch (error) {
      const message = formatError(error);
      pushToast(message, "error");
      return { ok: false, message };
    } finally {
      setBluetoothToggleBusy(false);
    }
  };

  const runDeveloperOptionsReadShell = useCallback(
    async (serial: string, command: string) =>
      runShell([serial], quoteShellCommandForAdbSh(command), false),
    [],
  );

  type DeveloperOptionSerialReadResult = {
    serial: string;
    snapshot: DeveloperOptionSnapshot;
    supportedByKey: Record<DeveloperOptionKey, boolean>;
    messageByKey: Record<DeveloperOptionKey, string | null>;
    status: DeveloperOptionDeviceReadStatus;
    errorMessage: string | null;
    lastReadAt: number;
  };

  type DeveloperOptionReadOptions = {
    includeLogBuffer?: boolean;
  };

  type DeveloperOptionLogBufferReadResult = {
    serial: string;
    supported: boolean;
    value: DeveloperOptionValue;
    message: string | null;
  };

  const readDeveloperOptionsForSerial = useCallback(
    async (
      serial: string,
      options: DeveloperOptionReadOptions = {},
    ): Promise<DeveloperOptionSerialReadResult> => {
      const includeLogBuffer = options.includeLogBuffer ?? true;
      const nextSnapshot = createDeveloperOptionSnapshot();
      const nextSupported = createDeveloperOptionSupportMap(false);
      const nextMessages = createDeveloperOptionMessageMap();
      const settingsByNamespace: Record<"global" | "system", Record<string, string>> = {
        global: {},
        system: {},
      };
      const settingsKeysByNamespace = getDeveloperOptionSettingsKeysByNamespace();

      const fillAllWithFailure = (message: string) => {
        DEVELOPER_OPTIONS.forEach((option) => {
          nextSupported[option.key] = false;
          nextSnapshot[option.key] = null;
          nextMessages[option.key] = message;
        });
      };

      let fatalReadInfo:
        | {
            message: string;
            timedOut: boolean;
            unauthorized: boolean;
            offline: boolean;
          }
        | null = null;

      for (const namespace of ["global", "system"] as const) {
        let namespaceMap: Record<string, string> | null = null;
        let listFailure: ReturnType<typeof normalizeDeveloperOptionReadFailure> | null = null;

        try {
          const response = await runDeveloperOptionsReadShell(serial, `settings list ${namespace}`);
          const result = response.data[0];
          if (!result) {
            fatalReadInfo = normalizeDeveloperOptionReadFailure("No command output returned.");
            break;
          }

          if ((result.exit_code ?? 0) !== 0) {
            const normalizedFailure = normalizeDeveloperOptionReadFailure(
              result.stderr.trim() || result.stdout.trim() || "Read command failed on this device.",
            );
            if (normalizedFailure.timedOut || normalizedFailure.unauthorized || normalizedFailure.offline) {
              fatalReadInfo = normalizedFailure;
              break;
            }
            listFailure = normalizedFailure;
          } else {
            namespaceMap = parseSettingsListOutput(result.stdout);
          }
        } catch (error) {
          const normalizedFailure = normalizeDeveloperOptionReadFailure(formatError(error));
          if (normalizedFailure.timedOut || normalizedFailure.unauthorized || normalizedFailure.offline) {
            fatalReadInfo = normalizedFailure;
            break;
          }
          listFailure = normalizedFailure;
        }

        if (!namespaceMap) {
          try {
            const probeCommand = buildDeveloperOptionSettingsProbeCommand(
              namespace,
              settingsKeysByNamespace[namespace],
            );
            const response = await runDeveloperOptionsReadShell(serial, probeCommand);
            const result = response.data[0];
            if (!result) {
              fatalReadInfo = normalizeDeveloperOptionReadFailure("No command output returned.");
              break;
            }
            if ((result.exit_code ?? 0) !== 0) {
              fatalReadInfo = normalizeDeveloperOptionReadFailure(
                result.stderr.trim() || result.stdout.trim() || "Read command failed on this device.",
              );
              break;
            }
            namespaceMap = parseSettingsListOutput(result.stdout);
          } catch (error) {
            fatalReadInfo = normalizeDeveloperOptionReadFailure(formatError(error));
            break;
          }
        }

        if (!namespaceMap) {
          fatalReadInfo = listFailure ?? normalizeDeveloperOptionReadFailure("Read command failed on this device.");
          break;
        }

        settingsByNamespace[namespace] = namespaceMap;
      }

      if (fatalReadInfo) {
        fillAllWithFailure(fatalReadInfo.message);
        const status: DeveloperOptionDeviceReadStatus = fatalReadInfo.offline ? "offline" : "error";
        return {
          serial,
          snapshot: nextSnapshot,
          supportedByKey: nextSupported,
          messageByKey: nextMessages,
          status,
          errorMessage: fatalReadInfo.message,
          lastReadAt: Date.now(),
        };
      }

      DEVELOPER_OPTIONS.forEach((option) => {
        if (option.key === "log_buffer_size") {
          nextSupported[option.key] = false;
          nextSnapshot[option.key] = null;
          nextMessages[option.key] = includeLogBuffer ? "Reading..." : "Click Load log buffer.";
          return;
        }

        const target = getDeveloperOptionSettingsTarget(option.key);
        if (!target) {
          nextSupported[option.key] = false;
          nextSnapshot[option.key] = null;
          nextMessages[option.key] = "Unsupported on this device.";
          return;
        }

        let value = settingsByNamespace[target.namespace][target.settingKey] ?? null;
        if (option.key === "bluetooth_btsnoop_default_mode" && (!value || value.toLowerCase() === "null")) {
          value = settingsByNamespace.global.bluetooth_btsnoop_log_mode ?? null;
        }

        const parsed = parseReadResult(option.key, {
          serial,
          stdout: value ?? "null",
          stderr: "",
          exit_code: 0,
        });

        if (parsed.supported) {
          nextSupported[option.key] = true;
          nextSnapshot[option.key] = parsed.value;
          nextMessages[option.key] = null;
          return;
        }

        nextSupported[option.key] = false;
        nextSnapshot[option.key] = null;
        nextMessages[option.key] = parsed.message ?? "Unsupported on this device.";
      });

      if (includeLogBuffer) {
        const logBufferReadCommand = buildReadCommands().find(
          (candidate) => candidate.optionKey === "log_buffer_size",
        );
        if (!logBufferReadCommand) {
          nextSnapshot.log_buffer_size = null;
          nextSupported.log_buffer_size = false;
          nextMessages.log_buffer_size = "Unsupported on this device.";
        } else {
          const attempts = [logBufferReadCommand.command, ...(logBufferReadCommand.fallbackCommands ?? [])];
          let parsedResult:
            | ReturnType<typeof parseReadResult>
            | { optionKey: DeveloperOptionKey; supported: false; value: null; message: string }
            | null = null;

          for (const command of attempts) {
            try {
              const response = await runDeveloperOptionsReadShell(serial, command);
              const result = response.data[0];
              if (!result) {
                parsedResult = {
                  optionKey: "log_buffer_size",
                  supported: false,
                  value: null,
                  message: "No command output returned.",
                };
                continue;
              }
              parsedResult = parseReadResult("log_buffer_size", result);
              if (parsedResult.supported) {
                break;
              }
            } catch (error) {
              parsedResult = {
                optionKey: "log_buffer_size",
                supported: false,
                value: null,
                message: normalizeDeveloperOptionReadFailure(formatError(error)).message,
              };
              break;
            }
          }

          if (parsedResult?.supported) {
            nextSnapshot.log_buffer_size = parsedResult.value;
            nextSupported.log_buffer_size = true;
            nextMessages.log_buffer_size = null;
          } else {
            nextSnapshot.log_buffer_size = null;
            nextSupported.log_buffer_size = false;
            nextMessages.log_buffer_size = parsedResult?.message ?? "Unsupported on this device.";
          }
        }
      }

      const supportedCount = Object.values(nextSupported).filter(Boolean).length;
      const status: DeveloperOptionDeviceReadStatus = supportedCount > 0 ? "success" : "unsupported";
      const errorMessage = supportedCount > 0 ? null : "Unable to read developer options from this device.";
      return {
        serial,
        snapshot: nextSnapshot,
        supportedByKey: nextSupported,
        messageByKey: nextMessages,
        status,
        errorMessage,
        lastReadAt: Date.now(),
      };
    },
    [runDeveloperOptionsReadShell],
  );

  const readDeveloperOptionLogBufferForSerial = useCallback(
    async (serial: string): Promise<DeveloperOptionLogBufferReadResult> => {
      const logBufferReadCommand = buildReadCommands().find(
        (candidate) => candidate.optionKey === "log_buffer_size",
      );
      if (!logBufferReadCommand) {
        return {
          serial,
          supported: false,
          value: null,
          message: "Unsupported on this device.",
        };
      }

      const attempts = [logBufferReadCommand.command, ...(logBufferReadCommand.fallbackCommands ?? [])];
      let parsedResult:
        | ReturnType<typeof parseReadResult>
        | { optionKey: DeveloperOptionKey; supported: false; value: null; message: string }
        | null = null;

      for (const command of attempts) {
        try {
          const response = await runDeveloperOptionsReadShell(serial, command);
          const result = response.data[0];
          if (!result) {
            parsedResult = {
              optionKey: "log_buffer_size",
              supported: false,
              value: null,
              message: "No command output returned.",
            };
            continue;
          }
          parsedResult = parseReadResult("log_buffer_size", result);
          if (parsedResult.supported) {
            break;
          }
        } catch (error) {
          parsedResult = {
            optionKey: "log_buffer_size",
            supported: false,
            value: null,
            message: normalizeDeveloperOptionReadFailure(formatError(error)).message,
          };
          break;
        }
      }

      return {
        serial,
        supported: parsedResult?.supported ?? false,
        value: parsedResult?.supported ? parsedResult.value : null,
        message: parsedResult?.supported ? null : parsedResult?.message ?? "Unsupported on this device.",
      };
    },
    [runDeveloperOptionsReadShell],
  );

  const refreshDeveloperOptionsSnapshot = useCallback(
    async (options: { silent?: boolean; forceLoading?: boolean } = {}) => {
      if (!activeSerial) {
        developerOptionsRefreshTokenRef.current += 1;
        setDeveloperOptionsSnapshot(createDeveloperOptionSnapshot());
        setDeveloperOptionSupportedByKey(createDeveloperOptionSupportMap(false));
        setDeveloperOptionMessageByKey(createDeveloperOptionMessageMap());
        setDeveloperOptionPendingByKey({});
        setDeveloperOptionsError(null);
        setDeveloperOptionsLastReadAt(null);
        setDeveloperOptionsLoading(false);
        setDeveloperOptionsRefreshing(false);
        setDeveloperOptionsMatrixState(createDeveloperOptionsMatrixState());
        setDeveloperOptionsMatrixRefreshing(false);
        setDeveloperOptionsMatrixRefreshMode("fast");
        setDeveloperOptionsMatrixLogBufferState("idle");
        setDeveloperOptionsMatrixLogBufferError(null);
        setDeveloperOptionsMatrixLogBufferLastReadAt(null);
        setDeveloperOptionsMatrixStale(false);
        setDeveloperOptionsMatrixStaleReason(null);
        setDeveloperOptionsMatrixStaleAt(null);
        developerOptionsPrimaryAutoReadKeyRef.current = null;
        developerOptionsSelectionSignatureRef.current = null;
        return;
      }

      const refreshToken = developerOptionsRefreshTokenRef.current + 1;
      developerOptionsRefreshTokenRef.current = refreshToken;

      const useLoading = options.forceLoading ?? false;
      if (useLoading) {
        setDeveloperOptionsLoading(true);
      } else {
        setDeveloperOptionsRefreshing(true);
      }
      setDeveloperOptionsError(null);

      try {
        const readResult = await readDeveloperOptionsForSerial(activeSerial, { includeLogBuffer: true });
        if (developerOptionsRefreshTokenRef.current !== refreshToken) {
          return;
        }

        setDeveloperOptionsSnapshot(readResult.snapshot);
        setDeveloperOptionSupportedByKey(readResult.supportedByKey);
        setDeveloperOptionMessageByKey(readResult.messageByKey);
        setDeveloperOptionsLastReadAt(readResult.lastReadAt);
        if (readResult.errorMessage) {
          setDeveloperOptionsError(readResult.errorMessage);
          if (!options.silent) {
            pushToast(readResult.errorMessage, "error");
          }
        } else {
          setDeveloperOptionsError(null);
        }
      } catch (error) {
        if (developerOptionsRefreshTokenRef.current !== refreshToken) {
          return;
        }
        const message = normalizeDeveloperOptionReadFailure(formatError(error)).message;
        setDeveloperOptionsError(message);
        if (!options.silent) {
          pushToast(message, "error");
        }
      } finally {
        if (developerOptionsRefreshTokenRef.current === refreshToken) {
          setDeveloperOptionsLoading(false);
          setDeveloperOptionsRefreshing(false);
        }
      }
    },
    [activeSerial, readDeveloperOptionsForSerial],
  );

  const refreshDeveloperOptionsMatrix = useCallback(
    async (options: { silent?: boolean; serials?: string[]; mode?: DeveloperOptionsMatrixRefreshMode } = {}) => {
      const targetSerials = options.serials ?? [];
      const mode = options.mode ?? "fast";
      const refreshToken = developerOptionsMatrixRefreshTokenRef.current + 1;
      developerOptionsMatrixRefreshTokenRef.current = refreshToken;
      setDeveloperOptionsMatrixRefreshMode(mode);

      if (targetSerials.length === 0) {
        setDeveloperOptionsMatrixState((prev) => ({
          ...prev,
          loadingSerials: [],
          lastRefreshAt: Date.now(),
        }));
        setDeveloperOptionsMatrixRefreshing(false);
        setDeveloperOptionsMatrixLogBufferState("idle");
        setDeveloperOptionsMatrixLogBufferError(null);
        setDeveloperOptionsMatrixLogBufferLastReadAt(null);
        setDeveloperOptionsMatrixStale(false);
        setDeveloperOptionsMatrixStaleReason(null);
        setDeveloperOptionsMatrixStaleAt(null);
        return;
      }

      setDeveloperOptionsMatrixRefreshing(true);
      setDeveloperOptionsMatrixState((prev) => {
        const nextBySerial = { ...prev.bySerial };
        targetSerials.forEach((serial) => {
          const existing = nextBySerial[serial] ?? createDeveloperOptionDeviceSnapshot(serial);
          nextBySerial[serial] = {
            ...existing,
            status: existing.lastReadAt ? existing.status : "loading",
          };
        });
        return {
          ...prev,
          bySerial: nextBySerial,
          loadingSerials: [...targetSerials],
        };
      });

      const settled = await runWithConcurrencyLimit(targetSerials, 3, async (serial) =>
        readDeveloperOptionsForSerial(serial, { includeLogBuffer: mode === "full" }),
      );

      if (developerOptionsMatrixRefreshTokenRef.current !== refreshToken) {
        return;
      }

      let errorCount = 0;
      let offlineCount = 0;
      setDeveloperOptionsMatrixState((prev) => {
        const nextBySerial = { ...prev.bySerial };
        const nextErrorBySerial = { ...prev.errorBySerial };

        settled.forEach((item, index) => {
          const serial = targetSerials[index];
          if (item.status === "fulfilled") {
            nextBySerial[serial] = {
              serial: item.value.serial,
              status: item.value.status,
              values: item.value.snapshot,
              supportedByKey: item.value.supportedByKey,
              messageByKey: item.value.messageByKey,
              lastReadAt: item.value.lastReadAt,
            };
            nextErrorBySerial[serial] = item.value.errorMessage;
            if (item.value.status === "error") {
              errorCount += 1;
            } else if (item.value.status === "offline") {
              offlineCount += 1;
            }
            return;
          }

          const normalized = normalizeDeveloperOptionReadFailure(formatError(item.reason));
          errorCount += 1;
          const failedSnapshot = createDeveloperOptionDeviceSnapshot(
            serial,
            normalized.offline ? "offline" : "error",
          );
          DEVELOPER_OPTIONS.forEach((option) => {
            failedSnapshot.messageByKey[option.key] = normalized.message;
          });
          failedSnapshot.lastReadAt = Date.now();
          nextBySerial[serial] = failedSnapshot;
          nextErrorBySerial[serial] = normalized.message;
        });

        return {
          ...prev,
          bySerial: nextBySerial,
          errorBySerial: nextErrorBySerial,
          loadingSerials: [],
          lastRefreshAt: Date.now(),
        };
      });

      setDeveloperOptionsMatrixRefreshing(false);
      if (mode === "full") {
        setDeveloperOptionsMatrixLogBufferState(errorCount > 0 ? "error" : "loaded");
        setDeveloperOptionsMatrixLogBufferError(
          errorCount > 0
            ? `Log buffer refresh had ${errorCount} device error${errorCount > 1 ? "s" : ""}.`
            : null,
        );
        setDeveloperOptionsMatrixLogBufferLastReadAt(Date.now());
      } else {
        setDeveloperOptionsMatrixLogBufferState("idle");
        setDeveloperOptionsMatrixLogBufferError(null);
        setDeveloperOptionsMatrixLogBufferLastReadAt(null);
      }
      setDeveloperOptionsMatrixStale(false);
      setDeveloperOptionsMatrixStaleReason(null);
      setDeveloperOptionsMatrixStaleAt(null);
      if (!options.silent) {
        if (errorCount > 0) {
          pushToast(
            `Comparison refresh completed with ${errorCount} device error${
              errorCount > 1 ? "s" : ""
            } and ${offlineCount} offline device${offlineCount > 1 ? "s" : ""}.`,
            "error",
          );
        } else {
          pushToast(
            `Comparison refreshed for ${targetSerials.length} selected device${
              targetSerials.length > 1 ? "s" : ""
            }.`,
            "info",
          );
        }
      }
    },
    [readDeveloperOptionsForSerial],
  );

  const loadDeveloperOptionsMatrixLogBuffer = useCallback(async () => {
    const targetSerials = developerOptionsMatrixSerials.onlineSerials;
    if (targetSerials.length === 0 || developerOptionsMatrixLogBufferState === "loading") {
      return;
    }

    setDeveloperOptionsMatrixLogBufferState("loading");
    setDeveloperOptionsMatrixLogBufferError(null);

    const settled = await runWithConcurrencyLimit(targetSerials, 3, async (serial) =>
      readDeveloperOptionLogBufferForSerial(serial),
    );

    let failureCount = 0;
    setDeveloperOptionsMatrixState((prev) => {
      const nextBySerial = { ...prev.bySerial };
      const nextErrorBySerial = { ...prev.errorBySerial };

      settled.forEach((item, index) => {
        const serial = targetSerials[index];
        const existing = nextBySerial[serial] ?? createDeveloperOptionDeviceSnapshot(serial);
        if (item.status === "fulfilled") {
          nextBySerial[serial] = {
            ...existing,
            values: {
              ...existing.values,
              log_buffer_size: item.value.value,
            },
            supportedByKey: {
              ...existing.supportedByKey,
              log_buffer_size: item.value.supported,
            },
            messageByKey: {
              ...existing.messageByKey,
              log_buffer_size: item.value.message,
            },
            lastReadAt: item.value.supported ? Date.now() : existing.lastReadAt,
          };
          if (!item.value.supported && item.value.message) {
            failureCount += 1;
            nextErrorBySerial[serial] = item.value.message;
          }
          return;
        }

        failureCount += 1;
        const normalized = normalizeDeveloperOptionReadFailure(formatError(item.reason));
        nextBySerial[serial] = {
          ...existing,
          values: {
            ...existing.values,
            log_buffer_size: null,
          },
          supportedByKey: {
            ...existing.supportedByKey,
            log_buffer_size: false,
          },
          messageByKey: {
            ...existing.messageByKey,
            log_buffer_size: normalized.message,
          },
        };
        nextErrorBySerial[serial] = normalized.message;
      });

      return {
        ...prev,
        bySerial: nextBySerial,
        errorBySerial: nextErrorBySerial,
      };
    });

    setDeveloperOptionsMatrixLogBufferState(failureCount > 0 ? "error" : "loaded");
    setDeveloperOptionsMatrixLogBufferError(
      failureCount > 0
        ? `Log buffer refresh had ${failureCount} device error${failureCount > 1 ? "s" : ""}.`
        : null,
    );
    setDeveloperOptionsMatrixLogBufferLastReadAt(Date.now());
    setDeveloperOptionsMatrixRefreshMode("full");
    if (failureCount > 0) {
      pushToast(
        `Log buffer refresh completed with ${failureCount} device error${failureCount > 1 ? "s" : ""}.`,
        "error",
      );
    } else {
      pushToast(
        `Log buffer loaded for ${targetSerials.length} selected device${targetSerials.length > 1 ? "s" : ""}.`,
        "info",
      );
    }
  }, [
    developerOptionsMatrixSerials.onlineSerials,
    developerOptionsMatrixLogBufferState,
    readDeveloperOptionLogBufferForSerial,
  ]);

  const markDeveloperOptionsMatrixStale = useCallback((reason: DeveloperOptionsMatrixStaleReason) => {
    setDeveloperOptionsMatrixStale(true);
    setDeveloperOptionsMatrixStaleReason(reason);
    setDeveloperOptionsMatrixStaleAt(Date.now());
  }, []);

  type DeveloperOptionApplySummary = {
    optionKey: DeveloperOptionKey;
    label: string;
    successCount: number;
    unsupportedCount: number;
    failureCount: number;
    skippedCount: number;
  };

  const applyDeveloperOption = async (
    optionKey: DeveloperOptionKey,
    nextValue: DeveloperOptionValue,
    options: {
      targetSerials?: string[];
      skippedCount?: number;
      suppressToast?: boolean;
      manageBusyState?: boolean;
    } = {},
  ): Promise<DeveloperOptionApplySummary | null> => {
    const option = DEVELOPER_OPTIONS.find((candidate) => candidate.key === optionKey);
    if (!option) {
      if (!options.suppressToast) {
        pushToast("Unknown developer option.", "error");
      }
      return null;
    }

    const built = buildApplyCommand({ optionKey, value: nextValue });
    if (!built.ok) {
      if (!options.suppressToast) {
        pushToast(built.error, "error");
      }
      return null;
    }

    const targetSerials = options.targetSerials ?? developerOptionsScope.targetSerials;
    const skippedCount = options.skippedCount ?? developerOptionsScope.skippedCount;
    if (!targetSerials.length) {
      if (!options.suppressToast) {
        pushToast("No online devices available for this action.", "error");
      }
      return null;
    }

    const taskId = beginTask({
      kind: "shell",
      title: `Developer Option: ${option.label}`,
      serials: targetSerials,
    });
    targetSerials.forEach((serial) => {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "running", message: "Applying option..." },
      });
    });

    const shouldManageBusyState = options.manageBusyState ?? true;
    if (shouldManageBusyState) {
      setBusy(true);
    }
    setDeveloperOptionsApplyingKey(optionKey);
    try {
      const response = await runShell(
        targetSerials,
        quoteShellCommandForAdbSh(built.data.command),
        true,
        { recordError: false },
      );
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      const resultBySerial = new Map(response.data.map((result) => [result.serial, result]));
      let successCount = 0;
      let unsupportedCount = 0;
      let failureCount = 0;

      targetSerials.forEach((serial) => {
        const result = resultBySerial.get(serial);
        if (!result) {
          failureCount += 1;
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: { status: "error", message: "No command result returned." },
          });
          return;
        }

        const evaluation = evaluateApplyResult(result);
        if (evaluation.success) {
          successCount += 1;
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: { status: "success", message: "Applied." },
          });
          return;
        }

        if (evaluation.unsupported) {
          unsupportedCount += 1;
        } else {
          failureCount += 1;
        }
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial,
          patch: { status: "error", message: evaluation.message },
        });
      });
      dispatchTasks({ type: "TASK_RECOMPUTE_STATUS", id: taskId });

      if (activeSerial && targetSerials.includes(activeSerial) && successCount > 0) {
        setDeveloperOptionsSnapshot((prev) => ({
          ...prev,
          [optionKey]: built.data.normalizedValue,
        }));
        setDeveloperOptionSupportedByKey((prev) => ({
          ...prev,
          [optionKey]: true,
        }));
      }

      const totalFailedTargets = unsupportedCount + failureCount;
      setDeveloperOptionMessageByKey((prev) => ({
        ...prev,
        [optionKey]:
          totalFailedTargets === 0
            ? null
            : `Apply failed on ${totalFailedTargets} target${totalFailedTargets > 1 ? "s" : ""}.`,
      }));

      if (
        successCount > 0 &&
        shouldMarkMatrixStaleAfterApply(targetSerials, developerOptionsMatrixSerials.onlineSerials)
      ) {
        markDeveloperOptionsMatrixStale("apply_completed");
      }

      const summary: DeveloperOptionApplySummary = {
        optionKey,
        label: option.label,
        successCount,
        unsupportedCount,
        failureCount,
        skippedCount,
      };

      if (!options.suppressToast) {
        const skipSuffix =
          skippedCount > 0
            ? ` Skipped ${skippedCount} offline device${skippedCount > 1 ? "s" : ""}.`
            : "";
        if (totalFailedTargets === 0) {
          pushToast(
            `Applied ${option.label} to ${successCount} device${successCount > 1 ? "s" : ""}.${skipSuffix}`,
            "info",
          );
        } else if (successCount > 0) {
          pushToast(
            `Applied ${option.label} to ${successCount} device${successCount > 1 ? "s" : ""}; ${totalFailedTargets} failed.${skipSuffix}`,
            "error",
          );
        } else {
          pushToast(`Failed to apply ${option.label}.${skipSuffix}`, "error");
        }
      }
      return summary;
    } catch (error) {
      const message = formatError(error);
      targetSerials.forEach((serial) => {
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial,
          patch: { status: "error", message },
        });
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      setDeveloperOptionMessageByKey((prev) => ({
        ...prev,
        [optionKey]: "Apply request failed.",
      }));
      if (!options.suppressToast) {
        pushToast(message, "error");
      }
      return {
        optionKey,
        label: option.label,
        successCount: 0,
        unsupportedCount: 0,
        failureCount: targetSerials.length,
        skippedCount,
      };
    } finally {
      setDeveloperOptionsApplyingKey(null);
      if (shouldManageBusyState) {
        setBusy(false);
      }
    }
  };

  const applyDeveloperOptionBatch = async (changes: DeveloperOptionBatchChange[]) => {
    if (changes.length === 0) {
      pushToast("No pending changes to apply.", "info");
      return;
    }
    if (!developerOptionsScope.hasOnlineTarget) {
      pushToast("No online devices available for this action.", "error");
      return;
    }

    setBusy(true);
    setDeveloperOptionsBatchApplying(true);
    try {
      let successfulChanges = 0;
      let failedChanges = 0;
      let failedTargets = 0;

      for (const change of changes) {
        const summary = await applyDeveloperOption(change.optionKey, change.value, {
          targetSerials: developerOptionsScope.targetSerials,
          skippedCount: developerOptionsScope.skippedCount,
          suppressToast: true,
          manageBusyState: false,
        });
        if (!summary) {
          failedChanges += 1;
          continue;
        }

        const changeFailed = summary.failureCount + summary.unsupportedCount;
        if (changeFailed === 0) {
          successfulChanges += 1;
        } else {
          failedChanges += 1;
          failedTargets += changeFailed;
        }
      }

      setDeveloperOptionPendingByKey({});
      const skipSuffix =
        developerOptionsScope.skippedCount > 0
          ? ` Skipped ${developerOptionsScope.skippedCount} offline device${
              developerOptionsScope.skippedCount > 1 ? "s" : ""
            }.`
          : "";
      if (failedChanges === 0) {
        pushToast(
          `Applied ${changes.length} change${changes.length > 1 ? "s" : ""} to ${
            developerOptionsScope.targetSerials.length
          } device${developerOptionsScope.targetSerials.length > 1 ? "s" : ""}.${skipSuffix}`,
          "info",
        );
      } else if (successfulChanges > 0) {
        pushToast(
          `Applied ${successfulChanges}/${changes.length} changes. ${failedChanges} change${
            failedChanges > 1 ? "s" : ""
          } had failures across ${failedTargets} target${failedTargets > 1 ? "s" : ""}.${skipSuffix}`,
          "error",
        );
      } else {
        pushToast(`Failed to apply ${changes.length} pending change${changes.length > 1 ? "s" : ""}.${skipSuffix}`, "error");
      }
    } finally {
      setDeveloperOptionsBatchApplying(false);
      setBusy(false);
    }
  };

  const requestDeveloperOptionApply = (optionKey: DeveloperOptionKey, nextValue: DeveloperOptionValue) => {
    const option = DEVELOPER_OPTIONS.find((candidate) => candidate.key === optionKey);
    if (!option) {
      pushToast("Unknown developer option.", "error");
      return;
    }

    if (developerOptionsApplyMode === "selected_batch") {
      setDeveloperOptionPendingByKey((prev) =>
        setPendingDeveloperOptionValue({
          pending: prev,
          snapshot: developerOptionsSnapshot,
          optionKey,
          nextValue,
        }),
      );
      return;
    }

    if (isHighRiskOption(optionKey)) {
      if (!developerOptionsScope.hasOnlineTarget) {
        pushToast("No online devices available for this action.", "error");
        return;
      }
      const change: DeveloperOptionsConfirmChange = {
        optionKey,
        label: option.label,
        value: nextValue,
        highRisk: true,
      };
      setDeveloperOptionsConfirmModal({
        mode: "single",
        changes: [change],
        highRiskChanges: [change],
        targetCount: developerOptionsScope.targetSerials.length,
        skippedCount: developerOptionsScope.skippedCount,
      });
      return;
    }
    void applyDeveloperOption(optionKey, nextValue);
  };

  const handleDeveloperOptionsApplyPending = () => {
    if (developerOptionsPendingPlan.count === 0) {
      pushToast("No pending changes to apply.", "info");
      return;
    }
    if (!developerOptionsScope.hasOnlineTarget) {
      pushToast("No online devices available for this action.", "error");
      return;
    }

    const changes: DeveloperOptionsConfirmChange[] = developerOptionsPendingPlan.changes.map((change) => ({
      optionKey: change.optionKey,
      label: change.label,
      value: change.value,
      highRisk: change.highRisk,
    }));

    if (developerOptionsPendingPlan.hasHighRisk) {
      const highRiskChanges: DeveloperOptionsConfirmChange[] = developerOptionsPendingPlan.highRiskChanges.map((change) => ({
        optionKey: change.optionKey,
        label: change.label,
        value: change.value,
        highRisk: true,
      }));
      setDeveloperOptionsConfirmModal({
        mode: "batch",
        changes,
        highRiskChanges,
        targetCount: developerOptionsScope.targetSerials.length,
        skippedCount: developerOptionsScope.skippedCount,
      });
      return;
    }

    const batchChanges: DeveloperOptionBatchChange[] = changes
      .filter(
        (change): change is DeveloperOptionsConfirmChange & { value: Exclude<DeveloperOptionValue, null> } =>
          change.value != null,
      )
      .map((change) => ({
        optionKey: change.optionKey,
        label: change.label,
        value: change.value,
        highRisk: change.highRisk,
      }));
    void applyDeveloperOptionBatch(batchChanges);
  };

  const handleDeveloperOptionsDiscardPending = () => {
    setDeveloperOptionPendingByKey({});
  };

  const closeDeveloperOptionsConfirmModal = () => {
    setDeveloperOptionsConfirmModal(null);
  };

  const handleDeveloperOptionsConfirmApply = () => {
    if (!developerOptionsConfirmModal) {
      return;
    }

    const modal = developerOptionsConfirmModal;
    closeDeveloperOptionsConfirmModal();
    if (modal.mode === "single") {
      const change = modal.changes[0];
      if (!change) {
        return;
      }
      void applyDeveloperOption(change.optionKey, change.value);
      return;
    }

    const batchChanges: DeveloperOptionBatchChange[] = modal.changes
      .filter(
        (change): change is DeveloperOptionsConfirmChange & { value: Exclude<DeveloperOptionValue, null> } =>
          change.value != null,
      )
      .map((change) => ({
        optionKey: change.optionKey,
        label: change.label,
        value: change.value,
        highRisk: change.highRisk,
      }));
    void applyDeveloperOptionBatch(batchChanges);
  };

  useEffect(() => {
    setDeveloperOptionPendingByKey({});
  }, [activeSerial]);

  useEffect(() => {
    if (developerOptionsApplyMode === "primary_instant") {
      setDeveloperOptionPendingByKey({});
    }
  }, [developerOptionsApplyMode]);

  useEffect(() => {
    if (!developerOptionsPrimaryAutoReadKey) {
      return;
    }
    if (developerOptionsPrimaryAutoReadKeyRef.current === developerOptionsPrimaryAutoReadKey) {
      return;
    }
    developerOptionsPrimaryAutoReadKeyRef.current = developerOptionsPrimaryAutoReadKey;
    void refreshDeveloperOptionsSnapshot({
      silent: true,
      forceLoading: developerOptionsLastReadAt == null,
    });
  }, [developerOptionsPrimaryAutoReadKey, refreshDeveloperOptionsSnapshot, developerOptionsLastReadAt]);

  useEffect(() => {
    if (!isDeveloperOptionsView) {
      developerOptionsPrimaryAutoReadKeyRef.current = null;
      developerOptionsSelectionSignatureRef.current = null;
      return;
    }

    const previousSignature = developerOptionsSelectionSignatureRef.current;
    developerOptionsSelectionSignatureRef.current = developerOptionsSelectedSerialsSignature;

    if (previousSignature == null || previousSignature === developerOptionsSelectedSerialsSignature) {
      return;
    }
    if (!developerOptionsMatrixState.lastRefreshAt) {
      return;
    }

    markDeveloperOptionsMatrixStale("selection_changed");
  }, [
    isDeveloperOptionsView,
    developerOptionsSelectedSerialsSignature,
    developerOptionsMatrixState.lastRefreshAt,
    markDeveloperOptionsMatrixStale,
  ]);

  useEffect(() => {
    const allowedSerials = activeSerial
      ? [activeSerial, ...developerOptionsScope.uniqueSelectedSerials]
      : [...developerOptionsScope.uniqueSelectedSerials];
    const allowedSet = buildMatrixSerialSet(allowedSerials);

    setDeveloperOptionsMatrixState((prev) => {
      const pruned = pruneDeveloperOptionsMatrixState({
        bySerial: prev.bySerial,
        errorBySerial: prev.errorBySerial,
        allowedSerials,
      });
      const nextLoadingSerials = prev.loadingSerials.filter((serial) => allowedSet.has(serial));

      const previousBySerialKeys = Object.keys(prev.bySerial);
      const nextBySerialKeys = Object.keys(pruned.bySerial);
      const unchangedBySerial =
        previousBySerialKeys.length === nextBySerialKeys.length &&
        previousBySerialKeys.every((key) => Object.prototype.hasOwnProperty.call(pruned.bySerial, key));

      const previousErrorBySerialKeys = Object.keys(prev.errorBySerial);
      const nextErrorBySerialKeys = Object.keys(pruned.errorBySerial);
      const unchangedErrorBySerial =
        previousErrorBySerialKeys.length === nextErrorBySerialKeys.length &&
        previousErrorBySerialKeys.every((key) =>
          Object.prototype.hasOwnProperty.call(pruned.errorBySerial, key),
        );

      const unchangedLoading =
        nextLoadingSerials.length === prev.loadingSerials.length &&
        prev.loadingSerials.every((serial, index) => serial === nextLoadingSerials[index]);
      if (unchangedBySerial && unchangedErrorBySerial && unchangedLoading) {
        return prev;
      }

      return {
        ...prev,
        bySerial: pruned.bySerial,
        errorBySerial: pruned.errorBySerial,
        loadingSerials: nextLoadingSerials,
      };
    });
  }, [activeSerial, developerOptionsScope.uniqueSelectedSerials]);

  const handleInstallApk = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device for APK install.", "error");
      return;
    }

    let paths: string[] = [];
    if (apkInstallMode === "single") {
      let path = apkPath;
      if (!path) {
        const selected = await openDialog({
          title: "Select APK",
          multiple: false,
          filters: [{ name: "APK", extensions: ["apk", "apks", "xapk"] }],
        });
        if (!selected || Array.isArray(selected)) {
          return;
        }
        path = selected;
        setApkPath(path);
      }
      paths = [path];
    } else if (apkInstallMode === "bundle") {
      let path = apkBundlePath;
      if (!path) {
        const selected = await openDialog({
          title: "Select APK Bundle",
          multiple: false,
          filters: [{ name: "Bundle", extensions: ["apks", "xapk"] }],
        });
        if (!selected || Array.isArray(selected)) {
          return;
        }
        path = selected;
        setApkBundlePath(path);
      }
      paths = [path];
    } else {
      let selected = apkPaths;
      if (!selected.length) {
        const picked = await openDialog({
          title: "Select APKs",
          multiple: true,
          filters: [{ name: "APK", extensions: ["apk", "apks", "xapk"] }],
        });
        if (!picked) {
          return;
        }
        selected = Array.isArray(picked) ? picked : [picked];
        setApkPaths(selected);
      }
      paths = selected;
    }

    if (!paths.length) {
      return;
    }

    const serials = Array.from(new Set(selectedSerials));

    apkInstallCancelRequestedRef.current = false;
    setApkInstallSummary([]);
    setBusy(true);
    setInstallBusy(true);
    let wasCancelled = false;
    try {
      const summaries: string[] = [];
      for (const path of paths) {
        if (apkInstallCancelRequestedRef.current) {
          wasCancelled = true;
          break;
        }
        const name = path.split(/[/\\\\]/).pop() ?? path;
        const taskId = beginTask({
          kind: "apk_install",
          title: `APK Install: ${name}`,
          serials,
        });
        setLatestApkInstallTaskId(taskId);
        const traceId = crypto.randomUUID();
        setActiveApkInstallTraceId(traceId);
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
        apkInstallTaskByTraceIdRef.current[traceId] = taskId;
        serials.forEach((serial) => {
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: { status: "running", progress: null, message: "Preparing install..." },
          });
        });
        try {
          const response = await installApkBatch(
            serials,
            path,
            apkReplace,
            apkAllowDowngrade,
            apkGrant,
            apkAllowTest,
            apkExtraArgs,
            traceId,
            { recordError: false },
          );
          dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
          const results = Object.values(response.data.results || {});
          const successCount = results.filter((item) => item.success).length;
          const cancelledInBatch =
            apkInstallCancelRequestedRef.current ||
            results.some(
              (item) =>
                !item.success &&
                item.error_code === "INSTALL_FAILED_ABORTED" &&
                item.raw_output.toLowerCase().includes("cancelled"),
            );
          if (cancelledInBatch) {
            wasCancelled = true;
          }
          summaries.push(
            cancelledInBatch
              ? `${path}: Cancelled (${successCount}/${results.length} installed)`
              : `${path}: Installed ${successCount}/${results.length} device(s)`,
          );
          results.forEach((item) => {
            const itemCancelled =
              !item.success &&
              item.error_code === "INSTALL_FAILED_ABORTED" &&
              item.raw_output.toLowerCase().includes("cancelled");
            dispatchTasks({
              type: "TASK_UPDATE_DEVICE",
              id: taskId,
              serial: item.serial,
              patch: {
                status: item.success ? "success" : itemCancelled ? "cancelled" : "error",
                progress: item.success ? 100 : null,
                message: item.success
                  ? "Installed."
                  : itemCancelled
                    ? "Cancelled."
                    : formatApkInstallFailureMessage(item.error_code, null, item.raw_output),
              },
            });
          });
          const hasError = results.some(
            (item) =>
              !item.success &&
              !(
                item.error_code === "INSTALL_FAILED_ABORTED" &&
                item.raw_output.toLowerCase().includes("cancelled")
              ),
          );
          dispatchTasks({
            type: "TASK_SET_STATUS",
            id: taskId,
            status: cancelledInBatch ? "cancelled" : hasError ? "error" : "success",
          });
        } catch (error) {
          serials.forEach((serial) => {
            dispatchTasks({
              type: "TASK_UPDATE_DEVICE",
              id: taskId,
              serial,
              patch: { status: "error", progress: null, message: formatError(error) },
            });
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
          throw error;
        } finally {
          delete apkInstallTaskByTraceIdRef.current[traceId];
          setActiveApkInstallTraceId(null);
        }
      }
      setApkInstallSummary(summaries);
      pushToast(wasCancelled ? "APK install cancelled." : "APK install completed.", "info");

      if (!wasCancelled && apkLaunchAfterInstall) {
        const error = validatePackageName(apkLaunchPackage);
        if (error) {
          pushToast(error, "error");
        } else {
          const response = await launchApp(serials, apkLaunchPackage.trim());
          const successCount = response.data.filter((item) => item.exit_code === 0).length;
          pushToast(`Launch requested (${successCount}/${response.data.length}).`, "info");
        }
      }
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
      setInstallBusy(false);
      setActiveApkInstallTraceId(null);
    }
  };

  const handleCancelApkInstall = async () => {
    apkInstallCancelRequestedRef.current = true;
    if (!activeApkInstallTraceId) {
      return;
    }
    try {
      await cancelApkInstall(activeApkInstallTraceId, { recordError: false });
      pushToast("Cancelling APK install…", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const pickBugreportOutputDir = async (): Promise<string | null> => {
    const configured = config?.output_path?.trim() ?? "";
    if (configured) {
      return configured;
    }
    const selected = await openDialog({
      title: "Select output folder",
      directory: true,
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) {
      return null;
    }
    return selected;
  };

  const runBugreportForSerials = async (
    serialsInput: string[],
    options?: {
      title?: string;
      notifySuccess?: boolean;
      setAsLatest?: boolean;
    },
  ) => {
    const serials = Array.from(new Set(serialsInput.map((serial) => serial.trim()).filter(Boolean)));
    if (!serials.length) {
      pushToast("Select at least one device for bugreport.", "error");
      return;
    }

    const outputDir = await pickBugreportOutputDir();
    if (!outputDir) {
      return;
    }

    const taskId = beginTask({
      kind: "bugreport",
      title: options?.title ?? `Bugreport (${serials.length})`,
      serials,
    });
    if (options?.setAsLatest ?? true) {
      setLatestBugreportTaskId(taskId);
    }
    setBugreportResult(null);
    serials.forEach((serial) => {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "running", progress: 0, message: "Starting bugreport..." },
      });
    });

    setBusy(true);
    try {
      const results = await Promise.all(
        serials.map(async (serial) => {
          try {
            const response = await generateBugreport(serial, outputDir, { recordError: false });
            setBugreportResult(response.data);
            return { serial, ok: true };
          } catch (error) {
            return { serial, ok: false, error };
          }
        }),
      );

      const failed = results.filter((item) => !item.ok);
      failed.forEach((item) => {
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial: item.serial,
          patch: { status: "error", progress: null, message: formatError(item.error) },
        });
      });
      if (failed.length > 0) {
        dispatchTasks({ type: "TASK_RECOMPUTE_STATUS", id: taskId });
      }

      if (options?.notifySuccess !== false || failed.length > 0) {
        pushToast(
          failed.length
            ? `Bugreport completed with ${failed.length} failures.`
            : `Bugreport completed for ${serials.length} device${serials.length > 1 ? "s" : ""}.`,
          failed.length ? "error" : "info",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelBugreportForSerials = async (serialsInput: string[]) => {
    const serials = Array.from(new Set(serialsInput.map((serial) => serial.trim()).filter(Boolean)));
    if (!serials.length) {
      pushToast("Select at least one device to cancel bugreport.", "error");
      return;
    }

    try {
      await Promise.all(
        serials.map(async (serial) => {
          try {
            await cancelBugreport(serial);
            const taskId = findRunningBugreportTaskIdForSerial(taskStateRef.current.items, serial);
            if (taskId) {
              dispatchTasks({
                type: "TASK_UPDATE_DEVICE",
                id: taskId,
                serial,
                patch: { status: "cancelled", message: "Bugreport cancel requested." },
              });
              dispatchTasks({ type: "TASK_RECOMPUTE_STATUS", id: taskId });
            }
          } catch (error) {
            pushToast(formatError(error), "error");
          }
        }),
      );
      pushToast(
        serials.length === 1 ? "Bugreport cancel requested for 1 device." : "Bugreport cancel requested.",
        "info",
      );
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const handleBugreport = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device for bugreport.", "error");
      return;
    }
    await runBugreportForSerials(selectedSerials, {
      notifySuccess: true,
      setAsLatest: true,
    });
  };

  const handleRetryBugreport = async (serial: string) => {
    await runBugreportForSerials([serial], {
      title: `Bugreport Retry (${serial})`,
      notifySuccess: true,
      setAsLatest: true,
    });
  };

  const handleCancelBugreport = async () => {
    await cancelBugreportForSerials(selectedSerials);
  };

  const handleOpenBugreportOutputs = async () => {
    const paths = Array.from(new Set(bugreportOutputPaths));
    if (!paths.length) {
      pushToast("No bugreport outputs available yet.", "error");
      return;
    }

    let failed = 0;
    for (const path of paths) {
      try {
        await openPath(path);
      } catch (error) {
        failed += 1;
        pushToast(formatError(error), "error");
      }
    }

    if (!failed) {
      pushToast(`Opened ${paths.length} output path${paths.length > 1 ? "s" : ""}.`, "info");
    } else if (failed < paths.length) {
      pushToast(
        `Opened ${paths.length - failed}/${paths.length} output path${paths.length > 1 ? "s" : ""}.`,
        "error",
      );
    }
  };

  const normalizeSharedLogFilterInput = (
    rawValue: string,
    defaultKind: LogTextChipKind,
  ): { kind: LogTextChipKind; value: string } | null => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return null;
    }
    let kind: LogTextChipKind = defaultKind;
    let value = trimmed;
    if (trimmed.startsWith("-") || trimmed.startsWith("!")) {
      kind = "exclude";
      value = trimmed.slice(1).trim();
    } else if (trimmed.startsWith("+")) {
      kind = "include";
      value = trimmed.slice(1).trim();
    }
    if (!value) {
      return null;
    }
    return { kind, value };
  };

  const addSharedLogFilter = (defaultKind: LogTextChipKind, rawValue: string) => {
    const parsed = normalizeSharedLogFilterInput(rawValue, defaultKind);
    if (!parsed) {
      return false;
    }
    const { kind, value } = parsed;
    try {
      // Validate user input early; invalid patterns would silently do nothing otherwise.
      // This keeps presets and bugreport regex sync predictable.
      // eslint-disable-next-line no-new
      new RegExp(value, "i");
    } catch {
      pushToast("Invalid regex pattern.", "error");
      return false;
    }
    setSharedLogTextChips((prev) => addLogTextChip(prev, kind, value));
    return true;
  };

  const clearSharedLogFilters = () => {
    setSharedLogTextChips([]);
  };

  const editSharedLogFilterChip = (chip: LogTextChip) => {
    setLogcatTextKind(chip.kind);
    setLogcatLiveFilter(chip.value);
    setSharedLogTextChips((prev) => removeLogTextChip(prev, chip.id));
  };

  const editBugreportLogFilterChip = (chip: LogTextChip) => {
    setBugreportLogFilterKind(chip.kind);
    setBugreportLogLiveFilter(chip.value);
    setSharedLogTextChips((prev) => removeLogTextChip(prev, chip.id));
  };

  const addLogcatLiveFilter = () => {
    if (addSharedLogFilter(logcatTextKind, logcatLiveFilter)) {
      setLogcatLiveFilter("");
    }
  };

  const addBugreportLogLiveFilter = () => {
    if (addSharedLogFilter(bugreportLogFilterKind, bugreportLogLiveFilter)) {
      setBugreportLogLiveFilter("");
    }
  };

  const buildLogcatPresetFromCurrent = (name: string): LogcatFilterPreset | null => {
    const hasAnyFilters = sharedLogTextChips.length > 0;
    const hasLevelOverrides = LOG_LEVELS.some((level) => !logLevels[level]);
    if (!hasAnyFilters && !hasLevelOverrides) {
      pushToast("Preset must include at least one filter or a level override.", "error");
      return null;
    }

    const { text_terms: include, text_excludes: exclude } = buildLogTextFilters(sharedLogTextChips);
    const levelsSnapshot: LogcatLevelsState = {
      V: logLevels.V,
      D: logLevels.D,
      I: logLevels.I,
      W: logLevels.W,
      E: logLevels.E,
      F: logLevels.F,
    };

    const nextPreset: LogcatFilterPreset = {
      name,
      include,
      exclude,
      levels: levelsSnapshot,
    };
    return nextPreset;
  };

  const saveLogcatPreset = (nameInput: string) => {
    const name = nameInput.trim();
    if (!name) {
      pushToast("Preset name is required.", "error");
      return false;
    }
    if (logcatPresets.some((preset) => preset.name === name)) {
      pushToast("Preset name already exists. Use Update to overwrite.", "error");
      return false;
    }

    const nextPreset = buildLogcatPresetFromCurrent(name);
    if (!nextPreset) {
      return false;
    }

    setLogcatPresets((prev) => [...prev.filter((preset) => preset.name !== name), nextPreset]);
    setLogcatPresetName("");
    setLogcatPresetSelected(name);
    pushToast("Preset saved.", "info");
    return true;
  };

  const updateLogcatPreset = (name: string) => {
    const target = name.trim();
    if (!target) {
      pushToast("Select a preset to update.", "error");
      return false;
    }
    if (!logcatPresets.some((preset) => preset.name === target)) {
      pushToast("Preset does not exist.", "error");
      return false;
    }
    const nextPreset = buildLogcatPresetFromCurrent(target);
    if (!nextPreset) {
      return false;
    }
    setLogcatPresets((prev) => [...prev.filter((preset) => preset.name !== target), nextPreset]);
    setLogcatPresetName(target);
    setLogcatPresetSelected(target);
    pushToast("Preset updated.", "info");
    return true;
  };

  const applyLogcatPreset = (name: string) => {
    const preset = logcatPresets.find((item) => item.name === name);
    if (!preset) {
      return;
    }

    const invalidPatterns: string[] = [];
    let nextChips: LogTextChip[] = [];
    preset.include.forEach((pattern) => {
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern, "i");
        nextChips = addLogTextChip(nextChips, "include", pattern);
      } catch {
        invalidPatterns.push(pattern);
      }
    });
    preset.exclude.forEach((pattern) => {
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern, "i");
        nextChips = addLogTextChip(nextChips, "exclude", pattern);
      } catch {
        invalidPatterns.push(pattern);
      }
    });

    if (invalidPatterns.length > 0) {
      pushToast("Some preset patterns were invalid and were ignored.", "error");
    }

    setSharedLogTextChips(nextChips);
    if (preset.levels) {
      setLogLevels(preset.levels);
    }
  };

  const deleteLogcatPreset = (name: string) => {
    const target = name.trim();
    if (!target) {
      pushToast("Select a preset to delete.", "error");
      return false;
    }
    if (!logcatPresets.some((preset) => preset.name === target)) {
      pushToast("Preset does not exist.", "error");
      return false;
    }
    setLogcatPresets((prev) => prev.filter((item) => item.name !== target));
    if (logcatPresetSelected === target) {
      setLogcatPresetSelected("");
    }
    if (logcatPresetName.trim() === target) {
      setLogcatPresetName("");
    }
    pushToast("Preset deleted.", "info");
    return true;
  };

  const buildBugreportPresetFromCurrent = (name: string): BugreportFilterPreset | null => {
    const hasAnyFilters = sharedLogTextChips.length > 0;
    const hasLevelOverrides = LOG_LEVELS.some((level) => !logLevels[level]);
    const buffer = bugreportLogBuffer.trim();
    const tag = bugreportLogTag.trim();
    const pid = bugreportLogPid.trim();
    const start = bugreportLogStart.trim();
    const end = bugreportLogEnd.trim();
    const hasBugreportMeta = Boolean(buffer || tag || pid || start || end);
    if (!hasAnyFilters && !hasLevelOverrides && !hasBugreportMeta) {
      pushToast("Preset must include at least one filter, level override, or bugreport condition.", "error");
      return null;
    }

    const { text_terms: include, text_excludes: exclude } = buildLogTextFilters(sharedLogTextChips);
    const levelsSnapshot: LogcatLevelsState = {
      V: logLevels.V,
      D: logLevels.D,
      I: logLevels.I,
      W: logLevels.W,
      E: logLevels.E,
      F: logLevels.F,
    };

    const nextPreset: BugreportFilterPreset = {
      name,
      include,
      exclude,
      levels: levelsSnapshot,
      ...(buffer ? { buffer } : {}),
      ...(tag ? { tag } : {}),
      ...(pid ? { pid } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    };
    return nextPreset;
  };

  const saveBugreportPreset = (nameInput: string) => {
    const name = nameInput.trim();
    if (!name) {
      pushToast("Preset name is required.", "error");
      return false;
    }
    if (bugreportPresets.some((preset) => preset.name === name)) {
      pushToast("Preset name already exists. Use Update to overwrite.", "error");
      return false;
    }

    const nextPreset = buildBugreportPresetFromCurrent(name);
    if (!nextPreset) {
      return false;
    }

    setBugreportPresets((prev) => [...prev.filter((preset) => preset.name !== name), nextPreset]);
    setBugreportPresetName("");
    setBugreportPresetSelected(name);
    pushToast("Bugreport preset saved.", "info");
    return true;
  };

  const updateBugreportPreset = (name: string) => {
    const target = name.trim();
    if (!target) {
      pushToast("Select a preset to update.", "error");
      return false;
    }
    if (!bugreportPresets.some((preset) => preset.name === target)) {
      pushToast("Preset does not exist.", "error");
      return false;
    }
    const nextPreset = buildBugreportPresetFromCurrent(target);
    if (!nextPreset) {
      return false;
    }

    setBugreportPresets((prev) => [...prev.filter((preset) => preset.name !== target), nextPreset]);
    setBugreportPresetName(target);
    setBugreportPresetSelected(target);
    pushToast("Bugreport preset updated.", "info");
    return true;
  };

  const applyBugreportPreset = (name: string) => {
    const preset = bugreportPresets.find((item) => item.name === name);
    if (!preset) {
      return;
    }

    const invalidPatterns: string[] = [];
    let nextChips: LogTextChip[] = [];
    preset.include.forEach((pattern) => {
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern, "i");
        nextChips = addLogTextChip(nextChips, "include", pattern);
      } catch {
        invalidPatterns.push(pattern);
      }
    });
    preset.exclude.forEach((pattern) => {
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern, "i");
        nextChips = addLogTextChip(nextChips, "exclude", pattern);
      } catch {
        invalidPatterns.push(pattern);
      }
    });

    if (invalidPatterns.length > 0) {
      pushToast("Some preset patterns were invalid and were ignored.", "error");
    }

    setSharedLogTextChips(nextChips);
    if (preset.levels) {
      setLogLevels(preset.levels);
    }
    setBugreportLogBuffer(preset.buffer ?? "");
    setBugreportLogTag(preset.tag ?? "");
    setBugreportLogPid(preset.pid ?? "");
    setBugreportLogStart(preset.start ?? "");
    setBugreportLogEnd(preset.end ?? "");
    setBugreportLogLiveFilter("");
  };

  const deleteBugreportPreset = (name: string) => {
    const target = name.trim();
    if (!target) {
      pushToast("Select a preset to delete.", "error");
      return false;
    }
    if (!bugreportPresets.some((preset) => preset.name === target)) {
      pushToast("Preset does not exist.", "error");
      return false;
    }
    setBugreportPresets((prev) => prev.filter((item) => item.name !== target));
    if (bugreportPresetSelected === target) {
      setBugreportPresetSelected("");
    }
    if (bugreportPresetName.trim() === target) {
      setBugreportPresetName("");
    }
    pushToast("Bugreport preset deleted.", "info");
    return true;
  };

  const buildCustomViewFromEditor = (forUpdateId?: string): BugreportCustomViewTemplate | null => {
    const group = bugreportCustomViewEditor.group.trim() || DEFAULT_BUGREPORT_CUSTOM_VIEW_GROUP;
    const name = bugreportCustomViewEditor.name.trim();
    if (!name) {
      pushToast("Custom view name is required.", "error");
      return null;
    }
    if (hasBugreportCustomViewNameConflict(bugreportCustomViews, group, name, forUpdateId)) {
      pushToast("A custom view with the same group and name already exists.", "error");
      return null;
    }

    const defaultInput = bugreportCustomViewEditor.defaultInput.trim();

    return {
      id: makeBugreportCustomViewId(group, name),
      group,
      name,
      template_kind: bugreportCustomViewEditor.templateKind,
      ...(defaultInput ? { default_input: defaultInput } : {}),
    };
  };

  const resolveOverlayRegexFromPreset = (
    presetName: string | null,
  ): { overlayPresetName: string | null; includeRegex: string[]; excludeRegex: string[] } => {
    const target = presetName?.trim() ?? "";
    if (!target) {
      return { overlayPresetName: null, includeRegex: [], excludeRegex: [] };
    }
    const preset = bugreportPresets.find((item) => item.name === target);
    if (!preset) {
      return { overlayPresetName: null, includeRegex: [], excludeRegex: [] };
    }
    const includeRegex = normalizeBugreportRegexPatterns(preset.include ?? []);
    const excludeRegex = normalizeBugreportRegexPatterns(preset.exclude ?? []);
    if (
      includeRegex.length !== (preset.include ?? []).length ||
      excludeRegex.length !== (preset.exclude ?? []).length
    ) {
      pushToast("Overlay preset includes invalid regex patterns. Invalid items were ignored.", "error");
    }
    return {
      overlayPresetName: preset.name,
      includeRegex,
      excludeRegex,
    };
  };

  const executeBugreportCustomView = async (
    template: BugreportCustomViewTemplate,
    inputValue: string,
    overlayPresetName: string | null,
    options: { navigateToLogViewer?: boolean; successToast?: boolean } = {},
  ) => {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput) {
      pushToast("Input is required to run custom view extraction.", "error");
      return;
    }
    const reportId = bugreportExtractSummary?.report_id ?? bugreportLogSummary?.report_id;
    if (!reportId) {
      pushToast("Load a bugreport and prepare extract index first.", "error");
      return;
    }

    const overlay = resolveOverlayRegexFromPreset(overlayPresetName);
    setBugreportCustomViewRunBusy(true);
    setBugreportLogError(null);
    try {
      const response = await queryBugreportExtract(reportId, {
        kind: template.template_kind,
        input: trimmedInput,
        limit: 24,
        include_regex: overlay.includeRegex,
        exclude_regex: overlay.excludeRegex,
      });
      const result = response.data;
      setActiveBugreportCustomViewSession({
        template_id: template.id,
        input_value: trimmedInput,
        overlay_preset_name: overlay.overlayPresetName,
        report_id: reportId,
        result_snapshot: result,
      });
      if (options.navigateToLogViewer) {
        navigate("/bugreport-logviewer");
      }
      if (options.successToast !== false) {
        if (result.matches.length > 0) {
          pushToast(`Custom view returned ${result.matches.length} section match(es).`, "info");
        } else {
          pushToast("No extract results for this input.", "info");
        }
      }
    } catch (error) {
      const message = formatError(error);
      setBugreportLogError(message);
      pushToast(message, "error");
    } finally {
      setBugreportCustomViewRunBusy(false);
    }
  };

  const saveBugreportCustomView = () => {
    const nextView = buildCustomViewFromEditor();
    if (!nextView) {
      return false;
    }
    setBugreportCustomViews((prev) => [...prev.filter((item) => item.id !== nextView.id), nextView]);
    setBugreportCustomViewSelectedId(nextView.id);
    pushToast("Custom view saved.", "info");
    return true;
  };

  const updateBugreportCustomView = () => {
    const currentId = bugreportCustomViewEditor.id;
    if (!currentId) {
      pushToast("Select a custom view to update.", "error");
      return false;
    }
    const nextView = buildCustomViewFromEditor(currentId);
    if (!nextView) {
      return false;
    }
    setBugreportCustomViews((prev) => [
      ...prev.filter((item) => item.id !== currentId && item.id !== nextView.id),
      nextView,
    ]);
    setBugreportCustomViewSelectedId(nextView.id);
    const activeSession = activeBugreportCustomViewSession;
    if (activeSession?.template_id === currentId) {
      setActiveBugreportCustomViewSession((prev) =>
        prev ? { ...prev, template_id: nextView.id } : prev,
      );
      void executeBugreportCustomView(
        nextView,
        activeSession.input_value,
        activeSession.overlay_preset_name,
        { successToast: false },
      );
    }
    pushToast("Custom view updated.", "info");
    return true;
  };

  const deleteBugreportCustomView = () => {
    const currentId = bugreportCustomViewEditor.id;
    if (!currentId) {
      pushToast("Select a custom view to delete.", "error");
      return false;
    }
    setBugreportCustomViews((prev) => prev.filter((item) => item.id !== currentId));
    setBugreportCustomViewSelectedId("");
    setActiveBugreportCustomViewSession((prev) => (prev?.template_id === currentId ? null : prev));
    pushToast("Custom view deleted.", "info");
    return true;
  };

  const runBugreportCustomView = () => {
    const view = bugreportCustomViews.find((item) => item.id === bugreportCustomViewEditor.id) ?? null;
    if (!view) {
      pushToast("Select a custom view to run.", "error");
      return;
    }
    const fallbackInput = view.default_input?.trim() ?? "";
    const input = bugreportCustomViewRunInput.trim() || fallbackInput;
    void executeBugreportCustomView(view, input, null, {
      navigateToLogViewer: true,
      successToast: true,
    });
  };

  const clearActiveBugreportCustomView = () => {
    setActiveBugreportCustomViewSession(null);
  };

  const setActiveCustomViewOverlayPreset = (nextPresetName: string) => {
    const activeSession = activeBugreportCustomViewSession;
    if (!activeSession) {
      return;
    }
    const view = bugreportCustomViews.find((item) => item.id === activeSession.template_id);
    if (!view) {
      setActiveBugreportCustomViewSession(null);
      return;
    }
    void executeBugreportCustomView(view, activeSession.input_value, nextPresetName, {
      successToast: false,
    });
  };

  const presetContextLabel = (context: PresetContext) =>
    context === "logcat" ? "Logcat" : "Bugreport";

  const closePresetUpdateModal = () => setPresetUpdateModal(null);
  const closePresetDeleteModal = () => setPresetDeleteModal(null);

  const openPresetUpdateModal = (context: PresetContext, name: string) => {
    const target = name.trim();
    if (!target) {
      pushToast("Select a preset to update.", "error");
      return;
    }
    setPresetUpdateModal({ context, name: target });
  };

  const openPresetDeleteModal = (context: PresetContext, name: string) => {
    const target = name.trim();
    if (!target) {
      pushToast("Select a preset to delete.", "error");
      return;
    }
    setPresetDeleteModal({ context, name: target });
  };

  const handlePresetUpdateConfirm = () => {
    if (!presetUpdateModal) {
      return;
    }
    const ok =
      presetUpdateModal.context === "logcat"
        ? updateLogcatPreset(presetUpdateModal.name)
        : updateBugreportPreset(presetUpdateModal.name);
    if (ok) {
      closePresetUpdateModal();
    }
  };

  const handlePresetDeleteConfirm = () => {
    if (!presetDeleteModal) {
      return;
    }
    const ok =
      presetDeleteModal.context === "logcat"
        ? deleteLogcatPreset(presetDeleteModal.name)
        : deleteBugreportPreset(presetDeleteModal.name);
    if (ok) {
      closePresetDeleteModal();
    }
  };

  const refreshLogcatStatus = useCallback(
    async (serial: string, options: { silent?: boolean } = {}) => {
      setLogcatStatusLoadingBySerial((prev) => ({ ...prev, [serial]: true }));
      try {
        const device = devices.find((item) => item.summary.serial === serial) ?? null;
        const response =
          getDevicePlatform(device) === "ios"
            ? await getIosSyslogStatus(serial, { recordError: !options.silent })
            : await getLogcatStatus(serial, { recordError: !options.silent });
        setLogcatRunningBySerial((prev) => ({ ...prev, [serial]: response.data.running }));
        return response.data.running;
      } catch (error) {
        if (!options.silent) {
          pushToastRef.current(formatError(error), "error");
        }
        return null;
      } finally {
        setLogcatStatusLoadingBySerial((prev) => ({ ...prev, [serial]: false }));
      }
    },
    [devices],
  );

  const refreshScreenRecordStatuses = useCallback(
    async (serials: string[], options: { silent?: boolean } = {}) => {
      const targets = Array.from(new Set(serials)).filter(Boolean);
      if (!targets.length) {
        return;
      }
      setScreenRecordStatusLoadingBySerial((prev) => {
        const next = { ...prev };
        targets.forEach((serial) => {
          next[serial] = true;
        });
        return next;
      });
      try {
        const settled = await Promise.allSettled(
          targets.map((serial) => getScreenRecordStatus(serial, { recordError: !options.silent })),
        );
        const nextStatus: Record<string, ScreenRecordStatus> = {};
        let firstError: unknown = null;
        settled.forEach((result, index) => {
          const serial = targets[index];
          if (!serial) {
            return;
          }
          if (result.status === "fulfilled") {
            nextStatus[serial] = result.value.data;
          } else if (firstError == null) {
            firstError = result.reason;
          }
        });
        if (Object.keys(nextStatus).length > 0) {
          setScreenRecordStatusBySerial((prev) => ({ ...prev, ...nextStatus }));
        }
        if (firstError != null && !options.silent) {
          pushToastRef.current(formatError(firstError), "error");
        }
      } finally {
        setScreenRecordStatusLoadingBySerial((prev) => {
          const next = { ...prev };
          targets.forEach((serial) => {
            next[serial] = false;
          });
          return next;
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!isLogcatView || !activeSerial) {
      return;
    }
    void refreshLogcatStatus(activeSerial, { silent: true });
  }, [isLogcatView, activeSerial, refreshLogcatStatus]);

  useEffect(() => {
    if (!selectedSerials.length) {
      return;
    }
    void refreshScreenRecordStatuses(selectedSerials, { silent: true });
  }, [selectedSerials, refreshScreenRecordStatuses]);

  const screenRecordPollingSignature = useMemo(
    () =>
      selectedSerials
        .filter((serial) => screenRecordStatusBySerial[serial]?.running)
        .sort()
        .join("|"),
    [selectedSerials, screenRecordStatusBySerial],
  );

  useEffect(() => {
    if (!screenRecordPollingSignature) {
      return;
    }
    const serials = screenRecordPollingSignature.split("|").filter(Boolean);
    const timer = window.setInterval(() => {
      void refreshScreenRecordStatuses(serials, { silent: true });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [screenRecordPollingSignature, refreshScreenRecordStatuses]);

  useEffect(() => {
    const listRunningPerfSerials = (value: Record<string, PerfMonitorState>): string[] =>
      Object.entries(value)
        .filter(([, state]) => state.running)
        .map(([serial]) => serial);
    const listRunningNetProfilerSerials = (value: Record<string, NetProfilerState>): string[] =>
      Object.entries(value)
        .filter(([, state]) => state.running)
        .map(([serial]) => serial);
    const listConnectedTerminalSerials = (value: Record<string, TerminalDeviceState>): string[] =>
      Object.entries(value)
        .filter(([, state]) => state.connected)
        .map(([serial]) => serial);
    const collectTargetsFromState = () => ({
      logcat: getRunningLogcatSerials(logcatRunningBySerial),
      perf: listRunningPerfSerials(perfBySerial),
      netProfiler: listRunningNetProfilerSerials(netBySerial),
      terminal: listConnectedTerminalSerials(terminalBySerial),
      bluetooth: getRunningLogcatSerials(bluetoothMonitorRunningBySerial),
    });
    const collectTargetsFromRefs = () => ({
      logcat: getRunningLogcatSerials(logcatRunningBySerialRef.current),
      perf: listRunningPerfSerials(perfBySerialRef.current),
      netProfiler: listRunningNetProfilerSerials(netBySerialRef.current),
      terminal: listConnectedTerminalSerials(terminalBySerialRef.current),
      bluetooth: getRunningLogcatSerials(bluetoothMonitorRunningBySerialRef.current),
    });
    const countTargets = (targets: {
      logcat: string[];
      perf: string[];
      netProfiler: string[];
      terminal: string[];
      bluetooth: string[];
    }): number =>
      targets.logcat.length +
      targets.perf.length +
      targets.netProfiler.length +
      targets.terminal.length +
      targets.bluetooth.length;
    const classifyStopError = (error: unknown): "stopped" | "failed" => {
      const message = formatError(error).toLowerCase();
      if (
        message.includes("not running") ||
        message.includes("already stopped") ||
        message.includes("session not running")
      ) {
        return "stopped";
      }
      return "failed";
    };

    const activeTargets = collectTargetsFromState();
    if (countTargets(activeTargets) === 0) {
      if (monitoringIdleTimerRef.current != null) {
        window.clearTimeout(monitoringIdleTimerRef.current);
        monitoringIdleTimerRef.current = null;
      }
      monitoringIdleStoppingRef.current = false;
      monitoringIdleLastActivityAtRef.current = Date.now();
      return;
    }

    const clearIdleTimer = () => {
      if (monitoringIdleTimerRef.current != null) {
        window.clearTimeout(monitoringIdleTimerRef.current);
        monitoringIdleTimerRef.current = null;
      }
    };

    const scheduleIdleCheck = () => {
      clearIdleTimer();
      const now = Date.now();
      const lastActivityAt = normalizeLogcatLastActivityAt(
        monitoringIdleLastActivityAtRef.current,
        now,
      );
      monitoringIdleLastActivityAtRef.current = lastActivityAt;
      const remainingMs = Math.max(
        0,
        LOGCAT_INACTIVITY_TIMEOUT_MS - (now - lastActivityAt),
      );
      monitoringIdleTimerRef.current = window.setTimeout(() => {
        monitoringIdleTimerRef.current = null;
        const timedOut = hasLogcatInactivityTimedOut(
          monitoringIdleLastActivityAtRef.current,
          Date.now(),
        );
        if (!timedOut) {
          scheduleIdleCheck();
          return;
        }
        void stopRunningMonitoringForInactivity();
      }, remainingMs);
    };

    const stopRunningMonitoringForInactivity = async () => {
      if (monitoringIdleStoppingRef.current) {
        return;
      }
      const targets = collectTargetsFromRefs();
      const targetCount = countTargets(targets);
      if (targetCount === 0) {
        return;
      }

      monitoringIdleStoppingRef.current = true;
      pushToastRef.current(
        "No activity detected for 2 minutes. Stopping active monitoring sessions.",
        "info",
      );

      const stopBatch = async (
        serials: string[],
        action: (serial: string) => Promise<unknown>,
      ): Promise<{ succeeded: string[]; failed: string[] }> => {
        if (!serials.length) {
          return { succeeded: [], failed: [] };
        }
        const settled = await Promise.allSettled(serials.map((serial) => action(serial)));
        const succeeded: string[] = [];
        const failed: string[] = [];
        settled.forEach((result, index) => {
          const serial = serials[index];
          if (!serial) {
            return;
          }
          if (result.status === "fulfilled") {
            succeeded.push(serial);
            return;
          }
          if (classifyStopError(result.reason) === "stopped") {
            succeeded.push(serial);
            return;
          }
          failed.push(serial);
        });
        return { succeeded, failed };
      };

      const logTargets = splitDeviceSerialsByPlatform(devicesRef.current, targets.logcat);
      const [androidLogResult, iosLogResult, perfResult, netProfilerResult, terminalResult, bluetoothResult] =
        await Promise.all([
          stopBatch(logTargets.android, stopLogcat),
          stopBatch(logTargets.ios, stopIosSyslog),
          stopBatch(targets.perf, stopPerfMonitor),
          stopBatch(targets.netProfiler, stopNetProfiler),
          stopBatch(targets.terminal, stopTerminalSession),
          stopBatch(targets.bluetooth, stopBluetoothMonitor),
        ]);
      const logcatResult = {
        succeeded: [...androidLogResult.succeeded, ...iosLogResult.succeeded],
        failed: [...androidLogResult.failed, ...iosLogResult.failed],
      };

      if (logcatResult.succeeded.length) {
        setLogcatRunningBySerial((prev) => {
          const next = { ...prev };
          logcatResult.succeeded.forEach((serial) => {
            next[serial] = false;
          });
          return next;
        });
        const nextRunningBySerial = { ...logcatRunningBySerialRef.current };
        logcatResult.succeeded.forEach((serial) => {
          nextRunningBySerial[serial] = false;
        });
        logcatRunningBySerialRef.current = nextRunningBySerial;
        logcatResult.succeeded.forEach((serial) => {
          void refreshLogcatStatus(serial, { silent: true });
        });
      }

      if (perfResult.succeeded.length) {
        setPerfBySerial((prev) => {
          const next = { ...prev };
          perfResult.succeeded.forEach((serial) => {
            const existing = next[serial];
            if (!existing) {
              return;
            }
            next[serial] = { ...existing, running: false };
          });
          return next;
        });
      }

      if (netProfilerResult.succeeded.length) {
        setNetBySerial((prev) => {
          const next = { ...prev };
          netProfilerResult.succeeded.forEach((serial) => {
            const existing = next[serial];
            if (!existing) {
              return;
            }
            next[serial] = { ...existing, running: false };
          });
          return next;
        });
      }

      if (terminalResult.succeeded.length) {
        setTerminalBySerial((prev) => {
          const next = { ...prev };
          terminalResult.succeeded.forEach((serial) => {
            const existing = next[serial];
            if (!existing) {
              return;
            }
            next[serial] = { ...existing, connected: false, sessionId: null };
          });
          return next;
        });
        const nextTerminalSessions = { ...terminalSessionIdBySerialRef.current };
        terminalResult.succeeded.forEach((serial) => {
          nextTerminalSessions[serial] = null;
        });
        terminalSessionIdBySerialRef.current = nextTerminalSessions;
      }

      if (bluetoothResult.succeeded.length) {
        setBluetoothMonitorRunningBySerial((prev) => {
          const next = { ...prev };
          bluetoothResult.succeeded.forEach((serial) => {
            next[serial] = false;
          });
          return next;
        });
        const nextBluetoothRunning = { ...bluetoothMonitorRunningBySerialRef.current };
        bluetoothResult.succeeded.forEach((serial) => {
          nextBluetoothRunning[serial] = false;
        });
        bluetoothMonitorRunningBySerialRef.current = nextBluetoothRunning;
      }

      const succeededCount =
        logcatResult.succeeded.length +
        perfResult.succeeded.length +
        netProfilerResult.succeeded.length +
        terminalResult.succeeded.length +
        bluetoothResult.succeeded.length;
      const failedCount =
        logcatResult.failed.length +
        perfResult.failed.length +
        netProfilerResult.failed.length +
        terminalResult.failed.length +
        bluetoothResult.failed.length;

      if (!failedCount) {
        pushToastRef.current(
          succeededCount > 1
            ? `Stopped ${succeededCount} sessions due to inactivity.`
            : "Stopped 1 session due to inactivity.",
          "info",
        );
      } else {
        pushToastRef.current(
          `Inactivity stop completed with ${failedCount} failure${failedCount > 1 ? "s" : ""}.`,
          "error",
        );
      }

      monitoringIdleStoppingRef.current = false;
      monitoringIdleLastActivityAtRef.current = Date.now();
      if (failedCount) {
        scheduleIdleCheck();
      }
    };

    const handleUserActivity = () => {
      monitoringIdleLastActivityAtRef.current = Date.now();
      if (!monitoringIdleStoppingRef.current) {
        scheduleIdleCheck();
      }
    };

    scheduleIdleCheck();
    LOGCAT_INACTIVITY_EVENTS.forEach((eventName) => {
      if (eventName === "wheel" || eventName === "touchstart") {
        window.addEventListener(eventName, handleUserActivity, { passive: true });
        return;
      }
      window.addEventListener(eventName, handleUserActivity);
    });

    return () => {
      LOGCAT_INACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleUserActivity);
      });
      clearIdleTimer();
    };
  }, [monitoringWatchSignature, refreshLogcatStatus]);

  const handleLogcatStart = async () => {
    const serial = ensureSingleSelection("logcat");
    if (!serial) {
      return;
    }
    if (logcatRunningBySerial[serial]) {
      pushToast("Logs are already running.", "info");
      return;
    }
    const targetDevice = devices.find((device) => device.summary.serial === serial) ?? null;
    const isIosTarget = getDevicePlatform(targetDevice) === "ios";
    const sourceValue = logcatSourceValue.trim();
    let filter = "";
    if (isIosTarget) {
      if (!hasDeviceCapability(targetDevice, "logs")) {
        pushToast(
          "iOS syslog requires idevicesyslog. Open Settings → iOS Tools and install libimobiledevice.",
          "error",
        );
        return;
      }
      filter = "";
    } else if (logcatSourceMode === "package") {
      if (!sourceValue) {
        pushToast("Package name is required for package mode.", "error");
        return;
      }
      try {
        const response = await runShell([serial], `pidof ${sourceValue}`, false);
        const stdout = response.data?.[0]?.stdout ?? "";
        const pids = parsePidOutput(stdout);
        if (!pids.length) {
          pushToast(`No running process for ${sourceValue}.`, "error");
          return;
        }
        filter = buildLogcatFilter({
          sourceMode: "package",
          sourceValue,
          pids,
        });
      } catch (error) {
        pushToast(formatError(error), "error");
        return;
      }
    } else {
      filter = buildLogcatFilter({
        sourceMode: logcatSourceMode,
        sourceValue,
      });
    }

    setBusy(true);
    try {
      if (isIosTarget) {
        await startIosSyslog(serial);
      } else {
        await startLogcat(serial, filter || undefined);
      }
      setLogcatRunningBySerial((prev) => ({ ...prev, [serial]: true }));
      void refreshLogcatStatus(serial, { silent: true });
      setLogcatActiveFilterSummary(filter || "All");
      pushToast(isIosTarget ? "iOS syslog started." : "Logcat started.", "info");
    } catch (error) {
      const message = formatError(error);
      if (message.toLowerCase().includes("already running")) {
        setLogcatRunningBySerial((prev) => ({ ...prev, [serial]: true }));
        pushToast("Logs are already running.", "info");
      } else {
        pushToast(message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatStop = async () => {
    const serial = ensureSingleSelection("logcat");
    if (!serial) {
      return;
    }
    if (!logcatRunningBySerial[serial]) {
      pushToast("Logs are already stopped.", "info");
      return;
    }
    const targetDevice = devices.find((device) => device.summary.serial === serial) ?? null;
    const isIosTarget = getDevicePlatform(targetDevice) === "ios";
    setBusy(true);
    try {
      if (isIosTarget) {
        await stopIosSyslog(serial);
      } else {
        await stopLogcat(serial);
      }
      setLogcatRunningBySerial((prev) => ({ ...prev, [serial]: false }));
      void refreshLogcatStatus(serial, { silent: true });
      pushToast(isIosTarget ? "iOS syslog stopped." : "Logcat stopped.", "info");
    } catch (error) {
      const message = formatError(error);
      if (message.toLowerCase().includes("not running")) {
        setLogcatRunningBySerial((prev) => ({ ...prev, [serial]: false }));
        pushToast("Logs are already stopped.", "info");
      } else {
        pushToast(message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const clearLogcatLocalCache = (serial: string) => {
    setLogcatLines((prev) => ({ ...prev, [serial]: [] }));
    setLogcatRetainedBySerial((prev) => ({ ...prev, [serial]: [] }));
  };

  const closeLogcatClearBufferModal = () => setLogcatClearBufferModal(null);

  // Escape-to-close for the confirmation/danger modals (composes with their backdrop-click close).
  useEscapeToClose(appActionConfirm !== null, () => setAppActionConfirm(null));
  useEscapeToClose(rebootConfirmOpen, closeRebootConfirm);
  useEscapeToClose(logcatClearBufferModal !== null, closeLogcatClearBufferModal);

  const handleLogcatClearBuffer = () => {
    const serial = ensureSingleSelection("logcat");
    if (!serial) {
      return;
    }
    setLogcatClearBufferModal({ serial });
  };

  const handleLogcatClearBufferConfirm = async () => {
    if (!logcatClearBufferModal) {
      return;
    }
    const serial = logcatClearBufferModal.serial;
    const targetDevice = devices.find((device) => device.summary.serial === serial) ?? null;
    if (getDevicePlatform(targetDevice) === "ios") {
      clearLogcatLocalCache(serial);
      pushToast("iOS syslog view cleared.", "info");
      closeLogcatClearBufferModal();
      return;
    }
    setBusy(true);
    try {
      await clearLogcat(serial);
      clearLogcatLocalCache(serial);
      pushToast("Logcat buffer cleared.", "info");
      closeLogcatClearBufferModal();
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatClearView = () => {
    const serial = ensureSingleSelection("logcat");
    if (!serial) {
      return;
    }
    clearLogcatLocalCache(serial);
  };

  const handleLogcatExport = async () => {
    const serial = ensureSingleSelection("logcat export");
    if (!serial) {
      return;
    }
    if (!logcatFiltered.lines.length) {
      pushToast("No logcat lines to export.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await exportLogcat(
        serial,
        logcatFiltered.lines.map((entry) => entry.text),
        config?.file_gen_output_path || config?.output_path,
      );
      setLogcatLastExport(response.data.output_path);
      pushToast("Logcat exported.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatMirrorLaunch = async () => {
    const serial = ensureSingleSelection("scrcpy mirror");
    if (!serial) {
      return;
    }
    setBusy(true);
    try {
      await launchScrcpy([serial]);
      pushToast(`Launched scrcpy mirror for ${serial}.`, "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatToggleSyncedRecording = async () => {
    const serial = ensureSingleSelection("synced screen recording");
    if (!serial) {
      return;
    }
    const isRunning = screenRecordStatusBySerial[serial]?.running === true;
    setBusy(true);
    try {
      if (!isRunning) {
        const startResponse = await startScreenRecord(serial);
        setScreenRecordStatusBySerial((prev) => ({
          ...prev,
          [serial]: {
            serial,
            running: true,
            backend: startResponse.data.backend,
            display_path: startResponse.data.display_path,
            segment_count: 1,
          },
        }));
        const session = createLogcatRecordingSyncSession(serial, rawLogcatLines);
        setLogcatSyncSessionBySerial((prev) => ({ ...prev, [serial]: session }));
        pushToast(`Recording started with logcat sync for ${serial}.`, "info");
      } else {
        const stopResponse = await stopScreenRecord(serial);
        setScreenRecordStatusBySerial((prev) => ({
          ...prev,
          [serial]: {
            serial,
            running: false,
            backend: stopResponse.data.backend,
            display_path: stopResponse.data.output_path,
            segment_count: stopResponse.data.segment_count,
          },
        }));
        setLogcatSyncSessionBySerial((prev) => {
          const existing = prev[serial];
          if (!existing) {
            return prev;
          }
          return {
            ...prev,
            [serial]: finalizeLogcatRecordingSyncSession(existing, rawLogcatLines),
          };
        });
        pushToast(
          `Recording stopped (${stopResponse.data.output_path}). Ready to export synced logcat slice.`,
          "info",
        );
      }
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleExportSyncedLogcatSlice = async () => {
    const serial = ensureSingleSelection("synced logcat export");
    if (!serial) {
      return;
    }
    const session = logcatSyncSessionBySerial[serial];
    if (!session) {
      pushToast("No synced recording session recorded for this device.", "error");
      return;
    }
    const sliced = sliceLogcatLinesForRecording(rawLogcatLines, session);
    if (!sliced.length) {
      pushToast("No logcat lines captured during that recording window.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await exportLogcat(
        serial,
        sliced,
        config?.file_gen_output_path || config?.output_path,
      );
      setLogcatLastExport(response.data.output_path);
      pushToast(`Exported ${sliced.length} synced logcat lines.`, "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const openOrFocusLogcatPopupWindow = async (serial: string): Promise<"opened" | "focused"> => {
    const popupLabel = buildLogcatPopupWindowLabel(serial);
    const popupHash = buildLogcatPopupHash(serial);
    const existing = await WebviewWindow.getByLabel(popupLabel);
    if (existing) {
      await existing.show();
      await existing.unminimize();
      await existing.setFocus();
      return "focused";
    }

    const popupWindow = new WebviewWindow(popupLabel, {
      title: `Logcat · ${serial}`,
      url: popupHash,
      width: 1120,
      height: 720,
      minWidth: 900,
      minHeight: 560,
      focus: true,
    });
    void popupWindow.once("tauri://error", (event) => {
      const message =
        typeof event.payload === "string" && event.payload.trim()
          ? event.payload
          : "Unable to open popup window.";
      pushToast(message, "error");
    });
    return "opened";
  };

  const openBugreportPopupWindow = async (): Promise<void> => {
    const popupSeed = `instance-${Date.now()}-${bugreportPopupInstanceCounterRef.current + 1}`;
    bugreportPopupInstanceCounterRef.current += 1;
    const popupLabel = buildBugreportPopupWindowLabel(popupSeed);
    const popupHash = buildBugreportPopupHash();
    const popupWindow = new WebviewWindow(popupLabel, {
      title: "Bugreport Logs",
      url: popupHash,
      width: 1120,
      height: 720,
      minWidth: 900,
      minHeight: 560,
      focus: true,
    });
    void popupWindow.once("tauri://error", (event) => {
      const message =
        typeof event.payload === "string" && event.payload.trim()
          ? event.payload
          : "Unable to open popup window.";
      pushToast(message, "error");
    });
  };

  const handleOpenBugreportLogPopup = async () => {
    try {
      if (!isTauriRuntime()) {
        const popup = window.open(
          buildBugreportPopupHash(),
          "_blank",
          "noopener,noreferrer",
        );
        if (!popup) {
          pushToast("Unable to open popup window.", "error");
          return;
        }
        return;
      }
      await openBugreportPopupWindow();
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const closeLogcatPopupSelectorModal = () => setLogcatPopupSelectorOpen(false);

  const openLogcatPopupSelectorModal = () => {
    if (!logcatPopupCandidates.length) {
      pushToast("No devices available.", "error");
      return;
    }
    const defaults = logcatPopupCandidates
      .filter((candidate) => candidate.defaultSelected)
      .map((candidate) => candidate.serial);
    setLogcatPopupDraftSerials(defaults);
    setLogcatPopupSelectorOpen(true);
  };

  const toggleLogcatPopupDraftSerial = (serial: string) => {
    setLogcatPopupDraftSerials((prev) => {
      const next = new Set(prev);
      if (next.has(serial)) {
        next.delete(serial);
      } else {
        next.add(serial);
      }
      return Array.from(next);
    });
  };

  const selectAllLogcatPopupDraftSerials = () => {
    setLogcatPopupDraftSerials(logcatPopupSelectableSerials);
  };

  const clearLogcatPopupDraftSerials = () => {
    setLogcatPopupDraftSerials([]);
  };

  const openLogcatPopupsForSerials = async (serials: string[]): Promise<boolean> => {
    const uniqueSerials = Array.from(new Set(serials.map((serial) => serial.trim()).filter(Boolean)));
    const { openable, skipped } = partitionLogcatPopupTargets(uniqueSerials, devices);
    if (uniqueSerials.length === 0) {
      pushToast("Select at least one device.", "error");
      return false;
    }
    if (!openable.length) {
      pushToast("No online devices in current selection.", "error");
      return false;
    }
    if (
      openable.length > 8 &&
      !window.confirm(`Open ${openable.length} popup windows for selected devices?`)
    ) {
      return false;
    }

    let opened = 0;
    let focused = 0;
    let failed = 0;

    if (!isTauriRuntime()) {
      openable.forEach((serial) => {
        const popup = window.open(buildLogcatPopupHash(serial), "_blank", "noopener,noreferrer");
        if (popup) {
          opened += 1;
        } else {
          failed += 1;
        }
      });
    } else {
      const results = await Promise.allSettled(
        openable.map(async (serial) => openOrFocusLogcatPopupWindow(serial)),
      );
      results.forEach((result) => {
        if (result.status === "rejected") {
          failed += 1;
          return;
        }
        if (result.value === "focused") {
          focused += 1;
          return;
        }
        opened += 1;
      });
    }

    const summary = [
      opened > 0 ? `${opened} opened` : null,
      focused > 0 ? `${focused} focused` : null,
      skipped.length > 0 ? `${skipped.length} skipped offline` : null,
    ]
      .filter(Boolean)
      .join(", ");
    if (summary) {
      pushToast(`Popups: ${summary}.`, "info");
    }
    if (failed > 0) {
      pushToast(`${failed} popup window${failed > 1 ? "s" : ""} failed to open.`, "error");
    }
    return true;
  };

  const handleLogcatPopupSelectorConfirm = async () => {
    const didOpen = await openLogcatPopupsForSerials(logcatPopupDraftSerials);
    if (didOpen) {
      closeLogcatPopupSelectorModal();
    }
  };

  const handlePerfStart = async () => {
    const serial = ensureSingleSelection("performance");
    if (!serial) {
      return;
    }
    if (perfBySerialRef.current[serial]?.running) {
      pushToast("Performance monitor already running.", "info");
      return;
    }
    setBusy(true);
    try {
      const response = await startPerfMonitor(serial, 1000);
      setPerfBySerial((prev) => {
        const existing =
          prev[serial] ??
          ({
            running: false,
            traceId: null,
            samples: [],
            lastError: null,
          } satisfies PerfMonitorState);
        return {
          ...prev,
          [serial]: {
            ...existing,
            running: true,
            traceId: response.trace_id,
            lastError: null,
          },
        };
      });
      pushToast("Performance monitor started.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handlePerfStop = async () => {
    const serial = ensureSingleSelection("performance");
    if (!serial) {
      return;
    }
    if (!perfBySerialRef.current[serial]?.running) {
      pushToast("Performance monitor is not running.", "info");
      return;
    }
    setBusy(true);
    try {
      await stopPerfMonitor(serial);
      setPerfBySerial((prev) => {
        const existing = prev[serial];
        if (!existing) {
          return prev;
        }
        return {
          ...prev,
          [serial]: {
            ...existing,
            running: false,
          },
        };
      });
      pushToast("Performance monitor stopped.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleNetProfilerStart = async () => {
    const serial = ensureSingleSelection("network profiler");
    if (!serial) {
      return;
    }
    if (netBySerialRef.current[serial]?.running) {
      pushToast("Network profiler already running.", "info");
      return;
    }
    setBusy(true);
    try {
      const pinnedUidsRaw = netProfilerPinnedUidsBySerial[serial] ?? [];
      const pinnedUids = pinnedUidsRaw.length ? pinnedUidsRaw : undefined;
      const response = await startNetProfiler(serial, netProfilerIntervalMs, netProfilerTopN, pinnedUids);
      setNetBySerial((prev) => {
        const existing =
          prev[serial] ??
          ({
            running: false,
            traceId: null,
            samples: [],
            lastError: null,
          } satisfies NetProfilerState);
        return {
          ...prev,
          [serial]: {
            ...existing,
            running: true,
            traceId: response.trace_id,
            samples: [],
            lastError: null,
          },
        };
      });
      pushToast("Network profiler started.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleNetProfilerStop = async () => {
    const serial = ensureSingleSelection("network profiler");
    if (!serial) {
      return;
    }
    if (!netBySerialRef.current[serial]?.running) {
      pushToast("Network profiler is not running.", "info");
      return;
    }
    setBusy(true);
    try {
      await stopNetProfiler(serial);
      setNetBySerial((prev) => {
        const existing = prev[serial];
        if (!existing) {
          return prev;
        }
        return {
          ...prev,
          [serial]: {
            ...existing,
            running: false,
          },
        };
      });
      pushToast("Network profiler stopped.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const scrollToLogcatMatch = (index: number) => {
    const container = logcatOutputRef.current;
    if (!container) {
      return;
    }
    const matchId = logcatFiltered.matchIds[index];
    if (matchId == null) {
      return;
    }
    const matchIndex = logcatLineIndexById.get(matchId);
    if (matchIndex == null) {
      return;
    }
    const target = matchIndex * LOGCAT_LINE_HEIGHT_PX;
    const offset = Math.max(
      0,
      target - container.clientHeight / 2 + LOGCAT_OUTPUT_PADDING_PX,
    );
    container.scrollTop = offset;
  };

  const handleLogcatNextMatch = () => {
    if (!logcatFiltered.matchIds.length) {
      return;
    }
    const nextIndex = (logcatMatchIndex + 1) % logcatFiltered.matchIds.length;
    setLogcatMatchIndex(nextIndex);
    scrollToLogcatMatch(nextIndex);
  };

  const handleLogcatPrevMatch = () => {
    if (!logcatFiltered.matchIds.length) {
      return;
    }
    const prevIndex =
      (logcatMatchIndex - 1 + logcatFiltered.matchIds.length) % logcatFiltered.matchIds.length;
    setLogcatMatchIndex(prevIndex);
    scrollToLogcatMatch(prevIndex);
  };

  const basenameFromHostPath = (value: string) => {
    const normalized = value.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "upload";
  };

  const normalizeDeviceDir = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed === "/") {
      return "/";
    }
    return trimmed.replace(/\/+$/g, "");
  };

  const deviceJoin = (dir: string, name: string) => {
    const base = normalizeDeviceDir(dir);
    if (!base) {
      return `/${name}`;
    }
    if (base === "/") {
      return `/${name}`;
    }
    return `${base}/${name}`;
  };

  const deviceParentDir = (value: string) => {
    const trimmed = normalizeDeviceDir(value);
    if (!trimmed || trimmed === "/") {
      return "/";
    }
    const lastSlash = trimmed.lastIndexOf("/");
    if (lastSlash <= 0) {
      return "/";
    }
    return trimmed.slice(0, lastSlash) || "/";
  };

  const refreshFilesList = async (targetPath: string) => {
    if (!activeSerial) {
      return;
    }
    const trimmed = targetPath.trim();
    if (!trimmed || !trimmed.startsWith("/")) {
      return;
    }
    try {
      const response = await listDeviceFiles(activeSerial, trimmed);
      setFilesPath(trimmed);
      setFiles(response.data);
      setFilePreview(null);
      setFilePreviewDevicePath(null);
      setFilesSelectedPaths([]);
    } catch (error) {
      pushToast(`Refresh failed: ${formatError(error)}`, "error");
    }
  };

  const handleFilesRefresh = async (pathOverride?: string) => {
    const serial = ensureSingleSelection("file browse");
    if (!serial) {
      return;
    }
    const targetPath = (pathOverride ?? filesPath).trim();
    if (!targetPath.startsWith("/")) {
      pushToast("Device path must start with '/'.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await listDeviceFiles(serial, targetPath);
      setFilesPath(targetPath);
      setFiles(response.data);
      setFilePreview(null);
      setFilePreviewDevicePath(null);
      setFilesSelectedPaths([]);
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFilesGoUp = async () => {
    await handleFilesRefresh(deviceParentDir(filesPath));
  };

  const fileBreadcrumbs = useMemo(() => {
    const normalized = normalizeDeviceDir(filesPath);
    if (!normalized || normalized === "/") {
      return [{ label: "/", path: "/" }];
    }
    const parts = normalized.split("/").filter(Boolean);
    const crumbs = [{ label: "/", path: "/" }];
    let current = "";
    parts.forEach((part) => {
      current = `${current}/${part}`;
      crumbs.push({ label: part, path: current });
    });
    return crumbs;
  }, [filesPath]);

  const filteredFiles = useMemo(() => {
    const query = filesSearchQuery.trim().toLowerCase();
    if (!query) {
      return files;
    }
    return files.filter((entry) => {
      const name = entry.name.toLowerCase();
      const path = entry.path.toLowerCase();
      return name.includes(query) || path.includes(query);
    });
  }, [files, filesSearchQuery]);

  const filesPageSize = filesViewMode === "grid" ? FILES_GRID_PAGE_SIZE : FILES_LIST_PAGE_SIZE;
  useEffect(() => {
    setFilesVisibleCount(filesPageSize);
  }, [filesSearchQuery, filesPath, filesViewMode]);

  const visibleFiles = useMemo(() => {
    const count = Math.max(filesPageSize, filesVisibleCount);
    return filteredFiles.slice(0, count);
  }, [filteredFiles, filesPageSize, filesVisibleCount]);

  const canLoadMoreFiles = visibleFiles.length < filteredFiles.length;

  const filesListRef = useRef<HTMLDivElement | null>(null);
  const filesLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const filesLoadMoreLockedRef = useRef(false);
  const filesFilteredLenRef = useRef(0);
  const filesCanLoadMoreRef = useRef(false);
  useEffect(() => {
    filesFilteredLenRef.current = filteredFiles.length;
    filesCanLoadMoreRef.current = canLoadMoreFiles;
  }, [filteredFiles.length, canLoadMoreFiles]);

  const loadMoreFiles = () => {
    if (!filesCanLoadMoreRef.current) {
      return;
    }
    if (filesLoadMoreLockedRef.current) {
      return;
    }
    filesLoadMoreLockedRef.current = true;
    setFilesVisibleCount((prev) => {
      const next = Math.min(prev + filesPageSize, filesFilteredLenRef.current);
      return next;
    });
    window.requestAnimationFrame(() => {
      filesLoadMoreLockedRef.current = false;
    });
  };

  useEffect(() => {
    if (location.pathname !== "/files") {
      return;
    }
    if (!filesCanLoadMoreRef.current) {
      return;
    }
    const sentinel = filesLoadMoreSentinelRef.current;
    if (!sentinel) {
      return;
    }
    const root = filesListRef.current;
    const hasOverflow = root ? root.scrollHeight > root.clientHeight + 8 : false;
    const resolvedRoot = hasOverflow ? root : null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreFiles();
        }
      },
      { root: resolvedRoot, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [location.pathname, filesPath, filesSearchQuery, filesViewMode, filesVisibleCount]);

  const fileFilterSummary = filesSearchQuery.trim()
    ? `${filteredFiles.length} of ${files.length} items`
    : `${files.length} items`;

  const openFilesContextMenu = (event: React.MouseEvent, entry: DeviceFileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    setFilesSelectedPaths((prev) => (prev.includes(entry.path) ? prev : [entry.path]));
    setFilesContextMenu({ x: event.clientX, y: event.clientY, entry });
  };

  const openFilesMkdirModal = () => {
    setFilesModal({ type: "mkdir", name: "" });
  };

  const openFilesRenameModal = (entry: DeviceFileEntry) => {
    setFilesModal({ type: "rename", entry, newName: entry.name });
  };

  const openFilesDeleteModal = (entry: DeviceFileEntry) => {
    setFilesModal({ type: "delete", entry, recursive: false, confirm: "" });
  };

  const openFilesDeleteSelectedModal = () => {
    const selected = new Set(filesSelectedPaths);
    const entries = files.filter((entry) => selected.has(entry.path));
    if (!entries.length) {
      pushToast("Select files or folders to delete.", "error");
      return;
    }
    setFilesModal({ type: "delete_many", entries, recursive: false, confirm: "" });
  };

  const closeFilesModal = () => setFilesModal(null);

  const validateDeviceEntryName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Name is required.";
    }
    if (trimmed.includes("/")) {
      return "Name must not include '/'.";
    }
    if (trimmed === "." || trimmed === "..") {
      return "Name is invalid.";
    }
    return null;
  };

  const isFileSelected = (path: string) => filesSelectedPaths.includes(path);

  const toggleFileSelected = (path: string, selected: boolean) => {
    setFilesSelectedPaths((prev) => {
      if (selected) {
        return prev.includes(path) ? prev : [path, ...prev];
      }
      return prev.filter((item) => item !== path);
    });
  };

  const handleFilesPullSelected = async () => {
    const serial = ensureSingleSelection("file pull");
    if (!serial) {
      return;
    }
    const selected = new Set(filesSelectedPaths);
    const entries = files.filter((entry) => selected.has(entry.path));
    const filesOnly = entries.filter((entry) => !entry.is_dir);
    if (!filesOnly.length) {
      pushToast("Select files to pull.", "error");
      return;
    }

    let outputDir = config?.file_gen_output_path || config?.output_path || "";
    if (!outputDir) {
      const selectedDir = await openDialog({
        title: "Select output folder",
        directory: true,
        multiple: false,
      });
      if (!selectedDir || Array.isArray(selectedDir)) {
        return;
      }
      outputDir = selectedDir;
    }

    setBusy(true);
    try {
      for (const entry of filesOnly) {
        const taskId = beginTask({
          kind: "file_pull",
          title: `Pull File: ${entry.name}`,
          serials: [serial],
        });
        const traceId = crypto.randomUUID();
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
        fileTransferTaskByTraceIdRef.current[traceId] = taskId;
        try {
          const response = await pullDeviceFile(serial, entry.path, outputDir, traceId, {
            recordError: false,
          });
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: {
              status: "success",
              progress: 100,
              output_path: response.data,
              message: `Pulled to ${response.data}`,
            },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
        } catch (error) {
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: { status: "error", message: formatError(error), progress: null },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
        } finally {
          delete fileTransferTaskByTraceIdRef.current[traceId];
        }
      }
      pushToast("Pull completed.", "info");
    } finally {
      setBusy(false);
    }
  };

  const handleFilesMkdirSubmit = async () => {
    const serial = ensureSingleSelection("folder create");
    if (!serial) {
      return;
    }
    if (!filesModal || filesModal.type !== "mkdir") {
      return;
    }
    const error = validateDeviceEntryName(filesModal.name);
    if (error) {
      pushToast(error, "error");
      return;
    }
    const targetDir = deviceJoin(filesPath, filesModal.name.trim());
    const taskId = beginTask({
      kind: "file_mkdir",
      title: `New Folder: ${filesModal.name.trim()}`,
      serials: [serial],
    });
    setBusy(true);
    try {
      const response = await mkdirDeviceDir(serial, targetDir, undefined, { recordError: false });
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "success", message: `Created ${response.data}` },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
      pushToast(`Created ${response.data}`, "info");
      closeFilesModal();
      await refreshFilesList(filesPath);
    } catch (error) {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "error", message: formatError(error) },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFilesRenameSubmit = async () => {
    const serial = ensureSingleSelection("rename");
    if (!serial) {
      return;
    }
    if (!filesModal || filesModal.type !== "rename") {
      return;
    }
    const error = validateDeviceEntryName(filesModal.newName);
    if (error) {
      pushToast(error, "error");
      return;
    }
    const fromPath = filesModal.entry.path;
    const targetDir = deviceParentDir(fromPath);
    const toPath = deviceJoin(targetDir, filesModal.newName.trim());
    const taskId = beginTask({
      kind: "file_rename",
      title: `Rename: ${filesModal.entry.name}`,
      serials: [serial],
    });
    setBusy(true);
    try {
      const response = await renameDevicePath(serial, fromPath, toPath, undefined, { recordError: false });
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "success", message: `Renamed to ${response.data}` },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
      pushToast(`Renamed to ${response.data}`, "info");
      closeFilesModal();
      await refreshFilesList(filesPath);
    } catch (error) {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "error", message: formatError(error) },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFilesDeleteSubmit = async () => {
    const serial = ensureSingleSelection("delete");
    if (!serial) {
      return;
    }
    if (!filesModal || filesModal.type !== "delete") {
      return;
    }
    if (filesModal.confirm.trim() !== "DELETE") {
      pushToast("Type DELETE to confirm.", "error");
      return;
    }
    if (filesModal.entry.is_dir && !filesModal.recursive) {
      pushToast("Enable recursive delete for directories.", "error");
      return;
    }
    const taskId = beginTask({
      kind: "file_delete",
      title: `Delete: ${filesModal.entry.name}`,
      serials: [serial],
    });
    setBusy(true);
    try {
      const response = await deleteDevicePath(serial, filesModal.entry.path, filesModal.recursive, undefined, {
        recordError: false,
      });
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "success", message: `Deleted ${response.data}` },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
      pushToast(`Deleted ${response.data}`, "info");
      closeFilesModal();
      await refreshFilesList(filesPath);
    } catch (error) {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "error", message: formatError(error) },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFilesDeleteManySubmit = async () => {
    const serial = ensureSingleSelection("delete");
    if (!serial) {
      return;
    }
    if (!filesModal || filesModal.type !== "delete_many") {
      return;
    }
    if (filesModal.confirm.trim() !== "DELETE") {
      pushToast("Type DELETE to confirm.", "error");
      return;
    }
    const hasDirectory = filesModal.entries.some((entry) => entry.is_dir);
    if (hasDirectory && !filesModal.recursive) {
      pushToast("Enable recursive delete to delete directories.", "error");
      return;
    }

    setBusy(true);
    try {
      for (const entry of filesModal.entries) {
        const taskId = beginTask({
          kind: "file_delete",
          title: `Delete: ${entry.name}`,
          serials: [serial],
        });
        try {
          const response = await deleteDevicePath(serial, entry.path, filesModal.recursive, undefined, {
            recordError: false,
          });
          dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: { status: "success", message: `Deleted ${response.data}` },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
        } catch (error) {
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: { status: "error", message: formatError(error) },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
        }
      }
      closeFilesModal();
      await refreshFilesList(filesPath);
      pushToast("Delete completed.", "info");
    } finally {
      setBusy(false);
    }
  };

  const handleFileUpload = async () => {
    const serial = ensureSingleSelection("file upload");
    if (!serial) {
      return;
    }

    const selected = await openDialog({
      title: "Select file to upload",
      directory: false,
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }

    const filename = basenameFromHostPath(selected);
    const remotePath = deviceJoin(filesPath, filename);
    if (!filesOverwriteEnabled && files.some((entry) => entry.name === filename)) {
      pushToast(`Upload blocked: ${filename} already exists.`, "error");
      return;
    }
    const traceId = crypto.randomUUID();
    const taskId = beginTask({
      kind: "file_push",
      title: `Upload File: ${filename}`,
      serials: [serial],
    });
    dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
    fileTransferTaskByTraceIdRef.current[traceId] = taskId;
    setBusy(true);
    try {
      const response = await pushDeviceFile(serial, selected, remotePath, traceId, {
        recordError: false,
      });
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "success", progress: 100, message: `Uploaded to ${response.data}` },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
      pushToast(`Uploaded to ${response.data}`, "info");
      try {
        const listResponse = await listDeviceFiles(serial, filesPath.trim());
        setFiles(listResponse.data);
        setFilePreview(null);
      } catch (error) {
        pushToast(`Uploaded. Refresh failed: ${formatError(error)}`, "error");
      }
    } catch (error) {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "error", message: formatError(error), progress: null },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(formatError(error), "error");
    } finally {
      delete fileTransferTaskByTraceIdRef.current[traceId];
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const unlistenPromise = getCurrentWindow().onDragDropEvent((event) => {
      const filesCtx = filesDragContextRef.current;
      const apkCtx = apkDragContextRef.current;
      const payload = event.payload;
      const isFilesRoute = filesCtx.pathname === "/files";
      const isApkInstallerRoute = apkCtx.pathname === "/apk-installer";
      if (!isFilesRoute && !isApkInstallerRoute) {
        return;
      }
      if (payload.type === "enter" || payload.type === "over") {
        if (isFilesRoute) {
          setApkDropActive(false);
          setFilesDropActive(true);
        } else {
          setFilesDropActive(false);
          setApkDropActive(true);
        }
        return;
      }
      if (payload.type === "leave") {
        if (isFilesRoute) {
          setFilesDropActive(false);
        } else {
          setApkDropActive(false);
        }
        return;
      }
      if (payload.type !== "drop") {
        return;
      }

      if (isFilesRoute) {
        setFilesDropActive(false);
        if (!payload.paths.length) {
          return;
        }
        if (!filesCtx.serial) {
          pushToast("Select a device for file upload.", "error");
          return;
        }
        const existing = new Set(filesCtx.existingNames);
        const uploadDroppedFiles = async () => {
          setBusy(true);
          try {
            for (const path of payload.paths) {
              const filename = basenameFromHostPath(path);
              if (!filesCtx.overwrite && existing.has(filename)) {
                pushToast(`Upload blocked: ${filename} already exists.`, "error");
                continue;
              }
              const remotePath = deviceJoin(filesCtx.path, filename);
              const taskId = beginTask({
                kind: "file_push",
                title: `Upload File: ${filename}`,
                serials: [filesCtx.serial],
              });
              const traceId = crypto.randomUUID();
              dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
              fileTransferTaskByTraceIdRef.current[traceId] = taskId;
              try {
                const response = await pushDeviceFile(filesCtx.serial, path, remotePath, traceId, {
                  recordError: false,
                });
                dispatchTasks({
                  type: "TASK_UPDATE_DEVICE",
                  id: taskId,
                  serial: filesCtx.serial,
                  patch: { status: "success", progress: 100, message: `Uploaded to ${response.data}` },
                });
                dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
                existing.add(filename);
              } catch (error) {
                dispatchTasks({
                  type: "TASK_UPDATE_DEVICE",
                  id: taskId,
                  serial: filesCtx.serial,
                  patch: { status: "error", message: formatError(error), progress: null },
                });
                dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
                pushToast(`Upload failed: ${filename} (${formatError(error)})`, "error");
              } finally {
                delete fileTransferTaskByTraceIdRef.current[traceId];
              }
            }
            await refreshFilesList(filesCtx.path);
          } finally {
            setBusy(false);
          }
        };
        void uploadDroppedFiles();
        return;
      }

      setApkDropActive(false);
      if (!payload.paths.length) {
        return;
      }
      const result = applyDroppedPaths(apkCtx.mode, payload.paths);
      if (!result.ok) {
        pushToast(result.message, "error");
        return;
      }
      if (apkCtx.mode === "single") {
        setApkPath(result.selected[0] ?? "");
        if (result.usedFirstOnly) {
          pushToast("Multiple files dropped; using the first one.", "info");
        }
        return;
      }
      if (apkCtx.mode === "bundle") {
        setApkBundlePath(result.selected[0] ?? "");
        return;
      }
      setApkPaths(result.selected);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

		  const handleFilePull = async (entry: DeviceFileEntry) => {
		    const serial = ensureSingleSelection("file pull");
		    if (!serial) {
		      return;
		    }
		    let outputDir = config?.file_gen_output_path || config?.output_path || "";
		    if (!outputDir) {
		      const selected = await openDialog({
		        title: "Select output folder",
	        directory: true,
	        multiple: false,
	      });
	      if (!selected || Array.isArray(selected)) {
	        return;
		      }
		      outputDir = selected;
		    }
		    const traceId = crypto.randomUUID();
		    const taskId = beginTask({
		      kind: "file_pull",
		      title: `Pull File: ${entry.name}`,
		      serials: [serial],
		    });
		    dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
		    fileTransferTaskByTraceIdRef.current[traceId] = taskId;
		    setBusy(true);
		    try {
		      const response = await pullDeviceFile(serial, entry.path, outputDir, traceId, {
		        recordError: false,
		      });
		      dispatchTasks({
		        type: "TASK_UPDATE_DEVICE",
		        id: taskId,
		        serial,
		        patch: {
		          status: "success",
		          output_path: response.data,
		          progress: 100,
		          message: `Pulled to ${response.data}`,
		        },
		      });
		      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
		      pushToast(`Pulled to ${response.data}`, "info");
		      try {
		        const preview = await previewLocalFile(response.data);
	        setFilePreview(preview.data);
	        setFilePreviewDevicePath(entry.path);
	      } catch (error) {
	        dispatchTasks({
	          type: "TASK_UPDATE_DEVICE",
	          id: taskId,
	          serial,
	          patch: { message: `Pulled. Preview failed: ${formatError(error)}` },
	        });
	      }
		    } catch (error) {
		      dispatchTasks({
		        type: "TASK_UPDATE_DEVICE",
		        id: taskId,
		        serial,
		        patch: { status: "error", message: formatError(error), progress: null },
		      });
		      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
		      pushToast(formatError(error), "error");
		    } finally {
		      delete fileTransferTaskByTraceIdRef.current[traceId];
		      setBusy(false);
		    }
		  };

      const handleFilePreview = async (entry: DeviceFileEntry) => {
        const serial = ensureSingleSelection("file preview");
        if (!serial) {
          return;
        }
        if (entry.is_dir) {
          pushToast("Select a file to preview.", "error");
          return;
        }
        const kind = getFileKind(entry);
        const canPreview = kind === "image" || kind === "text";
        if (!canPreview) {
          pushToast("Preview is supported for image and text files.", "info");
          return;
        }

        const outputDir = config?.file_gen_output_path || config?.output_path || "";
        if (!outputDir) {
          pushToast("Set an output folder in Settings to enable preview.", "error");
          return;
        }

        const traceId = crypto.randomUUID();
        const taskId = beginTask({
          kind: "file_pull",
          title: `Preview File: ${entry.name}`,
          serials: [serial],
        });
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
        fileTransferTaskByTraceIdRef.current[traceId] = taskId;
        setBusy(true);
        try {
          const response = await pullDeviceFile(serial, entry.path, outputDir, traceId, {
            recordError: false,
          });
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: {
              status: "success",
              output_path: response.data,
              progress: 100,
              message: `Pulled to ${response.data}`,
            },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
          try {
            const preview = await previewLocalFile(response.data);
            setFilePreview(preview.data);
            setFilePreviewDevicePath(entry.path);
          } catch (error) {
            dispatchTasks({
              type: "TASK_UPDATE_DEVICE",
              id: taskId,
              serial,
              patch: { message: `Pulled. Preview failed: ${formatError(error)}` },
            });
            pushToast(`Preview failed: ${formatError(error)}`, "error");
          }
        } catch (error) {
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: { status: "error", message: formatError(error), progress: null },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
          pushToast(formatError(error), "error");
        } finally {
          delete fileTransferTaskByTraceIdRef.current[traceId];
          setBusy(false);
        }
      };

  const handleUiInspect = async () => {
    const serial = ensureSingleSelection("UI inspector");
    if (!serial) {
      return;
    }
    const taskId = beginTask({
      kind: "ui_inspector_capture",
      title: "UI Inspector Capture",
      serials: [serial],
    });
    setBusy(true);
    try {
      const response = await captureUiHierarchy(serial, { recordError: false });
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      setUiHtml(response.data.html);
      setUiXml(response.data.xml);
      setUiScreenshotDataUrl(response.data.screenshot_data_url ?? "");
      setUiScreenshotError(response.data.screenshot_error ?? "");
      setUiInspectorTab("hierarchy");
      setUiInspectorSearch("");
      setUiExportResult("");
      const screenshotIssue = response.data.screenshot_error?.trim() ?? "";
      if (screenshotIssue) {
        const message = `Screenshot unavailable: ${screenshotIssue}`;
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial,
          patch: { status: "error", message },
        });
        dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
        pushToast("UI hierarchy captured with errors. Check Task Center.", "error");
      } else {
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial,
          patch: { status: "success", message: "UI hierarchy captured." },
        });
        dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
        pushToast("UI hierarchy captured. Check Task Center.", "info");
      }
    } catch (error) {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "error", message: formatError(error) },
      });
      const structured = normalizeStructuredError(error);
      if (structured.trace_id) {
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: structured.trace_id });
      }
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast("Failed to capture UI hierarchy. Check Task Center for details.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleUiAutoSyncToggle = () => {
    const serial = ensureSingleSelection("UI inspector auto sync");
    if (!serial) {
      setUiAutoSyncEnabled(false);
      return;
    }
    setUiAutoSyncError("");
    setUiAutoSyncLastAt(null);
    setUiAutoSyncEnabled((prev) => !prev);
  };

  const handleUiExport = async () => {
    const serial = ensureSingleSelection("UI inspector export");
    if (!serial) {
      return;
    }
    const taskId = beginTask({
      kind: "ui_inspector_export",
      title: "UI Inspector Export",
      serials: [serial],
    });
    setBusy(true);
    try {
      const response = await exportUiHierarchy(serial, config?.file_gen_output_path || config?.output_path, {
        recordError: false,
      });
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      const outputPath = response.data.bundle_dir || response.data.html_path;
      setUiExportResult(outputPath);
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: {
          status: "success",
          output_path: outputPath,
          message: `Exported to ${outputPath}`,
        },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
      pushToast("UI inspector export completed. Check Task Center.", "info");
    } catch (error) {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "error", message: formatError(error) },
      });
      const structured = normalizeStructuredError(error);
      if (structured.trace_id) {
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: structured.trace_id });
      }
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast("Failed to export UI inspector bundle. Check Task Center for details.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleUiCopyXml = async () => {
    const content = filteredUiXml.trim();
    if (!content) {
      pushToast("No XML to copy.", "error");
      return;
    }
    try {
      await writeText(content);
      pushToast(`XML ${uiXmlViewMode === "pretty" ? "pretty" : "raw"} view copied.`, "info");
    } catch (error) {
      recordAppError({
        title: "Copy UI XML",
        source: "ui_inspector.copy_xml",
        error,
      });
      pushToast(`Copy failed: ${formatError(error)}`, "error");
    }
  };

  const handleLoadApps = async () => {
    const serial = ensureSingleSelection("app list");
    if (!serial) {
      return;
    }
    setBusy(true);
    setAppsLoading(true);
    try {
      const response = await listApps(
        serial,
        appsThirdPartyOnly ? true : undefined,
        appsIncludeVersions,
      );
      setApps(response.data);
      setAppsVisibleCount(APPS_PAGE_SIZE);
      setSelectedApp(null);
      setSelectedAppDetails(null);
      setAppsDetailsBusy(false);
      setAppsContextMenu(null);
      setAppIconsByKey({});
      appIconQueueRef.current = [];
      appIconInFlightRef.current = 0;
      appsDetailsSeqRef.current += 1;
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
      setAppsLoading(false);
    }
  };

  const appsSerial = activeSerial;

  const pumpAppIconQueue = () => {
    const MAX_IN_FLIGHT = 2;
    while (appIconInFlightRef.current < MAX_IN_FLIGHT) {
      const next = appIconQueueRef.current.shift();
      if (!next) {
        break;
      }
      const current = appIconsByKeyRef.current[next.key];
      if (current && (current.status === "loading" || current.status === "ready")) {
        continue;
      }
      appIconInFlightRef.current += 1;
      setAppIconsByKey((prev) => ({
        ...prev,
        [next.key]: { status: "loading" },
      }));
      void (async () => {
        try {
          const response = await getAppIcon(next.serial, next.app.package_name, next.app.apk_path ?? undefined);
          setAppIconsByKey((prev) => ({
            ...prev,
            [next.key]: { status: "ready", dataUrl: response.data.data_url },
          }));
        } catch (error) {
          setAppIconsByKey((prev) => ({
            ...prev,
            [next.key]: { status: "error", error: formatError(error) },
          }));
        } finally {
          appIconInFlightRef.current -= 1;
          pumpAppIconQueue();
        }
      })();
    }
  };

  const enqueueAppIconFetch = (serial: string, app: AppInfo) => {
    const key = getAppIconKey(serial, app.package_name);
    const current = appIconsByKeyRef.current[key];
    if (current && (current.status === "queued" || current.status === "loading" || current.status === "ready")) {
      return;
    }
    setAppIconsByKey((prev) => ({
      ...prev,
      [key]: { status: "queued" },
    }));
    appIconQueueRef.current.push({ key, serial, app });
    pumpAppIconQueue();
  };

  useEffect(() => {
    if (!appsSerial || !selectedApp) {
      return;
    }
    enqueueAppIconFetch(appsSerial, selectedApp);
  }, [appsSerial, selectedApp?.package_name]);

  const appsListRef = useRef<HTMLDivElement | null>(null);
  const appsLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const appsLoadMoreLockedRef = useRef(false);
  const appsFilteredLenRef = useRef(0);
  const appsCanLoadMoreRef = useRef(false);
  const appsByPackage = useMemo(() => {
    return new Map(apps.map((app) => [app.package_name, app] as const));
  }, [apps]);

  useEffect(() => {
    setAppsVisibleCount(APPS_PAGE_SIZE);
  }, [appsFilter]);

  useEffect(() => {
    setAppsVisibleCount(APPS_PAGE_SIZE);
  }, [appsSerial]);

  useEffect(() => {
    if (!appsSerial) {
      return;
    }
    const root = appsListRef.current;
    if (!root) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const target = entry.target as HTMLElement;
          const pkg = target.dataset.appPkg;
          if (!pkg) {
            continue;
          }
          const app = appsByPackage.get(pkg);
          if (!app) {
            continue;
          }
          enqueueAppIconFetch(appsSerial, app);
        }
      },
      { root, rootMargin: "220px" },
    );
    const nodes = root.querySelectorAll<HTMLElement>("[data-app-pkg]");
    nodes.forEach((node) => {
      observer.observe(node);
    });
    return () => observer.disconnect();
  }, [appsSerial, appsByPackage, appsFilter, appsVisibleCount]);

  const appsAutoLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (location.pathname !== "/apps") {
      return;
    }
    if (!appsSerial) {
      return;
    }
    if (busy) {
      return;
    }
    if (apps.length > 0) {
      return;
    }
    const key = `${appsSerial}|${appsThirdPartyOnly ? "3" : "all"}|${appsIncludeVersions ? "v" : ""}`;
    if (appsAutoLoadKeyRef.current === key) {
      return;
    }
    appsAutoLoadKeyRef.current = key;
    void handleLoadApps();
  }, [location.pathname, appsSerial, appsThirdPartyOnly, appsIncludeVersions, apps.length, busy]);

  const loadMoreApps = () => {
    if (!appsCanLoadMoreRef.current) {
      return;
    }
    if (appsLoadMoreLockedRef.current) {
      return;
    }
    appsLoadMoreLockedRef.current = true;
    setAppsVisibleCount((prev) => {
      const next = Math.min(prev + APPS_PAGE_SIZE, appsFilteredLenRef.current);
      return next;
    });
    window.requestAnimationFrame(() => {
      appsLoadMoreLockedRef.current = false;
    });
  };

  useEffect(() => {
    if (location.pathname !== "/apps") {
      return;
    }
    if (!appsCanLoadMoreRef.current) {
      return;
    }
    const sentinel = appsLoadMoreSentinelRef.current;
    if (!sentinel) {
      return;
    }
    const root = appsListRef.current;
    const hasOverflow = root ? root.scrollHeight > root.clientHeight + 8 : false;
    const resolvedRoot = hasOverflow ? root : null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreApps();
        }
      },
      {
        root: resolvedRoot,
        rootMargin: "240px",
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [location.pathname, appsVisibleCount, appsFilter, appsSerial]);

  const handleSelectAppRow = (app: AppInfo) => {
    setSelectedApp(app);
    setSelectedAppDetails(null);
    setAppsContextMenu(null);

    const serial = ensureSingleSelection("app details");
    if (!serial) {
      return;
    }

    const seq = (appsDetailsSeqRef.current += 1);
    setAppsDetailsBusy(true);
    void (async () => {
      try {
        const response = await getAppBasicInfo(serial, app.package_name);
        if (appsDetailsSeqRef.current !== seq) {
          return;
        }
        setSelectedAppDetails(response.data);
      } catch (error) {
        if (appsDetailsSeqRef.current !== seq) {
          return;
        }
        pushToast(formatError(error), "error");
      } finally {
        if (appsDetailsSeqRef.current === seq) {
          setAppsDetailsBusy(false);
        }
      }
    })();
  };

  const handleAppDoubleClick = async (app: AppInfo) => {
    const serial = ensureSingleSelection("app launch");
    if (!serial) {
      return;
    }
    setBusy(true);
    try {
      const response = await launchApp([serial], app.package_name);
      const successCount = response.data.filter((item) => item.exit_code === 0).length;
      if (successCount) {
        pushToast(`Launch requested (${successCount}/${response.data.length}).`, "info");
      } else {
        const detail = (response.data[0]?.stderr || response.data[0]?.stdout || "Unknown error").trim();
        pushToast(`Launch failed: ${detail.slice(0, 200)}`, "error");
      }
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleAppContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, app: AppInfo) => {
    event.preventDefault();
    handleSelectAppRow(app);
    setAppsContextMenu({ x: event.clientX, y: event.clientY, app });
  };

  const handleContextForceStop = async (app: AppInfo) => {
    const serial = ensureSingleSelection("app management");
    if (!serial) {
      return;
    }
    setBusy(true);
    try {
      await forceStopApp(serial, app.package_name);
      pushToast("App action sent.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
      setAppsContextMenu(null);
    }
  };

  const handleAppAction = async (
    action: "uninstall" | "forceStop" | "clear" | "enable" | "disable" | "info",
    confirmed = false,
  ) => {
    const serial = ensureSingleSelection("app management");
    if (!serial || !selectedApp) {
      pushToast("Select an app.", "error");
      return;
    }
    // Destructive actions require explicit confirmation (consistent with Reboot / Delete).
    if (!confirmed && (action === "uninstall" || action === "clear")) {
      setAppActionConfirm({ action, packageName: selectedApp.package_name });
      return;
    }
    setBusy(true);
    try {
      if (action === "uninstall") {
        await uninstallApp(serial, selectedApp.package_name, false);
      } else if (action === "forceStop") {
        await forceStopApp(serial, selectedApp.package_name);
      } else if (action === "clear") {
        await clearAppData(serial, selectedApp.package_name);
      } else if (action === "enable") {
        await setAppEnabled(serial, selectedApp.package_name, true);
      } else if (action === "disable") {
        await setAppEnabled(serial, selectedApp.package_name, false);
      } else if (action === "info") {
        await openAppInfo(serial, selectedApp.package_name);
      }
      pushToast("App action sent.", "info");
      if (action === "uninstall") {
        await handleLoadApps();
      }
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleScrcpyLaunch = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    const targetSerials = selectedSerials;
    const operationId = crypto.randomUUID();
    setDeviceQuickActionStatuses(targetSerials, "mirror_launch", "pending", operationId);
    setBusy(true);
    try {
      let availability = scrcpyInfo;
      if (!availability?.available) {
        const response = await checkScrcpy();
        availability = response.data;
        setScrcpyInfo(response.data);
      }
      if (!availability?.available) {
        finishDeviceQuickActionOperation({
          operationId,
          kind: "mirror_launch",
          successSerials: [],
          errorSerials: targetSerials,
        });
        pushToast("scrcpy is not available.", "error");
        return;
      }
      const response = await launchScrcpy(targetSerials);
      const failures = response.data.filter((item) => item.exit_code !== 0);
      const successSerials = response.data.filter((item) => item.exit_code === 0).map((item) => item.serial);
      const reportedSerials = new Set(response.data.map((item) => item.serial));
      const failureSerials = [
        ...failures.map((item) => item.serial),
        ...targetSerials.filter((serial) => !reportedSerials.has(serial)),
      ];
      finishDeviceQuickActionOperation({
        operationId,
        kind: "mirror_launch",
        successSerials,
        errorSerials: failureSerials,
      });
      if (failures.length) {
        const firstFailure = failures[0];
        const detail = (firstFailure.stderr || firstFailure.stdout || "Unknown error").trim();
        const summary =
          failures.length === response.data.length
            ? `scrcpy failed: ${detail}`
            : `scrcpy launched with ${failures.length} error(s): ${detail}`;
        pushToast(summary, "error");
      } else {
        pushToast("scrcpy launched.", "info");
      }
    } catch (error) {
      finishDeviceQuickActionOperation({
        operationId,
        kind: "mirror_launch",
        successSerials: [],
        errorSerials: targetSerials,
      });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleQuickScreenshot = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    if (!screenshotActionMeta.eligibleSerials.length) {
      pushToast("No eligible devices selected.", "error");
      return;
    }
    const outputDir = (config?.output_path ?? "").trim();
    if (!outputDir) {
      pushToast("Set an output folder in Settings to save screenshots.", "error");
      return;
    }

    setBusy(true);
    try {
      const serials = screenshotActionMeta.eligibleSerials;
      const skippedCount = screenshotActionMeta.skippedSerials.length;
      const operationId = crypto.randomUUID();
      setDeviceQuickActionStatuses(serials, "screenshot", "pending", operationId);
      const taskId = beginTask({
        kind: "screenshot",
        title: `Screenshot (${serials.length})`,
        serials,
      });
      let hasError = false;
      let traceSet = false;
      const successSerials: string[] = [];
      const errorSerials: string[] = [];
      await Promise.all(
        serials.map(async (serial) => {
          try {
            const response = await captureScreenshot(serial, outputDir, { recordError: false });
            if (!traceSet && response.trace_id) {
              traceSet = true;
              dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
            }
            dispatchTasks({
              type: "TASK_UPDATE_DEVICE",
              id: taskId,
              serial,
              patch: { status: "success", output_path: response.data, message: `Saved to ${response.data}` },
            });
            successSerials.push(serial);
          } catch (error) {
            hasError = true;
            errorSerials.push(serial);
            dispatchTasks({
              type: "TASK_UPDATE_DEVICE",
              id: taskId,
              serial,
              patch: { status: "error", message: formatError(error) },
            });
          }
        }),
      );
      finishDeviceQuickActionOperation({
        operationId,
        kind: "screenshot",
        successSerials,
        errorSerials,
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: hasError ? "error" : "success" });
      pushToast(
        `${
          hasError ? "Screenshot completed with errors. Check Task Center." : "Screenshot completed. Check Task Center."
        }${skippedCount > 0 ? ` Skipped ${skippedCount} unavailable device(s).` : ""}`,
        hasError ? "error" : "info",
      );
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleQuickScreenRecord = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    if (!screenRecordActionMeta.eligibleSerials.length) {
      pushToast("No eligible devices selected.", "error");
      return;
    }

    const pendingSerials = new Set<string>();
    const markScreenRecordPending = (serials: string[], action: ScreenRecordPendingAction) => {
      serials.forEach((serial) => pendingSerials.add(serial));
      setScreenRecordPendingBySerial((prev) => {
        const next = { ...prev };
        serials.forEach((serial) => {
          next[serial] = action;
        });
        return next;
      });
    };

    setBusy(true);
    try {
      const outputDir = (config?.output_path ?? "").trim() || undefined;
      const nextAction = screenRecordActionMeta;
      const skippedCount = nextAction.skippedSerials.length;
      let hasError = false;

      const stopGroup = nextAction.taskGroups.find((group) => group.action === "stop");
      if (stopGroup?.serials.length) {
        markScreenRecordPending(stopGroup.serials, "stopping");
        const taskId = beginTask({
          kind: "screen_record_stop",
          title: `Screen Record Stop (${stopGroup.serials.length})`,
          serials: stopGroup.serials,
        });
        let traceSet = false;
        await Promise.all(
          stopGroup.serials.map(async (serial) => {
            try {
              const response = await stopScreenRecord(serial, outputDir, { recordError: false });
              if (!traceSet && response.trace_id) {
                traceSet = true;
                dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
              }
              const savedPath = response.data.output_path?.trim() ?? "";
              const logcatPath = response.data.logcat_output_path?.trim() ?? "";
              const logcatError = response.data.logcat_error?.trim() ?? "";
              const artifactDir = response.data.artifact_dir?.trim() ?? "";
              const artifactPaths = Array.from(
                new Set(
                  [
                    ...(response.data.artifact_paths ?? []),
                    ...(response.data.output_paths ?? []),
                    logcatPath,
                  ].filter((path) => path.trim()),
                ),
              );
              const segmentCount = response.data.segment_count;
              const message =
                segmentCount > 1
                  ? `Saved ${segmentCount} segments to ${savedPath || "the output folder"}.`
                  : savedPath
                    ? `Saved to ${savedPath}`
                    : "Stopped.";
              const logcatMessage = logcatPath ? ` Logcat saved to ${logcatPath}.` : "";
              const artifactDirMessage = artifactDir ? ` Artifacts folder: ${artifactDir}.` : "";
              const logcatErrorMessage = logcatError ? ` Logcat capture issue: ${logcatError}` : "";
              if (logcatError) {
                hasError = true;
              }
              dispatchTasks({
                type: "TASK_UPDATE_DEVICE",
                id: taskId,
                serial,
                patch: {
                  status: logcatError ? "error" : "success",
                  output_path: savedPath || null,
                  artifact_dir: artifactDir || null,
                  artifact_paths: artifactPaths,
                  message: `${message}${logcatMessage}${artifactDirMessage}${logcatErrorMessage}`.trim(),
                },
              });
            } catch (error) {
              hasError = true;
              dispatchTasks({
                type: "TASK_UPDATE_DEVICE",
                id: taskId,
                serial,
                patch: { status: "error", message: formatError(error) },
              });
            }
          }),
        );
        dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: hasError ? "error" : "success" });
      }

      const startGroup = nextAction.taskGroups.find((group) => group.action === "start");
      if (startGroup?.serials.length) {
        markScreenRecordPending(startGroup.serials, "starting");
        const taskId = beginTask({
          kind: "screen_record_start",
          title: `Screen Record Start (${startGroup.serials.length})`,
          serials: startGroup.serials,
        });
        let traceSet = false;
        await Promise.all(
          startGroup.serials.map(async (serial) => {
            try {
              const response = await startScreenRecord(serial, { recordError: false });
              if (!traceSet && response.trace_id) {
                traceSet = true;
                dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
              }
              dispatchTasks({
                type: "TASK_UPDATE_DEVICE",
                id: taskId,
                serial,
                patch: {
                  status: "success",
                  message: [
                    `Recording to ${response.data.display_path}`,
                    response.data.logcat_output_path?.trim()
                      ? `Capturing logcat to ${response.data.logcat_output_path}`
                      : "",
                    response.data.artifact_dir?.trim()
                      ? `Artifacts folder: ${response.data.artifact_dir}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(". "),
                },
              });
            } catch (error) {
              hasError = true;
              dispatchTasks({
                type: "TASK_UPDATE_DEVICE",
                id: taskId,
                serial,
                patch: { status: "error", message: formatError(error) },
              });
            }
          }),
        );
        dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: hasError ? "error" : "success" });
      }

      await refreshScreenRecordStatuses(nextAction.eligibleSerials, { silent: true });
      const skippedSuffix =
        skippedCount > 0 ? ` Skipped ${skippedCount} unavailable device(s).` : "";
      if (nextAction.action === "toggle") {
        pushToast(
          `${
            hasError
              ? "Recording toggle completed with errors. Check Task Center."
              : "Recording toggled. Check Task Center."
          }${skippedSuffix}`,
          hasError ? "error" : "info",
        );
      } else if (nextAction.action === "stop") {
        pushToast(
          `${
            hasError
              ? "Stop recording completed with errors. Check Task Center."
              : "Recording saved. Check Task Center."
          }${skippedSuffix}`,
          hasError ? "error" : "info",
        );
      } else {
        pushToast(
          `${
            hasError
              ? "Screen recording started with errors. Check Task Center."
              : "Screen recording started."
          }${skippedSuffix}`,
          hasError ? "error" : "info",
        );
      }
    } finally {
      if (pendingSerials.size > 0) {
        setScreenRecordPendingBySerial((prev) => {
          const next = { ...prev };
          pendingSerials.forEach((serial) => {
            delete next[serial];
          });
          return next;
        });
      }
      setBusy(false);
    }
  };

  const handleQuickLogcatClear = () => {
    const singleSerial = logcatClearActionMeta.eligibleSerials[0] ?? null;
    if (!singleSerial) {
      pushToast("Select exactly one online device to clear the logcat buffer.", "error");
      return;
    }
    setLogcatClearBufferModal({ serial: singleSerial });
  };

  const handleExportIosCrashReports = async () => {
    const serial = ensureSingleSelection("iOS crash report export");
    if (!serial) {
      return;
    }
    const targetDevice = devices.find((device) => device.summary.serial === serial) ?? null;
    if (getDevicePlatform(targetDevice) !== "ios" || !hasDeviceCapability(targetDevice, "crash_reports")) {
      pushToast("iOS crash report export is not available for this device.", "error");
      return;
    }

    const outputDir = (config?.file_gen_output_path || config?.output_path || "").trim();
    setBusy(true);
    const taskId = beginTask({
      kind: "ios_crash_export",
      title: "Export iOS Crash Reports",
      serials: [serial],
    });
    try {
      const response = await exportIosCrashReports(serial, outputDir || undefined);
      if (response.trace_id) {
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      }
      const detail = (response.data.stdout || response.data.stderr || "").trim();
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: {
          status: "success",
          output_path: outputDir || undefined,
          message: detail || "Crash reports exported.",
        },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
      pushToast(
        detail ? `iOS crash reports exported. ${detail}` : "iOS crash reports exported. Check Task Center.",
        "info",
      );
    } catch (error) {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: { status: "error", message: formatError(error) },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReboot = async () => {
    closeRebootConfirm();
    await handleReboot(rebootConfirmMode === "normal" ? undefined : rebootConfirmMode);
  };

  const closeTopActionsMenu = () => {
    setTopActionsMenuOpen(false);
  };

  const runTopActionsMenuCommand = (run: () => void) => {
    closeTopActionsMenu();
    run();
  };

  const focusTopActionsMenuItem = (direction: 1 | -1) => {
    const items =
      topActionsMenuRef.current?.querySelectorAll<HTMLButtonElement>(".context-menu-item:not(:disabled)") ?? [];
    if (!items.length) {
      return;
    }
    const list = Array.from(items);
    const currentIndex = list.findIndex((item) => item === document.activeElement);
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : list.length - 1
        : (currentIndex + direction + list.length) % list.length;
    list[nextIndex]?.focus();
  };

  const handleTopActionsMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusTopActionsMenuItem(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusTopActionsMenuItem(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      const firstItem = topActionsMenuRef.current?.querySelector<HTMLButtonElement>(
        ".context-menu-item:not(:disabled)",
      );
      firstItem?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const items = topActionsMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        ".context-menu-item:not(:disabled)",
      );
      if (!items?.length) {
        return;
      }
      items[items.length - 1]?.focus();
    }
  };

  const buildConfigForSave = (
    base: AppConfig,
    options: { dashboard?: DashboardSettings; groupMap?: Record<string, string> } = {},
  ): AppConfig => ({
    ...withDeviceGroups(base, options.groupMap ?? groupMap),
    ui: {
      ...base.ui,
      density: normalizeUiDensity(base.ui.density),
      font_size: normalizeThemeFontSize(base.ui.font_size),
      theme_style: normalizeThemeStyleSettings(base.ui.theme_style),
    },
    apk_install: {
      ...base.apk_install,
      allow_downgrade: apkAllowDowngrade,
      replace_existing: apkReplace,
      grant_permissions: apkGrant,
      allow_test_packages: apkAllowTest,
      extra_args: apkExtraArgs,
    },
    dashboard: normalizeDashboardSettings(options.dashboard ?? base.dashboard),
  });

  const updateThemeStyle = (updater: (current: ThemeStyleSettings) => ThemeStyleSettings) => {
    setConfig((prev) => {
      if (!prev) {
        return prev;
      }
      return buildConfigWithThemeStyleUpdate(prev, updater);
    });
  };

  const persistThemeBackgroundSource = async (
    backgroundSource: ThemeBackgroundSource,
    successMessage: string,
  ) => {
    if (!config) {
      throw new Error("Settings are still loading. Try again in a moment.");
    }
    const latestSaved = await getConfig();
    const updated = buildConfigWithThemeStyleUpdate(latestSaved.data, (current) => ({
      ...current,
      background_source: backgroundSource,
    }));
    const response = await saveConfig(updated);
    setConfig((prev) =>
      prev ? mergeSavedThemeBackgroundSourceIntoDraft(prev, response.data) : response.data,
    );
    pushToast(successMessage, "info");
  };

  const updateThemeColor = (key: keyof ThemeStyleSettings["colors"], value: string) => {
    updateThemeStyle((current) => ({
      ...current,
      colors: {
        ...current.colors,
        [key]: value,
      },
    }));
  };

  const updateThemeCopy = (key: keyof ThemeStyleSettings["copy_overrides"], value: string) => {
    updateThemeStyle((current) => ({
      ...current,
      copy_overrides: {
        ...current.copy_overrides,
        [key]: value,
      },
    }));
  };

  const openDashboardConfig = () => {
    setDashboardDraft(normalizeDashboardSettings(config?.dashboard));
    setDashboardConfigOpen(true);
  };

  const closeDashboardConfig = () => {
    if (busy) {
      return;
    }
    setDashboardConfigOpen(false);
  };

  const handleDashboardCardToggle = (cardId: DashboardCardId, enabled: boolean) => {
    setDashboardDraft((prev) => toggleDashboardCard(prev, cardId, enabled));
  };

  const handleDashboardFieldToggle = (
    cardId: DashboardCardId,
    fieldId: DashboardFieldId,
    enabled: boolean,
  ) => {
    setDashboardDraft((prev) => toggleDashboardField(prev, cardId, fieldId, enabled));
  };

  const handleDashboardFieldMove = (
    cardId: DashboardCardId,
    fieldId: DashboardFieldId,
    direction: "up" | "down",
  ) => {
    setDashboardDraft((prev) => moveDashboardField(prev, cardId, fieldId, direction));
  };

  const handleDashboardReset = () => {
    setDashboardDraft(buildDefaultDashboardSettings());
  };

  const handleDashboardSave = async () => {
    if (!config) {
      return;
    }
    setBusy(true);
    try {
      const updated = buildConfigForSave(config, { dashboard: dashboardDraft });
      const response = await saveConfig(updated);
      setConfig(response.data);
      setGroupMap(flattenDeviceGroups(response.data.device_groups));
      setDashboardDraft(normalizeDashboardSettings(response.data.dashboard));
      setDashboardConfigOpen(false);
      pushToast("Dashboard preferences saved.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!config) {
      return;
    }
    setBusy(true);
    try {
      const updated = buildConfigForSave(config);
      const response = await saveConfig(updated);
      setConfig(response.data);
      setGroupMap(flattenDeviceGroups(response.data.device_groups));
      pushToast("Settings saved.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleResetConfig = async () => {
    setBusy(true);
    try {
      const response = await resetConfig();
      setConfig(response.data);
      setGroupMap(flattenDeviceGroups(response.data.device_groups));
      setApkExtraArgs(response.data.apk_install.extra_args);
      setApkAllowDowngrade(response.data.apk_install.allow_downgrade);
      setApkReplace(response.data.apk_install.replace_existing);
      setApkGrant(response.data.apk_install.grant_permissions);
      setApkAllowTest(response.data.apk_install.allow_test_packages);
      setAdbInfo(null);
      setIosToolsInfo(null);
      pushToast("Settings reset.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleBrowseAdbPath = async () => {
    try {
      const selected = await openDialog({
        title: "Select ADB executable",
        multiple: false,
        directory: false,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setConfig((prev) => (prev ? { ...prev, adb: { ...prev.adb, command_path: selected } } : prev));
      setAdbInfo(null);
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const handleBrowseOutputPath = async () => {
    try {
      const selected = await openDialog({
        title: "Select default output folder",
        multiple: false,
        directory: true,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setConfig((prev) => (prev ? { ...prev, output_path: selected } : prev));
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const handleBrowseFileExportPath = async () => {
    try {
      const selected = await openDialog({
        title: "Select file export folder",
        multiple: false,
        directory: true,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setConfig((prev) => (prev ? { ...prev, file_gen_output_path: selected } : prev));
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const handleBrowseThemeBackgroundPath = async () => {
    try {
      const selected = await openDialog({
        title: "Select theme background image",
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "gif"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setBusy(true);
      await persistThemeBackgroundSource(
        {
          kind: "local_path",
          path: selected,
        },
        "Theme background selected and saved.",
      );
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleValidateMobileconfigPath = async (profilePath = mobileconfigPath) => {
    const trimmed = profilePath.trim();
    if (!trimmed) {
      setMobileconfigSummary(null);
      setMobileconfigValidationError("Select a .mobileconfig file first.");
      return;
    }
    setProfileInstallResults([]);
    setMobileconfigValidationError(null);
    setProfileInstalling(true);
    try {
      const response = await validateMobileconfig(trimmed);
      setMobileconfigSummary(response.data);
      setMobileconfigPath(trimmed);
      pushToast("Configuration profile validated.", "info");
    } catch (error) {
      setMobileconfigSummary(null);
      setMobileconfigValidationError(formatError(error));
      pushToast(formatError(error), "error");
    } finally {
      setProfileInstalling(false);
    }
  };

  const handleBrowseMobileconfigPath = async () => {
    try {
      const selected = await openDialog({
        title: "Select configuration profile",
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Configuration Profiles",
            extensions: ["mobileconfig"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setMobileconfigPath(selected);
      setMobileconfigSummary(null);
      setMobileconfigValidationError(null);
      void handleValidateMobileconfigPath(selected);
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const handleOpenConfigurationProfiles = () => {
    setProfileTargetSerials(iosConfigurationProfileEligibleSerials);
    setProfileInstallResults([]);
    navigate("/profiles");
  };

  const toggleProfileTargetSerial = (serial: string) => {
    setProfileTargetSerials((prev) =>
      prev.includes(serial) ? prev.filter((item) => item !== serial) : [...prev, serial],
    );
  };

  const selectAllProfileTargets = () => {
    setProfileTargetSerials(iosProfileCapableDevices.map((device) => device.summary.serial));
  };

  const clearProfileTargets = () => {
    setProfileTargetSerials([]);
  };

  const getValidProfileTargetSerials = () => {
    const eligible = new Set(
      devices
        .filter(
          (device) =>
            getDevicePlatform(device) === "ios" &&
            device.summary.state === "device" &&
            hasDeviceCapability(device, "configuration_profiles"),
        )
        .map((device) => device.summary.serial),
    );
    return profileTargetSerials.filter((serial) => eligible.has(serial));
  };

  const requestProfileInstallConfirm = () => {
    if (!mobileconfigSummary) {
      setMobileconfigValidationError("Validate the configuration profile before installing it.");
      return;
    }
    if (!getValidProfileTargetSerials().length) {
      pushToast("Select at least one eligible iOS device.", "error");
      return;
    }
    setProfileConfirmOpen(true);
  };

  const closeProfileInstallConfirm = () => {
    if (!profileInstalling) {
      setProfileConfirmOpen(false);
    }
  };

  const handleConfirmProfileInstall = async () => {
    setProfileConfirmOpen(false);
    setProfileInstalling(true);
    const targets = getValidProfileTargetSerials();
    const taskId = beginTask({
      kind: "ios_profile_install",
      title: `Install Configuration Profile (${targets.length})`,
      serials: targets,
    });
    try {
      // Refresh inventory so cfgutil ECID mapping stays current before install.
      await refreshDeviceSummaryOnce(false);
      const response = await installIosConfigurationProfile(targets, mobileconfigPath);
      setProfileInstallResults(response.data);
      if (response.trace_id) {
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      }
      let failedCount = 0;
      response.data.forEach((item) => {
        if (item.status === "failed") {
          failedCount += 1;
        }
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial: item.serial,
          patch: {
            status: item.status === "installed" ? "success" : item.status === "skipped" ? "cancelled" : "error",
            message: item.message,
          },
        });
      });
      const installedCount = response.data.filter((item) => item.status === "installed").length;
      const skippedCount = response.data.filter((item) => item.status === "skipped").length;
      dispatchTasks({
        type: "TASK_SET_STATUS",
        id: taskId,
        status: failedCount > 0 ? "error" : "success",
      });
      pushToast(
        `Profile install finished: ${installedCount} installed, ${failedCount} failed, ${skippedCount} skipped.`,
        failedCount > 0 ? "error" : "info",
      );
    } catch (error) {
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(formatError(error), "error");
    } finally {
      setProfileInstalling(false);
    }
  };

  const handleImportThemeBackgroundPath = async () => {
    try {
      const selected = await openDialog({
        title: "Import theme background image",
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "gif"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setBusy(true);
      const response = await importThemeBackground(selected);
      await persistThemeBackgroundSource(
        {
          kind: "managed_path",
          path: response.data,
        },
        "Theme background imported and saved.",
      );
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const runBugreportLogQuery = async (reportId: string, offset: number, append: boolean) => {
    const requestId = bugreportLogRequestRef.current + 1;
    bugreportLogRequestRef.current = requestId;
    setBugreportLogBusy(true);
    setBugreportLogError(null);
    try {
      const response = await queryBugreportLogcat(reportId, effectiveBugreportLogFilters, offset, 200);
      if (bugreportLogRequestRef.current !== requestId) {
        return;
      }
      if (!append) {
        setBugreportLogLoadAllLimitReached(false);
      }
      setBugreportLogRows((prev) => (append ? [...prev, ...response.data.rows] : response.data.rows));
      setBugreportLogHasMore(response.data.has_more);
      setBugreportLogOffset(response.data.next_offset);
    } catch (error) {
      if (bugreportLogRequestRef.current !== requestId) {
        return;
      }
      const message = formatError(error);
      setBugreportLogError(message);
      pushToast(message, "error");
    } finally {
      if (bugreportLogRequestRef.current === requestId) {
        setBugreportLogBusy(false);
      }
    }
  };

  const handleBugreportLogBufferChange = (nextBuffer: string) => {
    setBugreportLogBuffer(nextBuffer);
  };

  const loadBugreportLogFromPath = async (path: string) => {
    const sourcePath = path.trim();
    if (!sourcePath) {
      pushToast("Select a bugreport file first.", "error");
      return;
    }

    bugreportLogLoadAllTokenRef.current += 1;
    setBugreportLogLoadAllRunning(false);

    setBugreportLogSourcePath(sourcePath);
    setBugreportLogSummary(null);
    setBugreportExtractSummary(null);
    setActiveBugreportCustomViewSession(null);
    setBugreportLogRows([]);
    setBugreportLogHasMore(false);
    setBugreportLogOffset(0);
    setBugreportLogBuffer("");
    setBugreportLogLoadAllLimitReached(false);

    setBugreportLogBusy(true);
    setBugreportExtractPreparing(true);
    setBugreportLogError(null);
    try {
      const logResponse = await prepareBugreportLogcat(sourcePath);
      setBugreportLogSummary(logResponse.data);
      const extractResponse = await prepareBugreportExtractIndex(sourcePath);
      setBugreportExtractSummary(extractResponse.data);
    } catch (error) {
      const message = formatError(error);
      setBugreportLogError(message);
      pushToast(message, "error");
    } finally {
      setBugreportExtractPreparing(false);
      setBugreportLogBusy(false);
    }
  };

  const handlePickBugreportLogFile = async () => {
    const selected = await openDialog({
      title: "Select bugreport file",
      filters: [{ name: "Bugreport", extensions: ["zip", "txt"] }],
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }
    void loadBugreportLogFromPath(selected);
  };

  useEffect(() => {
    if (!isBugreportPopupSession) {
      bugreportPopupLoadedSourceRef.current = null;
      return;
    }
    if (!isBugreportLogViewer) {
      return;
    }
    const sourcePath = bugreportPopupSourcePath?.trim() ?? "";
    if (!sourcePath) {
      return;
    }
    if (bugreportPopupLoadedSourceRef.current === sourcePath) {
      return;
    }
    bugreportPopupLoadedSourceRef.current = sourcePath;
    void loadBugreportLogFromPath(sourcePath);
  }, [
    bugreportPopupSourcePath,
    isBugreportLogViewer,
    isBugreportPopupSession,
  ]);

  useEffect(() => {
    if (!bugreportLogSummary) {
      return;
    }
    if (!isBugreportLogViewer) {
      return;
    }
    if (activeBugreportCustomViewSession) {
      return;
    }
    if (bugreportLogLoadAllRunningRef.current) {
      bugreportLogLoadAllTokenRef.current += 1;
      setBugreportLogLoadAllRunning(false);
    }
    const reportId = bugreportLogSummary.report_id;
    const isNewReport = bugreportLogLastReportIdRef.current !== reportId;
    const delayMs = isNewReport ? 0 : 350;
    bugreportLogLastReportIdRef.current = reportId;

    const handle = window.setTimeout(() => {
      void runBugreportLogQuery(bugreportLogSummary.report_id, 0, false);
    }, delayMs);
    return () => window.clearTimeout(handle);
  }, [bugreportLogSummary, effectiveBugreportLogFilters, isBugreportLogViewer, activeBugreportCustomViewSession]);

  const handleBugreportLogLoadAll = async () => {
    if (!bugreportLogSummary || bugreportLogBusy || activeBugreportCustomViewSession) {
      return;
    }

    const token = bugreportLogLoadAllTokenRef.current + 1;
    bugreportLogLoadAllTokenRef.current = token;
    setBugreportLogLoadAllRunning(true);
    setBugreportLogLoadAllLimitReached(false);

    const reportId = bugreportLogSummary.report_id;
    const pageSize = BUGREPORT_LOG_LOAD_PAGE_SIZE;
    let offset = 0;
    let hasMore = true;
    let loadedRows: BugreportLogRow[] = [];
    let limitReached = false;

    try {
      while (hasMore && bugreportLogLoadAllTokenRef.current === token) {
        const remaining = BUGREPORT_LOG_LOAD_ALL_MAX_ROWS - loadedRows.length;
        if (remaining <= 0) {
          limitReached = true;
          break;
        }

        const response = await queryBugreportLogcat(
          reportId,
          effectiveBugreportLogFilters,
          offset,
          Math.min(pageSize, remaining),
        );
        if (bugreportLogLoadAllTokenRef.current !== token) {
          return;
        }
        loadedRows = loadedRows.concat(response.data.rows.slice(0, remaining));
        limitReached = loadedRows.length >= BUGREPORT_LOG_LOAD_ALL_MAX_ROWS && response.data.has_more;
        setBugreportLogRows(loadedRows);
        setBugreportLogHasMore(response.data.has_more || limitReached);
        setBugreportLogOffset(response.data.next_offset);
        hasMore = response.data.has_more && !limitReached;
        offset = response.data.next_offset;

        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      if (limitReached && bugreportLogLoadAllTokenRef.current === token) {
        setBugreportLogLoadAllLimitReached(true);
        pushToast(
          `Loaded the first ${BUGREPORT_LOG_LOAD_ALL_MAX_ROWS.toLocaleString()} rows. Use filters or Load more for narrower follow-up pages.`,
          "info",
        );
      }
    } catch (error) {
      if (bugreportLogLoadAllTokenRef.current !== token) {
        return;
      }
      const message = formatError(error);
      setBugreportLogError(message);
      pushToast(message, "error");
    } finally {
      if (bugreportLogLoadAllTokenRef.current === token) {
        setBugreportLogLoadAllRunning(false);
      }
    }
  };

  const handleBugreportLogStopLoadAll = () => {
    bugreportLogLoadAllTokenRef.current += 1;
    setBugreportLogLoadAllRunning(false);
  };

  const handleCheckAdb = async () => {
    if (!config) {
      return;
    }
    setBusy(true);
    try {
      const response = await checkAdb(config.adb.command_path);
      setAdbInfo(response.data);
      pushToast(response.data.available ? "ADB is available." : "ADB is not available.", response.data.available ? "info" : "error");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleCheckIosTools = async () => {
    setBusy(true);
    try {
      const response = await checkIosTools();
      setIosToolsInfo(response.data);
      const availableCount = countAvailableIosTools(response.data);
      const totalCount = countIosToolsTotal(response.data);
      pushToast(
        availableCount > 0
          ? `iOS tools available: ${availableCount}/${totalCount}.`
          : "No iOS tools are available.",
        availableCount > 0 ? "info" : "error",
      );
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const copyDeviceInfoValue = async (value: string, successMessage: string) => {
    try {
      await writeText(value);
      pushToast(successMessage, "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const markDashboardCopied = (copiedKey: string) => {
    setDashboardCopiedKey(copiedKey);
    if (dashboardCopyTimerRef.current !== null) {
      window.clearTimeout(dashboardCopyTimerRef.current);
    }
    dashboardCopyTimerRef.current = window.setTimeout(() => {
      setDashboardCopiedKey((current) => (current === copiedKey ? null : current));
      dashboardCopyTimerRef.current = null;
    }, 1800);
  };

  const copyDashboardText = async (
    text: string,
    successMessage: string,
    copiedKey: string,
  ) => {
    try {
      await writeText(text);
      markDashboardCopied(copiedKey);
      pushToast(successMessage, "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const getDashboardVariantKey = (cardId: DashboardCardId, fieldId: DashboardFieldId): string =>
    `${cardId}:${fieldId}`;

  const isDashboardVariantVisible = (cardId: DashboardCardId, fieldId: DashboardFieldId): boolean =>
    Boolean(dashboardVariantExpanded[getDashboardVariantKey(cardId, fieldId)]);

  const setDashboardVariantOpen = (
    cardId: DashboardCardId,
    fieldId: DashboardFieldId,
    open: boolean,
  ) => {
    const key = getDashboardVariantKey(cardId, fieldId);
    setDashboardVariantExpanded((current) => {
      if (Boolean(current[key]) === open) {
        return current;
      }
      return { ...current, [key]: open };
    });
  };

  const filteredApps = useMemo(() => {
    const query = appsFilter.trim().toLowerCase();
    if (!query) {
      return apps;
    }
    return apps.filter((app) => {
      const pkg = app.package_name.toLowerCase();
      if (pkg.includes(query)) {
        return true;
      }
      const name = getAppDisplayName(app.package_name).toLowerCase();
      return name.includes(query);
    });
  }, [apps, appsFilter]);

  const visibleApps = useMemo(() => {
    return filteredApps.slice(0, Math.max(APPS_PAGE_SIZE, appsVisibleCount));
  }, [filteredApps, appsVisibleCount, APPS_PAGE_SIZE]);

  const canLoadMoreApps = visibleApps.length < filteredApps.length;

  useEffect(() => {
    appsFilteredLenRef.current = filteredApps.length;
    appsCanLoadMoreRef.current = canLoadMoreApps;
  }, [filteredApps.length, canLoadMoreApps]);

  const batchAvailabilityBySerial = useMemo(
    () =>
      Object.fromEntries(
        devices.map((device) => [
          device.summary.serial,
          device.summary.state === "device" && getDevicePlatform(device) === "android",
        ]),
      ),
    [devices],
  );
  const screenshotAvailabilityBySerial = useMemo(
    () =>
      Object.fromEntries(
        devices.map((device) => {
          const online = device.summary.state === "device";
          const platform = getDevicePlatform(device);
          if (!online) {
            return [device.summary.serial, false] as const;
          }
          if (platform === "ios") {
            return [device.summary.serial, hasDeviceCapability(device, "screenshot")] as const;
          }
          return [device.summary.serial, true] as const;
        }),
      ),
    [devices],
  );
  const hasSelectedAndroidActionTarget = selectedSerials.some(
    (serial) => batchAvailabilityBySerial[serial] === true,
  );
  const iosCrashReportEligibleSerials = useMemo(
    () => getIosCrashReportEligibleSerials(selectedDevices),
    [selectedDevices],
  );
  const iosConfigurationProfileEligibleSerials = useMemo(
    () => getIosConfigurationProfileEligibleSerials(selectedDevices),
    [selectedDevices],
  );
  const iosProfileCapableDevices = useMemo(
    () =>
      devices.filter(
        (device) =>
          getDevicePlatform(device) === "ios" &&
          device.summary.state === "device" &&
          hasDeviceCapability(device, "configuration_profiles"),
      ),
    [devices],
  );
  const wifiStateBySerial = useMemo(
    () =>
      Object.fromEntries(
        devices.map((device) => [device.summary.serial, device.detail?.wifi_is_on === true]),
      ),
    [devices],
  );
  const bluetoothStateBySerial = useMemo(
    () =>
      Object.fromEntries(
        devices.map((device) => [device.summary.serial, device.detail?.bt_is_on === true]),
      ),
    [devices],
  );
  const topbarOverview = useMemo(
    () => buildTopbarOverview(devices, selectedSerials, activeSerial),
    [devices, selectedSerials, activeSerial],
  );
  const screenshotActionMeta = useMemo(
    () =>
      buildFanOutActionMeta({
        selectedSerials,
        availabilityBySerial: screenshotAvailabilityBySerial,
        title: "Screenshot",
        singleDescription: "Capture a screenshot from the selected device.",
        multiDescription: "Capture screenshots from eligible selected devices.",
        taskKey: "screenshot",
      }),
    [screenshotAvailabilityBySerial, selectedSerials],
  );
  const rebootActionMeta = useMemo(
    () =>
      buildFanOutActionMeta({
        selectedSerials,
        availabilityBySerial: batchAvailabilityBySerial,
        title: "Reboot",
        singleDescription: "Restart the selected device.",
        multiDescription: "Restart eligible selected devices.",
        taskKey: "reboot",
      }),
    [batchAvailabilityBySerial, selectedSerials],
  );
  const wifiActionMeta = useMemo(
    () =>
      buildConnectivityActionMeta({
        capabilityLabel: "Wi-Fi",
        selectedSerials,
        availabilityBySerial: batchAvailabilityBySerial,
        activeBySerial: wifiStateBySerial,
      }),
    [batchAvailabilityBySerial, selectedSerials, wifiStateBySerial],
  );
  const bluetoothActionMeta = useMemo(
    () =>
      buildConnectivityActionMeta({
        capabilityLabel: "Bluetooth",
        selectedSerials,
        availabilityBySerial: batchAvailabilityBySerial,
        activeBySerial: bluetoothStateBySerial,
      }),
    [batchAvailabilityBySerial, bluetoothStateBySerial, selectedSerials],
  );
  const screenRecordActionMeta = useMemo(
    () =>
      buildScreenRecordActionMeta(
        selectedSerials,
        batchAvailabilityBySerial,
        screenRecordStatusBySerial,
      ),
    [batchAvailabilityBySerial, selectedSerials, screenRecordStatusBySerial],
  );
  const screenRecordSelectionStatus = useMemo(
    () =>
      buildScreenRecordSelectionStatus(
        selectedSerials,
        screenRecordStatusBySerial,
        screenRecordPendingBySerial,
        screenRecordStatusLoading,
      ),
    [screenRecordPendingBySerial, screenRecordStatusBySerial, screenRecordStatusLoading, selectedSerials],
  );
  const deviceQuickActionSelectionStatus = useMemo(
    () => buildDeviceQuickActionSelectionStatus(selectedSerials, deviceQuickActionStatusBySerial),
    [deviceQuickActionStatusBySerial, selectedSerials],
  );
  const deviceCommandStatusStack = useMemo(
    () => buildDeviceCommandStatusStack(deviceQuickActionSelectionStatus, screenRecordSelectionStatus),
    [deviceQuickActionSelectionStatus, screenRecordSelectionStatus],
  );
  const selectedScreenRecordPendingActions = useMemo(
    () =>
      selectedSerials
        .map((serial) => screenRecordPendingBySerial[serial])
        .filter((action): action is ScreenRecordPendingAction => action === "starting" || action === "stopping"),
    [screenRecordPendingBySerial, selectedSerials],
  );
  const screenRecordCommandLabel = selectedScreenRecordPendingActions.includes("stopping")
    ? "Stopping..."
    : selectedScreenRecordPendingActions.includes("starting")
      ? "Starting..."
      : screenRecordActionMeta.title;
  const screenshotCommandLabel = buildDeviceQuickActionButtonLabel(
    screenshotActionMeta.title,
    "Capturing...",
    selectedSerials,
    deviceQuickActionStatusBySerial,
    ["screenshot"],
  );
  const mirrorCommandLabel = buildDeviceQuickActionButtonLabel(
    "Live Mirror",
    "Launching...",
    selectedSerials,
    deviceQuickActionStatusBySerial,
    ["mirror_launch"],
  );
  const rebootCommandLabel = buildDeviceQuickActionButtonLabel(
    rebootActionMeta.title,
    "Sending...",
    selectedSerials,
    deviceQuickActionStatusBySerial,
    ["reboot"],
  );
  const rebootDirectCommandLabel = buildDeviceQuickActionButtonLabel(
    "Reboot…",
    "Sending...",
    selectedSerials,
    deviceQuickActionStatusBySerial,
    ["reboot"],
  );
  const logcatClearActionMeta = useMemo(
    () =>
      buildSingletonActionMeta({
        selectedSerials,
        availabilityBySerial: batchAvailabilityBySerial,
        title: "Clear Logcat",
        readyDescription: "Clear the logcat buffer for the selected device.",
        blockedDescription: "Select exactly one online device to clear the logcat buffer.",
        hint: "Single device",
      }),
    [batchAvailabilityBySerial, selectedSerials],
  );
  const selectedRunningScreenRecords = useMemo(
    () =>
      screenRecordActionMeta.runningSerials
        .map((serial) => screenRecordStatusBySerial[serial] ?? null)
        .filter((item): item is ScreenRecordStatus => item !== null),
    [screenRecordActionMeta.runningSerials, screenRecordStatusBySerial],
  );
  const screenRecordSummaryText = useMemo(() => {
    if (!selectedRunningScreenRecords.length) {
      return null;
    }
    if (selectedRunningScreenRecords.length === 1) {
      return `Recording in progress: ${selectedRunningScreenRecords[0].display_path}`;
    }
    return `Recording in progress on ${selectedRunningScreenRecords.length} selected devices.`;
  }, [selectedRunningScreenRecords]);

  const deviceActionCatalog: DeviceCatalogActionEntry[] = [
    {
      id: "set_primary",
      label: "Set Primary",
      section: "selection",
      scope: "single",
      disabled: busy || selectedCount !== 1 || selectedSerials[0] === activeSerial,
      onSelect: () => {
        const serial = selectedSerials[0];
        if (!serial) {
          return;
        }
        handleSelectActiveSerial(serial);
      },
    },
    {
      id: "copy_device_info",
      label: "Copy Device Info",
      section: "selection",
      scope: "single",
      hideWhenOutOfScope: true,
      disabled: busy || selectedCount !== 1,
      onSelect: () => {},
    },
    {
      id: "screenshot",
      label: screenshotCommandLabel,
      section: "capture",
      scope: "both",
      disabled: busy || selectedCount === 0 || screenshotActionMeta.disabled,
      onSelect: () => {
        void handleQuickScreenshot();
      },
    },
    {
      id: "record",
      label: screenRecordCommandLabel,
      section: "capture",
      scope: "both",
      disabled: busy || selectedCount === 0 || screenRecordStatusLoading || screenRecordActionMeta.disabled,
      onSelect: () => {
        void handleQuickScreenRecord();
      },
    },
    {
      id: "reboot",
      label: rebootCommandLabel,
      section: "control",
      scope: "both",
      tone: "danger",
      disabled: busy || selectedCount === 0 || rebootActionMeta.disabled,
      onSelect: requestRebootConfirm,
    },
    {
      id: "mirror",
      label: mirrorCommandLabel,
      section: "control",
      scope: "both",
      disabled: busy || selectedCount === 0 || !hasSelectedAndroidActionTarget,
      onSelect: () => {
        void handleScrcpyLaunch();
      },
    },
    {
      id: "wifi_enable",
      label: "WiFi On",
      section: "connectivity",
      scope: "both",
      disabled: busy || selectedCount === 0 || wifiActionMeta.eligibleSerials.length === 0,
      onSelect: () => {
        void handleToggleWifi(true);
      },
    },
    {
      id: "wifi_disable",
      label: "WiFi Off",
      section: "connectivity",
      scope: "both",
      disabled: busy || selectedCount === 0 || wifiActionMeta.eligibleSerials.length === 0,
      onSelect: () => {
        void handleToggleWifi(false);
      },
    },
    {
      id: "bluetooth_enable",
      label: "Bluetooth On",
      section: "connectivity",
      scope: "both",
      disabled: busy || selectedCount === 0 || bluetoothActionMeta.eligibleSerials.length === 0,
      onSelect: () => {
        void handleToggleBluetooth(true);
      },
    },
    {
      id: "bluetooth_disable",
      label: "Bluetooth Off",
      section: "connectivity",
      scope: "both",
      disabled: busy || selectedCount === 0 || bluetoothActionMeta.eligibleSerials.length === 0,
      onSelect: () => {
        void handleToggleBluetooth(false);
      },
    },
    {
      id: "logcat_clear",
      label: "Clear Logcat",
      section: "debug",
      scope: "single",
      hideWhenOutOfScope: true,
      disabled: busy || logcatClearActionMeta.disabled,
      onSelect: handleQuickLogcatClear,
    },
    {
      id: "ios_crash_reports",
      label: "Export iOS Crash Reports",
      section: "debug",
      scope: "single",
      hideWhenOutOfScope: true,
      disabled: busy || selectedCount !== 1 || iosCrashReportEligibleSerials.length !== 1,
      onSelect: () => {
        void handleExportIosCrashReports();
      },
    },
    {
      id: "install_configuration_profile",
      label: "Install Configuration Profile",
      section: "more",
      scope: "both",
      disabled:
        busy ||
        selectedCount === 0 ||
        iosConfigurationProfileEligibleSerials.length !== selectedDevices.length,
      hint:
        selectedCount === 0
          ? "Select one or more iOS devices."
          : "Requires online iOS devices and Apple Configurator cfgutil.",
      onSelect: handleOpenConfigurationProfiles,
    },
    {
      id: "apk_installer",
      label: "APK Installer",
      section: "more",
      scope: "both",
      disabled: busy || (selectedCount > 0 && !hasSelectedAndroidActionTarget),
      onSelect: () => {
        navigate("/apk-installer");
      },
    },
  ];

  const deviceActionCatalogMap = new Map(deviceActionCatalog.map((action) => [action.id, action] as const));
  const visibleDeviceContextActions = deviceContextMenu
    ? deviceActionCatalog.filter((action) =>
        deviceContextMenu.visibleActionIds ? deviceContextMenu.visibleActionIds.includes(action.id) : true,
      )
    : [];
  const deviceContextMenuSections = deviceContextMenu
    ? buildDeviceQuickMenuActions({
        source: deviceContextMenu.source,
        scopeKind: selectedSerials.length > 1 ? "multi" : "single",
        outputPath: deviceContextMenu.outputPath,
        actions: visibleDeviceContextActions.map(({ onSelect: _onSelect, ...action }) => action),
      })
    : [];
  const deviceContextMenuActionCount = deviceContextMenuSections.reduce(
    (total, section) => total + section.actions.length,
    0,
  );
  const deviceContextMenuPosition = deviceContextMenu
    ? computeContextMenuLayout({
        anchorX: deviceContextMenu.x,
        anchorY: deviceContextMenu.y,
        menuWidth: 230,
        desiredMenuHeight: Math.max(64, 18 + deviceContextMenuSections.length * 26 + deviceContextMenuActionCount * 36),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        margin: 10,
      })
    : null;
  const filesContextMenuPosition = filesContextMenu
    ? computeContextMenuLayout({
        anchorX: filesContextMenu.x,
        anchorY: filesContextMenu.y,
        menuWidth: 280,
        desiredMenuHeight: 420,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        margin: 10,
      })
    : null;
  const appsContextMenuPosition = appsContextMenu
    ? computeContextMenuLayout({
        anchorX: appsContextMenu.x,
        anchorY: appsContextMenu.y,
        menuWidth: 240,
        desiredMenuHeight: 420,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        margin: 10,
      })
    : null;
  const deviceContextMenuTarget = deviceContextMenu
    ? devices.find((device) => device.summary.serial === (selectedSerials[0] ?? deviceContextMenu.serial)) ?? null
    : null;
  const deviceContextMenuHeaderTitle = deviceContextMenu
    ? selectedSerials.length > 1
      ? `${selectedSerials.length} selected devices`
      : deviceContextMenuTarget?.detail?.model ??
        deviceContextMenuTarget?.summary.model ??
        selectedSerials[0] ??
        deviceContextMenu.serial
    : "";
  const deviceContextMenuHeaderSub = deviceContextMenu
    ? deviceContextMenu.source === "task"
      ? "Task actions for this device"
      : selectedSerials.length > 1
        ? `${selectedOnlineCount}/${selectedCount} online in current selection`
        : formatPrimaryDeviceLabel(selectedSerials[0] ?? deviceContextMenu.serial, deviceContextMenuTarget)
    : "";
  const deviceContextMenuCopyItems = deviceContextMenuTarget
    ? buildDeviceInfoCopyItems(deviceContextMenuTarget)
    : [];
  const deviceContextSubmenuPosition = deviceContextSubmenu
    ? computeContextSubmenuLayout({
        triggerLeft: deviceContextSubmenu.triggerLeft,
        triggerRight: deviceContextSubmenu.triggerRight,
        triggerTop: deviceContextSubmenu.y,
        menuWidth: 250,
        desiredMenuHeight: Math.max(64, 44 + deviceContextSubmenu.items.length * 36),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        margin: 10,
        gutter: 8,
      })
    : null;

  const openDeviceInfoCopySubmenu = (triggerElement: HTMLElement) => {
    if (!deviceContextMenuTarget) {
      return;
    }
    const items = buildDeviceInfoCopyItems(deviceContextMenuTarget);
    if (!items.length) {
      return;
    }
    const rect = triggerElement.getBoundingClientRect();
    setDeviceContextSubmenu({
      x: rect.right + 8,
      y: rect.top,
      triggerLeft: rect.left,
      triggerRight: rect.right,
      title: "Copy Device Info",
      items,
    });
  };

  const dashboardCardClassMap: Record<DashboardCardId, string> = {
    overview: "dashboard-hero",
    device_profile: "dashboard-connection",
    capacity_battery: "dashboard-recents",
    connection_health: "dashboard-health",
  };

  const DashboardView = () => {
    const dashboardSettings = dashboardConfigOpen
      ? normalizeDashboardSettings(dashboardDraft)
      : normalizeDashboardSettings(config?.dashboard);
    const dashboardCards = buildDashboardCardViews(
      {
        devices,
        selectedSerials,
        dashboardSerials: devices.map((device) => device.summary.serial),
        activeSerial,
        runningTaskCount,
        selectedConnectedCount,
        adbAvailable: adbInfo?.available ?? null,
        scrcpyAvailable: scrcpyInfo?.available ?? null,
      },
      dashboardSettings,
    );
    const activeDashboardCard =
      dashboardCards.find((card) => card.id === activeDashboardCardId) ?? dashboardCards[0] ?? null;
    const visibleDashboardCards = activeDashboardCard ? [activeDashboardCard] : [];
    const primaryDeviceParts = resolveDashboardPrimaryDeviceParts(devices, selectedSerials, activeSerial);
    const editableCards = normalizeDashboardSettings(dashboardDraft).cards;
    const dashboardDeviceSections = activeDashboardCard
      ? devices
          .map((device) => {
            const serial = device.summary.serial;
            const title = device.detail?.model ?? device.summary.model ?? serial;
            const alias =
              device.detail?.device_name && device.detail.device_name !== title
                ? device.detail.device_name
                : null;
            const fields = activeDashboardCard.fields.flatMap((field) => {
              const deviceValue = field.deviceValues?.find((item) => item.serial === serial);
              return deviceValue ? [{ field, deviceValue }] : [];
            });
            return { serial, title, alias, state: device.summary.state, fields };
          })
          .filter((section) => section.fields.length > 0)
      : [];
    const handleDashboardTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || dashboardCards.length === 0) {
        return;
      }

      event.preventDefault();
      const currentIndex = activeDashboardCard
        ? dashboardCards.findIndex((card) => card.id === activeDashboardCard.id)
        : 0;
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? dashboardCards.length - 1
            : event.key === "ArrowLeft"
              ? (safeIndex - 1 + dashboardCards.length) % dashboardCards.length
              : (safeIndex + 1) % dashboardCards.length;
      const nextCard = dashboardCards[nextIndex];

      if (!nextCard) {
        return;
      }
      setActiveDashboardCardId(nextCard.id);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-dashboard-tab="${nextCard.id}"]`)?.focus();
    };
    const handleCopyDashboardField = (card: DashboardCardView, field: DashboardCardView["fields"][number]) => {
      const key = `field:${card.id}:${field.id}`;
      const value = buildDashboardPlainValueText(field.value);
      void copyDashboardText(value, `${field.label} value copied.`, key);
    };

    const handleCopyDashboardFieldValue = (
      card: DashboardCardView,
      field: DashboardCardView["fields"][number],
    ) => {
      const key = `field-value:${card.id}:${field.id}`;
      const value = buildDashboardPlainValueText(field.value);
      void copyDashboardText(value, `${field.label} value copied.`, key);
    };

    const handleCopyDashboardVariant = (
      card: DashboardCardView,
      field: DashboardCardView["fields"][number],
      variant: DashboardCardView["fields"][number]["variants"][number],
    ) => {
      const key = `variant:${card.id}:${field.id}:${variant.serial}`;
      const value = buildDashboardPlainValueText(variant.value);
      void copyDashboardText(value, `${field.label} value copied.`, key);
    };

    const handleCopyDashboardVariantValue = (
      card: DashboardCardView,
      field: DashboardCardView["fields"][number],
      variant: DashboardCardView["fields"][number]["variants"][number],
    ) => {
      const key = `variant-value:${card.id}:${field.id}:${variant.serial}`;
      const value = buildDashboardPlainValueText(variant.value);
      void copyDashboardText(value, `${field.label} value copied.`, key);
    };

    const handleCopyDashboardVariantSerial = (
      card: DashboardCardView,
      field: DashboardCardView["fields"][number],
      variant: DashboardCardView["fields"][number]["variants"][number],
    ) => {
      const key = `variant-serial:${card.id}:${field.id}:${variant.serial}`;
      const serial = buildDashboardPlainValueText(variant.serial);
      void copyDashboardText(serial, "Serial copied.", key);
    };

    const handleCopyDashboardDeviceSerial = (serial: string) => {
      const key = `device-serial:${serial}`;
      const value = buildDashboardPlainValueText(serial);
      void copyDashboardText(value, "Serial copied.", key);
    };

    const handleCopyDashboardPrimaryName = () => {
      if (!primaryDeviceParts) {
        return;
      }
      const key = "field-primary-name:overview:primary_device";
      const value = buildDashboardPlainValueText(primaryDeviceParts.name);
      void copyDashboardText(value, "Primary device name copied.", key);
    };

    const handleCopyDashboardPrimarySn = () => {
      if (!primaryDeviceParts) {
        return;
      }
      const key = "field-primary-sn:overview:primary_device";
      const value = buildDashboardPlainValueText(primaryDeviceParts.serial);
      void copyDashboardText(value, "Primary device SN copied.", key);
    };

    const handleCopyDashboardCard = (card: DashboardCardView) => {
      const key = `card:${card.id}`;
      const markdown = buildDashboardCardMarkdown(card, {
        isFieldVariantVisible: isDashboardVariantVisible,
      });
      void copyDashboardText(markdown, `${card.title} copied.`, key);
    };

    const handleCopyDashboardVisible = () => {
      const markdown = buildDashboardVisibleMarkdown(visibleDashboardCards, {
        isFieldVariantVisible: isDashboardVariantVisible,
      });
      if (!markdown) {
        pushToast("Nothing visible to copy.", "error");
        return;
      }
      void copyDashboardText(markdown, "Visible dashboard info copied.", "visible");
    };

    if (adbInfo && !adbInfo.available) {
      return (
        <div className="page-section dashboard-page">
          <div className="page-header">
            <div>
              <h1>Dashboard</h1>
              <p className="muted">ADB is required to connect and manage devices.</p>
            </div>
          </div>
          <section className="panel empty-state">
            <div className="inline-alert error">
              <strong>ADB not available</strong>
              <span>
                Configure the full path to the ADB executable in Settings or install Android Platform
                Tools and ensure <code>adb</code> is on your PATH.
              </span>
              <span className="muted">
                Current command: <code>{adbInfo.command_path || "adb"}</code>
              </span>
              {adbInfo.error && <span className="muted">Error: {adbInfo.error}</span>}
              {getAdbIssueRecoveryMessages(adbInfo).map((message) => (
                <span key={message} className="muted">
                  {message}
                </span>
              ))}
            </div>
            <div className="button-row">
              <button className="ghost" onClick={() => navigate("/settings")}>
                Open Settings
              </button>
              <button onClick={refreshDevices} disabled={busy}>
                Retry
              </button>
            </div>
          </section>
        </div>
      );
    }

    if (!hasDevices) {
      return (
        <div className="page-section dashboard-page">
          <div className="page-header">
            <div>
              <h1>Dashboard</h1>
              <p className="muted">Connect a device to unlock dashboard insights and diagnostics.</p>
            </div>
          </div>
          <section className="panel empty-state">
            <div>
              <h2>Connect a device to get started</h2>
              <p className="muted">
                Plug in via USB or pair wirelessly. Once connected, you will see the device overview
                and health cards here.
              </p>
              <ol className="step-list">
                <li>Enable Developer Options and USB/Wireless Debugging.</li>
                <li>Connect the device via USB or open Wireless Debugging.</li>
                <li>Pair using QR or pairing code, then refresh the device list.</li>
              </ol>
            </div>
            <div className="button-row">
              <button onClick={openPairingModal} disabled={busy}>
                Wireless Pairing
              </button>
              <button className="ghost" onClick={refreshDevices} disabled={busy}>
                Refresh Devices
              </button>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="page-section dashboard-page">
        <div className="page-header">
          <div>
            <h1>Dashboard</h1>
            <p className="muted">Overview and device health.</p>
          </div>
          <div className="page-actions">
            <button onClick={handleCopyDashboardVisible} disabled={visibleDashboardCards.length === 0}>
              {dashboardCopiedKey === "visible" ? "Copied" : "Copy Visible"}
            </button>
            <button className="ghost" onClick={openDashboardConfig} disabled={busy || !config}>
              Configure
            </button>
            <button className="ghost" onClick={() => navigate("/devices")}>
              Open Device Manager
            </button>
          </div>
        </div>
        {selectedSerials.length === 0 && (
          <div className="inline-alert info">
            <strong>No devices selected</strong>
            <span className="muted">Select one or more devices from the top device picker to set the operation target and primary device.</span>
          </div>
        )}
        <div className="dashboard-toolbar" role="status" aria-live="polite">
          <div className="dashboard-toolbar-stats">
            <span className="dashboard-toolbar-stat">
              <strong>{selectedSerials.length}</strong>
              <span>Selected</span>
            </span>
            <span className="dashboard-toolbar-stat">
              <strong>{selectedConnectedCount}</strong>
              <span>Connected</span>
            </span>
            <span className="dashboard-toolbar-stat">
              <strong>{runningTaskCount}</strong>
              <span>Running Tasks</span>
            </span>
          </div>
          <p className="muted">Click any value or copy button to copy that information.</p>
        </div>
        {dashboardCards.length > 0 && (
          <div
            className="dashboard-tabs"
            role="tablist"
            aria-label="Dashboard sections"
            onKeyDown={handleDashboardTabKeyDown}
          >
            {dashboardCards.map((card) => {
              const isActiveTab = activeDashboardCard?.id === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  role="tab"
                  id={`dashboard-tab-${card.id}`}
                  className="dashboard-tab"
                  aria-selected={isActiveTab}
                  aria-controls={`dashboard-panel-${card.id}`}
                  tabIndex={isActiveTab ? 0 : -1}
                  data-dashboard-tab={card.id}
                  onClick={() => setActiveDashboardCardId(card.id)}
                >
                  <span>{card.title}</span>
                  <span className="badge">{card.fields.length}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="dashboard-grid">
          {visibleDashboardCards.length === 0 && (
            <section className="panel card dashboard-info-card dashboard-tab-panel">
              <div className="card-header dashboard-card-header">
                <div>
                  <h2>No dashboard sections enabled</h2>
                  <p className="muted">Open Configure to enable at least one dashboard section.</p>
                </div>
              </div>
            </section>
          )}
          {visibleDashboardCards.map((card) => (
            <section
              key={card.id}
              id={`dashboard-panel-${card.id}`}
              className={`panel card dashboard-info-card dashboard-tab-panel ${
                dashboardCardClassMap[card.id] ?? ""
              }`}
              role="tabpanel"
              aria-labelledby={`dashboard-tab-${card.id}`}
            >
              <div className="card-header dashboard-card-header">
                <div>
                  <h2>{card.title}</h2>
                  <p className="muted">{card.description}</p>
                </div>
                <div className="dashboard-card-actions">
                  <span className="badge">{card.fields.length} fields</span>
                  <button
                    className={`ghost dashboard-copy-button ${dashboardCopiedKey === `card:${card.id}` ? "is-copied" : ""}`}
                    onClick={() => handleCopyDashboardCard(card)}
                    aria-label={`Copy ${card.title} card`}
                  >
                    {dashboardCopiedKey === `card:${card.id}` ? "Copied" : "Copy Card"}
                  </button>
                </div>
              </div>
              {card.fields.length === 0 ? (
                <p className="muted">No fields enabled for this card. Open Configure to enable fields.</p>
              ) : dashboardDeviceSections.length > 0 ? (
                <div className="dashboard-device-sections">
                  {dashboardDeviceSections.map((section) => (
                    <article key={section.serial} className="dashboard-device-block">
                      <div className="dashboard-device-block-header">
                        <div className="dashboard-device-title">
                          <strong>{section.title}</strong>
                          {section.alias && <span className="dashboard-device-alias">{section.alias}</span>}
                          <button
                            type="button"
                            className={`dashboard-device-serial ${dashboardCopiedKey === `device-serial:${section.serial}` ? "is-copied" : ""}`}
                            onClick={() => handleCopyDashboardDeviceSerial(section.serial)}
                            aria-label={`Copy serial ${section.serial}`}
                          >
                            {section.serial}
                          </button>
                        </div>
                        <span className={`status-pill ${getDeviceTone(section.state)}`}>{section.state}</span>
                      </div>
                      <div className="dashboard-device-fields">
                        {section.fields.map(({ field, deviceValue }) => {
                          const variantCopyKey = `variant:${card.id}:${field.id}:${section.serial}`;
                          const variantValueKey = `variant-value:${card.id}:${field.id}:${section.serial}`;
                          const isVariantCopied =
                            dashboardCopiedKey === variantCopyKey || dashboardCopiedKey === variantValueKey;
                          return (
                            <div
                              key={field.id}
                              className={`dashboard-device-field ${isVariantCopied ? "is-copied" : ""}`}
                            >
                              <span className="dashboard-device-field-label">{field.label}</span>
                              <button
                                type="button"
                                className={`dashboard-device-field-value ${dashboardCopiedKey === variantValueKey ? "is-copied" : ""}`}
                                onClick={() => handleCopyDashboardVariantValue(card, field, deviceValue)}
                                aria-label={`Copy ${field.label} for ${section.serial}`}
                              >
                                {deviceValue.value}
                              </button>
                              <button
                                type="button"
                                className={`ghost dashboard-copy-button ${dashboardCopiedKey === variantCopyKey ? "is-copied" : ""}`}
                                onClick={() => handleCopyDashboardVariant(card, field, deviceValue)}
                                aria-label={`Copy ${field.label} value for ${section.serial}`}
                              >
                                {dashboardCopiedKey === variantCopyKey ? "Copied" : "Copy"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="dashboard-fields-grid">
                  {card.fields.map((field) => {
                    const fieldCopyKey = `field:${card.id}:${field.id}`;
                    const fieldValueKey = `field-value:${card.id}:${field.id}`;
                    const primaryNameKey = "field-primary-name:overview:primary_device";
                    const primarySnKey = "field-primary-sn:overview:primary_device";
                    const isPrimaryField = card.id === "overview" && field.id === "primary_device";
                    const isFieldCopied =
                      dashboardCopiedKey === fieldCopyKey ||
                      dashboardCopiedKey === fieldValueKey ||
                      (isPrimaryField &&
                        (dashboardCopiedKey === primaryNameKey || dashboardCopiedKey === primarySnKey));
                    const variantsOpen = isDashboardVariantVisible(card.id, field.id);
                    return (
                      <article
                        key={field.id}
                        className={`dashboard-field ${isFieldCopied ? "is-copied" : ""}`}
                      >
                        <div className="dashboard-field-header">
                          <span className="muted">{field.label}</span>
                          <button
                            className={`ghost dashboard-copy-button ${dashboardCopiedKey === fieldCopyKey ? "is-copied" : ""}`}
                            onClick={() => handleCopyDashboardField(card, field)}
                            aria-label={`Copy ${field.label} value`}
                          >
                            {dashboardCopiedKey === fieldCopyKey ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <button
                          className="dashboard-field-value"
                          onClick={() => handleCopyDashboardFieldValue(card, field)}
                          aria-label={`Copy ${field.label} value`}
                        >
                          <strong>{field.value}</strong>
                        </button>
                        {isPrimaryField && (
                          <div className="dashboard-primary-copy-actions">
                            <button
                              type="button"
                              className={`ghost dashboard-copy-button ${dashboardCopiedKey === primaryNameKey ? "is-copied" : ""}`}
                              onClick={handleCopyDashboardPrimaryName}
                              disabled={!primaryDeviceParts}
                              aria-label="Copy primary device name"
                            >
                              {dashboardCopiedKey === primaryNameKey ? "Copied" : "Copy Name"}
                            </button>
                            <button
                              type="button"
                              className={`ghost dashboard-copy-button ${dashboardCopiedKey === primarySnKey ? "is-copied" : ""}`}
                              onClick={handleCopyDashboardPrimarySn}
                              disabled={!primaryDeviceParts}
                              aria-label="Copy primary device SN"
                            >
                              {dashboardCopiedKey === primarySnKey ? "Copied" : "Copy SN"}
                            </button>
                          </div>
                        )}
                        {field.variants.length > 0 && (
                          <details
                            className="dashboard-variants"
                            open={variantsOpen}
                            onToggle={(event) =>
                              setDashboardVariantOpen(card.id, field.id, event.currentTarget.open)
                            }
                          >
                            <summary className="dashboard-variants-summary muted">View per device</summary>
                            <div className="dashboard-variants-list">
                              {field.variants.map((variant) => {
                                const variantCopyKey = `variant:${card.id}:${field.id}:${variant.serial}`;
                                const variantValueKey = `variant-value:${card.id}:${field.id}:${variant.serial}`;
                                const variantSerialKey = `variant-serial:${card.id}:${field.id}:${variant.serial}`;
                                const isVariantCopied =
                                  dashboardCopiedKey === variantCopyKey ||
                                  dashboardCopiedKey === variantValueKey ||
                                  dashboardCopiedKey === variantSerialKey;
                                return (
                                  <div
                                    key={`${field.id}-${variant.serial}`}
                                    className={`dashboard-variant-row ${isVariantCopied ? "is-copied" : ""}`}
                                  >
                                    <button
                                      type="button"
                                      className={`dashboard-variant-serial ${dashboardCopiedKey === variantSerialKey ? "is-copied" : ""}`}
                                      onClick={() => handleCopyDashboardVariantSerial(card, field, variant)}
                                      aria-label={`Copy serial ${variant.serial}`}
                                    >
                                      {variant.serial}
                                    </button>
                                    <button
                                      className="dashboard-variant-value"
                                      onClick={() => handleCopyDashboardVariantValue(card, field, variant)}
                                      aria-label={`Copy ${field.label} for ${variant.serial}`}
                                    >
                                      {variant.value}
                                    </button>
                                    <button
                                      className={`ghost dashboard-copy-button ${dashboardCopiedKey === variantCopyKey ? "is-copied" : ""}`}
                                      onClick={() => handleCopyDashboardVariant(card, field, variant)}
                                      aria-label={`Copy ${field.label} value for ${variant.serial}`}
                                    >
                                      {dashboardCopiedKey === variantCopyKey ? "Copied" : "Copy"}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
        {dashboardConfigOpen && (
          <div className="dashboard-config-backdrop" role="presentation" onClick={closeDashboardConfig}>
            <aside
              className="dashboard-config-drawer"
              role="dialog"
              aria-label="Configure dashboard cards"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="dashboard-config-header">
                <div>
                  <h2>Configure Dashboard</h2>
                  <p className="muted">Toggle fields and reorder what each card displays.</p>
                </div>
                <button className="ghost" onClick={closeDashboardConfig} disabled={busy}>
                  Close
                </button>
              </div>
              <div className="dashboard-config-body">
                {editableCards.map((card) => {
                  const preview = dashboardCards.find((entry) => entry.id === card.id) as DashboardCardView | undefined;
                  return (
                    <section key={card.id} className="dashboard-config-card">
                      <div className="dashboard-config-card-header">
                        <div>
                          <strong>{preview?.title ?? card.id}</strong>
                          <p className="muted">{preview?.description ?? ""}</p>
                        </div>
                        <label className="dashboard-config-toggle">
                          <input
                            type="checkbox"
                            checked={card.enabled}
                            onChange={(event) => handleDashboardCardToggle(card.id, event.target.checked)}
                            disabled={busy}
                          />
                          <span>{card.enabled ? "Enabled" : "Disabled"}</span>
                        </label>
                      </div>
                      <div className="dashboard-config-fields">
                        {card.fields
                          .slice()
                          .sort((a, b) => a.order - b.order)
                          .map((field, index, arr) => {
                            const label =
                              preview?.fields.find((entry) => entry.id === field.id)?.label ??
                              getDashboardFieldLabel(field.id);
                            return (
                              <div key={field.id} className="dashboard-config-field-row">
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={field.enabled}
                                    onChange={(event) =>
                                      handleDashboardFieldToggle(card.id, field.id, event.target.checked)
                                    }
                                    disabled={busy || !card.enabled}
                                  />
                                  <span>{label}</span>
                                </label>
                                <div className="dashboard-config-field-actions">
                                  <button
                                    className="ghost"
                                    onClick={() => handleDashboardFieldMove(card.id, field.id, "up")}
                                    disabled={busy || index === 0}
                                  >
                                    Up
                                  </button>
                                  <button
                                    className="ghost"
                                    onClick={() => handleDashboardFieldMove(card.id, field.id, "down")}
                                    disabled={busy || index === arr.length - 1}
                                  >
                                    Down
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="dashboard-config-footer">
                <button className="ghost" onClick={handleDashboardReset} disabled={busy}>
                  Reset to Balanced
                </button>
                <button onClick={handleDashboardSave} disabled={busy || !config}>
                  Save
                </button>
              </div>
            </aside>
          </div>
        )}
      </div>
    );
  };

  const getPopoverFocusable = () => {
    const root = devicePopoverRef.current;
    if (!root) {
      return [] as HTMLElement[];
    }
    const items = Array.from(
      root.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    );
    return items.filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
  };

  const handlePopoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      const focusables = getPopoverFocusable();
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const target = event.target as HTMLElement | null;
      if (!event.shiftKey && target === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && target === first) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      const root = devicePopoverRef.current;
      if (!root) {
        return;
      }
      const rows = Array.from(root.querySelectorAll<HTMLElement>(".device-popover-row"));
      if (rows.length === 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const current = target?.closest?.(".device-popover-row") as HTMLElement | null;
      const currentIndex = current ? rows.indexOf(current) : -1;
      let nextIndex = 0;
      if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = rows.length - 1;
      } else if (event.key === "ArrowDown") {
        nextIndex = Math.min(rows.length - 1, currentIndex + 1);
      } else {
        nextIndex = Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1);
      }
      event.preventDefault();
      rows[nextIndex]?.focus();
    }
  };

  const renderDeviceRow = (device: DeviceInfo) => {
    const serial = device.summary.serial;
    const detail = device.detail;
    const name = detail?.model ?? device.summary.model ?? serial;
    const isSelected = selectedSerials.includes(serial);
    const isActive = serial === activeSerial;
    const stateTone =
      device.summary.state === "device"
        ? "ok"
        : device.summary.state === "unauthorized"
          ? "error"
          : "warn";
	    return (
	      <div
	        key={serial}
	        className={`device-popover-row${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
	        onClick={(event) => {
	          const target = event.target as HTMLElement | null;
	          if (target?.closest(".device-check") || target?.closest(".device-primary-action")) {
	            return;
	          }
	          toggleDeviceInContextPopover(serial);
	        }}
	        role="button"
	        tabIndex={0}
	        onKeyDown={(event) => {
	          const target = event.target as HTMLElement | null;
	          if (target?.closest(".device-check") || target?.closest(".device-primary-action")) {
	            return;
	          }
	          if (event.key === "Enter" || event.key === " ") {
	            event.preventDefault();
	            toggleDeviceInContextPopover(serial);
	          }
	        }}
	      >
	        <label className="device-check" onClick={(event) => event.stopPropagation()}>
	          <input
	            type="checkbox"
	            checked={isSelected}
	            onClick={(event) => event.stopPropagation()}
	            onChange={() => toggleDeviceInContextPopover(serial)}
	            disabled={busy}
	            aria-label={`Select ${name}`}
	          />
	        </label>
        <div className="device-popover-meta">
          <span className="device-popover-name">{name}</span>
          <span className="device-popover-serial">{serial}</span>
        </div>
        <span className={`status-pill ${stateTone}`}>{device.summary.state}</span>
        <button
          type="button"
          className={`ghost device-primary-action${isActive ? " is-primary" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!isActive) {
              handleSelectActiveSerial(serial);
            }
          }}
          disabled={busy || isActive}
          aria-label={isActive ? `${name} is primary device` : `Set ${name} as primary device`}
        >
          {isActive ? "Primary" : "Set Primary"}
        </button>
      </div>
    );
  };

  useEffect(() => {
    if (!devicePopoverOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const search = devicePopoverSearchRef.current;
      if (search && !search.hasAttribute("disabled")) {
        search.focus();
        search.select();
        return;
      }
      const focusables = getPopoverFocusable();
      if (focusables.length > 0) {
        focusables[0].focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [devicePopoverOpen]);

  useEffect(() => {
    if (!devicePopoverOpen) {
      setDevicePopoverSearch("");
    }
  }, [devicePopoverOpen]);

  const handleGoToDevices = useCallback(() => {
    navigate("/devices");
  }, [navigate]);

  const handleNetFocusUidChange = useCallback((serial: string, uid: number | null) => {
    setNetProfilerFocusUidBySerial((prev) => ({
      ...prev,
      [serial]: uid,
    }));
  }, []);

  const handleNetToggleFocusUid = useCallback((serial: string, uid: number) => {
    setNetProfilerFocusUidBySerial((prev) => ({
      ...prev,
      [serial]: prev[serial] === uid ? null : uid,
    }));
  }, []);

  const handleApplyNetPinnedUids = useCallback(
    (serial: string, nextPinnedUids: number[], toastMessage: string) => {
      let prevPinned: number[] = [];
      setNetProfilerPinnedUidsBySerial((prev) => {
        prevPinned = prev[serial] ?? [];
        return {
          ...prev,
          [serial]: nextPinnedUids,
        };
      });

      if (!netBySerialRef.current[serial]?.running) {
        pushToast(toastMessage, "info");
        return;
      }

      void setNetProfilerPinnedUids(serial, nextPinnedUids)
        .then(() => {
          pushToast(toastMessage, "info");
        })
        .catch((error) => {
          setNetProfilerPinnedUidsBySerial((prev) => ({
            ...prev,
            [serial]: prevPinned,
          }));
          pushToast(formatError(error), "error");
        });
    },
    [pushToast],
  );

  const handleNotifyInfo = useCallback(
    (message: string) => {
      pushToast(message, "info");
    },
    [pushToast],
  );

  const activePerfState = activeSerial
    ? perfBySerial[activeSerial] ?? EMPTY_PERF_MONITOR_STATE
    : EMPTY_PERF_MONITOR_STATE;
  const activeNetState = activeSerial
    ? netBySerial[activeSerial] ?? EMPTY_NET_PROFILER_STATE
    : EMPTY_NET_PROFILER_STATE;
  const activeNetFocusUid = activeSerial ? netProfilerFocusUidBySerial[activeSerial] ?? null : null;
  const activeNetPinnedUids = activeSerial
    ? netProfilerPinnedUidsBySerial[activeSerial] ?? EMPTY_PINNED_UIDS
    : EMPTY_PINNED_UIDS;

  const renderNetworkBreakdownPanel = () => (
    <NetworkBreakdownPanel
      serial={activeSerial}
      deviceStatus={deviceStatus}
      busy={busy}
      netState={activeNetState}
      intervalMs={netProfilerIntervalMs}
      topN={netProfilerTopN}
      search={netProfilerSearch}
      windowMs={netProfilerWindowMs}
      focusUid={activeNetFocusUid}
      pinnedUids={activeNetPinnedUids}
      onIntervalChange={setNetProfilerIntervalMs}
      onTopNChange={setNetProfilerTopN}
      onSearchChange={setNetProfilerSearch}
      onWindowMsChange={setNetProfilerWindowMs}
      onStart={handleNetProfilerStart}
      onStop={handleNetProfilerStop}
      onFocusUidChange={handleNetFocusUidChange}
      onToggleFocusUid={handleNetToggleFocusUid}
      onApplyPinnedUids={handleApplyNetPinnedUids}
      onNotifyInfo={handleNotifyInfo}
    />
  );

  const PerformanceView = () => (
    <PerformancePage
      activeSerial={activeSerial}
      deviceStatus={deviceStatus}
      busy={busy}
      perfState={activePerfState}
      singleSelectionWarning={singleSelectionWarning}
      singleSelectionWarningMessage={singleSelectionWarningMessage}
      selectedSummaryLabel={selectedSummaryLabel}
      onGoToDevices={handleGoToDevices}
      onPerfStart={handlePerfStart}
      onPerfStop={handlePerfStop}
      networkBreakdown={renderNetworkBreakdownPanel()}
    />
  );

  const NetworkView = () => {
    if (!activeSerial) {
      return (
        <div className="page-section">
          <div className="page-header">
            <div>
              <h1>Network</h1>
              <p className="muted">Per-app network throughput snapshots.</p>
            </div>
          </div>
          <section className="panel empty-state">
            <div>
              <h2>Select a device</h2>
              <p className="muted">Choose an online device to start profiling.</p>
            </div>
            <div className="button-row">
              <button className="ghost" onClick={handleGoToDevices}>
                Go to Device Manager
              </button>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="page-section">
        <div className="page-header">
          <div>
            <h1>Network</h1>
            <p className="muted">Per-app network throughput snapshots.</p>
          </div>
        </div>

        {singleSelectionWarning && (
          <div className="inline-alert info">
            <strong>Primary device in use</strong>
            <span>{singleSelectionWarningMessage}</span>
          </div>
        )}

        {renderNetworkBreakdownPanel()}
      </div>
    );
  };

  const ProfilesView = () => {
    const eligibleSerials = new Set(iosProfileCapableDevices.map((device) => device.summary.serial));
    const validTargets = profileTargetSerials.filter((serial) => eligibleSerials.has(serial));
    const iosDevices = devices.filter((device) => getDevicePlatform(device) === "ios");
    const profileTitle = mobileconfigSummary?.display_name ?? "Unvalidated profile";
    const profileIdentifier = mobileconfigSummary?.identifier ?? "Unknown identifier";

    return (
      <div className="page-section">
        <div className="page-header">
          <div>
            <h1>Profiles</h1>
            <p className="muted">Install configuration profiles on USB-connected iOS devices with Apple Configurator.</p>
          </div>
          <div className="page-actions">
            <span className="badge">macOS cfgutil</span>
            <button className="ghost" onClick={handleCheckIosTools} disabled={busy || profileInstalling}>
              Check Tools
            </button>
          </div>
        </div>

        {hostOs !== "macos" && (
          <div className="inline-alert info">
            <strong>macOS required</strong>
            <span>
              Configuration profile install uses Apple Configurator <code>cfgutil</code>, which is macOS-only.
            </span>
          </div>
        )}

        <section className="panel profiles-panel">
          <div className="panel-header">
            <div>
              <h2>Configuration Profile</h2>
              <span>Select and validate a .mobileconfig file before installing.</span>
            </div>
            <div className="button-row">
              <button className="ghost" onClick={handleBrowseMobileconfigPath} disabled={profileInstalling}>
                Browse
              </button>
              <button
                className="ghost"
                onClick={() => void handleValidateMobileconfigPath()}
                disabled={profileInstalling || !mobileconfigPath.trim()}
              >
                Validate
              </button>
            </div>
          </div>

          <label className="profiles-file-input">
            Profile path
            <input
              value={mobileconfigPath}
              onChange={(event) => {
                setMobileconfigPath(event.target.value);
                setMobileconfigSummary(null);
                setMobileconfigValidationError(null);
                setProfileInstallResults([]);
              }}
              placeholder="/Users/me/Profiles/lab.mobileconfig"
              disabled={profileInstalling}
            />
          </label>

          {mobileconfigValidationError && (
            <div className="inline-alert error">
              <strong>Profile validation failed</strong>
              <span>{mobileconfigValidationError}</span>
            </div>
          )}

          {mobileconfigSummary && (
            <div className="profiles-summary-grid">
              <div className="profiles-summary-item">
                <span className="muted">Name</span>
                <strong>{profileTitle}</strong>
              </div>
              <div className="profiles-summary-item">
                <span className="muted">Identifier</span>
                <strong>{profileIdentifier}</strong>
              </div>
              <div className="profiles-summary-item">
                <span className="muted">UUID</span>
                <strong>{mobileconfigSummary.uuid ?? "Unknown"}</strong>
              </div>
              <div className="profiles-summary-item">
                <span className="muted">Payloads</span>
                <strong>{mobileconfigSummary.payload_count}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="panel profiles-panel">
          <div className="panel-header">
            <div>
              <h2>Targets</h2>
              <span>{validTargets.length} eligible iOS devices selected.</span>
            </div>
            <div className="button-row">
              <button className="ghost" onClick={selectAllProfileTargets} disabled={profileInstalling || iosProfileCapableDevices.length === 0}>
                Select all
              </button>
              <button className="ghost" onClick={clearProfileTargets} disabled={profileInstalling || profileTargetSerials.length === 0}>
                Clear
              </button>
            </div>
          </div>

          {iosDevices.length === 0 ? (
            <div className="empty-state compact">
              <div>
                <h3>No iOS devices detected</h3>
                <p className="muted">Connect an iPhone or iPad over USB, unlock it, trust this Mac, then refresh devices.</p>
              </div>
              <button className="ghost" onClick={() => void refreshDevices()} disabled={busy || profileInstalling}>
                Refresh Devices
              </button>
            </div>
          ) : (
            <div className="profiles-device-list">
              {iosDevices.map((device) => {
                const serial = device.summary.serial;
                const eligible = eligibleSerials.has(serial);
                const name = device.detail?.device_name ?? device.summary.model ?? serial;
                const reason =
                  device.summary.state !== "device"
                    ? "Device is not online."
                    : hasDeviceCapability(device, "configuration_profiles")
                      ? "Ready for cfgutil profile install."
                      : "Apple Configurator cfgutil is missing or unavailable.";
                return (
                  <label key={serial} className={`profiles-device-row ${eligible ? "" : "is-disabled"}`}>
                    <input
                      type="checkbox"
                      checked={profileTargetSerials.includes(serial)}
                      onChange={() => toggleProfileTargetSerial(serial)}
                      disabled={profileInstalling || !eligible}
                    />
                    <span className="profiles-device-main">
                      <strong>{name}</strong>
                      <span className="muted">{serial}</span>
                    </span>
                    <span className="badge">{device.detail?.os_version ? `iOS ${device.detail.os_version}` : "iOS"}</span>
                    <span className="muted profiles-device-reason">{reason}</span>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel profiles-panel">
          <div className="panel-header">
            <div>
              <h2>Install</h2>
              <span>Each selected device is processed independently.</span>
            </div>
            <button
              onClick={requestProfileInstallConfirm}
              disabled={profileInstalling || !mobileconfigSummary || validTargets.length === 0}
            >
              Install Profile
            </button>
          </div>
          <div className="inline-alert info">
            <strong>Device confirmation may be required</strong>
            <span>
              Some profiles require user confirmation, a trusted and unlocked device, or a supervised device. Rejected
              devices are reported per device.
            </span>
          </div>

          {profileInstallResults.length > 0 && (
            <div className="profiles-result-table" role="table" aria-label="Profile install results">
              <div className="profiles-result-row profiles-result-head" role="row">
                <div role="columnheader">Status</div>
                <div role="columnheader">Device</div>
                <div role="columnheader">Message</div>
                <div role="columnheader">Trace</div>
              </div>
              {profileInstallResults.map((result) => {
                const device = devices.find((item) => item.summary.serial === result.serial);
                const name = device?.detail?.device_name ?? device?.summary.model ?? result.serial;
                return (
                  <div className="profiles-result-row" role="row" key={`${result.serial}:${result.trace_id}`}>
                    <div role="cell">
                      <span className={`status-pill ${result.status === "installed" ? "ok" : result.status === "skipped" ? "warn" : "error"}`}>
                        {result.status}
                      </span>
                    </div>
                    <div role="cell">
                      <strong>{name}</strong>
                      <span className="muted">{result.serial}</span>
                    </div>
                    <div role="cell">{result.message}</div>
                    <div role="cell">
                      <code>{result.trace_id}</code>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void copyDeviceInfoValue(result.trace_id, "Trace ID copied.")}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  };

  const DeveloperOptionsView = () => {
    const groupedOptions: DeveloperOptionsGroup[] = DEVELOPER_OPTION_CATEGORY_ORDER
      .map((category) => ({
        category,
        label: DEVELOPER_OPTION_CATEGORY_LABEL[category],
        options: DEVELOPER_OPTIONS.filter((option) => option.category === category),
      }))
      .filter((group) => group.options.length > 0);
    const matrixStaleMessage = resolveDeveloperOptionsMatrixStaleMessage(
      developerOptionsMatrixStaleReason,
      developerOptionsMatrixStaleAt,
    );

    return (
      <Suspense
        fallback={
          <div className="page-section developer-options-page">
            <div className="page-header">
              <div>
                <h1>Developer Options</h1>
                <p className="muted">Preparing developer options...</p>
              </div>
            </div>
            <section className="panel empty-state">
              <div>
                <h2>Loading page</h2>
                <p className="muted">Loading developer options module.</p>
              </div>
            </section>
          </div>
        }
      >
        <LazyDeveloperOptionsPage
          activeSerial={activeSerial}
          busy={busy}
          singleSelectionWarning={singleSelectionWarning}
          singleSelectionWarningMessage={singleSelectionWarningMessage}
          developerOptionsApplyMode={developerOptionsApplyMode}
          setDeveloperOptionsApplyMode={setDeveloperOptionsApplyMode}
          developerOptionsBatchApplying={developerOptionsBatchApplying}
          developerOptionsPendingCount={developerOptionsPendingCount}
          developerOptionsScope={developerOptionsScope}
          developerOptionsLoading={developerOptionsLoading}
          developerOptionsRefreshing={developerOptionsRefreshing}
          developerOptionsLastReadLabel={developerOptionsLastReadLabel}
          developerOptionsSnapshot={developerOptionsSnapshot}
          developerOptionPendingByKey={developerOptionPendingByKey}
          developerOptionSupportedByKey={developerOptionSupportedByKey}
          developerOptionMessageByKey={developerOptionMessageByKey}
          developerOptionsApplyingKey={developerOptionsApplyingKey}
          developerOptionsError={developerOptionsError}
          groupedOptions={groupedOptions}
          developerOptionsMatrixSerials={developerOptionsMatrixSerials}
          developerOptionsMatrixState={developerOptionsMatrixState}
          developerOptionsMatrixRefreshing={developerOptionsMatrixRefreshing}
          developerOptionsMatrixStale={developerOptionsMatrixStale}
          developerOptionsMatrixStaleMessage={matrixStaleMessage}
          developerOptionsMatrixLogBufferState={developerOptionsMatrixLogBufferState}
          developerOptionsMatrixLogBufferLastReadLabel={developerOptionsMatrixLogBufferLastReadLabel}
          developerOptionsMatrixLogBufferError={developerOptionsMatrixLogBufferError}
          developerOptionsMatrixRefreshMode={developerOptionsMatrixRefreshMode}
          developerOptionsDivergenceByKey={developerOptionsDivergenceByKey}
          developerOptionsMatrixLoadingSerialSet={developerOptionsMatrixLoadingSerialSet}
          developerOptionsDivergentSerialSetByKey={developerOptionsDivergentSerialSetByKey}
          onNavigateDevices={() => navigate("/devices")}
          onRefreshPrimary={(hasReadableOptions) => {
            void refreshDeveloperOptionsSnapshot({
              silent: false,
              forceLoading: !hasReadableOptions,
            });
          }}
          onApplyPending={handleDeveloperOptionsApplyPending}
          onDiscardPending={handleDeveloperOptionsDiscardPending}
          onRefreshMatrix={(serials) => {
            void refreshDeveloperOptionsMatrix({
              silent: false,
              serials,
              mode: "fast",
            });
          }}
          onLoadMatrixLogBuffer={() => {
            void loadDeveloperOptionsMatrixLogBuffer();
          }}
          onRequestApply={requestDeveloperOptionApply}
        />
      </Suspense>
    );
  };
  const effectiveThemeStyle = normalizeThemeStyleSettings(config?.ui.theme_style);
  const themeCopy = resolveThemeCopy(effectiveThemeStyle);
  const activeActionsShellTabIndex = ACTIONS_SHELL_TABS.findIndex((tab) => tab.id === activeActionsShellTab);
  const activeActionsShellTabConfig =
    ACTIONS_SHELL_TABS[activeActionsShellTabIndex >= 0 ? activeActionsShellTabIndex : 0] ??
    ACTIONS_SHELL_TABS[0];
  const handleActionsShellTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const currentIndex = activeActionsShellTabIndex >= 0 ? activeActionsShellTabIndex : 0;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? ACTIONS_SHELL_TABS.length - 1
          : event.key === "ArrowLeft"
            ? (currentIndex - 1 + ACTIONS_SHELL_TABS.length) % ACTIONS_SHELL_TABS.length
            : (currentIndex + 1) % ACTIONS_SHELL_TABS.length;
    const nextTab = ACTIONS_SHELL_TABS[nextIndex];

    setActiveActionsShellTab(nextTab.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-actions-shell-tab="${nextTab.id}"]`)?.focus();
  };
  const handleRestartAdbServer = useCallback(async () => {
    setBusy(true);
    try {
      await adbServerControl("restart");
      pushToast("ADB server restarted.", "info");
      await refreshDevices();
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  }, [pushToast, refreshDevices]);
  const handleKillAdbServer = useCallback(async () => {
    setBusy(true);
    try {
      await adbServerControl("kill");
      pushToast("ADB server stopped.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  }, [pushToast]);
  const handleClearAdbInfo = useCallback(() => {
    setAdbInfo(null);
  }, []);
  const handleOpenUpdateModal = useCallback(() => {
    setUpdateModalOpen(true);
  }, []);
  const handleCopyTextWithToast = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await writeText(text);
        pushToast(successMessage, "info");
      } catch (error) {
        pushToast(formatError(error), "error");
      }
    },
    [pushToast],
  );
  const handleCopyAppPackage = useCallback(
    async (packageName: string) => {
      await handleCopyTextWithToast(packageName, "Package copied.");
    },
    [handleCopyTextWithToast],
  );
  const handleOpenRunShell = useCallback(() => {
    setActiveActionsShellTab("adb-shell");
    navigate("/actions");
  }, [navigate]);
  const handleAssignExistingGroup = useCallback(
    (group: string) => {
      setGroupName(group);
      void handleAssignGroupWithName(group);
    },
    [handleAssignGroupWithName],
  );
  const handleCloseDeviceContextMenu = useCallback(() => {
    setDeviceContextMenu(null);
  }, []);
  const handleCloseFilesContextMenu = useCallback(() => {
    setFilesContextMenu(null);
  }, []);
  const handleCloseAppsContextMenu = useCallback(() => {
    setAppsContextMenu(null);
  }, []);
  const handleOpenLogcatPresetUpdateModal = useCallback((name: string) => {
    openPresetUpdateModal("logcat", name);
  }, [openPresetUpdateModal]);
  const handleOpenLogcatPresetDeleteModal = useCallback((name: string) => {
    openPresetDeleteModal("logcat", name);
  }, [openPresetDeleteModal]);
  const themeCssVariables = (config
    ? buildThemeCssVariables(config.ui, {
        isTauriRuntime: isTauriRuntime(),
        convertFileSrc,
      })
    : {}) as CSSProperties;
  const activeUiDensity = normalizeUiDensity(config?.ui.density);

  useEffect(() => {
    if (isDetachedPopupWindow) {
      return;
    }
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShortcutsOverlayOpen(false);
        setCommandPaletteOpen((prev) => !prev);
        return;
      }
      if (isEditableKeyboardTarget(event.target as HTMLElement | null)) {
        return;
      }
      if (event.key === "?" && !mod && !event.altKey) {
        event.preventDefault();
        setCommandPaletteOpen(false);
        setShortcutsOverlayOpen((prev) => !prev);
        return;
      }
      if (event.key === "/" && !mod && !event.altKey) {
        event.preventDefault();
        if (location.pathname !== "/devices") {
          navigate("/devices");
          window.setTimeout(() => {
            deviceSearchInputRef.current?.focus();
          }, 40);
        } else {
          deviceSearchInputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isDetachedPopupWindow, location.pathname, navigate]);

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const navItems: CommandPaletteItem[] = [
      { id: "nav:/", category: "navigation", title: "Dashboard", subtitle: "Overview & device cards", keywords: ["home", "overview"] },
      { id: "nav:/devices", category: "navigation", title: "Device Manager", subtitle: "Connected Android & iOS devices", keywords: ["adb", "groups", "filter"] },
      { id: "nav:/bluetooth", category: "navigation", title: "Bluetooth Monitor", subtitle: "BLE scanning, advertising & events", keywords: ["bt", "ble"] },
      { id: "nav:/logcat", category: "navigation", title: "Logcat", subtitle: "Live Android logcat & iOS syslog", keywords: ["logs", "syslog"] },
      { id: "nav:/network", category: "navigation", title: "Network Profiler", subtitle: "Per-app RX/TX traffic", keywords: ["net", "uid"] },
      { id: "nav:/developer-options", category: "navigation", title: "Developer Options", subtitle: "Batch Android developer settings", keywords: ["dev", "animation", "stay awake"] },
      { id: "nav:/ui-inspector", category: "navigation", title: "UI Inspector", subtitle: "Screenshot bounds & XML hierarchy", keywords: ["uiautomator", "xpath", "layout"] },
      { id: "nav:/bugreport", category: "navigation", title: "Bugreport", subtitle: "Generate Android bugreports", keywords: ["bugreportz", "zip"] },
      { id: "nav:/bugreport-logviewer", category: "navigation", title: "Bugreport Logs", subtitle: "Search indexed bugreport logcat", keywords: ["fts", "analyze"] },
      { id: "nav:/apps", category: "navigation", title: "App Manager", subtitle: "Installed packages & permissions", keywords: ["pm", "uninstall", "clear data"] },
      { id: "nav:/files", category: "navigation", title: "File Explorer", subtitle: "Browse, push, pull & preview device files", keywords: ["sdcard", "transfer"] },
      { id: "nav:/apk-installer", category: "navigation", title: "APK Installer", subtitle: "Install APK / APKS / XAPK bundles", keywords: ["install", "sideload"] },
      { id: "nav:/profiles", category: "navigation", title: "Profiles", subtitle: "iOS configuration profiles", keywords: ["mobileconfig", "ios"] },
      { id: "nav:/actions", category: "navigation", title: "Shell Commands", subtitle: "ADB Command Library & interactive terminal", keywords: ["shell", "terminal", "snippets"] },
      { id: "nav:/performance", category: "navigation", title: "Performance Monitor", subtitle: "CPU, memory, network & FPS", keywords: ["perf", "fps"] },
      { id: "nav:/tasks", category: "navigation", title: "Task Center", subtitle: "Active & recent background tasks", keywords: ["history", "jobs"] },
      { id: "nav:/settings", category: "navigation", title: "Settings", subtitle: "Connectivity, Appearance, System & Operations", keywords: ["preferences", "theme", "density"] },
    ];
    const actionItems: CommandPaletteItem[] = [
      { id: "action:refresh", category: "action", title: "Refresh Devices", subtitle: "Re-scan connected devices", disabled: busy },
      { id: "action:connect", category: "action", title: "Connect Wireless Device", subtitle: "Open ADB Pair / Connect modal", disabled: busy },
      {
        id: "action:screenshot",
        category: "action",
        title: screenshotCommandLabel,
        subtitle: `${selectedCount} selected`,
        disabled: busy || selectedCount === 0 || screenshotActionMeta.disabled,
      },
      {
        id: "action:record",
        category: "action",
        title: screenRecordCommandLabel,
        subtitle: `${selectedCount} selected`,
        disabled: busy || selectedCount === 0 || screenRecordStatusLoading || screenRecordActionMeta.disabled,
      },
      {
        id: "action:mirror",
        category: "action",
        title: mirrorCommandLabel,
        subtitle: "Launch scrcpy mirror",
        disabled: busy || selectedCount === 0 || !hasSelectedAndroidActionTarget,
      },
      { id: "action:shortcuts", category: "action", title: "Show Keyboard Shortcuts", shortcut: "?" },
    ];
    return [
      ...actionItems,
      ...buildDevicePaletteItems(devices),
      ...navItems,
      ...buildRecentTaskPaletteItems(taskState.items),
    ];
  }, [
    busy,
    devices,
    hasSelectedAndroidActionTarget,
    mirrorCommandLabel,
    screenRecordActionMeta.disabled,
    screenRecordCommandLabel,
    screenRecordStatusLoading,
    screenshotActionMeta.disabled,
    screenshotCommandLabel,
    selectedCount,
    taskState.items,
  ]);

  const handleSelectCommandPaletteItem = (item: CommandPaletteItem) => {
    if (item.id.startsWith("nav:")) {
      const target = item.id.slice(4);
      if (target === "/actions") {
        setActiveActionsShellTab("adb-shell");
      }
      navigate(target);
      return;
    }
    if (item.id.startsWith("device:")) {
      const serial = item.id.slice("device:".length);
      handleSelectActiveSerial(serial);
      setSelectedSerials((prev) => (prev.includes(serial) ? prev : [serial]));
      navigate("/devices");
      return;
    }
    if (item.id.startsWith("task:")) {
      navigate("/tasks");
      return;
    }
    switch (item.id) {
      case "action:refresh":
        void refreshDevices();
        break;
      case "action:connect":
        openPairingModal();
        break;
      case "action:screenshot":
        void handleQuickScreenshot();
        break;
      case "action:record":
        void handleQuickScreenRecord();
        break;
      case "action:mirror":
        void handleScrcpyLaunch();
        break;
      case "action:shortcuts":
        setShortcutsOverlayOpen(true);
        break;
    }
  };

  return (
    <div
      className={`app-shell${isDetachedPopupWindow ? " logcat-popup-shell" : ""}`}
      data-density={activeUiDensity}
      style={themeCssVariables}
    >
      {!isDetachedPopupWindow && (
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-title">{themeCopy.app_title}</span>
          <span className="brand-subtitle">{themeCopy.app_subtitle}</span>
        </div>
        <nav className="nav-links">
          <div className="nav-group">
            <span className="nav-title">Connect</span>
            <NavLink to="/" end>
              Dashboard
            </NavLink>
            <NavLink to="/devices">Device Manager</NavLink>
            <NavLink to="/bluetooth">Bluetooth Monitor</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">Debug</span>
            <NavLink to="/logcat">Logcat</NavLink>
            <NavLink to="/network">Network</NavLink>
            <NavLink to="/developer-options">Developer Options</NavLink>
            <NavLink to="/ui-inspector">UI Inspector</NavLink>
            <NavLink to="/bugreport">Bugreport</NavLink>
            <NavLink to="/bugreport-logviewer">Bugreport Logs</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">Manage</span>
            <NavLink to="/apps">App Manager</NavLink>
            <NavLink to="/files">File Explorer</NavLink>
            <NavLink to="/apk-installer">APK Installer</NavLink>
            <NavLink to="/profiles">Profiles</NavLink>
            <NavLink to="/actions" onClick={() => setActiveActionsShellTab("adb-shell")}>
              Shell Commands
            </NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">System</span>
            <NavLink to="/performance">Performance</NavLink>
            <NavLink to="/tasks">Task Center</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </div>
        </nav>
        <div className="sidebar-footer">
          <div className="button-row compact">
            <button
              type="button"
              className="ghost"
              onClick={() => setCommandPaletteOpen(true)}
              title="Open Command Palette (Ctrl+K)"
            >
              Palette (Ctrl+K)
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setShortcutsOverlayOpen(true)}
              title="Keyboard Shortcuts (?)"
              aria-label="Keyboard Shortcuts"
            >
              ?
            </button>
          </div>
          <button className="ghost" onClick={openPairingModal} disabled={busy}>
            Connect Device
          </button>
          <div className="sidebar-status">
            <span className={`status-dot ${hasDevices ? "ok" : "warn"}`} />
            <span>
              <span className="sidebar-status-label">{themeCopy.sidebar_status_label}: </span>
              {runningTaskCount > 0
                ? `${runningTaskCount} tasks running`
                : hasDevices
                  ? `${devices.length} devices`
                  : "No devices"}
            </span>
          </div>
        </div>
      </aside>
      )}

      <div className="app-main">
        {!isDetachedPopupWindow && (
        <header className="top-bar">
          <div className="device-context">
            <div className="device-selector-row">
              <div
                className="device-context-chips"
                ref={devicePopoverTriggerRef}
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setDevicePopoverOpen(!devicePopoverOpen);
                  }
                }}
              >
                {selectedCount === 0 ? (
                  <button
                    className="device-chip picker"
                    onClick={() => setDevicePopoverOpen(!devicePopoverOpen)}
                    disabled={!hasDevices}
                  >
                    Select devices
                  </button>
                ) : (
                  <>
                    {(() => {
                      const serial = selectedSerials[0];
                      const device = devices.find((d) => d.summary.serial === serial);
                      const model = device?.detail?.model ?? device?.summary.model ?? serial;
                      const suffix = serial.length > 4 ? serial.slice(-4) : serial;
                      const tone = getDeviceTone(device?.summary.state ?? "offline");

                      return (
                        <button
                          key={serial}
                          className="device-chip primary"
                          onClick={() => setDevicePopoverOpen(!devicePopoverOpen)}
                          title={`${model} (${serial})`}
                        >
                          <span className={`device-chip-dot ${tone}`} />
                          <span className="device-chip-label">{model}</span>
                          <span className="device-chip-serial">{suffix}</span>
                        </button>
                      );
                    })()}

                    {selectedSerials.slice(1, 3).map((serial) => {
                      const device = devices.find((d) => d.summary.serial === serial);
                      const model = device?.detail?.model ?? device?.summary.model ?? serial;
                      const suffix = serial.length > 4 ? serial.slice(-4) : serial;
                      const tone = getDeviceTone(device?.summary.state ?? "offline");

                      return (
                        <button
                          key={serial}
                          className="device-chip secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectActiveSerial(serial);
                          }}
                          title={`Switch to ${model}`}
                        >
                          <span className={`device-chip-dot ${tone}`} />
                          <span className="device-chip-label">{model}</span>
                          <span className="device-chip-serial">{suffix}</span>
                        </button>
                      );
                    })}

                    {selectedSerials.length > 3 && (
                      <button
                        className="device-chip overflow"
                        onClick={() => setDevicePopoverOpen(!devicePopoverOpen)}
                      >
                        +{selectedSerials.length - 3}
                      </button>
                    )}

                    <button
                      className="device-context-caret-btn"
                      onClick={() => setDevicePopoverOpen(!devicePopoverOpen)}
                      aria-label="Toggle device menu"
                    >
                      ▼
                    </button>
                  </>
                )}
              </div>
              <button className="ghost" onClick={() => navigate("/devices")}>
                Manage
              </button>
            </div>
            {devicePopoverOpen && (
              <div
                id="device-context-popover"
                className="device-popover"
                role="dialog"
                aria-label="Device selection"
                ref={devicePopoverRef}
                style={devicePopoverLeft != null ? { left: devicePopoverLeft } : undefined}
                onKeyDown={handlePopoverKeyDown}
	              >
	                <div className="device-popover-header">
	                  <div className="device-popover-header-top">
	                    <div className="device-popover-header-info">
	                      <strong>Devices</strong>
	                      <span className="muted">
	                        {devicePopoverSearch.trim()
	                          ? `${groupedDevices.filteredCount}/${devices.length} shown`
	                          : `${devices.length} connected`}
	                      </span>
	                    </div>
	                    <div className="device-popover-header-actions">
	                      {deviceSelectionMode === "multi" && (
	                        <button
	                          className="ghost"
	                          onClick={selectAllDevicesInPopover}
	                          disabled={busy || groupedDevices.filteredCount === 0}
	                        >
	                          Select all
	                        </button>
	                      )}
		                      <button
		                        className="ghost"
		                        onClick={clearSelection}
		                        disabled={busy || devices.length === 0}
		                        title={devices.length === 0 ? "No devices detected." : "Keep one device selected."}
		                      >
		                        Keep one
		                      </button>
	                    </div>
	                  </div>

	                  <div className="device-popover-search">
	                    <input
	                      ref={devicePopoverSearchRef}
	                      value={devicePopoverSearch}
	                      onChange={(event) => setDevicePopoverSearch(event.target.value)}
	                      placeholder="Filter devices"
	                      aria-label="Filter devices"
	                    />
	                    <button
	                      type="button"
	                      className="ghost"
	                      onClick={() => setDevicePopoverSearch("")}
	                      disabled={!devicePopoverSearch.trim()}
	                    >
	                      Clear
	                    </button>
	                  </div>

	                  <div className="device-popover-mode" role="group" aria-label="Selection mode">
	                    <button
	                      type="button"
	                      className={deviceSelectionMode === "single" ? "active" : ""}
	                      onClick={() => handleSetDeviceSelectionMode("single")}
	                      disabled={busy}
	                      title="Single device selection"
	                    >
	                      Single
	                    </button>
	                    <button
	                      type="button"
	                      className={deviceSelectionMode === "multi" ? "active" : ""}
	                      onClick={() => handleSetDeviceSelectionMode("multi")}
	                      disabled={busy}
	                      title="Multi-device selection"
	                    >
	                      Multi
	                    </button>
	                  </div>
	                </div>
	                <p className="muted device-popover-note">
	                  Use checkboxes to select devices. Switch modes with Single/Multi. Use Set Primary to choose the
	                  primary device.
	                </p>
                <div className="device-popover-list">
                  {devices.length === 0 ? (
                    <p className="muted">No devices detected.</p>
                  ) : groupedDevices.filteredCount === 0 ? (
                    <p className="muted">No matches.</p>
                  ) : (
                    <>
                      {groupedDevices.selected.length > 0 && (
                        <div className="device-popover-section">
                          <div className="device-popover-section-title">Selected</div>
                          <div className="device-popover-section-body">
                            {groupedDevices.selected.map(renderDeviceRow)}
                          </div>
                        </div>
                      )}
                      {groupedDevices.groupNames.map((group) => (
                        <div className="device-popover-section" key={group}>
                          <div className="device-popover-section-title">{group}</div>
                          <div className="device-popover-section-body">
                            {groupedDevices.grouped.get(group)?.map(renderDeviceRow)}
                          </div>
                        </div>
                      ))}
                      {groupedDevices.ungrouped.length > 0 && (
                        <div className="device-popover-section">
                          <div className="device-popover-section-title">
                            {groupedDevices.groupNames.length > 0 ? "Ungrouped" : "Devices"}
                          </div>
                          <div className="device-popover-section-body">
                            {groupedDevices.ungrouped.map(renderDeviceRow)}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {singleSelectionWarning && (
                  <div className="inline-alert info">
                    <strong>Primary device in use</strong>
                    <span>{singleSelectionWarningMessage}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="top-actions top-actions-deemphasized">
            <div className="top-overview" role="status" aria-live="polite">
              <span className="top-overview-chip is-selected" aria-label={`${topbarOverview.selectedCount} selected devices`}>
                <span className="top-overview-label">Selected</span>
                <strong>{topbarOverview.selectedCount}</strong>
              </span>
              <span className="top-overview-chip is-online" aria-label={`${topbarOverview.onlineSelectedCount} online selected devices`}>
                <span className="top-overview-label">Online</span>
                <strong>{topbarOverview.onlineSelectedCount}</strong>
              </span>
              <span className="top-overview-chip is-primary" aria-label={`Primary device ${topbarOverview.primaryLabel}`}>
                <span className="top-overview-label">Primary</span>
                <strong className={`top-overview-primary ${topbarOverview.primaryTone}`} title={topbarOverview.primaryLabel}>
                  {topbarOverview.primaryLabel}
                </strong>
              </span>
            </div>
            <div className="top-actions-menu-anchor">
              <button
                ref={topActionsMenuButtonRef}
                type="button"
                className="ghost"
                aria-haspopup="menu"
                aria-expanded={topActionsMenuOpen}
                aria-controls="top-actions-menu"
                onClick={() => setTopActionsMenuOpen((prev) => !prev)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown") {
                    return;
                  }
                  event.preventDefault();
                  setTopActionsMenuOpen(true);
                }}
                disabled={busy}
              >
                Actions
              </button>
              {topActionsMenuOpen && (
                <div
                  id="top-actions-menu"
                  ref={topActionsMenuRef}
                  className="context-menu top-actions-menu"
                  role="menu"
                  aria-label="Top actions"
                  onKeyDown={handleTopActionsMenuKeyDown}
                >
                  <button
                    type="button"
                    className="context-menu-item"
                    role="menuitem"
                    onClick={() =>
                      runTopActionsMenuCommand(() => {
                        deviceActionCatalogMap.get("screenshot")?.onSelect();
                      })
                    }
                    disabled={deviceActionCatalogMap.get("screenshot")?.disabled ?? true}
                  >
                    {deviceActionCatalogMap.get("screenshot")?.label ?? "Screenshot"}
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    role="menuitem"
                    onClick={() =>
                      runTopActionsMenuCommand(() => {
                        deviceActionCatalogMap.get("reboot")?.onSelect();
                      })
                    }
                    disabled={deviceActionCatalogMap.get("reboot")?.disabled ?? true}
                  >
                    {deviceActionCatalogMap.get("reboot")?.label ?? "Reboot"}
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    role="menuitem"
                    onClick={() => runTopActionsMenuCommand(openPairingModal)}
                    disabled={busy}
                  >
                    Wireless Pairing
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    role="menuitem"
                    onClick={() => runTopActionsMenuCommand(() => void refreshDevices())}
                    disabled={busy}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    role="menuitem"
                    onClick={() =>
                      runTopActionsMenuCommand(() => {
                        deviceActionCatalogMap.get("mirror")?.onSelect();
                      })
                    }
                    disabled={deviceActionCatalogMap.get("mirror")?.disabled ?? true}
                  >
                    {deviceActionCatalogMap.get("mirror")?.label ?? "Live Mirror"}
                  </button>
                </div>
              )}
            </div>
            <span className={`status-pill ${busy ? "busy" : ""}`}>{busy ? "Working..." : "Idle"}</span>
            <button
              type="button"
              className={`ghost update-indicator ${updateAvailable ? "visible" : "hidden"}`}
              onClick={() => setUpdateModalOpen(true)}
              disabled={!updateAvailable || updateStatus === "installing"}
              aria-hidden={!updateAvailable}
              tabIndex={updateAvailable ? 0 : -1}
              title={updateAvailable ? `Update to ${updateAvailable.version}` : ""}
            >
              Update
            </button>
            <span className="app-version" title={`App version ${appVersionLabel}`}>
              {appVersionLabel}
            </span>
          </div>
        </header>
        )}

        <main className={`page${isDetachedPopupWindow ? " logcat-popup-page" : ""}`}>
          <Routes>
            <Route path="/" element={<RouteView render={DashboardView} />} />
            <Route path="/quick-actions" element={<Navigate to="/devices" replace />} />
            <Route path="/performance" element={<RouteView render={PerformanceView} />} />
            <Route path="/network" element={<RouteView render={NetworkView} />} />
            <Route path="/profiles" element={<RouteView render={ProfilesView} />} />
            <Route path="/developer-options" element={<RouteView render={DeveloperOptionsView} />} />
            <Route
              path="/tasks"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Task Center</h1>
                      <p className="muted">Recent operations with per-device results.</p>
                    </div>
                    <div className="page-actions">
                      <button
                        className="ghost"
                        onClick={() => dispatchTasks({ type: "TASK_CLEAR_COMPLETED" })}
                        disabled={taskState.items.every((task) => task.status === "running")}
                      >
                        Clear completed
                      </button>
                      <button
                        className="ghost"
                        onClick={() => dispatchErrors({ type: "ERROR_CLEAR" })}
                        disabled={errorState.items.length === 0}
                      >
                        Clear errors
                      </button>
                    </div>
                  </div>

                  {taskState.items.length === 0 ? (
                    <section className="panel empty-state">
                      <div>
                        <h2>No tasks yet</h2>
                        <p className="muted">Run an operation to see progress and results here.</p>
                      </div>
                      <div className="button-row">
                        <button className="ghost" onClick={() => navigate("/devices")}>
                          Go to Device Manager
                        </button>
                      </div>
                    </section>
                  ) : (
                    <div className="stack">
                      {taskState.items.map((task) => {
                        const summary = summarizeTask(task);
                        const statusTone =
                          task.status === "running"
                            ? "busy"
                            : task.status === "success"
                              ? "ok"
                              : task.status === "cancelled" || task.status === "interrupted"
                                ? "warn"
                                : "error";
                        return (
                          <section key={task.id} className="panel card task-card">
                            <div className="card-header">
                              <div>
                                <h2>{task.title}</h2>
                                <p className="muted">
                                  {new Date(task.started_at).toLocaleString()} • {task.kind}
                                  {task.trace_id ? ` • ${task.trace_id}` : ""}
                                </p>
                              </div>
                              <span className={`status-pill ${statusTone}`}>{task.status}</span>
                            </div>
                            <div className="task-summary">
                              <span className="badge">{summary.serials.length} devices</span>
                              {summary.counts.running > 0 && (
                                <span className="badge">{summary.counts.running} running</span>
                              )}
                              {summary.counts.success > 0 && (
                                <span className="badge">{summary.counts.success} success</span>
                              )}
                              {summary.counts.error > 0 && (
                                <span className="badge">{summary.counts.error} error</span>
                              )}
                              {summary.counts.cancelled > 0 && (
                                <span className="badge">{summary.counts.cancelled} cancelled</span>
                              )}
                              {summary.counts.interrupted > 0 && (
                                <span className="badge">{summary.counts.interrupted} interrupted</span>
                              )}
                            </div>
                            <div className="task-devices">
                              {summary.serials.map((serial) => {
                                const entry = task.devices[serial];
                                const reportKey = buildGithubReportKey(task.id, serial);
                                const reportPending = Boolean(githubReportPendingByKey[reportKey]);
                                const entryTone =
                                  entry.status === "running"
                                    ? "busy"
                                    : entry.status === "success"
                                      ? "ok"
                                      : entry.status === "cancelled" || entry.status === "interrupted"
                                        ? "warn"
                                        : "error";
                                const extraArtifactPaths = Array.from(new Set(entry.artifact_paths ?? []))
                                  .filter((path) => path.trim())
                                  .filter((path) => path !== entry.output_path);
                                return (
                                  <div
                                    key={serial}
                                    className="task-device-row"
                                    tabIndex={0}
                                    onKeyDown={(event) =>
                                      openDeviceQuickContextMenuFromKeyboard(event, serial, {
                                        source: "task",
                                        outputPath: entry.output_path ?? null,
                                      })
                                    }
                                    onContextMenu={(event) =>
                                      openDeviceQuickContextMenuFromPointer(event, serial, {
                                        source: "task",
                                        outputPath: entry.output_path ?? null,
                                        showSelectionHint: true,
                                      })
                                    }
                                  >
                                    <div className="task-device-main">
                                      <strong>{serial}</strong>
                                      <span className={`status-pill ${entryTone}`}>{entry.status}</span>
                                      {entry.exit_code != null && (
                                        <span className="muted">exit {entry.exit_code}</span>
                                      )}
                                      {entry.progress != null && (
                                        <span className="muted">{Math.round(entry.progress)}%</span>
                                      )}
                                      {entry.message && <span className="muted">{entry.message}</span>}
                                    </div>
                                    <div className="task-device-meta">
                                      {entry.output_path && (
                                        <button className="ghost" onClick={() => void openExternalPath(entry.output_path!)}>
                                          Open output
                                        </button>
                                      )}
                                      {entry.artifact_dir && (
                                        <button className="ghost" onClick={() => void openExternalPath(entry.artifact_dir!)}>
                                          Open folder
                                        </button>
                                      )}
                                      {extraArtifactPaths.map((path, index) => (
                                        <button key={path} className="ghost" onClick={() => void openExternalPath(path)}>
                                          {path.toLowerCase().includes("logcat")
                                            ? "Open logcat"
                                            : `Open artifact ${index + 2}`}
                                        </button>
                                      ))}
                                      {entry.status === "error" && (
                                        <button
                                          className="ghost"
                                          onClick={() => void handleReportTaskIssue(task, serial)}
                                          disabled={reportPending}
                                        >
                                          {reportPending ? "Reporting..." : "Report to GitHub"}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}

                  <section className="panel card task-card">
                    <div className="card-header">
                      <div>
                        <h2>Errors</h2>
                        <p className="muted">Recent non-task failures and uncaught exceptions.</p>
                      </div>
                      <span className={`status-pill ${errorState.items.length > 0 ? "error" : "ok"}`}>
                        {errorState.items.length}
                      </span>
                    </div>
                    {errorState.items.length === 0 ? (
                      <p className="muted">No errors captured.</p>
                    ) : (
                      <div className="task-devices">
                        {errorState.items.map((record) => {
                          const reportKey = buildGithubErrorReportKey(record.id);
                          const reportPending = Boolean(githubReportPendingByKey[reportKey]);
                          return (
                            <div key={record.id} className="task-device-row">
                              <div className="task-device-main">
                                <strong>{record.title}</strong>
                                <span className="status-pill error">error</span>
                                <span className="muted">{new Date(record.created_at).toLocaleString()}</span>
                                <span className="muted">{record.source}</span>
                                {record.trace_id && <span className="muted">{record.trace_id}</span>}
                                {record.serial && <span className="muted">{record.serial}</span>}
                                {record.route && <span className="muted">{record.route}</span>}
                                <span className="muted">{record.message}</span>
                              </div>
                              <div className="task-device-meta">
                                <button
                                  className="ghost"
                                  onClick={() => void handleReportErrorRecord(record)}
                                  disabled={reportPending}
                                >
                                  {reportPending ? "Reporting..." : "Report to GitHub"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              }
            />
            <Route
              path="/devices"
              element={
                <Suspense fallback={null}>
                  <LazyDevicesPage
                  busy={busy}
                  config={config}
                  devices={devices}
                  visibleDevices={visibleDevices}
                  selectedDevices={selectedDevices}
                  connectedDevicesCount={connectedDevicesCount}
                  selectedCount={selectedCount}
                  selectedOnlineCount={selectedOnlineCount}
                  selectedSerials={selectedSerials}
                  setSelectedSerials={setSelectedSerials}
                  activeSerial={activeSerial}
                  searchText={searchText}
                  onSearchTextChange={setSearchText}
                  deviceSearchInputRef={deviceSearchInputRef}
                  groupFilter={groupFilter}
                  onGroupFilterChange={setGroupFilter}
                  groupOptions={groupOptions}
                  groupMap={groupMap}
                  groupName={groupName}
                  onGroupNameChange={setGroupName}
                  groupPanelGroups={groupPanelGroups}
                  deviceSelectionMode={deviceSelectionMode}
                  onSetDeviceSelectionMode={handleSetDeviceSelectionMode}
                  deviceItemInfoFieldIds={deviceItemInfoFieldIds}
                  selectedDeviceItemInfoFieldSet={selectedDeviceItemInfoFieldSet}
                  onResetDeviceItemInfoFields={handleResetDeviceItemInfoFields}
                  onToggleDeviceItemInfoField={handleToggleDeviceItemInfoField}
                  onRefreshDevices={refreshDevices}
                  onSelectAllVisible={selectAllVisible}
                  onClearSelection={clearSelection}
                  deviceQuickFilters={deviceQuickFilters}
                  setDeviceQuickFilters={setDeviceQuickFilters}
                  onClearDeviceFilters={clearDeviceFilters}
                  hasDeviceFilters={hasDeviceFilters}
                  deviceListRef={deviceListRef}
                  lastSelectedIndexRef={lastSelectedIndexRef}
                  retentionMap={retentionMap}
                  screenRecordStatusBySerial={screenRecordStatusBySerial}
                  screenRecordPendingBySerial={screenRecordPendingBySerial}
                  screenRecordStatusLoadingBySerial={screenRecordStatusLoadingBySerial}
                  deviceQuickActionStatusBySerial={deviceQuickActionStatusBySerial}
                  onDeviceRowSelect={handleDeviceRowSelect}
                  onToggleDevice={toggleDevice}
                  onSelectActiveSerial={handleSelectActiveSerial}
                  onDismissRetainedDevice={handleDismissRetainedDevice}
                  onOpenDeviceQuickContextMenuFromKeyboard={openDeviceQuickContextMenuFromKeyboard}
                  onOpenDeviceQuickContextMenuFromPointer={openDeviceQuickContextMenuFromPointer}
                  deviceCommandStatusStack={deviceCommandStatusStack}
                  onQuickScreenshot={handleQuickScreenshot}
                  screenshotDisabled={busy || selectedCount === 0 || screenshotActionMeta.disabled}
                  screenshotCommandLabel={screenshotCommandLabel}
                  onQuickScreenRecord={handleQuickScreenRecord}
                  screenRecordDisabled={
                    busy ||
                    selectedCount === 0 ||
                    screenRecordStatusLoading ||
                    screenRecordActionMeta.disabled
                  }
                  screenRecordCommandLabel={screenRecordCommandLabel}
                  onOpenSelectedDeviceActionMenu={openSelectedDeviceActionMenu}
                  wifiEligibleCount={wifiActionMeta.eligibleSerials.length}
                  bluetoothEligibleCount={bluetoothActionMeta.eligibleSerials.length}
                  onScrcpyLaunch={handleScrcpyLaunch}
                  hasSelectedAndroidActionTarget={hasSelectedAndroidActionTarget}
                  mirrorCommandLabel={mirrorCommandLabel}
                  onOpenRunShell={handleOpenRunShell}
                  onRequestRebootConfirm={requestRebootConfirm}
                  rebootDisabled={busy || selectedCount === 0 || rebootActionMeta.disabled}
                  rebootDirectCommandLabel={rebootDirectCommandLabel}
                  onAssignGroup={handleAssignGroup}
                  onAssignExistingGroup={handleAssignExistingGroup}
                  onClearGroupAssignment={handleClearGroupAssignment}
                  onApplyDeviceGroupFilter={applyDeviceGroupFilter}
                  onClearDeviceGroupFilter={clearDeviceGroupFilter}
                  deviceContextMenu={deviceContextMenu}
                  deviceContextMenuPosition={deviceContextMenuPosition}
                  deviceContextMenuRef={deviceContextMenuRef}
                  onCloseDeviceContextMenu={handleCloseDeviceContextMenu}
                  deviceContextMenuHeaderTitle={deviceContextMenuHeaderTitle}
                  deviceContextMenuHeaderSub={deviceContextMenuHeaderSub}
                  deviceContextMenuSections={deviceContextMenuSections}
                  deviceActionCatalogMap={deviceActionCatalogMap}
                  onOpenDeviceInfoCopySubmenu={openDeviceInfoCopySubmenu}
                  onOpenExternalPath={openExternalPath}
                  deviceContextSubmenu={deviceContextSubmenu}
                  deviceContextSubmenuPosition={deviceContextSubmenuPosition}
                  deviceContextSubmenuRef={deviceContextSubmenuRef}
                  deviceContextMenuCopyItemsCount={deviceContextMenuCopyItems.length}
                  onCopyDeviceInfoValue={copyDeviceInfoValue}
                />
                </Suspense>
              }
            />
            <Route
              path="/actions"
              element={
                <div className="page-section shell-actions-page">
                  <div className="page-header">
                    <div>
                      <h1>Shell Commands</h1>
                      <p className="muted">Interactive terminal sessions across devices.</p>
                    </div>
                  </div>
                  <div className="stack">
                    <div
                      className="shell-actions-tabs"
                      role="tablist"
                      aria-label="Shell command modes"
                      onKeyDown={handleActionsShellTabKeyDown}
                    >
                      {ACTIONS_SHELL_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          id={`actions-shell-tab-${tab.id}`}
                          className="shell-actions-tab"
                          aria-selected={activeActionsShellTab === tab.id}
                          aria-controls={`actions-shell-panel-${tab.id}`}
                          tabIndex={activeActionsShellTab === tab.id ? 0 : -1}
                          data-actions-shell-tab={tab.id}
                          onClick={() => setActiveActionsShellTab(tab.id)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    {activeActionsShellTabConfig.id === "adb-shell" && (
                      <div
                        id="actions-shell-panel-adb-shell"
                        className="shell-actions-tab-panel"
                        role="tabpanel"
                        aria-labelledby="actions-shell-tab-adb-shell"
                      >
                        <Suspense
                          fallback={<div className="panel empty-state muted">Loading command library…</div>}
                        >
                          <LazyAdbCommandLibraryPanel
                            library={config?.adb_command_library}
                            targetSerials={adbCommandTargetSerials}
                            disabled={busy || !config}
                            onSaveLibrary={handleSaveAdbCommandLibrary}
                            onRunCommand={handleRunAdbCommandLibraryEntry}
                            onCopyText={copyAdbCommandLibraryText}
                            onNotify={pushToast}
                          />
                        </Suspense>
                      </div>
                    )}
                    {activeActionsShellTabConfig.id === "utilities" && (
                      <div
                        id="actions-shell-panel-utilities"
                        className="shell-actions-tab-panel"
                        role="tabpanel"
                        aria-labelledby="actions-shell-tab-utilities"
                      >
                        <DeviceUtilitiesPanel
                          targetSerials={adbCommandTargetSerials}
                          outputDir={config?.file_gen_output_path || config?.output_path || ""}
                          disabled={busy}
                          onNotify={pushToast}
                          onAfterServerChange={() => {
                            void refreshDevices();
                          }}
                        />
                      </div>
                    )}
                    {activeActionsShellTabConfig.id === "shell" && (
                      <div
                        id="actions-shell-panel-shell"
                        className="shell-actions-tab-panel shell-actions-terminal-panel"
                        role="tabpanel"
                        aria-labelledby="actions-shell-tab-shell"
                      >
                    <section className="panel settings-panel shell-terminal-header">
                      <div className="panel-header">
                        <h2>Terminal Sessions</h2>
                        <span>{selectedSummaryLabel}</span>
                      </div>
                      {screenRecordSummaryText && (
                        <p className="muted">{screenRecordSummaryText}</p>
                      )}
                      <div className="shell-terminal-toolbar">
                        <div className="shell-terminal-toolbar-left">
                          <button
                            type="button"
                            onClick={handleConnectSelectedTerminals}
                            disabled={busy || selectedSerials.length === 0}
                          >
                            Connect Selected
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={handleDisconnectSelectedTerminals}
                            disabled={busy || selectedSerials.length === 0}
                          >
                            Disconnect Selected
                          </button>
                          <span className="muted shell-terminal-toolbar-meta">
                            {selectedCount ? `${selectedConnectedCount}/${selectedCount} connected` : "No selection"}
                          </span>
                        </div>
                        <div className="shell-terminal-toolbar-right">
                          <input
                            value={terminalBroadcast}
                            onChange={(event) => setTerminalBroadcast(event.target.value)}
                            placeholder="Broadcast to connected terminals…"
                            aria-label="Broadcast command"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleBroadcastSend();
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={handleBroadcastSend}
                            disabled={busy || selectedSerials.length === 0}
                          >
                            Broadcast
                          </button>
                        </div>
                      </div>
                    </section>

                    <div className="shell-terminal-layout">
                      <aside className="panel shell-terminal-sessions">
                        <div className="panel-header">
                          <h3>Active Sessions</h3>
                          <span className="muted">{terminalActiveSerials.length}</span>
                        </div>
                        {terminalActiveSerials.length === 0 ? (
                          <p className="muted">
                            No active sessions yet. Select devices and click Connect Selected.
                          </p>
                        ) : (
                          <div className="shell-terminal-sessions-list">
                            {terminalActiveSerials.map((serial) => {
                              const device = devices.find((item) => item.summary.serial === serial) ?? null;
                              const adbState = device?.summary.state ?? "unknown";
                              const terminalState = terminalBySerial[serial] ?? createDefaultTerminalState();
                              const tone =
                                adbState === "device"
                                  ? terminalState.connected
                                    ? "ok"
                                    : "warn"
                                  : "error";
                              const label =
                                adbState === "device"
                                  ? terminalState.connected
                                    ? "Connected"
                                    : "Disconnected"
                                  : adbState === "unauthorized"
                                    ? "Unauthorized"
                                    : adbState === "offline"
                                      ? "Offline"
                                      : "Missing";
                              return (
                                <div key={serial} className="shell-terminal-session-row">
                                  <button
                                    type="button"
                                    className="shell-terminal-session-main"
                                    onClick={() => setSelectedSerials([serial])}
                                  >
                                    <div className="shell-terminal-session-title">
                                      <span className="shell-terminal-session-serial">{serial}</span>
                                      <span className="muted shell-terminal-session-model">
                                        {device?.detail?.model ?? device?.summary.model ?? ""}
                                      </span>
                                    </div>
                                    <span className={`status-pill ${tone}`}>{label}</span>
                                  </button>
                                  <div className="shell-terminal-session-actions">
                                    <button
                                      type="button"
                                      className="ghost"
                                      onClick={() =>
                                        terminalState.connected
                                          ? void handleDisconnectTerminal(serial)
                                          : void handleConnectTerminal(serial)
                                      }
                                      disabled={busy}
                                    >
                                      {terminalState.connected ? "Disconnect" : "Connect"}
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost"
                                      onClick={() => void handleRemoveTerminalSession(serial)}
                                      disabled={busy}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </aside>

                      <div className="shell-terminal-content">
                        {terminalActiveSerials.length === 0 ? (
                          <section className="panel terminal-empty">
                            <h3>Start a session</h3>
                            <p className="muted">
                              Use the Device Context selector to choose devices, then Connect Selected to pin and restore
                              sessions across restarts.
                            </p>
                          </section>
                        ) : (
                          <div className="terminal-grid">
                            {terminalActiveSerials.map((serial) => {
                              const state = terminalBySerial[serial] ?? createDefaultTerminalState();
                              return (
                                <DeviceTerminalPanel
                                  key={serial}
                                  serial={serial}
                                  state={state}
                                  disabled={busy}
                                  onConnect={handleConnectTerminal}
                                  onDisconnect={handleDisconnectTerminal}
                                  onSend={(targetSerial, command) =>
                                    void handleWriteTerminal(targetSerial, command, true)
                                  }
                                  onInterrupt={(targetSerial) => void handleInterruptTerminal(targetSerial)}
                                  onClear={clearTerminal}
                                  onToggleAutoScroll={setTerminalAutoScroll}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                      </div>
                    )}
                  </div>
                </div>
              }
            />
            <Route
              path="/apk-installer"
              element={
                <div className="page-section">
                  {apkDropActive && (
                    <div className="file-drop-overlay">
                      <div className="file-drop-overlay-inner">
                        <strong>Drop APK files to select</strong>
                        <span className="muted">
                          Mode:{" "}
                          {apkInstallMode === "single"
                            ? "Single APK"
                            : apkInstallMode === "multiple"
                              ? "Multiple APKs"
                              : "Split Bundle"}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="page-header">
                    <div>
                      <h1>APK Installer</h1>
                      <p className="muted">Install single APKs, bundles, or multi-file batches.</p>
                    </div>
                  </div>
                  <div className="stack">
                    <section className="panel bugreport-log-source">
                      <div className="panel-header">
                        <h2>Install Setup</h2>
                        <span>
                          {selectedSerials.length
                            ? `${selectedSerials.length} selected`
                            : "No devices selected"}
                        </span>
                      </div>
                      <div className="form-row">
                        <label>Install Mode</label>
                        <div className="toggle-group">
                          <button
                            type="button"
                            className={`toggle ${apkInstallMode === "single" ? "active" : ""}`}
                            onClick={() => setApkInstallMode("single")}
                          >
                            Single APK
                          </button>
                          <button
                            type="button"
                            className={`toggle ${apkInstallMode === "multiple" ? "active" : ""}`}
                            onClick={() => setApkInstallMode("multiple")}
                          >
                            Multiple APKs
                          </button>
                          <button
                            type="button"
                            className={`toggle ${apkInstallMode === "bundle" ? "active" : ""}`}
                            onClick={() => setApkInstallMode("bundle")}
                          >
                            Split Bundle
                          </button>
                        </div>
                      </div>
                      {apkInstallMode === "single" && (
                        <div className="form-row">
                          <label>APK Path</label>
                          <input
                            value={apkPath}
                            onChange={(event) => setApkPath(event.target.value)}
                            placeholder="Select an APK file"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const selected = await openDialog({
                                title: "Select APK",
                                multiple: false,
                                filters: [{ name: "APK", extensions: ["apk", "apks", "xapk"] }],
                              });
                              if (selected && !Array.isArray(selected)) {
                                setApkPath(selected);
                              }
                            }}
                            disabled={busy}
                          >
                            Browse
                          </button>
                        </div>
                      )}
                      {apkInstallMode === "bundle" && (
                        <div className="form-row">
                          <label>Bundle Path</label>
                          <input
                            value={apkBundlePath}
                            onChange={(event) => setApkBundlePath(event.target.value)}
                            placeholder="Select an .apks or .xapk bundle"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const selected = await openDialog({
                                title: "Select APK Bundle",
                                multiple: false,
                                filters: [{ name: "Bundle", extensions: ["apks", "xapk"] }],
                              });
                              if (selected && !Array.isArray(selected)) {
                                setApkBundlePath(selected);
                              }
                            }}
                            disabled={busy}
                          >
                            Browse
                          </button>
                        </div>
                      )}
                      {apkInstallMode === "multiple" && (
                        <div className="stack">
                          <div className="form-row">
                            <label>APK Files</label>
                            <input
                              value={apkPaths.join(", ")}
                              onChange={(event) =>
                                setApkPaths(
                                  event.target.value
                                    .split(",")
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                                )
                              }
                              placeholder="Select multiple APKs"
                            />
                            <div className="button-row compact">
                              <button
                                type="button"
                                onClick={async () => {
                                  const selected = await openDialog({
                                    title: "Select APKs",
                                    multiple: true,
                                    filters: [{ name: "APK", extensions: ["apk", "apks", "xapk"] }],
                                  });
                                  if (selected) {
                                    const values = Array.isArray(selected) ? selected : [selected];
                                    setApkPaths(values);
                                  }
                                }}
                                disabled={busy}
                              >
                                Browse
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => setApkPaths([])}
                                disabled={busy}
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          {apkPaths.length > 0 && (
                            <div className="list-compact">
                              {apkPaths.map((path) => (
                                <div key={path} className="list-row">
                                  <span>{path}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <ApkInspectionCard
                        info={apkInspectionInfo}
                        loading={apkInspectionLoading}
                        error={apkInspectionError}
                        selectedDevices={selectedDevices}
                        onUsePackageForLaunch={(pkg) => {
                          setApkLaunchAfterInstall(true);
                          setApkLaunchPackage(pkg);
                        }}
                      />
                      <div className="grid-two">
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={apkReplace}
                            onChange={(event) => setApkReplace(event.target.checked)}
                          />
                          Replace existing
                        </label>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={apkAllowDowngrade}
                            onChange={(event) => setApkAllowDowngrade(event.target.checked)}
                          />
                          Allow downgrade
                        </label>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={apkGrant}
                            onChange={(event) => setApkGrant(event.target.checked)}
                          />
                          Grant permissions
                        </label>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={apkAllowTest}
                            onChange={(event) => setApkAllowTest(event.target.checked)}
                          />
                          Allow test packages
                        </label>
                      </div>
                      <div className="form-row">
                        <label>Extra Args</label>
                        <input
                          value={apkExtraArgs}
                          onChange={(event) => setApkExtraArgs(event.target.value)}
                          placeholder="e.g. --force-queryable"
                        />
                        <div className="button-row compact">
                          <button onClick={handleInstallApk} disabled={busy || !selectedSerials.length}>
                            {installBusy ? "Installing…" : "Install"}
                          </button>
                          {installBusy && (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => void handleCancelApkInstall()}
                              disabled={!activeApkInstallTraceId}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label>Launch After Install</label>
                        <div className="inline-row">
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={apkLaunchAfterInstall}
                              onChange={(event) => setApkLaunchAfterInstall(event.target.checked)}
                            />
                            Launch app after install
                          </label>
                          <input
                            value={apkLaunchPackage}
                            onChange={(event) => setApkLaunchPackage(event.target.value)}
                            placeholder="com.example.app"
                            disabled={!apkLaunchAfterInstall}
                          />
                        </div>
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-header">
                        <h2>Latest Results</h2>
                        <span>
                          {latestApkInstallTask
                            ? latestApkInstallTask.status === "running"
                              ? "Running"
                              : "Completed"
                            : apkInstallSummary.length
                              ? "Completed"
                              : "Idle"}
                        </span>
                      </div>
                      <div className="output-block">
                        {latestApkInstallTask ? (
                          (() => {
                            const summary = summarizeTask(latestApkInstallTask);
                            return (
                              <>
                                <div className="task-summary">
                                  <span className="badge">{summary.serials.length} devices</span>
                                  {summary.counts.running > 0 && (
                                    <span className="badge">{summary.counts.running} running</span>
                                  )}
                                  {summary.counts.success > 0 && (
                                    <span className="badge">{summary.counts.success} success</span>
                                  )}
                                  {summary.counts.error > 0 && (
                                    <span className="badge">{summary.counts.error} error</span>
                                  )}
                                  {summary.counts.cancelled > 0 && (
                                    <span className="badge">{summary.counts.cancelled} cancelled</span>
                                  )}
                                  {summary.counts.interrupted > 0 && (
                                    <span className="badge">{summary.counts.interrupted} interrupted</span>
                                  )}
                                </div>
                                <div className="task-devices">
                                  {summary.serials.map((serial) => {
                                    const entry = latestApkInstallTask.devices[serial];
                                    const entryTone =
                                      entry.status === "running"
                                        ? "busy"
                                        : entry.status === "success"
                                          ? "ok"
                                          : entry.status === "cancelled" || entry.status === "interrupted"
                                            ? "warn"
                                            : "error";
                                    return (
                                      <div
                                        key={serial}
                                        className="task-device-row"
                                        tabIndex={0}
                                        onKeyDown={(event) =>
                                          openDeviceQuickContextMenuFromKeyboard(event, serial, {
                                            source: "task",
                                            outputPath: entry.output_path ?? null,
                                          })
                                        }
                                        onContextMenu={(event) =>
                                          openDeviceQuickContextMenuFromPointer(event, serial, {
                                            source: "task",
                                            outputPath: entry.output_path ?? null,
                                            showSelectionHint: true,
                                          })
                                        }
                                      >
                                        <div className="task-device-main">
                                          <strong>{serial}</strong>
                                          <span className={`status-pill ${entryTone}`}>{entry.status}</span>
                                          {entry.status === "running" && entry.progress != null && (
                                            <span className="badge">{entry.progress}%</span>
                                          )}
                                          {entry.message && <span className="muted">{entry.message}</span>}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                {apkInstallSummary.length > 0 && <pre>{apkInstallSummary.join("\n")}</pre>}
                              </>
                            );
                          })()
                        ) : apkInstallSummary.length === 0 ? (
                          <p className="muted">No installs yet.</p>
                        ) : (
                          <pre>{apkInstallSummary.join("\n")}</pre>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              }
            />
            <Route
              path="/files"
              element={
                <FilesPage
                  activeSerial={activeSerial}
                  selectedSummaryLabel={selectedSummaryLabel}
                  singleSelectionWarning={singleSelectionWarning}
                  singleSelectionWarningMessage={singleSelectionWarningMessage}
                  busy={busy}
                  filesDropActive={filesDropActive}
                  filesPath={filesPath}
                  onFilesPathChange={setFilesPath}
                  onFilesGoUp={handleFilesGoUp}
                  onFilesRefresh={handleFilesRefresh}
                  onOpenFilesMkdirModal={openFilesMkdirModal}
                  onFileUpload={handleFileUpload}
                  filesOverwriteEnabled={filesOverwriteEnabled}
                  onFilesOverwriteEnabledChange={setFilesOverwriteEnabled}
                  fileBreadcrumbs={fileBreadcrumbs}
                  filesSearchQuery={filesSearchQuery}
                  onFilesSearchQueryChange={setFilesSearchQuery}
                  filesViewMode={filesViewMode}
                  onFilesViewModeChange={setFilesViewMode}
                  fileFilterSummary={fileFilterSummary}
                  files={files}
                  filteredFiles={filteredFiles}
                  visibleFiles={visibleFiles}
                  canLoadMoreFiles={canLoadMoreFiles}
                  onLoadMoreFiles={loadMoreFiles}
                  filesListRef={filesListRef}
                  filesLoadMoreSentinelRef={filesLoadMoreSentinelRef}
                  filesSelectedPaths={filesSelectedPaths}
                  setFilesSelectedPaths={setFilesSelectedPaths}
                  isFileSelected={isFileSelected}
                  toggleFileSelected={toggleFileSelected}
                  onOpenFilesContextMenu={openFilesContextMenu}
                  onFilePull={handleFilePull}
                  onFilePreview={handleFilePreview}
                  filePreview={filePreview}
                  filePreviewDevicePath={filePreviewDevicePath}
                  onOpenExternalPath={openExternalPath}
                  fileSelectionLabel={fileSelectionLabel}
                  hasFileSelection={hasFileSelection}
                  onFilesPullSelected={handleFilesPullSelected}
                  onOpenFilesDeleteSelectedModal={openFilesDeleteSelectedModal}
                  filesContextMenu={filesContextMenu}
                  filesContextMenuPosition={filesContextMenuPosition}
                  filesContextMenuRef={filesContextMenuRef}
                  onCloseFilesContextMenu={handleCloseFilesContextMenu}
                  onOpenFilesRenameModal={openFilesRenameModal}
                  onOpenFilesDeleteModal={openFilesDeleteModal}
                  onCopyText={handleCopyTextWithToast}
                  onNotifyInfo={handleNotifyInfo}
                />
              }
            />
            <Route
              path="/logcat"
              element={
                <Suspense fallback={null}>
                  <LazyLogcatPage
                  activeSerial={activeSerial}
                  activeDeviceIsIos={activeDeviceIsIos}
                  selectedSummaryLabel={selectedSummaryLabel}
                  isLogcatPopupWindow={isLogcatPopupWindow}
                  logcatPopupSerial={logcatPopupSerial}
                  popupTargetConnected={popupTargetConnected}
                  busy={busy}
                  hasLogcatPopupSelectableCandidate={hasLogcatPopupSelectableCandidate}
                  onOpenLogcatPopupSelectorModal={openLogcatPopupSelectorModal}
                  logcatStatusTone={logcatStatusTone}
                  logcatStatusLabel={logcatStatusLabel}
                  singleSelectionWarning={singleSelectionWarning}
                  singleSelectionWarningMessage={singleSelectionWarningMessage}
                  canStartLogcat={canStartLogcat}
                  canStopLogcat={canStopLogcat}
                  onLogcatStart={handleLogcatStart}
                  onLogcatStop={handleLogcatStop}
                  onLogcatClearBuffer={handleLogcatClearBuffer}
                  onLogcatExport={handleLogcatExport}
                  logcatAutoScroll={logcatAutoScroll}
                  onLogcatAutoScrollChange={setLogcatAutoScroll}
                  onLogcatMirrorLaunch={handleLogcatMirrorLaunch}
                  onLogcatToggleSyncedRecording={handleLogcatToggleSyncedRecording}
                  screenRecordStatusBySerial={screenRecordStatusBySerial}
                  logcatSyncSessionBySerial={logcatSyncSessionBySerial}
                  rawLogcatLines={rawLogcatLines}
                  onExportSyncedLogcatSlice={handleExportSyncedLogcatSlice}
                  logcatActiveFilterSummary={logcatActiveFilterSummary}
                  logcatSourceMode={logcatSourceMode}
                  onLogcatSourceModeChange={setLogcatSourceMode}
                  logcatSourceValue={logcatSourceValue}
                  onLogcatSourceValueChange={setLogcatSourceValue}
                  logcatTextKind={logcatTextKind}
                  onLogcatTextKindChange={setLogcatTextKind}
                  logcatLiveFilter={logcatLiveFilter}
                  onLogcatLiveFilterChange={setLogcatLiveFilter}
                  onAddLogcatLiveFilter={addLogcatLiveFilter}
                  sharedLogTextChips={sharedLogTextChips}
                  setSharedLogTextChips={setSharedLogTextChips}
                  onEditSharedLogFilterChip={editSharedLogFilterChip}
                  onClearSharedLogFilters={clearSharedLogFilters}
                  logcatPresets={logcatPresets}
                  logcatPresetSelected={logcatPresetSelected}
                  onLogcatPresetSelectedChange={setLogcatPresetSelected}
                  logcatPresetName={logcatPresetName}
                  onLogcatPresetNameChange={setLogcatPresetName}
                  selectedLogcatPresetName={selectedLogcatPreset?.name}
                  onApplyLogcatPreset={applyLogcatPreset}
                  onOpenPresetUpdateModal={handleOpenLogcatPresetUpdateModal}
                  onOpenPresetDeleteModal={handleOpenLogcatPresetDeleteModal}
                  onSaveLogcatPreset={saveLogcatPreset}
                  logLevels={logLevels}
                  setLogLevels={setLogLevels}
                  logLevelsSummary={logLevelsSummary}
                  logcatPresetDirty={logcatPresetDirty}
                  logcatSearchRegex={logcatSearchRegex}
                  onLogcatSearchRegexChange={setLogcatSearchRegex}
                  logcatSearchCaseSensitive={logcatSearchCaseSensitive}
                  onLogcatSearchCaseSensitiveChange={setLogcatSearchCaseSensitive}
                  logcatSearchOnly={logcatSearchOnly}
                  onLogcatSearchOnlyChange={setLogcatSearchOnly}
                  logcatLastExport={logcatLastExport}
                  activeLogcatRunning={activeLogcatRunning}
                  activeLogcatStatusLoading={activeLogcatStatusLoading}
                  logcatFilteredLines={logcatFiltered.lines}
                  logcatMatchCount={logcatFiltered.matchIds.length}
                  logcatMatchIndex={logcatMatchIndex}
                  logcatSearchTerm={logcatSearchTerm}
                  onLogcatSearchTermChange={setLogcatSearchTerm}
                  onLogcatClearView={handleLogcatClearView}
                  onLogcatPrevMatch={handleLogcatPrevMatch}
                  onLogcatNextMatch={handleLogcatNextMatch}
                  logcatSearchPattern={logcatSearchPattern}
                  logcatOutputRef={logcatOutputRef}
                />
                </Suspense>
              }
            />
            <Route
              path="/ui-inspector"
              element={
                <Suspense
                  fallback={
                    <div className="page-section page-section-stretch ui-inspector-workspace">
                      <div className="page-header">
                        <div>
                          <h1>UI Inspector</h1>
                          <p className="muted">Loading inspector workspace...</p>
                        </div>
                      </div>
                      <section className="panel empty-state">
                        <div>
                          <h2>Loading UI Inspector</h2>
                          <p className="muted">Preparing capture and hierarchy modules.</p>
                        </div>
                      </section>
                    </div>
                  }
                >
                  <LazyUiInspectorPage
                    selectedSummaryLabel={selectedSummaryLabel}
                    busy={busy}
                    activeSerial={activeSerial}
                    handleUiInspect={handleUiInspect}
                    handleUiExport={handleUiExport}
                    uiAutoSyncIntervalMs={uiAutoSyncIntervalMs}
                    setUiAutoSyncIntervalMs={setUiAutoSyncIntervalMs}
                    uiAutoSyncEnabled={uiAutoSyncEnabled}
                    handleUiAutoSyncToggle={handleUiAutoSyncToggle}
                    singleSelectionWarning={singleSelectionWarning}
                    singleSelectionWarningMessage={singleSelectionWarningMessage}
                    uiExportResult={uiExportResult}
                    uiAutoSyncLastAt={uiAutoSyncLastAt}
                    uiScreenshotSrc={uiScreenshotSrc}
                    uiAutoSyncError={uiAutoSyncError}
                    uiZoom={uiZoom}
                    setUiZoom={setUiZoom}
                    uiScreenshotImgRef={uiScreenshotImgRef}
                    setUiScreenshotSize={setUiScreenshotSize}
                    uiBoundsCanvasRef={uiBoundsCanvasRef}
                    uiBoundsEnabled={uiBoundsEnabled}
                    setUiHoveredNodeIndex={setUiHoveredNodeIndex}
                    uiLastPointerRef={uiLastPointerRef}
                    uiHoverRafRef={uiHoverRafRef}
                    uiNodesParse={uiNodesParse}
                    pickUiNodeAtPoint={pickUiNodeAtPoint}
                    setUiSelectedNodeIndex={setUiSelectedNodeIndex}
                    uiHoveredNodeIndex={uiHoveredNodeIndex}
                    uiScreenshotError={uiScreenshotError}
                    setUiBoundsEnabled={setUiBoundsEnabled}
                    uiSelectedNode={uiSelectedNode}
                    uiHoveredNode={uiHoveredNode}
                    uiInspectorTab={uiInspectorTab}
                    setUiInspectorTab={setUiInspectorTab}
                    uiXmlViewMode={uiXmlViewMode}
                    setUiXmlViewMode={setUiXmlViewMode}
                    handleUiCopyXml={handleUiCopyXml}
                    filteredUiXml={filteredUiXml}
                    uiInspectorSearch={uiInspectorSearch}
                    setUiInspectorSearch={setUiInspectorSearch}
                    uiHtml={uiHtml}
                    uiHierarchyFrameRef={uiHierarchyFrameRef}
                    setUiHierarchyFrameToken={setUiHierarchyFrameToken}
                    uiXml={uiXml}
                    uiXmlView={uiXmlView}
                  />
                </Suspense>
              }
            />
            <Route
              path="/apps"
              element={
                <AppsPage
                  activeSerial={activeSerial}
                  appsSerial={appsSerial}
                  selectedSummaryLabel={selectedSummaryLabel}
                  singleSelectionWarning={singleSelectionWarning}
                  singleSelectionWarningMessage={singleSelectionWarningMessage}
                  busy={busy}
                  appsFilter={appsFilter}
                  onAppsFilterChange={setAppsFilter}
                  appsThirdPartyOnly={appsThirdPartyOnly}
                  onAppsThirdPartyOnlyChange={setAppsThirdPartyOnly}
                  appsIncludeVersions={appsIncludeVersions}
                  onAppsIncludeVersionsChange={setAppsIncludeVersions}
                  appsLoading={appsLoading}
                  onLoadApps={handleLoadApps}
                  apps={apps}
                  filteredApps={filteredApps}
                  visibleApps={visibleApps}
                  canLoadMoreApps={canLoadMoreApps}
                  onLoadMoreApps={loadMoreApps}
                  appIconsByKey={appIconsByKey}
                  appsListRef={appsListRef}
                  appsLoadMoreSentinelRef={appsLoadMoreSentinelRef}
                  selectedApp={selectedApp}
                  selectedAppDetails={selectedAppDetails}
                  appsDetailsBusy={appsDetailsBusy}
                  onSelectAppRow={handleSelectAppRow}
                  onAppDoubleClick={handleAppDoubleClick}
                  onAppContextMenu={handleAppContextMenu}
                  onAppAction={handleAppAction}
                  onContextForceStop={handleContextForceStop}
                  onCopyPackageName={handleCopyAppPackage}
                  appsContextMenu={appsContextMenu}
                  appsContextMenuPosition={appsContextMenuPosition}
                  appsContextMenuRef={appsContextMenuRef}
                  onCloseAppsContextMenu={handleCloseAppsContextMenu}
                />
              }
            />
            <Route
              path="/bugreport"
              element={
                <Suspense
                  fallback={
                    <div className="page-section bugreport-page">
                      <div className="page-header">
                        <div>
                          <h1>Bugreport</h1>
                          <p className="muted">Loading bugreport workspace...</p>
                        </div>
                      </div>
                      <section className="panel empty-state bugreport-empty-state">
                        <div>
                          <h2>Loading Bugreport</h2>
                          <p className="muted">Preparing batch run panel and device status cards.</p>
                        </div>
                      </section>
                    </div>
                  }
                >
                  <LazyBugreportPage
                    busy={busy}
                    selectedSummaryLabel={selectedSummaryLabel}
                    bugreportCardSummary={bugreportCardSummary}
                    bugreportGenerateLabel={bugreportGenerateLabel}
                    bugreportOutputPaths={bugreportOutputPaths}
                    bugreportCards={bugreportCards}
                    bugreportStatusTone={BUGREPORT_STATUS_TONE}
                    bugreportStatusLabel={BUGREPORT_STATUS_LABEL}
                    onRunBugreport={() => void handleBugreport()}
                    onCancelRunning={() => void handleCancelBugreport()}
                    onOpenOutputs={() => void handleOpenBugreportOutputs()}
                    onOpenDeviceContextKeyboard={openDeviceQuickContextMenuFromKeyboard}
                    onOpenDeviceContextPointer={openDeviceQuickContextMenuFromPointer}
                    onOpenOutputPath={(path) => {
                      void openExternalPath(path);
                    }}
                    onCancelSerial={(serial) => {
                      void cancelBugreportForSerials([serial]);
                    }}
                    onRetrySerial={(serial) => {
                      void handleRetryBugreport(serial);
                    }}
                    onGoDeviceManager={() => navigate("/devices")}
                    onRefreshDevices={refreshDevices}
                  />
                </Suspense>
              }
            />
            <Route
              path="/bugreport-logviewer/custom-views"
              element={
                <div className="page-section bugreport-customviews-page">
                  <div className="page-header">
                    <div>
                      <h1>Bugreport Custom Views</h1>
                      <p className="muted">
                        Create reusable extraction templates for Service, App, or Keyword lookup.
                      </p>
                    </div>
                    <div className="page-actions">
                      <button className="ghost" onClick={() => navigate("/bugreport-logviewer")}>
                        Back to Logs
                      </button>
                    </div>
                  </div>
                  <div className="bugreport-customviews-layout">
                    <section className="panel bugreport-customviews-sidebar">
                      <div className="panel-header">
                        <h2>Views</h2>
                        <span>{bugreportCustomViews.length}</span>
                      </div>
                      <div className="button-row compact">
                        <button
                          className="ghost"
                          onClick={() => {
                            setBugreportCustomViewSelectedId("");
                            setBugreportCustomViewEditor(makeBugreportCustomViewEditor(null));
                          }}
                        >
                          New View
                        </button>
                      </div>
                      {groupedBugreportCustomViews.length === 0 ? (
                        <p className="muted">No custom views yet.</p>
                      ) : (
                        <div className="bugreport-customviews-groups">
                          {groupedBugreportCustomViews.map((entry) => (
                            <div key={entry.group} className="bugreport-customviews-group">
                              <h3>{entry.group}</h3>
                              <div className="bugreport-customviews-list">
                                {entry.views.map((view) => (
                                  <button
                                    key={view.id}
                                    type="button"
                                    className={`bugreport-customviews-item${
                                      bugreportCustomViewSelectedId === view.id ? " active" : ""
                                    }`}
                                    onClick={() => setBugreportCustomViewSelectedId(view.id)}
                                  >
                                    {view.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="panel bugreport-customviews-editor">
                      <div className="panel-header">
                        <h2>{selectedBugreportCustomView ? "Edit Custom View" : "New Custom View"}</h2>
                        <span>{selectedBugreportCustomView ? selectedBugreportCustomView.id : "Draft"}</span>
                      </div>
                      <div className="stack">
                        <div className="form-row">
                          <label htmlFor="custom-view-group">Group</label>
                          <input
                            id="custom-view-group"
                            value={bugreportCustomViewEditor.group}
                            onChange={(event) =>
                              setBugreportCustomViewEditor((prev) => ({ ...prev, group: event.target.value }))
                            }
                            placeholder={DEFAULT_BUGREPORT_CUSTOM_VIEW_GROUP}
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="custom-view-name">Name</label>
                          <input
                            id="custom-view-name"
                            value={bugreportCustomViewEditor.name}
                            onChange={(event) =>
                              setBugreportCustomViewEditor((prev) => ({ ...prev, name: event.target.value }))
                            }
                            placeholder="e.g. Bluetooth Service"
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="custom-view-template-kind">Template Kind</label>
                          <select
                            id="custom-view-template-kind"
                            value={bugreportCustomViewEditor.templateKind}
                            onChange={(event) =>
                              setBugreportCustomViewEditor((prev) => ({
                                ...prev,
                                templateKind: event.target.value as BugreportExtractTemplateKind,
                              }))
                            }
                          >
                            {BUGREPORT_CUSTOM_VIEW_TEMPLATE_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {kind[0].toUpperCase() + kind.slice(1)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-row">
                          <label htmlFor="custom-view-default-input">Default Input</label>
                          <input
                            id="custom-view-default-input"
                            value={bugreportCustomViewEditor.defaultInput}
                            onChange={(event) =>
                              setBugreportCustomViewEditor((prev) => ({
                                ...prev,
                                defaultInput: event.target.value,
                              }))
                            }
                            placeholder="e.g. bluetooth_manager / com.android.bluetooth"
                          />
                        </div>
                      </div>
                      <div className="button-row compact">
                        <button onClick={saveBugreportCustomView} disabled={!bugreportCustomViewEditor.name.trim()}>
                          Save New
                        </button>
                        <button
                          className="ghost"
                          onClick={updateBugreportCustomView}
                          disabled={!bugreportCustomViewEditor.id || !bugreportCustomViewEditorDirty}
                        >
                          Update
                        </button>
                        <button
                          className="danger"
                          onClick={deleteBugreportCustomView}
                          disabled={!bugreportCustomViewEditor.id}
                        >
                          Delete
                        </button>
                      </div>
                      <div className="stack">
                        <div className="form-row">
                          <label htmlFor="custom-view-run-input">Run Input</label>
                          <input
                            id="custom-view-run-input"
                            value={bugreportCustomViewRunInput}
                            onChange={(event) =>
                              setBugreportCustomViewRunInput(event.target.value)
                            }
                            placeholder="Enter one service / app / keyword"
                          />
                        </div>
                        <div className="button-row compact">
                          <button
                            onClick={runBugreportCustomView}
                            disabled={
                              !bugreportCustomViewEditor.id ||
                              bugreportCustomViewEditorDirty ||
                              bugreportCustomViewRunBusy
                            }
                          >
                            {bugreportCustomViewRunBusy ? "Running..." : "Run"}
                          </button>
                          <button
                            className="ghost"
                            onClick={() =>
                              setBugreportCustomViewRunInput(selectedBugreportCustomView?.default_input ?? "")
                            }
                            disabled={!bugreportCustomViewEditor.id || bugreportCustomViewRunBusy}
                          >
                            Use Default
                          </button>
                        </div>
                        {!bugreportLogSummary ? (
                          <p className="muted">
                            Load a bugreport first in Log Viewer before running template extraction.
                          </p>
                        ) : bugreportExtractSummary ? (
                          <p className="muted">
                            Extract index ready: {bugreportExtractSummary.total_sections.toLocaleString()} sections,{" "}
                            {bugreportExtractSummary.total_lines.toLocaleString()} lines.
                          </p>
                        ) : (
                          <p className="muted">Extract index is not ready yet.</p>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              }
            />
            <Route
              path="/bugreport-logviewer"
              element={
                <div className="page-section page-section-stretch bugreport-logviewer-page bugreport-logviewer-workspace">
                  <div className="page-header">
                    <div>
                      <h1>Bugreport Log Viewer</h1>
                      <p className="muted">Load bugreport logs and inspect with live filters and find.</p>
                    </div>
                    <div className="page-actions">
                      <button onClick={handlePickBugreportLogFile} disabled={bugreportLogBusy}>
                        Browse
                      </button>
                      {BUGREPORT_CUSTOM_VIEW_ENTRY_VISIBLE && (
                        <button className="ghost" onClick={() => navigate("/bugreport-logviewer/custom-views")}>
                          Custom Views
                        </button>
                      )}
                      <button
                        className="ghost"
                        onClick={() => void handleOpenBugreportLogPopup()}
                      >
                        Open in New Window
                      </button>
                    </div>
                  </div>
                  <section className="panel panel-stretch bugreport-log-panel bugreport-log-panel-full">
                    <div className="bugreport-log-header-shell">
                      <div className="bugreport-log-header-top">
                        <div className="bugreport-log-title-block">
                          <h2>Log Output</h2>
                          <span>
                            {bugreportLogSummary
                              ? `${bugreportLogRows.length.toLocaleString()} / ${bugreportLogSummary.total_rows.toLocaleString()} rows loaded`
                              : bugreportLogRows.length
                                ? `${bugreportLogRows.length.toLocaleString()} rows loaded`
                                : "No rows yet"}
                          </span>
                        </div>
                        <div className="button-row compact bugreport-log-actions-group">
                          <button
                            className="ghost"
                            onClick={() => {
                              if (bugreportLogSummary) {
                                void runBugreportLogQuery(bugreportLogSummary.report_id, 0, false);
                              }
                            }}
                            disabled={!bugreportLogSummary || bugreportLogBusy || bugreportLogLoadAllRunning}
                          >
                            Refresh
                          </button>
                          <button
                            onClick={() => {
                              if (bugreportLogSummary) {
                                void runBugreportLogQuery(bugreportLogSummary.report_id, bugreportLogOffset, true);
                              }
                            }}
                            disabled={
                              !bugreportLogSummary || bugreportLogBusy || bugreportLogLoadAllRunning || !bugreportLogHasMore
                            }
                          >
                            Load more
                          </button>
                          {bugreportLogLoadAllRunning ? (
                            <button className="ghost" onClick={handleBugreportLogStopLoadAll}>
                              Stop
                            </button>
                          ) : (
                            <button
                              className="ghost"
                              onClick={() => void handleBugreportLogLoadAll()}
                              disabled={
                                !bugreportLogSummary ||
                                bugreportLogBusy ||
                                !bugreportLogHasMore ||
                                bugreportLogLoadAllLimitReached
                              }
                            >
                              Load all
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="bugreport-log-meta-strip">
                        <div className="bugreport-log-meta-main">
                          <div className="bugreport-log-source-inline-row">
                            <span className="badge">Source</span>
                            <span className="bugreport-log-source-path">
                              {bugreportLogSourcePath ? bugreportLogSourcePath : "No file selected. Click Browse to load."}
                            </span>
                          </div>
                          {bugreportLogSummary && (
                            <div className="bugreport-log-source-inline-meta muted">
                              Rows: {bugreportLogSummary.total_rows.toLocaleString()} · Range: {bugreportLogSummary.min_ts ?? "--"}{" "}
                              {"->"} {bugreportLogSummary.max_ts ?? "--"}
                            </div>
                          )}
                        </div>
                        {bugreportAnalysisTargets.length > 0 && (
                          <details className="output-block bugreport-log-recent bugreport-log-recent-inline">
                            <summary>Recent outputs</summary>
                            <div className="form-row">
                              <label>Output</label>
                              <select
                                value={bugreportLogSourcePath}
                                onChange={(event) => {
                                  void loadBugreportLogFromPath(event.target.value);
                                }}
                              >
                                <option value="">Select output</option>
                                {bugreportAnalysisTargets.map((item) => (
                                  <option key={item.output_path} value={item.output_path}>
                                    {item.serial} - {item.output_path}
                                  </option>
                                ))}
                                {bugreportLogSourcePath && !bugreportLogOutputPaths.has(bugreportLogSourcePath) && (
                                  <option value={bugreportLogSourcePath}>
                                    Custom - {bugreportLogSourcePath}
                                  </option>
                                )}
                              </select>
                            </div>
                          </details>
                        )}
                      </div>
                    </div>

                    {bugreportLogError && (
                      <div className="inline-alert error">
                        <strong>Log viewer error</strong>
                        <span>{bugreportLogError}</span>
                      </div>
                    )}
                    {bugreportExtractPreparing && (
                      <div className="inline-alert info">
                        <strong>Preparing extract index</strong>
                        <span>Building section and keyword index from the full bugreport...</span>
                      </div>
                    )}
                    {bugreportLogBusy && !bugreportExtractPreparing && (
                      <div className="inline-alert info">
                        <strong>Working</strong>
                        <span>Preparing or querying logcat...</span>
                      </div>
                    )}
                    {bugreportCustomViewRunBusy && activeBugreportCustomViewSession && (
                      <div className="inline-alert info">
                        <strong>Updating custom view result</strong>
                        <span>Running extraction query with current overlay preset...</span>
                      </div>
                    )}
                    {bugreportLogLoadAllRunning && (
                      <div className="inline-alert info">
                        <strong>Loading all rows</strong>
                        <span>Fetching logcat pages in the background...</span>
                      </div>
                    )}
                    {bugreportLogLoadAllLimitReached && (
                      <div className="inline-alert info">
                        <strong>Row limit reached</strong>
                        <span>
                          Showing the first {BUGREPORT_LOG_LOAD_ALL_MAX_ROWS.toLocaleString()} rows. Use filters or Load more
                          for narrower follow-up pages.
                        </span>
                      </div>
                    )}
                    {activeBugreportCustomViewSession && activeBugreportCustomView && (
                      <div className="inline-alert info bugreport-custom-view-active">
                        <div className="bugreport-custom-view-active-main">
                          <strong>
                            Custom View Active: {activeBugreportCustomView.group} / {activeBugreportCustomView.name}
                          </strong>
                          <span className="muted">
                            Template: {activeBugreportCustomView.template_kind} · Input:{" "}
                            <code>{activeBugreportCustomViewSession.input_value}</code>
                          </span>
                        </div>
                        <div className="bugreport-custom-view-active-actions">
                          <label className="muted" htmlFor="bugreport-custom-view-overlay">
                            Overlay on Custom View
                          </label>
                          <select
                            id="bugreport-custom-view-overlay"
                            value={activeBugreportCustomViewSession.overlay_preset_name ?? ""}
                            onChange={(event) => setActiveCustomViewOverlayPreset(event.target.value)}
                            disabled={bugreportCustomViewRunBusy}
                          >
                            <option value="">None</option>
                            {bugreportPresets.map((preset) => (
                              <option key={preset.name} value={preset.name}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="ghost"
                            onClick={() => setActiveCustomViewOverlayPreset("")}
                            disabled={
                              !activeBugreportCustomViewSession.overlay_preset_name ||
                              bugreportCustomViewRunBusy
                            }
                          >
                            Clear Overlay
                          </button>
                          <button className="ghost" onClick={clearActiveBugreportCustomView}>
                            Exit Custom View
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="bugreport-log-toolbar">
	                      {(() => {
	                        if (activeBugreportCustomViewSession) {
	                          return null;
	                        }
	                        const chips: Array<{ key: string; label: string; tone?: "exclude" | "info" }> = [];
                          const buffer = bugreportLogBuffer.trim();
                          if (buffer) {
                            chips.push({ key: "buffer", label: `Buffer: ${buffer}` });
                          }

                          const enabledLevels = LOG_LEVELS.filter((level) => logLevels[level]);
                          if (enabledLevels.length !== LOG_LEVELS.length) {
                            chips.push({ key: "levels", label: `Levels: ${enabledLevels.join("")}` });
                          }

                          const tag = bugreportLogTag.trim();
                          if (tag) {
                            chips.push({ key: "tag", label: `Tag: ${tag}` });
                          }

                          const pid = bugreportLogPid.trim();
                          if (pid) {
                            chips.push({ key: "pid", label: `PID: ${pid}` });
                          }

                          const start = bugreportLogStart.trim();
                          if (start) {
                            chips.push({ key: "start", label: `Start: ${start}` });
                          }

                          const end = bugreportLogEnd.trim();
                          if (end) {
                            chips.push({ key: "end", label: `End: ${end}` });
                          }

                          const live = bugreportLogLiveFilter.trim();
                          if (live) {
                            chips.push({
                              key: "live",
                              label: `Live ${bugreportLogFilterKind === "exclude" ? "NOT " : ""}${live}`,
                              tone: bugreportLogFilterKind === "exclude" ? "exclude" : "info",
                            });
                          }

	                        if (chips.length === 0) {
	                          return null;
	                        }

	                        return (
	                          <div className="panel-sub bugreport-log-summarybar">
	                            <div className="bugreport-log-summarybar-row">
	                              <div className="bugreport-log-summarybar-main">
	                                <div className="bugreport-log-summary-chip-list" role="list">
	                                  {chips.map((chip) => (
	                                    <span
	                                      key={chip.key}
	                                      className={`bugreport-log-summary-chip${chip.tone ? ` ${chip.tone}` : ""}`}
	                                      title={chip.label}
	                                      role="listitem"
	                                    >
	                                      {chip.label}
	                                    </span>
	                                  ))}
	                                </div>
	                              </div>
	                            </div>
	                          </div>
	                        );
	                      })()}

                      <LogLiveFilterBar
                        kind={bugreportLogFilterKind}
                        onKindChange={setBugreportLogFilterKind}
                        value={bugreportLogLiveFilter}
                        onValueChange={setBugreportLogLiveFilter}
                        onAdd={addBugreportLogLiveFilter}
                        chips={sharedLogTextChips}
                        onRemoveChip={(chipId) =>
                          setSharedLogTextChips((prev) => removeLogTextChip(prev, chipId))
                        }
                        onEditChip={editBugreportLogFilterChip}
                        onClearChips={clearSharedLogFilters}
                        presets={bugreportPresets}
                        presetSelected={bugreportPresetSelected}
                        onPresetSelectedChange={(next) => {
                          setBugreportPresetSelected(next);
                          if (next) {
                            setBugreportPresetName(next);
                          }
                        }}
                        presetName={bugreportPresetName}
                        onPresetNameChange={setBugreportPresetName}
                        hasSelectedPreset={Boolean(selectedBugreportPreset)}
                        onApplyPreset={applyBugreportPreset}
                        onUpdatePreset={(name) => openPresetUpdateModal("bugreport", name)}
                        onDeletePreset={(name) => openPresetDeleteModal("bugreport", name)}
                        onSavePreset={() => {
                          saveBugreportPreset(bugreportPresetName);
                        }}
                        showPresetRow
                        disabled={!bugreportLogSummary || Boolean(activeBugreportCustomViewSession)}
                        filtersCount={sharedLogTextChips.length}
                        activePresetLabel={selectedBugreportPreset?.name}
                        levelsSummary={logLevelsSummary}
                        isPresetDirty={bugreportPresetDirty}
                        selectClassName="logcat-select"
                        compact
                        expanded={bugreportLogFiltersExpanded}
                        onToggleExpanded={() => setBugreportLogFiltersExpanded((prev) => !prev)}
                        headerActions={
                          <AdvancedToggleButton
                            open={bugreportLogAdvancedOpen}
                            onClick={() => setBugreportLogAdvancedOpen((prev) => !prev)}
                            disabled={Boolean(activeBugreportCustomViewSession)}
                          />
                        }
                        advancedOptions={
                          bugreportLogAdvancedOpen ? (
                            <>
                              <div className="panel-sub">
                                <h3>Filter Scope</h3>
                                <div className="muted bugreport-log-search-hint">
                                  Filtering uses levels, buffer, tag, PID, time range, and regex filters.
                                </div>
                              </div>
                              <div className="panel-sub">
                                <h3>Filters</h3>
                                <div className="bugreport-log-advanced-fields">
                                  <div className="bugreport-log-advanced-controls">
                                    <div className="bugreport-log-toolbar-row">
                                      <div className="bugreport-log-filter-field">
                                        <label htmlFor="bugreport-log-buffer">Buffer</label>
                                        <select
                                          id="bugreport-log-buffer"
                                          className="logcat-select"
                                          value={bugreportLogBuffer}
                                          onChange={(event) => handleBugreportLogBufferChange(event.target.value)}
                                          disabled={
                                            !bugreportLogSummary ||
                                            bugreportLogBusy ||
                                            Boolean(activeBugreportCustomViewSession)
                                          }
                                        >
                                          <option value="">All</option>
                                          {bugreportBufferOptions.map((item) => (
                                            <option key={item.key} value={item.key}>
                                              {item.key} ({item.count.toLocaleString()})
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      <div className="bugreport-log-filter-field">
                                        <label htmlFor="bugreport-log-tag">Tag</label>
                                        <input
                                          id="bugreport-log-tag"
                                          value={bugreportLogTag}
                                          onChange={(event) => setBugreportLogTag(event.target.value)}
                                          placeholder="Tag"
                                          disabled={Boolean(activeBugreportCustomViewSession)}
                                        />
                                      </div>
                                      <div className="bugreport-log-filter-field">
                                        <label htmlFor="bugreport-log-pid">PID</label>
                                        <input
                                          id="bugreport-log-pid"
                                          value={bugreportLogPid}
                                          onChange={(event) => setBugreportLogPid(event.target.value)}
                                          placeholder="PID"
                                          disabled={Boolean(activeBugreportCustomViewSession)}
                                        />
                                      </div>
                                      <div className="bugreport-log-filter-field">
                                        <label htmlFor="bugreport-log-start">Start</label>
                                        <input
                                          id="bugreport-log-start"
                                          value={bugreportLogStart}
                                          onChange={(event) => setBugreportLogStart(event.target.value)}
                                          placeholder="MM-DD HH:MM:SS.mmm"
                                          disabled={Boolean(activeBugreportCustomViewSession)}
                                        />
                                      </div>
                                      <div className="bugreport-log-filter-field">
                                        <label htmlFor="bugreport-log-end">End</label>
                                        <input
                                          id="bugreport-log-end"
                                          value={bugreportLogEnd}
                                          onChange={(event) => setBugreportLogEnd(event.target.value)}
                                          placeholder="MM-DD HH:MM:SS.mmm"
                                          disabled={Boolean(activeBugreportCustomViewSession)}
                                        />
                                      </div>
                                    </div>

                                    <div className="bugreport-log-advanced-levels">
                                      <div className="toggle-group">
                                        {LOG_LEVELS.map((level) => (
                                          <label key={level} className="toggle">
                                            <input
                                              type="checkbox"
                                              checked={logLevels[level]}
                                              onChange={(event) => {
                                                setLogLevels((prev) => ({
                                                  ...prev,
                                                  [level]: event.target.checked,
                                                }));
                                              }}
                                              disabled={Boolean(activeBugreportCustomViewSession)}
                                            />
                                            {level}
                                          </label>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="bugreport-log-advanced-reset">
                                      <button
                                        className="ghost"
                                        onClick={() => {
                                          setBugreportLogLiveFilter("");
                                          setBugreportLogFilterKind("include");
                                          setBugreportLogFiltersExpanded(false);
                                          clearSharedLogFilters();
                                          setBugreportLogBuffer("");
                                          setBugreportLogTag("");
                                          setBugreportLogPid("");
                                          setBugreportLogStart("");
                                          setBugreportLogEnd("");
                                          setLogLevels(defaultLogcatLevels);
                                        }}
                                        disabled={bugreportLogBusy || Boolean(activeBugreportCustomViewSession)}
                                      >
                                        Reset Filters
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </>
                          ) : null
                        }
                      />

	                    </div>

                    {activeBugreportCustomViewSession && activeBugreportExtractResult ? (
                      <div className="bugreport-extract-results">
                        {activeBugreportExtractResult.matches.length > 0 ? (
                          <>
                            {activeBugreportExtractResult.truncated && (
                              <p className="muted">
                                Showing top {activeBugreportExtractResult.matches.length} matches.
                              </p>
                            )}
                            <div className="bugreport-extract-card-list">
                              {activeBugreportExtractResult.matches.map((match, index) => (
                                <article
                                  key={`${match.section_name}-${match.line_start}-${index}`}
                                  className="bugreport-extract-card"
                                >
                                  <div className="bugreport-extract-card-head">
                                    <h3>{match.section_name}</h3>
                                    <span className="muted">
                                      Lines {match.line_start} - {match.line_end} · Hits {match.hit_count}
                                    </span>
                                  </div>
                                  <div className="bugreport-extract-snippet">
                                    {renderHighlightedSnippet(
                                      match.snippet,
                                      activeBugreportExtractHighlightPattern,
                                    )}
                                  </div>
                                </article>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="bugreport-extract-empty">
                            <h3>No results</h3>
                            <p className="muted">
                              No snippet matched this custom view input and overlay conditions.
                            </p>
                            {activeBugreportExtractResult.suggestions.length > 0 && (
                              <div className="bugreport-extract-suggestions">
                                <span className="muted">Suggestions:</span>
                                <div className="bugreport-extract-suggestion-list">
                                  {activeBugreportExtractResult.suggestions.map((suggestion) => (
                                    <span key={suggestion} className="chip">
                                      {suggestion}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : bugreportLogRows.length ? (
                      <BugreportLogOutput
                        rows={bugreportLogRows}
                        highlightPattern={bugreportLogSearchPattern}
                        canLoadMore={Boolean(bugreportLogSummary) && bugreportLogHasMore && !bugreportLogLoadAllRunning}
                        busy={bugreportLogBusy || bugreportLogLoadAllRunning}
                        onNearBottom={() => {
                          if (!bugreportLogSummary) {
                            return;
                          }
                          void runBugreportLogQuery(bugreportLogSummary.report_id, bugreportLogOffset, true);
                        }}
                      />
                    ) : (
                      <div className="logcat-output bugreport-log-output bugreport-log-output-empty">
                        <p className="muted">Load a bugreport to view logcat output.</p>
                      </div>
                    )}
	                  </section>
	                </div>
	              }
	            />
            <Route
              path="/bluetooth"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Bluetooth Monitor</h1>
                      <p className="muted">State dashboard and event timeline for the selected device.</p>
                    </div>
                  </div>
                  <Suspense
                    fallback={
                      <section className="panel empty-state">
                        <div>
                          <h2>Loading Bluetooth monitor</h2>
                          <p className="muted">Preparing dashboard module.</p>
                        </div>
                      </section>
                    }
                  >
                    <LazyBluetoothMonitorPage
                      serial={activeSerial}
                      serialLabel={selectedSummaryLabel}
                      commandBusy={bluetoothMonitorBusy || bluetoothToggleBusy}
                      monitoringDesired={activeSerial ? (bluetoothMonitorRunningBySerial[activeSerial] ?? false) : false}
                      singleSelectionWarning={singleSelectionWarning}
                      singleSelectionWarningMessage={singleSelectionWarningMessage}
                      onSetMonitorDesired={setBluetoothMonitorDesired}
                      onEnableBluetooth={enableBluetoothForSerial}
                    />
                  </Suspense>
                </div>
              }
            />
            <Route
              path="/settings"
              element={
                <Suspense fallback={null}>
                  <LazySettingsPage
                  config={config}
                  setConfig={setConfig}
                  busy={busy}
                  adbInfo={adbInfo}
                  clearAdbInfo={handleClearAdbInfo}
                  hostOs={hostOs}
                  iosToolGuidanceRows={iosToolGuidanceRows}
                  effectiveThemeStyle={effectiveThemeStyle}
                  themeCopy={themeCopy}
                  updateThemeStyle={updateThemeStyle}
                  updateThemeColor={updateThemeColor}
                  updateThemeCopy={updateThemeCopy}
                  onBrowseAdbPath={handleBrowseAdbPath}
                  onCheckAdb={handleCheckAdb}
                  onRestartAdbServer={handleRestartAdbServer}
                  onKillAdbServer={handleKillAdbServer}
                  onCheckIosTools={handleCheckIosTools}
                  onBrowseThemeBackgroundPath={handleBrowseThemeBackgroundPath}
                  onImportThemeBackgroundPath={handleImportThemeBackgroundPath}
                  onBrowseOutputPath={handleBrowseOutputPath}
                  onBrowseFileExportPath={handleBrowseFileExportPath}
                  appVersionLabel={appVersionLabel}
                  updateLastCheckedMs={updateLastCheckedMs}
                  updateStatus={updateStatus}
                  updateLastCheckSource={updateLastCheckSource}
                  updateAvailable={updateAvailable}
                  updatePublishingMessage={updatePublishingMessage}
                  updateError={updateError}
                  onManualUpdateCheck={handleManualUpdateCheck}
                  onOpenUpdateModal={handleOpenUpdateModal}
                  desktopNotificationPermission={desktopNotificationPermission}
                  onRefreshDesktopNotificationsPermission={refreshDesktopNotificationsPermission}
                  onRequestDesktopNotificationsPermission={handleRequestDesktopNotificationsPermission}
                  onSendTestDesktopNotification={handleSendTestDesktopNotification}
                  onSaveConfig={handleSaveConfig}
                  onResetConfig={handleResetConfig}
                />
                </Suspense>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      {activeTaskCompletionNotice && (
        <div className="modal-backdrop" onClick={closeTaskCompletionModal}>
          <div className="modal confirm-modal task-completion-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Task Completed</h3>
                <p className="muted">
                  {activeTaskCompletionNotice.finishedAt
                    ? new Date(activeTaskCompletionNotice.finishedAt).toLocaleString()
                    : "Just now"}{" "}
                  • {activeTaskCompletionNotice.taskKind}
                  {activeTaskCompletionNotice.traceId ? ` • ${activeTaskCompletionNotice.traceId}` : ""}
                </p>
              </div>
              <button className="ghost" onClick={closeTaskCompletionModal}>
                Close
              </button>
            </div>

            <div className="inline-row">
              <strong>{activeTaskCompletionNotice.title}</strong>
              <span
                className={`status-pill ${
                  activeTaskCompletionNotice.status === "success"
                    ? "ok"
                    : activeTaskCompletionNotice.status === "cancelled" ||
                        activeTaskCompletionNotice.status === "interrupted"
                      ? "warn"
                      : "error"
                }`}
              >
                {activeTaskCompletionNotice.statusLabel}
              </span>
            </div>

            <p className="muted">{activeTaskCompletionNotice.body}</p>
            <div className="task-summary">
              <span className="badge">{activeTaskCompletionNotice.summary.serials.length} devices</span>
              {activeTaskCompletionNotice.summary.counts.success > 0 && (
                <span className="badge">{activeTaskCompletionNotice.summary.counts.success} success</span>
              )}
              {activeTaskCompletionNotice.summary.counts.error > 0 && (
                <span className="badge">{activeTaskCompletionNotice.summary.counts.error} error</span>
              )}
              {activeTaskCompletionNotice.summary.counts.cancelled > 0 && (
                <span className="badge">{activeTaskCompletionNotice.summary.counts.cancelled} cancelled</span>
              )}
              {activeTaskCompletionNotice.summary.counts.interrupted > 0 && (
                <span className="badge">{activeTaskCompletionNotice.summary.counts.interrupted} interrupted</span>
              )}
            </div>
            {activeCompletionOutputPaths.length > 0 && (
              <div className="task-completion-output">
                <div className="task-completion-output-header">
                  <strong>Output Paths</strong>
                  {activeCompletionOutputPaths.length > 3 && (
                    <button
                      className="ghost"
                      onClick={() => setTaskCompletionPathsExpanded((prev) => !prev)}
                      aria-expanded={taskCompletionPathsExpanded}
                    >
                      {taskCompletionPathsExpanded
                        ? "Show less"
                        : `Show all (${activeCompletionOutputPaths.length})`}
                    </button>
                  )}
                </div>
                <div className="task-completion-output-list" role="list">
                  {visibleCompletionOutputPaths.map((item) => (
                    <div className="task-completion-output-row" role="listitem" key={`${item.serial}:${item.path}`}>
                      <div className="task-completion-output-main">
                        <span className="badge">{item.serial}</span>
                        <span className="task-completion-output-path muted" title={item.path}>
                          {item.path}
                        </span>
                      </div>
                      <div className="button-row compact task-completion-output-actions">
                        <button className="ghost" onClick={() => void openExternalPath(item.path)}>
                          Open
                        </button>
                        <button className="ghost" onClick={() => void handleCopyCompletionOutputPath(item.path)}>
                          Copy path
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {taskCompletionNotices.length > 1 && (
              <p className="muted">
                {taskCompletionNotices.length - 1} more completion alert
                {taskCompletionNotices.length - 1 > 1 ? "s" : ""} queued.
              </p>
            )}

            <div className="button-row">
              <button onClick={openTaskCenterFromCompletionModal}>View Task Center</button>
              <button className="ghost" onClick={closeTaskCompletionModal}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {profileConfirmOpen && (
        <div className="modal-backdrop" onClick={closeProfileInstallConfirm}>
          <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Install Configuration Profile</h3>
                <p className="muted">
                  {mobileconfigSummary?.display_name ?? "Selected profile"} will be installed on{" "}
                  {getValidProfileTargetSerials().length} iOS device
                  {getValidProfileTargetSerials().length === 1 ? "" : "s"}.
                </p>
              </div>
              <button className="ghost" onClick={closeProfileInstallConfirm} disabled={profileInstalling}>
                Close
              </button>
            </div>
            <div className="inline-alert info">
              <strong>Confirm on devices if prompted</strong>
              <span>
                Apple security rules still apply. Some payloads may require a supervised, trusted, unlocked device or
                manual confirmation.
              </span>
            </div>
            <div className="task-summary">
              <span className="badge">{mobileconfigSummary?.identifier ?? "Unknown identifier"}</span>
              <span className="badge">{mobileconfigSummary?.payload_count ?? 0} payloads</span>
            </div>
            <div className="button-row">
              <button onClick={handleConfirmProfileInstall} disabled={profileInstalling}>
                Confirm Install
              </button>
              <button className="ghost" onClick={closeProfileInstallConfirm} disabled={profileInstalling}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {developerOptionsConfirmModal && (
        <div className="modal-backdrop" onClick={closeDeveloperOptionsConfirmModal}>
          <div className="modal danger-modal developer-options-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>
                  {developerOptionsConfirmModal.mode === "batch"
                    ? "Confirm Batch Developer Option Changes"
                    : "Confirm Developer Option Change"}
                </h3>
                <p className="muted">This option may interrupt ADB connectivity and active debugging sessions.</p>
              </div>
              <button className="ghost" onClick={closeDeveloperOptionsConfirmModal} disabled={busy}>
                Close
              </button>
            </div>
            <div className="stack">
              <div className="inline-alert error">
                <strong>High-risk action</strong>
                <span>Confirmation is required every time this option changes.</span>
              </div>
              {developerOptionsConfirmModal.mode === "batch" ? (
                <>
                  <p className="muted">
                    Pending batch changes: <strong>{developerOptionsConfirmModal.changes.length}</strong>
                  </p>
                  <p className="muted">
                    High-risk changes in this batch:{" "}
                    <strong>{developerOptionsConfirmModal.highRiskChanges.length}</strong>
                  </p>
                  <div className="developer-options-confirm-change-list">
                    {developerOptionsConfirmModal.highRiskChanges.map((change) => (
                      <p key={`risk-${change.optionKey}`} className="muted">
                        <strong>{change.label}</strong>: {formatDeveloperOptionValueLabel(change.value)}
                      </p>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="muted">
                    Option: <strong>{developerOptionsConfirmModal.changes[0]?.label ?? "Unknown option"}</strong>
                  </p>
                  <p className="muted">
                    New value:{" "}
                    <strong>{formatDeveloperOptionValueLabel(developerOptionsConfirmModal.changes[0]?.value ?? null)}</strong>
                  </p>
                </>
              )}
              <p className="muted">
                Targets: <strong>{developerOptionsConfirmModal.targetCount}</strong> online device
                {developerOptionsConfirmModal.targetCount > 1 ? "s" : ""}
                {developerOptionsConfirmModal.skippedCount > 0
                  ? ` • Skipped ${developerOptionsConfirmModal.skippedCount} offline device${
                      developerOptionsConfirmModal.skippedCount > 1 ? "s" : ""
                    }`
                  : ""}
              </p>
            </div>
            <div className="button-row">
              <button className="danger" onClick={handleDeveloperOptionsConfirmApply} disabled={busy}>
                Confirm Apply
              </button>
              <button className="ghost" onClick={closeDeveloperOptionsConfirmModal} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {logcatClearBufferModal && (
        <div className="modal-backdrop" onClick={closeLogcatClearBufferModal}>
          <div
            className="modal danger-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logcat-clear-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3 id="logcat-clear-title">Clear Logcat Buffer</h3>
                <p className="muted">This clears the active device logcat buffer and the local view cache.</p>
              </div>
              <button className="ghost" onClick={closeLogcatClearBufferModal} disabled={busy}>
                Close
              </button>
            </div>
            <div className="stack">
              <div className="inline-alert error">
                <strong>Danger zone</strong>
                <span className="muted">This action cannot be undone.</span>
              </div>
              <p className="muted">
                Device: <strong>{logcatClearBufferModal.serial}</strong>
              </p>
            </div>
            <div className="button-row">
              <button className="danger" onClick={handleLogcatClearBufferConfirm} disabled={busy}>
                Confirm Clear
              </button>
              <button className="ghost" onClick={closeLogcatClearBufferModal} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {appActionConfirm && (
        <div className="modal-backdrop" onClick={() => setAppActionConfirm(null)}>
          <div
            className="modal danger-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-action-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3 id="app-action-confirm-title">
                  {appActionConfirm.action === "uninstall" ? "Uninstall App" : "Clear App Data"}
                </h3>
                <p className="muted">
                  {appActionConfirm.action === "uninstall"
                    ? "This removes the app and all of its data from the device."
                    : "This erases all data and cache for the app on the device."}
                </p>
              </div>
              <button className="ghost" onClick={() => setAppActionConfirm(null)} disabled={busy}>
                Close
              </button>
            </div>
            <div className="stack">
              <div className="inline-alert error">
                <strong>Danger zone</strong>
                <span className="muted">This action cannot be undone.</span>
              </div>
              <p className="muted">
                Package: <strong>{appActionConfirm.packageName}</strong>
              </p>
            </div>
            <div className="button-row">
              <button
                className="danger"
                onClick={() => {
                  const action = appActionConfirm.action;
                  setAppActionConfirm(null);
                  void handleAppAction(action, true);
                }}
                disabled={busy}
              >
                {appActionConfirm.action === "uninstall" ? "Confirm Uninstall" : "Confirm Clear Data"}
              </button>
              <button className="ghost" onClick={() => setAppActionConfirm(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {logcatPopupSelectorOpen && (
        <div className="modal-backdrop" onClick={closeLogcatPopupSelectorModal}>
          <div
            className="modal confirm-modal logcat-popup-selector-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3>Open Logcat Popups</h3>
                <p className="muted">Mirrors global device selection.</p>
              </div>
              <button className="ghost" onClick={closeLogcatPopupSelectorModal} disabled={busy}>
                Close
              </button>
            </div>

            <div className="logcat-popup-selector-summary">
              <span className="muted">Select devices to stream logs.</span>
              <span className="badge">
                {logcatPopupSelectedCount} / {logcatPopupSelectableCount} selected
              </span>
            </div>

            <div className="logcat-popup-selector-actions">
              <button
                type="button"
                className="ghost"
                onClick={selectAllLogcatPopupDraftSerials}
                disabled={busy || !hasLogcatPopupSelectableCandidate || logcatPopupAllSelectableSelected}
              >
                Select All Online
              </button>
              <button
                type="button"
                className="ghost"
                onClick={clearLogcatPopupDraftSerials}
                disabled={busy || logcatPopupDraftSerials.length === 0}
              >
                Clear
              </button>
            </div>

            <div className="logcat-popup-selector-columns" aria-hidden="true">
              <span>Device</span>
              <span>Serial</span>
              <span>Status</span>
            </div>

            <div className="logcat-popup-selector-list">
              {logcatPopupCandidates.map((candidate) => {
                const checked = logcatPopupDraftSerials.includes(candidate.serial);
                const stateTone =
                  candidate.selectable
                    ? "ok"
                    : candidate.state === "unauthorized"
                      ? "error"
                      : "warn";
                return (
                  <label
                    key={candidate.serial}
                    className={`logcat-popup-selector-row${candidate.selectable ? "" : " is-disabled"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy || !candidate.selectable}
                      onChange={() => toggleLogcatPopupDraftSerial(candidate.serial)}
                    />
                    <span className="logcat-popup-selector-name">{candidate.name}</span>
                    <span className="logcat-popup-selector-serial">{candidate.serial}</span>
                    <span className={`status-pill ${stateTone}`}>
                      {(candidate.selectable ? "online" : candidate.state).toUpperCase()}
                    </span>
                  </label>
                );
              })}
            </div>

            {logcatPopupCandidates.length === 0 && (
              <div className="inline-alert info">
                <strong>No devices found</strong>
                <span className="muted">Connect a device and refresh to open popup windows.</span>
              </div>
            )}
            {logcatPopupCandidates.length > 0 && !hasLogcatPopupSelectableCandidate && (
              <div className="inline-alert error">
                <strong>No online devices</strong>
                <span className="muted">Only devices in state "device" can open popup windows.</span>
              </div>
            )}
            {hasLogcatPopupSelectableCandidate && logcatPopupPreviewTargets.openable.length === 0 && (
              <div className="inline-alert info">
                <strong>Select a target</strong>
                <span className="muted">Choose at least one online device to continue.</span>
              </div>
            )}
            {logcatPopupPreviewTargets.skipped.length > 0 && (
              <p className="muted">
                {logcatPopupPreviewTargets.skipped.length} selected device
                {logcatPopupPreviewTargets.skipped.length > 1 ? "s are" : " is"} offline and will be skipped.
              </p>
            )}

            <div className="button-row logcat-popup-selector-footer">
              <button
                onClick={handleLogcatPopupSelectorConfirm}
                disabled={busy || logcatPopupSelectedCount === 0}
              >
                Open {logcatPopupSelectedCount} Popup{logcatPopupSelectedCount > 1 ? "s" : ""}
              </button>
              <button className="ghost" onClick={closeLogcatPopupSelectorModal} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {presetUpdateModal && (
        <div className="modal-backdrop" onClick={closePresetUpdateModal}>
          <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Update {presetContextLabel(presetUpdateModal.context)} Preset</h3>
                <p className="muted">This will overwrite the selected preset with current filters.</p>
              </div>
              <button className="ghost" onClick={closePresetUpdateModal} disabled={busy}>
                Close
              </button>
            </div>
            <div className="stack">
              <p className="muted">
                Target preset: <strong>{presetUpdateModal.name}</strong>
              </p>
              <div className="inline-alert info">
                <strong>Confirm overwrite</strong>
                <span className="muted">Existing preset values will be replaced.</span>
              </div>
            </div>
            <div className="button-row">
              <button onClick={handlePresetUpdateConfirm} disabled={busy}>
                Confirm Update
              </button>
              <button className="ghost" onClick={closePresetUpdateModal} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {presetDeleteModal && (
        <div className="modal-backdrop" onClick={closePresetDeleteModal}>
          <div className="modal danger-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Delete {presetContextLabel(presetDeleteModal.context)} Preset</h3>
                <p className="muted">This action cannot be undone.</p>
              </div>
              <button className="ghost" onClick={closePresetDeleteModal} disabled={busy}>
                Close
              </button>
            </div>
            <div className="stack">
              <div className="inline-alert error">
                <strong>Danger zone</strong>
                <span className="muted">This preset will be removed permanently.</span>
              </div>
              <p className="muted">
                Preset: <strong>{presetDeleteModal.name}</strong>
              </p>
            </div>
            <div className="button-row">
              <button className="danger" onClick={handlePresetDeleteConfirm} disabled={busy}>
                Confirm Delete
              </button>
              <button className="ghost" onClick={closePresetDeleteModal} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {rebootConfirmOpen && (
        <div className="modal-backdrop" onClick={closeRebootConfirm}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Confirm Reboot</h3>
                <p className="muted">Review reboot mode before sending the command.</p>
              </div>
              <button className="ghost" onClick={closeRebootConfirm} disabled={busy}>
                Close
              </button>
            </div>
            <p className="muted action-targets">Targets: {selectedSummaryLabel}</p>

            <div className="stack">
              <div className="inline-alert error">
                <strong>Danger zone</strong>
                <span className="muted">Reboot will interrupt ongoing work and may disconnect ADB temporarily.</span>
              </div>
              <label>
                Reboot mode
                <select
                  value={rebootConfirmMode}
                  onChange={(event) => setRebootConfirmMode(event.target.value as RebootMode)}
                >
                  <option value="normal">Normal</option>
                  <option value="recovery">Recovery</option>
                  <option value="bootloader">Bootloader</option>
                </select>
              </label>
            </div>

            <div className="button-row">
              <button className="danger" onClick={handleConfirmReboot} disabled={busy || selectedSerials.length === 0}>
                Reboot
              </button>
              <button className="ghost" onClick={closeRebootConfirm} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}


      {pairingState.isOpen && (
        <div className="modal-backdrop" onClick={closePairingModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Wireless Pairing</h3>
              <button className="ghost" onClick={closePairingModal}>
                Close
              </button>
            </div>
            <div className="pairing-content">
              <div className="pairing-step">
                <div className="pairing-step-header">
                  <h4>Step 1: Pair</h4>
                  <span
                    className={`pairing-step-status ${
                      pairingState.status === "paired" || pairingState.status === "connected"
                        ? "ok"
                        : pairingState.status === "pairing" || pairingState.status === "connecting"
                          ? "pending"
                          : "idle"
                    }`}
                  >
                    {pairingState.status === "pairing"
                      ? "Pairing..."
                      : pairingState.status === "paired"
                        ? "Paired"
                        : "Enter pairing info"}
                  </span>
                </div>
                <p className="muted">
                  Enable Wireless Debugging on the device, then scan a QR code or enter the pairing code.
                </p>
                <div className="inline-alert info pairing-help">
                  <strong>Quick checks before pairing</strong>
                  <ul className="pairing-help-list">
                    <li>Keep the phone and this computer on the same Wi-Fi network.</li>
                    <li>Use the 6-digit pairing code right after it appears on the device.</li>
                    <li>After pairing, use the wireless debug address for connect (often port 5555).</li>
                    <li>If connect fails, tap Refresh Devices and retry once.</li>
                  </ul>
                </div>
                <div className="toggle-group">
                  <button
                    className={pairingState.mode === "qr" ? "toggle active" : "toggle"}
                    onClick={() => dispatchPairing({ type: "SET_MODE", mode: "qr" })}
                  >
                    QR Pairing
                  </button>
                  <button
                    className={pairingState.mode === "code" ? "toggle active" : "toggle"}
                    onClick={() => {
                      dispatchPairing({ type: "SET_MODE", mode: "code" });
                      window.setTimeout(() => {
                        pairingCodeInputRef.current?.focus();
                      }, 0);
                    }}
                  >
                    Pairing Code
                  </button>
                </div>
                <label>
                  QR Payload (paste to auto-fill)
                  <input
                    value={pairingState.qrPayload}
                    onChange={(event) => {
                      const value = event.target.value;
                      dispatchPairing({ type: "SET_QR_PAYLOAD", value });
                      syncPairingFieldsFromQrPayload(value);
                    }}
                    placeholder="WIFI:T:ADB;S:192.168.0.10:37145;P:123456;;"
                  />
                </label>
                <label>
                  Pairing Address (host:port)
                  <input
                    value={pairingState.pairAddress}
                    onChange={(event) =>
                      dispatchPairing({ type: "SET_PAIR_ADDRESS", value: event.target.value })
                    }
                    placeholder="192.168.0.10:37145"
                  />
                </label>
                <label>
                  Pairing Code
                  <input
                    value={pairingState.pairingCode}
                    ref={pairingCodeInputRef}
                    onChange={(event) =>
                      dispatchPairing({ type: "SET_PAIR_CODE", value: event.target.value })
                    }
                    placeholder="123456"
                  />
                </label>
                <div className="button-row">
                  <button onClick={handlePairSubmit} disabled={busy}>
                    Pair Device
                  </button>
                  <button onClick={handlePairAndConnectSubmit} disabled={busy}>
                    Pair & Connect
                  </button>
                  <button
                    className="ghost"
                    onClick={() => dispatchPairing({ type: "RESET" })}
                    disabled={busy}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div
                className={`pairing-step ${
                  pairingState.status === "paired" || pairingState.status === "connecting" || pairingState.status === "connected"
                    ? ""
                    : "inactive"
                }`}
              >
                <div className="pairing-step-header">
                  <h4>Step 2: Connect</h4>
                  <span
                    className={`pairing-step-status ${
                      pairingState.status === "connected"
                        ? "ok"
                        : pairingState.status === "connecting"
                          ? "pending"
                          : "idle"
                    }`}
                  >
                    {pairingState.status === "connecting"
                      ? "Connecting..."
                      : pairingState.status === "connected"
                        ? "Connected"
                        : "Connect after pairing"}
                  </span>
                </div>
                <p className="muted">Use the address from device Wireless debugging, then connect.</p>
                <label>
                  Device Address (host:port)
                  <input
                    value={pairingState.connectAddress}
                    ref={connectAddressInputRef}
                    onChange={(event) =>
                      dispatchPairing({ type: "SET_CONNECT_ADDRESS", value: event.target.value })
                    }
                    placeholder="192.168.0.10:5555"
                  />
                </label>
                <div className="button-row">
                  <button onClick={() => void handleConnectSubmit()} disabled={busy}>
                    Connect
                  </button>
                  <button className="ghost" onClick={refreshDevices} disabled={busy}>
                    Refresh Devices
                  </button>
                </div>
              </div>
            </div>

            {(pairingState.error || pairingState.message) && (
              <div className={`inline-alert ${pairingState.error ? "error" : "info"}`}>
                {pairingState.error ?? pairingState.message}
              </div>
            )}
          </div>
        </div>
      )}

      {filesModal && (
        <div className="modal-backdrop" onClick={closeFilesModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {filesModal.type === "mkdir"
                  ? "New Folder"
                  : filesModal.type === "rename"
                    ? "Rename"
                    : "Delete"}
              </h3>
              <button className="ghost" onClick={closeFilesModal}>
                Close
              </button>
            </div>

            {filesModal.type === "mkdir" && (
              <div className="stack">
                <p className="muted">Create a directory under {filesPath}.</p>
                <label>
                  Folder name
                  <input
                    value={filesModal.name}
                    onChange={(event) =>
                      setFilesModal((prev) =>
                        prev && prev.type === "mkdir" ? { ...prev, name: event.target.value } : prev,
                      )
                    }
                    placeholder="e.g. logs"
                  />
                </label>
              </div>
            )}

            {filesModal.type === "rename" && (
              <div className="stack">
                <p className="muted">{filesModal.entry.path}</p>
                <label>
                  New name
                  <input
                    value={filesModal.newName}
                    onChange={(event) =>
                      setFilesModal((prev) =>
                        prev && prev.type === "rename"
                          ? { ...prev, newName: event.target.value }
                          : prev,
                      )
                    }
                    placeholder={filesModal.entry.name}
                  />
                </label>
              </div>
            )}

            {filesModal.type === "delete" && (
              <div className="stack">
                <div className="inline-alert error">
                  <strong>Danger zone</strong>
                  <span className="muted">This action cannot be undone.</span>
                </div>
                <p className="muted">{filesModal.entry.path}</p>
                {filesModal.entry.is_dir && (
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={filesModal.recursive}
                      onChange={(event) =>
                        setFilesModal((prev) =>
                          prev && prev.type === "delete"
                            ? { ...prev, recursive: event.target.checked }
                            : prev,
                        )
                      }
                    />
                    Recursive delete (required for directories)
                  </label>
                )}
                <label>
                  Confirm
                  <input
                    value={filesModal.confirm}
                    onChange={(event) =>
                      setFilesModal((prev) =>
                        prev && prev.type === "delete" ? { ...prev, confirm: event.target.value } : prev,
                      )
                    }
                    placeholder='Type "DELETE" to confirm'
                  />
                </label>
              </div>
            )}

            {filesModal.type === "delete_many" && (
              <div className="stack">
                <div className="inline-alert error">
                  <strong>Danger zone</strong>
                  <span className="muted">This action cannot be undone.</span>
                </div>
                <p className="muted">Selected: {filesModal.entries.length} items</p>
                {filesModal.entries.some((entry) => entry.is_dir) && (
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={filesModal.recursive}
                      onChange={(event) =>
                        setFilesModal((prev) =>
                          prev && prev.type === "delete_many"
                            ? { ...prev, recursive: event.target.checked }
                            : prev,
                        )
                      }
                    />
                    Recursive delete (required for directories)
                  </label>
                )}
                <label>
                  Confirm
                  <input
                    value={filesModal.confirm}
                    onChange={(event) =>
                      setFilesModal((prev) =>
                        prev && prev.type === "delete_many"
                          ? { ...prev, confirm: event.target.value }
                          : prev,
                      )
                    }
                    placeholder='Type "DELETE" to confirm'
                  />
                </label>
              </div>
            )}

            <div className="button-row">
              {filesModal.type === "mkdir" && (
                <button onClick={handleFilesMkdirSubmit} disabled={busy}>
                  Create
                </button>
              )}
              {filesModal.type === "rename" && (
                <button onClick={handleFilesRenameSubmit} disabled={busy}>
                  Rename
                </button>
              )}
              {filesModal.type === "delete" && (
                <button
                  className="danger"
                  onClick={handleFilesDeleteSubmit}
                  disabled={
                    busy ||
                    filesModal.confirm.trim() !== "DELETE" ||
                    (filesModal.entry.is_dir && !filesModal.recursive)
                  }
                >
                  Delete
                </button>
              )}
              {filesModal.type === "delete_many" && (
                <button
                  className="danger"
                  onClick={handleFilesDeleteManySubmit}
                  disabled={
                    busy ||
                    filesModal.confirm.trim() !== "DELETE" ||
                    (filesModal.entries.some((entry) => entry.is_dir) && !filesModal.recursive)
                  }
                >
                  Delete
                </button>
              )}
              <button className="ghost" onClick={closeFilesModal} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {updateModalOpen && (
        <div className="modal-backdrop" onClick={closeUpdateModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Update</h3>
                <p className="muted">This update is optional. You can install now or later.</p>
              </div>
              <button className="ghost" onClick={closeUpdateModal} disabled={updateStatus === "installing"}>
                Close
              </button>
            </div>

            <div className="stack">
              <div className="inline-row">
                <span className="muted">Current</span>
                <code>{appVersionLabel}</code>
              </div>
              <div className="inline-row">
                <span className="muted">Latest</span>
                <code>{updateAvailable?.version ?? "--"}</code>
              </div>

              {updateAvailable && (
                <div className="inline-alert info">
                  <strong>Heads up</strong>
                  <span className="muted">Installing will restart the app and interrupt ongoing tasks.</span>
                </div>
              )}

              {updateStatus === "installing" && (
                <div className="inline-alert info">
                  <strong>Installing...</strong>
                  <span className="muted">Downloading and applying the update.</span>
                </div>
              )}

              {updateStatus === "installed" && (
                <div className="inline-alert info">
                  <strong>Update installed</strong>
                  <span className="muted">Restarting the app.</span>
                </div>
              )}

              {updateStatus === "installed_needs_restart" && (
                <div className="inline-alert info">
                  <strong>Update installed</strong>
                  <span className="muted">Please restart the app manually.</span>
                </div>
              )}

              {updateStatus === "publishing_pending" && (
                <div className="inline-alert info">
                  <strong>Update is still publishing</strong>
                  <span className="muted">{updatePublishingMessage}</span>
                </div>
              )}

              {updateStatus === "error" && updateError && <div className="inline-alert error">{updateError}</div>}

              {updateAvailable?.body ? (
                <div className="stack">
                  <div className="muted">Release notes</div>
                  <pre className="update-notes">{updateAvailable.body.slice(0, 8000)}</pre>
                </div>
              ) : null}
            </div>

            <div className="button-row">
              {showUpdateCheckAgainAction ? (
                <button onClick={handleManualUpdateCheck} disabled={busy || updateStatus === "checking"}>
                  {updateStatus === "checking" ? "Checking..." : "Check again"}
                </button>
              ) : (
                <button
                  onClick={handleInstallUpdate}
                  disabled={
                    !updateAvailable ||
                    updateStatus === "installing" ||
                    updateStatus === "installed" ||
                    updateStatus === "installed_needs_restart" ||
                    busy
                  }
                >
                  Install and restart
                </button>
              )}
              <button className="ghost" onClick={closeUpdateModal} disabled={updateStatus === "installing"}>
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandPaletteModal
        open={commandPaletteOpen}
        items={commandPaletteItems}
        onClose={() => setCommandPaletteOpen(false)}
        onSelect={handleSelectCommandPaletteItem}
      />

      <ShortcutsOverlayModal
        open={shortcutsOverlayOpen}
        onClose={() => setShortcutsOverlayOpen(false)}
      />

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.tone}`}
            role={toast.tone === "error" ? "alert" : undefined}
          >
            <span className="toast-message">{toast.message}</span>
            <button
              type="button"
              className="toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "error" in error) {
    // Keep the message and (optional) code; the trace_id stays out of the user-facing string
    // (it is still captured in the error log / diagnostics for support).
    const payload = error as { error: string; code?: string; trace_id?: string };
    return `${payload.error}${payload.code ? ` (${payload.code})` : ""}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

export default App;
