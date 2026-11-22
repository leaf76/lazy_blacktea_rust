import { memo, useMemo } from "react";
import { buildNetTotalSeriesByUid } from "../netProfiler";
import { buildSparklinePoints, formatBps, formatBytes } from "../perf";
import type { NetProfilerSnapshot } from "../types";
import { NetProfilerLineChart } from "./NetProfilerLineChart";

export type NetProfilerState = {
  running: boolean;
  traceId: string | null;
  samples: NetProfilerSnapshot[];
  lastError: string | null;
};

export const EMPTY_NET_PROFILER_STATE: NetProfilerState = {
  running: false,
  traceId: null,
  samples: [],
  lastError: null,
};

const MAX_PINNED_UIDS = 5;

function renderNetTrendSparkline(values: number[]) {
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
}

export type NetworkBreakdownPanelProps = {
  serial: string | null;
  deviceStatus: string;
  busy: boolean;
  netState: NetProfilerState;
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

export const NetworkBreakdownPanel = memo(function NetworkBreakdownPanel({
  serial,
  deviceStatus,
  busy,
  netState,
  intervalMs,
  topN,
  search,
  windowMs,
  focusUid,
  pinnedUids,
  onIntervalChange,
  onTopNChange,
  onSearchChange,
  onWindowMsChange,
  onStart,
  onStop,
  onFocusUidChange,
  onToggleFocusUid,
  onApplyPinnedUids,
  onNotifyInfo,
}: NetworkBreakdownPanelProps) {
  const netSnapshot: NetProfilerSnapshot | null =
    netState.samples[netState.samples.length - 1] ?? null;
  const netRows = useMemo(() => netSnapshot?.rows ?? [], [netSnapshot]);
  const netTrendSeriesByUid = useMemo(
    () => buildNetTotalSeriesByUid(netState.samples),
    [netState.samples],
  );
  const netQuery = search.trim().toLowerCase();
  const netRowsFiltered = useMemo(
    () =>
      netQuery
        ? netRows.filter((row) => {
            const label =
              row.packages && row.packages.length ? row.packages.join(", ") : `uid:${row.uid}`;
            return label.toLowerCase().includes(netQuery);
          })
        : netRows,
    [netQuery, netRows],
  );

  const canStartNet = !!serial && !busy && deviceStatus === "device" && !netState.running;
  const canStopNet = !!serial && !busy && netState.running;
  const netIntervalBadge =
    intervalMs >= 1000 ? `Interval ${Math.round(intervalMs / 1000)}s` : `Interval ${intervalMs}ms`;

  const focusedRow =
    focusUid != null ? netRows.find((row) => row.uid === focusUid) ?? null : null;
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

  if (!serial) {
    return null;
  }

  const focusLabel =
    focusUid == null
      ? `Top ${topN} total`
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
            value={intervalMs}
            onChange={(event) => onIntervalChange(Number(event.target.value))}
            disabled={busy || netState.running}
          >
            <option value={1000}>1s</option>
            <option value={2000}>2s</option>
            <option value={5000}>5s</option>
          </select>
          <select
            aria-label="Network profiler top N"
            value={topN}
            onChange={(event) => onTopNChange(Number(event.target.value))}
            disabled={busy || netState.running}
          >
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
          </select>
          <button onClick={onStart} disabled={!canStartNet}>
            Start
          </button>
          <button onClick={onStop} disabled={!canStopNet}>
            Stop
          </button>
        </div>
      </div>

      <div className="net-profiler-toolbar">
        <div className="net-profiler-search">
          <label htmlFor="net-profiler-search">Search</label>
          <input
            id="net-profiler-search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            disabled={busy}
            placeholder="Filter by package or UID"
          />
        </div>
        <div className="net-profiler-meta">
          <span className={`status-pill ${netState.running ? "busy" : "idle"}`}>
            {netState.running ? "Running" : "Stopped"}
          </span>
          <span className="badge">{netIntervalBadge}</span>
          <span className="badge">Top {topN}</span>
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
              value={windowMs}
              onChange={(event) => onWindowMsChange(Number(event.target.value))}
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
                onClick={() => onFocusUidChange(serial, null)}
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
                    onApplyPinnedUids(serial, nextPinnedUids, "Unpinned focus app.");
                    return;
                  }

                  if (pinnedUids.length >= MAX_PINNED_UIDS) {
                    onNotifyInfo(`You can pin up to ${MAX_PINNED_UIDS} apps.`);
                    return;
                  }

                  onApplyPinnedUids(serial, [...pinnedUids, focusUid], "Pinned focus app.");
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
            <span className="muted net-profiler-pins-caption">Pinned (Total/s)</span>
            {pinnedUids.map((uid, index) => {
              const label = pinnedLabels[uid] ?? `UID ${uid}`;
              return (
                <div key={uid} className="net-profiler-pin-chip">
                  <button
                    className="net-profiler-pin-main"
                    onClick={() => onFocusUidChange(serial, uid)}
                    disabled={busy}
                    title={`Focus ${label}`}
                  >
                    <span
                      className={`net-profiler-color-swatch pin-${index}`}
                      aria-hidden="true"
                    />
                    <span className="net-profiler-pin-label">{label}</span>
                  </button>
                  <button
                    className="net-profiler-pin-remove"
                    onClick={() => {
                      const nextPinnedUids = pinnedUids.filter((pinned) => pinned !== uid);
                      onApplyPinnedUids(serial, nextPinnedUids, `Unpinned ${label}.`);
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
          windowMs={windowMs > 0 ? windowMs : null}
          pinnedUids={pinnedUids}
          pinnedLabels={pinnedLabels}
        />

        {focusUid != null && focusedRow == null && netState.running && (
          <div className="net-profiler-chart-note muted">
            Focused app is not in the current Top {topN}. Try increasing Top N or pin the focus.
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
              row.rx_bps == null && row.tx_bps == null
                ? null
                : (row.rx_bps ?? 0) + (row.tx_bps ?? 0);
            const isFocused = focusUid === row.uid;
            const isPinned = pinnedSet.has(row.uid);
            return (
              <div
                key={`${row.uid}-${appLabel}`}
                className={`net-profiler-row ${isFocused ? "is-focused" : ""} ${isPinned ? "is-pinned" : ""}`}
                role="row"
                tabIndex={0}
                onClick={() => onToggleFocusUid(serial, row.uid)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onToggleFocusUid(serial, row.uid);
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
                  {renderNetTrendSparkline(netTrendSeriesByUid.get(row.uid) ?? [])}
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
            {netState.running
              ? "Waiting for data…"
              : "Start the network profiler to see per-app throughput."}
          </p>
        </div>
      )}
    </section>
  );
});
