import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
import { isTauriRuntime } from "./tauriEnv";
import {
  getDesktopNotificationPermission,
  isAppUnfocused,
  requestDesktopNotificationPermission,
  sendDesktopNotification,
  type DesktopNotificationPermissionState,
} from "./desktopNotifications";
import { BluetoothMonitorPage } from "./BluetoothMonitorPage";
import type {
  AdbInfo,
  AppConfig,
  AppBasicInfo,
  AppInfo,
  BugreportLogFilters,
  BugreportLogMatch,
  BugreportLogRow,
  BugreportLogSummary,
  BugreportResult,
  DeviceFileEntry,
  DeviceInfo,
  FilePreview,
  LogcatEvent,
  NetProfilerEvent,
  NetProfilerSnapshot,
  PerfEvent,
  PerfSnapshot,
  TerminalEvent,
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
  getAppBasicInfo,
  getAppIcon,
  exportLogcat,
  exportUiHierarchy,
  forceStopApp,
  generateBugreport,
  getConfig,
  installApkBatch,
  launchApp,
  launchScrcpy,
  mkdirDeviceDir,
  prepareBugreportLogcat,
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
  queryBugreportLogcatAround,
  searchBugreportLogcat,
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
import { LOG_LEVELS } from "./logLevels";
import {
  addLogTextChip,
  buildLogTextFilters,
  removeLogTextChip,
  type LogTextChip,
  type LogTextChipKind,
} from "./logTextFilters";
import {
  buildSparklinePoints,
  formatBps,
  formatBytes,
  formatHzX100,
  formatKhz,
  formatPerSecX100,
} from "./perf";
import { buildLinePath, extractNetSeries, sliceSnapshotsByWindowMs } from "./netProfiler";
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
  type TaskItem,
  type TaskKind,
  type TaskStatus,
} from "./tasks";
import { buildDesktopNotificationForTask, detectNewlyCompletedTasks } from "./taskNotificationRules";
import {
  applyDeviceDetailPatch,
  filterDevicesBySearch,
  formatDeviceInfoMarkdown,
  mergeDeviceDetails,
  reduceSelectionToOne,
  resolveSelectedSerials,
  selectSerialsForGroup,
} from "./deviceUtils";
import { clampRefreshIntervalSec } from "./deviceAutoRefresh";
import { bugreportLogLineMatches, buildBugreportLogFindPattern } from "./bugreportLogFind";
import {
  findRunningBugreportTaskIdForSerial,
  resolveBugreportPanelTaskId,
} from "./bugreportTaskRecovery";
import { parseUiNodes, pickUiNodeAtPoint } from "./ui_bounds";
import {
  applyDroppedPaths,
  sanitizeMultiPathsForStorage,
  sanitizeStoredState,
} from "./apkInstallerState";
import {
  checkForUpdate,
  installUpdateAndRelaunch,
  readUpdateLastCheckedMs,
  shouldAutoCheck,
  type UpdaterUpdateLike,
} from "./updater";
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
type ApkInstallEvent = {
  serial: string;
  event: "start" | "complete";
  success?: boolean | null;
  message?: string | null;
  error_code?: string | null;
  raw_output?: string | null;
  trace_id: string;
};
type DeviceTrackingSnapshotPayload = { trace_id: string; devices: DeviceInfo[] };
type LogcatLineEntry = { id: number; text: string };
type PerfMonitorState = {
  running: boolean;
  traceId: string | null;
  samples: PerfSnapshot[];
  lastError: string | null;
};
type NetProfilerState = {
  running: boolean;
  traceId: string | null;
  samples: NetProfilerSnapshot[];
  lastError: string | null;
};
type TerminalDeviceState = {
  connected: boolean;
  sessionId: string | null;
  lines: string[];
  tail: string;
  autoScroll: boolean;
};
type QuickActionId =
  | "screenshot"
  | "reboot"
  | "record"
  | "logcat-clear"
  | "mirror";
type RebootMode = "normal" | "recovery" | "bootloader";
type DashboardActionId = QuickActionId | "apk-installer";

const TERMINAL_MAX_LINES = 500;
const NET_PROFILER_MAX_SAMPLES = 180;
const APK_INSTALLER_STORAGE_KEY = "lazy_blacktea_apk_installer_v1";
const SHARED_LOG_FILTERS_STORAGE_KEY = "lazy_blacktea_shared_log_filters_v1";

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

const appendTerminalBuffer = (
  lines: string[],
  tail: string,
  chunk: string,
  maxLines: number,
) => {
  if (!chunk) {
    return { lines, tail };
  }
  const combined = `${tail}${chunk}`;
  const parts = combined.split("\n");
  const nextTail = parts.pop() ?? "";
  let nextLines = lines.concat(parts);
  if (nextLines.length > maxLines) {
    nextLines = nextLines.slice(-maxLines);
  }
  return { lines: nextLines, tail: nextTail };
};

const renderTerminalBuffer = (lines: string[], tail: string) => {
  if (!lines.length && !tail) {
    return "No output yet.";
  }
  if (!lines.length) {
    return tail;
  }
  if (tail) {
    return `${lines.join("\n")}\n${tail}`;
  }
  return lines.join("\n");
};

const normalizeBugreportTimestamp = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}$/.test(trimmed) ? trimmed : null;
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
    <div data-log-id={entry.id} className="logcat-line">
      {renderHighlightedLogcatLine(entry.text, searchPattern)}
    </div>
  );
};

const MemoLogcatLineRow = memo(LogcatLineRow, (prev, next) => {
  return prev.entry === next.entry && prev.searchPattern === next.searchPattern;
});

const LOGCAT_LINE_HEIGHT_PX = 16;
const LOGCAT_OUTPUT_PADDING_PX = 8;
const LOGCAT_OVERSCAN = 80;

const LogcatOutput = memo(function LogcatOutput({
  entries,
  searchPattern,
  autoScroll,
  outputRef,
}: {
  entries: LogcatLineEntry[];
  searchPattern: RegExp | null;
  autoScroll: boolean;
  outputRef: RefObject<HTMLDivElement | null>;
}) {
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useLayoutEffect(() => {
    const el = outputRef.current;
    if (!el) {
      return;
    }
    const update = () => {
      setViewportHeight(el.clientHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [outputRef]);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const el = outputRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
    setScrollTop(el.scrollTop);
  }, [autoScroll, entries.length, outputRef]);

  const handleScroll = () => {
    if (rafRef.current != null) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const el = outputRef.current;
      if (!el) {
        return;
      }
      setScrollTop(el.scrollTop);
    });
  };

  const total = entries.length;
  const start = Math.max(0, Math.floor(scrollTop / LOGCAT_LINE_HEIGHT_PX) - LOGCAT_OVERSCAN);
  const end = Math.min(
    total,
    Math.ceil((scrollTop + viewportHeight) / LOGCAT_LINE_HEIGHT_PX) + LOGCAT_OVERSCAN,
  );
  const topPad = start * LOGCAT_LINE_HEIGHT_PX;
  const bottomPad = Math.max(0, (total - end) * LOGCAT_LINE_HEIGHT_PX);
  const slice = entries.slice(start, end);

  return (
    <div ref={outputRef} className="logcat-output logcat-live" onScroll={handleScroll}>
      <div className="logcat-viewport">
        <div style={{ height: topPad }} />
        {slice.map((entry) => (
          <MemoLogcatLineRow key={entry.id} entry={entry} searchPattern={searchPattern} />
        ))}
        <div style={{ height: bottomPad }} />
      </div>
    </div>
  );
});

type BugreportLogOutputProps = {
  rows: BugreportLogRow[];
  highlightPattern: RegExp | null;
  onNearBottom: () => void;
  canLoadMore: boolean;
  busy: boolean;
  activeRowId?: number | null;
};

const BUGREPORT_LOG_LINE_HEIGHT_PX = 16;

const BugreportLogOutput = memo(function BugreportLogOutput({
  rows,
  highlightPattern,
  onNearBottom,
  canLoadMore,
  busy,
  activeRowId = null,
}: BugreportLogOutputProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [findRegex, setFindRegex] = useState(false);
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findMatchRowIndices, setFindMatchRowIndices] = useState<number[]>([]);
  const [findActiveIndex, setFindActiveIndex] = useState(-1);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const findComputeTokenRef = useRef(0);
  const findStateRef = useRef<{ key: string; rowsLen: number }>({ key: "", rowsLen: 0 });

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.focus(), 0);
        return;
      }
      if (event.key === "Escape" && findOpen) {
        if (findTerm.trim()) {
          setFindTerm("");
        } else {
          setFindOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [findOpen, findTerm]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const update = () => {
      setViewportHeight(el.clientHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = () => {
    if (rafRef.current != null) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (!el) {
        return;
      }
      setScrollTop(el.scrollTop);
      if (canLoadMore && !busy && el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
        onNearBottom();
      }
    });
  };

  const findPattern = useMemo(
    () => buildBugreportLogFindPattern(findTerm, { caseSensitive: findCaseSensitive, regex: findRegex }),
    [findCaseSensitive, findRegex, findTerm],
  );

  useEffect(() => {
    const key = `${findTerm}|${findRegex ? "1" : "0"}|${findCaseSensitive ? "1" : "0"}`;
    const token = findComputeTokenRef.current + 1;
    findComputeTokenRef.current = token;

    const handle = window.setTimeout(() => {
      if (findComputeTokenRef.current !== token) {
        return;
      }
      const prev = findStateRef.current;
      const nextLen = rows.length;
      const patternChanged = prev.key !== key;
      const chunkSize = 1000;

      const scanRange = (
        startIndex: number,
        endIndex: number,
        onDone: (matches: number[]) => void,
      ) => {
        const matches: number[] = [];
        let cursor = startIndex;

        const step = () => {
          if (findComputeTokenRef.current !== token) {
            return;
          }
          const limit = Math.min(cursor + chunkSize, endIndex);
          for (let i = cursor; i < limit; i += 1) {
            if (bugreportLogLineMatches(findPattern, rows[i].raw_line)) {
              matches.push(i);
            }
          }
          cursor = limit;
          if (cursor < endIndex) {
            window.setTimeout(step, 0);
            return;
          }
          onDone(matches);
        };

        step();
      };

      if (!findTerm.trim() || !findPattern || findPattern.error) {
        findStateRef.current = { key, rowsLen: nextLen };
        setFindMatchRowIndices([]);
        setFindActiveIndex(-1);
        return;
      }

      if (patternChanged || nextLen < prev.rowsLen) {
        findStateRef.current = { key, rowsLen: nextLen };
        scanRange(0, rows.length, (matches) => {
          if (findComputeTokenRef.current !== token) {
            return;
          }
          setFindMatchRowIndices(matches);
          setFindActiveIndex(-1);
        });
        return;
      }

      if (nextLen === prev.rowsLen) {
        return;
      }

      findStateRef.current = { key, rowsLen: nextLen };
      scanRange(prev.rowsLen, rows.length, (newMatches) => {
        if (findComputeTokenRef.current !== token) {
          return;
        }
        if (newMatches.length) {
          setFindMatchRowIndices((prevMatches) => [...prevMatches, ...newMatches]);
        }
      });
    }, 180);
    return () => window.clearTimeout(handle);
  }, [findCaseSensitive, findPattern, findRegex, findTerm, rows]);

  const findMatchIndexSet = useMemo(() => new Set(findMatchRowIndices), [findMatchRowIndices]);
  const activeMatchRowIndex =
    findMatchRowIndices.length > 0 && findActiveIndex >= 0
      ? findMatchRowIndices[Math.min(findActiveIndex, findMatchRowIndices.length - 1)]
      : null;

  const scrollToRowIndex = (rowIndex: number) => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const target = rowIndex * BUGREPORT_LOG_LINE_HEIGHT_PX;
    el.scrollTop = target;
    setScrollTop(target);
  };

  useEffect(() => {
    if (activeRowId == null) {
      return;
    }
    const index = rows.findIndex((row) => row.id === activeRowId);
    if (index < 0) {
      return;
    }
    scrollToRowIndex(index);
  }, [activeRowId, rows]);

  const goToMatch = (nextIndex: number) => {
    if (findMatchRowIndices.length === 0) {
      return;
    }
    const normalized = ((nextIndex % findMatchRowIndices.length) + findMatchRowIndices.length) % findMatchRowIndices.length;
    setFindActiveIndex(normalized);
    const rowIndex = findMatchRowIndices[normalized];
    scrollToRowIndex(rowIndex);
  };

  const moveMatch = (delta: number) => {
    if (findMatchRowIndices.length === 0) {
      return;
    }
    if (findActiveIndex < 0) {
      goToMatch(delta < 0 ? findMatchRowIndices.length - 1 : 0);
      return;
    }
    goToMatch(findActiveIndex + delta);
  };

  const overscan = 40;
  const total = rows.length;
  const start = Math.max(0, Math.floor(scrollTop / BUGREPORT_LOG_LINE_HEIGHT_PX) - overscan);
  const end = Math.min(
    total,
    Math.ceil((scrollTop + viewportHeight) / BUGREPORT_LOG_LINE_HEIGHT_PX) + overscan,
  );
  const topPad = start * BUGREPORT_LOG_LINE_HEIGHT_PX;
  const bottomPad = Math.max(0, (total - end) * BUGREPORT_LOG_LINE_HEIGHT_PX);
  const slice = rows.slice(start, end);

  return (
    <div className="logcat-output bugreport-log-output bugreport-log-output-shell">
      <div className="bugreport-log-findbar">
        {findOpen ? (
          <div className="bugreport-log-findbar-right">
            <input
              ref={findInputRef}
              aria-label="Find"
              value={findTerm}
              onChange={(event) => setFindTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  moveMatch(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  if (findTerm.trim()) {
                    setFindTerm("");
                  } else {
                    setFindOpen(false);
                  }
                }
              }}
              placeholder="Find"
            />
            <label className="toggle bugreport-log-findbar-toggle">
              <input
                type="checkbox"
                checked={findRegex}
                onChange={(event) => setFindRegex(event.target.checked)}
              />
              Regex
            </label>
            <label className="toggle bugreport-log-findbar-toggle">
              <input
                type="checkbox"
                checked={findCaseSensitive}
                onChange={(event) => setFindCaseSensitive(event.target.checked)}
              />
              Aa
            </label>
            <span className="bugreport-log-findbar-count">
              {findPattern?.error
                ? "Invalid regex"
                : findMatchRowIndices.length > 0
                  ? `${Math.max(0, Math.min(findActiveIndex + 1, findMatchRowIndices.length))}/${findMatchRowIndices.length}`
                  : "0/0"}
            </span>
            <button
              className="ghost"
              onClick={() => moveMatch(-1)}
              disabled={findMatchRowIndices.length === 0}
            >
              Prev
            </button>
            <button
              className="ghost"
              onClick={() => moveMatch(1)}
              disabled={findMatchRowIndices.length === 0}
            >
              Next
            </button>
            <button className="ghost" onClick={() => setFindOpen(false)} aria-label="Close find">
              Close
            </button>
          </div>
        ) : (
          <button
            className="ghost bugreport-log-find-toggle"
            onClick={() => {
              setFindOpen(true);
              window.setTimeout(() => findInputRef.current?.focus(), 0);
            }}
            aria-label="Open find"
          >
            Find
          </button>
        )}
      </div>

      <div ref={scrollRef} className="bugreport-log-scroll" onScroll={handleScroll}>
        <div className="bugreport-log-viewport">
          <div style={{ height: topPad }} />
          {slice.map((row, index) => {
            const rowIndex = start + index;
            const isMatch = findMatchIndexSet.has(rowIndex);
            const isActive = activeMatchRowIndex === rowIndex || (activeRowId != null && row.id === activeRowId);
            return (
              <div
                key={row.id}
                className={`bugreport-log-line${isMatch ? " match" : ""}${isActive ? " active" : ""}`}
              >
                {renderHighlightedLogcatLine(row.raw_line, highlightPattern)}
              </div>
            );
          })}
          <div style={{ height: bottomPad }} />
        </div>
      </div>
    </div>
  );
});

const DeviceTerminalPanel = memo(function DeviceTerminalPanel({
  serial,
  state,
  disabled,
  onConnect,
  onDisconnect,
  onSend,
  onInterrupt,
  onClear,
  onToggleAutoScroll,
}: {
  serial: string;
  state: TerminalDeviceState;
  disabled: boolean;
  onConnect: (serial: string) => void;
  onDisconnect: (serial: string) => void;
  onSend: (serial: string, command: string) => void;
  onInterrupt: (serial: string) => void;
  onClear: (serial: string) => void;
  onToggleAutoScroll: (serial: string, enabled: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const outputRef = useRef<HTMLPreElement | null>(null);
  const display = useMemo(
    () => renderTerminalBuffer(state.lines, state.tail),
    [state.lines, state.tail],
  );

  useEffect(() => {
    if (!state.autoScroll) {
      return;
    }
    const el = outputRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [state.autoScroll, state.lines, state.tail]);

  const runInput = () => {
    const command = input.trimEnd();
    if (!command.trim()) {
      return;
    }
    onSend(serial, command);
    setInput("");
  };

  return (
    <section className="panel terminal-panel">
      <div className="panel-header">
        <h3>{serial}</h3>
        <div className="terminal-panel-meta">
          <span className={`status-pill ${state.connected ? "ok" : "warn"}`}>
            {state.connected ? "Connected" : "Disconnected"}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => (state.connected ? onDisconnect(serial) : onConnect(serial))}
            disabled={disabled}
          >
            {state.connected ? "Disconnect" : "Connect"}
          </button>
        </div>
      </div>

      <div className="terminal-panel-controls">
        <button
          type="button"
          className="ghost"
          onClick={() => onInterrupt(serial)}
          disabled={disabled || !state.connected}
        >
          Ctrl+C
        </button>
        <button type="button" className="ghost" onClick={() => onClear(serial)} disabled={disabled}>
          Clear
        </button>
        <label className="terminal-autoscroll">
          <input
            type="checkbox"
            checked={state.autoScroll}
            onChange={(event) => onToggleAutoScroll(serial, event.target.checked)}
            disabled={disabled}
          />
          Auto-scroll
        </label>
      </div>

      <pre ref={outputRef} className="terminal-screen">
        {display}
      </pre>

      <div className="terminal-input-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type a command and press Enter"
          disabled={disabled || !state.connected}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              runInput();
            }
          }}
        />
        <button type="button" onClick={runInput} disabled={disabled || !state.connected}>
          Send
        </button>
      </div>
    </section>
  );
});

