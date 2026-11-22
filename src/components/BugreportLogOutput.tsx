import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bugreportLogLineMatches, buildBugreportLogFindPattern } from "../bugreportLogFind";
import type { BugreportLogRow } from "../types";
import { renderHighlightedLogcatLine } from "./logHighlighting";

export type BugreportLogOutputProps = {
  rows: BugreportLogRow[];
  highlightPattern: RegExp | null;
  onNearBottom: () => void;
  canLoadMore: boolean;
  busy: boolean;
};

export const BUGREPORT_LOG_LINE_HEIGHT_PX = 16;

export const BugreportLogOutput = memo(function BugreportLogOutput({
  rows,
  highlightPattern,
  onNearBottom,
  canLoadMore,
  busy,
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
    () =>
      buildBugreportLogFindPattern(findTerm, {
        caseSensitive: findCaseSensitive,
        regex: findRegex,
      }),
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

  const goToMatch = (nextIndex: number) => {
    if (findMatchRowIndices.length === 0) {
      return;
    }
    const normalized =
      ((nextIndex % findMatchRowIndices.length) + findMatchRowIndices.length) %
      findMatchRowIndices.length;
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
            const isActive = activeMatchRowIndex === rowIndex;
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
