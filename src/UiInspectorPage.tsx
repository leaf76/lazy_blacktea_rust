import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { UiNodeInfo } from "./ui_bounds";

type UiNodesParseSummary = {
  nodes: UiNodeInfo[];
  truncated: boolean;
};

type UiInspectorPageProps = {
  selectedSummaryLabel: string;
  busy: boolean;
  activeSerial: string | null;
  handleUiInspect: () => void;
  handleUiExport: () => void;
  uiAutoSyncIntervalMs: number;
  setUiAutoSyncIntervalMs: Dispatch<SetStateAction<number>>;
  uiAutoSyncEnabled: boolean;
  handleUiAutoSyncToggle: () => void;
  singleSelectionWarning: boolean;
  singleSelectionWarningMessage: string;
  uiExportResult: string | null;
  uiAutoSyncLastAt: number | null;
  uiScreenshotSrc: string;
  uiAutoSyncError: string | null;
  uiZoom: number;
  setUiZoom: Dispatch<SetStateAction<number>>;
  uiScreenshotImgRef: RefObject<HTMLImageElement | null>;
  setUiScreenshotSize: Dispatch<SetStateAction<{ width: number; height: number }>>;
  uiBoundsCanvasRef: RefObject<HTMLCanvasElement | null>;
  uiBoundsEnabled: boolean;
  setUiHoveredNodeIndex: Dispatch<SetStateAction<number>>;
  uiLastPointerRef: MutableRefObject<{ x: number; y: number } | null>;
  uiHoverRafRef: MutableRefObject<number | null>;
  uiNodesParse: UiNodesParseSummary;
  pickUiNodeAtPoint: (nodes: UiNodeInfo[], x: number, y: number) => number;
  setUiSelectedNodeIndex: Dispatch<SetStateAction<number>>;
  uiHoveredNodeIndex: number;
  uiScreenshotError: string | null;
  setUiBoundsEnabled: Dispatch<SetStateAction<boolean>>;
  uiSelectedNode: UiNodeInfo | null;
  uiHoveredNode: UiNodeInfo | null;
  uiInspectorTab: "hierarchy" | "xml";
  setUiInspectorTab: Dispatch<SetStateAction<"hierarchy" | "xml">>;
  uiXmlViewMode: "raw" | "pretty";
  setUiXmlViewMode: Dispatch<SetStateAction<"raw" | "pretty">>;
  handleUiCopyXml: () => void | Promise<void>;
  filteredUiXml: string;
  uiInspectorSearch: string;
  setUiInspectorSearch: Dispatch<SetStateAction<string>>;
  uiHtml: string;
  uiHierarchyFrameRef: RefObject<HTMLIFrameElement | null>;
  setUiHierarchyFrameToken: Dispatch<SetStateAction<number>>;
  uiXml: string;
  uiXmlView: { prettyAvailable: boolean };
};

