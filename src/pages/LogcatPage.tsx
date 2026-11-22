import {
  memo,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { LogLiveFilterBar } from "../components/LogLiveFilterBar";
import { LogcatOutput, type LogcatLineEntry } from "../components/LogcatOutput";
import { LOG_LEVELS } from "../logLevels";
import {
  removeLogTextChip,
  type LogTextChip,
  type LogTextChipKind,
} from "../logTextFilters";
import type { LogcatLevelsState, LogcatSourceMode } from "../logcat";
import {
  sliceLogcatLinesForRecording,
  type LogcatRecordingSyncSession,
} from "../logcatRecordingSync";
import type { ScreenRecordStatus } from "../types";

export type LogcatPageProps = {
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
  onLogcatExport: () => void;
  logcatAutoScroll: boolean;
  onLogcatAutoScrollChange: (next: boolean) => void;
  onLogcatMirrorLaunch: () => Promise<void>;
  onLogcatToggleSyncedRecording: () => Promise<void>;
  screenRecordStatusBySerial: Record<string, ScreenRecordStatus>;
  logcatSyncSessionBySerial: Record<string, LogcatRecordingSyncSession>;
  rawLogcatLines: LogcatLineEntry[];
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
  logcatFilteredLines: LogcatLineEntry[];
  logcatMatchCount: number;
  logcatMatchIndex: number;
  logcatSearchTerm: string;
  onLogcatSearchTermChange: (next: string) => void;
  onLogcatClearView: () => void;
  onLogcatPrevMatch: () => void;
  onLogcatNextMatch: () => void;
  logcatSearchPattern: RegExp | null;
  logcatOutputRef: RefObject<HTMLDivElement | null>;
};

export const LogcatPage = memo(function LogcatPage({
  activeSerial,
  activeDeviceIsIos,
  selectedSummaryLabel,
  isLogcatPopupWindow,
  logcatPopupSerial,
  popupTargetConnected,
  busy,
  hasLogcatPopupSelectableCandidate,
  onOpenLogcatPopupSelectorModal,
  logcatStatusTone,
  logcatStatusLabel,
  singleSelectionWarning,
  singleSelectionWarningMessage,
  canStartLogcat,
  canStopLogcat,
  onLogcatStart,
  onLogcatStop,
  onLogcatClearBuffer,
  onLogcatExport,
  logcatAutoScroll,
  onLogcatAutoScrollChange,
  onLogcatMirrorLaunch,
  onLogcatToggleSyncedRecording,
  screenRecordStatusBySerial,
  logcatSyncSessionBySerial,
  rawLogcatLines,
  onExportSyncedLogcatSlice,
  logcatActiveFilterSummary,
  logcatSourceMode,
  onLogcatSourceModeChange,
  logcatSourceValue,
  onLogcatSourceValueChange,
  logcatTextKind,
  onLogcatTextKindChange,
  logcatLiveFilter,
  onLogcatLiveFilterChange,
  onAddLogcatLiveFilter,
  sharedLogTextChips,
  setSharedLogTextChips,
  onEditSharedLogFilterChip,
  onClearSharedLogFilters,
  logcatPresets,
  logcatPresetSelected,
  onLogcatPresetSelectedChange,
  logcatPresetName,
  onLogcatPresetNameChange,
  selectedLogcatPresetName,
  onApplyLogcatPreset,
  onOpenPresetUpdateModal,
  onOpenPresetDeleteModal,
  onSaveLogcatPreset,
  logLevels,
  setLogLevels,
  logLevelsSummary,
  logcatPresetDirty,
  logcatSearchRegex,
  onLogcatSearchRegexChange,
  logcatSearchCaseSensitive,
  onLogcatSearchCaseSensitiveChange,
  logcatSearchOnly,
  onLogcatSearchOnlyChange,
  logcatLastExport,
  activeLogcatRunning,
  activeLogcatStatusLoading,
  logcatFilteredLines,
  logcatMatchCount,
  logcatMatchIndex,
  logcatSearchTerm,
  onLogcatSearchTermChange,
  onLogcatClearView,
  onLogcatPrevMatch,
  onLogcatNextMatch,
  logcatSearchPattern,
  logcatOutputRef,
}: LogcatPageProps) {
  const [logcatSearchOpen, setLogcatSearchOpen] = useState(false);
  const [logcatLiveFilterExpanded, setLogcatLiveFilterExpanded] = useState(false);

  return (
    <div className="page-section page-section-stretch logcat-workspace">
      <div className="page-header">
        <div>
          <h1>Logs</h1>
          <p className="muted">Filters, presets, and search for streaming logs.</p>
        </div>
      </div>
      <section className="panel panel-stretch logcat-panel">
        <div className="panel-header">
          <div className="logcat-header-main">
            <div>
              <h2>{activeDeviceIsIos ? "iOS Syslog Stream" : "Logcat Stream"}</h2>
              <span>{selectedSummaryLabel}</span>
            </div>
            {!isLogcatPopupWindow && (
              <button
                type="button"
                className="ghost"
                onClick={onOpenLogcatPopupSelectorModal}
                disabled={busy || !hasLogcatPopupSelectableCandidate}
              >
                Open selected popup
              </button>
            )}
          </div>
          <span className={`status-pill ${logcatStatusTone}`}>{logcatStatusLabel}</span>
        </div>
        {singleSelectionWarning && (
          <div className="inline-alert info">
            <strong>Primary device in use</strong>
            <span>{singleSelectionWarningMessage}</span>
          </div>
        )}
        {isLogcatPopupWindow && logcatPopupSerial && !popupTargetConnected && (
          <div className="inline-alert error">
            <strong>Device disconnected</strong>
            <span className="muted">
              Target device <code>{logcatPopupSerial}</code> is not connected.
            </span>
          </div>
        )}
        <div className="logcat-toolbar">
          <div className="logcat-toolbar-row">
            <div className="logcat-toolbar-cluster">
              <div className="logcat-button-group">
                <button onClick={onLogcatStart} disabled={!canStartLogcat}>
                  Start
                </button>
                <button onClick={onLogcatStop} disabled={!canStopLogcat}>
                  Stop
                </button>
              </div>
              <div className="logcat-button-group">
                <button onClick={onLogcatClearBuffer} disabled={busy || !activeSerial}>
                  {activeDeviceIsIos ? "Clear View" : "Clear Buffer"}
                </button>
                <button className="ghost" onClick={onLogcatExport} disabled={busy || !activeSerial}>
                  Export
                </button>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={logcatAutoScroll}
                  onChange={(event) => onLogcatAutoScrollChange(event.target.checked)}
                />
                Follow newest
              </label>
              {!activeDeviceIsIos && activeSerial && (
                <div className="logcat-button-group">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void onLogcatMirrorLaunch()}
                    disabled={busy}
                    title="Launch scrcpy mirror alongside Logcat"
                  >
                    Mirror (scrcpy)
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void onLogcatToggleSyncedRecording()}
                    disabled={busy}
                    title="Record screen while marking start/end window in Logcat"
                  >
                    {screenRecordStatusBySerial[activeSerial]?.running
                      ? "Stop Sync Record"
                      : "Record + Sync"}
                  </button>
                  {logcatSyncSessionBySerial[activeSerial]?.endedAtMs != null && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void onExportSyncedLogcatSlice()}
                      disabled={busy}
                    >
                      Export Slice (
                      {
                        sliceLogcatLinesForRecording(
                          rawLogcatLines,
                          logcatSyncSessionBySerial[activeSerial],
                        ).length
                      }
                      )
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="logcat-toolbar-row">
            <div className="logcat-toolbar-group logcat-source-group">
              <div className="logcat-label-row">
                <span>Source</span>
                <span className="muted">Active: {logcatActiveFilterSummary || "All"}</span>
              </div>
              {activeDeviceIsIos && (
                <div className="inline-alert info">
                  <strong>iOS syslog</strong>
                  <span>Source filters are Android-only and will be ignored for iOS devices.</span>
                </div>
              )}
              <div className="inline-row">
                <select
                  className="logcat-select"
                  value={logcatSourceMode}
                  disabled={activeDeviceIsIos}
                  onChange={(event) =>
                    onLogcatSourceModeChange(event.target.value as LogcatSourceMode)
                  }
                >
                  <option value="tag">Tag</option>
                  <option value="package">Package</option>
                  <option value="raw">Raw</option>
                </select>
                <input
                  value={logcatSourceValue}
                  disabled={activeDeviceIsIos}
                  onChange={(event) => onLogcatSourceValueChange(event.target.value)}
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
          onKindChange={onLogcatTextKindChange}
          value={logcatLiveFilter}
          onValueChange={onLogcatLiveFilterChange}
          onAdd={onAddLogcatLiveFilter}
          chips={sharedLogTextChips}
          onRemoveChip={(chipId) =>
            setSharedLogTextChips((prev) => removeLogTextChip(prev, chipId))
          }
          onEditChip={onEditSharedLogFilterChip}
          onClearChips={onClearSharedLogFilters}
          presets={logcatPresets}
          presetSelected={logcatPresetSelected}
          onPresetSelectedChange={(next) => {
            onLogcatPresetSelectedChange(next);
            if (next) {
              onLogcatPresetNameChange(next);
            }
          }}
          presetName={logcatPresetName}
          onPresetNameChange={onLogcatPresetNameChange}
          hasSelectedPreset={Boolean(selectedLogcatPresetName)}
          onApplyPreset={onApplyLogcatPreset}
          onUpdatePreset={onOpenPresetUpdateModal}
          onDeletePreset={onOpenPresetDeleteModal}
          onSavePreset={() => {
            onSaveLogcatPreset(logcatPresetName);
          }}
          showPresetRow
          disabled={busy}
          filtersCount={sharedLogTextChips.length}
          activePresetLabel={selectedLogcatPresetName}
          levelsSummary={logLevelsSummary}
          isPresetDirty={logcatPresetDirty}
          selectClassName="logcat-select"
          compact
          expanded={logcatLiveFilterExpanded}
          onToggleExpanded={() => setLogcatLiveFilterExpanded((prev) => !prev)}
          advancedOptions={
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
                      onChange={(event) => onLogcatSearchRegexChange(event.target.checked)}
                    />
                    Regex
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={logcatSearchCaseSensitive}
                      onChange={(event) => onLogcatSearchCaseSensitiveChange(event.target.checked)}
                    />
                    Case sensitive
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={logcatSearchOnly}
                      onChange={(event) => onLogcatSearchOnlyChange(event.target.checked)}
                    />
                    Matches only
                  </label>
                </div>
              </div>
            </div>
          }
        />
        {logcatLastExport && (
          <div className="inline-alert info">
            <strong>Exported</strong>
            <span>{logcatLastExport}</span>
          </div>
        )}
        {activeSerial &&
          activeLogcatRunning &&
          !activeLogcatStatusLoading &&
          logcatFilteredLines.length === 0 && (
            <div className="inline-alert info">
              <strong>Waiting for logs</strong>
              <span className="muted">
                Logcat is running. Generate activity on device or adjust the active filters.
              </span>
            </div>
          )}
        <div className="logcat-output-wrapper logcat-output-wrapper-stretch">
          <div className="logcat-output-actions">
            <button
              type="button"
              className="ghost"
              onClick={onLogcatClearView}
              disabled={busy || !activeSerial}
            >
              Clear View
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setLogcatSearchOpen((prev) => !prev)}
              disabled={busy}
            >
              {logcatSearchOpen ? "Close Search" : "Search"}
            </button>
          </div>
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
                  onChange={(event) => onLogcatSearchTermChange(event.target.value)}
                  placeholder="Find in logs..."
                />
                <div className="button-row compact">
                  <button type="button" onClick={onLogcatPrevMatch} disabled={busy}>
                    Prev
                  </button>
                  <button type="button" onClick={onLogcatNextMatch} disabled={busy}>
                    Next
                  </button>
                </div>
              </div>
              <span className="muted">
                Match {logcatMatchCount ? logcatMatchIndex + 1 : 0} / {logcatMatchCount}
              </span>
            </div>
          ) : null}
          <LogcatOutput
            entries={logcatFilteredLines}
            searchPattern={logcatSearchPattern}
            autoScroll={logcatAutoScroll}
            outputRef={logcatOutputRef}
          />
        </div>
      </section>
    </div>
  );
});
