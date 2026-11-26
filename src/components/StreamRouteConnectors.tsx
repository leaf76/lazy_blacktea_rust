import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  LOGCAT_LINE_HEIGHT_PX,
  LOGCAT_OUTPUT_PADDING_PX,
  type LogcatLineEntry,
} from "./LogcatOutput";
import {
  filterLogcatEntriesByBaseFilters,
  filterLogcatEntriesBySearch,
  mergeLogcatEntriesById,
  type LogcatBaseFilterState,
  type LogcatLevelsState,
  type LogcatSourceMode,
} from "../logcat";
import type { LogTextChip, LogTextChipKind } from "../logTextFilters";
import type { LogcatRecordingSyncSession } from "../logcatRecordingSync";
import { EMPTY_NET_PROFILER_STATE, type NetProfilerState } from "../netProfilerState";
import { EMPTY_PERF_MONITOR_STATE, type PerfMonitorState } from "../perfState";
import { useStreamSelector } from "../streamStore";
import { createDefaultTerminalState } from "../terminalBuffer";
import type { DeviceInfo, ScreenRecordStatus } from "../types";

const EMPTY_LOGCAT_ENTRIES: LogcatLineEntry[] = [];

const LazyLogcatPage = lazy(async () => {
  const module = await import("../pages/LogcatPage");
  return { default: module.LogcatPage };
});

const LazyPerformancePage = lazy(async () => {
  const module = await import("./PerformancePage");
  return { default: module.PerformancePage };
});

const LazyNetworkBreakdownPanel = lazy(async () => {
  const module = await import("./NetworkBreakdownPanel");
  return { default: module.NetworkBreakdownPanel };
});

const LazyDeviceTerminalPanel = lazy(async () => {
  const module = await import("./DeviceTerminalPanel");
  return { default: module.DeviceTerminalPanel };
});

export type LogcatRouteSectionProps = {
  activeSerial: string | null;
  activeDeviceIsIos: boolean;
  selectedSummaryLabel: string;
  isLogcatPopupWindow: boolean;
  logcatPopupSerial: string | null;
  popupTargetConnected: boolean;
  busy: boolean;
  hasLogcatPopupSelectableCandidate: boolean;
  onOpenLogcatPopupSelectorModal: () => void;
  logcatStatusTone: string;
  logcatStatusLabel: string;
  singleSelectionWarning: boolean;
  singleSelectionWarningMessage: string;
  canStartLogcat: boolean;
  canStopLogcat: boolean;
  onLogcatStart: () => void;
  onLogcatStop: () => void;
  onLogcatClearBuffer: () => void;
  onLogcatExportLines: (lines: LogcatLineEntry[]) => Promise<void>;
  logcatAutoScroll: boolean;
  onLogcatAutoScrollChange: (next: boolean) => void;
  onLogcatMirrorLaunch: () => Promise<void>;
  onLogcatToggleSyncedRecording: () => Promise<void>;
  screenRecordStatusBySerial: Record<string, ScreenRecordStatus>;
  logcatSyncSessionBySerial: Record<string, LogcatRecordingSyncSession>;
  onExportSyncedLogcatSlice: () => Promise<void>;
  logcatActiveFilterSummary: string;
  logcatSourceMode: LogcatSourceMode;
  onLogcatSourceModeChange: (next: LogcatSourceMode) => void;
  logcatSourceValue: string;
  onLogcatSourceValueChange: (next: string) => void;
  logcatTextKind: LogTextChipKind;
  onLogcatTextKindChange: (next: LogTextChipKind) => void;
  logcatLiveFilter: string;
  onLogcatLiveFilterChange: (next: string) => void;
  onAddLogcatLiveFilter: () => void;
  sharedLogTextChips: LogTextChip[];
  setSharedLogTextChips: Dispatch<SetStateAction<LogTextChip[]>>;
  onEditSharedLogFilterChip: (chip: LogTextChip) => void;
  onClearSharedLogFilters: () => void;
  logcatPresets: Array<{ name: string }>;
  logcatPresetSelected: string;
  onLogcatPresetSelectedChange: (next: string) => void;
  logcatPresetName: string;
  onLogcatPresetNameChange: (next: string) => void;
  selectedLogcatPresetName: string | undefined;
  onApplyLogcatPreset: (name: string) => void;
  onOpenPresetUpdateModal: (name: string) => void;
  onOpenPresetDeleteModal: (name: string) => void;
  onSaveLogcatPreset: (name: string) => void;
  logLevels: LogcatLevelsState;
  setLogLevels: Dispatch<SetStateAction<LogcatLevelsState>>;
  logLevelsSummary: string;
  logcatPresetDirty: boolean;
  logcatSearchRegex: boolean;
  onLogcatSearchRegexChange: (next: boolean) => void;
  logcatSearchCaseSensitive: boolean;
  onLogcatSearchCaseSensitiveChange: (next: boolean) => void;
  logcatSearchOnly: boolean;
  onLogcatSearchOnlyChange: (next: boolean) => void;
  logcatLastExport: string | null;
  activeLogcatRunning: boolean;
  activeLogcatStatusLoading: boolean;
  logcatBaseFilterState: LogcatBaseFilterState;
  logcatBaseFilterActive: boolean;
  logcatSearchTerm: string;
  onLogcatSearchTermChange: (next: string) => void;
  onLogcatClearView: () => void;
  logcatSearchPattern: RegExp | null;
  logcatOutputRef: RefObject<HTMLDivElement | null>;
};

