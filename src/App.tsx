import { memo, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
import type {
  AdbInfo,
  AppConfig,
  AppInfo,
  BugreportResult,
  DeviceFileEntry,
  DeviceInfo,
  FilePreview,
  LogcatEvent,
  ScrcpyInfo,
} from "./types";
import {
  adbConnect,
  adbPair,
  cancelBugreport,
  captureScreenshot,
  captureUiHierarchy,
  checkAdb,
  checkScrcpy,
  clearAppData,
  clearLogcat,
  exportLogcat,
  exportUiHierarchy,
  forceStopApp,
  generateBugreport,
  getConfig,
  installApkBatch,
  launchApp,
  launchScrcpy,
  mkdirDeviceDir,
  deleteDevicePath,
  listApps,
  listDeviceFiles,
  listDevices,
  openAppInfo,
  previewLocalFile,
  pullDeviceFile,
  pushDeviceFile,
  renameDevicePath,
  rebootDevices,
  resetConfig,
  runShell,
  saveConfig,
  setAppEnabled,
  setBluetoothState,
  setWifiState,
  startBluetoothMonitor,
  startLogcat,
  startScreenRecord,
  stopBluetoothMonitor,
  stopLogcat,
  stopScreenRecord,
  uninstallApp,
} from "./api";
import {
  buildLogcatFilter,
  buildSearchRegex,
  defaultLogcatLevels,
  filterLogcatEntries,
  parsePidOutput,
  type LogcatLevelsState,
  type LogcatSourceMode,
} from "./logcat";
import {
  initialPairingState,
  pairingReducer,
  parseAdbPairOutput,
  parseQrPayload,
} from "./pairing";
import {
  createInitialTaskState,
  createTask,
  inflateStoredTaskState,
  parseStoredTaskState,
  sanitizeTaskStateForStorage,
  summarizeTask,
  tasksReducer,
  type TaskKind,
} from "./tasks";
import { parseUiNodes, pickUiNodeAtPoint } from "./ui_bounds";
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
type LogcatLineEntry = { id: number; text: string };
type QuickActionId =
  | "screenshot"
  | "reboot"
  | "record"
  | "logcat-clear"
  | "mirror";
type ActionFormState = {
  isOpen: boolean;
  actionId: QuickActionId | null;
  errors: string[];
};

const initialActionFormState: ActionFormState = {
  isOpen: false,
  actionId: null,
  errors: [],
};

const truncateText = (value: string, maxLen: number) => {
  if (value.length <= maxLen) {
    return value;
  }
  const limit = Math.max(0, maxLen - 1);
  return `${value.slice(0, limit)}…`;
};

function renderHighlightedLogcatLine(line: string, searchPattern: RegExp | null) {
  if (!searchPattern) {
    return line;
  }
  const parts: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  searchPattern.lastIndex = 0;
  let match = searchPattern.exec(line);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > lastIndex) {
      parts.push({ text: line.slice(lastIndex, start), match: false });
    }
    parts.push({ text: line.slice(start, end), match: true });
    lastIndex = end;
    match = searchPattern.exec(line);
  }
  if (lastIndex < line.length) {
    parts.push({ text: line.slice(lastIndex), match: false });
  }
  searchPattern.lastIndex = 0;
  return parts.map((part, index) =>
    part.match ? (
      <mark key={`${part.text}-${index}`}>{part.text}</mark>
    ) : (
      <span key={`${part.text}-${index}`}>{part.text}</span>
    ),
  );
}

const LogcatLineRow = ({
  entry,
  searchPattern,
}: {
  entry: LogcatLineEntry;
  searchPattern: RegExp | null;
}) => {
  return (
    <div data-log-id={entry.id}>
      {renderHighlightedLogcatLine(entry.text, searchPattern)}
    </div>
  );
};

const MemoLogcatLineRow = memo(LogcatLineRow, (prev, next) => {
  return prev.entry === next.entry && prev.searchPattern === next.searchPattern;
});

