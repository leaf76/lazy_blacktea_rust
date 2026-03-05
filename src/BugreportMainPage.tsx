import type { KeyboardEvent, MouseEvent } from "react";
import type { BugreportCardStatus, BugreportCardsSummary, BugreportDeviceCard } from "./bugreportPage";

type BugreportPageProps = {
  busy: boolean;
  selectedSummaryLabel: string;
  bugreportCardSummary: BugreportCardsSummary;
  bugreportGenerateLabel: string;
  bugreportOutputPaths: string[];
  bugreportCards: BugreportDeviceCard[];
  bugreportStatusTone: Record<BugreportCardStatus, "idle" | "busy" | "ok" | "warn" | "error">;
  bugreportStatusLabel: Record<BugreportCardStatus, string>;
  onRunBugreport: () => void;
  onCancelRunning: () => void;
  onOpenOutputs: () => void;
  onOpenDeviceContextKeyboard: (
    event: KeyboardEvent<HTMLElement>,
    serial: string,
    meta: { source: "task"; outputPath: string | null },
  ) => void;
  onOpenDeviceContextPointer: (
    event: MouseEvent<HTMLElement>,
    serial: string,
    meta: { source: "task"; outputPath: string | null; showSelectionHint: boolean },
  ) => void;
  onOpenOutputPath: (path: string) => void;
  onCancelSerial: (serial: string) => void;
  onRetrySerial: (serial: string) => void;
  onGoDeviceManager: () => void;
  onRefreshDevices: () => void;
};

const BugreportPage = ({
  busy,
  selectedSummaryLabel,
  bugreportCardSummary,
  bugreportGenerateLabel,
  bugreportOutputPaths,
  bugreportCards,
  bugreportStatusTone,
  bugreportStatusLabel,
  onRunBugreport,
  onCancelRunning,
  onOpenOutputs,
  onOpenDeviceContextKeyboard,
  onOpenDeviceContextPointer,
  onOpenOutputPath,
  onCancelSerial,
  onRetrySerial,
  onGoDeviceManager,
  onRefreshDevices,
}: BugreportPageProps) => (
  <div className="page-section bugreport-page">
    <div className="page-header">
      <div>
        <h1>Bugreport</h1>
        <p className="muted">Batch bugreport generation with per-device progress and recovery actions.</p>
      </div>
    </div>
    <div className="stack">
      {bugreportCardSummary.selected > 0 ? (
        <section className="panel bugreport-panel">
          <div className="panel-header">
            <h2>Batch Run</h2>
            <span>{selectedSummaryLabel}</span>
          </div>
          <div className="bugreport-toolbar">
            <div className="bugreport-toolbar-copy">
              <p className="muted">Target devices come from the global selector in the top bar.</p>
            </div>
            <div className="button-row compact bugreport-toolbar-actions">
              <button onClick={onRunBugreport} disabled={busy || bugreportCardSummary.selected === 0 || bugreportCardSummary.running > 0}>
                {bugreportGenerateLabel}
              </button>
              <button className="ghost" onClick={onCancelRunning} disabled={bugreportCardSummary.running === 0}>
                Cancel Running
              </button>
              <button className="ghost" onClick={onOpenOutputs} disabled={busy || bugreportOutputPaths.length === 0}>
                Open Outputs ({bugreportOutputPaths.length})
              </button>
            </div>
          </div>

          <div className="bugreport-batch-strip" role="status" aria-live="polite">
            <strong>Batch Status</strong>
            <span className="badge">{bugreportCardSummary.selected} selected</span>
            <span className="badge">{bugreportCardSummary.online} online</span>
            <span className="badge">{bugreportCardSummary.running} running</span>
            <span className="badge">{bugreportCardSummary.success} success</span>
            <span className="badge">{bugreportCardSummary.error} errors</span>
            {(bugreportCardSummary.cancelled > 0 || bugreportCardSummary.interrupted > 0) && (
              <span className="badge">
                {bugreportCardSummary.cancelled + bugreportCardSummary.interrupted} cancelled/interrupted
              </span>
            )}
          </div>

          {bugreportCardSummary.offline > 0 && (
            <div className="inline-alert info">
              <strong>{bugreportCardSummary.offline} offline device(s) selected.</strong>
              <span>They remain visible here and will fail or be skipped until they reconnect.</span>
            </div>
          )}

          <div className="bugreport-card-grid" role="list">
            {bugreportCards.map((card) => {
              const statusTone = bugreportStatusTone[card.status];
              const statusLabel = bugreportStatusLabel[card.status];
              const progressValue = card.progress ?? (card.status === "running" ? 36 : card.status === "success" ? 100 : 0);
              const progressLabel = card.progress != null ? `${card.progress}%` : card.status === "running" ? "Running..." : statusLabel;
              return (
                <article
                  key={card.serial}
                  role="listitem"
                  className={`bugreport-card bugreport-card-${card.status}`}
                  tabIndex={0}
                  onKeyDown={(event) =>
                    onOpenDeviceContextKeyboard(event, card.serial, {
                      source: "task",
                      outputPath: card.output_path,
                    })
                  }
                  onContextMenu={(event) =>
                    onOpenDeviceContextPointer(event, card.serial, {
                      source: "task",
                      outputPath: card.output_path,
                      showSelectionHint: true,
                    })
                  }
                >
                  <div className="bugreport-card-head">
                    <div className="bugreport-card-title">
                      <strong>{card.display_name}</strong>
                      <span className="muted">
                        <code>{card.serial}</code> · {card.online ? "Online" : "Offline"}
                      </span>
                    </div>
                    <span className={`status-pill ${statusTone}`}>{statusLabel}</span>
                  </div>
                  <div className="bugreport-card-progress">
                    <div className="progress-bar">
                      <div
                        className={`progress-fill${card.status === "running" && card.progress == null ? " bugreport-progress-indeterminate" : ""}`}
                        style={{ width: `${progressValue}%` }}
                      />
                    </div>
                    <span className="muted">{progressLabel}</span>
                  </div>
                  {card.message && <p className="muted bugreport-card-message">{card.message}</p>}
                  <div className="button-row compact bugreport-card-actions">
                    {card.output_path && (
                      <button className="ghost" onClick={() => onOpenOutputPath(card.output_path!)}>
                        Open output
                      </button>
                    )}
                    {card.can_cancel && (
                      <button className="ghost" onClick={() => onCancelSerial(card.serial)}>
                        Cancel
                      </button>
                    )}
                    {card.can_retry && (
                      <button onClick={() => onRetrySerial(card.serial)} disabled={busy}>
                        Retry
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="panel empty-state bugreport-empty-state">
          <div>
            <h2>No devices selected</h2>
            <p className="muted">
              Use the top global device selector to choose targets, or open Device Manager to adjust selection.
            </p>
          </div>
          <div className="button-row">
            <button className="ghost" onClick={onGoDeviceManager} disabled={busy}>
              Go to Device Manager
            </button>
            <button onClick={onRefreshDevices} disabled={busy}>
              Refresh Devices
            </button>
          </div>
        </section>
      )}
    </div>
  </div>
);

export default BugreportPage;