export const LogcatRouteSection = memo(function LogcatRouteSection({
  activeSerial,
  logcatBaseFilterState,
  logcatBaseFilterActive,
  logcatSearchTerm,
  logcatSearchRegex,
  logcatSearchCaseSensitive,
  logcatSearchOnly,
  logcatOutputRef,
  onLogcatExportLines,
  ...rest
}: LogcatRouteSectionProps) {
  const rawLogcatLines = useStreamSelector(
    (store) => (activeSerial ? store.logcatLines[activeSerial] ?? EMPTY_LOGCAT_ENTRIES : EMPTY_LOGCAT_ENTRIES),
  );
  const logcatRetainedEntries = useStreamSelector(
    (store) =>
      activeSerial
        ? store.logcatRetainedBySerial[activeSerial] ?? EMPTY_LOGCAT_ENTRIES
        : EMPTY_LOGCAT_ENTRIES,
  );
  const [logcatMatchIndex, setLogcatMatchIndex] = useState(0);

  const logcatRawBaseFiltered = useMemo(
    () => filterLogcatEntriesByBaseFilters(rawLogcatLines, logcatBaseFilterState),
    [rawLogcatLines, logcatBaseFilterState],
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

  const scrollToLogcatMatch = useCallback(
    (index: number) => {
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
      const offset = Math.max(0, target - container.clientHeight / 2 + LOGCAT_OUTPUT_PADDING_PX);
      container.scrollTop = offset;
    },
    [logcatFiltered.matchIds, logcatLineIndexById, logcatOutputRef],
  );

  const handleLogcatNextMatch = useCallback(() => {
    if (!logcatFiltered.matchIds.length) {
      return;
    }
    const nextIndex = (logcatMatchIndex + 1) % logcatFiltered.matchIds.length;
    setLogcatMatchIndex(nextIndex);
    scrollToLogcatMatch(nextIndex);
  }, [logcatFiltered.matchIds.length, logcatMatchIndex, scrollToLogcatMatch]);

  const handleLogcatPrevMatch = useCallback(() => {
    if (!logcatFiltered.matchIds.length) {
      return;
    }
    const prevIndex =
      (logcatMatchIndex - 1 + logcatFiltered.matchIds.length) % logcatFiltered.matchIds.length;
    setLogcatMatchIndex(prevIndex);
    scrollToLogcatMatch(prevIndex);
  }, [logcatFiltered.matchIds.length, logcatMatchIndex, scrollToLogcatMatch]);

  const handleLogcatExport = useCallback(() => {
    void onLogcatExportLines(logcatFiltered.lines);
  }, [logcatFiltered.lines, onLogcatExportLines]);

  return (
    <Suspense fallback={null}>
      <LazyLogcatPage
        {...rest}
        activeSerial={activeSerial}
        rawLogcatLines={rawLogcatLines}
        onLogcatExport={handleLogcatExport}
        logcatFilteredLines={logcatFiltered.lines}
        logcatMatchCount={logcatFiltered.matchIds.length}
        logcatMatchIndex={logcatMatchIndex}
        logcatSearchTerm={logcatSearchTerm}
        logcatSearchRegex={logcatSearchRegex}
        logcatSearchCaseSensitive={logcatSearchCaseSensitive}
        logcatSearchOnly={logcatSearchOnly}
        onLogcatPrevMatch={handleLogcatPrevMatch}
        onLogcatNextMatch={handleLogcatNextMatch}
        logcatOutputRef={logcatOutputRef}
      />
    </Suspense>
  );
});

type NetworkConnectorProps = {
  activeSerial: string | null;
  deviceStatus: string;
  busy: boolean;
  intervalMs: number;
  topN: number;
  search: string;
  windowMs: number;
  focusUid: number | null;
  pinnedUids: number[];
  onIntervalChange: (next: number) => void;
  onTopNChange: (next: number) => void;
  onSearchChange: (next: string) => void;
  onWindowMsChange: (next: number) => void;
  onStart: () => void;
  onStop: () => void;
  onFocusUidChange: (serial: string, uid: number | null) => void;
  onToggleFocusUid: (serial: string, uid: number) => void;
  onApplyPinnedUids: (serial: string, nextPinnedUids: number[], toastMessage: string) => void;
  onNotifyInfo: (message: string) => void;
};

const NetworkBreakdownConnector = memo(function NetworkBreakdownConnector({
  activeSerial,
  ...props
}: NetworkConnectorProps) {
  const netState = useStreamSelector<NetProfilerState>((store) =>
    activeSerial ? store.netBySerial[activeSerial] ?? EMPTY_NET_PROFILER_STATE : EMPTY_NET_PROFILER_STATE,
  );

  return (
    <Suspense fallback={null}>
      <LazyNetworkBreakdownPanel {...props} serial={activeSerial} netState={netState} />
    </Suspense>
  );
});

export type PerformanceRouteConnectorProps = {
  activeSerial: string | null;
  deviceStatus: string;
  busy: boolean;
  singleSelectionWarning: boolean;
  singleSelectionWarningMessage: string;
  selectedSummaryLabel: string;
  onGoToDevices: () => void;
  onPerfStart: () => void;
  onPerfStop: () => void;
  networkProps: NetworkConnectorProps;
};

export const PerformanceRouteConnector = memo(function PerformanceRouteConnector({
  activeSerial,
  networkProps,
  ...rest
}: PerformanceRouteConnectorProps) {
  const perfState = useStreamSelector<PerfMonitorState>((store) =>
    activeSerial ? store.perfBySerial[activeSerial] ?? EMPTY_PERF_MONITOR_STATE : EMPTY_PERF_MONITOR_STATE,
  );

  return (
    <Suspense fallback={null}>
      <LazyPerformancePage
        {...rest}
        activeSerial={activeSerial}
        perfState={perfState}
        networkBreakdown={<NetworkBreakdownConnector {...networkProps} />}
      />
    </Suspense>
  );
});

export type NetworkRouteConnectorProps = {
  activeSerial: string | null;
  singleSelectionWarning: boolean;
  singleSelectionWarningMessage: string;
  onGoToDevices: () => void;
  networkProps: NetworkConnectorProps;
};

export const NetworkRouteConnector = memo(function NetworkRouteConnector({
  activeSerial,
  singleSelectionWarning,
  singleSelectionWarningMessage,
  onGoToDevices,
  networkProps,
}: NetworkRouteConnectorProps) {
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
            <button className="ghost" onClick={onGoToDevices}>
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

      <NetworkBreakdownConnector {...networkProps} />
    </div>
  );
});