function App() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [shellCommand, setShellCommand] = useState("");
  const [shellOutput, setShellOutput] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [logcatLines, setLogcatLines] = useState<Record<string, LogcatLineEntry[]>>({});
  const [logcatSourceMode, setLogcatSourceMode] = useState<LogcatSourceMode>("tag");
  const [logcatSourceValue, setLogcatSourceValue] = useState("");
  const [logcatLevels, setLogcatLevels] = useState<LogcatLevelsState>(defaultLogcatLevels);
  const [logcatLiveFilter, setLogcatLiveFilter] = useState("");
  const [logcatActiveFilters, setLogcatActiveFilters] = useState<string[]>([]);
  const [logcatPresetName, setLogcatPresetName] = useState("");
  const [logcatPresets, setLogcatPresets] = useState<{ name: string; patterns: string[] }[]>([]);
  const [logcatPresetSelected, setLogcatPresetSelected] = useState("");
  const [logcatFiltersExpanded, setLogcatFiltersExpanded] = useState(false);
  const [logcatSearchTerm, setLogcatSearchTerm] = useState("");
  const [logcatSearchRegex, setLogcatSearchRegex] = useState(false);
  const [logcatSearchCaseSensitive, setLogcatSearchCaseSensitive] = useState(false);
  const [logcatSearchOnly, setLogcatSearchOnly] = useState(false);
  const [logcatSearchOpen, setLogcatSearchOpen] = useState(false);
  const [logcatAutoScroll, setLogcatAutoScroll] = useState(true);
  const [logcatActiveFilterSummary, setLogcatActiveFilterSummary] = useState("");
  const [logcatLastExport, setLogcatLastExport] = useState("");
  const [logcatAdvancedOpen, setLogcatAdvancedOpen] = useState(false);
  const [filesPath, setFilesPath] = useState("/sdcard");
  const [files, setFiles] = useState<DeviceFileEntry[]>([]);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [filesSelectedPaths, setFilesSelectedPaths] = useState<string[]>([]);
  const [filesOverwriteEnabled, setFilesOverwriteEnabled] = useState(true);
  const [filesDropActive, setFilesDropActive] = useState(false);
  const [filesModal, setFilesModal] = useState<
    | null
    | { type: "mkdir"; name: string }
    | { type: "rename"; entry: DeviceFileEntry; newName: string }
    | { type: "delete"; entry: DeviceFileEntry; recursive: boolean; confirm: string }
    | { type: "delete_many"; entries: DeviceFileEntry[]; recursive: boolean; confirm: string }
  >(null);
  const [uiHtml, setUiHtml] = useState("");
  const [uiXml, setUiXml] = useState("");
  const [uiScreenshotDataUrl, setUiScreenshotDataUrl] = useState("");
  const [uiScreenshotError, setUiScreenshotError] = useState("");
  const [uiInspectorTab, setUiInspectorTab] = useState<"hierarchy" | "xml">("hierarchy");
  const [uiInspectorSearch, setUiInspectorSearch] = useState("");
  const [uiExportResult, setUiExportResult] = useState("");
  const [uiZoom, setUiZoom] = useState(1);
  const [uiBoundsEnabled, setUiBoundsEnabled] = useState(true);
  const [uiScreenshotSize, setUiScreenshotSize] = useState({ width: 0, height: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [groupMap, setGroupMap] = useState<Record<string, string>>({});
  const [groupName, setGroupName] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
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
  const [screenRecordRemote, setScreenRecordRemote] = useState<string | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [appsFilter, setAppsFilter] = useState("");
  const [appsThirdPartyOnly, setAppsThirdPartyOnly] = useState(true);
  const [appsIncludeVersions, setAppsIncludeVersions] = useState(false);
  const [selectedApp, setSelectedApp] = useState<AppInfo | null>(null);
  const [bugreportProgress, setBugreportProgress] = useState<number | null>(null);
  const [bugreportResult, setBugreportResult] = useState<BugreportResult | null>(null);
  const [bluetoothEvents, setBluetoothEvents] = useState<string[]>([]);
  const [bluetoothState, setBluetoothStateText] = useState<string>("");
  const [scrcpyInfo, setScrcpyInfo] = useState<ScrcpyInfo | null>(null);
  const [adbInfo, setAdbInfo] = useState<AdbInfo | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [pairingState, dispatchPairing] = useReducer(pairingReducer, initialPairingState);
  const [actionForm, setActionForm] = useState<ActionFormState>(initialActionFormState);
  const [taskState, dispatchTasks] = useReducer(tasksReducer, undefined, () => createInitialTaskState(50));
  const [actionOutputDir, setActionOutputDir] = useState("");
  const [actionRebootMode, setActionRebootMode] = useState("normal");
  const [actionDraftConfig, setActionDraftConfig] = useState<AppConfig | null>(null);
  const [logcatMatchIndex, setLogcatMatchIndex] = useState(0);
  const logcatOutputRef = useRef<HTMLDivElement | null>(null);
  const uiScreenshotImgRef = useRef<HTMLImageElement | null>(null);
  const uiBoundsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);
  const bugreportTaskBySerialRef = useRef<Record<string, string>>({});
  const fileTransferTaskByTraceIdRef = useRef<Record<string, string>>({});
  const logcatPendingRef = useRef<Record<string, string[]>>({});
  const logcatNextIdRef = useRef<Record<string, number>>({});
  const logcatFlushTimerRef = useRef<number | null>(null);
  const filesDragContextRef = useRef<{
    pathname: string;
    serial: string;
    path: string;
    overwrite: boolean;
    existingNames: string[];
  }>({ pathname: "/", serial: "", path: "/sdcard", overwrite: true, existingNames: [] });

  const location = useLocation();
  const navigate = useNavigate();
  const activeSerial = selectedSerials[0];
  const activeDevice = useMemo(
    () => devices.find((device) => device.summary.serial === activeSerial) ?? null,
    [devices, activeSerial],
  );
  const hasDevices = devices.length > 0;
  const selectedCount = selectedSerials.length;
  const deviceStatus = activeDevice?.summary.state ?? "offline";
  const deviceStatusLabel = useMemo(() => {
    if (!activeSerial) {
      return "No device";
    }
    if (deviceStatus === "device") {
      return "Online";
    }
    if (deviceStatus === "unauthorized") {
      return "Unauthorized";
    }
    if (deviceStatus === "offline") {
      return "Offline";
    }
    return deviceStatus;
  }, [activeSerial, deviceStatus]);
  const deviceStatusTone = useMemo(() => {
    if (!activeSerial) {
      return "idle";
    }
    if (deviceStatus === "device") {
      return "ok";
    }
    if (deviceStatus === "unauthorized") {
      return "error";
    }
    return "warn";
  }, [activeSerial, deviceStatus]);

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
        dispatchTasks({ type: "TASK_SET_ALL", items: inflated.items, max_items: inflated.max_items });
      } catch (error) {
        console.warn("Failed to load Task Center state from storage.", error);
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

  const logcatFiltered = useMemo(
    () =>
      filterLogcatEntries(rawLogcatLines, {
        levels: logcatLevels,
        activePatterns: logcatActiveFilters,
        livePattern: logcatLiveFilter,
        searchTerm: logcatSearchTerm,
        searchCaseSensitive: logcatSearchCaseSensitive,
        searchRegex: logcatSearchRegex,
        searchOnly: logcatSearchOnly,
      }),
    [
      rawLogcatLines,
      logcatLevels,
      logcatActiveFilters,
      logcatLiveFilter,
      logcatSearchTerm,
      logcatSearchCaseSensitive,
      logcatSearchRegex,
      logcatSearchOnly,
    ],
  );

  const selectedLogcatPreset = useMemo(
    () => logcatPresets.find((preset) => preset.name === logcatPresetSelected) ?? null,
    [logcatPresets, logcatPresetSelected],
  );

  const runningTaskCount = useMemo(
    () => taskState.items.filter((task) => task.status === "running").length,
    [taskState.items],
  );

  useEffect(() => {
    if (!logcatPresetSelected) {
      return;
    }
    if (!logcatPresets.some((preset) => preset.name === logcatPresetSelected)) {
      setLogcatPresetSelected("");
    }
  }, [logcatPresets, logcatPresetSelected]);

  const uiScreenshotSrc = uiScreenshotDataUrl;
  const uiNodesParse = useMemo(() => parseUiNodes(uiXml), [uiXml]);

  const filteredUiXml = useMemo(() => {
    const query = uiInspectorSearch.trim().toLowerCase();
    if (!query) {
      return uiXml;
    }
    return uiXml
      .split("\n")
      .filter((line) => line.toLowerCase().includes(query))
      .join("\n");
  }, [uiXml, uiInspectorSearch]);

  useEffect(() => {
    if (!uiScreenshotSrc) {
      setUiScreenshotSize({ width: 0, height: 0 });
    }
  }, [uiScreenshotSrc]);

  const [uiHoveredNodeIndex, setUiHoveredNodeIndex] = useState<number>(-1);
  const [uiSelectedNodeIndex, setUiSelectedNodeIndex] = useState<number>(-1);
  const uiHoverRafRef = useRef<number | null>(null);
  const uiLastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const uiHoveredNode = uiHoveredNodeIndex >= 0 ? uiNodesParse.nodes[uiHoveredNodeIndex] : null;
  const uiSelectedNode = uiSelectedNodeIndex >= 0 ? uiNodesParse.nodes[uiSelectedNodeIndex] : null;

  useEffect(() => {
    setUiHoveredNodeIndex(-1);
    setUiSelectedNodeIndex(-1);
  }, [uiXml]);

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

  const handleSelectActiveSerial = (serial: string) => {
    if (!serial) {
      return;
    }
    setSelectedSerials((prev) => {
      const remaining = prev.filter((item) => item !== serial);
      return [serial, ...remaining];
    });
  };

  const openPairingModal = () => dispatchPairing({ type: "OPEN" });
  const closePairingModal = () => dispatchPairing({ type: "CLOSE" });

  const openActionForm = (actionId: QuickActionId) => {
    setActionForm({ isOpen: true, actionId, errors: [] });
    setActionOutputDir(config?.output_path ?? "");
    setActionRebootMode("normal");
    setActionDraftConfig(config ? (JSON.parse(JSON.stringify(config)) as AppConfig) : null);
  };

  const closeActionForm = () => setActionForm(initialActionFormState);

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

  const updateDraftConfig = (updater: (current: AppConfig) => AppConfig) => {
    setActionDraftConfig((prev) => (prev ? updater(prev) : prev));
  };

  const pushToast = (message: string, tone: Toast["tone"]) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  };

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

  const refreshDevices = async () => {
    setBusy(true);
    try {
      const adbResponse = await checkAdb();
      setAdbInfo(adbResponse.data);
      if (!adbResponse.data.available) {
        setDevices([]);
        setSelectedSerials([]);
        return;
      }
      const response = await listDevices(true);
      setDevices(response.data);
      setSelectedSerials((prev) =>
        {
          const stillValid = prev.filter((serial) =>
            response.data.some((device) => device.summary.serial === serial),
          );
          if (stillValid.length > 0) {
            return stillValid;
          }
          const preferred =
            response.data.find((device) => device.summary.state === "device") ?? response.data[0];
          return preferred ? [preferred.summary.serial] : [];
        },
      );
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
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
      dispatchPairing({
        type: "PAIR_SUCCESS",
        message,
        connectAddress: parsed.connectAddress || pairingState.connectAddress,
      });
      pushToast("Wireless pairing succeeded.", "info");
    } catch (error) {
      const message = formatError(error);
      dispatchPairing({ type: "PAIR_ERROR", error: message });
      pushToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleConnectSubmit = async () => {
    const addressError = validateHostPort(pairingState.connectAddress);
    if (addressError) {
      dispatchPairing({ type: "CONNECT_ERROR", error: addressError });
      return;
    }
    setBusy(true);
    dispatchPairing({ type: "CONNECT_START" });
    try {
      const response = await adbConnect(pairingState.connectAddress.trim());
      const message = response.data.stdout.trim() || "Connected.";
      dispatchPairing({ type: "CONNECT_SUCCESS", message });
      pushToast("Wireless connect succeeded.", "info");
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
      setGroupMap(flattenGroups(response.data.device_groups));
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  useEffect(() => {
    void (async () => {
      await loadConfig();
      await refreshDevices();
      void checkScrcpy().then((response) => setScrcpyInfo(response.data)).catch(() => null);
    })();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("logcat_presets");
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as { name: string; patterns: string[] }[];
      if (Array.isArray(parsed)) {
        setLogcatPresets(parsed.filter((preset) => preset.name && preset.patterns));
      }
    } catch {
      setLogcatPresets([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("logcat_presets", JSON.stringify(logcatPresets));
  }, [logcatPresets]);

  useEffect(() => {
    if (!config) {
      return;
    }
    setConfig((prev) =>
      prev ? { ...prev, device_groups: expandGroups(groupMap) } : prev,
    );
  }, [groupMap]);

  useEffect(() => {
    if (!logcatAutoScroll) {
      return;
    }
    if (logcatOutputRef.current) {
      logcatOutputRef.current.scrollTop = logcatOutputRef.current.scrollHeight;
    }
  }, [logcatFiltered.lines.length, logcatAutoScroll]);

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
    const flushLogcatPending = () => {
      logcatFlushTimerRef.current = null;
      const pending = logcatPendingRef.current;
      const serials = Object.keys(pending);
      if (!serials.length) {
        return;
      }
      logcatPendingRef.current = {};
      setLogcatLines((prev) => {
        const next: Record<string, LogcatLineEntry[]> = { ...prev };
        serials.forEach((serial) => {
          const existing = next[serial] ?? [];
          const appended = pending[serial] ?? [];
          let nextId =
            logcatNextIdRef.current[serial] ??
            existing[existing.length - 1]?.id ??
            0;
          const appendedEntries: LogcatLineEntry[] = appended.map((text) => {
            nextId += 1;
            return { id: nextId, text };
          });
          logcatNextIdRef.current[serial] = nextId;
          next[serial] = [...existing, ...appendedEntries].slice(-2000);
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

    const unlistenLogcat = listen<LogcatEvent>("logcat-line", (event) => {
      const payload = event.payload;
      const bucket = (logcatPendingRef.current[payload.serial] ??= []);
      bucket.push(payload.line);
      scheduleLogcatFlush();
    });
    const unlistenBluetoothSnapshot = listen("bluetooth-snapshot", (event) => {
      const payload = event.payload as { snapshot?: { summary?: string } };
      if (payload?.snapshot?.summary) {
        setBluetoothStateText(payload.snapshot.summary);
      }
    });
    const unlistenBluetoothState = listen("bluetooth-state", (event) => {
      const payload = event.payload as { state?: { summary?: string } };
      if (payload?.state?.summary) {
        setBluetoothStateText(payload.state.summary);
      }
    });
    const unlistenBluetoothEvent = listen("bluetooth-event", (event) => {
      const payload = event.payload as { event?: { message?: string } };
      if (payload?.event?.message) {
        setBluetoothEvents((prev) => [payload.event?.message ?? "", ...prev].slice(0, 200));
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
    const unlistenBugreportProgress = listen<BugreportProgress>("bugreport-progress", (event) => {
      const payload = event.payload;
      if (!activeSerial || payload.serial === activeSerial) {
        setBugreportProgress(payload.progress);
      }
      const taskId = bugreportTaskBySerialRef.current[payload.serial];
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
        setBugreportProgress(payload.result.progress ?? null);
      }
      const serial = payload?.result?.serial;
      if (!serial) {
        return;
      }
      const taskId = bugreportTaskBySerialRef.current[serial];
      if (!taskId || !payload.result) {
        return;
      }

      if (payload.trace_id) {
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: payload.trace_id });
      }
      const errorText = payload.result.error?.trim() ?? "";
      const cancelled = errorText.toLowerCase().includes("cancel");
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial,
        patch: {
          status: payload.result.success ? "success" : cancelled ? "cancelled" : "error",
          progress: payload.result.progress ?? null,
          output_path: payload.result.output_path ?? null,
          message: payload.result.success
            ? "Bugreport completed."
            : cancelled
              ? "Bugreport cancelled."
              : payload.result.error ?? "Bugreport failed.",
        },
      });
      dispatchTasks({
        type: "TASK_SET_STATUS",
        id: taskId,
        status: payload.result.success ? "success" : cancelled ? "cancelled" : "error",
      });
      delete bugreportTaskBySerialRef.current[serial];
    });

    return () => {
      void unlistenLogcat.then((unlisten) => unlisten());
      if (logcatFlushTimerRef.current != null) {
        window.clearTimeout(logcatFlushTimerRef.current);
        logcatFlushTimerRef.current = null;
      }
      logcatPendingRef.current = {};
      void unlistenBluetoothSnapshot.then((unlisten) => unlisten());
      void unlistenBluetoothState.then((unlisten) => unlisten());
      void unlistenBluetoothEvent.then((unlisten) => unlisten());
      void unlistenFileTransferProgress.then((unlisten) => unlisten());
      void unlistenBugreportProgress.then((unlisten) => unlisten());
      void unlistenBugreportComplete.then((unlisten) => unlisten());
    };
  }, [activeSerial]);

  const groupOptions = useMemo(
    () => Array.from(new Set(Object.values(groupMap))).filter(Boolean).sort(),
    [groupMap],
  );

  const visibleDevices = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    return devices.filter((device) => {
      const serial = device.summary.serial;
      const model = device.detail?.model ?? device.summary.model ?? "";
      const matchesSearch = !search || serial.toLowerCase().includes(search) || model.toLowerCase().includes(search);
      if (!matchesSearch) {
        return false;
      }
      if (groupFilter === "all") {
        return true;
      }
      return groupMap[serial] === groupFilter;
    });
  }, [devices, groupFilter, groupMap, searchText]);

  const toggleDevice = (serial: string) => {
    setSelectedSerials((prev) =>
      prev.includes(serial) ? prev.filter((item) => item !== serial) : [...prev, serial],
    );
  };

  const handleDeviceRowSelect = (
    event: React.MouseEvent<HTMLElement>,
    serial: string,
    index: number,
  ) => {
    event.preventDefault();
    const isMeta = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;

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
      setSelectedSerials((prev) => {
        if (prev.length === 1 && prev[0] === serial) {
          return prev;
        }
        return [serial];
      });
    }

    lastSelectedIndexRef.current = index;
  };

  const selectAllVisible = () => {
    setSelectedSerials(visibleDevices.map((device) => device.summary.serial));
  };

  const clearSelection = () => {
    setSelectedSerials([]);
  };

  const handleAssignGroup = () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device to assign group.", "error");
      return;
    }
    const trimmed = groupName.trim();
    setGroupMap((prev) => {
      const next = { ...prev };
      for (const serial of selectedSerials) {
        if (trimmed) {
          next[serial] = trimmed;
        } else {
          delete next[serial];
        }
      }
      return next;
    });
    pushToast(trimmed ? `Assigned ${trimmed}.` : "Cleared group assignment.", "info");
  };

	  const handleRunShell = async () => {
	    if (!shellCommand.trim()) {
	      pushToast("Please enter a shell command.", "error");
	      return;
	    }
	    if (!selectedSerials.length) {
	      pushToast("Select at least one device.", "error");
	      return;
	    }
	    const shortCommand = shellCommand.trim().slice(0, 80);
	    const taskId = beginTask({
	      kind: "shell",
	      title: `Shell: ${shortCommand}${shellCommand.trim().length > 80 ? "…" : ""}`,
	      serials: selectedSerials,
	    });
	    setBusy(true);
	    try {
		      const response = await runShell(selectedSerials, shellCommand, config?.command.parallel_execution);
		      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
		      const output = response.data.map((result) => {
		        const combined = `${result.serial} (${result.exit_code ?? "?"}):\n${result.stdout || result.stderr || ""}`;
		        return truncateText(combined, 20_000);
		      });
		      setShellOutput(output);
		      response.data.forEach((result) => {
		        const combined = (result.stdout || result.stderr || "").trim();
		        dispatchTasks({
		          type: "TASK_UPDATE_DEVICE",
		          id: taskId,
		          serial: result.serial,
		          patch: {
		            status: result.exit_code === 0 ? "success" : "error",
		            exit_code: result.exit_code ?? null,
		            stdout: result.stdout ? truncateText(result.stdout, 50_000) : null,
		            stderr: result.stderr ? truncateText(result.stderr, 50_000) : null,
		            message: combined ? combined.split("\n")[0].slice(0, 160) : "No output.",
		          },
		        });
		      });
	      const hasError = response.data.some((item) => item.exit_code !== 0);
	      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: hasError ? "error" : "success" });
	      pushToast("Shell command completed.", "info");
	    } catch (error) {
	      selectedSerials.forEach((serial) => {
	        dispatchTasks({
	          type: "TASK_UPDATE_DEVICE",
	          id: taskId,
	          serial,
	          patch: { status: "error", message: formatError(error) },
	        });
	      });
	      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
	      pushToast(formatError(error), "error");
	    } finally {
	      setBusy(false);
	    }
	  };

  const handleReboot = async (mode?: string) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      await rebootDevices(selectedSerials, mode);
      pushToast("Reboot command sent.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleWifi = async (enable: boolean) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      await setWifiState(selectedSerials, enable);
      pushToast(enable ? "WiFi enabled." : "WiFi disabled.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBluetooth = async (enable: boolean) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      await setBluetoothState(selectedSerials, enable);
      pushToast(enable ? "Bluetooth enabled." : "Bluetooth disabled.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

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

	    setApkInstallSummary([]);
	    setBusy(true);
	    try {
	      const summaries: string[] = [];
	      for (const path of paths) {
	        const name = path.split(/[/\\\\]/).pop() ?? path;
	        const taskId = beginTask({
	          kind: "apk_install",
	          title: `APK Install: ${name}`,
	          serials: selectedSerials,
	        });
	        try {
	          const response = await installApkBatch(
	            selectedSerials,
	            path,
	            apkReplace,
	            apkAllowDowngrade,
	            apkGrant,
	            apkAllowTest,
	            apkExtraArgs,
	          );
	          dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
	          const results = Object.values(response.data.results || {});
	          const successCount = results.filter((item) => item.success).length;
	          summaries.push(`${path}: Installed ${successCount}/${results.length} device(s)`);
	          results.forEach((item) => {
	            dispatchTasks({
	              type: "TASK_UPDATE_DEVICE",
	              id: taskId,
	              serial: item.serial,
	              patch: {
	                status: item.success ? "success" : "error",
	                message: item.success ? "Installed." : item.raw_output || item.error_code,
	              },
	            });
	          });
	          const hasError = results.some((item) => !item.success);
	          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: hasError ? "error" : "success" });
	        } catch (error) {
	          selectedSerials.forEach((serial) => {
	            dispatchTasks({
	              type: "TASK_UPDATE_DEVICE",
	              id: taskId,
	              serial,
	              patch: { status: "error", message: formatError(error) },
	            });
	          });
	          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
	          throw error;
	        }
	      }
	      setApkInstallSummary(summaries);
	      pushToast("APK install completed.", "info");

      if (apkLaunchAfterInstall) {
        const error = validatePackageName(apkLaunchPackage);
        if (error) {
          pushToast(error, "error");
        } else {
          const response = await launchApp(selectedSerials, apkLaunchPackage.trim());
          const successCount = response.data.filter((item) => item.exit_code === 0).length;
          pushToast(`Launch requested (${successCount}/${response.data.length}).`, "info");
        }
      }
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

	  const handleBugreport = async () => {
	    if (!activeSerial) {
	      pushToast("Select one device for bugreport.", "error");
	      return;
	    }
	    let outputDir = config?.output_path || "";
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
	    const taskId = beginTask({
	      kind: "bugreport",
	      title: `Bugreport: ${activeSerial}`,
	      serials: [activeSerial],
	    });
	    bugreportTaskBySerialRef.current[activeSerial] = taskId;
	    dispatchTasks({
	      type: "TASK_UPDATE_DEVICE",
	      id: taskId,
	      serial: activeSerial,
	      patch: { status: "running", progress: 0, message: "Starting bugreport…" },
	    });
	    setBusy(true);
	    setBugreportProgress(0);
	    try {
	      const response = await generateBugreport(activeSerial, outputDir);
	      setBugreportResult(response.data);
	      // Task status is finalized via the bugreport-complete event.
	      if (response.data.success) {
	        pushToast(`Bugreport saved to ${response.data.output_path}`, "info");
	      } else {
	        pushToast(response.data.error || "Bugreport failed", "error");
	      }
	    } catch (error) {
	      dispatchTasks({
	        type: "TASK_UPDATE_DEVICE",
	        id: taskId,
	        serial: activeSerial,
	        patch: { status: "error", message: formatError(error) },
	      });
	      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
	      delete bugreportTaskBySerialRef.current[activeSerial];
	      pushToast(formatError(error), "error");
	    } finally {
	      setBusy(false);
	    }
	  };

	  const handleCancelBugreport = async () => {
	    if (!activeSerial) {
	      return;
	    }
	    try {
	      await cancelBugreport(activeSerial);
	      const taskId = bugreportTaskBySerialRef.current[activeSerial];
	      if (taskId) {
	        dispatchTasks({
	          type: "TASK_UPDATE_DEVICE",
	          id: taskId,
	          serial: activeSerial,
	          patch: { status: "cancelled", message: "Bugreport cancel requested." },
	        });
	        dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "cancelled" });
	      }
	      pushToast("Bugreport cancelled.", "info");
	    } catch (error) {
	      pushToast(formatError(error), "error");
	    }
	  };

  const addActiveLogcatFilter = () => {
    const value = logcatLiveFilter.trim();
    if (!value) {
      return;
    }
    setLogcatActiveFilters((prev) => Array.from(new Set([...prev, value])));
    setLogcatLiveFilter("");
  };

  const removeActiveLogcatFilter = (pattern: string) => {
    setLogcatActiveFilters((prev) => prev.filter((item) => item !== pattern));
  };

  const clearActiveLogcatFilters = () => {
    setLogcatActiveFilters([]);
  };

  const saveLogcatPreset = () => {
    const name = logcatPresetName.trim();
    if (!name) {
      pushToast("Preset name is required.", "error");
      return;
    }
    if (logcatActiveFilters.length === 0) {
      pushToast("Add at least one active filter.", "error");
      return;
    }
    setLogcatPresets((prev) => [
      ...prev.filter((preset) => preset.name !== name),
      { name, patterns: logcatActiveFilters },
    ]);
    setLogcatPresetName("");
    setLogcatPresetSelected(name);
    pushToast("Preset saved.", "info");
  };

  const applyLogcatPreset = (name: string) => {
    const preset = logcatPresets.find((item) => item.name === name);
    if (!preset) {
      return;
    }
    setLogcatActiveFilters(preset.patterns);
  };

  const deleteLogcatPreset = (name: string) => {
    setLogcatPresets((prev) => prev.filter((item) => item.name !== name));
    if (logcatPresetSelected === name) {
      setLogcatPresetSelected("");
    }
  };

  const handleLogcatStart = async () => {
    if (!activeSerial) {
      pushToast("Select one device for logcat.", "error");
      return;
    }
    const sourceValue = logcatSourceValue.trim();
    let filter = "";
    if (logcatSourceMode === "package") {
      if (!sourceValue) {
        pushToast("Package name is required for package mode.", "error");
        return;
      }
      try {
        const response = await runShell([activeSerial], `pidof ${sourceValue}`, false);
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
      await startLogcat(activeSerial, filter || undefined);
      setLogcatActiveFilterSummary(filter || "All");
      pushToast("Logcat started.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatStop = async () => {
    if (!activeSerial) {
      pushToast("Select one device for logcat.", "error");
      return;
    }
    setBusy(true);
    try {
      await stopLogcat(activeSerial);
      pushToast("Logcat stopped.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatClearBuffer = async () => {
    if (!activeSerial) {
      pushToast("Select one device for logcat.", "error");
      return;
    }
    setBusy(true);
    try {
      await clearLogcat(activeSerial);
      setLogcatLines((prev) => ({ ...prev, [activeSerial]: [] }));
      pushToast("Logcat buffer cleared.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatClearView = () => {
    if (!activeSerial) {
      return;
    }
    setLogcatLines((prev) => ({ ...prev, [activeSerial]: [] }));
  };

  const handleLogcatExport = async () => {
    if (!activeSerial) {
      pushToast("Select one device for logcat export.", "error");
      return;
    }
    if (!logcatFiltered.lines.length) {
      pushToast("No logcat lines to export.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await exportLogcat(
        activeSerial,
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

  const toggleLogcatAdvanced = () => {
    setLogcatAdvancedOpen((prev) => !prev);
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
    const target = container.querySelector(`[data-log-id="${matchId}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "center" });
    }
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
      setFilesSelectedPaths([]);
    } catch (error) {
      pushToast(`Refresh failed: ${formatError(error)}`, "error");
    }
  };

  const handleFilesRefresh = async (pathOverride?: string) => {
    if (!activeSerial) {
      pushToast("Select one device for file browse.", "error");
      return;
    }
    const targetPath = (pathOverride ?? filesPath).trim();
    if (!targetPath.startsWith("/")) {
      pushToast("Device path must start with '/'.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await listDeviceFiles(activeSerial, targetPath);
      setFilesPath(targetPath);
      setFiles(response.data);
      setFilePreview(null);
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
    if (!activeSerial) {
      pushToast("Select one device for file pull.", "error");
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
          serials: [activeSerial],
        });
        const traceId = crypto.randomUUID();
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
        fileTransferTaskByTraceIdRef.current[traceId] = taskId;
        try {
          const response = await pullDeviceFile(activeSerial, entry.path, outputDir, traceId);
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial: activeSerial,
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
            serial: activeSerial,
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
    if (!activeSerial) {
      pushToast("Select one device for folder create.", "error");
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
      serials: [activeSerial],
    });
    setBusy(true);
    try {
      const response = await mkdirDeviceDir(activeSerial, targetDir);
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial: activeSerial,
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
        serial: activeSerial,
        patch: { status: "error", message: formatError(error) },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFilesRenameSubmit = async () => {
    if (!activeSerial) {
      pushToast("Select one device for rename.", "error");
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
      serials: [activeSerial],
    });
    setBusy(true);
    try {
      const response = await renameDevicePath(activeSerial, fromPath, toPath);
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial: activeSerial,
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
        serial: activeSerial,
        patch: { status: "error", message: formatError(error) },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFilesDeleteSubmit = async () => {
    if (!activeSerial) {
      pushToast("Select one device for delete.", "error");
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
      serials: [activeSerial],
    });
    setBusy(true);
    try {
      const response = await deleteDevicePath(activeSerial, filesModal.entry.path, filesModal.recursive);
      dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial: activeSerial,
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
        serial: activeSerial,
        patch: { status: "error", message: formatError(error) },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFilesDeleteManySubmit = async () => {
    if (!activeSerial) {
      pushToast("Select one device for delete.", "error");
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
          serials: [activeSerial],
        });
        try {
          const response = await deleteDevicePath(activeSerial, entry.path, filesModal.recursive);
          dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial: activeSerial,
            patch: { status: "success", message: `Deleted ${response.data}` },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
        } catch (error) {
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial: activeSerial,
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
    if (!activeSerial) {
      pushToast("Select one device for file upload.", "error");
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
      serials: [activeSerial],
    });
    dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
    fileTransferTaskByTraceIdRef.current[traceId] = taskId;
    setBusy(true);
    try {
      const response = await pushDeviceFile(activeSerial, selected, remotePath, traceId);
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial: activeSerial,
        patch: { status: "success", progress: 100, message: `Uploaded to ${response.data}` },
      });
      dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
      pushToast(`Uploaded to ${response.data}`, "info");
      try {
        const listResponse = await listDeviceFiles(activeSerial, filesPath.trim());
        setFiles(listResponse.data);
        setFilePreview(null);
      } catch (error) {
        pushToast(`Uploaded. Refresh failed: ${formatError(error)}`, "error");
      }
    } catch (error) {
      dispatchTasks({
        type: "TASK_UPDATE_DEVICE",
        id: taskId,
        serial: activeSerial,
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
    const unlistenPromise = getCurrentWindow().onDragDropEvent((event) => {
      const ctx = filesDragContextRef.current;
      const payload = event.payload;
      if (ctx.pathname !== "/files") {
        return;
      }
      if (payload.type === "enter" || payload.type === "over") {
        setFilesDropActive(true);
        return;
      }
      if (payload.type === "leave") {
        setFilesDropActive(false);
        return;
      }
      if (payload.type !== "drop") {
        return;
      }
      setFilesDropActive(false);
      if (!payload.paths.length) {
        return;
      }
      if (!ctx.serial) {
        pushToast("Select one device for file upload.", "error");
        return;
      }
      const existing = new Set(ctx.existingNames);
      const uploadDroppedFiles = async () => {
        setBusy(true);
        try {
          for (const path of payload.paths) {
            const filename = basenameFromHostPath(path);
            if (!ctx.overwrite && existing.has(filename)) {
              pushToast(`Upload blocked: ${filename} already exists.`, "error");
              continue;
            }
	            const remotePath = deviceJoin(ctx.path, filename);
	            const taskId = beginTask({
	              kind: "file_push",
	              title: `Upload File: ${filename}`,
	              serials: [ctx.serial],
	            });
	            const traceId = crypto.randomUUID();
	            dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
	            fileTransferTaskByTraceIdRef.current[traceId] = taskId;
	            try {
	              const response = await pushDeviceFile(ctx.serial, path, remotePath, traceId);
	              dispatchTasks({
	                type: "TASK_UPDATE_DEVICE",
	                id: taskId,
	                serial: ctx.serial,
	                patch: { status: "success", progress: 100, message: `Uploaded to ${response.data}` },
	              });
	              dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
	              existing.add(filename);
	            } catch (error) {
	              dispatchTasks({
	                type: "TASK_UPDATE_DEVICE",
	                id: taskId,
	                serial: ctx.serial,
	                patch: { status: "error", message: formatError(error), progress: null },
	              });
	              dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
	              pushToast(`Upload failed: ${filename} (${formatError(error)})`, "error");
	            } finally {
	              delete fileTransferTaskByTraceIdRef.current[traceId];
	            }
	          }
	          await refreshFilesList(ctx.path);
	        } finally {
          setBusy(false);
        }
      };
      void uploadDroppedFiles();
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

		  const handleFilePull = async (entry: DeviceFileEntry) => {
		    if (!activeSerial) {
		      pushToast("Select one device for file pull.", "error");
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
		      serials: [activeSerial],
		    });
		    dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
		    fileTransferTaskByTraceIdRef.current[traceId] = taskId;
		    setBusy(true);
		    try {
		      const response = await pullDeviceFile(activeSerial, entry.path, outputDir, traceId);
		      dispatchTasks({
		        type: "TASK_UPDATE_DEVICE",
		        id: taskId,
		        serial: activeSerial,
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
	      } catch (error) {
	        dispatchTasks({
	          type: "TASK_UPDATE_DEVICE",
	          id: taskId,
	          serial: activeSerial,
	          patch: { message: `Pulled. Preview failed: ${formatError(error)}` },
	        });
	      }
		    } catch (error) {
		      dispatchTasks({
		        type: "TASK_UPDATE_DEVICE",
		        id: taskId,
		        serial: activeSerial,
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
    if (!activeSerial) {
      pushToast("Select one device for UI inspector.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await captureUiHierarchy(activeSerial);
      setUiHtml(response.data.html);
      setUiXml(response.data.xml);
      setUiScreenshotDataUrl(response.data.screenshot_data_url ?? "");
      setUiScreenshotError(response.data.screenshot_error ?? "");
      setUiInspectorTab("hierarchy");
      setUiInspectorSearch("");
      setUiExportResult("");
      pushToast("UI hierarchy captured.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleUiExport = async () => {
    if (!activeSerial) {
      pushToast("Select one device for UI inspector export.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await exportUiHierarchy(activeSerial, config?.file_gen_output_path || config?.output_path);
      setUiExportResult(response.data.html_path);
      pushToast("UI inspector export completed.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLoadApps = async () => {
    if (!activeSerial) {
      pushToast("Select one device.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await listApps(
        activeSerial,
        appsThirdPartyOnly ? true : undefined,
        appsIncludeVersions,
      );
      setApps(response.data);
      setSelectedApp(null);
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleAppAction = async (action: "uninstall" | "forceStop" | "clear" | "enable" | "disable" | "info") => {
    if (!activeSerial || !selectedApp) {
      pushToast("Select an app.", "error");
      return;
    }
    setBusy(true);
    try {
      if (action === "uninstall") {
        await uninstallApp(activeSerial, selectedApp.package_name, false);
      } else if (action === "forceStop") {
        await forceStopApp(activeSerial, selectedApp.package_name);
      } else if (action === "clear") {
        await clearAppData(activeSerial, selectedApp.package_name);
      } else if (action === "enable") {
        await setAppEnabled(activeSerial, selectedApp.package_name, true);
      } else if (action === "disable") {
        await setAppEnabled(activeSerial, selectedApp.package_name, false);
      } else if (action === "info") {
        await openAppInfo(activeSerial, selectedApp.package_name);
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
    setBusy(true);
    try {
      await launchScrcpy(selectedSerials);
      pushToast("scrcpy launched.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const resolveOutputDir = async (value: string) => {
    let outputDir = value.trim();
    if (!outputDir) {
      outputDir = config?.output_path ?? "";
    }
    if (!outputDir) {
      const selected = await openDialog({
        title: "Select output folder",
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        return null;
      }
      outputDir = selected;
    }
    return outputDir;
  };

  const persistActionConfig = async () => {
    if (!actionDraftConfig) {
      return;
    }
    const updated = {
      ...actionDraftConfig,
      device_groups: expandGroups(groupMap),
    };
    const response = await saveConfig(updated);
    setConfig(response.data);
    setGroupMap(flattenGroups(response.data.device_groups));
  };

  const handleActionSubmit = async () => {
    if (!actionForm.actionId) {
      return;
    }
    const errors: string[] = [];
    if (!activeSerial && actionForm.actionId !== "reboot") {
      errors.push("Select an active device to run this action.");
    }
    if (actionForm.actionId === "reboot" && !selectedSerials.length) {
      errors.push("Select at least one device to reboot.");
    }
    if (actionForm.actionId === "screenshot" && !actionOutputDir.trim() && !config?.output_path) {
      errors.push("Select an output folder for screenshots.");
    }
    if (actionForm.actionId === "record" && screenRecordRemote && !actionOutputDir.trim() && !config?.output_path) {
      errors.push("Select an output folder for recordings.");
    }
    if (actionForm.actionId === "mirror" && !scrcpyInfo?.available) {
      errors.push("scrcpy is not available. Install it to enable live mirror.");
    }
    if (
      (actionForm.actionId === "screenshot" ||
        actionForm.actionId === "record" ||
        actionForm.actionId === "mirror") &&
      !actionDraftConfig
    ) {
      errors.push("Settings are still loading. Try again in a moment.");
    }
    if (errors.length) {
      setActionForm((prev) => ({ ...prev, errors }));
      return;
    }

    setBusy(true);
    setActionForm((prev) => ({ ...prev, errors: [] }));
    try {
      if (actionForm.actionId === "screenshot") {
        await persistActionConfig();
        const outputDir = await resolveOutputDir(actionOutputDir);
        if (!outputDir) {
          return;
        }
        const response = await captureScreenshot(activeSerial!, outputDir);
        pushToast(`Screenshot saved to ${response.data}`, "info");
      } else if (actionForm.actionId === "reboot") {
        await handleReboot(actionRebootMode === "normal" ? undefined : actionRebootMode);
	      } else if (actionForm.actionId === "record") {
	        await persistActionConfig();
	        if (screenRecordRemote) {
	          const outputDir = await resolveOutputDir(actionOutputDir);
	          if (!outputDir) {
	            return;
	          }
	          const taskId = beginTask({
	            kind: "screen_record_stop",
	            title: `Screen Record Stop: ${activeSerial!}`,
	            serials: [activeSerial!],
	          });
	          try {
	            const response = await stopScreenRecord(activeSerial!, outputDir);
	            setScreenRecordRemote(null);
	            dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
	            dispatchTasks({
	              type: "TASK_UPDATE_DEVICE",
	              id: taskId,
	              serial: activeSerial!,
	              patch: {
	                status: "success",
	                output_path: response.data || null,
	                message: response.data ? `Saved to ${response.data}` : "Stopped.",
	              },
	            });
	            dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
	            pushToast(response.data ? `Recording saved to ${response.data}` : "Screen recording stopped.", "info");
	          } catch (error) {
	            dispatchTasks({
	              type: "TASK_UPDATE_DEVICE",
	              id: taskId,
	              serial: activeSerial!,
	              patch: { status: "error", message: formatError(error) },
	            });
	            dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
	            throw error;
	          }
	        } else {
	          const taskId = beginTask({
	            kind: "screen_record_start",
	            title: `Screen Record Start: ${activeSerial!}`,
	            serials: [activeSerial!],
	          });
	          try {
	            const response = await startScreenRecord(activeSerial!);
	            setScreenRecordRemote(response.data);
	            dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
	            dispatchTasks({
	              type: "TASK_UPDATE_DEVICE",
	              id: taskId,
	              serial: activeSerial!,
	              patch: { status: "success", message: `Remote: ${response.data}` },
	            });
	            dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
	            pushToast("Screen recording started.", "info");
	          } catch (error) {
	            dispatchTasks({
	              type: "TASK_UPDATE_DEVICE",
	              id: taskId,
	              serial: activeSerial!,
	              patch: { status: "error", message: formatError(error) },
	            });
	            dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
	            throw error;
	          }
	        }
      } else if (actionForm.actionId === "logcat-clear") {
        await clearLogcat(activeSerial!);
        setLogcatLines((prev) => ({ ...prev, [activeSerial!]: [] }));
        pushToast("Logcat cleared.", "info");
      } else if (actionForm.actionId === "mirror") {
        await persistActionConfig();
        await handleScrcpyLaunch();
      }
      closeActionForm();
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleBluetoothMonitor = async (enable: boolean) => {
    if (!activeSerial) {
      pushToast("Select one device.", "error");
      return;
    }
    setBusy(true);
    try {
      if (enable) {
        await startBluetoothMonitor(activeSerial);
      } else {
        await stopBluetoothMonitor(activeSerial);
      }
      pushToast(enable ? "Bluetooth monitor started." : "Bluetooth monitor stopped.", "info");
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
      const updated = {
        ...config,
        apk_install: {
          ...config.apk_install,
          allow_downgrade: apkAllowDowngrade,
          replace_existing: apkReplace,
          grant_permissions: apkGrant,
          allow_test_packages: apkAllowTest,
          extra_args: apkExtraArgs,
        },
        device_groups: expandGroups(groupMap),
      };
      const response = await saveConfig(updated);
      setConfig(response.data);
      setGroupMap(flattenGroups(response.data.device_groups));
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
      setGroupMap(flattenGroups(response.data.device_groups));
      setApkExtraArgs(response.data.apk_install.extra_args);
      setApkAllowDowngrade(response.data.apk_install.allow_downgrade);
      setApkReplace(response.data.apk_install.replace_existing);
      setApkGrant(response.data.apk_install.grant_permissions);
      setApkAllowTest(response.data.apk_install.allow_test_packages);
      setAdbInfo(null);
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

  const handleCopyDeviceInfo = async () => {
    if (!activeSerial) {
      pushToast("Select one device.", "error");
      return;
    }
    const device = devices.find((item) => item.summary.serial === activeSerial);
    if (!device) {
      return;
    }
    const detail = device.detail;
    const lines = [
      `Serial: ${device.summary.serial}`,
      `State: ${device.summary.state}`,
      `Model: ${detail?.model ?? device.summary.model ?? ""}`,
      `Android: ${detail?.android_version ?? ""}`,
      `API: ${detail?.api_level ?? ""}`,
      `WiFi: ${detail?.wifi_is_on != null ? (detail.wifi_is_on ? "On" : "Off") : "Unknown"}`,
      `Bluetooth: ${detail?.bt_is_on != null ? (detail.bt_is_on ? "On" : "Off") : "Unknown"}`,
      `GMS: ${detail?.gms_version ?? ""}`,
      `Fingerprint: ${detail?.build_fingerprint ?? ""}`,
    ];
    try {
      await writeText(lines.join("\n"));
      pushToast("Device info copied.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const filteredApps = useMemo(() => {
    const query = appsFilter.trim().toLowerCase();
    if (!query) {
      return apps;
    }
    return apps.filter((app) => app.package_name.toLowerCase().includes(query));
  }, [apps, appsFilter]);

  const dashboardActions = [
    {
      id: "screenshot",
      title: "Screenshot",
      description: "Capture the current screen to the output folder.",
      onClick: () => openActionForm("screenshot"),
      disabled: busy || !activeSerial,
    },
    {
      id: "reboot",
      title: "Reboot",
      description: "Restart the active device.",
      onClick: () => openActionForm("reboot"),
      disabled: busy || !activeSerial,
    },
    {
      id: "record",
      title: screenRecordRemote ? "Stop Recording" : "Start Recording",
      description: screenRecordRemote
        ? "Finish and save the ongoing screen recording."
        : "Record the device screen for a short clip.",
      onClick: () => openActionForm("record"),
      disabled: busy || !activeSerial,
    },
    {
      id: "logcat-clear",
      title: "Clear Logcat",
      description: "Clear the logcat buffer for the active device.",
      onClick: () => openActionForm("logcat-clear"),
      disabled: busy || !activeSerial,
    },
    {
      id: "mirror",
      title: "Live Mirror",
      description: scrcpyInfo?.available
        ? "Launch scrcpy for a live mirror window."
        : "Install scrcpy to enable live mirroring.",
      onClick: () => openActionForm("mirror"),
      disabled: busy || selectedSerials.length === 0,
    },
    {
      id: "apk-installer",
      title: "APK Installer",
      description: "Install single, multiple, or split APK bundles.",
      onClick: () => navigate("/apk-installer"),
      disabled: busy,
    },
  ];

  const DashboardView = () => {
    const detail = activeDevice?.detail;
    const deviceName =
      detail?.model ?? activeDevice?.summary.model ?? activeSerial ?? "No device selected";
    const deviceState = activeDevice?.summary.state ?? "No device";
    const wifiState =
      detail?.wifi_is_on == null ? "Unknown" : detail.wifi_is_on ? "On" : "Off";
    const btState =
      detail?.bt_is_on == null ? "Unknown" : detail.bt_is_on ? "On" : "Off";

    if (adbInfo && !adbInfo.available) {
      return (
        <div className="page-section">
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
            </div>
            <div className="button-row">
              <button className="ghost" onClick={() => navigate("/settings")} disabled={busy}>
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
        <div className="page-section">
          <div className="page-header">
            <div>
              <h1>Dashboard</h1>
              <p className="muted">Connect a device to unlock quick actions and diagnostics.</p>
            </div>
          </div>
          <section className="panel empty-state">
            <div>
              <h2>Connect a device to get started</h2>
              <p className="muted">
                Plug in via USB or pair wirelessly. Once connected, you will see the device overview
                and quick actions here.
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
      <div className="page-section">
        <div className="page-header">
          <div>
            <h1>Dashboard</h1>
            <p className="muted">Overview, quick actions, and device health.</p>
          </div>
          <div className="page-actions">
            <button className="ghost" onClick={() => navigate("/devices")} disabled={busy}>
              Manage Devices
            </button>
          </div>
        </div>
        <div className="dashboard-grid">
          <section className="panel card">
            <div className="card-header">
              <h2>Device Overview</h2>
              <span className="badge">{deviceState}</span>
            </div>
            <div className="device-summary">
              <div className="device-primary">
                <p className="eyebrow">Active Device</p>
                <strong>{deviceName}</strong>
                <p className="muted">{activeSerial ?? "Select a device"}</p>
              </div>
              <div className="summary-grid">
                <div>
                  <span className="muted">Android</span>
                  <strong>{detail?.android_version ?? "--"}</strong>
                </div>
                <div>
                  <span className="muted">API</span>
                  <strong>{detail?.api_level ?? "--"}</strong>
                </div>
                <div>
                  <span className="muted">Battery</span>
                  <strong>{detail?.battery_level != null ? `${detail.battery_level}%` : "--"}</strong>
                </div>
                <div>
                  <span className="muted">WiFi</span>
                  <strong>{wifiState}</strong>
                </div>
                <div>
                  <span className="muted">Bluetooth</span>
                  <strong>{btState}</strong>
                </div>
                <div>
                  <span className="muted">GMS</span>
                  <strong>{detail?.gms_version ?? "--"}</strong>
                </div>
              </div>
            </div>
            <div className="button-row">
              <button className="ghost" onClick={handleCopyDeviceInfo} disabled={busy || !activeSerial}>
                Copy Device Info
              </button>
            </div>
          </section>

          <section className="panel card">
            <div className="card-header">
              <h2>Quick Actions</h2>
              <span className="muted">Most used</span>
            </div>
            <div className="quick-actions">
              {dashboardActions.map((action) => (
                <button
                  key={action.id}
                  className="quick-action"
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  <span>{action.title}</span>
                  <span className="muted">{action.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel card">
            <div className="card-header">
              <h2>Connection</h2>
              <span className="muted">{hasDevices ? "Online" : "Offline"}</span>
            </div>
            <div className="status-list">
              <div>
                <span className="muted">ADB Status</span>
                <strong>
                  {adbInfo == null ? "Checking..." : adbInfo.available ? "Available" : "Not available"}
                </strong>
              </div>
              <div>
                <span className="muted">Devices Connected</span>
                <strong>{devices.length}</strong>
              </div>
              <div>
                <span className="muted">Tasks</span>
                <strong>{runningTaskCount > 0 ? `${runningTaskCount} running` : "Idle"}</strong>
              </div>
              <div>
                <span className="muted">scrcpy</span>
                <strong>{scrcpyInfo?.available ? "Available" : "Not installed"}</strong>
              </div>
            </div>
            {!scrcpyInfo?.available && (
              <p className="muted">
                Install scrcpy to enable live mirror and high-fidelity interaction.
              </p>
            )}
          </section>

          <section className="panel card">
            <div className="card-header">
              <h2>Recent Apps</h2>
              <span className="muted">Quick access</span>
            </div>
            {apps.length === 0 ? (
              <div className="empty-inline">
                <p className="muted">No app list loaded yet.</p>
                <button className="ghost" onClick={handleLoadApps} disabled={busy || !activeSerial}>
                  Load Apps
                </button>
              </div>
            ) : (
              <div className="list-compact">
                {apps.slice(0, 5).map((app) => (
                  <div key={app.package_name} className="list-row">
                    <div>
                      <strong>{app.package_name}</strong>
                      <p className="muted">{app.package_name}</p>
                    </div>
                    <button
                      className="ghost"
                      onClick={() => {
                        setSelectedApp(app);
                        navigate("/apps");
                      }}
                    >
                      Open
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  };

  const actionTitleMap: Record<QuickActionId, string> = {
    screenshot: "Screenshot",
    reboot: "Reboot",
    record: screenRecordRemote ? "Stop Recording" : "Start Recording",
    "logcat-clear": "Clear Logcat",
    mirror: "Live Mirror",
  };

  const actionNeedsConfig =
    actionForm.actionId === "screenshot" ||
    actionForm.actionId === "record" ||
    actionForm.actionId === "mirror";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-title">Lazy Blacktea</span>
          <span className="brand-subtitle">Device Automation</span>
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
            <NavLink to="/ui-inspector">UI Inspector</NavLink>
            <NavLink to="/bugreport">Bugreport</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">Manage</span>
            <NavLink to="/apps">App Manager</NavLink>
            <NavLink to="/files">File Explorer</NavLink>
            <NavLink to="/apk-installer">APK Installer</NavLink>
            <NavLink to="/actions">Custom Actions</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">System</span>
            <NavLink to="/tasks">Task Center</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </div>
        </nav>
        <div className="sidebar-footer">
          <button className="ghost" onClick={openPairingModal} disabled={busy}>
            Connect Device
          </button>
          <button className="ghost" onClick={() => navigate("/settings")}>
            Settings
          </button>
          <div className="sidebar-status">
            <span className={`status-dot ${hasDevices ? "ok" : "warn"}`} />
            <span>
              {runningTaskCount > 0
                ? `${runningTaskCount} tasks running`
                : hasDevices
                  ? `${devices.length} devices`
                  : "No devices"}
            </span>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="top-bar">
          <div className="device-context">
            <div className="device-selector">
              <p className="eyebrow">Active Device</p>
              <div className="device-selector-row">
                <select
                  value={activeSerial ?? ""}
                  onChange={(event) => handleSelectActiveSerial(event.target.value)}
                >
                  <option value="">Select a device</option>
                  {devices.map((device) => (
                    <option key={device.summary.serial} value={device.summary.serial}>
                      {device.detail?.model ?? device.summary.model ?? device.summary.serial}
                    </option>
                  ))}
                </select>
                <button className="ghost" onClick={() => navigate("/devices")} disabled={busy}>
                  Manage
                </button>
              </div>
            </div>
            <div className="device-status-row">
              <span className={`status-pill ${deviceStatusTone}`}>{deviceStatusLabel}</span>
              <span className="muted">
                {activeSerial ? `Selected: ${activeSerial}` : "Select a device to enable actions"}
              </span>
            </div>
          </div>
          <div className="top-actions">
            <button className="ghost" onClick={() => openActionForm("screenshot")} disabled={busy || !activeSerial}>
              Screenshot
            </button>
            <button className="ghost" onClick={() => openActionForm("reboot")} disabled={busy || !selectedSerials.length}>
              Reboot
            </button>
            <button className="ghost" onClick={openPairingModal} disabled={busy}>
              Wireless Pairing
            </button>
            <button className="ghost" onClick={refreshDevices} disabled={busy}>
              Refresh
            </button>
            <button className="ghost" onClick={() => openActionForm("mirror")} disabled={busy}>
              Live Mirror
            </button>
            <span className={`status-pill ${busy ? "busy" : ""}`}>{busy ? "Working..." : "Idle"}</span>
          </div>
        </header>

        <main className="page">
          <Routes>
            <Route path="/" element={<DashboardView />} />
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
                              : task.status === "cancelled"
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
                            </div>
                            <div className="task-devices">
                              {summary.serials.map((serial) => {
                                const entry = task.devices[serial];
                                const entryTone =
                                  entry.status === "running"
                                    ? "busy"
                                    : entry.status === "success"
                                      ? "ok"
                                      : entry.status === "cancelled"
                                        ? "warn"
                                        : "error";
                                return (
                                  <div key={serial} className="task-device-row">
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
                                        <button className="ghost" onClick={() => openPath(entry.output_path!)}>
                                          Open output
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
                </div>
              }
            />
            <Route
              path="/devices"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Device Manager</h1>
                      <p className="muted">Organize devices, groups, and connection status.</p>
                    </div>
                    <div className="page-actions">
                      <button className="ghost" onClick={refreshDevices} disabled={busy}>
                        Refresh Devices
                      </button>
                    </div>
                  </div>
                  <section className="panel logcat-panel">
                    <div className="panel-header">
                      <div>
                        <h2>Devices</h2>
                        <span>{devices.length} connected</span>
                      </div>
                    </div>
                    <div className="device-filter-bar">
                      <div className="device-filter-main">
                        <input
                          value={searchText}
                          onChange={(event) => setSearchText(event.target.value)}
                          placeholder="Search by serial or model"
                        />
                        <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                          <option value="all">All groups</option>
                          {groupOptions.map((group) => (
                            <option key={group} value={group}>
                              {group}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="device-filter-actions">
                        <button onClick={selectAllVisible} disabled={busy}>
                          Select Visible
                        </button>
                        <button onClick={clearSelection} disabled={busy}>
                          Clear Selection
                        </button>
                        <span className="muted">{selectedCount} selected</span>
                      </div>
                    </div>
                    <div className="device-list">
                      <div className="device-list-header">
                        <span />
                        <span>Device</span>
                        <span>Serial</span>
                        <span>Platform</span>
                        <span>Radios</span>
                        <span>Battery</span>
                        <span>Status</span>
                      </div>
                      {visibleDevices.map((device, index) => {
                        const serial = device.summary.serial;
                        const detail = device.detail;
                        const wifi = detail?.wifi_is_on;
                        const bt = detail?.bt_is_on;
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
                            className={`device-row${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                            onClick={(event) => handleDeviceRowSelect(event, serial, index)}
                          >
                            <label className="device-check">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeviceRowSelect(event, serial, index);
                                }}
                                onChange={() => {}}
                              />
                            </label>
                            <div className="device-cell device-info">
                              <div className="device-info-main">
                                <strong>{detail?.model ?? device.summary.model ?? serial}</strong>
                                {isActive && <span className="device-active-badge">Active</span>}
                              </div>
                              <div className="device-tags">
                                {groupMap[serial] && <span className="group-tag">{groupMap[serial]}</span>}
                              </div>
                            </div>
                            <div className="device-cell device-serial">{serial}</div>
                            <div className="device-cell device-platform">
                              <span>{detail?.android_version ? `Android ${detail.android_version}` : "Android --"}</span>
                              <span className="muted">{detail?.api_level ? `API ${detail.api_level}` : "API --"}</span>
                            </div>
                            <div className="device-cell device-radios">
                              <span
                                className={`status-icon ${
                                  wifi == null ? "unknown" : wifi ? "ok" : "off"
                                }`}
                                title={wifi == null ? "WiFi Unknown" : wifi ? "WiFi On" : "WiFi Off"}
                              >
                                WiFi
                              </span>
                              <span
                                className={`status-icon ${bt == null ? "unknown" : bt ? "ok" : "off"}`}
                                title={bt == null ? "Bluetooth Unknown" : bt ? "Bluetooth On" : "Bluetooth Off"}
                              >
                                BT
                              </span>
                            </div>
                            <div className="device-cell device-battery">
                              {detail?.battery_level != null ? `${detail.battery_level}%` : "--"}
                            </div>
                            <div className="device-cell device-state">
                              <span className={`status-pill ${stateTone}`}>{device.summary.state}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="device-command-bar">
                      <div className="device-command-group">
                        <label>Group</label>
                        <div className="inline-row">
                          <input
                            value={groupName}
                            onChange={(event) => setGroupName(event.target.value)}
                            placeholder="Group name"
                          />
                          <button onClick={handleAssignGroup} disabled={busy || selectedCount === 0}>
                            Assign
                          </button>
                        </div>
                        <span className="muted">{selectedCount} selected</span>
                      </div>
                      <div className="button-row compact">
                        <button onClick={() => handleReboot()} disabled={busy || selectedCount === 0}>
                          Reboot
                        </button>
                        <button onClick={() => handleReboot("recovery")} disabled={busy || selectedCount === 0}>
                          Reboot Recovery
                        </button>
                        <button onClick={() => handleReboot("bootloader")} disabled={busy || selectedCount === 0}>
                          Reboot Bootloader
                        </button>
                        <button onClick={() => handleToggleWifi(true)} disabled={busy || selectedCount === 0}>
                          WiFi On
                        </button>
                        <button onClick={() => handleToggleWifi(false)} disabled={busy || selectedCount === 0}>
                          WiFi Off
                        </button>
                        <button onClick={() => handleToggleBluetooth(true)} disabled={busy || selectedCount === 0}>
                          Bluetooth On
                        </button>
                        <button onClick={() => handleToggleBluetooth(false)} disabled={busy || selectedCount === 0}>
                          Bluetooth Off
                        </button>
                        <button onClick={handleCopyDeviceInfo} disabled={busy || selectedCount === 0}>
                          Copy Device Info
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              }
            />
            <Route
              path="/actions"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Custom Actions</h1>
                      <p className="muted">Run batch shell commands across devices.</p>
                    </div>
                  </div>
                  <div className="stack">
                    <section className="panel">
                      <div className="panel-header">
                        <h2>Shell Commands</h2>
                        <span>{activeSerial ?? "No device selected"}</span>
                      </div>
                      {screenRecordRemote && (
                        <p className="muted">Recording in progress: {screenRecordRemote}</p>
                      )}
                      <div className="form-row">
                        <label>Shell Command</label>
                        <input
                          value={shellCommand}
                          onChange={(event) => setShellCommand(event.target.value)}
                          placeholder="e.g. pm list packages"
                        />
                        <button onClick={handleRunShell} disabled={busy}>
                          Run
                        </button>
                      </div>
                      <div className="output-block">
                        <h3>Latest Output</h3>
                        {shellOutput.length === 0 ? (
                          <p className="muted">No output yet.</p>
                        ) : (
                          <pre>{shellOutput.join("\n\n")}</pre>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              }
            />
            <Route
              path="/apk-installer"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>APK Installer</h1>
                      <p className="muted">Install single APKs, bundles, or multi-file batches.</p>
                    </div>
                  </div>
                  <div className="stack">
                    <section className="panel">
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
                        <button onClick={handleInstallApk} disabled={busy || !selectedSerials.length}>
                          Install
                        </button>
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
                        <span>{apkInstallSummary.length ? "Completed" : "Idle"}</span>
                      </div>
                      <div className="output-block">
                        {apkInstallSummary.length === 0 ? (
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
	                <div className="page-section">
	                  {filesDropActive && (
	                    <div className="file-drop-overlay">
	                      <div className="file-drop-overlay-inner">
	                        <strong>Drop files to upload</strong>
	                        <span className="muted">Target: {filesPath}</span>
	                      </div>
	                    </div>
	                  )}
	                  <div className="page-header">
	                    <div>
	                      <h1>File Explorer</h1>
	                      <p className="muted">Browse device storage, pull files, and upload files.</p>
	                    </div>
	                  </div>
	                  <section className="panel">
	                    <div className="panel-header">
	                      <h2>Device Files</h2>
	                      <span>{activeSerial ?? "No device selected"}</span>
	                    </div>
	                    <div className="form-row">
	                      <label>Path</label>
	                      <input value={filesPath} onChange={(event) => setFilesPath(event.target.value)} />
	                      <button className="ghost" onClick={handleFilesGoUp} disabled={busy}>
	                        Up
	                      </button>
	                      <button onClick={() => void handleFilesRefresh()} disabled={busy}>
	                        Load
	                      </button>
	                      <button className="ghost" onClick={openFilesMkdirModal} disabled={busy}>
	                        New folder
	                      </button>
	                      <button onClick={handleFileUpload} disabled={busy}>
	                        Upload
	                      </button>
	                      <label className="toggle">
	                        <input
	                          type="checkbox"
	                          checked={filesOverwriteEnabled}
	                          onChange={(event) => setFilesOverwriteEnabled(event.target.checked)}
	                        />
	                        Overwrite
	                      </label>
	                    </div>
	                    <div className="file-toolbar">
	                      <span className="muted">
	                        {filesSelectedPaths.length ? `${filesSelectedPaths.length} selected` : "No selection"}
	                      </span>
	                      <div className="file-toolbar-actions">
	                        <button
	                          className="ghost"
	                          onClick={() => setFilesSelectedPaths([])}
	                          disabled={busy || filesSelectedPaths.length === 0}
	                        >
	                          Clear
	                        </button>
	                        <button onClick={handleFilesPullSelected} disabled={busy || filesSelectedPaths.length === 0}>
	                          Pull selected
	                        </button>
	                        <button
	                          className="danger"
	                          onClick={openFilesDeleteSelectedModal}
	                          disabled={busy || filesSelectedPaths.length === 0}
	                        >
	                          Delete selected
	                        </button>
	                      </div>
	                    </div>
	                    <div className="split">
	                      <div className="file-list">
	                        {files.length === 0 ? (
	                          <p className="muted">No files loaded.</p>
	                        ) : (
	                          files.map((entry) => (
	                            <div key={entry.path} className="file-row">
	                              <input
	                                type="checkbox"
	                                checked={isFileSelected(entry.path)}
	                                onChange={(event) => toggleFileSelected(entry.path, event.target.checked)}
	                                disabled={busy}
	                                aria-label={`Select ${entry.name}`}
	                              />
	                              <div className="file-row-main">
	                                <strong>{entry.name}</strong>
	                                <p className="muted">
	                                  {entry.is_dir ? "Directory" : "File"} · {entry.size_bytes ?? "--"} bytes
	                                </p>
	                              </div>
	                              <div className="file-row-actions">
	                                {entry.is_dir ? (
	                                  <button
	                                    className="ghost"
	                                    onClick={() => void handleFilesRefresh(entry.path)}
	                                    disabled={busy}
	                                  >
	                                    Open
	                                  </button>
	                                ) : (
	                                  <button onClick={() => handleFilePull(entry)} disabled={busy}>
	                                    Pull
	                                  </button>
	                                )}
	                                <button className="ghost" onClick={() => openFilesRenameModal(entry)} disabled={busy}>
	                                  Rename
	                                </button>
	                                <button className="danger" onClick={() => openFilesDeleteModal(entry)} disabled={busy}>
	                                  Delete
	                                </button>
	                              </div>
	                            </div>
	                          ))
	                        )}
	                      </div>
	                      <div className="preview-panel">
                        <h3>Preview</h3>
                        {filePreview?.is_text && filePreview.preview_text ? (
                          <pre>{filePreview.preview_text}</pre>
                        ) : (
                          <p className="muted">
                            {filePreview
                              ? `Preview not available (${filePreview.mime_type}).`
                              : "Pull a file to preview."}
                          </p>
                        )}
                        {filePreview && (
                          <button onClick={() => openPath(filePreview.local_path)} disabled={busy}>
                            Open Externally
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              }
            />
            <Route
              path="/logcat"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Logcat</h1>
                      <p className="muted">Filters, presets, and search for streaming logs.</p>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="panel-header">
                      <div>
                        <h2>Logcat Stream</h2>
                        <span>{activeSerial ?? "No device selected"}</span>
                      </div>
                    </div>
                    <div className="logcat-toolbar">
                      <div className="logcat-toolbar-row">
                        <div className="logcat-toolbar-cluster">
                          <div className="logcat-button-group">
                            <button onClick={handleLogcatStart} disabled={busy}>
                              Start
                            </button>
                            <button onClick={handleLogcatStop} disabled={busy}>
                              Stop
                            </button>
                          </div>
                          <div className="logcat-button-group">
                            <button onClick={handleLogcatClearBuffer} disabled={busy}>
                              Clear Buffer
                            </button>
                            <button className="ghost" onClick={handleLogcatClearView} disabled={busy}>
                              Clear View
                            </button>
                            <button className="ghost" onClick={handleLogcatExport} disabled={busy}>
                              Export
                            </button>
                          </div>
                          <button className="ghost" onClick={toggleLogcatAdvanced}>
                            {logcatAdvancedOpen ? "Hide Advanced" : "Advanced"}
                          </button>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={logcatAutoScroll}
                              onChange={(event) => setLogcatAutoScroll(event.target.checked)}
                            />
                            Follow newest
                          </label>
                        </div>
                      </div>
                      <div className="logcat-toolbar-row">
                        <div className="logcat-toolbar-group logcat-source-group">
                          <div className="logcat-label-row">
                            <span>Source</span>
                            <span className="muted">
                              Active: {logcatActiveFilterSummary || "All"}
                            </span>
                          </div>
                          <div className="inline-row">
                            <select
                              value={logcatSourceMode}
                              onChange={(event) =>
                                setLogcatSourceMode(event.target.value as LogcatSourceMode)
                              }
                            >
                              <option value="tag">Tag</option>
                              <option value="package">Package</option>
                              <option value="raw">Raw</option>
                            </select>
                            <input
                              value={logcatSourceValue}
                              onChange={(event) => setLogcatSourceValue(event.target.value)}
                              placeholder={
                                logcatSourceMode === "raw"
                                  ? "ActivityManager:D *:S"
                                  : logcatSourceMode === "package"
                                    ? "com.example.app"
                                    : "ActivityManager"
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    {logcatAdvancedOpen && (
                      <div className="logcat-advanced">
                        <div className="panel-sub">
                          <h3>Levels</h3>
                          <div className="toggle-group">
                            {(["V", "D", "I", "W", "E", "F"] as const).map((level) => (
                              <label key={level} className="toggle">
                                <input
                                  type="checkbox"
                                  checked={logcatLevels[level]}
                                  onChange={(event) =>
                                    setLogcatLevels((prev) => ({
                                      ...prev,
                                      [level]: event.target.checked,
                                    }))
                                  }
                                />
                                {level}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="panel-sub">
                          <h3>Search Options</h3>
                          <div className="toggle-group">
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={logcatSearchRegex}
                                onChange={(event) => setLogcatSearchRegex(event.target.checked)}
                              />
                              Regex
                            </label>
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={logcatSearchCaseSensitive}
                                onChange={(event) => setLogcatSearchCaseSensitive(event.target.checked)}
                              />
                              Case sensitive
                            </label>
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={logcatSearchOnly}
                                onChange={(event) => setLogcatSearchOnly(event.target.checked)}
                              />
                              Matches only
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="logcat-filter-grid">
                      <div className="panel-sub logcat-filter-combined">
                        <div className="logcat-filter-split">
                          <div className="logcat-filter-section">
                            <h3 title="Use regex to refine the stream.">Live Filter</h3>
                            <div className="form-row">
                              <label>Pattern</label>
                              <input
                                value={logcatLiveFilter}
                                onChange={(event) => setLogcatLiveFilter(event.target.value)}
                                placeholder="e.g. ActivityManager|AndroidRuntime"
                              />
                              <button type="button" onClick={addActiveLogcatFilter} disabled={busy}>
                                Add
                              </button>
                            </div>
                          </div>
                          <div className="logcat-filter-section">
                            <div className="logcat-filter-header">
                              <h3 title="Applied in real time.">Active Filters</h3>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => setLogcatFiltersExpanded((prev) => !prev)}
                              >
                                {logcatFiltersExpanded ? "Hide" : "Expand"}
                              </button>
                            </div>
                            <p className="muted">
                              {logcatActiveFilters.length ? `${logcatActiveFilters.length} filters` : "No filters"}
                            </p>
                            {logcatFiltersExpanded && (
                              <>
                                {logcatActiveFilters.length === 0 ? (
                                  <p className="muted">No active filters</p>
                                ) : (
                                  <div className="filter-chip-list">
                                    {logcatActiveFilters.map((pattern) => (
                                      <button
                                        key={pattern}
                                        type="button"
                                        className="filter-chip"
                                        onClick={() => removeActiveLogcatFilter(pattern)}
                                      >
                                        {pattern}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <div className="button-row compact">
                                  <button type="button" className="ghost" onClick={clearActiveLogcatFilters}>
                                    Clear
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="panel-sub logcat-presets">
                        <h3>Presets</h3>
                        <div className="logcat-preset-row single">
                          <label>Preset</label>
                          <select
                            value={logcatPresetSelected}
                            onChange={(event) => setLogcatPresetSelected(event.target.value)}
                          >
                            <option value="">Select preset</option>
                            {logcatPresets.map((preset) => (
                              <option key={preset.name} value={preset.name}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              if (logcatPresetSelected) {
                                applyLogcatPreset(logcatPresetSelected);
                              }
                            }}
                            disabled={busy || !selectedLogcatPreset}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              if (logcatPresetSelected) {
                                deleteLogcatPreset(logcatPresetSelected);
                              }
                            }}
                            disabled={busy || !selectedLogcatPreset}
                          >
                            Delete
                          </button>
                          <label>New</label>
                          <input
                            value={logcatPresetName}
                            onChange={(event) => setLogcatPresetName(event.target.value)}
                            placeholder="e.g. Crash Only"
                          />
                          <button type="button" onClick={saveLogcatPreset} disabled={busy}>
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                    {logcatLastExport && (
                      <div className="inline-alert info">
                        <strong>Exported</strong>
                        <span>{logcatLastExport}</span>
                      </div>
                    )}
                    <div className="logcat-output-wrapper">
                      {logcatSearchOpen ? (
                        <div className="logcat-search-overlay">
                          <div className="logcat-search-header">
                            <span>Search</span>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => setLogcatSearchOpen(false)}
                            >
                              Close
                            </button>
                          </div>
                          <div className="inline-row">
                            <input
                              value={logcatSearchTerm}
                              onChange={(event) => setLogcatSearchTerm(event.target.value)}
                              placeholder="Find in logs..."
                            />
                            <div className="button-row compact">
                              <button type="button" onClick={handleLogcatPrevMatch} disabled={busy}>
                                Prev
                              </button>
                              <button type="button" onClick={handleLogcatNextMatch} disabled={busy}>
                                Next
                              </button>
                            </div>
                          </div>
                          <span className="muted">
                            Match {logcatFiltered.matchIds.length ? logcatMatchIndex + 1 : 0} /{" "}
                            {logcatFiltered.matchIds.length}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="logcat-search-toggle"
                          onClick={() => setLogcatSearchOpen(true)}
                          aria-label="Open search"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0-2a9 9 0 1 0 5.65 16.02l4.66 4.66a1 1 0 0 0 1.41-1.41l-4.66-4.66A9 9 0 0 0 11 2z"
                              fill="currentColor"
                            />
                          </svg>
                        </button>
	                      )}
	                      <div className="logcat-output" ref={logcatOutputRef}>
	                        {logcatFiltered.lines.map((entry) => (
	                          <MemoLogcatLineRow
	                            key={entry.id}
	                            entry={entry}
	                            searchPattern={logcatSearchPattern}
	                          />
	                        ))}
	                      </div>
	                    </div>
	                  </section>
	                </div>
              }
            />
            <Route
              path="/ui-inspector"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>UI Inspector</h1>
                      <p className="muted">Capture hierarchy, inspect XML, and export assets.</p>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="panel-header">
                      <div>
                        <h2>Inspector Workspace</h2>
                        <span>{activeSerial ?? "No device selected"}</span>
                      </div>
                      <div className="button-row compact">
                        <button onClick={handleUiInspect} disabled={busy}>
                          Refresh
                        </button>
                        <button className="ghost" onClick={handleUiExport} disabled={busy}>
                          Export
                        </button>
                        <button
                          className="ghost"
                          onClick={handleScrcpyLaunch}
                          disabled={busy || !scrcpyInfo?.available}
                        >
                          Live Mirror
                        </button>
                      </div>
                    </div>
                    {!scrcpyInfo?.available && (
                      <p className="muted">Live mirror requires scrcpy. Install it and try again.</p>
                    )}
                    {uiExportResult && (
                      <div className="inline-alert info">
                        <strong>Exported</strong>
                        <span>{uiExportResult}</span>
                      </div>
                    )}
                    <div className="split inspector-split">
                      <div className="panel-sub">
                        <div className="panel-header">
                          <h3>Screenshot</h3>
                          <span className="muted">
                            {uiScreenshotSrc ? "Captured" : "No screenshot"}
                          </span>
                        </div>
                        <div className="form-row">
                          <label>Zoom</label>
                          <input
                            type="range"
                            min={0.5}
                            max={2}
                            step={0.1}
                            value={uiZoom}
                            onChange={(event) => setUiZoom(Number(event.target.value))}
                          />
                          <span className="muted">{Math.round(uiZoom * 100)}%</span>
                        </div>
                        <div className="preview-panel inspector-preview">
                          {uiScreenshotSrc ? (
                            <div
                              className="inspector-screenshot-stage"
                              style={{ transform: `scale(${uiZoom})`, transformOrigin: "top left" }}
                            >
                              <img
                                ref={uiScreenshotImgRef}
                                src={uiScreenshotSrc}
                                alt="UI Screenshot"
                                onLoad={() => {
                                  const img = uiScreenshotImgRef.current;
                                  if (!img) {
                                    return;
                                  }
                                  setUiScreenshotSize({
                                    width: img.naturalWidth,
                                    height: img.naturalHeight,
                                  });
                                }}
                              />
                              <canvas
                                ref={uiBoundsCanvasRef}
                                aria-label="UI hierarchy bounds overlay"
                                onMouseMove={(event) => {
                                  if (!uiBoundsEnabled) {
                                    setUiHoveredNodeIndex(-1);
                                    return;
                                  }
                                  const canvas = uiBoundsCanvasRef.current;
                                  if (!canvas) {
                                    return;
                                  }
                                  uiLastPointerRef.current = { x: event.clientX, y: event.clientY };
                                  if (uiHoverRafRef.current !== null) {
                                    return;
                                  }
                                  uiHoverRafRef.current = window.requestAnimationFrame(() => {
                                    uiHoverRafRef.current = null;
                                    const latest = uiLastPointerRef.current;
                                    const activeCanvas = uiBoundsCanvasRef.current;
                                    if (!latest || !activeCanvas) {
                                      return;
                                    }
                                    const rect = activeCanvas.getBoundingClientRect();
                                    if (rect.width <= 0 || rect.height <= 0) {
                                      return;
                                    }
                                    const x =
                                      (latest.x - rect.left) * (activeCanvas.width / rect.width);
                                    const y =
                                      (latest.y - rect.top) * (activeCanvas.height / rect.height);
                                    const idx = pickUiNodeAtPoint(uiNodesParse.nodes, x, y);
                                    setUiHoveredNodeIndex(idx);
                                  });
                                }}
                                onMouseLeave={() => {
                                  uiLastPointerRef.current = null;
                                  if (uiHoverRafRef.current !== null) {
                                    window.cancelAnimationFrame(uiHoverRafRef.current);
                                    uiHoverRafRef.current = null;
                                  }
                                  setUiHoveredNodeIndex(-1);
                                }}
                                onClick={() => {
                                  if (uiHoveredNodeIndex >= 0) {
                                    setUiSelectedNodeIndex(uiHoveredNodeIndex);
                                  } else {
                                    setUiSelectedNodeIndex(-1);
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <p className="muted">
                              {uiScreenshotError
                                ? `Screenshot unavailable: ${uiScreenshotError}`
                                : "Capture UI hierarchy to include a screenshot."}
                            </p>
                          )}
                        </div>
                        <div className="form-row">
                          <label>Bounds</label>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={uiBoundsEnabled}
                              onChange={(event) => setUiBoundsEnabled(event.target.checked)}
                              disabled={!uiScreenshotSrc}
                            />
                            Show hierarchy bounds
                          </label>
                          <span className="muted">
                            {uiScreenshotSrc
                              ? `${uiNodesParse.nodes.length}${uiNodesParse.truncated ? "+" : ""} nodes`
                              : "--"}
                          </span>
                        </div>
                        {(uiSelectedNode || uiHoveredNode) && (
                          <div className="ui-node-meta">
                            {uiSelectedNode && (
                              <>
                                <div className="ui-node-meta-row">
                                  <span className="ui-node-meta-label">Selected</span>
                                  <span className="ui-node-meta-value">
                                    {[
                                      uiSelectedNode.resourceId,
                                      uiSelectedNode.text ? `"${uiSelectedNode.text}"` : null,
                                      uiSelectedNode.className,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ") || "Node"}
                                  </span>
                                </div>
                                <div className="ui-node-meta-row">
                                  <span className="ui-node-meta-label">Bounds</span>
                                  <span className="ui-node-meta-value">{uiSelectedNode.bounds}</span>
                                </div>
                              </>
                            )}
                            {uiHoveredNode && (
                              <>
                                <div className="ui-node-meta-row">
                                  <span className="ui-node-meta-label">Hover</span>
                                  <span className="ui-node-meta-value">
                                    {[
                                      uiHoveredNode.resourceId,
                                      uiHoveredNode.text ? `"${uiHoveredNode.text}"` : null,
                                      uiHoveredNode.className,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ") || "Node"}
                                  </span>
                                </div>
                                <div className="ui-node-meta-row">
                                  <span className="ui-node-meta-label">Bounds</span>
                                  <span className="ui-node-meta-value">{uiHoveredNode.bounds}</span>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="panel-sub">
                        <div className="panel-header">
                          <h3>Hierarchy</h3>
                          <div className="toggle-group">
                            <button
                              type="button"
                              className={`toggle ${uiInspectorTab === "hierarchy" ? "active" : ""}`}
                              onClick={() => setUiInspectorTab("hierarchy")}
                            >
                              Tree
                            </button>
                            <button
                              type="button"
                              className={`toggle ${uiInspectorTab === "xml" ? "active" : ""}`}
                              onClick={() => setUiInspectorTab("xml")}
                            >
                              XML
                            </button>
                          </div>
                        </div>
                        <div className="form-row">
                          <label>Search</label>
                          <input
                            value={uiInspectorSearch}
                            onChange={(event) => setUiInspectorSearch(event.target.value)}
                            placeholder="Filter XML lines"
                          />
                        </div>
                        {uiInspectorTab === "hierarchy" ? (
                          uiHtml ? (
                            <iframe title="UI Inspector" srcDoc={uiHtml} className="ui-frame" />
                          ) : (
                            <p className="muted">Capture UI hierarchy to preview the structure.</p>
                          )
                        ) : (
                          <div className="output-block inspector-xml">
                            {filteredUiXml ? (
                              <pre>{filteredUiXml}</pre>
                            ) : (
                              <p className="muted">No XML captured.</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              }
            />
            <Route
              path="/apps"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>App Manager</h1>
                      <p className="muted">Search packages and execute common actions.</p>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="panel-header">
                      <h2>App Management</h2>
                      <span>{activeSerial ?? "No device selected"}</span>
                    </div>
                    <div className="toolbar">
                      <input
                        value={appsFilter}
                        onChange={(event) => setAppsFilter(event.target.value)}
                        placeholder="Search package"
                      />
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={appsThirdPartyOnly}
                          onChange={(event) => setAppsThirdPartyOnly(event.target.checked)}
                        />
                        Third-party only
                      </label>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={appsIncludeVersions}
                          onChange={(event) => setAppsIncludeVersions(event.target.checked)}
                        />
                        Include versions
                      </label>
                      <button onClick={handleLoadApps} disabled={busy}>
                        Load Apps
                      </button>
                    </div>
                    <div className="split">
                      <div className="file-list">
                        {filteredApps.map((app) => (
                          <button
                            key={app.package_name}
                            className={`app-row ${selectedApp?.package_name === app.package_name ? "active" : ""}`}
                            onClick={() => setSelectedApp(app)}
                          >
                            <strong>{app.package_name}</strong>
                            <span>{app.version_name ?? ""}</span>
                            {app.is_system && <span className="badge">System</span>}
                          </button>
                        ))}
                      </div>
                      <div className="preview-panel">
                        <h3>Selected App</h3>
                        {selectedApp ? (
                          <div className="stack">
                            <p>{selectedApp.package_name}</p>
                            <p className="muted">Version: {selectedApp.version_name ?? "--"}</p>
                            <div className="button-row">
                              <button onClick={() => handleAppAction("forceStop")} disabled={busy}>
                                Force Stop
                              </button>
                              <button onClick={() => handleAppAction("clear")} disabled={busy}>
                                Clear Data
                              </button>
                              <button onClick={() => handleAppAction("info")} disabled={busy}>
                                Open Info
                              </button>
                              <button onClick={() => handleAppAction("enable")} disabled={busy}>
                                Enable
                              </button>
                              <button onClick={() => handleAppAction("disable")} disabled={busy}>
                                Disable
                              </button>
                              <button onClick={() => handleAppAction("uninstall")} disabled={busy}>
                                Uninstall
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="muted">Select an app to manage.</p>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              }
            />
            <Route
              path="/bugreport"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Bugreport</h1>
                      <p className="muted">Generate bugreports with progress tracking.</p>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="panel-header">
                      <h2>Bugreport</h2>
                      <span>{activeSerial ?? "No device selected"}</span>
                    </div>
                    <div className="button-row">
                      <button onClick={handleBugreport} disabled={busy}>
                        Generate Bugreport
                      </button>
                      <button onClick={handleCancelBugreport} disabled={busy}>
                        Cancel
                      </button>
                    </div>
                    <div className="progress">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${bugreportProgress ?? 0}%` }} />
                      </div>
                      <span>{bugreportProgress != null ? `${bugreportProgress}%` : "Idle"}</span>
                    </div>
                    {bugreportResult && (
                      <div className="output-block">
                        <h3>Last Result</h3>
                        <p>Status: {bugreportResult.success ? "Success" : "Failed"}</p>
                        <p>Output: {bugreportResult.output_path ?? "--"}</p>
                        <p>Error: {bugreportResult.error ?? "--"}</p>
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
                      <p className="muted">Track Bluetooth state changes.</p>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="panel-header">
                      <h2>Bluetooth Monitor</h2>
                      <span>{activeSerial ?? "No device selected"}</span>
                    </div>
                    <div className="button-row">
                      <button onClick={() => handleBluetoothMonitor(true)} disabled={busy}>
                        Start Monitor
                      </button>
                      <button onClick={() => handleBluetoothMonitor(false)} disabled={busy}>
                        Stop Monitor
                      </button>
                    </div>
                    <div className="output-block">
                      <h3>Current State</h3>
                      <p>{bluetoothState || "No state yet."}</p>
                    </div>
                    <div className="logcat-output">
                      {bluetoothEvents.map((line, index) => (
                        <div key={`${line}-${index}`}>{line}</div>
                      ))}
                    </div>
                  </section>
                </div>
              }
            />
            <Route
              path="/settings"
              element={
                config ? (
                  <div className="page-section">
                    <div className="page-header">
                      <div>
                        <h1>Settings</h1>
                        <p className="muted">Persisted locally. Update defaults for actions.</p>
                      </div>
                    </div>
                    <section className="panel">
                      <div className="panel-header">
                        <h2>Settings</h2>
                        <span>Saved locally</span>
                      </div>
                      <div className="settings-grid">
                        <div>
                          <h3>ADB</h3>
                          <label>
                            ADB executable path
                            <input
                              placeholder="/path/to/platform-tools/adb or C:\\Android\\platform-tools\\adb.exe"
                              value={config.adb.command_path}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev ? { ...prev, adb: { ...prev.adb, command_path: event.target.value } } : prev,
                                )
                              }
                            />
                          </label>
                          <div className="button-row">
                            <button type="button" className="ghost" onClick={handleBrowseAdbPath} disabled={busy}>
                              Browse
                            </button>
                            <button type="button" className="ghost" onClick={handleCheckAdb} disabled={busy}>
                              Test
                            </button>
                          </div>
                          {adbInfo && (
                            <div className={`inline-alert ${adbInfo.available ? "info" : "error"}`}>
                              <strong>{adbInfo.available ? "ADB available" : "ADB not available"}</strong>
                              <span>
                                Command: <code>{adbInfo.command_path}</code>
                              </span>
                              {adbInfo.version_output && (
                                <span className="muted">
                                  <code>{adbInfo.version_output}</code>
                                </span>
                              )}
                              {adbInfo.error && <span className="muted">Error: {adbInfo.error}</span>}
                              <span className="muted">Save Settings to apply this path globally.</span>
                            </div>
                          )}
                        </div>
                        <div>
                          <h3>Output Paths</h3>
                          <label>
                            Default Output
                            <input
                              value={config.output_path}
                              onChange={(event) =>
                                setConfig((prev) => (prev ? { ...prev, output_path: event.target.value } : prev))
                              }
                            />
                          </label>
                          <label>
                            File Export
                            <input
                              value={config.file_gen_output_path}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev ? { ...prev, file_gen_output_path: event.target.value } : prev,
                                )
                              }
                            />
                          </label>
                        </div>
                        <div>
                          <h3>Commands</h3>
                          <label>
                            Timeout (sec)
                            <input
                              type="number"
                              value={config.command.command_timeout}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        command: { ...prev.command, command_timeout: Number(event.target.value) },
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={config.command.parallel_execution}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        command: { ...prev.command, parallel_execution: event.target.checked },
                                      }
                                    : prev,
                                )
                              }
                            />
                            Parallel execution
                          </label>
                        </div>
                        <div>
                          <h3>Screenrecord</h3>
                          <label>
                            Bit rate
                            <input
                              value={config.screen_record.bit_rate}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        screen_record: { ...prev.screen_record, bit_rate: event.target.value },
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <label>
                            Size
                            <input
                              value={config.screen_record.size}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? { ...prev, screen_record: { ...prev.screen_record, size: event.target.value } }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={config.screen_record.use_hevc}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        screen_record: { ...prev.screen_record, use_hevc: event.target.checked },
                                      }
                                    : prev,
                                )
                              }
                            />
                            Use HEVC
                          </label>
                        </div>
                        <div>
                          <h3>scrcpy</h3>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={config.scrcpy.stay_awake}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? { ...prev, scrcpy: { ...prev.scrcpy, stay_awake: event.target.checked } }
                                    : prev,
                                )
                              }
                            />
                            Stay awake
                          </label>
                          <label>
                            Bit rate
                            <input
                              value={config.scrcpy.bitrate}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev ? { ...prev, scrcpy: { ...prev.scrcpy, bitrate: event.target.value } } : prev,
                                )
                              }
                            />
                          </label>
                          <label>
                            Extra args
                            <input
                              value={config.scrcpy.extra_args}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? { ...prev, scrcpy: { ...prev.scrcpy, extra_args: event.target.value } }
                                    : prev,
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                      <div className="button-row">
                        <button onClick={handleSaveConfig} disabled={busy}>
                          Save Settings
                        </button>
                        <button onClick={handleResetConfig} disabled={busy}>
                          Reset Defaults
                        </button>
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="page-section">
                    <div className="page-header">
                      <div>
                        <h1>Settings</h1>
                        <p className="muted">Loading settings...</p>
                      </div>
                    </div>
                    <section className="panel">
                      <h2>Settings</h2>
                      <p className="muted">Loading settings...</p>
                    </section>
                  </div>
                )
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      {actionForm.isOpen && actionForm.actionId && (
        <div className="modal-backdrop" onClick={closeActionForm}>
          <div className="modal modal-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{actionTitleMap[actionForm.actionId]}</h3>
                <p className="muted">Configure parameters before running.</p>
              </div>
              <button className="ghost" onClick={closeActionForm}>
                Close
              </button>
            </div>
            {actionForm.errors.length > 0 && (
              <div className="inline-alert error">
                {actionForm.errors.map((error) => (
                  <span key={error}>{error}</span>
                ))}
              </div>
            )}

            {actionForm.actionId === "screenshot" && (
              <div className="stack">
                <label>
                  Output folder
                  <div className="inline-row">
                    <input
                      value={actionOutputDir}
                      onChange={(event) => setActionOutputDir(event.target.value)}
                      placeholder={config?.output_path || "Select output folder"}
                    />
                    <button
                      className="ghost"
                      onClick={async () => {
                        const selected = await openDialog({
                          title: "Select output folder",
                          directory: true,
                          multiple: false,
                        });
                        if (selected && !Array.isArray(selected)) {
                          setActionOutputDir(selected);
                        }
                      }}
                      disabled={busy}
                    >
                      Browse
                    </button>
                  </div>
                </label>
                {actionDraftConfig ? (
                  <div className="grid-two">
                    <label>
                      Display ID
                      <input
                        type="number"
                        value={actionDraftConfig.screenshot.display_id}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screenshot: {
                              ...current.screenshot,
                              display_id: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Extra args
                      <input
                        value={actionDraftConfig.screenshot.extra_args}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screenshot: {
                              ...current.screenshot,
                              extra_args: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <p className="muted">Loading screenshot settings...</p>
                )}
              </div>
            )}

            {actionForm.actionId === "reboot" && (
              <div className="stack">
                <label>
                  Reboot mode
                  <select value={actionRebootMode} onChange={(event) => setActionRebootMode(event.target.value)}>
                    <option value="normal">Normal</option>
                    <option value="recovery">Recovery</option>
                    <option value="bootloader">Bootloader</option>
                  </select>
                </label>
                <p className="muted">Reboot will run on all selected devices.</p>
              </div>
            )}

            {actionForm.actionId === "record" && (
              <div className="stack">
                <p className="muted">
                  {screenRecordRemote
                    ? "A recording is running. Configure output and stop it."
                    : "Configure recording parameters before starting."}
                </p>
                {screenRecordRemote && (
                  <label>
                    Output folder
                    <div className="inline-row">
                      <input
                        value={actionOutputDir}
                        onChange={(event) => setActionOutputDir(event.target.value)}
                        placeholder={config?.output_path || "Select output folder"}
                      />
                      <button
                        className="ghost"
                        onClick={async () => {
                          const selected = await openDialog({
                            title: "Select output folder",
                            directory: true,
                            multiple: false,
                          });
                          if (selected && !Array.isArray(selected)) {
                            setActionOutputDir(selected);
                          }
                        }}
                        disabled={busy}
                      >
                        Browse
                      </button>
                    </div>
                  </label>
                )}
                {actionDraftConfig ? (
                  <div className="grid-two">
                    <label>
                      Bit rate
                      <input
                        value={actionDraftConfig.screen_record.bit_rate}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              bit_rate: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Time limit (sec)
                      <input
                        type="number"
                        value={actionDraftConfig.screen_record.time_limit_sec}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              time_limit_sec: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Size
                      <input
                        value={actionDraftConfig.screen_record.size}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              size: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Display ID
                      <input
                        type="number"
                        value={actionDraftConfig.screen_record.display_id}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              display_id: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.screen_record.use_hevc}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              use_hevc: event.target.checked,
                            },
                          }))
                        }
                      />
                      Use HEVC
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.screen_record.bugreport}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              bugreport: event.target.checked,
                            },
                          }))
                        }
                      />
                      Bugreport overlay
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.screen_record.verbose}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              verbose: event.target.checked,
                            },
                          }))
                        }
                      />
                      Verbose output
                    </label>
                  </div>
                ) : (
                  <p className="muted">Loading screen record settings...</p>
                )}
              </div>
            )}

            {actionForm.actionId === "logcat-clear" && (
              <div className="stack">
                <p className="muted">This clears the logcat buffer for the active device.</p>
              </div>
            )}

            {actionForm.actionId === "mirror" && (
              <div className="stack">
                {!scrcpyInfo?.available && (
                  <div className="inline-alert error">
                    scrcpy is not available. Install it to enable live mirror.
                  </div>
                )}
                {actionDraftConfig ? (
                  <div className="grid-two">
                    <label>
                      Bit rate
                      <input
                        value={actionDraftConfig.scrcpy.bitrate}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              bitrate: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Max size
                      <input
                        type="number"
                        value={actionDraftConfig.scrcpy.max_size}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              max_size: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.scrcpy.stay_awake}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              stay_awake: event.target.checked,
                            },
                          }))
                        }
                      />
                      Stay awake
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.scrcpy.turn_screen_off}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              turn_screen_off: event.target.checked,
                            },
                          }))
                        }
                      />
                      Turn screen off
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.scrcpy.disable_screensaver}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              disable_screensaver: event.target.checked,
                            },
                          }))
                        }
                      />
                      Disable screensaver
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.scrcpy.enable_audio_playback}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              enable_audio_playback: event.target.checked,
                            },
                          }))
                        }
                      />
                      Enable audio
                    </label>
                    <label>
                      Extra args
                      <input
                        value={actionDraftConfig.scrcpy.extra_args}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              extra_args: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <p className="muted">Loading scrcpy settings...</p>
                )}
              </div>
            )}

            <div className="button-row">
              <button onClick={handleActionSubmit} disabled={busy || (actionNeedsConfig && !actionDraftConfig)}>
                Run Action
              </button>
              <button className="ghost" onClick={closeActionForm}>
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
                  <span className="muted">
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
                <div className="toggle-group">
                  <button
                    className={pairingState.mode === "qr" ? "toggle active" : "toggle"}
                    onClick={() => dispatchPairing({ type: "SET_MODE", mode: "qr" })}
                  >
                    QR Pairing
                  </button>
                  <button
                    className={pairingState.mode === "code" ? "toggle active" : "toggle"}
                    onClick={() => dispatchPairing({ type: "SET_MODE", mode: "code" })}
                  >
                    Pairing Code
                  </button>
                </div>
                <label>
                  QR Payload (paste to auto-fill)
                  <div className="inline-row">
                    <input
                      value={pairingState.qrPayload}
                      onChange={(event) =>
                        dispatchPairing({ type: "SET_QR_PAYLOAD", value: event.target.value })
                      }
                      placeholder="WIFI:T:ADB;S:192.168.0.10:37145;P:123456;;"
                    />
                    <button
                      className="ghost"
                      onClick={() => {
                        const parsed = parseQrPayload(pairingState.qrPayload);
                        if (!parsed.pairAddress && !parsed.pairingCode) {
                          pushToast("Unable to parse QR payload.", "error");
                          return;
                        }
                        if (parsed.pairAddress) {
                          dispatchPairing({ type: "SET_PAIR_ADDRESS", value: parsed.pairAddress });
                        }
                        if (parsed.pairingCode) {
                          dispatchPairing({ type: "SET_PAIR_CODE", value: parsed.pairingCode });
                        }
                        dispatchPairing({ type: "SET_MODE", mode: "qr" });
                      }}
                    >
                      Parse
                    </button>
                  </div>
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
                  <button
                    className="ghost"
                    onClick={() => dispatchPairing({ type: "RESET" })}
                    disabled={busy}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="pairing-step">
                <div className="pairing-step-header">
                  <h4>Step 2: Connect</h4>
                  <span className="muted">
                    {pairingState.status === "connecting"
                      ? "Connecting..."
                      : pairingState.status === "connected"
                        ? "Connected"
                        : "Connect after pairing"}
                  </span>
                </div>
                <label>
                  Device Address (host:port)
                  <input
                    value={pairingState.connectAddress}
                    onChange={(event) =>
                      dispatchPairing({ type: "SET_CONNECT_ADDRESS", value: event.target.value })
                    }
                    placeholder="192.168.0.10:5555"
                  />
                </label>
                <div className="button-row">
                  <button onClick={handleConnectSubmit} disabled={busy}>
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

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function flattenGroups(groups: Record<string, string[]>) {
  const map: Record<string, string> = {};
  Object.entries(groups || {}).forEach(([group, serials]) => {
    serials.forEach((serial) => {
      map[serial] = group;
    });
  });
  return map;
}

function expandGroups(map: Record<string, string>) {
  const groups: Record<string, string[]> = {};
  Object.entries(map).forEach(([serial, group]) => {
    if (!group) {
      return;
    }
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(serial);
  });
  return groups;
}

function formatError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "error" in error) {
    const payload = error as { error: string; code?: string; trace_id?: string };
    return `${payload.error} ${payload.code ? `(${payload.code})` : ""} ${payload.trace_id ?? ""}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

export default App;
