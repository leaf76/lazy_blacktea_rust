import type { Dispatch, SetStateAction } from "react";
import {
  DEVELOPER_OPTIONS,
  type DeveloperOptionDefinition,
  type DeveloperOptionKey,
  type DeveloperOptionSnapshot,
  type DeveloperOptionValue,
} from "./developerOptions";
import {
  hasPendingDeveloperOptionValue,
  resolveDeveloperOptionValueForUi,
  resolveDeveloperOptionValueLabel,
  type DeveloperOptionDeviceReadStatus,
  type DeveloperOptionDivergenceRow,
  type DeveloperOptionPendingMap,
  type DeveloperOptionsApplyMode,
  type DeveloperOptionsMatrixLogBufferState,
  type DeveloperOptionsMatrixRefreshMode,
  type DeveloperOptionsMatrixState,
  type DeveloperOptionsScope,
} from "./developerOptionsUiState";

export type DeveloperOptionsGroup = {
  category: DeveloperOptionDefinition["category"];
  label: string;
  options: DeveloperOptionDefinition[];
};

export type DeveloperOptionsPageProps = {
  activeSerial: string | null;
  busy: boolean;
  singleSelectionWarning: boolean;
  singleSelectionWarningMessage: string;
  developerOptionsApplyMode: DeveloperOptionsApplyMode;
  setDeveloperOptionsApplyMode: Dispatch<SetStateAction<DeveloperOptionsApplyMode>>;
  developerOptionsBatchApplying: boolean;
  developerOptionsPendingCount: number;
  developerOptionsScope: DeveloperOptionsScope;
  developerOptionsLoading: boolean;
  developerOptionsRefreshing: boolean;
  developerOptionsLastReadLabel: string;
  developerOptionsSnapshot: DeveloperOptionSnapshot;
  developerOptionPendingByKey: DeveloperOptionPendingMap;
  developerOptionSupportedByKey: Record<DeveloperOptionKey, boolean>;
  developerOptionMessageByKey: Record<DeveloperOptionKey, string | null>;
  developerOptionsApplyingKey: DeveloperOptionKey | null;
  developerOptionsError: string | null;
  groupedOptions: DeveloperOptionsGroup[];
  developerOptionsMatrixSerials: { onlineSerials: string[]; offlineSerials: string[] };
  developerOptionsMatrixState: DeveloperOptionsMatrixState;
  developerOptionsMatrixRefreshing: boolean;
  developerOptionsMatrixStale: boolean;
  developerOptionsMatrixStaleMessage: string;
  developerOptionsMatrixLogBufferState: DeveloperOptionsMatrixLogBufferState;
  developerOptionsMatrixLogBufferLastReadLabel: string;
  developerOptionsMatrixLogBufferError: string | null;
  developerOptionsMatrixRefreshMode: DeveloperOptionsMatrixRefreshMode;
  developerOptionsDivergenceByKey: Record<DeveloperOptionKey, DeveloperOptionDivergenceRow>;
  developerOptionsMatrixLoadingSerialSet: Set<string>;
  developerOptionsDivergentSerialSetByKey: Record<DeveloperOptionKey, Set<string>>;
  onNavigateDevices: () => void;
  onRefreshPrimary: (hasReadableOptions: boolean) => void;
  onApplyPending: () => void;
  onDiscardPending: () => void;
  onRefreshMatrix: (serials: string[]) => void;
  onLoadMatrixLogBuffer: () => void;
  onRequestApply: (optionKey: DeveloperOptionKey, value: Exclude<DeveloperOptionValue, null>) => void;
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

const DeveloperOptionsPage = ({
  activeSerial,
  busy,
  singleSelectionWarning,
  singleSelectionWarningMessage,
  developerOptionsApplyMode,
  setDeveloperOptionsApplyMode,
  developerOptionsBatchApplying,
  developerOptionsPendingCount,
  developerOptionsScope,
  developerOptionsLoading,
  developerOptionsRefreshing,
  developerOptionsLastReadLabel,
  developerOptionsSnapshot,
  developerOptionPendingByKey,
  developerOptionSupportedByKey,
  developerOptionMessageByKey,
  developerOptionsApplyingKey,
  developerOptionsError,
  groupedOptions,
  developerOptionsMatrixSerials,
  developerOptionsMatrixState,
  developerOptionsMatrixRefreshing,
  developerOptionsMatrixStale,
  developerOptionsMatrixStaleMessage,
  developerOptionsMatrixLogBufferState,
  developerOptionsMatrixLogBufferLastReadLabel,
  developerOptionsMatrixLogBufferError,
  developerOptionsMatrixRefreshMode,
  developerOptionsDivergenceByKey,
  developerOptionsMatrixLoadingSerialSet,
  developerOptionsDivergentSerialSetByKey,
  onNavigateDevices,
  onRefreshPrimary,
  onApplyPending,
  onDiscardPending,
  onRefreshMatrix,
  onLoadMatrixLogBuffer,
  onRequestApply,
}: DeveloperOptionsPageProps) => {
  if (!activeSerial) {
    return (
      <div className="page-section developer-options-page">
        <div className="page-header">
          <div>
            <h1>Developer Options</h1>
            <p className="muted">Read from the primary device, then apply instantly or in staged batch mode.</p>
          </div>
        </div>
        <section className="panel empty-state">
          <div>
            <h2>Select a device</h2>
            <p className="muted">Choose a primary device to read developer options.</p>
          </div>
          <div className="button-row">
            <button className="ghost" onClick={onNavigateDevices} disabled={busy}>
              Go to Device Manager
            </button>
          </div>
        </section>
      </div>
    );
  }

  const supportedCount = DEVELOPER_OPTIONS.filter((option) => developerOptionSupportedByKey[option.key]).length;
  const hasReadableOptions = supportedCount > 0;
  const refreshBusy = developerOptionsLoading || developerOptionsRefreshing;
  const hasOnlineTarget = developerOptionsScope.hasOnlineTarget;
  const batchMode = developerOptionsApplyMode === "selected_batch";
  const batchApplyDisabled =
    developerOptionsPendingCount === 0 ||
    !hasOnlineTarget ||
    busy ||
    developerOptionsBatchApplying ||
    developerOptionsLoading;
  const batchDiscardDisabled = developerOptionsPendingCount === 0 || busy || developerOptionsBatchApplying;
  const applyTargetSummary = batchMode
    ? developerOptionsScope.selectedOnlineSerials.length > 0
      ? `${developerOptionsScope.selectedOnlineSerials.length} online selected target${
          developerOptionsScope.selectedOnlineSerials.length > 1 ? "s" : ""
        }.`
      : "No online selected devices. Batch apply is disabled."
    : developerOptionsScope.primaryOnline
      ? `Primary target: ${activeSerial}`
      : `Primary device ${activeSerial} is offline. Actions are disabled.`;

  const matrixSelectedCount = developerOptionsScope.uniqueSelectedSerials.length;
  const matrixOnlineSerials = developerOptionsMatrixSerials.onlineSerials;
  const matrixOfflineSerials = developerOptionsMatrixSerials.offlineSerials;
  const matrixLastUpdatedLabel = developerOptionsMatrixState.lastRefreshAt
    ? new Date(developerOptionsMatrixState.lastRefreshAt).toLocaleTimeString()
    : "Not loaded yet";
  const matrixBaselineSnapshot = developerOptionsMatrixState.bySerial[activeSerial] ?? null;
  const matrixBaselineKnown = Boolean(matrixBaselineSnapshot?.lastReadAt);
  const matrixHasBaseline = matrixBaselineSnapshot?.status === "success";
  const matrixRefreshDisabled = developerOptionsMatrixRefreshing || matrixOnlineSerials.length === 0;
  const logBufferLoadBusy = developerOptionsMatrixLogBufferState === "loading";
  const matrixLoadLogBufferDisabled =
    logBufferLoadBusy || developerOptionsMatrixRefreshing || matrixOnlineSerials.length === 0;
  const matrixRefreshModeLabel =
    developerOptionsMatrixRefreshMode === "full" ? "Mode: Full" : "Mode: Fast";
  const matrixLogBufferStatusLabel =
    developerOptionsMatrixLogBufferState === "loading"
      ? "Loading log buffer"
      : developerOptionsMatrixLogBufferState === "loaded"
        ? `Log buffer loaded at ${developerOptionsMatrixLogBufferLastReadLabel}`
        : developerOptionsMatrixLogBufferState === "error"
          ? "Log buffer load failed"
          : "Log buffer not loaded";

  return (
    <div className="page-section developer-options-page">
      <div className="page-header">
        <div>
          <h1>Developer Options</h1>
          <p className="muted">Read from the primary device, then apply instantly or in staged batch mode.</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => onRefreshPrimary(hasReadableOptions)}
            disabled={refreshBusy}
          >
            {refreshBusy ? "Refreshing..." : "Refresh primary"}
          </button>
          <span className={`status-pill ${refreshBusy ? "busy" : hasReadableOptions ? "ok" : "warn"}`}>
            {refreshBusy ? "Refreshing" : hasReadableOptions ? "Ready" : "Unavailable"}
          </span>
        </div>
      </div>

      {singleSelectionWarning && (
        <div className="inline-alert info">
          <strong>Primary device in use</strong>
          <span>{singleSelectionWarningMessage}</span>
        </div>
      )}

      <div className="inline-alert info developer-options-prereq-alert">
        <strong>Enable on phone first</strong>
        <span>On device: Settings &gt; About phone &gt; tap Build number 7 times.</span>
        <span>Then go to Settings &gt; System &gt; Developer options, and enable USB debugging.</span>
      </div>

      <section className="panel developer-options-scope-panel">
        <div className="developer-options-scope-grid">
          <section className="developer-options-scope-card">
            <h2>Read Source</h2>
            <p className="muted">Primary snapshot source</p>
            <p className="developer-options-read-serial">
              <code>{activeSerial}</code>
            </p>
            <p className="muted developer-options-target-summary">Last updated: {developerOptionsLastReadLabel}</p>
            {developerOptionsRefreshing && <span className="status-pill busy">Refreshing snapshot...</span>}
          </section>

          <section className="developer-options-scope-card">
            <h2>Apply Mode</h2>
            <div className="developer-options-mode-switch" role="group" aria-label="Developer options apply mode">
              <button
                type="button"
                className={`ghost developer-options-mode-button${
                  developerOptionsApplyMode === "primary_instant" ? " is-active" : ""
                }`}
                onClick={() => setDeveloperOptionsApplyMode("primary_instant")}
                disabled={busy || developerOptionsBatchApplying}
              >
                Primary instant
              </button>
              <button
                type="button"
                className={`ghost developer-options-mode-button${
                  developerOptionsApplyMode === "selected_batch" ? " is-active" : ""
                }`}
                onClick={() => setDeveloperOptionsApplyMode("selected_batch")}
                disabled={busy || developerOptionsBatchApplying}
              >
                Selected batch
              </button>
            </div>

            <p className="muted developer-options-target-summary">{applyTargetSummary}</p>
            {batchMode && developerOptionsScope.selectedOfflineSerials.length > 0 && (
              <p className="muted developer-options-target-summary">
                {developerOptionsScope.selectedOfflineSerials.length} offline selected device
                {developerOptionsScope.selectedOfflineSerials.length > 1 ? "s" : ""} will be skipped.
              </p>
            )}
          </section>
        </div>

        {batchMode && (
          <div className="developer-options-batch-strip">
            <div className="developer-options-batch-copy">
              <strong>
                {developerOptionsPendingCount} pending change{developerOptionsPendingCount > 1 ? "s" : ""}
              </strong>
              <p className="muted">
                Current values shown in cards come from primary snapshot. Pending values apply only after batch submit.
              </p>
            </div>
            <div className="button-row">
              <button onClick={onApplyPending} disabled={batchApplyDisabled}>
                {developerOptionsBatchApplying
                  ? "Applying..."
                  : `Apply ${developerOptionsPendingCount} change${developerOptionsPendingCount > 1 ? "s" : ""}`}
              </button>
              <button className="ghost" onClick={onDiscardPending} disabled={batchDiscardDisabled}>
                Discard all
              </button>
            </div>
          </div>
        )}

        {batchMode && (
          <div className="inline-alert info">
            <strong>Primary snapshot display</strong>
            <span>Card values are read from the primary device. Batch mode only controls write targets.</span>
          </div>
        )}

        {batchMode && developerOptionsScope.uniqueSelectedSerials.length === 0 && (
          <div className="inline-alert info">
            <strong>No devices selected for batch apply</strong>
            <span>Select devices from the top bar to stage and apply batch changes.</span>
          </div>
        )}

        {batchMode && developerOptionsScope.uniqueSelectedSerials.length > 0 && !hasOnlineTarget && (
          <div className="inline-alert info">
            <strong>No online batch targets</strong>
            <span>Current selected devices are offline. Reconnect devices before applying pending changes.</span>
          </div>
        )}

        {!batchMode && !hasOnlineTarget && (
          <div className="inline-alert info">
            <strong>No online apply target</strong>
            <span>Connect the primary device before changing options in instant mode.</span>
          </div>
        )}

        {!batchMode && developerOptionsScope.skippedCount > 0 && (
          <p className="muted developer-options-target-summary">
            {developerOptionsScope.skippedCount} offline selected device
            {developerOptionsScope.skippedCount > 1 ? "s" : ""} are ignored in primary mode.
          </p>
        )}

        {batchMode && developerOptionsScope.skippedCount > 0 && (
          <p className="muted developer-options-target-summary">
            {developerOptionsScope.skippedCount} offline selected device
            {developerOptionsScope.skippedCount > 1 ? "s" : ""} will be skipped during batch apply.
          </p>
        )}
      </section>

      <section className="panel developer-options-matrix-panel">
        <div className="developer-options-matrix-header">
          <div>
            <h2>Multi-device Comparison</h2>
            <p className="muted">Read-only current values for selected devices, compared against the primary baseline.</p>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="ghost"
              onClick={() => onRefreshMatrix(matrixOnlineSerials)}
              disabled={matrixRefreshDisabled}
            >
              {developerOptionsMatrixRefreshing ? "Refreshing..." : "Refresh selected"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={onLoadMatrixLogBuffer}
              disabled={matrixLoadLogBufferDisabled}
            >
              {logBufferLoadBusy ? "Loading log buffer..." : "Load log buffer"}
            </button>
          </div>
        </div>

        <div className="developer-options-matrix-meta">
          <span className="badge">Selected devices: {matrixSelectedCount}</span>
          <span className="badge">Online: {matrixOnlineSerials.length}</span>
          <span className="badge">Offline: {matrixOfflineSerials.length}</span>
          <span className="badge">Baseline: {activeSerial}</span>
          <span className="badge">Last refreshed: {matrixLastUpdatedLabel}</span>
          <span className="badge">{matrixRefreshModeLabel}</span>
          {developerOptionsMatrixStale && <span className="status-pill warn">Stale</span>}
          <span
            className={`status-pill ${
              developerOptionsMatrixLogBufferState === "error"
                ? "error"
                : developerOptionsMatrixLogBufferState === "loaded"
                  ? "ok"
                  : developerOptionsMatrixLogBufferState === "loading"
                    ? "busy"
                    : "warn"
            }`}
          >
            {matrixLogBufferStatusLabel}
          </span>
        </div>

        {developerOptionsMatrixLogBufferError && (
          <p className="muted developer-options-target-summary">{developerOptionsMatrixLogBufferError}</p>
        )}

        {developerOptionsMatrixStale && developerOptionsMatrixStaleMessage && (
          <p className="muted developer-options-target-summary">{developerOptionsMatrixStaleMessage}</p>
        )}

        {matrixOfflineSerials.length > 0 && (
          <p className="muted developer-options-target-summary">Skipped offline: {matrixOfflineSerials.join(", ")}</p>
        )}

        {matrixSelectedCount === 0 ? (
          <div className="inline-alert info">
            <strong>Select devices to compare</strong>
            <span>Use the top bar device selector to add one or more devices.</span>
          </div>
        ) : matrixOnlineSerials.length === 0 ? (
          <div className="inline-alert info">
            <strong>No online devices to read</strong>
            <span>Reconnect selected devices, then refresh comparison.</span>
          </div>
        ) : (
          <>
            {matrixBaselineKnown && !matrixHasBaseline && (
              <div className="inline-alert info">
                <strong>Baseline unavailable</strong>
                <span>Primary device values could not be read for comparison. Divergence indicators are disabled.</span>
              </div>
            )}

            <div className="developer-options-matrix-scroll">
              <table className="developer-options-matrix-table">
                <thead>
                  <tr>
                    <th scope="col" className="developer-options-matrix-option-col">
                      Option
                    </th>
                    {matrixOnlineSerials.map((serial) => {
                      const serialSnapshot = developerOptionsMatrixState.bySerial[serial];
                      const isLoading = developerOptionsMatrixLoadingSerialSet.has(serial);
                      const status: DeveloperOptionDeviceReadStatus = isLoading
                        ? "loading"
                        : serialSnapshot?.status ?? "idle";
                      const statusLabel =
                        status === "success"
                          ? "Ready"
                          : status === "loading"
                            ? "Loading"
                            : status === "unsupported"
                              ? "Unsupported"
                              : status === "offline"
                                ? "Offline"
                                : status === "error"
                                  ? "Error"
                                  : "Idle";
                      const statusTone =
                        status === "success"
                          ? "ok"
                          : status === "loading"
                            ? "busy"
                            : status === "unsupported"
                              ? "warn"
                              : status === "offline" || status === "error"
                                ? "error"
                                : "warn";

                      return (
                        <th key={serial} scope="col">
                          <div className="developer-options-matrix-device-head">
                            <span className="developer-options-matrix-device-serial">
                              {serial}
                              {serial === activeSerial && (
                                <span className="badge developer-options-matrix-baseline-badge">Primary</span>
                              )}
                            </span>
                            <span className={`status-pill ${statusTone}`}>{statusLabel}</span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {DEVELOPER_OPTIONS.map((option) => {
                    const divergence = developerOptionsDivergenceByKey[option.key];
                    const divergentCount = divergence?.divergentSerials.length ?? 0;
                    return (
                      <tr key={option.key}>
                        <th scope="row" className="developer-options-matrix-option-cell">
                          <div className="developer-options-matrix-option-title-row">
                            <span>{option.label}</span>
                            {divergence?.hasBaseline && divergentCount > 0 && (
                              <span className="status-pill warn">Diverged: {divergentCount}</span>
                            )}
                          </div>
                        </th>
                        {matrixOnlineSerials.map((serial) => {
                          const serialSnapshot = developerOptionsMatrixState.bySerial[serial];
                          const isLoading = developerOptionsMatrixLoadingSerialSet.has(serial);
                          const isInitialLoading = isLoading && !serialSnapshot?.lastReadAt;
                          const status = serialSnapshot?.status ?? "idle";
                          const isLogBufferDeferred =
                            option.key === "log_buffer_size" &&
                            status === "success" &&
                            !serialSnapshot?.supportedByKey.log_buffer_size &&
                            (serialSnapshot?.messageByKey.log_buffer_size ?? "") === "Click Load log buffer.";
                          const unsupported =
                            status === "unsupported" ||
                            (status === "success" && !serialSnapshot.supportedByKey[option.key]);
                          const failed = status === "error" || status === "offline";
                          const canShowValue =
                            status === "success" && serialSnapshot.supportedByKey[option.key];
                          const valueLabel = canShowValue
                            ? resolveDeveloperOptionValueLabel(option.key, serialSnapshot.values[option.key])
                            : status === "idle"
                              ? "Not loaded"
                              : "N/A";
                          const message = serialSnapshot?.messageByKey[option.key] ?? null;
                          const isDivergent =
                            divergence?.hasBaseline &&
                            developerOptionsDivergentSerialSetByKey[option.key].has(serial);

                          return (
                            <td
                              key={`${option.key}-${serial}`}
                              className={`developer-options-matrix-cell${isDivergent ? " is-divergent" : ""}`}
                            >
                              {isInitialLoading ? (
                                <span className="developer-options-matrix-loading">Loading...</span>
                              ) : isLogBufferDeferred ? (
                                <span className="developer-options-matrix-value" title={message ?? undefined}>
                                  Not loaded
                                </span>
                              ) : failed ? (
                                <span className="status-pill error" title={message ?? undefined}>
                                  Read failed
                                </span>
                              ) : unsupported ? (
                                <span className="status-pill warn" title={message ?? undefined}>
                                  Unsupported
                                </span>
                              ) : (
                                <span className="developer-options-matrix-value" title={message ?? undefined}>
                                  {valueLabel}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {developerOptionsError && (
        <div className={`inline-alert ${hasReadableOptions ? "info" : "error"}`}>
          <strong>{hasReadableOptions ? "Partial data loaded" : "Unable to load options"}</strong>
          <span>{developerOptionsError}</span>
        </div>
      )}

      {developerOptionsLoading && !hasReadableOptions ? (
        <section className="panel empty-state">
          <div>
            <h2>Loading developer options</h2>
            <p className="muted">Reading values from the primary device.</p>
          </div>
        </section>
      ) : !hasReadableOptions ? (
        <section className="panel empty-state">
          <div>
            <h2>No readable options</h2>
            <p className="muted">
              This device may block developer option reads. Try refreshing or switch to another device.
            </p>
          </div>
        </section>
      ) : (
        <div className="developer-options-grid">
          {groupedOptions.map((group) => (
            <section key={group.category} className="panel card developer-options-group">
              <div className="developer-options-group-header">
                <h2>{group.label}</h2>
                <span className="badge">{group.options.length} options</span>
              </div>
              <div className="developer-options-list">
                {group.options.map((option) => {
                  const snapshotValue = developerOptionsSnapshot[option.key];
                  const value = resolveDeveloperOptionValueForUi({
                    optionKey: option.key,
                    snapshot: developerOptionsSnapshot,
                    pending: developerOptionPendingByKey,
                  });
                  const pending = hasPendingDeveloperOptionValue(developerOptionPendingByKey, option.key);
                  const supported = developerOptionSupportedByKey[option.key];
                  const message = developerOptionMessageByKey[option.key];
                  const applying = developerOptionsApplyingKey === option.key;
                  const disabledByTarget = developerOptionsApplyMode === "primary_instant" && !hasOnlineTarget;
                  const disabled =
                    !supported ||
                    disabledByTarget ||
                    busy ||
                    developerOptionsLoading ||
                    applying ||
                    developerOptionsBatchApplying;
                  const controlId = `developer-option-${option.key}`;

                  return (
                    <div
                      key={option.key}
                      className={`developer-options-option${supported ? "" : " is-disabled"}${
                        option.highRisk ? " is-high-risk" : ""
                      }${pending ? " is-pending" : ""}`}
                    >
                      <div className="developer-options-option-main">
                        <div className="developer-options-option-copy">
                          <label htmlFor={controlId} className="developer-options-option-label">
                            {option.label}
                          </label>
                          <p className="muted developer-options-option-description">{option.description}</p>
                        </div>
                        <div className="developer-options-option-control">
                          {option.control === "toggle" ? (
                            <label className="toggle developer-options-toggle">
                              <input
                                id={controlId}
                                type="checkbox"
                                checked={Boolean(value)}
                                disabled={disabled}
                                onChange={(event) => {
                                  const nextValue = event.target.checked;
                                  if (value === nextValue) {
                                    return;
                                  }
                                  onRequestApply(option.key, nextValue);
                                }}
                              />
                              {Boolean(value) ? "On" : "Off"}
                            </label>
                          ) : (
                            <select
                              id={controlId}
                              value={typeof value === "string" ? value : ""}
                              disabled={disabled}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                if (!nextValue || value === nextValue) {
                                  return;
                                }
                                onRequestApply(option.key, nextValue);
                              }}
                            >
                              <option value="" disabled>
                                {supported ? "Select value" : "Unsupported"}
                              </option>
                              {(option.options ?? []).map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>

                      {batchMode && (
                        <div className="developer-options-option-diff">
                          <span className="muted">
                            Current (primary): <strong>{formatDeveloperOptionValueLabel(snapshotValue)}</strong>
                          </span>
                          {pending && (
                            <span className="muted">
                              Pending: <strong>{formatDeveloperOptionValueLabel(value)}</strong>
                            </span>
                          )}
                        </div>
                      )}

                      <div className="developer-options-option-meta">
                        {option.highRisk && <span className="badge developer-options-risk-badge">High risk</span>}
                        {pending && <span className="status-pill warn">Pending</span>}
                        {applying && <span className="status-pill busy">Applying...</span>}
                        {message && <span className="muted developer-options-option-message">{message}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default DeveloperOptionsPage;
