import { memo, useEffect, useMemo, useRef, useState } from "react";

export type TerminalDeviceState = {
  connected: boolean;
  sessionId: string | null;
  lines: string[];
  tail: string;
  autoScroll: boolean;
};

export const appendTerminalBuffer = (
  lines: string[],
  tail: string,
  chunk: string,
  maxLines: number,
) => {
  if (!chunk) {
    return { lines, tail };
  }
  const combined = `${tail}${chunk}`;
  const parts = combined.split("\n");
  const nextTail = parts.pop() ?? "";
  let nextLines = lines.concat(parts);
  if (nextLines.length > maxLines) {
    nextLines = nextLines.slice(-maxLines);
  }
  return { lines: nextLines, tail: nextTail };
};

export const renderTerminalBuffer = (lines: string[], tail: string) => {
  if (!lines.length && !tail) {
    return "No output yet.";
  }
  if (!lines.length) {
    return tail;
  }
  if (tail) {
    return `${lines.join("\n")}\n${tail}`;
  }
  return lines.join("\n");
};

export const DeviceTerminalPanel = memo(function DeviceTerminalPanel({
  serial,
  state,
  disabled,
  onConnect,
  onDisconnect,
  onSend,
  onInterrupt,
  onClear,
  onToggleAutoScroll,
}: {
  serial: string;
  state: TerminalDeviceState;
  disabled: boolean;
  onConnect: (serial: string) => void;
  onDisconnect: (serial: string) => void;
  onSend: (serial: string, command: string) => void;
  onInterrupt: (serial: string) => void;
  onClear: (serial: string) => void;
  onToggleAutoScroll: (serial: string, enabled: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const outputRef = useRef<HTMLPreElement | null>(null);
  const display = useMemo(
    () => renderTerminalBuffer(state.lines, state.tail),
    [state.lines, state.tail],
  );

  useEffect(() => {
    if (!state.autoScroll) {
      return;
    }
    const el = outputRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [state.autoScroll, state.lines, state.tail]);

  const runInput = () => {
    const command = input.trimEnd();
    if (!command.trim()) {
      return;
    }
    onSend(serial, command);
    setInput("");
  };

  return (
    <section className="panel terminal-panel">
      <div className="panel-header">
        <h3>{serial}</h3>
        <div className="terminal-panel-meta">
          <span className={`status-pill ${state.connected ? "ok" : "warn"}`}>
            {state.connected ? "Connected" : "Disconnected"}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => (state.connected ? onDisconnect(serial) : onConnect(serial))}
            disabled={disabled}
          >
            {state.connected ? "Disconnect" : "Connect"}
          </button>
        </div>
      </div>

      <div className="terminal-panel-controls">
        <button
          type="button"
          className="ghost"
          onClick={() => onInterrupt(serial)}
          disabled={disabled || !state.connected}
        >
          Ctrl+C
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => onClear(serial)}
          disabled={disabled}
        >
          Clear
        </button>
        <label className="terminal-autoscroll">
          <input
            type="checkbox"
            checked={state.autoScroll}
            onChange={(event) => onToggleAutoScroll(serial, event.target.checked)}
            disabled={disabled}
          />
          Auto-scroll
        </label>
      </div>

      <pre ref={outputRef} className="terminal-screen">
        {display}
      </pre>

      <div className="terminal-input-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type a command and press Enter"
          disabled={disabled || !state.connected}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              runInput();
            }
          }}
        />
        <button type="button" onClick={runInput} disabled={disabled || !state.connected}>
          Send
        </button>
      </div>
    </section>
  );
});
