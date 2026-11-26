import { memo, type ReactNode } from "react";
import {
  buildSparklinePoints,
  formatBps,
  formatBytes,
  formatHzX100,
  formatKhz,
  formatPerSecX100,
} from "../perf";
import { EMPTY_PERF_MONITOR_STATE, type PerfMonitorState } from "../perfState";
import type { PerfSnapshot } from "../types";

export { EMPTY_PERF_MONITOR_STATE, type PerfMonitorState };

function renderPerfSparkline(values: number[]) {
  const width = 220;
  const height = 44;
  const points = buildSparklinePoints(values, width, height);
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" />
    </svg>
  );
}

export type PerformancePageProps = {
  activeSerial: string | null;
  deviceStatus: string;
  busy: boolean;
  perfState: PerfMonitorState;
  singleSelectionWarning: boolean;
  singleSelectionWarningMessage: string;
  selectedSummaryLabel: string;
  onGoToDevices: () => void;
  onPerfStart: () => void;
  onPerfStop: () => void;
  networkBreakdown: ReactNode;
};

export const PerformancePage = memo(function PerformancePage({
  activeSerial,
  deviceStatus,
  busy,
  perfState,
  singleSelectionWarning,
  singleSelectionWarningMessage,
  selectedSummaryLabel,
  onGoToDevices,
  onPerfStart,
  onPerfStop,
  networkBreakdown,
}: PerformancePageProps) {
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
            <p className="muted">Choose an online device to start monitoring.</p>
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

  const latest: PerfSnapshot | null = perfState.samples[perfState.samples.length - 1] ?? null;

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
    latest?.battery_temp_decic != null ? `${(latest.battery_temp_decic / 10).toFixed(1)} C` : "--";
  const batteryLevel = latest?.battery_level != null ? `${latest.battery_level}%` : "--";
  const batteryNow =
    batteryLevel === "--" && batteryTemp === "--" ? "--" : `${batteryLevel} • ${batteryTemp}`;

  const netNow =
    latest?.net_rx_bps != null || latest?.net_tx_bps != null
      ? `Rx ${formatBps(latest?.net_rx_bps ?? null)} • Tx ${formatBps(latest?.net_tx_bps ?? null)}`
      : "--";

  const displayRefreshNow = formatHzX100(latest?.display_refresh_hz_x100 ?? null);
  const missedNow = formatPerSecX100(latest?.missed_frames_per_sec_x100 ?? null);

  const cpuValues = perfState.samples.map((sample) =>
    sample.cpu_total_percent_x100 != null ? sample.cpu_total_percent_x100 / 100 : Number.NaN,
  );
  const memValues = perfState.samples.map((sample) =>
    sample.mem_used_bytes != null ? sample.mem_used_bytes : Number.NaN,
  );
  const batteryValues = perfState.samples.map((sample) =>
    sample.battery_level != null ? sample.battery_level : Number.NaN,
  );
  const rxValues = perfState.samples.map((sample) =>
    sample.net_rx_bps != null ? sample.net_rx_bps : Number.NaN,
  );
  const missedValues = perfState.samples.map((sample) =>
    sample.missed_frames_per_sec_x100 != null ? sample.missed_frames_per_sec_x100 / 100 : Number.NaN,
  );

  const canStart = !busy && !!activeSerial && deviceStatus === "device" && !perfState.running;
  const canStop = !busy && !!activeSerial && perfState.running;

  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <h1>Performance</h1>
          <p className="muted">Real-time device performance snapshots.</p>
        </div>
        <div className="page-actions">
          <span className={`status-pill ${perfState.running ? "busy" : "idle"}`}>
            {perfState.running ? "Running" : "Stopped"}
          </span>
          <span className="badge">Interval 1s</span>
        </div>
      </div>

      {singleSelectionWarning && (
        <div className="inline-alert info">
          <strong>Primary device in use</strong>
          <span>{singleSelectionWarningMessage}</span>
        </div>
      )}

      {perfState.traceId && (
        <div className="inline-alert info">
          <strong>Trace</strong>
          <span className="muted">{perfState.traceId}</span>
        </div>
      )}

      {perfState.lastError && (
        <div className="inline-alert error">
          <strong>Monitor error</strong>
          <span className="muted">{perfState.lastError}</span>
        </div>
      )}

      <section className="panel perf-panel">
        <div className="panel-header">
          <div>
            <h2>Live Monitor</h2>
            <span>{selectedSummaryLabel}</span>
          </div>
          <div className="button-row">
            <button onClick={onPerfStart} disabled={!canStart}>
              Start
            </button>
            <button onClick={onPerfStop} disabled={!canStop}>
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

      {networkBreakdown}
    </div>
  );
});