function AdvancedToggleButton({
  open,
  onClick,
  disabled,
  className,
}: {
  open: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`ghost${open ? " active" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={open}
    >
      {open ? "Hide Advanced" : "Advanced"}
    </button>
  );
}

function LogLiveFilterBar({
  kind,
  onKindChange,
  value,
  onValueChange,
  onAdd,
  disabled,
  filtersCount,
  headerActions,
}: {
  kind: LogTextChipKind;
  onKindChange: (next: LogTextChipKind) => void;
  value: string;
  onValueChange: (next: string) => void;
  onAdd: () => void;
  disabled: boolean;
  filtersCount: number;
  headerActions?: ReactNode;
}) {
  return (
    <div className="logcat-filter-grid logcat-live-filter-grid">
      <div className="panel-sub logcat-filter-bar logcat-live-filter-bar">
        <div className="logcat-filter-combined">
          <div className="logcat-filter-section">
            <div className="logcat-filter-header">
              <h3 title="Use regex to refine logs. Shared with Logcat and Bugreport Log Viewer.">Live Filter</h3>
              <div className="logcat-filter-header-actions">
                <span className="muted">{filtersCount ? `${filtersCount} filters` : "No filters"}</span>
                {headerActions}
              </div>
            </div>
            <div className="form-row">
              <label>Pattern</label>
              <select
                aria-label="Filter mode"
                value={kind}
                onChange={(event) => onKindChange(event.target.value as LogTextChipKind)}
                disabled={disabled}
                title="Prefix with - or ! to exclude, + to include."
              >
                <option value="include">Include</option>
                <option value="exclude">Exclude</option>
              </select>
              <input
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onAdd();
                  }
                }}
                placeholder="e.g. ActivityManager|AndroidRuntime or -DEBUG"
                title="Regex patterns are case-insensitive."
                disabled={disabled}
              />
              <button type="button" onClick={onAdd} disabled={disabled || !value.trim()}>
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineAdvancedPanel({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`output-block logcat-advanced-inline${className ? ` ${className}` : ""}`} aria-label="Advanced filters">
      <div className="logcat-advanced-inline-header">
        <span className="logcat-advanced-inline-title">{title}</span>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="logcat-advanced-body">{children}</div>
    </div>
  );
}

function SharedRegexFiltersAndPresetsPanel({
  chips,
  expanded,
  onToggleExpanded,
  onRemoveChip,
  onClearChips,
  disabled,
  appliedTitle,
  gridClassName,
  presets,
  presetSelected,
  onPresetSelectedChange,
  presetName,
  onPresetNameChange,
  hasSelectedPreset,
  onApplyPreset,
  onDeletePreset,
  onSavePreset,
  children,
}: {
  chips: LogTextChip[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onRemoveChip: (chipId: string) => void;
  onClearChips: () => void;
  disabled: boolean;
  appliedTitle: string;
  gridClassName?: string;
  presets: Array<{ name: string }>;
  presetSelected: string;
  onPresetSelectedChange: (next: string) => void;
  presetName: string;
  onPresetNameChange: (next: string) => void;
  hasSelectedPreset: boolean;
  onApplyPreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
  onSavePreset: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`logcat-filter-grid${gridClassName ? ` ${gridClassName}` : ""}`}>
      <div className="panel-sub logcat-filter-bar">
        <div className="logcat-filter-combined">
          <div className="logcat-filter-section">
            <div className="logcat-filter-header">
              <h3 title={appliedTitle}>Active Filters</h3>
              <div className="logcat-filter-header-actions">
                <span className="muted">{chips.length ? `${chips.length} filters` : "No filters"}</span>
                <button type="button" className="ghost" onClick={onToggleExpanded}>
                  {expanded ? "Hide" : "Expand"}
                </button>
              </div>
            </div>
            {expanded && (
              <>
                {chips.length === 0 ? (
                  <p className="muted">No active filters</p>
                ) : (
                  <div className="bugreport-log-chip-list" role="list">
                    {chips.map((chip) => (
                      <span
                        key={chip.id}
                        className={`bugreport-log-chip ${chip.kind === "exclude" ? "exclude" : "include"}`}
                        role="listitem"
                      >
                        <span className="bugreport-log-chip-label" title={chip.value}>
                          {chip.kind === "exclude" ? `NOT ${chip.value}` : chip.value}
                        </span>
                        <button
                          type="button"
                          className="bugreport-log-chip-remove"
                          aria-label={`Remove ${chip.kind === "exclude" ? "NOT " : ""}${chip.value}`}
                          onClick={() => onRemoveChip(chip.id)}
                          disabled={disabled}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="button-row compact">
                  <button
                    type="button"
                    className="ghost"
                    onClick={onClearChips}
                    disabled={disabled || chips.length === 0}
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="logcat-presets">
          <div className="logcat-preset-row single">
            <div className="logcat-preset-group left">
              <label>Preset</label>
              <select
                value={presetSelected}
                onChange={(event) => onPresetSelectedChange(event.target.value)}
                disabled={disabled}
              >
                <option value="">Select preset</option>
                {presets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (presetSelected) {
                    onApplyPreset(presetSelected);
                  }
                }}
                disabled={disabled || !hasSelectedPreset}
              >
                Apply
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (presetSelected) {
                    onDeletePreset(presetSelected);
                  }
                }}
                disabled={disabled || !hasSelectedPreset}
              >
                Delete
              </button>
            </div>
            <div className="logcat-preset-group right">
              <label>New</label>
              <input
                value={presetName}
                onChange={(event) => onPresetNameChange(event.target.value)}
                placeholder="e.g. Crash Only"
                disabled={disabled}
              />
              <button type="button" onClick={onSavePreset} disabled={disabled}>
                Save
              </button>
            </div>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}

function App() {
  type LogcatFilterPreset = {
    name: string;
    include: string[];
    exclude: string[];
    levels?: LogcatLevelsState;
  };

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  type DeviceSelectionMode = "single" | "multi";
  const DEVICE_SELECTION_MODE_STORAGE_KEY = "lazy_blacktea_device_selection_mode_v1";
  const [deviceSelectionMode, setDeviceSelectionMode] = useState<DeviceSelectionMode>(() => {
    try {
      const raw = localStorage.getItem(DEVICE_SELECTION_MODE_STORAGE_KEY);
      return raw === "single" || raw === "multi" ? raw : "multi";
    } catch (error) {
      console.warn("Failed to load device selection mode from storage.", error);
      return "multi";
    }
  });
  const [terminalBySerial, setTerminalBySerial] = useState<Record<string, TerminalDeviceState>>({});
  const [terminalBroadcast, setTerminalBroadcast] = useState("");
  const [terminalActiveSerials, setTerminalActiveSerials] = useState<string[]>([]);
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
  type UpdateUiStatus =
    | "idle"
    | "checking"
    | "up_to_date"
    | "update_available"
    | "installing"
    | "installed"
    | "installed_needs_restart"
    | "error";
  const UPDATE_AUTO_CHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const [updateStatus, setUpdateStatus] = useState<UpdateUiStatus>("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<UpdaterUpdateLike | null>(null);
  const [updateLastCheckedMs, setUpdateLastCheckedMs] = useState<number | null>(() => readUpdateLastCheckedMs());
  const [updateLastCheckSource, setUpdateLastCheckSource] = useState<"auto" | "manual" | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [logcatLines, setLogcatLines] = useState<Record<string, LogcatLineEntry[]>>({});
  const [logcatSourceMode, setLogcatSourceMode] = useState<LogcatSourceMode>("tag");
  const [logcatSourceValue, setLogcatSourceValue] = useState("");
  const [logLevels, setLogLevels] = useState<LogcatLevelsState>(() => loadSharedLogFiltersFromStorage().levels);
  const [logcatLiveFilter, setLogcatLiveFilter] = useState("");
  const [logcatPresetName, setLogcatPresetName] = useState("");
  const [logcatPresets, setLogcatPresets] = useState<LogcatFilterPreset[]>([]);
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
  const [logcatTextKind, setLogcatTextKind] = useState<LogTextChipKind>("include");
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
      const result = await checkForUpdate({ nowMs });
      if (cancelled) {
        return;
      }
      setUpdateLastCheckedMs(nowMs);
      if (result.status === "update_available") {
        setUpdateAvailable(result.update);
        setUpdateStatus("update_available");
        return;
      }
      if (result.status === "error") {
        setUpdateStatus("error");
        setUpdateError(result.message);
        return;
      }
      // Keep startup checks quiet unless an update is available.
      setUpdateAvailable(null);
      setUpdateStatus("idle");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const closeUpdateModal = () => {
    if (updateStatus === "installing") {
      return;
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

    const result = await checkForUpdate({ nowMs });
    setUpdateLastCheckedMs(nowMs);
    if (result.status === "update_available") {
      setUpdateAvailable(result.update);
      setUpdateStatus("update_available");
      return;
    }
    if (result.status === "error") {
      setUpdateStatus("error");
      setUpdateError(result.message);
      return;
    }
    setUpdateAvailable(null);
    setUpdateStatus(source === "manual" ? "up_to_date" : "idle");
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
  const [uiHtml, setUiHtml] = useState("");
  const [uiXml, setUiXml] = useState("");
  const [uiScreenshotDataUrl, setUiScreenshotDataUrl] = useState("");
  const [uiScreenshotError, setUiScreenshotError] = useState("");
  const [uiInspectorTab, setUiInspectorTab] = useState<"hierarchy" | "xml">("hierarchy");
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
  } | null>(null);
  const [deviceCommandMenu, setDeviceCommandMenu] = useState<{
    x: number;
    y: number;
    kind: "select_group" | "wifi" | "bluetooth";
  } | null>(null);
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
  const [latestApkInstallTaskId, setLatestApkInstallTaskId] = useState<string | null>(null);
  const [screenRecordRemote, setScreenRecordRemote] = useState<string | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [appsFilter, setAppsFilter] = useState("");
  const [appsThirdPartyOnly, setAppsThirdPartyOnly] = useState(true);
  const [appsIncludeVersions, setAppsIncludeVersions] = useState(false);
  const APPS_PAGE_SIZE = 40;
  const [appsVisibleCount, setAppsVisibleCount] = useState(APPS_PAGE_SIZE);
  const [selectedApp, setSelectedApp] = useState<AppInfo | null>(null);
  const [selectedAppDetails, setSelectedAppDetails] = useState<AppBasicInfo | null>(null);
  const [appsDetailsBusy, setAppsDetailsBusy] = useState(false);
  const [appsContextMenu, setAppsContextMenu] = useState<null | { x: number; y: number; app: AppInfo }>(null);
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
  const [bugreportProgress, setBugreportProgress] = useState<number | null>(null);
  const [bugreportResult, setBugreportResult] = useState<BugreportResult | null>(null);
  const [latestBugreportTaskId, setLatestBugreportTaskId] = useState<string | null>(null);
  const [bugreportLogSourcePath, setBugreportLogSourcePath] = useState("");
  const [bugreportLogSummary, setBugreportLogSummary] = useState<BugreportLogSummary | null>(null);
  const [bugreportLogRows, setBugreportLogRows] = useState<BugreportLogRow[]>([]);
  const [bugreportLogHasMore, setBugreportLogHasMore] = useState(false);
  const [bugreportLogOffset, setBugreportLogOffset] = useState(0);
  const [bugreportLogBusy, setBugreportLogBusy] = useState(false);
  const [bugreportLogError, setBugreportLogError] = useState<string | null>(null);
  const [bugreportLogLoadAllRunning, setBugreportLogLoadAllRunning] = useState(false);
  const [bugreportLogBuffer, setBugreportLogBuffer] = useState("");
  const [bugreportLogTag, setBugreportLogTag] = useState("");
  const [bugreportLogPid, setBugreportLogPid] = useState("");
  const [bugreportLogLiveFilter, setBugreportLogLiveFilter] = useState("");
  const [bugreportLogFilterKind, setBugreportLogFilterKind] = useState<LogTextChipKind>("include");
  const [bugreportLogFiltersExpanded, setBugreportLogFiltersExpanded] = useState(false);
  const [bugreportLogStart, setBugreportLogStart] = useState("");
  const [bugreportLogEnd, setBugreportLogEnd] = useState("");
  const [bugreportLogSearchTerm, setBugreportLogSearchTerm] = useState("");
  const [bugreportLogLastSearchTerm, setBugreportLogLastSearchTerm] = useState("");
  const [bugreportLogMatches, setBugreportLogMatches] = useState<BugreportLogMatch[]>([]);
  const [bugreportLogMatchesTruncated, setBugreportLogMatchesTruncated] = useState(false);
  const [bugreportLogMatchIndex, setBugreportLogMatchIndex] = useState(-1);
  const [bugreportLogMatchesOpen, setBugreportLogMatchesOpen] = useState(false);
  const [bugreportLogAdvancedOpen, setBugreportLogAdvancedOpen] = useState(false);
  const [bugreportLogContextAnchorId, setBugreportLogContextAnchorId] = useState<number | null>(null);
  const [devicePopoverOpen, setDevicePopoverOpen] = useState(false);
  const [devicePopoverLeft, setDevicePopoverLeft] = useState<number | null>(null);
  const [devicePopoverSearch, setDevicePopoverSearch] = useState("");
  const [scrcpyInfo, setScrcpyInfo] = useState<ScrcpyInfo | null>(null);
  const [adbInfo, setAdbInfo] = useState<AdbInfo | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [pairingState, dispatchPairing] = useReducer(pairingReducer, initialPairingState);
  const [rebootConfirmOpen, setRebootConfirmOpen] = useState(false);
  const [rebootConfirmMode, setRebootConfirmMode] = useState<RebootMode>("normal");
  const [taskState, dispatchTasks] = useReducer(tasksReducer, undefined, () => createInitialTaskState(50));
  const taskStateRef = useRef(taskState);
  useEffect(() => {
    taskStateRef.current = taskState;
  }, [taskState]);
  const [logcatMatchIndex, setLogcatMatchIndex] = useState(0);
  const logcatOutputRef = useRef<HTMLDivElement>(null);
  const uiScreenshotImgRef = useRef<HTMLImageElement | null>(null);
  const uiBoundsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const uiHierarchyFrameRef = useRef<HTMLIFrameElement | null>(null);
  const uiHierarchySelectedIndexRef = useRef<number | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);
  const devicePopoverRef = useRef<HTMLDivElement | null>(null);
  const devicePopoverTriggerRef = useRef<HTMLDivElement | null>(null);
  const devicePopoverSearchRef = useRef<HTMLInputElement | null>(null);
  const fileTransferTaskByTraceIdRef = useRef<Record<string, string>>({});
  const apkInstallTaskByTraceIdRef = useRef<Record<string, string>>({});
  const prevTaskItemsRef = useRef<TaskItem[] | null>(null);
  const notifiedTaskIdsRef = useRef<Set<string>>(new Set());
  const appsDetailsSeqRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const detailRefreshSeqRef = useRef(0);
  const detailRefreshTimerRef = useRef<number | null>(null);
  const deviceAutoRefreshLastWarnAtRef = useRef(0);
  const deviceTrackingLastSnapshotAtRef = useRef<number>(0);
  const deviceTrackingLastFallbackAtRef = useRef<number>(0);
  const deviceTrackingPendingSnapshotRef = useRef<DeviceInfo[] | null>(null);
  const deviceTrackingRestartInFlightRef = useRef(false);
  const deviceTrackingFallbackInFlightRef = useRef(false);
  const deviceTrackingStartedAtRef = useRef<number>(0);
  const busyRef = useRef(false);
  const adbInfoRef = useRef<AdbInfo | null>(null);
  const devicesRef = useRef<DeviceInfo[]>([]);
  const configRef = useRef<AppConfig | null>(null);
  const bugreportLogRequestRef = useRef(0);
  const bugreportLogSearchRequestRef = useRef(0);
  const logcatPendingRef = useRef<Record<string, string[]>>({});
  const logcatNextIdRef = useRef<Record<string, number>>({});
  const logcatFlushTimerRef = useRef<number | null>(null);
  const perfLastSerialRef = useRef<string | null>(null);
  const netLastSerialRef = useRef<string | null>(null);
  const filesDragContextRef = useRef<{
    pathname: string;
    serial: string;
    path: string;
    overwrite: boolean;
    existingNames: string[];
    selection_count: number;
  }>({ pathname: "/", serial: "", path: "/sdcard", overwrite: true, existingNames: [], selection_count: 0 });
  const apkDragContextRef = useRef<{ pathname: string; mode: "single" | "multiple" | "bundle" }>({
    pathname: "/",
    mode: "single",
  });
  const bugreportLogLastReportIdRef = useRef<string | null>(null);
  const bugreportLogLoadAllTokenRef = useRef(0);
  const bugreportLogLoadAllRunningRef = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();
  const isBugreportLogViewer = location.pathname === "/bugreport-logviewer";
  const isPerformanceView = location.pathname === "/performance";
  const isNetworkView = location.pathname === "/network";
  const isUiInspectorView = location.pathname === "/ui-inspector";
  useEffect(() => {
    if (!isBugreportLogViewer) {
      setBugreportLogAdvancedOpen(false);
    }
  }, [isBugreportLogViewer]);
  const activeSerial = selectedSerials[0];
  const activeDevice = useMemo(
    () => devices.find((device) => device.summary.serial === activeSerial) ?? null,
    [devices, activeSerial],
  );
  const latestApkInstallTask = latestApkInstallTaskId
    ? taskState.items.find((task) => task.id === latestApkInstallTaskId) ?? null
    : null;
  const hasDevices = devices.length > 0;
  const selectedCount = selectedSerials.length;
  const selectedConnectedCount = selectedSerials.reduce(
    (total, serial) => total + (terminalBySerial[serial]?.connected ? 1 : 0),
    0,
  );
  const deviceStatus = activeDevice?.summary.state ?? "offline";
  const selectedSummaryLabel =
    selectedCount === 0
      ? "No devices selected"
      : selectedCount === 1
        ? activeSerial ?? "No device selected"
        : `${selectedCount} devices selected`;
  const hasFileSelection = filesSelectedPaths.length > 0;
  const fileSelectionLabel = hasFileSelection
    ? `${filesSelectedPaths.length} items selected`
    : "Select files to enable bulk actions.";
  const requiresSingleSelection = useMemo(
    () =>
      ["/files", "/ui-inspector", "/apps", "/bluetooth", "/logcat", "/performance", "/network"].includes(
        location.pathname,
      ),
    [location.pathname],
  );
  const singleSelectionWarning = requiresSingleSelection && selectedCount > 1;
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
  const latestBugreportProgress = useMemo(() => {
    if (!latestBugreportEntries.length) {
      return null;
    }
    const values = latestBugreportEntries
      .map((entry) => entry.progress)
      .filter((value): value is number => value != null);
    if (!values.length) {
      return null;
    }
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [latestBugreportEntries]);
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
  const bugreportLogFilters = useMemo<BugreportLogFilters>(() => {
    const pidValue = Number.parseInt(bugreportLogPid.trim(), 10);
    const enabledLevels = LOG_LEVELS.filter((level) => logLevels[level]);
    const sharedFilters = buildLogTextFilters(sharedLogTextChips);
    const liveInclude = bugreportLogFilterKind === "include" ? bugreportLogLiveFilter : "";
    const liveExclude = bugreportLogFilterKind === "exclude" ? bugreportLogLiveFilter : "";

    const normalizeRegexPatterns = (patterns: string[]) =>
      patterns
        .map((pattern) => pattern.trim())
        .filter(Boolean)
        .filter((pattern) => {
          try {
            // Bugreport backend regex filtering should match Logcat's default case-insensitive behavior.
            // eslint-disable-next-line no-new
            new RegExp(pattern, "i");
            return true;
          } catch {
            return false;
          }
        });

    const regex_terms = normalizeRegexPatterns([...sharedFilters.text_terms, liveInclude]);
    const regex_excludes = normalizeRegexPatterns([...sharedFilters.text_excludes, liveExclude]);
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
  const bugreportLogSearchPattern = useMemo(
    () => {
      const liveInclude = bugreportLogFilterKind === "include" ? bugreportLogLiveFilter.trim() : "";
      const patterns = [
        ...sharedLogTextChips
          .filter((chip) => chip.kind === "include")
          .map((chip) => chip.value.trim())
          .filter(Boolean),
        liveInclude,
      ].filter(Boolean);
      const valid = patterns.filter((pattern) => {
        try {
          // eslint-disable-next-line no-new
          new RegExp(pattern, "i");
          return true;
        } catch {
          return false;
        }
      });
      if (valid.length === 0) {
        return null;
      }
      const combined = valid.map((pattern) => `(?:${pattern})`).join("|");
      return buildSearchRegex(combined, { caseSensitive: false, regex: true });
    },
    [bugreportLogFilterKind, bugreportLogLiveFilter, sharedLogTextChips],
  );
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
      selection_count: selectedSerials.length,
    };
  }, [activeSerial, files, filesOverwriteEnabled, filesPath, location.pathname, selectedSerials]);

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

  const handleSetDeviceSelectionMode = (mode: DeviceSelectionMode) => {
    setDeviceSelectionMode(mode);
    if (mode === "single") {
      setSelectedSerials((prev) => (prev.length > 0 ? [prev[0]] : []));
    }
  };

  const handleSelectActiveSerial = (serial: string) => {
    setSelectedSerials((prev) => {
      if (prev[0] === serial) {
        return prev;
      }
      const others = prev.filter((s) => s !== serial);
      return [serial, ...others];
    });
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
        dispatchTasks({ type: "TASK_SET_ALL", items: inflated.items, max_items: inflated.max_items });
      } catch (error) {
        console.warn("Failed to load Task Center state from storage.", error);
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

  const logcatFiltered = useMemo(
    () => {
      const liveInclude = logcatTextKind === "include" ? logcatLiveFilter : "";
      const liveExclude = logcatTextKind === "exclude" ? logcatLiveFilter : "";

      return filterLogcatEntries(rawLogcatLines, {
        levels: logLevels,
        activePatterns: sharedLogRegexFilters.text_terms,
        excludePatterns: [...sharedLogRegexFilters.text_excludes, liveExclude].filter(Boolean),
        livePattern: liveInclude,
        searchTerm: logcatSearchTerm,
        searchCaseSensitive: logcatSearchCaseSensitive,
        searchRegex: logcatSearchRegex,
        searchOnly: logcatSearchOnly,
      });
    },
    [
      rawLogcatLines,
      logLevels,
      logcatLiveFilter,
      logcatTextKind,
      sharedLogRegexFilters.text_terms,
      sharedLogRegexFilters.text_excludes,
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
        setFilteredUiXml(uiXml);
        return;
      }
      const next = uiXml
        .split("\n")
        .filter((line) => line.toLowerCase().includes(query))
        .join("\n");
      setFilteredUiXml(next);
    }, delay);
    return () => window.clearTimeout(handle);
  }, [uiXml, uiInspectorSearch]);

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
    if (selectedSerials.length !== 1 || !activeSerial) {
      setUiAutoSyncEnabled(false);
      return;
    }

    const serial = activeSerial;
    const intervalMs = Math.max(250, uiAutoSyncIntervalMs);
    const token = uiAutoSyncTokenRef.current + 1;
    uiAutoSyncTokenRef.current = token;
    let stopped = false;

    const runOnce = async () => {
      try {
        const response = await captureUiHierarchy(serial);
        if (stopped || uiAutoSyncTokenRef.current !== token) {
          return;
        }
        setUiHtml(response.data.html);
        setUiXml(response.data.xml);
        setUiScreenshotDataUrl(response.data.screenshot_data_url ?? "");
        setUiScreenshotError(response.data.screenshot_error ?? "");
        setUiAutoSyncError("");
        setUiAutoSyncLastAt(Date.now());
      } catch (error) {
        if (stopped || uiAutoSyncTokenRef.current !== token) {
          return;
        }
        setUiAutoSyncError(formatError(error));
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
    };
  }, [activeSerial, isUiInspectorView, selectedSerials.length, uiAutoSyncEnabled, uiAutoSyncIntervalMs]);

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
    if (!selectedSerials.length) {
      pushToast(`Select one device for ${context}.`, "error");
      return null;
    }
    if (selectedSerials.length > 1) {
      pushToast(`${context} supports only one device.`, "error");
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
    const handleScroll = () => setAppsContextMenu(null);
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeviceContextMenu(null);
      }
    };
    const handleScroll = () => setDeviceContextMenu(null);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [deviceContextMenu]);

  useEffect(() => {
    if (!deviceCommandMenu) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeviceCommandMenu(null);
      }
    };
    const handleScroll = () => setDeviceCommandMenu(null);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [deviceCommandMenu]);

  useEffect(() => {
    if (!filesContextMenu) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFilesContextMenu(null);
      }
    };
    const handleScroll = () => setFilesContextMenu(null);
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
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  };

  const pushToastRef = useRef(pushToast);
  useEffect(() => {
    pushToastRef.current = pushToast;
  }, [pushToast]);

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
    if (task.status === "cancelled" && !settings.desktop_on_cancelled) {
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
    });

    prevTaskItemsRef.current = next;
  }, [taskState.items]);

  const refreshDeviceDetails = async (options: { notifyOnError?: boolean } = {}) => {
    const refreshId = ++detailRefreshSeqRef.current;
    try {
      const response = await listDevices(true);
      if (refreshId !== detailRefreshSeqRef.current) {
        return;
      }
      setDevices((prev) => mergeDeviceDetails(prev, response.data, { preserveMissingDetail: true }));
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

  const applyDeviceTrackingSnapshot = (nextDevices: DeviceInfo[], options: { allowDetailRefresh: boolean }) => {
    const prevBySerial = new Map(
      devicesRef.current.map((device) => [device.summary.serial, device.summary.state] as const),
    );
    const nextBySerial = new Map(
      nextDevices.map((device) => [device.summary.serial, device.summary.state] as const),
    );
    const serialsChanged =
      prevBySerial.size !== nextBySerial.size || Array.from(nextBySerial.keys()).some((serial) => !prevBySerial.has(serial));
    const statesChanged = Array.from(nextBySerial.entries()).some(([serial, state]) => prevBySerial.get(serial) !== state);
    const shouldRefreshDetail = serialsChanged || statesChanged;

    // Tracking snapshots contain summaries only; keep the last known detail to avoid UI flicker.
    setDevices((prev) => mergeDeviceDetails(prev, nextDevices, { preserveMissingDetail: true }));
    setSelectedSerials((prev) => resolveSelectedSerials(prev, nextDevices));
    if (options.allowDetailRefresh && shouldRefreshDetail) {
      scheduleDeviceDetailRefresh(800, { notifyOnError: false });
    }
  };

  const flushPendingDeviceTrackingSnapshot = (options: { allowDetailRefresh: boolean }) => {
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
      const response = await listDevices(false);
      setDevices((prev) => mergeDeviceDetails(prev, response.data, { preserveMissingDetail: true }));
      setSelectedSerials((prev) => resolveSelectedSerials(prev, response.data));
      scheduleDeviceDetailRefresh(800, { notifyOnError });
      deviceTrackingLastSnapshotAtRef.current = Date.now();
      deviceTrackingLastFallbackAtRef.current = Date.now();
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
      const adbResponse = await checkAdb();
      if (refreshId !== refreshSeqRef.current) {
        return;
      }
      setAdbInfo(adbResponse.data);
      if (!adbResponse.data.available) {
        setDevices([]);
        setSelectedSerials([]);
        return;
      }
      const response = await listDevices(false);
      if (refreshId !== refreshSeqRef.current) {
        return;
      }
      // listDevices(false) returns summaries only; keep the last known detail to avoid UI flicker.
      setDevices((prev) => mergeDeviceDetails(prev, response.data, { preserveMissingDetail: true }));
      setSelectedSerials((prev) => resolveSelectedSerials(prev, response.data));
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
    configRef.current = config;
  }, [config]);

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
	    if (!config?.device.auto_refresh_enabled) {
	      void stopDeviceTracking().catch(() => null);
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
      deviceTrackingLastFallbackAtRef.current = Date.now();
      if (busyRef.current) {
        deviceTrackingPendingSnapshotRef.current = nextDevices;
        return;
      }
      deviceTrackingPendingSnapshotRef.current = nextDevices;
      flushPendingDeviceTrackingSnapshot({ allowDetailRefresh: true });
	    });

    deviceTrackingStartedAtRef.current = Date.now();
    deviceTrackingLastSnapshotAtRef.current = 0;
    deviceTrackingLastFallbackAtRef.current = 0;
    void startDeviceTracking().catch((error) => warnThrottled(error, "Device tracking start failed."));
    void refreshDeviceSummaryOnce(false);
    return () => {
      void unlisten.then((unlisten) => unlisten());
      void stopDeviceTracking().catch(() => null);
    };
  }, [config?.device.auto_refresh_enabled, config?.device.refresh_interval]);

  useEffect(() => {
    if (!config?.device.auto_refresh_enabled) {
      return;
    }
    if (busy) {
      return;
    }
    flushPendingDeviceTrackingSnapshot({ allowDetailRefresh: true });
  }, [busy, config?.device.auto_refresh_enabled]);

  useEffect(() => {
    if (!config?.device.auto_refresh_enabled) {
      return;
    }

    const intervalMs = clampRefreshIntervalSec(config.device.refresh_interval) * 1000;
    const handle = window.setInterval(() => {
      if (!configRef.current?.device.auto_refresh_enabled) {
        return;
      }
      if (busyRef.current) {
        return;
      }
      if (deviceTrackingRestartInFlightRef.current) {
        return;
      }

      const now = Date.now();
      const lastSnapshotAt = deviceTrackingLastSnapshotAtRef.current;
      const lastFallbackAt = deviceTrackingLastFallbackAtRef.current;
      const startedAt = deviceTrackingStartedAtRef.current;
      const warmupMs = Math.max(3_000, intervalMs);
      const maxStartWaitMs = Math.max(10_000, intervalMs * 2);
      const staleWindowMs = Math.max(12_000, intervalMs * 3);

      if (now - startedAt < warmupMs) {
        return;
      }

      // `adb track-devices` does not emit periodic snapshots when the device list is unchanged.
      // We still keep a periodic fallback summary refresh for heartbeat recovery.
      if (lastSnapshotAt !== 0) {
        if (
          now - lastSnapshotAt >= staleWindowMs &&
          now - lastFallbackAt >= intervalMs
        ) {
          void refreshDeviceSummaryOnce(false);
          deviceTrackingLastFallbackAtRef.current = now;
        }
        return;
      }

      if (now - startedAt < maxStartWaitMs) {
        return;
      }

      deviceTrackingRestartInFlightRef.current = true;
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
          deviceTrackingLastFallbackAtRef.current = 0;
          void refreshDeviceSummaryOnce(false);
        } catch (error) {
          console.warn("Device tracking restart failed.", error);
        } finally {
          deviceTrackingRestartInFlightRef.current = false;
        }
      })();
    }, intervalMs);
    return () => window.clearInterval(handle);
  }, [config?.device.auto_refresh_enabled, config?.device.refresh_interval]);

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
    const stored = localStorage.getItem("logcat_presets");
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        const asStringArray = (value: unknown) => {
          if (!Array.isArray(value)) {
            return [];
          }
          return value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean);
        };

        const nextPresets: LogcatFilterPreset[] = [];
        parsed.forEach((item) => {
          if (!item || typeof item !== "object") {
            return;
          }
          const record = item as Record<string, unknown>;
          const name = typeof record.name === "string" ? record.name.trim() : "";
          if (!name) {
            return;
          }

          let include = asStringArray(record.include).slice(0, 50);
          let exclude = asStringArray(record.exclude).slice(0, 50);

          const legacyPatterns = asStringArray(record.patterns).slice(0, 50);
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

          nextPresets.push({
            name,
            include,
            exclude,
            ...(levels ? { levels } : {}),
          });
        });

        setLogcatPresets(nextPresets);
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
      if (payload.error) {
        const prevError = perfBySerialRef.current[payload.serial]?.lastError ?? null;
        if (payload.error !== prevError) {
          pushToast(payload.error, "error");
        }
      }

      setPerfBySerial((prev) => {
        const existing =
          prev[payload.serial] ??
          ({
            running: false,
            traceId: null,
            samples: [],
            lastError: null,
          } satisfies PerfMonitorState);

        const nextSamples = payload.snapshot
          ? [...existing.samples, payload.snapshot].slice(-60)
          : existing.samples;

        return {
          ...prev,
          [payload.serial]: {
            ...existing,
            traceId: payload.trace_id || existing.traceId,
            samples: nextSamples,
            lastError: payload.error ?? (payload.snapshot ? null : existing.lastError),
          },
        };
      });
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

      setNetBySerial((prev) => {
        const existing =
          prev[payload.serial] ??
          ({
            running: false,
            traceId: null,
            samples: [],
            lastError: null,
          } satisfies NetProfilerState);

        const nextSamples = unsupported
          ? []
          : payload.snapshot
            ? [...existing.samples, payload.snapshot].slice(-NET_PROFILER_MAX_SAMPLES)
            : existing.samples;

        return {
          ...prev,
          [payload.serial]: {
            ...existing,
            running: unsupported ? false : existing.running,
            traceId: payload.trace_id || existing.traceId,
            samples: nextSamples,
            lastError: payload.error ?? (payload.snapshot ? null : existing.lastError),
          },
        };
      });
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

      if (payload.event === "start") {
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial,
          patch: { status: "running", progress: null, message: payload.message ?? "Installing..." },
        });
        return;
      }

      if (payload.event === "complete") {
        const status: TaskStatus = payload.success === true ? "success" : "error";
        const message =
          payload.success === true
            ? payload.message ?? "Installed."
            : payload.raw_output ?? payload.message ?? payload.error_code ?? "Install failed.";
        dispatchTasks({
          type: "TASK_UPDATE_DEVICE",
          id: taskId,
          serial,
          patch: { status, progress: null, message },
        });
      }
    });
    const unlistenBugreportProgress = listen<BugreportProgress>("bugreport-progress", (event) => {
      const payload = event.payload;
      if (!activeSerial || payload.serial === activeSerial) {
        setBugreportProgress(payload.progress);
      }
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
        setBugreportProgress(payload.result.progress ?? null);
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
      void unlistenNetProfiler.then((unlisten) => unlisten());
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

  useEffect(() => {
    if (groupFilter !== "all" && !groupOptions.includes(groupFilter)) {
      setGroupFilter("all");
    }
  }, [groupFilter, groupOptions]);

  const visibleDevices = useMemo(() => {
    const bySearch = filterDevicesBySearch(devices, searchText);
    if (groupFilter === "all") {
      return bySearch;
    }
    return bySearch.filter((device) => groupMap[device.summary.serial] === groupFilter);
  }, [devices, groupFilter, groupMap, searchText]);

  const applyGroupSelectionPreset = (group: string) => {
    const next = selectSerialsForGroup(devices, groupMap, group);
    setSelectedSerials(deviceSelectionMode === "single" ? (next.length ? [next[0]] : []) : next);
    lastSelectedIndexRef.current = null;
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
      const response = await setWifiState(selectedSerials, enable);
      const successes = response.data.filter((item) => item.exit_code === 0).map((item) => item.serial);
      const failures = response.data.filter((item) => item.exit_code !== 0);
      if (successes.length) {
        setDevices((prev) => applyDeviceDetailPatch(prev, successes, { wifi_is_on: enable }));
        scheduleDeviceDetailRefresh(800, { notifyOnError: false });
      }
      if (failures.length) {
        pushToast(`WiFi ${enable ? "enable" : "disable"} failed for ${failures.length} device(s).`, "error");
      } else {
        pushToast(enable ? "WiFi enabled." : "WiFi disabled.", "info");
      }
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
      const response = await setBluetoothState(selectedSerials, enable);
      const successes = response.data.filter((item) => item.exit_code === 0).map((item) => item.serial);
      const failures = response.data.filter((item) => item.exit_code !== 0);
      if (successes.length) {
        setDevices((prev) => applyDeviceDetailPatch(prev, successes, { bt_is_on: enable }));
        scheduleDeviceDetailRefresh(800, { notifyOnError: false });
      }
      if (failures.length) {
        pushToast(
          `Bluetooth ${enable ? "enable" : "disable"} failed for ${failures.length} device(s).`,
          "error",
        );
      } else {
        pushToast(enable ? "Bluetooth enabled." : "Bluetooth disabled.", "info");
      }
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

    const serials = Array.from(new Set(selectedSerials));

    setApkInstallSummary([]);
    setBusy(true);
    try {
      const summaries: string[] = [];
      for (const path of paths) {
        const name = path.split(/[/\\\\]/).pop() ?? path;
        const taskId = beginTask({
          kind: "apk_install",
          title: `APK Install: ${name}`,
          serials,
        });
        setLatestApkInstallTaskId(taskId);
        const traceId = crypto.randomUUID();
        dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: traceId });
        apkInstallTaskByTraceIdRef.current[traceId] = taskId;
        serials.forEach((serial) => {
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial,
            patch: { status: "running", progress: null, message: "Installing..." },
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
                progress: null,
                message: item.success ? "Installed." : item.raw_output || item.error_code,
              },
            });
          });
          const hasError = results.some((item) => !item.success);
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: hasError ? "error" : "success" });
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
        }
      }
      setApkInstallSummary(summaries);
      pushToast("APK install completed.", "info");

      if (apkLaunchAfterInstall) {
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
    }
  };

	  const handleBugreport = async () => {
	    if (!selectedSerials.length) {
	      pushToast("Select at least one device for bugreport.", "error");
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
	    const serials = Array.from(new Set(selectedSerials));
	    const taskId = beginTask({
	      kind: "bugreport",
	      title: `Bugreport (${serials.length})`,
	      serials,
	    });
	    setLatestBugreportTaskId(taskId);
	    setBugreportResult(null);
	    serials.forEach((serial) => {
	      dispatchTasks({
	        type: "TASK_UPDATE_DEVICE",
	        id: taskId,
	        serial,
	        patch: { status: "running", progress: 0, message: "Starting bugreport…" },
	      });
	    });
	    setBusy(true);
	    setBugreportProgress(0);
	    try {
	      const results = await Promise.all(
	        serials.map(async (serial) => {
	          try {
	            const response = await generateBugreport(serial, outputDir);
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
	        dispatchTasks({ type: "TASK_RECOMPUTE_STATUS", id: taskId });
	      });
	      pushToast(
	        failed.length
	          ? `Bugreport completed with ${failed.length} failures.`
	          : `Bugreport completed for ${serials.length} device${serials.length > 1 ? "s" : ""}.`,
	        failed.length ? "error" : "info",
	      );
	    } finally {
	      setBusy(false);
	    }
	  };

  const handleCancelBugreport = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device to cancel bugreport.", "error");
      return;
    }
	    const serials = [...selectedSerials];
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
	      pushToast("Bugreport cancel requested.", "info");
	    } catch (error) {
	      pushToast(formatError(error), "error");
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

  const saveLogcatPreset = () => {
    const name = logcatPresetName.trim();
    if (!name) {
      pushToast("Preset name is required.", "error");
      return;
    }

    const hasAnyFilters = sharedLogTextChips.length > 0;
    const hasLevelOverrides = LOG_LEVELS.some((level) => !logLevels[level]);
    if (!hasAnyFilters && !hasLevelOverrides) {
      pushToast("Preset must include at least one filter or a level override.", "error");
      return;
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

    setLogcatPresets((prev) => [...prev.filter((preset) => preset.name !== name), nextPreset]);
    setLogcatPresetName("");
    setLogcatPresetSelected(name);
    pushToast("Preset saved.", "info");
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
    setLogcatPresets((prev) => prev.filter((item) => item.name !== name));
    if (logcatPresetSelected === name) {
      setLogcatPresetSelected("");
    }
  };

  const handleLogcatStart = async () => {
    const serial = ensureSingleSelection("logcat");
    if (!serial) {
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
      await startLogcat(serial, filter || undefined);
      setLogcatActiveFilterSummary(filter || "All");
      pushToast("Logcat started.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatStop = async () => {
    const serial = ensureSingleSelection("logcat");
    if (!serial) {
      return;
    }
    setBusy(true);
    try {
      await stopLogcat(serial);
      pushToast("Logcat stopped.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatClearBuffer = async () => {
    const serial = ensureSingleSelection("logcat");
    if (!serial) {
      return;
    }
    setBusy(true);
    try {
      await clearLogcat(serial);
      setLogcatLines((prev) => ({ ...prev, [serial]: [] }));
      pushToast("Logcat buffer cleared.", "info");
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
    setLogcatLines((prev) => ({ ...prev, [serial]: [] }));
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

  const toggleLogcatAdvanced = () => {
    setLogcatAdvancedOpen((prev) => !prev);
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

  type FileKind = "folder" | "apk" | "image" | "archive" | "text" | "file";

  const getFileKind = (entry: DeviceFileEntry): FileKind => {
    if (entry.is_dir) {
      return "folder";
    }
    const lower = entry.name.toLowerCase();
    const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
    if (["apk", "apks", "xapk"].includes(ext)) {
      return "apk";
    }
    if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic"].includes(ext)) {
      return "image";
    }
    if (["zip", "tar", "gz", "tgz", "7z", "rar", "bz2", "xz"].includes(ext)) {
      return "archive";
    }
    if (["txt", "log", "json", "xml", "md", "csv", "yaml", "yml"].includes(ext)) {
      return "text";
    }
    return "file";
  };

  const getFileKindLabel = (kind: FileKind) => {
    if (kind === "folder") {
      return "Folder";
    }
    if (kind === "apk") {
      return "APK";
    }
    if (kind === "image") {
      return "Image";
    }
    if (kind === "archive") {
      return "Archive";
    }
    if (kind === "text") {
      return "Text";
    }
    return "File";
  };

  const FileTypeIcon = ({ kind }: { kind: FileKind }) => {
    if (kind === "folder") {
      return (
        <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 4.5h3.9l1.2 1.2H13.5c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1V5.5c0-.6.4-1 1-1Z"
            fill="currentColor"
            opacity="0.9"
          />
          <path
            d="M1.5 6h13"
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        </svg>
      );
    }

    if (kind === "image") {
      return (
        <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.3" y="3" width="11.4" height="10" rx="2" fill="currentColor" opacity="0.25" />
          <path
            d="M4 11.2 6.2 8.8 8.1 10.7 10.1 8.5 12.3 11.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx="6" cy="6.3" r="1" fill="currentColor" opacity="0.85" />
        </svg>
      );
    }

    if (kind === "archive") {
      return (
        <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="3.2" width="10" height="9.6" rx="2" fill="currentColor" opacity="0.25" />
          <path
            d="M6.2 4.7h3.6M6.2 6.3h3.6M7.8 7.9v4.1"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d="M7.2 9.1h1.2"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.5"
          />
        </svg>
      );
    }

    if (kind === "text") {
      return (
        <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 2.5h5l3 3V13c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V3.5c0-.6.4-1 1-1Z"
            fill="currentColor"
            opacity="0.22"
          />
          <path
            d="M9 2.6V6h3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d="M5.1 7.6h6M5.1 9.4h6M5.1 11.2h4.2"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.7"
          />
        </svg>
      );
    }

    if (kind === "apk") {
      return (
        <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5" y="2.7" width="6" height="10.6" rx="1.4" fill="currentColor" opacity="0.25" />
          <path
            d="M6.7 4.4h2.6"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.85"
          />
          <path
            d="M6.8 12h2.4"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.6"
          />
        </svg>
      );
    }

    return (
      <svg className={`file-type-icon kind-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4 2.5h5l3 3V13c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V3.5c0-.6.4-1 1-1Z"
          fill="currentColor"
          opacity="0.22"
        />
        <path
          d="M9 2.6V6h3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>
    );
  };

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
          const response = await pullDeviceFile(serial, entry.path, outputDir, traceId);
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
      const response = await mkdirDeviceDir(serial, targetDir);
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
      const response = await renameDevicePath(serial, fromPath, toPath);
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
      const response = await deleteDevicePath(serial, filesModal.entry.path, filesModal.recursive);
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
          const response = await deleteDevicePath(serial, entry.path, filesModal.recursive);
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
      const response = await pushDeviceFile(serial, selected, remotePath, traceId);
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
        if (filesCtx.selection_count !== 1 || !filesCtx.serial) {
          pushToast("Select one device for file upload.", "error");
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
                const response = await pushDeviceFile(filesCtx.serial, path, remotePath, traceId);
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
		      const response = await pullDeviceFile(serial, entry.path, outputDir, traceId);
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
          const response = await pullDeviceFile(serial, entry.path, outputDir, traceId);
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
    setBusy(true);
    try {
      const response = await captureUiHierarchy(serial);
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
    setBusy(true);
    try {
      const response = await exportUiHierarchy(serial, config?.file_gen_output_path || config?.output_path);
      setUiExportResult(response.data.html_path);
      pushToast("UI inspector export completed.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLoadApps = async () => {
    const serial = ensureSingleSelection("app list");
    if (!serial) {
      return;
    }
    setBusy(true);
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
    }
  };

  const getAppDisplayName = (packageName: string) => {
    const trimmed = packageName.trim();
    if (!trimmed) {
      return "(unknown)";
    }
    const last = trimmed.split(".").filter(Boolean).pop() ?? trimmed;
    const normalized = last.replace(/[_-]+/g, " ").trim();
    const words = normalized
      .split(" ")
      .filter(Boolean)
      .slice(0, 3)
      .map((word) => {
        const lower = word.toLowerCase();
        return lower.length ? lower[0].toUpperCase() + lower.slice(1) : lower;
      });
    const candidate = words.join(" ").trim();
    return candidate || trimmed;
  };

  const getAppAvatarLetters = (packageName: string) => {
    const label = getAppDisplayName(packageName);
    const parts = label.split(" ").filter(Boolean);
    const first = parts[0]?.[0] ?? label[0] ?? "A";
    const second = parts.length > 1 ? parts[1]?.[0] : undefined;
    const letters = `${first}${second ?? ""}`.toUpperCase();
    return letters.slice(0, 2);
  };

  const getStableToneIndex = (value: string) => {
    let sum = 0;
    for (let i = 0; i < value.length; i += 1) {
      sum = (sum + value.charCodeAt(i) * (i + 1)) % 1_000_000;
    }
    return sum % 6;
  };

  const appsSerial = selectedSerials.length === 1 ? selectedSerials[0] : null;
  const getAppIconKey = (serial: string, packageName: string) => `${serial}::${packageName}`;

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
    if (singleSelectionWarning) {
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
  }, [location.pathname, appsSerial, appsThirdPartyOnly, appsIncludeVersions, apps.length, busy, singleSelectionWarning]);

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

  const handleAppAction = async (action: "uninstall" | "forceStop" | "clear" | "enable" | "disable" | "info") => {
    const serial = ensureSingleSelection("app management");
    if (!serial || !selectedApp) {
      pushToast("Select an app.", "error");
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
    setBusy(true);
    try {
      let availability = scrcpyInfo;
      if (!availability?.available) {
        const response = await checkScrcpy();
        availability = response.data;
        setScrcpyInfo(response.data);
      }
      if (!availability?.available) {
        pushToast("scrcpy is not available.", "error");
        return;
      }
      const response = await launchScrcpy(selectedSerials);
      const failures = response.data.filter((item) => item.exit_code !== 0);
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
    const outputDir = (config?.output_path ?? "").trim();
    if (!outputDir) {
      pushToast("Set an output folder in Settings to save screenshots.", "error");
      return;
    }

    setBusy(true);
    try {
      const serials = Array.from(new Set(selectedSerials));
      const taskId = beginTask({
        kind: "screenshot",
        title: `Screenshot (${serials.length})`,
        serials,
      });
      let hasError = false;
      let traceSet = false;
      await Promise.all(
        serials.map(async (serial) => {
          try {
            const response = await captureScreenshot(serial, outputDir);
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
      pushToast(
        hasError ? "Screenshot completed with errors. Check Task Center." : "Screenshot completed. Check Task Center.",
        hasError ? "error" : "info",
      );
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleQuickScreenRecord = async () => {
    const singleSerial = ensureSingleSelection("screen recording");
    if (!singleSerial) {
      return;
    }

    setBusy(true);
    try {
      if (screenRecordRemote) {
        const outputDir = (config?.output_path ?? "").trim() || undefined;
        const taskId = beginTask({
          kind: "screen_record_stop",
          title: `Screen Record Stop: ${singleSerial}`,
          serials: [singleSerial],
        });
        try {
          const response = await stopScreenRecord(singleSerial, outputDir);
          const savedPath = response.data?.trim();
          setScreenRecordRemote(null);
          dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial: singleSerial,
            patch: {
              status: "success",
              output_path: savedPath || null,
              message: savedPath ? `Saved to ${savedPath}` : "Stopped (no output folder configured).",
            },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
          pushToast(savedPath ? `Recording saved to ${savedPath}` : "Screen recording stopped.", "info");
        } catch (error) {
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial: singleSerial,
            patch: { status: "error", message: formatError(error) },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
          throw error;
        }
      } else {
        const taskId = beginTask({
          kind: "screen_record_start",
          title: `Screen Record Start: ${singleSerial}`,
          serials: [singleSerial],
        });
        try {
          const response = await startScreenRecord(singleSerial);
          setScreenRecordRemote(response.data);
          dispatchTasks({ type: "TASK_SET_TRACE", id: taskId, trace_id: response.trace_id });
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial: singleSerial,
            patch: { status: "success", message: `Remote: ${response.data}` },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "success" });
          pushToast("Screen recording started.", "info");
        } catch (error) {
          dispatchTasks({
            type: "TASK_UPDATE_DEVICE",
            id: taskId,
            serial: singleSerial,
            patch: { status: "error", message: formatError(error) },
          });
          dispatchTasks({ type: "TASK_SET_STATUS", id: taskId, status: "error" });
          throw error;
        }
      }
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleQuickLogcatClear = async () => {
    const singleSerial = ensureSingleSelection("logcat clear");
    if (!singleSerial) {
      return;
    }
    setBusy(true);
    try {
      await clearLogcat(singleSerial);
      setLogcatLines((prev) => ({ ...prev, [singleSerial]: [] }));
      pushToast("Logcat cleared.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReboot = async () => {
    closeRebootConfirm();
    await handleReboot(rebootConfirmMode === "normal" ? undefined : rebootConfirmMode);
  };

  const handleBluetoothMonitor = async (enable: boolean) => {
    const serial = ensureSingleSelection("bluetooth monitor");
    if (!serial) {
      return false;
    }
    setBusy(true);
    try {
      if (enable) {
        await startBluetoothMonitor(serial);
      } else {
        await stopBluetoothMonitor(serial);
      }
      pushToast(enable ? "Bluetooth monitor started." : "Bluetooth monitor stopped.", "info");
      return true;
    } catch (error) {
      pushToast(formatError(error), "error");
      return false;
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

  const runBugreportLogQuery = async (reportId: string, offset: number, append: boolean) => {
    const requestId = bugreportLogRequestRef.current + 1;
    bugreportLogRequestRef.current = requestId;
    setBugreportLogBusy(true);
    setBugreportLogError(null);
    try {
      const response = await queryBugreportLogcat(reportId, bugreportLogFilters, offset, 200);
      if (bugreportLogRequestRef.current !== requestId) {
        return;
      }
      setBugreportLogRows((prev) => (append ? [...prev, ...response.data.rows] : response.data.rows));
      setBugreportLogHasMore(response.data.has_more);
      setBugreportLogOffset(response.data.next_offset);
      if (!append) {
        setBugreportLogContextAnchorId(null);
      }
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

  const runBugreportLogAround = async (reportId: string, anchorId: number) => {
    const requestId = bugreportLogRequestRef.current + 1;
    bugreportLogRequestRef.current = requestId;
    bugreportLogLoadAllTokenRef.current += 1;
    setBugreportLogLoadAllRunning(false);
    setBugreportLogBusy(true);
    setBugreportLogError(null);
    try {
      const response = await queryBugreportLogcatAround(reportId, anchorId, bugreportLogFilters, 200, 200);
      if (bugreportLogRequestRef.current !== requestId) {
        return;
      }
      setBugreportLogRows(response.data.rows);
      setBugreportLogHasMore(false);
      setBugreportLogOffset(0);
      setBugreportLogContextAnchorId(anchorId);
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

  const handleBugreportLogBackToList = () => {
    setBugreportLogContextAnchorId(null);
    if (bugreportLogSummary) {
      void runBugreportLogQuery(bugreportLogSummary.report_id, 0, false);
    }
  };

  const handleBugreportLogSearch = async () => {
    if (!bugreportLogSummary) {
      pushToast("Load a bugreport first.", "error");
      return;
    }
    const term = bugreportLogSearchTerm.trim();
    if (!term) {
      pushToast("Enter a search query.", "error");
      return;
    }

    const requestId = bugreportLogSearchRequestRef.current + 1;
    bugreportLogSearchRequestRef.current = requestId;
    setBugreportLogLastSearchTerm(term);
    setBugreportLogMatches([]);
    setBugreportLogMatchesTruncated(false);
    setBugreportLogMatchIndex(-1);
    setBugreportLogMatchesOpen(false);
    setBugreportLogBusy(true);
    setBugreportLogError(null);
    try {
      const response = await searchBugreportLogcat(bugreportLogSummary.report_id, term, bugreportLogFilters, 200);
      if (bugreportLogSearchRequestRef.current !== requestId) {
        return;
      }
      setBugreportLogMatches(response.data.matches);
      setBugreportLogMatchesTruncated(response.data.truncated);
      setBugreportLogMatchIndex(response.data.matches.length ? 0 : -1);
    } catch (error) {
      if (bugreportLogSearchRequestRef.current !== requestId) {
        return;
      }
      const message = formatError(error);
      setBugreportLogError(message);
      pushToast(message, "error");
    } finally {
      if (bugreportLogSearchRequestRef.current === requestId) {
        setBugreportLogBusy(false);
      }
    }
  };

  const openBugreportLogMatch = (index: number) => {
    if (!bugreportLogSummary) {
      return;
    }
    if (bugreportLogMatches.length === 0) {
      return;
    }
    const normalized =
      ((index % bugreportLogMatches.length) + bugreportLogMatches.length) % bugreportLogMatches.length;
    const match = bugreportLogMatches[normalized];
    if (!match) {
      return;
    }
    setBugreportLogMatchIndex(normalized);
    void runBugreportLogAround(bugreportLogSummary.report_id, match.id);
  };

  const moveBugreportLogMatch = (delta: number) => {
    if (bugreportLogMatches.length === 0) {
      return;
    }
    if (bugreportLogMatchIndex < 0) {
      openBugreportLogMatch(delta < 0 ? bugreportLogMatches.length - 1 : 0);
      return;
    }
    openBugreportLogMatch(bugreportLogMatchIndex + delta);
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
    setBugreportLogRows([]);
    setBugreportLogHasMore(false);
    setBugreportLogOffset(0);
    setBugreportLogBuffer("");
    setBugreportLogSearchTerm("");
    setBugreportLogLastSearchTerm("");
    setBugreportLogMatches([]);
    setBugreportLogMatchesTruncated(false);
    setBugreportLogMatchIndex(-1);
    setBugreportLogMatchesOpen(false);
    setBugreportLogContextAnchorId(null);

    setBugreportLogBusy(true);
    setBugreportLogError(null);
    try {
      const response = await prepareBugreportLogcat(sourcePath);
      setBugreportLogSummary(response.data);
    } catch (error) {
      const message = formatError(error);
      setBugreportLogError(message);
      pushToast(message, "error");
    } finally {
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
    if (!bugreportLogSummary) {
      return;
    }
    if (!isBugreportLogViewer) {
      return;
    }
    if (bugreportLogContextAnchorId != null) {
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
  }, [bugreportLogContextAnchorId, bugreportLogSummary, bugreportLogFilters]);

  useEffect(() => {
    if (bugreportLogContextAnchorId == null) {
      return;
    }
    // Changing filters should return the viewer back to the main list mode to avoid surprising output.
    setBugreportLogContextAnchorId(null);
  }, [bugreportLogFilters]);

  const handleBugreportLogLoadAll = async () => {
    if (!bugreportLogSummary || bugreportLogBusy || bugreportLogContextAnchorId != null) {
      return;
    }

    const token = bugreportLogLoadAllTokenRef.current + 1;
    bugreportLogLoadAllTokenRef.current = token;
    setBugreportLogLoadAllRunning(true);

    const reportId = bugreportLogSummary.report_id;
    const pageSize = 2000;
    let offset = 0;
    let hasMore = true;

    try {
      while (hasMore && bugreportLogLoadAllTokenRef.current === token) {
        const response = await queryBugreportLogcat(reportId, bugreportLogFilters, offset, pageSize);
        if (bugreportLogLoadAllTokenRef.current !== token) {
          return;
        }
        setBugreportLogRows((prev) => (offset === 0 ? response.data.rows : [...prev, ...response.data.rows]));
        setBugreportLogHasMore(response.data.has_more);
        setBugreportLogOffset(response.data.next_offset);
        hasMore = response.data.has_more;
        offset = response.data.next_offset;

        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
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

  const handleCopyDeviceInfoSpecific = async (serial: string) => {
    const device = devices.find((item) => item.summary.serial === serial);
    if (!device) {
      return;
    }
    try {
      await writeText(formatDeviceInfoMarkdown(device));
      pushToast("Device info copied.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const handleCopyDeviceInfo = async () => {
    const serial = ensureSingleSelection("device info copy");
    if (!serial) {
      return;
    }
    const device = devices.find((item) => item.summary.serial === serial);
    if (!device) {
      return;
    }
    try {
      await writeText(formatDeviceInfoMarkdown(device));
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

  const dashboardActions: Array<{
    id: DashboardActionId;
    title: string;
    description: string;
    hint?: string;
    tone?: "primary";
    onClick: () => void;
    disabled: boolean;
  }> = [
    {
      id: "screenshot",
      title: "Screenshot",
      description: "Capture screenshots from selected devices.",
      hint: "Multi-device",
      tone: "primary",
      onClick: handleQuickScreenshot,
      disabled: busy || selectedSerials.length === 0,
    },
    {
      id: "reboot",
      title: "Reboot",
      description: "Restart selected devices.",
      hint: "Multi-device",
      onClick: requestRebootConfirm,
      disabled: busy || selectedSerials.length === 0,
    },
    {
      id: "record",
      title: screenRecordRemote ? "Stop Recording" : "Start Recording",
      description: screenRecordRemote
        ? "Finish and save the ongoing screen recording."
        : "Record the device screen for a short clip.",
      hint: "Single device",
      tone: "primary",
      onClick: handleQuickScreenRecord,
      disabled: busy || selectedSerials.length !== 1,
    },
    {
      id: "logcat-clear",
      title: "Clear Logcat",
      description: "Clear the logcat buffer for the primary device.",
      hint: "Primary device",
      onClick: handleQuickLogcatClear,
      disabled: busy || selectedSerials.length !== 1,
    },
    {
      id: "mirror",
      title: "Live Mirror",
      description: scrcpyInfo?.available
        ? "Launch scrcpy for a live mirror window."
        : "Install scrcpy to enable live mirroring.",
      hint: "Multi-device",
      tone: "primary",
      onClick: handleScrcpyLaunch,
      disabled: busy || selectedSerials.length === 0,
    },
    {
      id: "apk-installer",
      title: "APK Installer",
      description: "Install single, multiple, or split APK bundles.",
      hint: "Installer flow",
      onClick: () => navigate("/apk-installer"),
      disabled: busy,
    },
  ];

  const dashboardActionGroups = [
    {
      id: "capture",
      title: "Capture",
      description: "Screenshots and recordings.",
      actionIds: ["screenshot", "record"],
    },
    {
      id: "control",
      title: "Control",
      description: "Device control and mirroring.",
      actionIds: ["reboot", "mirror"],
    },
    {
      id: "debug",
      title: "Debug",
      description: "Logcat and diagnostics.",
      actionIds: ["logcat-clear"],
    },
    {
      id: "install",
      title: "Install",
      description: "APK bundles and packages.",
      actionIds: ["apk-installer"],
    },
  ];

  const DashboardView = () => {
    const detail = activeDevice?.detail;
    const deviceName =
      detail?.model ?? activeDevice?.summary.model ?? activeSerial ?? "No device selected";
    const deviceState = activeDevice?.summary.state ?? "No device";
    const deviceStateTone =
      deviceState === "device"
        ? "ok"
        : deviceState === "unauthorized"
          ? "error"
          : deviceState === "offline"
            ? "warn"
            : "idle";
    const wifiState =
      detail?.wifi_is_on == null ? "Unknown" : detail.wifi_is_on ? "On" : "Off";
    const btState =
      detail?.bt_is_on == null ? "Unknown" : detail.bt_is_on ? "On" : "Off";
    const wifiLabel =
      detail?.wifi_is_on == null ? "WiFi Unknown" : detail.wifi_is_on ? "WiFi On" : "WiFi Off";
    const btLabel =
      detail?.bt_is_on == null
        ? "Bluetooth Unknown"
        : detail.bt_is_on
          ? "Bluetooth On"
          : "Bluetooth Off";

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
        <div className="page-section dashboard-page">
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
      <div className="page-section dashboard-page">
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
          <section className="panel card dashboard-hero">
            <div className="card-header">
              <div>
                <h2>Primary Device</h2>
                <p className="muted">Health, context, and selection.</p>
              </div>
              <div className="device-hero-status">
                <span className={`status-pill ${deviceStateTone}`}>{deviceState}</span>
                <span className="badge">
                  {selectedSerials.length ? `${selectedSerials.length} selected` : "No selection"}
                </span>
              </div>
            </div>
            <div className="device-hero">
              <div className="device-hero-main">
                <p className="eyebrow">Primary Device</p>
                <strong>{deviceName}</strong>
                <p className="muted">{activeSerial ?? "Select a device"}</p>
                <div className="device-hero-tags">
                  <span className="badge">{wifiLabel}</span>
                  <span className="badge">{btLabel}</span>
                  <span className="badge">
                    {scrcpyInfo?.available ? "scrcpy Ready" : "scrcpy Missing"}
                  </span>
                </div>
              </div>
              <div className="device-hero-actions">
                <button
                  className="ghost"
                  onClick={handleCopyDeviceInfo}
                  disabled={busy || selectedSerials.length !== 1}
                >
                  Copy Device Info
                </button>
                <button className="ghost" onClick={() => navigate("/devices")} disabled={busy}>
                  Open Device Manager
                </button>
              </div>
            </div>
            <div className="summary-grid summary-grid-hero">
              <div>
                <span className="muted">Name</span>
                <strong>{detail?.name ?? "--"}</strong>
              </div>
              <div>
                <span className="muted">Brand</span>
                <strong>{detail?.brand ?? "--"}</strong>
              </div>
              <div>
                <span className="muted">Model</span>
                <strong>{detail?.model ?? activeDevice?.summary.model ?? "--"}</strong>
              </div>
              <div>
                <span className="muted">Serial</span>
                <strong>{activeSerial ?? "--"}</strong>
              </div>
              <div>
                <span className="muted">Serial Number</span>
                <strong>{detail?.serial_number ?? "--"}</strong>
              </div>
              <div>
                <span className="muted">Android</span>
                <strong>{detail?.android_version ?? "--"}</strong>
              </div>
              <div>
                <span className="muted">API</span>
                <strong>{detail?.api_level ?? "--"}</strong>
              </div>
              <div>
                <span className="muted">Processor</span>
                <strong>{detail?.processor ?? "--"}</strong>
              </div>
              <div>
                <span className="muted">Resolution</span>
                <strong>{detail?.resolution ?? "--"}</strong>
              </div>
              <div>
                <span className="muted">Storage</span>
                <strong>
                  {detail?.storage_total_bytes != null
                    ? formatBytes(detail.storage_total_bytes)
                    : "--"}
                </strong>
              </div>
              <div>
                <span className="muted">Memory</span>
                <strong>
                  {detail?.memory_total_bytes != null
                    ? formatBytes(detail.memory_total_bytes)
                    : "--"}
                </strong>
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
          </section>

          <section className="panel card dashboard-actions">
            <div className="card-header">
              <div>
                <h2>Quick Actions</h2>
                <p className="muted">One-click actions using saved Settings defaults. Reboot still asks for confirmation.</p>
              </div>
              <span className="badge">
                {selectedSerials.length ? `${selectedSerials.length} devices` : "Select device"}
              </span>
            </div>
            {selectedSerials.length === 0 && (
              <div className="inline-alert info">
                <strong>Select a device</strong>
                <span className="muted">Use the device picker in the top bar to enable quick actions.</span>
              </div>
            )}
            <div className="quick-actions">
              {dashboardActionGroups.map((group) => (
                <div key={group.id} className="quick-action-group">
                  <div className="quick-action-group-header">
                    <div>
                      <h3>{group.title}</h3>
                      <p className="muted">{group.description}</p>
                    </div>
                    <span className="badge">{group.actionIds.length} actions</span>
                  </div>
                  <div className="quick-action-grid">
                    {group.actionIds.map((actionId) => {
                      const action = dashboardActions.find((item) => item.id === actionId);
                      if (!action) {
                        return null;
                      }
                      return (
                        <button
                          key={action.id}
                          className={`quick-action${action.tone === "primary" ? " is-primary" : ""}`}
                          onClick={action.onClick}
                          disabled={action.disabled}
                        >
                          <span className="quick-action-title">
                            <span>{action.title}</span>
                            {action.hint && <span className="quick-action-hint">{action.hint}</span>}
                          </span>
                          <span className="muted">{action.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel card dashboard-connection">
            <div className="card-header">
              <div>
                <h2>Connection Health</h2>
                <p className="muted">ADB, tasks, and scrcpy readiness.</p>
              </div>
              <span className={`status-pill ${adbInfo?.available ? "ok" : "warn"}`}>
                {adbInfo == null ? "Checking..." : adbInfo.available ? "Online" : "Offline"}
              </span>
            </div>
            <div className="status-list status-list-hero">
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

          <section className="panel card dashboard-recents">
            <div className="card-header">
              <div>
                <h2>Recent Apps</h2>
                <p className="muted">Quick access to recently loaded packages.</p>
              </div>
              <span className="badge">Quick access</span>
            </div>
            {apps.length === 0 ? (
              <div className="empty-inline">
                <p className="muted">No app list loaded yet.</p>
                <button
                  className="ghost"
                  onClick={handleLoadApps}
                  disabled={busy || selectedSerials.length !== 1}
                >
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
	          if (target?.closest(".device-check")) {
	            return;
	          }
	          // Row click sets primary; clicking the current primary again toggles it off.
	          if (isActive && isSelected) {
	            toggleDeviceInContextPopover(serial);
	            return;
	          }
	          if (deviceSelectionMode === "single") {
	            setSelectedSerials((prev) => (prev.length === 1 && prev[0] === serial ? prev : [serial]));
	            return;
	          }
	          handleSelectActiveSerial(serial);
	        }}
	        role="button"
	        tabIndex={0}
	        onKeyDown={(event) => {
	          const target = event.target as HTMLElement | null;
	          if (target?.closest(".device-check")) {
	            return;
	          }
	          if (event.key === "Enter" || event.key === " ") {
	            event.preventDefault();
	            if (isActive && isSelected) {
	              toggleDeviceInContextPopover(serial);
	              return;
	            }
	            if (deviceSelectionMode === "single") {
	              setSelectedSerials((prev) => (prev.length === 1 && prev[0] === serial ? prev : [serial]));
	              return;
	            }
	            handleSelectActiveSerial(serial);
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
        {isActive && <span className="device-active-badge">Primary</span>}
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

  const renderPerfSparkline = (values: number[]) => {
    const width = 220;
    const height = 44;
    const points = buildSparklinePoints(values, width, height);
    return (
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <polyline points={points} fill="none" />
      </svg>
    );
  };

  const renderNetTrendSparkline = (values: number[]) => {
    const width = 220;
    const height = 44;
    const points = buildSparklinePoints(values, width, height);
    return (
      <svg
        className="sparkline net-profiler-sparkline"
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        <polyline points={points} fill="none" />
      </svg>
    );
  };

  const NetProfilerLineChart = ({
    samples,
    focusUid,
    windowMs,
    pinnedUids,
    pinnedLabels,
  }: {
    samples: NetProfilerSnapshot[];
    focusUid: number | null;
    windowMs: number | null;
    pinnedUids: number[];
    pinnedLabels: Record<number, string>;
  }) => {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [hoverLeftPx, setHoverLeftPx] = useState<number>(0);
    const [zoomDomain, setZoomDomain] = useState<{ startTs: number; endTs: number } | null>(null);
    const [brushRange, setBrushRange] = useState<{ x0: number; x1: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<{
      pointerId: number;
      mode: "brush" | "pan";
      startXPx: number;
      lastXPx: number;
      startDomain: { startTs: number; endTs: number };
      rectWidth: number;
    } | null>(null);

    useEffect(() => {
      setZoomDomain(null);
      setBrushRange(null);
      dragRef.current = null;
      setIsDragging(false);
      setHoverIndex(null);
    }, [windowMs]);

    useEffect(() => {
      if (samples.length > 0) {
        return;
      }
      setZoomDomain(null);
      setBrushRange(null);
      dragRef.current = null;
      setIsDragging(false);
      setHoverIndex(null);
    }, [samples.length]);

    const liveSamples = useMemo(
      () => sliceSnapshotsByWindowMs(samples, windowMs),
      [samples, windowMs],
    );
    const chartSamples = useMemo(() => {
      if (!zoomDomain) {
        return liveSamples;
      }
      const start = Math.min(zoomDomain.startTs, zoomDomain.endTs);
      const end = Math.max(zoomDomain.startTs, zoomDomain.endTs);
      return liveSamples.filter((sample) => sample.ts_ms >= start && sample.ts_ms <= end);
    }, [liveSamples, zoomDomain]);
    const series = useMemo(
      () => extractNetSeries(chartSamples, focusUid),
      [chartSamples, focusUid],
    );

    const width = 720;
    const height = 180;
    const n = series.tsMs.length;
    const hasSeries = n >= 2;

    const pinnedTotalsSeries = useMemo(
      () =>
        pinnedUids.map((uid) =>
          chartSamples.map((sample) => {
            const row = sample.rows.find((candidate) => candidate.uid === uid) ?? null;
            const rx = row?.rx_bps ?? null;
            const tx = row?.tx_bps ?? null;
            return rx == null && tx == null ? null : (rx ?? 0) + (tx ?? 0);
          }),
        ),
      [chartSamples, pinnedUids],
    );

    const yMax = useMemo(() => {
      const values: number[] = [];
      series.rxBps.forEach((value) => {
        if (value != null && Number.isFinite(value)) {
          values.push(value);
        }
      });
      series.txBps.forEach((value) => {
        if (value != null && Number.isFinite(value)) {
          values.push(value);
        }
      });
      pinnedTotalsSeries.forEach((series) => {
        series.forEach((value) => {
          if (value != null && Number.isFinite(value)) {
            values.push(value);
          }
        });
      });
      return values.length ? Math.max(1, ...values) : 1;
    }, [pinnedTotalsSeries, series.rxBps, series.txBps]);

    const rxPath = useMemo(
      () => buildLinePath(series.rxBps, width, height, yMax),
      [series.rxBps, width, height, yMax],
    );
    const txPath = useMemo(
      () => buildLinePath(series.txBps, width, height, yMax),
      [series.txBps, width, height, yMax],
    );
    const pinnedPaths = useMemo(
      () =>
        pinnedTotalsSeries.map((values) => buildLinePath(values, width, height, yMax)),
      [pinnedTotalsSeries, width, height, yMax],
    );

    const hoverX = useMemo(() => {
      if (!hasSeries || hoverIndex == null || n <= 1) {
        return null;
      }
      const x = (hoverIndex / (n - 1)) * width;
      return Number.isFinite(x) ? x : null;
    }, [hasSeries, hoverIndex, n, width]);

    const hovered = useMemo(() => {
      if (!hasSeries || hoverIndex == null) {
        return null;
      }
      const tsMs = series.tsMs[hoverIndex] ?? null;
      const endTs = series.tsMs[n - 1] ?? null;
      const ageSeconds =
        tsMs != null && endTs != null
          ? Math.max(0, (endTs - tsMs) / 1000)
          : null;
      const rxBps = series.rxBps[hoverIndex] ?? null;
      const txBps = series.txBps[hoverIndex] ?? null;
      const totalBps =
        rxBps == null && txBps == null ? null : (rxBps ?? 0) + (txBps ?? 0);
      return { ageSeconds, rxBps, txBps, totalBps };
    }, [hasSeries, hoverIndex, n, series.rxBps, series.tsMs, series.txBps]);

    const globalMinTs = liveSamples[0]?.ts_ms ?? null;
    const globalMaxTs = liveSamples[liveSamples.length - 1]?.ts_ms ?? null;

    const clampDomain = (startTs: number, endTs: number) => {
      const minSpanMs = 1000;
      if (globalMinTs == null || globalMaxTs == null || globalMaxTs <= globalMinTs) {
        return { startTs, endTs };
      }

      let start = Math.min(startTs, endTs);
      let end = Math.max(startTs, endTs);
      const fullSpan = globalMaxTs - globalMinTs;
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return { startTs: globalMinTs, endTs: globalMaxTs };
      }

      if (end - start < minSpanMs) {
        const center = (start + end) / 2;
        start = center - minSpanMs / 2;
        end = center + minSpanMs / 2;
      }

      const span = Math.min(end - start, fullSpan);
      if (span <= 0) {
        return { startTs: globalMinTs, endTs: globalMaxTs };
      }

      if (start < globalMinTs) {
        start = globalMinTs;
        end = globalMinTs + span;
      }
      if (end > globalMaxTs) {
        end = globalMaxTs;
        start = globalMaxTs - span;
      }

      start = Math.max(globalMinTs, start);
      end = Math.min(globalMaxTs, end);
      return { startTs: Math.round(start), endTs: Math.round(end) };
    };

    const updateHoverFromClientX = (clientX: number) => {
      if (!svgRef.current || !hasSeries) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      if (!rect.width) {
        return;
      }
      const xPx = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, xPx / rect.width));
      const nextIndex = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
      setHoverIndex(nextIndex);
      const nextLeft = Math.min(Math.max(8, xPx + 12), rect.width - 190);
      setHoverLeftPx(Number.isFinite(nextLeft) ? nextLeft : 0);
    };

    const handlePointerDown = (event: ReactPointerEvent) => {
      if (!svgRef.current) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      if (!rect.width) {
        return;
      }

      const xPx = event.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, xPx / rect.width));
      const xSvg = ratio * width;

      const canPan = zoomDomain != null;
      const mode: "brush" | "pan" = event.shiftKey && canPan ? "pan" : "brush";

      const baseStartTs = series.tsMs[0] ?? null;
      const baseEndTs = series.tsMs[n - 1] ?? null;
      const startDomain =
        zoomDomain ?? (baseStartTs != null && baseEndTs != null ? { startTs: baseStartTs, endTs: baseEndTs } : null);

      if (!startDomain) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        mode,
        startXPx: xPx,
        lastXPx: xPx,
        startDomain,
        rectWidth: rect.width,
      };
      setIsDragging(true);
      setHoverIndex(null);
      if (mode === "brush") {
        setBrushRange({ x0: xSvg, x1: xSvg });
      } else {
        setBrushRange(null);
      }
    };

    const handlePointerMove = (event: ReactPointerEvent) => {
      const dragging = dragRef.current;
      if (!dragging || dragging.pointerId !== event.pointerId) {
        if (!isDragging) {
          updateHoverFromClientX(event.clientX);
        }
        return;
      }

      if (!svgRef.current) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      if (!rect.width) {
        return;
      }

      const xPx = event.clientX - rect.left;
      dragging.lastXPx = xPx;
      const ratio = Math.max(0, Math.min(1, xPx / rect.width));
      const xSvg = ratio * width;

      if (dragging.mode === "brush") {
        setBrushRange((prev) => {
          const x0 = prev?.x0 ?? xSvg;
          return { x0, x1: xSvg };
        });
        return;
      }

      const start = dragging.startDomain.startTs;
      const end = dragging.startDomain.endTs;
      const span = Math.abs(end - start);
      if (span <= 0) {
        return;
      }
      const dxPx = xPx - dragging.startXPx;
      const dtMs = (dxPx / dragging.rectWidth) * span;
      const next = clampDomain(start - dtMs, end - dtMs);
      setZoomDomain(next);
    };

    const finishDrag = (event: ReactPointerEvent) => {
      const dragging = dragRef.current;
      if (!dragging || dragging.pointerId !== event.pointerId) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      setIsDragging(false);

      if (!svgRef.current) {
        setBrushRange(null);
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      if (!rect.width) {
        setBrushRange(null);
        return;
      }

      const selectionPx = Math.abs(dragging.lastXPx - dragging.startXPx);
      if (dragging.mode !== "brush" || selectionPx < 8 || !hasSeries) {
        setBrushRange(null);
        updateHoverFromClientX(event.clientX);
        return;
      }

      const startPx = Math.min(dragging.startXPx, dragging.lastXPx);
      const endPx = Math.max(dragging.startXPx, dragging.lastXPx);
      const startRatio = Math.max(0, Math.min(1, startPx / rect.width));
      const endRatio = Math.max(0, Math.min(1, endPx / rect.width));
      const startIndex = Math.max(0, Math.min(n - 1, Math.floor(startRatio * (n - 1))));
      const endIndex = Math.max(0, Math.min(n - 1, Math.ceil(endRatio * (n - 1))));
      if (endIndex <= startIndex) {
        setBrushRange(null);
        return;
      }

      const startTs = series.tsMs[startIndex] ?? null;
      const endTs = series.tsMs[endIndex] ?? null;
      if (startTs == null || endTs == null || startTs === endTs) {
        setBrushRange(null);
        return;
      }

      setZoomDomain(clampDomain(startTs, endTs));
      setBrushRange(null);
      setHoverIndex(null);
    };

    const handlePointerLeave = () => {
      if (isDragging) {
        return;
      }
      setHoverIndex(null);
    };

    const handleWheel = (event: ReactWheelEvent) => {
      if (!svgRef.current || !hasSeries) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      if (!rect.width) {
        return;
      }

      event.preventDefault();

      const xPx = event.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, xPx / rect.width));
      const centerIndex = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
      const centerTs = series.tsMs[centerIndex] ?? null;
      const baseStartTs = series.tsMs[0] ?? null;
      const baseEndTs = series.tsMs[n - 1] ?? null;
      if (centerTs == null || baseStartTs == null || baseEndTs == null) {
        return;
      }

      const domain = zoomDomain ?? { startTs: baseStartTs, endTs: baseEndTs };
      const start = Math.min(domain.startTs, domain.endTs);
      const end = Math.max(domain.startTs, domain.endTs);
      const span = end - start;
      if (span <= 0) {
        return;
      }

      const factor = event.deltaY > 0 ? 1.2 : 0.85;
      const nextSpan = Math.max(1000, span * factor);
      const centerRatio = Math.max(0, Math.min(1, (centerTs - start) / span));
      const nextStart = centerTs - nextSpan * centerRatio;
      const nextEnd = nextStart + nextSpan;
      setZoomDomain(clampDomain(nextStart, nextEnd));
      setBrushRange(null);
      setHoverIndex(null);
    };

    const hoveredPins = useMemo(() => {
      if (!hasSeries || hoverIndex == null || pinnedUids.length === 0) {
        return [];
      }
      return pinnedUids.map((uid, index) => ({
        uid,
        index,
        label: pinnedLabels[uid] ?? `UID ${uid}`,
        totalBps: pinnedTotalsSeries[index]?.[hoverIndex] ?? null,
      }));
    }, [
      hasSeries,
      hoverIndex,
      pinnedLabels,
      pinnedTotalsSeries,
      pinnedUids,
    ]);

    return (
      <div className="net-profiler-chart-body">
        {zoomDomain && (
          <div className="net-profiler-chart-overlay">
            <button
              className="ghost"
              onClick={() => {
                setZoomDomain(null);
                setBrushRange(null);
                setHoverIndex(null);
              }}
            >
              Reset zoom
            </button>
            <span className="badge">
              Zoom {((Math.abs(zoomDomain.endTs - zoomDomain.startTs) || 0) / 1000).toFixed(1)}s
            </span>
          </div>
        )}
        <svg
          ref={svgRef}
          className="net-profiler-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          aria-label="Network throughput timeline"
          role="img"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onPointerLeave={handlePointerLeave}
          onWheel={handleWheel}
        >
          <g className="net-profiler-grid" aria-hidden="true">
            {[0.25, 0.5, 0.75].map((ratio) => {
              const y = ratio * height;
              return <line key={ratio} x1="0" y1={y} x2={width} y2={y} />;
            })}
          </g>

          {brushRange && (
            <rect
              className="net-profiler-brush"
              x={Math.min(brushRange.x0, brushRange.x1)}
              y="0"
              width={Math.abs(brushRange.x1 - brushRange.x0)}
              height={height}
            />
          )}

          {pinnedPaths.map((d, index) =>
            d ? (
              <path
                key={`pin-${pinnedUids[index] ?? index}`}
                d={d}
                className={`net-profiler-line net-profiler-line-pin pin-${index}`}
                fill="none"
              />
            ) : null,
          )}

          {rxPath && (
            <path d={rxPath} className="net-profiler-line net-profiler-line-rx" fill="none" />
          )}
          {txPath && (
            <path d={txPath} className="net-profiler-line net-profiler-line-tx" fill="none" />
          )}

          {hoverX != null && (
            <g className="net-profiler-hover" aria-hidden="true">
              <line className="net-profiler-marker" x1={hoverX} y1="0" x2={hoverX} y2={height} />
              {hoverIndex != null &&
                series.rxBps[hoverIndex] != null &&
                Number.isFinite(series.rxBps[hoverIndex] ?? Number.NaN) && (
                <circle
                  className="net-profiler-dot net-profiler-dot-rx"
                  cx={hoverX}
                  cy={height - Math.min(1, Math.max(0, (series.rxBps[hoverIndex] ?? 0) / yMax)) * height}
                  r="3"
                />
              )}
              {hoverIndex != null &&
                series.txBps[hoverIndex] != null &&
                Number.isFinite(series.txBps[hoverIndex] ?? Number.NaN) && (
                <circle
                  className="net-profiler-dot net-profiler-dot-tx"
                  cx={hoverX}
                  cy={height - Math.min(1, Math.max(0, (series.txBps[hoverIndex] ?? 0) / yMax)) * height}
                  r="3"
                />
              )}
            </g>
          )}
        </svg>

        {!hasSeries && (
          <div className="net-profiler-chart-empty">
            <p className="muted">{samples.length ? "Waiting for data…" : "Start the network profiler to see a timeline."}</p>
          </div>
        )}

        <div className="net-profiler-legend" aria-label="Network chart legend">
          <span className="net-profiler-legend-item">
            <span className="net-profiler-legend-swatch rx" aria-hidden="true" />
            Rx
          </span>
          <span className="net-profiler-legend-item">
            <span className="net-profiler-legend-swatch tx" aria-hidden="true" />
            Tx
          </span>
          <span className="muted net-profiler-legend-cap">
            Max {formatBps(yMax)}
          </span>
        </div>

        {hovered && !isDragging && (
          <div className="net-profiler-tooltip" style={{ left: hoverLeftPx }}>
            <div className="net-profiler-tooltip-title">
              {hovered.ageSeconds == null ? "t" : `t -${hovered.ageSeconds.toFixed(1)}s`}
            </div>
            <div className="net-profiler-tooltip-row">
              <span>Rx</span>
              <span>{formatBps(hovered.rxBps ?? null)}</span>
            </div>
            <div className="net-profiler-tooltip-row">
              <span>Tx</span>
              <span>{formatBps(hovered.txBps ?? null)}</span>
            </div>
            <div className="net-profiler-tooltip-row">
              <span>Total</span>
              <span>{formatBps(hovered.totalBps)}</span>
            </div>
            {hoveredPins.length > 0 && (
              <>
                <div className="net-profiler-tooltip-sep" aria-hidden="true" />
                {hoveredPins.map((pin) => (
                  <div key={pin.uid} className="net-profiler-tooltip-row net-profiler-tooltip-row-pin">
                    <span className="net-profiler-tooltip-pin">
                      <span className={`net-profiler-color-swatch pin-${pin.index}`} aria-hidden="true" />
                      <span className="net-profiler-tooltip-pin-label">{pin.label}</span>
                    </span>
                    <span>{formatBps(pin.totalBps)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const NetworkBreakdownPanel = () => {
    const serial = activeSerial;
    const MAX_PINNED_UIDS = 5;

    const netState =
      (serial ? netBySerial[serial] : null) ??
      ({
        running: false,
        traceId: null,
        samples: [],
        lastError: null,
      } satisfies NetProfilerState);
    const netSnapshot: NetProfilerSnapshot | null =
      netState.samples[netState.samples.length - 1] ?? null;
    const netRows = netSnapshot?.rows ?? [];
    const netQuery = netProfilerSearch.trim().toLowerCase();
    const netRowsFiltered = netQuery
      ? netRows.filter((row) => {
          const label =
            row.packages && row.packages.length ? row.packages.join(", ") : `uid:${row.uid}`;
          return label.toLowerCase().includes(netQuery);
        })
      : netRows;

    const canStartNet =
      !!serial && !busy && selectedSerials.length === 1 && deviceStatus === "device" && !netState.running;
    const canStopNet = !!serial && !busy && selectedSerials.length === 1 && netState.running;
    const netIntervalBadge =
      netProfilerIntervalMs >= 1000
        ? `Interval ${Math.round(netProfilerIntervalMs / 1000)}s`
        : `Interval ${netProfilerIntervalMs}ms`;

    const focusUid = serial ? netProfilerFocusUidBySerial[serial] ?? null : null;
    const focusedRow = focusUid != null ? netRows.find((row) => row.uid === focusUid) ?? null : null;
    const pinnedUids = serial ? netProfilerPinnedUidsBySerial[serial] ?? [] : [];
    const pinnedSet = useMemo(() => new Set(pinnedUids), [pinnedUids]);
    const pinnedLabels = useMemo(() => {
      const map: Record<number, string> = {};
      pinnedUids.forEach((uid) => {
        const row = netRows.find((candidate) => candidate.uid === uid) ?? null;
        if (row?.packages?.length) {
          const first = row.packages[0] ?? "";
          const extra = row.packages.length > 1 ? ` (+${row.packages.length - 1})` : "";
          map[uid] = `${first}${extra}`.trim() || `UID ${uid}`;
          return;
        }
        map[uid] = `UID ${uid}`;
      });
      return map;
    }, [pinnedUids, netRows]);

    const applyPinnedUids = (nextPinnedUids: number[], toastMessage: string) => {
      if (!serial) {
        return;
      }
      const prevPinned = pinnedUids;
      setNetProfilerPinnedUidsBySerial((prev) => ({
        ...prev,
        [serial]: nextPinnedUids,
      }));

      if (!netState.running) {
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
    };

    if (!serial) {
      return null;
    }

    const focusLabel =
      focusUid == null
        ? `Top ${netProfilerTopN} total`
        : focusedRow?.packages && focusedRow.packages.length
          ? focusedRow.packages.join(", ")
          : `UID ${focusUid}`;

    return (
      <section className="panel net-profiler-panel">
        <div className="panel-header">
          <div>
            <h2>Network Breakdown</h2>
            <span>Per-app throughput (best-effort).</span>
          </div>
          <div className="button-row compact">
            <select
              aria-label="Network profiler interval"
              value={netProfilerIntervalMs}
              onChange={(event) => setNetProfilerIntervalMs(Number(event.target.value))}
              disabled={busy || netState.running}
            >
              <option value={1000}>1s</option>
              <option value={2000}>2s</option>
              <option value={5000}>5s</option>
            </select>
            <select
              aria-label="Network profiler top N"
              value={netProfilerTopN}
              onChange={(event) => setNetProfilerTopN(Number(event.target.value))}
              disabled={busy || netState.running}
            >
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
            </select>
            <button onClick={handleNetProfilerStart} disabled={!canStartNet}>
              Start
            </button>
            <button onClick={handleNetProfilerStop} disabled={!canStopNet}>
              Stop
            </button>
          </div>
        </div>

        <div className="net-profiler-toolbar">
          <div className="net-profiler-search">
            <label htmlFor="net-profiler-search">Search</label>
            <input
              id="net-profiler-search"
              value={netProfilerSearch}
              onChange={(event) => setNetProfilerSearch(event.target.value)}
              disabled={busy}
              placeholder="Filter by package or UID"
            />
          </div>
          <div className="net-profiler-meta">
            <span className={`status-pill ${netState.running ? "busy" : "idle"}`}>
              {netState.running ? "Running" : "Stopped"}
            </span>
            <span className="badge">{netIntervalBadge}</span>
            <span className="badge">Top {netProfilerTopN}</span>
            {netSnapshot?.dt_ms != null && netSnapshot.dt_ms > 0 && (
              <span className="badge">Δ {netSnapshot.dt_ms}ms</span>
            )}
          </div>
        </div>

        <div className="net-profiler-chart" aria-label="Network throughput timeline">
          <div className="net-profiler-chart-header">
            <div className="net-profiler-chart-title">
              <div className="net-profiler-chart-eyebrow">Timeline</div>
              <div className="net-profiler-chart-focus">{focusLabel}</div>
              <div className="muted net-profiler-chart-hint">
                Click an app row to focus its Rx/Tx. Drag to zoom; Shift+drag to pan; Scroll to zoom.
              </div>
            </div>
            <div className="net-profiler-chart-controls">
              <select
                aria-label="Network profiler time window"
                value={netProfilerWindowMs}
                onChange={(event) => setNetProfilerWindowMs(Number(event.target.value))}
                disabled={busy}
              >
                <option value={15_000}>15s</option>
                <option value={30_000}>30s</option>
                <option value={60_000}>1m</option>
                <option value={120_000}>2m</option>
                <option value={300_000}>5m</option>
                <option value={0}>All</option>
              </select>
              {focusUid != null && (
                <button
                  className="ghost"
                  onClick={() =>
                    setNetProfilerFocusUidBySerial((prev) => ({
                      ...prev,
                      [serial]: null,
                    }))
                  }
                  disabled={busy}
                >
                  Clear focus
                </button>
              )}
              {focusUid != null && (
                <button
                  className="ghost"
                  onClick={() => {
                    if (pinnedSet.has(focusUid)) {
                      const nextPinnedUids = pinnedUids.filter((uid) => uid !== focusUid);
                      applyPinnedUids(nextPinnedUids, "Unpinned focus app.");
                      return;
                    }

                    if (pinnedUids.length >= MAX_PINNED_UIDS) {
                      pushToast(`You can pin up to ${MAX_PINNED_UIDS} apps.`, "info");
                      return;
                    }

                    applyPinnedUids([...pinnedUids, focusUid], "Pinned focus app.");
                  }}
                  disabled={busy}
                >
                  {pinnedSet.has(focusUid) ? "Unpin focus" : "Pin focus"}
                </button>
              )}
            </div>
          </div>

          {pinnedUids.length > 0 && (
            <div className="net-profiler-pins" aria-label="Pinned apps">
              <span className="muted net-profiler-pins-caption">
                Pinned (Total/s)
              </span>
                  {pinnedUids.map((uid, index) => {
                    const label = pinnedLabels[uid] ?? `UID ${uid}`;
                    return (
                      <div key={uid} className="net-profiler-pin-chip">
                        <button
                          className="net-profiler-pin-main"
                          onClick={() =>
                            setNetProfilerFocusUidBySerial((prev) => ({
                              ...prev,
                              [serial]: uid,
                            }))
                          }
                          disabled={busy}
                          title={`Focus ${label}`}
                        >
                      <span className={`net-profiler-color-swatch pin-${index}`} aria-hidden="true" />
                      <span className="net-profiler-pin-label">{label}</span>
                    </button>
                    <button
                      className="net-profiler-pin-remove"
                      onClick={() => {
                        const nextPinnedUids = pinnedUids.filter((pinned) => pinned !== uid);
                        applyPinnedUids(nextPinnedUids, `Unpinned ${label}.`);
                      }}
                      disabled={busy}
                      aria-label={`Unpin ${label}`}
                      title={`Unpin ${label}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <NetProfilerLineChart
            samples={netState.samples}
            focusUid={focusUid}
            windowMs={netProfilerWindowMs > 0 ? netProfilerWindowMs : null}
            pinnedUids={pinnedUids}
            pinnedLabels={pinnedLabels}
          />

          {focusUid != null && focusedRow == null && netState.running && (
            <div className="net-profiler-chart-note muted">
              Focused app is not in the current Top {netProfilerTopN}. Try increasing Top N or pin the focus.
            </div>
          )}
        </div>

        {netState.traceId && (
          <div className="inline-alert info">
            <strong>Trace</strong>
            <span className="muted">{netState.traceId}</span>
          </div>
        )}

        {netState.lastError && (
          <div className="inline-alert error">
            <strong>Profiler error</strong>
            <span className="muted">{netState.lastError}</span>
          </div>
        )}

        {netRowsFiltered.length ? (
          <div className="net-profiler-table" role="table" aria-label="Per-app network usage">
            <div className="net-profiler-row net-profiler-head" role="row">
              <div className="net-profiler-cell net-profiler-app" role="columnheader">
                App
              </div>
              <div className="net-profiler-cell net-profiler-trend" role="columnheader">
                Trend
              </div>
              <div className="net-profiler-cell net-profiler-number" role="columnheader">
                Rx/s
              </div>
              <div className="net-profiler-cell net-profiler-number" role="columnheader">
                Tx/s
              </div>
              <div className="net-profiler-cell net-profiler-number" role="columnheader">
                Total/s
              </div>
            </div>
            {netRowsFiltered.map((row) => {
              const appLabel =
                row.packages && row.packages.length ? row.packages.join(", ") : `UID ${row.uid}`;
              const total =
                row.rx_bps == null && row.tx_bps == null ? null : (row.rx_bps ?? 0) + (row.tx_bps ?? 0);
              const isFocused = focusUid === row.uid;
              const isPinned = pinnedSet.has(row.uid);
              return (
                <div
                  key={`${row.uid}-${appLabel}`}
                  className={`net-profiler-row ${isFocused ? "is-focused" : ""} ${isPinned ? "is-pinned" : ""}`}
                  role="row"
                  tabIndex={0}
                  onClick={() => {
                    setNetProfilerFocusUidBySerial((prev) => ({
                      ...prev,
                      [serial]: prev[serial] === row.uid ? null : row.uid,
                    }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setNetProfilerFocusUidBySerial((prev) => ({
                        ...prev,
                        [serial]: prev[serial] === row.uid ? null : row.uid,
                      }));
                    }
                  }}
                  aria-label={`Focus ${appLabel}`}
                >
                  <div className="net-profiler-cell net-profiler-app" role="cell">
                    <div className="net-profiler-app-title">{appLabel}</div>
                    <div className="muted net-profiler-app-sub">
                      Rx {formatBytes(row.rx_bytes)} • Tx {formatBytes(row.tx_bytes)}
                      {isPinned ? " • Pinned" : ""}
                    </div>
                  </div>
                  <div className="net-profiler-cell net-profiler-trend" role="cell">
                    {renderNetTrendSparkline(
                      netState.samples.map((sample) => {
                        const sampleRow = sample.rows.find((candidate) => candidate.uid === row.uid) ?? null;
                        const totalSample =
                          sampleRow && (sampleRow.rx_bps != null || sampleRow.tx_bps != null)
                            ? (sampleRow.rx_bps ?? 0) + (sampleRow.tx_bps ?? 0)
                            : 0;
                        return totalSample;
                      }),
                    )}
                  </div>
                  <div className="net-profiler-cell net-profiler-number" role="cell">
                    {formatBps(row.rx_bps ?? null)}
                  </div>
                  <div className="net-profiler-cell net-profiler-number" role="cell">
                    {formatBps(row.tx_bps ?? null)}
                  </div>
                  <div className="net-profiler-cell net-profiler-number" role="cell">
                    {formatBps(total)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="net-profiler-empty">
            <p className="muted">
              {netState.running ? "Waiting for data…" : "Start the network profiler to see per-app throughput."}
            </p>
          </div>
        )}
      </section>
    );
  };

  const PerformanceView = () => {
    if (!activeSerial) {
      return (
        <div className="page-section">
          <div className="page-header">
            <div>
              <h1>Performance</h1>
              <p className="muted">Real-time device performance snapshots.</p>
            </div>
          </div>
          <section className="panel empty-state">
            <div>
              <h2>Select a device</h2>
              <p className="muted">Choose a single online device to start monitoring.</p>
            </div>
            <div className="button-row">
              <button className="ghost" onClick={() => navigate("/devices")} disabled={busy}>
                Go to Device Manager
              </button>
            </div>
          </section>
        </div>
      );
    }

    const state =
      perfBySerial[activeSerial] ??
      ({
        running: false,
        traceId: null,
        samples: [],
        lastError: null,
      } satisfies PerfMonitorState);
    const latest: PerfSnapshot | null = state.samples[state.samples.length - 1] ?? null;

    const cpuNow =
      latest?.cpu_total_percent_x100 != null
        ? `${(latest.cpu_total_percent_x100 / 100).toFixed(2)}%`
        : "--";

    const corePercents = latest?.cpu_cores_percent_x100 ?? [];
    const coreFreqs = latest?.cpu_cores_freq_khz ?? [];
    const coreCount = Math.max(corePercents.length, coreFreqs.length);
    const coresLabel =
      coreCount === 0
        ? []
        : Array.from({ length: coreCount }, (_, index) => {
            const usageX100 = corePercents[index] ?? null;
            const freqKhz = coreFreqs[index] ?? null;
            const usage = usageX100 == null ? "--" : `${(usageX100 / 100).toFixed(2)}%`;
            const freq = formatKhz(freqKhz);
            return `C${index} ${usage} ${freq}`;
          });

    const memNow =
      latest?.mem_used_bytes != null && latest?.mem_total_bytes != null
        ? `${formatBytes(latest.mem_used_bytes)} / ${formatBytes(latest.mem_total_bytes)}`
        : "--";

    const batteryTemp =
      latest?.battery_temp_decic != null
        ? `${(latest.battery_temp_decic / 10).toFixed(1)} C`
        : "--";
    const batteryLevel =
      latest?.battery_level != null ? `${latest.battery_level}%` : "--";
    const batteryNow =
      batteryLevel === "--" && batteryTemp === "--" ? "--" : `${batteryLevel} • ${batteryTemp}`;

    const netNow =
      latest?.net_rx_bps != null || latest?.net_tx_bps != null
        ? `Rx ${formatBps(latest?.net_rx_bps ?? null)} • Tx ${formatBps(latest?.net_tx_bps ?? null)}`
        : "--";

    const displayRefreshNow = formatHzX100(latest?.display_refresh_hz_x100 ?? null);
    const missedNow = formatPerSecX100(latest?.missed_frames_per_sec_x100 ?? null);

    const cpuValues = state.samples.map((sample) =>
      sample.cpu_total_percent_x100 != null ? sample.cpu_total_percent_x100 / 100 : Number.NaN,
    );
    const memValues = state.samples.map((sample) =>
      sample.mem_used_bytes != null ? sample.mem_used_bytes : Number.NaN,
    );
    const batteryValues = state.samples.map((sample) =>
      sample.battery_level != null ? sample.battery_level : Number.NaN,
    );
    const rxValues = state.samples.map((sample) =>
      sample.net_rx_bps != null ? sample.net_rx_bps : Number.NaN,
    );
    const missedValues = state.samples.map((sample) =>
      sample.missed_frames_per_sec_x100 != null
        ? sample.missed_frames_per_sec_x100 / 100
        : Number.NaN,
    );

    const canStart = !busy && selectedSerials.length === 1 && deviceStatus === "device" && !state.running;
    const canStop = !busy && selectedSerials.length === 1 && state.running;

	    return (
	      <div className="page-section">
	        <div className="page-header">
	          <div>
	            <h1>Performance</h1>
	            <p className="muted">Real-time device performance snapshots.</p>
	          </div>
	          <div className="page-actions">
	            <span className={`status-pill ${state.running ? "busy" : "idle"}`}>
	              {state.running ? "Running" : "Stopped"}
	            </span>
	            <span className="badge">Interval 1s</span>
	          </div>
	        </div>

	        {singleSelectionWarning && (
	          <div className="inline-alert info">
	            <strong>Single device required</strong>
	            <span>Keep only one device selected (Device Context: Single) to start or stop monitoring.</span>
	          </div>
	        )}

	        {state.traceId && (
	          <div className="inline-alert info">
	            <strong>Trace</strong>
	            <span className="muted">{state.traceId}</span>
	          </div>
	        )}

        {state.lastError && (
          <div className="inline-alert error">
            <strong>Monitor error</strong>
            <span className="muted">{state.lastError}</span>
          </div>
        )}

        <section className="panel perf-panel">
          <div className="panel-header">
            <div>
              <h2>Live Monitor</h2>
              <span>{selectedSummaryLabel}</span>
            </div>
            <div className="button-row">
              <button onClick={handlePerfStart} disabled={!canStart}>
                Start
              </button>
              <button onClick={handlePerfStop} disabled={!canStop}>
                Stop
              </button>
            </div>
          </div>

          <div className="perf-grid">
            <div className="panel card perf-card">
              <div className="perf-card-header">
                <div>
                  <h3>CPU</h3>
                  <p className="muted">Total usage</p>
                </div>
                <strong>{cpuNow}</strong>
              </div>
              {coresLabel.length > 0 && (
                <div className="perf-cores">
                  {coresLabel.map((label) => (
                    <span key={label} className="badge perf-core">
                      {label}
                    </span>
                  ))}
                </div>
              )}
              {renderPerfSparkline(cpuValues)}
            </div>

            <div className="panel card perf-card">
              <div className="perf-card-header">
                <div>
                  <h3>Memory</h3>
                  <p className="muted">Used / total</p>
                </div>
                <strong>{memNow}</strong>
              </div>
              {renderPerfSparkline(memValues)}
            </div>

            <div className="panel card perf-card">
              <div className="perf-card-header">
                <div>
                  <h3>Battery</h3>
                  <p className="muted">Level and temperature</p>
                </div>
                <strong>{batteryNow}</strong>
              </div>
              {renderPerfSparkline(batteryValues)}
            </div>

            <div className="panel card perf-card">
              <div className="perf-card-header">
                <div>
                  <h3>Network</h3>
                  <p className="muted">Rx throughput</p>
                </div>
                <strong>{netNow}</strong>
              </div>
              {renderPerfSparkline(rxValues)}
            </div>

            <div className="panel card perf-card">
              <div className="perf-card-header">
                <div>
                  <h3>Display</h3>
                  <p className="muted">Refresh and missed frames</p>
                </div>
                <strong>{displayRefreshNow}</strong>
              </div>
              <div className="perf-display-row">
                <span className="muted">Missed</span>
                <strong>{missedNow}</strong>
              </div>
              {renderPerfSparkline(missedValues)}
            </div>
          </div>
        </section>

        <NetworkBreakdownPanel />
      </div>
    );
  };

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
              <p className="muted">Choose a single online device to start profiling.</p>
            </div>
            <div className="button-row">
              <button className="ghost" onClick={() => navigate("/devices")} disabled={busy}>
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
            <strong>Single device required</strong>
            <span>Keep only one device selected (Device Context: Single) to start or stop profiling.</span>
          </div>
        )}

        <NetworkBreakdownPanel />
      </div>
    );
  };

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
            <NavLink to="/network">Network</NavLink>
            <NavLink to="/ui-inspector">UI Inspector</NavLink>
            <NavLink to="/bugreport">Bugreport</NavLink>
            <NavLink to="/bugreport-logviewer">Bugreport Logs</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">Manage</span>
            <NavLink to="/apps">App Manager</NavLink>
            <NavLink to="/files">File Explorer</NavLink>
            <NavLink to="/apk-installer">APK Installer</NavLink>
            <NavLink to="/actions">Shell Commands</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">System</span>
            <NavLink to="/performance">Performance</NavLink>
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
              <button className="ghost" onClick={() => navigate("/devices")} disabled={busy}>
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
	                  Use checkboxes to select devices. Switch modes with Single/Multi. Click a row to set the primary
	                  device.
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
                    This page requires a single device. Keep only one selected.
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="top-actions">
            <button
              className="ghost"
              onClick={handleQuickScreenshot}
              disabled={busy || selectedSerials.length === 0}
            >
              Screenshot
            </button>
            <button
              className="ghost"
              onClick={requestRebootConfirm}
              disabled={busy || selectedSerials.length === 0}
            >
              Reboot
            </button>
            <button className="ghost" onClick={openPairingModal} disabled={busy}>
              Wireless Pairing
            </button>
            <button className="ghost" onClick={refreshDevices} disabled={busy}>
              Refresh
            </button>
            <button
              className="ghost"
              onClick={handleScrcpyLaunch}
              disabled={busy || selectedSerials.length === 0}
            >
              Live Mirror
            </button>
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

        <main className="page">
          <Routes>
            <Route path="/" element={<DashboardView />} />
            <Route path="/performance" element={<PerformanceView />} />
            <Route path="/network" element={<NetworkView />} />
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
	                        <select
	                          value={groupFilter}
	                          onChange={(event) => setGroupFilter(event.target.value)}
	                        >
	                          <option value="all">All groups</option>
	                          {groupOptions.map((group) => (
	                            <option key={group} value={group}>
	                              {group}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="device-filter-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleSetDeviceSelectionMode(deviceSelectionMode === "single" ? "multi" : "single")}
                          disabled={busy}
                          title="Toggle selection mode"
                        >
                          {deviceSelectionMode === "single" ? "Single Select" : "Multi Select"}
                        </button>
                        <button onClick={selectAllVisible} disabled={busy}>
                          Select Visible
                        </button>
	                        <button
	                          onClick={clearSelection}
	                          disabled={busy || devices.length === 0}
	                          title={devices.length === 0 ? "No devices detected." : "Keep one device selected."}
	                        >
	                          Keep One
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
                        <span />
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
                            onDoubleClick={() => handleSelectActiveSerial(serial)}
                          >
	                            <label className="device-check" onClick={(event) => event.stopPropagation()}>
	                              <input
	                                type="checkbox"
	                                checked={isSelected}
	                                onClick={(event) => {
	                                  event.stopPropagation();
		                                  if (deviceSelectionMode === "multi") {
		                                    toggleDevice(serial);
		                                  } else {
		                                    setSelectedSerials((prev) =>
		                                      prev.length === 1 && prev[0] === serial ? prev : [serial],
		                                    );
		                                  }
		                                  lastSelectedIndexRef.current = index;
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
                            <div className="device-cell device-actions">
                              <button
                                type="button"
                                className="ghost icon-only"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeviceCommandMenu(null);
                                  setDeviceContextMenu({ x: e.clientX, y: e.clientY, serial });
                                }}
                                disabled={busy}
                                title="Device actions"
                              >
                                ⋯
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {deviceContextMenu && (
                      <>
                        <div
                          className="context-menu-backdrop"
                          onClick={() => setDeviceContextMenu(null)}
                        />
                        <div
                          className="context-menu"
                          style={{
                            top: deviceContextMenu.y,
                            left: Math.max(10, deviceContextMenu.x - 160),
                          }}
                        >
                          <button
                            type="button"
                            className="context-menu-item"
                            onClick={() => {
                              handleSelectActiveSerial(deviceContextMenu.serial);
                              setDeviceContextMenu(null);
                            }}
                          >
                            Set Primary
                          </button>
                          <button
                            type="button"
                            className="context-menu-item"
                            onClick={() => {
                              void handleCopyDeviceInfoSpecific(deviceContextMenu.serial);
                              setDeviceContextMenu(null);
                            }}
                          >
                            Copy Device Info
                          </button>
                        </div>
                      </>
                    )}

                    {deviceCommandMenu && (
                      <>
                        <div className="context-menu-backdrop" onClick={() => setDeviceCommandMenu(null)} />
                        <div
                          className="context-menu"
                          style={{
                            top: deviceCommandMenu.y,
                            left: Math.max(10, deviceCommandMenu.x - 160),
                          }}
                        >
                          {deviceCommandMenu.kind === "select_group" ? (
                            <>
                              <button
                                type="button"
                                className="context-menu-item"
                                onClick={() => {
                                  applyGroupSelectionPreset("__all_devices__");
                                  setDeviceCommandMenu(null);
                                }}
                                disabled={busy || devices.length === 0}
                              >
                                Select all devices
                              </button>
                              {groupOptions.length === 0 ? (
                                <button type="button" className="context-menu-item" disabled>
                                  No groups yet
                                </button>
                              ) : (
                                groupOptions.map((group) => (
                                  <button
                                    key={group}
                                    type="button"
                                    className="context-menu-item"
                                    onClick={() => {
                                      applyGroupSelectionPreset(group);
                                      setDeviceCommandMenu(null);
                                    }}
                                    disabled={busy || devices.length === 0}
                                  >
                                    Select group: {group}
                                  </button>
                                ))
                              )}
                            </>
                          ) : deviceCommandMenu.kind === "wifi" ? (
                            <>
                              <button
                                type="button"
                                className="context-menu-item"
                                onClick={() => {
                                  void handleToggleWifi(true);
                                  setDeviceCommandMenu(null);
                                }}
                                disabled={busy || selectedCount === 0}
                              >
                                WiFi On
                              </button>
                              <button
                                type="button"
                                className="context-menu-item"
                                onClick={() => {
                                  void handleToggleWifi(false);
                                  setDeviceCommandMenu(null);
                                }}
                                disabled={busy || selectedCount === 0}
                              >
                                WiFi Off
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="context-menu-item"
                                onClick={() => {
                                  void handleToggleBluetooth(true);
                                  setDeviceCommandMenu(null);
                                }}
                                disabled={busy || selectedCount === 0}
                              >
                                Bluetooth On
                              </button>
                              <button
                                type="button"
                                className="context-menu-item"
                                onClick={() => {
                                  void handleToggleBluetooth(false);
                                  setDeviceCommandMenu(null);
                                }}
                                disabled={busy || selectedCount === 0}
                              >
                                Bluetooth Off
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}

                    {selectedCount > 0 && (
                      <div className="device-command-bar">
                        <div className="device-command-group">
                          <label>Group</label>
                          <div className="device-group-controls">
                            <button
                              type="button"
                              className="ghost"
                              onClick={(event) => {
                                event.preventDefault();
                                setDeviceContextMenu(null);
                                setDeviceCommandMenu({ x: event.clientX, y: event.clientY, kind: "select_group" });
                              }}
                              disabled={busy || devices.length === 0}
                              title="Select devices by group"
                            >
                              Select group…
                            </button>
                            <input
                              value={groupName}
                              onChange={(event) => setGroupName(event.target.value)}
                              placeholder="Group name"
                            />
                            <select
                              defaultValue=""
                              onChange={(event) => {
                                const picked = event.target.value;
                                if (!picked) {
                                  return;
                                }
                                setGroupName(picked);
                                event.currentTarget.value = "";
                              }}
                              disabled={busy || groupOptions.length === 0}
                              aria-label="Use existing group name"
                              title={
                                groupOptions.length === 0
                                  ? "No groups yet. Assign a group to a device first."
                                  : "Use existing group name"
                              }
                            >
                              <option value="">{groupOptions.length === 0 ? "No groups yet" : "Use existing…"}</option>
                              {groupOptions.map((group) => (
                                <option key={group} value={group}>
                                  {group}
                                </option>
                              ))}
                            </select>
                            <button onClick={handleAssignGroup} disabled={busy || selectedCount === 0}>
                              Assign
                            </button>
                          </div>
                          <span className="muted">{selectedCount} selected</span>
                        </div>
                        <div className="button-row compact">
                          <button
                            type="button"
                            className="ghost"
                            onClick={(event) => {
                              event.preventDefault();
                              setDeviceContextMenu(null);
                              setDeviceCommandMenu({ x: event.clientX, y: event.clientY, kind: "wifi" });
                            }}
                            disabled={busy || selectedCount === 0}
                          >
                            WiFi…
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={(event) => {
                              event.preventDefault();
                              setDeviceContextMenu(null);
                              setDeviceCommandMenu({ x: event.clientX, y: event.clientY, kind: "bluetooth" });
                            }}
                            disabled={busy || selectedCount === 0}
                          >
                            Bluetooth…
                          </button>
                          <button type="button" className="danger" onClick={requestRebootConfirm} disabled={busy || selectedCount === 0}>
                            Reboot…
                          </button>
                          <button onClick={handleCopyDeviceInfo} disabled={busy || selectedCount !== 1}>
                            Copy Device Info
                          </button>
                        </div>
                      </div>
                    )}
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
                      <h1>Shell Commands</h1>
                      <p className="muted">Interactive terminal sessions across devices.</p>
                    </div>
                  </div>
                  <div className="stack">
                    <section className="panel settings-panel shell-terminal-header">
                      <div className="panel-header">
                        <h2>Terminal Sessions</h2>
                        <span>{selectedSummaryLabel}</span>
                      </div>
                      {screenRecordRemote && (
                        <p className="muted">Recording in progress: {screenRecordRemote}</p>
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
                                </div>
                                <div className="task-devices">
                                  {summary.serials.map((serial) => {
                                    const entry = latestApkInstallTask.devices[serial];
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
	                <div className="page-section files-page">
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
                      <p className="muted">Browse device storage, download files, and upload files.</p>
                    </div>
                  </div>
	                  <section className="panel files-panel">
	                    <div className="panel-header">
	                      <h2>Device Files</h2>
	                      <span>{selectedSummaryLabel}</span>
	                    </div>
	                    {singleSelectionWarning && (
	                      <div className="inline-alert info">
	                        <strong>Single device required</strong>
	                        <span>Keep only one device selected (Device Context: Single) to use this page.</span>
	                      </div>
	                    )}
	                    <div className="form-row">
	                      <label>Device path</label>
	                      <input
	                        value={filesPath}
	                        onChange={(event) => setFilesPath(event.target.value)}
                        placeholder="/sdcard"
                      />
                      <button className="ghost" onClick={handleFilesGoUp} disabled={busy || selectedSerials.length !== 1}>
                        Up
                      </button>
                      <button onClick={() => void handleFilesRefresh()} disabled={busy || selectedSerials.length !== 1}>
                        Go
                      </button>
                      <button
                        className="ghost"
                        onClick={openFilesMkdirModal}
                        disabled={busy || selectedSerials.length !== 1}
                      >
                        New folder
                      </button>
                      <button onClick={handleFileUpload} disabled={busy || selectedSerials.length !== 1}>
                        Upload
                      </button>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={filesOverwriteEnabled}
                          onChange={(event) => setFilesOverwriteEnabled(event.target.checked)}
                        />
                        Overwrite existing
                      </label>
                    </div>
                    <div className="file-breadcrumbs">
                      <span className="file-breadcrumbs-label">Breadcrumbs</span>
                      <div className="file-breadcrumbs-trail">
                        {fileBreadcrumbs.map((crumb, index) => (
                          <span key={crumb.path} className="file-breadcrumbs-item">
                            <button
                              className="ghost file-breadcrumb"
                              onClick={() => void handleFilesRefresh(crumb.path)}
                              disabled={busy || selectedSerials.length !== 1}
                              aria-label={`Go to ${crumb.path}`}
                            >
                              {crumb.label}
                            </button>
                            {index < fileBreadcrumbs.length - 1 && (
                              <span className="file-breadcrumbs-sep">/</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="form-row file-search-row">
                      <label>Quick filter</label>
                      <input
                        value={filesSearchQuery}
                        onChange={(event) => setFilesSearchQuery(event.target.value)}
                        placeholder="Type to filter by name or path"
                      />
                      <button
                        className="ghost"
                        onClick={() => setFilesSearchQuery("")}
                        disabled={busy || !filesSearchQuery.trim()}
                      >
                        Clear filter
                      </button>
                      <div className="toggle-group files-view-toggle" role="group" aria-label="File view mode">
                        <button
                          type="button"
                          className={`toggle${filesViewMode === "list" ? " active" : ""}`}
                          onClick={() => setFilesViewMode("list")}
                          title="List view"
                        >
                          List
                        </button>
                        <button
                          type="button"
                          className={`toggle${filesViewMode === "grid" ? " active" : ""}`}
                          onClick={() => setFilesViewMode("grid")}
                          title="Grid view"
                        >
                          Icons
                        </button>
                      </div>
                      <span className="muted file-filter-meta">{fileFilterSummary}</span>
                    </div>
                    <div className="split files-split">
                      <div
                        className={filesViewMode === "grid" ? "file-grid" : "file-list"}
                        ref={filesListRef}
                      >
                        {files.length === 0 ? (
                          <p className="muted">No files loaded. Click Go to load the folder.</p>
                        ) : filteredFiles.length === 0 ? (
                          <p className="muted">No matches. Clear the filter to see all items.</p>
                        ) : (
                          visibleFiles.map((entry) => {
                            const kind = getFileKind(entry);
                            const kindLabel = getFileKindLabel(kind);
                            const sizeLabel = entry.size_bytes == null ? "—" : formatBytes(entry.size_bytes);
                            const isSelected = isFileSelected(entry.path);

                            if (filesViewMode === "grid") {
                              return (
                                <div
                                  key={entry.path}
                                  className={`file-card${isSelected ? " is-selected" : ""}`}
                                  onContextMenu={(event) => openFilesContextMenu(event, entry)}
                                  onDoubleClick={() => {
                                    if (busy || selectedSerials.length !== 1) {
                                      return;
                                    }
                                    if (entry.is_dir) {
                                      void handleFilesRefresh(entry.path);
                                    } else {
                                      void handleFilePull(entry);
                                    }
                                  }}
                                   onClick={(event) => {
                                     if (event.ctrlKey || event.metaKey) {
                                       toggleFileSelected(entry.path, !isSelected);
                                       return;
                                     }
                                     setFilesSelectedPaths((prev) =>
                                       prev.length === 1 && prev[0] === entry.path ? prev : [entry.path],
                                     );
                                   }}
                                >
                                  <div className="file-card-check">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(event) => toggleFileSelected(entry.path, event.target.checked)}
                                      disabled={busy}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                  <div className={`file-card-icon kind-${kind}`} title={kindLabel}>
                                    <FileTypeIcon kind={kind} />
                                  </div>
                                  <div className="file-card-name" title={entry.name}>
                                    {entry.name}
                                  </div>
                                  <button
                                    className="ghost icon-only file-card-menu"
                                    onClick={(event) => openFilesContextMenu(event, entry)}
                                    title="Actions"
                                  >
                                    ⋯
                                  </button>
                                </div>
                              );
                            }

                            return (
                              <div
                                key={entry.path}
                                className={`file-row${isSelected ? " is-selected" : ""}`}
                                onContextMenu={(event) => openFilesContextMenu(event, entry)}
                                onDoubleClick={() => {
                                  if (busy || selectedSerials.length !== 1) {
                                    return;
                                  }
                                  if (entry.is_dir) {
                                    void handleFilesRefresh(entry.path);
                                  } else {
                                    void handleFilePull(entry);
                                  }
                                }}
                                onClick={(event) => {
                                  if (event.ctrlKey || event.metaKey) {
                                    toggleFileSelected(entry.path, !isSelected);
                                    return;
                                  }
                                  setFilesSelectedPaths((prev) =>
                                    prev.length === 1 && prev[0] === entry.path ? prev : [entry.path],
                                  );
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(event) => toggleFileSelected(entry.path, event.target.checked)}
                                  disabled={busy}
                                  aria-label={`Select ${entry.name}`}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <div className={`file-row-icon kind-${kind}`} title={kindLabel} aria-hidden="true">
                                  <FileTypeIcon kind={kind} />
                                </div>
                                <div className="file-row-main">
                                  <strong title={entry.path}>{entry.name}</strong>
                                  <p className="muted">{kindLabel}</p>
                                </div>
                                <div className="file-row-meta">
                                  {entry.is_dir ? <span className="muted">—</span> : <span className="file-row-size">{sizeLabel}</span>}
                                </div>
                                <div className="file-row-actions">
                                  <button
                                    type="button"
                                    className="ghost icon-only"
                                    onClick={(event) => openFilesContextMenu(event, entry)}
                                    disabled={busy}
                                    title="File actions"
                                    aria-label={`Actions for ${entry.name}`}
                                  >
                                    ⋯
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                        {files.length > 0 && filteredFiles.length > 0 && (
                          <div className="file-list-footer">
                            <span className="muted">
                              Showing {visibleFiles.length}/{filteredFiles.length}
                            </span>
                            {canLoadMoreFiles ? (
                              <button
                                type="button"
                                className="ghost"
                                onClick={loadMoreFiles}
                                disabled={busy}
                              >
                                Load more
                              </button>
                            ) : (
                              <span className="muted">All loaded</span>
                            )}
                          </div>
                        )}
							<div className="file-load-more-sentinel" ref={filesLoadMoreSentinelRef} />
                      </div>
                      <div className="preview-panel">
                        <h3>Preview</h3>

                        {(() => {
                          if (selectedSerials.length !== 1) {
                            return <p className="muted">Select one device to preview files.</p>;
                          }
                          if (filesSelectedPaths.length !== 1) {
                            return <p className="muted">Select one file to preview.</p>;
                          }
                          const selectedPath = filesSelectedPaths[0];
                          const entry = files.find((item) => item.path === selectedPath);
                          if (!entry) {
                            return <p className="muted">Select a file to preview.</p>;
                          }
                          if (entry.is_dir) {
                            return <p className="muted">Folder selected. Double click to open.</p>;
                          }

                          const kind = getFileKind(entry);
                          const canPreview = kind === "image" || kind === "text";
                          const previewMatches = filePreview && filePreviewDevicePath === entry.path;
                          const isImage = previewMatches && filePreview.mime_type.startsWith("image/");
                          const imageSrc = isImage
                            ? filePreview.preview_data_url ?? (isTauriRuntime() ? convertFileSrc(filePreview.local_path) : null)
                            : null;

                          if (!previewMatches) {
                            return (
                              <div className="preview-empty">
                                <p className="muted">
                                  {canPreview
                                    ? "Preview is available for this file."
                                    : "Preview is available for image and text files."}
                                </p>
                                <div className="button-row compact">
                                  <button
                                    onClick={() => void handleFilePreview(entry)}
                                    disabled={busy || !canPreview}
                                  >
                                    Preview
                                  </button>
                                  <button
                                    className="ghost"
                                    onClick={() => void handleFilePull(entry)}
                                    disabled={busy}
                                  >
                                    Download
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <>
                              {isImage ? (
                                imageSrc ? (
                                  <img className="preview-image" src={imageSrc} alt={entry.name} />
                                ) : (
                                  <p className="muted">Image preview requires the desktop app runtime.</p>
                                )
                              ) : filePreview.is_text && filePreview.preview_text ? (
                                <pre>{filePreview.preview_text}</pre>
                              ) : (
                                <p className="muted">Preview not available ({filePreview.mime_type}).</p>
                              )}

                              <div className="button-row compact">
                                <button onClick={() => openPath(filePreview.local_path)} disabled={busy}>
                                  Open Externally
                                </button>
                                <button className="ghost" onClick={() => void handleFilePull(entry)} disabled={busy}>
                                  Download
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="file-bulk-bar">
                      <span className="muted">{fileSelectionLabel}</span>
                      <div className="file-bulk-actions">
                        <button
                          className="ghost"
                          onClick={() => setFilesSelectedPaths([])}
                          disabled={busy || selectedSerials.length !== 1 || !hasFileSelection}
                        >
                          Clear selection
                        </button>
                        <button
                          onClick={handleFilesPullSelected}
                          disabled={busy || selectedSerials.length !== 1 || !hasFileSelection}
                        >
                          Download selected
                        </button>
                        <button
                          className="danger"
                          onClick={openFilesDeleteSelectedModal}
                          disabled={busy || selectedSerials.length !== 1 || !hasFileSelection}
                        >
                          Delete selected
                        </button>
                      </div>
                    </div>

                    {filesContextMenu && (
                      <>
                        <div className="context-menu-backdrop" onClick={() => setFilesContextMenu(null)} />
                        <div
                          className="context-menu"
                          style={{
                            top: filesContextMenu.y,
                            left: Math.max(10, filesContextMenu.x - 160),
                          }}
                        >
                          {(() => {
                            const entry = filesContextMenu.entry;
                            const kind = getFileKind(entry);
                            const kindLabel = getFileKindLabel(kind);
                            const sizeLabel = entry.is_dir
                              ? "—"
                              : entry.size_bytes == null
                                ? "—"
                                : formatBytes(entry.size_bytes);
                            const modifiedLabel = entry.modified_at ? entry.modified_at : "";
                            const previewable = !entry.is_dir && (kind === "image" || kind === "text");

                            return (
                              <>
                                <div className="context-menu-header">
                                  <div className="context-menu-header-title">{entry.name}</div>
                                  <div className="context-menu-header-sub">
                                    {kindLabel} · {sizeLabel}
                                    {modifiedLabel ? ` · ${modifiedLabel}` : ""}
                                  </div>
                                  <div className="context-menu-header-sub">{entry.path}</div>
                                </div>
                                <div className="context-menu-sep" />

                                {entry.is_dir ? (
                                  <button
                                    type="button"
                                    className="context-menu-item"
                                    onClick={() => {
                                      setFilesContextMenu(null);
                                      void handleFilesRefresh(entry.path);
                                    }}
                                    disabled={busy || selectedSerials.length !== 1}
                                  >
                                    Open folder
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="context-menu-item"
                                      onClick={() => {
                                        setFilesContextMenu(null);
                                        void handleFilePull(entry);
                                      }}
                                      disabled={busy || selectedSerials.length !== 1}
                                    >
                                      Download
                                    </button>
                                    <button
                                      type="button"
                                      className="context-menu-item"
                                      onClick={() => {
                                        setFilesContextMenu(null);
                                        void handleFilePreview(entry);
                                      }}
                                      disabled={busy || selectedSerials.length !== 1 || !previewable}
                                      title={previewable ? "" : "Preview is supported for image and text files."}
                                    >
                                      Preview
                                    </button>
                                  </>
                                )}

                                <button
                                  type="button"
                                  className="context-menu-item"
                                  onClick={() => {
                                    openFilesRenameModal(entry);
                                    setFilesContextMenu(null);
                                  }}
                                  disabled={busy || selectedSerials.length !== 1}
                                >
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  className="context-menu-item danger"
                                  onClick={() => {
                                    openFilesDeleteModal(entry);
                                    setFilesContextMenu(null);
                                  }}
                                  disabled={busy || selectedSerials.length !== 1}
                                >
                                  Delete
                                </button>

                                <div className="context-menu-sep" />

                                <button
                                  type="button"
                                  className="context-menu-item"
                                  onClick={() => {
                                    const path = entry.path;
                                    void (async () => {
                                      try {
                                        await writeText(path);
                                        pushToast("Path copied.", "info");
                                      } catch (error) {
                                        pushToast(formatError(error), "error");
                                      }
                                    })();
                                    setFilesContextMenu(null);
                                  }}
                                >
                                  Copy path
                                </button>
                                <button
                                  type="button"
                                  className="context-menu-item"
                                  onClick={() => {
                                    const name = entry.name;
                                    void (async () => {
                                      try {
                                        await writeText(name);
                                        pushToast("Name copied.", "info");
                                      } catch (error) {
                                        pushToast(formatError(error), "error");
                                      }
                                    })();
                                    setFilesContextMenu(null);
                                  }}
                                >
                                  Copy name
                                </button>

                                <div className="context-menu-sep" />

                                <button
                                  type="button"
                                  className="context-menu-item"
                                  onClick={() => {
                                    pushToast(
                                      `${kindLabel}: ${entry.name} · ${sizeLabel}${modifiedLabel ? ` · ${modifiedLabel}` : ""}`,
                                      "info",
                                    );
                                    setFilesContextMenu(null);
                                  }}
                                >
                                  Get info
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </>
                    )}
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
	                        <span>{selectedSummaryLabel}</span>
	                      </div>
	                    </div>
	                    {singleSelectionWarning && (
	                      <div className="inline-alert info">
	                        <strong>Single device required</strong>
	                        <span>Keep only one device selected (Device Context: Single) to start streaming logs.</span>
	                      </div>
	                    )}
	                    <div className="logcat-toolbar">
	                      <div className="logcat-toolbar-row">
	                        <div className="logcat-toolbar-cluster">
	                          <div className="logcat-button-group">
                            <button onClick={handleLogcatStart} disabled={busy || selectedSerials.length !== 1}>
                              Start
                            </button>
                            <button onClick={handleLogcatStop} disabled={busy || selectedSerials.length !== 1}>
                              Stop
                            </button>
                          </div>
                          <div className="logcat-button-group">
                            <button onClick={handleLogcatClearBuffer} disabled={busy || selectedSerials.length !== 1}>
                              Clear Buffer
                            </button>
                            <button
                              className="ghost"
                              onClick={handleLogcatClearView}
                              disabled={busy || selectedSerials.length !== 1}
                            >
                              Clear View
                            </button>
                            <button
                              className="ghost"
                              onClick={handleLogcatExport}
                              disabled={busy || selectedSerials.length !== 1}
                            >
                              Export
                            </button>
                          </div>
                          <AdvancedToggleButton open={logcatAdvancedOpen} onClick={toggleLogcatAdvanced} />
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
                      <LogLiveFilterBar
                        kind={logcatTextKind}
                        onKindChange={setLogcatTextKind}
                        value={logcatLiveFilter}
                        onValueChange={setLogcatLiveFilter}
                        onAdd={addLogcatLiveFilter}
                        disabled={busy}
                        filtersCount={sharedLogTextChips.length}
                      />
                    {logcatAdvancedOpen && (
                      <InlineAdvancedPanel title="Advanced" onClose={() => setLogcatAdvancedOpen(false)}>
                        <div className="logcat-advanced-options">
                          <div className="panel-sub">
                            <h3>Levels</h3>
                            <div className="toggle-group">
                              {LOG_LEVELS.map((level) => (
                                <label key={level} className="toggle">
                                <input
                                  type="checkbox"
                                  checked={logLevels[level]}
                                  onChange={(event) =>
                                    setLogLevels((prev) => ({
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

                        <SharedRegexFiltersAndPresetsPanel
                          chips={sharedLogTextChips}
                          expanded={logcatFiltersExpanded}
                          onToggleExpanded={() => setLogcatFiltersExpanded((prev) => !prev)}
                          onRemoveChip={(chipId) =>
                            setSharedLogTextChips((prev) => removeLogTextChip(prev, chipId))
                          }
                          onClearChips={clearSharedLogFilters}
                          disabled={busy}
                          appliedTitle="Applied in real time."
                          presets={logcatPresets}
                          presetSelected={logcatPresetSelected}
                          onPresetSelectedChange={setLogcatPresetSelected}
                          presetName={logcatPresetName}
                          onPresetNameChange={setLogcatPresetName}
                          hasSelectedPreset={Boolean(selectedLogcatPreset)}
                          onApplyPreset={applyLogcatPreset}
                          onDeletePreset={deleteLogcatPreset}
                          onSavePreset={saveLogcatPreset}
                        />
                      </InlineAdvancedPanel>
                    )}
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
                      <LogcatOutput
                        entries={logcatFiltered.lines}
                        searchPattern={logcatSearchPattern}
                        autoScroll={logcatAutoScroll}
                        outputRef={logcatOutputRef}
                      />
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
	                        <span>{selectedSummaryLabel}</span>
	                      </div>
	                      <div className="button-row compact">
	                        <button onClick={handleUiInspect} disabled={busy || selectedSerials.length !== 1}>
	                          Refresh
	                        </button>
	                        <button className="ghost" onClick={handleUiExport} disabled={busy || selectedSerials.length !== 1}>
	                          Export
	                        </button>
	                        <select
	                          aria-label="Auto sync interval"
	                          title="Auto sync interval"
	                          value={uiAutoSyncIntervalMs}
	                          onChange={(event) => setUiAutoSyncIntervalMs(Number(event.target.value))}
	                          disabled={selectedSerials.length !== 1}
	                        >
	                          <option value={500}>0.5s</option>
	                          <option value={1000}>1s</option>
	                          <option value={2000}>2s</option>
	                        </select>
	                        <button
	                          type="button"
	                          className={`ghost ${uiAutoSyncEnabled ? "active" : ""}`}
	                          onClick={handleUiAutoSyncToggle}
	                          disabled={selectedSerials.length !== 1}
	                          title="Automatically refresh screenshot and hierarchy"
	                        >
	                          Auto Sync
	                        </button>
	                      </div>
	                    </div>
	                    {singleSelectionWarning && (
	                      <div className="inline-alert info">
	                        <strong>Single device required</strong>
	                        <span>
	                          Keep only one device selected (Device Context: Single) to use Refresh, Export, and Auto Sync.
	                        </span>
	                      </div>
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
								{uiAutoSyncEnabled
									? `Auto sync${uiAutoSyncLastAt ? ` · ${new Date(uiAutoSyncLastAt).toLocaleTimeString()}` : ""}`
									: uiScreenshotSrc
										? "Captured"
										: "No screenshot"}
                          </span>
                        </div>
							{uiAutoSyncEnabled && uiAutoSyncError && (
								<div className="inline-alert error">
									<strong>Auto sync error</strong>
									<span>{uiAutoSyncError}</span>
								</div>
							)}
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
                            <iframe
                              ref={uiHierarchyFrameRef}
                              title="UI Inspector"
                              srcDoc={uiHtml}
                              className="ui-frame"
                              onLoad={() => setUiHierarchyFrameToken((value) => value + 1)}
                            />
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
	                      <span>{selectedSummaryLabel}</span>
	                    </div>
	                    {singleSelectionWarning && (
	                      <div className="inline-alert info">
	                        <strong>Single device required</strong>
	                        <span>Keep only one device selected (Device Context: Single) to load and manage apps.</span>
	                      </div>
	                    )}
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
                      <button onClick={handleLoadApps} disabled={busy || selectedSerials.length !== 1}>
                        Load Apps
                      </button>
	                      {(() => {
	                        if (!appsSerial || apps.length === 0) {
	                          return null;
	                        }
	                        const prefix = `${appsSerial}::`;
	                        const entries = Object.entries(appIconsByKey).filter(([key]) => key.startsWith(prefix));
	                        const readyCount = entries.filter(([, item]) => item.status === "ready").length;
	                        const queuedCount = entries.filter(([, item]) => item.status === "queued").length;
	                        const loadingCount = entries.filter(([, item]) => item.status === "loading").length;
	                        const errorCount = entries.filter(([, item]) => item.status === "error").length;
	                        return (
	                          <span className="muted app-icons-progress" title="App icon loading">
	                            Icons {readyCount}/{apps.length}
	                            {loadingCount || queuedCount ? " · loading" : ""}
	                            {errorCount ? ` · ${errorCount} failed` : ""}
	                          </span>
	                        );
	                      })()}
                    </div>
	                    <div className="split">
	                      <div className="app-list" ref={appsListRef} role="list" aria-label="Apps">
	                        {apps.length === 0 ? (
	                          <p className="muted">No apps loaded. Click Load Apps.</p>
	                        ) : filteredApps.length === 0 ? (
	                          <p className="muted">No matches.</p>
	                        ) : (
	                          <>
	                            {visibleApps.map((app) => {
	                            const isActive = selectedApp?.package_name === app.package_name;
	                            const tone = getStableToneIndex(app.package_name);
	                            const displayName = getAppDisplayName(app.package_name);
	                            const letters = getAppAvatarLetters(app.package_name);
	                            const versionLabel = appsIncludeVersions ? app.version_name ?? "" : "";
	                            const iconKey = appsSerial ? getAppIconKey(appsSerial, app.package_name) : null;
	                            const iconUrl = iconKey ? appIconsByKey[iconKey]?.dataUrl : undefined;
	                            return (
	                              <button
	                                key={app.package_name}
	                                className={`app-row${isActive ? " active" : ""}`}
	                                type="button"
	                                onClick={() => handleSelectAppRow(app)}
	                                onDoubleClick={() => void handleAppDoubleClick(app)}
	                                onContextMenu={(event) => handleAppContextMenu(event, app)}
	                                role="listitem"
	                                aria-current={isActive ? "true" : undefined}
	                                data-app-pkg={app.package_name}
	                              >
	                                <div
	                                  className={`app-avatar tone-${tone}`}
	                                  aria-hidden="true"
	                                  title={
	                                    iconKey && appIconsByKey[iconKey]?.status === "error"
	                                      ? appIconsByKey[iconKey]?.error
	                                      : undefined
	                                  }
	                                >
	                                  {iconUrl ? <img className="app-icon-img" src={iconUrl} alt="" /> : letters}
	                                  {iconKey && appIconsByKey[iconKey]?.status === "loading" ? (
	                                    <span className="app-icon-spinner" aria-hidden="true" />
	                                  ) : iconKey && appIconsByKey[iconKey]?.status === "queued" ? (
	                                    <span className="app-icon-dot" aria-hidden="true" />
	                                  ) : iconKey && appIconsByKey[iconKey]?.status === "error" ? (
	                                    <span className="app-icon-error" aria-hidden="true">
	                                      !
	                                    </span>
	                                  ) : null}
	                                </div>
	                                <div className="app-row-main">
	                                  <div className="app-row-title">
	                                    <strong>{displayName}</strong>
	                                    {app.is_system && <span className="badge">System</span>}
	                                  </div>
	                                  <div className="app-row-sub">
	                                    <span className="app-row-package">{app.package_name}</span>
	                                    {versionLabel ? <span className="app-row-version">{versionLabel}</span> : null}
	                                  </div>
	                                </div>
	                                <div className="app-row-tail" aria-hidden="true">
	                                  <span className="chevron">›</span>
	                                </div>
	                              </button>
	                            );
	                          })}
	                            <div className="app-list-footer">
	                              <span className="muted">
	                                Showing {visibleApps.length}/{filteredApps.length}
	                              </span>
	                              {canLoadMoreApps ? (
	                                <button
	                                  type="button"
	                                  className="ghost"
	                                  onClick={loadMoreApps}
	                                >
	                                  Load more
	                                </button>
	                              ) : (
	                                <span className="muted">All loaded</span>
	                              )}
	                            </div>
	                            <div className="app-load-more-sentinel" ref={appsLoadMoreSentinelRef} />
	                          </>
	                        )}
	                      </div>
	                      <div className="preview-panel app-details">
	                        <h3>Selected App</h3>
	                        {selectedApp ? (
	                          <div className="stack">
	                            {(() => {
	                              const tone = getStableToneIndex(selectedApp.package_name);
	                              const displayName = getAppDisplayName(selectedApp.package_name);
	                              const letters = getAppAvatarLetters(selectedApp.package_name);
	                              const iconKey = appsSerial ? getAppIconKey(appsSerial, selectedApp.package_name) : null;
	                              const iconUrl = iconKey ? appIconsByKey[iconKey]?.dataUrl : undefined;
	                              return (
	                                <div className="app-details-header">
	                                  <div className={`app-avatar large tone-${tone}`} aria-hidden="true">
	                                    {iconUrl ? <img className="app-icon-img" src={iconUrl} alt="" /> : letters}
	                                  </div>
	                                  <div className="app-details-title">
	                                    <div className="app-details-name">{displayName}</div>
	                                    <div className="app-details-package">{selectedApp.package_name}</div>
	                                  </div>
	                                </div>
	                              );
	                            })()}
	                            {appsDetailsBusy && <p className="muted">Loading details...</p>}
	                            <div className="stack">
	                              <p className="muted">
	                                Version: {selectedAppDetails?.version_name ?? selectedApp.version_name ?? "--"}
	                              </p>
	                              <details>
	                                <summary className="muted">Install source</summary>
	                                <div className="stack">
	                                  <p className="muted">
	                                    Installer: {selectedAppDetails?.installer_package_name ?? "--"}
	                                  </p>
	                                  <p className="muted">
	                                    Installing: {selectedAppDetails?.installing_package_name ?? "--"}
	                                  </p>
	                                  <p className="muted">
	                                    Originating: {selectedAppDetails?.originating_package_name ?? "--"}
	                                  </p>
	                                  <p className="muted">
	                                    Initiating: {selectedAppDetails?.initiating_package_name ?? "--"}
	                                  </p>
	                                </div>
	                              </details>
	                              <p className="muted">UID: {selectedAppDetails?.uid ?? "--"}</p>
	                              <p className="muted">
	                                Data dir: {selectedAppDetails?.data_dir ?? "--"}
	                              </p>
	                              <p className="muted">
	                                Target SDK: {selectedAppDetails?.target_sdk ?? "--"}
	                              </p>
	                              <details>
	                                <summary className="muted">
	                                  Permissions (granted {selectedAppDetails?.granted_permissions?.length ?? 0} / requested {selectedAppDetails?.requested_permissions?.length ?? 0})
	                                </summary>
	                                <div className="stack">
	                                  <p className="muted">Granted</p>
	                                  <pre>{(selectedAppDetails?.granted_permissions ?? []).join("\n")}</pre>
	                                  <p className="muted">Requested</p>
	                                  <pre>{(selectedAppDetails?.requested_permissions ?? []).join("\n")}</pre>
	                                </div>
	                              </details>
	                              <details>
	                                <summary className="muted">Components</summary>
	                                <div className="stack">
	                                  <p className="muted">Activities: {selectedAppDetails?.components_summary?.activities ?? 0}</p>
	                                  <p className="muted">Services: {selectedAppDetails?.components_summary?.services ?? 0}</p>
	                                  <p className="muted">Receivers: {selectedAppDetails?.components_summary?.receivers ?? 0}</p>
	                                  <p className="muted">Providers: {selectedAppDetails?.components_summary?.providers ?? 0}</p>
	                                </div>
	                              </details>
	                              <p className="muted">First install: {selectedAppDetails?.first_install_time ?? "--"}</p>
	                              <p className="muted">Last update: {selectedAppDetails?.last_update_time ?? "--"}</p>
	                              <p className="muted">
	                                APK size:{" "}
	                                {selectedAppDetails?.apk_size_bytes_total != null
	                                  ? formatBytes(selectedAppDetails.apk_size_bytes_total)
	                                  : "--"}
	                              </p>
	                            </div>
	                            <div className="button-row compact">
	                              <button
	                                onClick={() => void handleAppDoubleClick(selectedApp)}
	                                disabled={busy || selectedSerials.length !== 1}
	                              >
	                                Launch
	                              </button>
	                              <button
	                                onClick={() => handleAppAction("info")}
	                                disabled={busy || selectedSerials.length !== 1}
	                              >
	                                Open Info
	                              </button>
	                            </div>
	                            <div className="button-row compact">
	                              <button
	                                onClick={() => handleAppAction("forceStop")}
	                                disabled={busy || selectedSerials.length !== 1}
	                              >
	                                Force Stop
	                              </button>
	                              <button onClick={() => handleAppAction("clear")} disabled={busy || selectedSerials.length !== 1}>
	                                Clear Data
	                              </button>
	                              <button
	                                className="ghost"
	                                onClick={() => handleAppAction("enable")}
	                                disabled={busy || selectedSerials.length !== 1}
	                              >
	                                Enable
	                              </button>
	                              <button
	                                className="ghost"
	                                onClick={() => handleAppAction("disable")}
	                                disabled={busy || selectedSerials.length !== 1}
	                              >
	                                Disable
	                              </button>
	                              <button
	                                className="danger"
	                                onClick={() => handleAppAction("uninstall")}
	                                disabled={busy || selectedSerials.length !== 1}
	                              >
	                                Uninstall
	                              </button>
	                            </div>
	                          </div>
	                        ) : (
	                          <p className="muted">Select an app to manage.</p>
	                        )}
	                      </div>
	                    </div>
	                    {appsContextMenu && (
	                      <>
	                        <div
	                          className="context-menu-backdrop"
	                          onMouseDown={() => setAppsContextMenu(null)}
	                        />
	                        <div
	                          className="context-menu"
	                          style={{ left: appsContextMenu.x, top: appsContextMenu.y, minWidth: 240 }}
	                          onMouseDown={(event) => event.stopPropagation()}
	                        >
	                          {(() => {
	                            const app = appsContextMenu.app;
	                            const displayName = getAppDisplayName(app.package_name);
	                            return (
	                              <>
	                                <div className="context-menu-header">
	                                  <div className="context-menu-header-title">{displayName}</div>
	                                  <div className="context-menu-header-sub">{app.package_name}</div>
	                                  <div className="context-menu-header-sub">
	                                    {app.is_system ? "System" : "Third-party"}
	                                    {appsIncludeVersions && app.version_name ? ` · ${app.version_name}` : ""}
	                                  </div>
	                                </div>
	                                <div className="context-menu-sep" />
	                              </>
	                            );
	                          })()}
	                          <button
	                            type="button"
	                            className="context-menu-item"
	                            onClick={() => void handleAppDoubleClick(appsContextMenu.app)}
	                            disabled={busy || selectedSerials.length !== 1}
	                          >
	                            Launch
	                          </button>
	                          <button
	                            type="button"
	                            className="context-menu-item"
	                            onClick={() => void handleContextForceStop(appsContextMenu.app)}
	                            disabled={busy || selectedSerials.length !== 1}
	                          >
	                            Force Stop
	                          </button>
	                          <button
	                            type="button"
	                            className="context-menu-item"
	                            onClick={() => void handleAppAction("clear")}
	                            disabled={busy || selectedSerials.length !== 1}
	                          >
	                            Clear Data
	                          </button>
	                          <button
	                            type="button"
	                            className="context-menu-item"
	                            onClick={() => void handleAppAction("info")}
	                            disabled={busy || selectedSerials.length !== 1}
	                          >
	                            Open Info
	                          </button>
	                          <div className="context-menu-sep" />
	                          <button
	                            type="button"
	                            className="context-menu-item"
	                            onClick={() => void handleAppAction("enable")}
	                            disabled={busy || selectedSerials.length !== 1}
	                          >
	                            Enable
	                          </button>
	                          <button
	                            type="button"
	                            className="context-menu-item"
	                            onClick={() => void handleAppAction("disable")}
	                            disabled={busy || selectedSerials.length !== 1}
	                          >
	                            Disable
	                          </button>
	                          <div className="context-menu-sep" />
	                          <button
	                            type="button"
	                            className="context-menu-item"
	                            onClick={() => {
	                              void (async () => {
	                                try {
	                                  await writeText(appsContextMenu.app.package_name);
	                                  pushToast("Package copied.", "info");
	                                } catch (error) {
	                                  pushToast(formatError(error), "error");
	                                }
	                              })();
	                              setAppsContextMenu(null);
	                            }}
	                          >
	                            Copy package
	                          </button>
	                          <button
	                            type="button"
	                            className="context-menu-item danger"
	                            onClick={() => void handleAppAction("uninstall")}
	                            disabled={busy || selectedSerials.length !== 1}
	                          >
	                            Uninstall
	                          </button>
	                        </div>
	                      </>
	                    )}
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
                  <div className="stack">
                    <section className="panel">
                      <div className="panel-header">
                        <h2>Bugreport</h2>
                        <span>{selectedSummaryLabel}</span>
                      </div>
                      <div className="button-row">
                        <button onClick={handleBugreport} disabled={busy || selectedSerials.length === 0}>
                          Generate Bugreport
                        </button>
                        <button onClick={handleCancelBugreport} disabled={busy || selectedSerials.length === 0}>
                          Cancel
                        </button>
                      </div>
                      {latestBugreportTask ? (
                        <div className="stack">
                          <div className="progress">
                            <div className="progress-bar">
                              <div
                                className="progress-fill"
                                style={{ width: `${latestBugreportProgress ?? 0}%` }}
                              />
                            </div>
                            <span>
                              {latestBugreportProgress != null ? `${latestBugreportProgress}%` : "Idle"}
                            </span>
                          </div>
                          <div className="task-devices">
                            {latestBugreportEntries.map((entry) => {
                              const entryTone =
                                entry.status === "running"
                                  ? "busy"
                                  : entry.status === "success"
                                    ? "ok"
                                    : entry.status === "cancelled"
                                      ? "warn"
                                      : "error";
                              return (
                                <div key={entry.serial} className="task-device-row">
                                  <div className="task-device-main">
                                    <strong>{entry.serial}</strong>
                                    <span className={`status-pill ${entryTone}`}>{entry.status}</span>
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
                        </div>
                      ) : (
                        <>
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
                        </>
                      )}
                    </section>
                  </div>
                </div>
              }
            />
            <Route
              path="/bugreport-logviewer"
              element={
                <div className="page-section bugreport-logviewer-page">
                  <div className="page-header">
                    <div>
                      <h1>Bugreport Log Viewer</h1>
                      <p className="muted">Load bugreport logs and filter with search.</p>
                    </div>
                    <div className="page-actions">
                      <button onClick={handlePickBugreportLogFile} disabled={bugreportLogBusy}>
                        Browse
                      </button>
                    </div>
                  </div>
                  <section className="panel bugreport-log-panel bugreport-log-panel-full">
                    <div className="panel-header">
                      <div>
                        <h2>Log Output</h2>
                        <span>
                          {bugreportLogSummary
                            ? `${bugreportLogRows.length.toLocaleString()} / ${bugreportLogSummary.total_rows.toLocaleString()} rows loaded`
                            : bugreportLogRows.length
                              ? `${bugreportLogRows.length.toLocaleString()} rows loaded`
                              : "No rows yet"}
                        </span>
                      </div>
                      <div className="button-row compact">
                        {bugreportLogContextAnchorId != null ? (
                          <>
                            <span className="badge">Context view</span>
                            <button
                              className="ghost"
                              onClick={handleBugreportLogBackToList}
                              disabled={bugreportLogBusy}
                            >
                              Back to list
                            </button>
                          </>
                        ) : (
                          <>
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
                                disabled={!bugreportLogSummary || bugreportLogBusy || !bugreportLogHasMore}
                              >
                                Load all
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="bugreport-log-source-inline">
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
                      {bugreportAnalysisTargets.length > 0 && (
                        <details className="output-block bugreport-log-recent">
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

                    {bugreportLogError && (
                      <div className="inline-alert error">
                        <strong>Log viewer error</strong>
                        <span>{bugreportLogError}</span>
                      </div>
                    )}
                    {bugreportLogBusy && (
                      <div className="inline-alert info">
                        <strong>Working</strong>
                        <span>Preparing or querying logcat...</span>
                      </div>
                    )}
                    {bugreportLogLoadAllRunning && (
                      <div className="inline-alert info">
                        <strong>Loading all rows</strong>
                        <span>Fetching logcat pages in the background...</span>
                      </div>
                    )}

                    <div className="bugreport-log-toolbar">
                      <div className="panel-sub bugreport-log-topbar">
                        <div className="form-row">
                          <label>Buffer</label>
                          <select
                            value={bugreportLogBuffer}
                            onChange={(event) => {
                              setBugreportLogBuffer(event.target.value);
                              setBugreportLogLastSearchTerm("");
                              setBugreportLogMatches([]);
                              setBugreportLogMatchesTruncated(false);
                              setBugreportLogMatchIndex(-1);
                              setBugreportLogMatchesOpen(false);
                            }}
                            disabled={!bugreportLogSummary || bugreportLogBusy}
                          >
                            <option value="">All</option>
                            {(() => {
                              const summary = bugreportLogSummary;
                              if (!summary) {
                                return null;
                              }
                              const order = ["main", "system", "crash", "events", "radio"];
                              const seen = new Set(order);
                              const extra = Object.keys(summary.buffers ?? {})
                                .filter((key) => !seen.has(key))
                                .sort((a, b) => a.localeCompare(b));
                              return (
                                <>
                                  {order.map((key) => {
                                    const count = summary.buffers?.[key] ?? 0;
                                    if (!count) {
                                      return null;
                                    }
                                    return (
                                      <option key={key} value={key}>
                                        {key} ({count.toLocaleString()})
                                      </option>
                                    );
                                  })}
                                  {extra.map((key) => (
                                    <option key={key} value={key}>
                                      {key} ({(summary.buffers?.[key] ?? 0).toLocaleString()})
                                    </option>
                                  ))}
                                </>
                              );
                            })()}
                          </select>
                          <label>Search (FTS)</label>
                          <input
                            value={bugreportLogSearchTerm}
                            onChange={(event) => {
                              const next = event.target.value;
                              setBugreportLogSearchTerm(next);
                              if (bugreportLogLastSearchTerm && bugreportLogLastSearchTerm !== next.trim()) {
                                setBugreportLogLastSearchTerm("");
                                setBugreportLogMatches([]);
                                setBugreportLogMatchesTruncated(false);
                                setBugreportLogMatchIndex(-1);
                                setBugreportLogMatchesOpen(false);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleBugreportLogSearch();
                              }
                            }}
                            placeholder="e.g. AndroidRuntime FATAL EXCEPTION"
                            disabled={!bugreportLogSummary || bugreportLogBusy}
                          />
                          <button
                            type="button"
                            onClick={() => void handleBugreportLogSearch()}
                            disabled={!bugreportLogSummary || bugreportLogBusy || !bugreportLogSearchTerm.trim()}
                          >
                            Search
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              setBugreportLogSearchTerm("");
                              setBugreportLogLastSearchTerm("");
                              setBugreportLogMatches([]);
                              setBugreportLogMatchesTruncated(false);
                              setBugreportLogMatchIndex(-1);
                              setBugreportLogMatchesOpen(false);
                            }}
                            disabled={bugreportLogBusy || (!bugreportLogSearchTerm.trim() && bugreportLogMatches.length === 0)}
                          >
                            Clear
                          </button>
                          <AdvancedToggleButton
                            open={bugreportLogAdvancedOpen}
                            onClick={() => setBugreportLogAdvancedOpen((prev) => !prev)}
                            className="bugreport-log-advanced-toggle"
                          />
                        </div>
                      </div>

	                      {(() => {
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

                          const maxRegexPreview = 3;
                          const regexPreview = sharedLogTextChips.slice(0, maxRegexPreview);
                          regexPreview.forEach((chip, index) => {
                            chips.push({
                              key: `re-${chip.id}-${index}`,
                              label: chip.kind === "exclude" ? `NOT ${chip.value}` : chip.value,
                              tone: chip.kind === "exclude" ? "exclude" : undefined,
                            });
                          });
	                          if (sharedLogTextChips.length > maxRegexPreview) {
	                            chips.push({
	                              key: "re-more",
	                              label: `Regex +${sharedLogTextChips.length - maxRegexPreview}`,
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
                        disabled={bugreportLogBusy}
                        filtersCount={sharedLogTextChips.length}
                      />

	                      {bugreportLogMatches.length > 0 ? (
	                        <div className="panel-sub bugreport-log-matchesbar">
	                          <div className="bugreport-log-matchesbar-row">
                            <span className="muted">
                              Matches{" "}
                              {bugreportLogMatchesTruncated
                                ? `${bugreportLogMatches.length.toLocaleString()}+`
                                : bugreportLogMatches.length.toLocaleString()}
                              {bugreportLogMatchIndex >= 0 && bugreportLogMatches.length
                                ? ` · ${Math.min(bugreportLogMatchIndex + 1, bugreportLogMatches.length)}/${bugreportLogMatches.length}`
                                : ""}
                            </span>
                            <div className="button-row compact bugreport-log-matchesbar-actions">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => moveBugreportLogMatch(-1)}
                                disabled={bugreportLogBusy || bugreportLogMatches.length === 0}
                              >
                                Prev
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => moveBugreportLogMatch(1)}
                                disabled={bugreportLogBusy || bugreportLogMatches.length === 0}
                              >
                                Next
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => setBugreportLogMatchesOpen((prev) => !prev)}
                                disabled={bugreportLogBusy}
                              >
                                {bugreportLogMatchesOpen ? "Hide list" : "Show list"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : bugreportLogLastSearchTerm &&
                        bugreportLogLastSearchTerm === bugreportLogSearchTerm.trim() &&
                        bugreportLogSummary &&
                        !bugreportLogBusy &&
                        !bugreportLogError ? (
                        <p className="muted">No matches.</p>
                      ) : null}

	                      {bugreportLogMatchesOpen && bugreportLogMatches.length > 0 && (
	                        <div className="output-block bugreport-log-matches">
	                          <div className="bugreport-log-match-list" role="list">
	                            {bugreportLogMatches.map((match, index) => (
                              <button
                                key={`${match.id}-${match.ts}`}
                                type="button"
                                className={`bugreport-log-match-row${index === bugreportLogMatchIndex ? " active" : ""}`}
                                onClick={() => openBugreportLogMatch(index)}
                                disabled={bugreportLogBusy}
                                role="listitem"
                              >
                                <div className="bugreport-log-match-row-top">
                                  <span className="muted bugreport-log-match-meta">
                                    {match.ts} · {match.level} · {match.tag} · pid {match.pid}
                                  </span>
                                  <span className="badge bugreport-log-match-buffer">{match.buffer}</span>
                                </div>
                                <div className="bugreport-log-match-msg">{match.msg}</div>
                              </button>
                            ))}
	                          </div>
	                        </div>
	                      )}
	                    </div>

		                    {bugreportLogAdvancedOpen && (
		                      <InlineAdvancedPanel title="Advanced" onClose={() => setBugreportLogAdvancedOpen(false)}>
		                        <div className="muted bugreport-log-search-hint">
		                          Search uses levels, buffer, tag, PID, time range, and regex filters.
		                        </div>
		                        <SharedRegexFiltersAndPresetsPanel
		                          chips={sharedLogTextChips}
		                          expanded={bugreportLogFiltersExpanded}
		                          onToggleExpanded={() => setBugreportLogFiltersExpanded((prev) => !prev)}
		                          onRemoveChip={(chipId) =>
		                            setSharedLogTextChips((prev) => removeLogTextChip(prev, chipId))
		                          }
		                          onClearChips={clearSharedLogFilters}
		                          disabled={bugreportLogBusy}
		                          appliedTitle="Applied to bugreport queries."
		                          gridClassName="bugreport-log-filter-grid"
		                          presets={logcatPresets}
		                          presetSelected={logcatPresetSelected}
		                          onPresetSelectedChange={setLogcatPresetSelected}
		                          presetName={logcatPresetName}
		                          onPresetNameChange={setLogcatPresetName}
		                          hasSelectedPreset={Boolean(selectedLogcatPreset)}
		                          onApplyPreset={applyLogcatPreset}
		                          onDeletePreset={deleteLogcatPreset}
		                          onSavePreset={saveLogcatPreset}
		                        >
		                          <div className="bugreport-log-advanced-fields">
		                            <div className="bugreport-log-advanced-controls">
		                              <div className="bugreport-log-toolbar-row">
		                                    <div className="bugreport-log-filter-field">
		                                      <label htmlFor="bugreport-log-tag">Tag</label>
		                                      <input
		                                        id="bugreport-log-tag"
		                                        value={bugreportLogTag}
			                                        onChange={(event) => setBugreportLogTag(event.target.value)}
			                                        placeholder="Tag"
			                                      />
			                                    </div>
			                                    <div className="bugreport-log-filter-field">
			                                      <label htmlFor="bugreport-log-pid">PID</label>
			                                      <input
			                                        id="bugreport-log-pid"
			                                        value={bugreportLogPid}
			                                        onChange={(event) => setBugreportLogPid(event.target.value)}
			                                        placeholder="PID"
			                                      />
			                                    </div>
			                                    <div className="bugreport-log-filter-field">
			                                      <label htmlFor="bugreport-log-start">Start</label>
			                                      <input
			                                        id="bugreport-log-start"
			                                        value={bugreportLogStart}
			                                        onChange={(event) => setBugreportLogStart(event.target.value)}
			                                        placeholder="MM-DD HH:MM:SS.mmm"
			                                      />
			                                    </div>
			                                    <div className="bugreport-log-filter-field">
			                                      <label htmlFor="bugreport-log-end">End</label>
			                                      <input
			                                        id="bugreport-log-end"
			                                        value={bugreportLogEnd}
			                                        onChange={(event) => setBugreportLogEnd(event.target.value)}
			                                        placeholder="MM-DD HH:MM:SS.mmm"
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
			                                        setBugreportLogSearchTerm("");
			                                        setBugreportLogLastSearchTerm("");
			                                        setBugreportLogMatches([]);
			                                        setBugreportLogMatchesTruncated(false);
			                                        setBugreportLogMatchIndex(-1);
			                                        setBugreportLogMatchesOpen(false);
			                                        setBugreportLogContextAnchorId(null);
			                                      }}
			                                      disabled={bugreportLogBusy}
			                                    >
			                                      Reset Filters
			                                    </button>
			                                  </div>
		                            </div>
		                          </div>
		                        </SharedRegexFiltersAndPresetsPanel>
		                      </InlineAdvancedPanel>
		                    )}

		                    {bugreportLogRows.length ? (
		                      <BugreportLogOutput
		                        rows={bugreportLogRows}
		                        highlightPattern={bugreportLogSearchPattern}
		                        canLoadMore={Boolean(bugreportLogSummary) && bugreportLogHasMore && !bugreportLogLoadAllRunning}
		                        busy={bugreportLogBusy || bugreportLogLoadAllRunning}
		                        activeRowId={bugreportLogContextAnchorId}
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
                  <BluetoothMonitorPage
                    serial={selectedSerials.length === 1 ? selectedSerials[0] : null}
                    serialLabel={selectedSummaryLabel}
                    busy={busy}
                    singleSelectionWarning={singleSelectionWarning}
                    onToggleMonitor={handleBluetoothMonitor}
                  />
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
                        <div className="settings-group settings-span-2">
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
                          <div className="muted settings-hint">
                            Leave blank to use <code>adb</code> from your PATH. Otherwise select the{" "}
                            <code>adb</code> executable from Android platform-tools.
                          </div>
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
	                        <div className="settings-group">
	                          <h3>Output Paths</h3>
	                          <label>
	                            Default Output
	                            <input
                              placeholder="e.g. /Users/me/Downloads or C:\\Users\\me\\Downloads"
                              value={config.output_path}
                              onChange={(event) =>
                                setConfig((prev) => (prev ? { ...prev, output_path: event.target.value } : prev))
                              }
                            />
                          </label>
                          <div className="button-row">
                            <button type="button" className="ghost" onClick={handleBrowseOutputPath} disabled={busy}>
                              Browse
                            </button>
                          </div>
                          <div className="muted settings-hint">
                            Default folder for screenshots, bugreports, and recordings. Use an absolute local folder
                            path.
                          </div>
                          <label>
                            File Export
                            <input
                              placeholder="Leave blank to use Default Output"
                              value={config.file_gen_output_path}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev ? { ...prev, file_gen_output_path: event.target.value } : prev,
                                )
                              }
                            />
	                          </label>
                          <div className="button-row">
                            <button
                              type="button"
                              className="ghost"
                              onClick={handleBrowseFileExportPath}
                              disabled={busy}
                            >
                              Browse
                            </button>
                          </div>
                          <div className="muted settings-hint">
                            Folder for generated exports (logcat, UI inspector). Leave blank to reuse Default Output.
                          </div>
	                        </div>
                          <div className="settings-group">
                            <h3>Updates</h3>
                            <div className="muted settings-hint">
                              Check for new versions from GitHub Releases. Installing updates will restart the app.
                            </div>
                            <div className="stack">
                              <div className="inline-row">
                                <span className="muted">Current version</span>
                                <code>{appVersionLabel}</code>
                              </div>
                              <div className="inline-row">
                                <span className="muted">Last checked</span>
                                <span>{updateLastCheckedMs ? new Date(updateLastCheckedMs).toLocaleString() : "--"}</span>
                              </div>
                            </div>

                            {!isTauriRuntime() && (
                              <div className="inline-alert info">
                                Updates are available in the desktop app build.
                              </div>
                            )}

                            <div className="button-row">
                              <button
                                type="button"
                                className="ghost"
                                onClick={handleManualUpdateCheck}
                                disabled={
                                  !isTauriRuntime() ||
                                  busy ||
                                  updateStatus === "checking" ||
                                  updateStatus === "installing"
                                }
                              >
                                {updateStatus === "checking" && updateLastCheckSource === "manual"
                                  ? "Checking..."
                                  : "Check for updates"}
                              </button>
                              {updateAvailable &&
                                updateStatus !== "installed" &&
                                updateStatus !== "installed_needs_restart" && (
                                <button
                                  type="button"
                                  onClick={() => setUpdateModalOpen(true)}
                                  disabled={busy || updateStatus === "installing"}
                                >
                                  Install and restart
                                </button>
                              )}
                            </div>

                            {updateStatus === "update_available" && updateAvailable && (
                              <div className="inline-alert info">
                                <strong>Update available</strong>
                                <span className="muted">Latest: {updateAvailable.version}</span>
                              </div>
                            )}
                            {updateStatus === "installed_needs_restart" && (
                              <div className="inline-alert info">
                                <strong>Update installed</strong>
                                <span className="muted">Please restart the app manually.</span>
                              </div>
                            )}
                            {updateStatus === "up_to_date" && updateLastCheckSource === "manual" && (
                              <div className="inline-alert info">You are up to date.</div>
                            )}
                            {updateStatus === "error" && updateError && (
                              <div className="inline-alert error">{updateError}</div>
                            )}
                          </div>

                          <div className="settings-group">
                            <h3>Notifications</h3>
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={config.notifications.enabled}
                                onChange={(event) =>
                                  setConfig((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          notifications: { ...prev.notifications, enabled: event.target.checked },
                                        }
                                      : prev,
                                  )
                                }
                              />
                              Enable notifications
                            </label>
                            <div className="muted settings-hint">
                              Controls desktop notifications for task completion.
                            </div>

                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={config.notifications.desktop_enabled}
                                disabled={!config.notifications.enabled}
                                onChange={(event) =>
                                  setConfig((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          notifications: {
                                            ...prev.notifications,
                                            desktop_enabled: event.target.checked,
                                          },
                                        }
                                      : prev,
                                  )
                                }
                              />
                              Desktop notifications
                            </label>
                            <div className="muted settings-hint">Show OS notifications when tasks complete.</div>

                            {!isTauriRuntime() && (
                              <div className="inline-alert info">
                                Desktop notifications are available in the desktop app build.
                              </div>
                            )}

                            <div className="stack">
                              <div className="inline-row">
                                <span className="muted">Permission</span>
                                <code>{isTauriRuntime() ? desktopNotificationPermission : "browser"}</code>
                              </div>
                            </div>

                            <div className="button-row">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => void refreshDesktopNotificationsPermission()}
                                disabled={!isTauriRuntime() || busy}
                              >
                                Refresh
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => void handleRequestDesktopNotificationsPermission()}
                                disabled={!isTauriRuntime() || busy}
                              >
                                Request permission
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleSendTestDesktopNotification()}
                                disabled={!isTauriRuntime() || busy}
                              >
                                Send test
                              </button>
                            </div>

                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={config.notifications.desktop_only_when_unfocused}
                                disabled={!config.notifications.enabled || !config.notifications.desktop_enabled}
                                onChange={(event) =>
                                  setConfig((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          notifications: {
                                            ...prev.notifications,
                                            desktop_only_when_unfocused: event.target.checked,
                                          },
                                        }
                                      : prev,
                                  )
                                }
                              />
                              Only when unfocused
                            </label>
                            <div className="muted settings-hint">
                              When enabled, notifications are sent only when the app window is not focused.
                            </div>

                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={config.notifications.desktop_on_error}
                                disabled={!config.notifications.enabled || !config.notifications.desktop_enabled}
                                onChange={(event) =>
                                  setConfig((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          notifications: { ...prev.notifications, desktop_on_error: event.target.checked },
                                        }
                                      : prev,
                                  )
                                }
                              />
                              Notify on errors
                            </label>
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={config.notifications.desktop_on_success}
                                disabled={!config.notifications.enabled || !config.notifications.desktop_enabled}
                                onChange={(event) =>
                                  setConfig((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          notifications: {
                                            ...prev.notifications,
                                            desktop_on_success: event.target.checked,
                                          },
                                        }
                                      : prev,
                                  )
                                }
                              />
                              Notify on success
                            </label>
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={config.notifications.desktop_on_cancelled}
                                disabled={!config.notifications.enabled || !config.notifications.desktop_enabled}
                                onChange={(event) =>
                                  setConfig((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          notifications: {
                                            ...prev.notifications,
                                            desktop_on_cancelled: event.target.checked,
                                          },
                                        }
                                      : prev,
                                  )
                                }
                              />
                              Notify on cancelled
                            </label>
                          </div>
	                        <div className="settings-group">
	                          <h3>Devices</h3>
	                          <label className="toggle">
	                            <input
	                              type="checkbox"
	                              checked={config.device.auto_refresh_enabled}
	                              onChange={(event) =>
	                                setConfig((prev) =>
	                                  prev
	                                    ? {
	                                        ...prev,
	                                        device: { ...prev.device, auto_refresh_enabled: event.target.checked },
	                                      }
	                                    : prev,
	                                )
	                              }
	                            />
	                            Auto-refresh device list
	                          </label>
                            <div className="muted settings-hint">
                              When enabled, the device list refreshes automatically in the background (no toast errors).
                            </div>
	                          <label>
	                            Refresh interval (sec)
	                            <input
	                              type="number"
	                              min={1}
	                              value={config.device.refresh_interval}
	                              onChange={(event) =>
	                                setConfig((prev) =>
	                                  prev
	                                    ? {
	                                        ...prev,
	                                        device: {
	                                          ...prev.device,
	                                          refresh_interval: Math.max(1, Number(event.target.value)),
	                                        },
	                                      }
	                                    : prev,
	                                )
	                              }
	                            />
	                          </label>
                          <div className="muted settings-hint">
                              Refresh interval for heartbeat fallback and recovery checks while auto-refresh is enabled. Minimum 1 second.
                            </div>
                            <div className="muted settings-hint">
                              Primary auto-refresh path uses <code>adb track-devices</code>. If tracking is idle, it may briefly fall back to
                              <code>adb devices</code> for a single summary refresh.
                            </div>
		                        </div>
	                        <div className="settings-group">
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
                          <div className="muted settings-hint">
                            Shell Commands timeout in seconds. Increase if your <code>adb shell</code> commands are cut
                            off.
                          </div>
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
                          <div className="muted settings-hint">
                            Run multi-device operations in parallel (Shell Commands, APK batch installs). Disable if you
                            see flaky ADB/USB behavior.
                          </div>
                        </div>
                        <div className="settings-group">
                          <h3>Screenshot</h3>
                          <label>
                            Display ID
                            <input
                              type="number"
                              min={-1}
                              value={config.screenshot.display_id}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        screenshot: { ...prev.screenshot, display_id: Number(event.target.value) },
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <div className="muted settings-hint">
                            Use <code>-1</code> for the default display. Use <code>0+</code> to target a specific
                            display.
                          </div>
                          <label>
                            Extra args
                            <input
                              value={config.screenshot.extra_args}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        screenshot: { ...prev.screenshot, extra_args: event.target.value },
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <div className="muted settings-hint">
                            Extra <code>screencap</code> flags, space-separated. Leave blank for defaults.
                          </div>
                        </div>
                        <div className="settings-group">
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
                          <div className="muted settings-hint">
                            Video bit rate (bits per second). Example: <code>4000000</code>.
                          </div>
                          <label>
                            Time limit (sec)
                            <input
                              type="number"
                              min={1}
                              max={180}
                              value={config.screen_record.time_limit_sec}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        screen_record: {
                                          ...prev.screen_record,
                                          time_limit_sec: Math.min(
                                            180,
                                            Math.max(1, Number(event.target.value) || 1),
                                          ),
                                        },
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <div className="muted settings-hint">Max duration per recording, 1 to 180 seconds.</div>
                          <label>
                            Display ID
                            <input
                              type="number"
                              min={-1}
                              value={config.screen_record.display_id}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        screen_record: {
                                          ...prev.screen_record,
                                          display_id: Number(event.target.value),
                                        },
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <div className="muted settings-hint">
                            Use <code>-1</code> for the default display. Use <code>0+</code> to target a specific
                            display.
                          </div>
                          <label>
                            Size
                            <input
                              placeholder="e.g. 1280x720"
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
                          <div className="muted settings-hint">
                            Optional size as <code>WIDTHxHEIGHT</code>. Leave blank to keep device native resolution.
                          </div>
                          <label>
                            Extra args
                            <input
                              value={config.screen_record.extra_args}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        screen_record: { ...prev.screen_record, extra_args: event.target.value },
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <div className="muted settings-hint">
                            Extra <code>screenrecord</code> flags, space-separated. Leave blank for defaults.
                          </div>
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
                          <div className="muted settings-hint">
                            Use HEVC/H.265 codec (smaller files, may not be supported on older devices).
                          </div>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={config.screen_record.bugreport}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        screen_record: { ...prev.screen_record, bugreport: event.target.checked },
                                      }
                                    : prev,
                                )
                              }
                            />
                            Bugreport overlay
                          </label>
                          <div className="muted settings-hint">
                            Overlay bugreport info in the recording (Android feature).
                          </div>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={config.screen_record.verbose}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? { ...prev, screen_record: { ...prev.screen_record, verbose: event.target.checked } }
                                    : prev,
                                )
                              }
                            />
                            Verbose output
                          </label>
                          <div className="muted settings-hint">
                            Enable verbose <code>screenrecord</code> output for troubleshooting.
                          </div>
                        </div>
                        <div className="settings-group">
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
                          <div className="muted settings-hint">Keep the device awake while mirroring.</div>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={config.scrcpy.turn_screen_off}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? { ...prev, scrcpy: { ...prev.scrcpy, turn_screen_off: event.target.checked } }
                                    : prev,
                                )
                              }
                            />
                            Turn screen off
                          </label>
                          <div className="muted settings-hint">
                            Turn off the device display while mirroring (stream stays on).
                          </div>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={config.scrcpy.disable_screensaver}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? { ...prev, scrcpy: { ...prev.scrcpy, disable_screensaver: event.target.checked } }
                                    : prev,
                                )
                              }
                            />
                            Disable screensaver
                          </label>
                          <div className="muted settings-hint">Disable screensaver while mirroring.</div>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={config.scrcpy.enable_audio_playback}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        scrcpy: { ...prev.scrcpy, enable_audio_playback: event.target.checked },
                                      }
                                    : prev,
                                )
                              }
                            />
                            Enable audio
                          </label>
                          <div className="muted settings-hint">Enable audio playback (depends on scrcpy version).</div>
                          <label>
                            Bit rate
                            <input
                              placeholder="e.g. 8M"
                              value={config.scrcpy.bitrate}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev ? { ...prev, scrcpy: { ...prev.scrcpy, bitrate: event.target.value } } : prev,
                                )
                              }
                            />
                          </label>
                          <div className="muted settings-hint">
                            Video bit rate. scrcpy format, e.g. <code>8M</code> or <code>16M</code>.
                          </div>
                          <label>
                            Max size
                            <input
                              type="number"
                              min={0}
                              value={config.scrcpy.max_size}
                              onChange={(event) =>
                                setConfig((prev) =>
                                  prev
                                    ? { ...prev, scrcpy: { ...prev.scrcpy, max_size: Math.max(0, Number(event.target.value)) } }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <div className="muted settings-hint">
                            Limit the max video dimension in pixels (<code>0</code> = no limit).
                          </div>
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
                          <div className="muted settings-hint">
                            Additional scrcpy CLI args, space-separated. Leave blank for defaults.
                          </div>
                        </div>
                      </div>
                      <div className="button-row settings-actions">
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

      {updateModalOpen && (
        <div className="modal-backdrop" onClick={closeUpdateModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Update</h3>
                <p className="muted">Download and install the latest version.</p>
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

              <div className="inline-alert info">
                <strong>Heads up</strong>
                <span className="muted">Installing will restart the app and interrupt ongoing tasks.</span>
              </div>

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

              {updateStatus === "error" && updateError && <div className="inline-alert error">{updateError}</div>}

              {updateAvailable?.body ? (
                <div className="stack">
                  <div className="muted">Release notes</div>
                  <pre className="update-notes">{updateAvailable.body.slice(0, 8000)}</pre>
                </div>
              ) : null}
            </div>

            <div className="button-row">
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
              <button className="ghost" onClick={closeUpdateModal} disabled={updateStatus === "installing"}>
                Later
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
