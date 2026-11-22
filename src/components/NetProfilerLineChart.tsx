import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { buildLinePath, extractNetSeries, sliceSnapshotsByWindowMs } from "../netProfiler";
import { formatBps } from "../perf";
import type { NetProfilerSnapshot } from "../types";

export type NetProfilerLineChartProps = {
  samples: NetProfilerSnapshot[];
  focusUid: number | null;
  windowMs: number | null;
  pinnedUids: number[];
  pinnedLabels: Record<number, string>;
};

export const NetProfilerLineChart = memo(function NetProfilerLineChart({
  samples,
  focusUid,
  windowMs,
  pinnedUids,
  pinnedLabels,
}: NetProfilerLineChartProps) {
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
    pinnedTotalsSeries.forEach((pinnedSeries) => {
      pinnedSeries.forEach((value) => {
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
    () => pinnedTotalsSeries.map((values) => buildLinePath(values, width, height, yMax)),
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
      tsMs != null && endTs != null ? Math.max(0, (endTs - tsMs) / 1000) : null;
    const rxBps = series.rxBps[hoverIndex] ?? null;
    const txBps = series.txBps[hoverIndex] ?? null;
    const totalBps = rxBps == null && txBps == null ? null : (rxBps ?? 0) + (txBps ?? 0);
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
      zoomDomain ??
      (baseStartTs != null && baseEndTs != null
        ? { startTs: baseStartTs, endTs: baseEndTs }
        : null);

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
  }, [hasSeries, hoverIndex, pinnedLabels, pinnedTotalsSeries, pinnedUids]);

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
                  cy={
                    height -
                    Math.min(1, Math.max(0, (series.rxBps[hoverIndex] ?? 0) / yMax)) * height
                  }
                  r="3"
                />
              )}
            {hoverIndex != null &&
              series.txBps[hoverIndex] != null &&
              Number.isFinite(series.txBps[hoverIndex] ?? Number.NaN) && (
                <circle
                  className="net-profiler-dot net-profiler-dot-tx"
                  cx={hoverX}
                  cy={
                    height -
                    Math.min(1, Math.max(0, (series.txBps[hoverIndex] ?? 0) / yMax)) * height
                  }
                  r="3"
                />
              )}
          </g>
        )}
      </svg>

      {!hasSeries && (
        <div className="net-profiler-chart-empty">
          <p className="muted">
            {samples.length ? "Waiting for data…" : "Start the network profiler to see a timeline."}
          </p>
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
        <span className="muted net-profiler-legend-cap">Max {formatBps(yMax)}</span>
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
                <div
                  key={pin.uid}
                  className="net-profiler-tooltip-row net-profiler-tooltip-row-pin"
                >
                  <span className="net-profiler-tooltip-pin">
                    <span
                      className={`net-profiler-color-swatch pin-${pin.index}`}
                      aria-hidden="true"
                    />
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
});
