import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { renderHighlightedLogcatLine } from "./logHighlighting";

export type LogcatLineEntry = { id: number; text: string };

export const LOGCAT_LINE_HEIGHT_PX = 16;
export const LOGCAT_OUTPUT_PADDING_PX = 8;
export const LOGCAT_OVERSCAN = 80;

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

export const LogcatOutput = memo(function LogcatOutput({
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

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

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