const UiInspectorPage = ({
  selectedSummaryLabel,
  busy,
  activeSerial,
  handleUiInspect,
  handleUiExport,
  uiAutoSyncIntervalMs,
  setUiAutoSyncIntervalMs,
  uiAutoSyncEnabled,
  handleUiAutoSyncToggle,
  singleSelectionWarning,
  singleSelectionWarningMessage,
  uiExportResult,
  uiAutoSyncLastAt,
  uiScreenshotSrc,
  uiAutoSyncError,
  uiZoom,
  setUiZoom,
  uiScreenshotImgRef,
  setUiScreenshotSize,
  uiBoundsCanvasRef,
  uiBoundsEnabled,
  setUiHoveredNodeIndex,
  uiLastPointerRef,
  uiHoverRafRef,
  uiNodesParse,
  pickUiNodeAtPoint,
  setUiSelectedNodeIndex,
  uiHoveredNodeIndex,
  uiScreenshotError,
  setUiBoundsEnabled,
  uiSelectedNode,
  uiHoveredNode,
  uiInspectorTab,
  setUiInspectorTab,
  uiXmlViewMode,
  setUiXmlViewMode,
  handleUiCopyXml,
  filteredUiXml,
  uiInspectorSearch,
  setUiInspectorSearch,
  uiHtml,
  uiHierarchyFrameRef,
  setUiHierarchyFrameToken,
  uiXml,
  uiXmlView,
}: UiInspectorPageProps) => (
  <div className="page-section page-section-stretch ui-inspector-workspace">
    <div className="page-header">
      <div>
        <h1>UI Inspector</h1>
        <p className="muted">Capture hierarchy, inspect XML, and export assets.</p>
      </div>
    </div>
    <section className="panel panel-stretch">
      <div className="panel-header">
        <div>
          <h2>Inspector Workspace</h2>
          <span>{selectedSummaryLabel}</span>
        </div>
        <div className="button-row compact">
          <button onClick={handleUiInspect} disabled={busy || !activeSerial}>
            Sync
          </button>
          <button className="ghost" onClick={handleUiExport} disabled={busy || !activeSerial}>
            Export
          </button>
          <select
            aria-label="Auto sync interval"
            title="Auto sync interval"
            value={uiAutoSyncIntervalMs}
            onChange={(event) => setUiAutoSyncIntervalMs(Number(event.target.value))}
            disabled={!activeSerial}
          >
            <option value={500}>0.5s</option>
            <option value={1000}>1s</option>
            <option value={2000}>2s</option>
          </select>
          <button
            type="button"
            className={`ghost ${uiAutoSyncEnabled ? "active" : ""}`}
            onClick={handleUiAutoSyncToggle}
            disabled={!activeSerial}
            title="Automatically refresh screenshot and hierarchy"
          >
            Auto Sync
          </button>
        </div>
      </div>
      {singleSelectionWarning && (
        <div className="inline-alert info">
          <strong>Primary device in use</strong>
          <span>{singleSelectionWarningMessage}</span>
        </div>
      )}
      {uiExportResult && (
        <div className="inline-alert info">
          <strong>Exported</strong>
          <span>{uiExportResult}</span>
        </div>
      )}
      <div className="split inspector-split split-stretch">
        <div className="panel-sub inspector-pane">
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
                      const x = (latest.x - rect.left) * (activeCanvas.width / rect.width);
                      const y = (latest.y - rect.top) * (activeCanvas.height / rect.height);
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
              {uiScreenshotSrc ? `${uiNodesParse.nodes.length}${uiNodesParse.truncated ? "+" : ""} nodes` : "--"}
            </span>
          </div>
          {(uiSelectedNode || uiHoveredNode) && (
            <div className="ui-node-meta">
              {uiSelectedNode && (
                <>
                  <div className="ui-node-meta-row">
                    <span className="ui-node-meta-label">Selected</span>
                    <span className="ui-node-meta-value">
                      {[uiSelectedNode.resourceId, uiSelectedNode.text ? `"${uiSelectedNode.text}"` : null, uiSelectedNode.className]
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
                      {[uiHoveredNode.resourceId, uiHoveredNode.text ? `"${uiHoveredNode.text}"` : null, uiHoveredNode.className]
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
        <div className="panel-sub inspector-pane">
          <div className="panel-header">
            <h3>Hierarchy</h3>
            <div className="button-row compact inspector-hierarchy-controls">
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
              {uiInspectorTab === "xml" && (
                <>
                  <div className="toggle-group">
                    <button
                      type="button"
                      className={`toggle ${uiXmlViewMode === "raw" ? "active" : ""}`}
                      onClick={() => setUiXmlViewMode("raw")}
                    >
                      Raw
                    </button>
                    <button
                      type="button"
                      className={`toggle ${uiXmlViewMode === "pretty" ? "active" : ""}`}
                      onClick={() => setUiXmlViewMode("pretty")}
                    >
                      Pretty
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void handleUiCopyXml()}
                    disabled={!filteredUiXml.trim()}
                  >
                    Copy
                  </button>
                </>
              )}
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
            <>
              {uiXmlViewMode === "pretty" && uiXml.trim() && !uiXmlView.prettyAvailable && (
                <div className="inline-alert info">
                  <strong>Pretty unavailable</strong>
                  <span>Showing raw XML because this capture could not be formatted.</span>
                </div>
              )}
              <div className="output-block inspector-xml">
                {filteredUiXml ? <pre>{filteredUiXml}</pre> : <p className="muted">No XML captured.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  </div>
);

export default UiInspectorPage;