export const SelectedTerminalCountText = memo(function SelectedTerminalCountText({
  selectedSerials,
}: {
  selectedSerials: string[];
}) {
  const selectedConnectedCount = useStreamSelector((store) =>
    selectedSerials.reduce(
      (total, serial) => total + (store.terminalBySerial[serial]?.connected ? 1 : 0),
      0,
    ),
  );
  return (
    <span className="muted shell-terminal-toolbar-meta">
      {selectedSerials.length ? `${selectedConnectedCount}/${selectedSerials.length} connected` : "No selection"}
    </span>
  );
});

export type TerminalWorkspaceConnectorProps = {
  terminalActiveSerials: string[];
  devices: DeviceInfo[];
  busy: boolean;
  onSelectSerial: (serial: string) => void;
  onConnect: (serial: string) => Promise<void>;
  onDisconnect: (serial: string) => Promise<void>;
  onRemoveSession: (serial: string) => Promise<void>;
  onSend: (serial: string, command: string) => void;
  onInterrupt: (serial: string) => void;
  onClear: (serial: string) => void;
  onToggleAutoScroll: (serial: string, enabled: boolean) => void;
};

export const TerminalWorkspaceConnector = memo(function TerminalWorkspaceConnector({
  terminalActiveSerials,
  devices,
  busy,
  onSelectSerial,
  onConnect,
  onDisconnect,
  onRemoveSession,
  onSend,
  onInterrupt,
  onClear,
  onToggleAutoScroll,
}: TerminalWorkspaceConnectorProps) {
  const terminalBySerial = useStreamSelector((store) => store.terminalBySerial);

  return (
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
                    onClick={() => onSelectSerial(serial)}
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
                          ? void onDisconnect(serial)
                          : void onConnect(serial)
                      }
                      disabled={busy}
                    >
                      {terminalState.connected ? "Disconnect" : "Connect"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void onRemoveSession(serial)}
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
                <Suspense key={serial} fallback={null}>
                  <LazyDeviceTerminalPanel
                    serial={serial}
                    state={state}
                    disabled={busy}
                    onConnect={(targetSerial) => void onConnect(targetSerial)}
                    onDisconnect={(targetSerial) => void onDisconnect(targetSerial)}
                    onSend={onSend}
                    onInterrupt={onInterrupt}
                    onClear={onClear}
                    onToggleAutoScroll={onToggleAutoScroll}
                  />
                </Suspense>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
