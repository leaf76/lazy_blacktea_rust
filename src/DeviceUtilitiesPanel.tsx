import React, { useState } from "react";
import {
  adbRootDevices,
  adbServerControl,
  exportDiscoveryServiceDump,
  pullDeviceDcimBatch,
  setLogcatBufferSize,
  type AdbServerAction,
  type LogcatBufferSizeOption,
} from "./api";
import type { CommandResult } from "./types";

type DeviceUtilitiesPanelProps = {
  targetSerials: string[];
  outputDir: string;
  disabled: boolean;
  onNotify: (message: string, tone: "info" | "error") => void;
  onAfterServerChange?: () => void;
};

const BUFFER_SIZES: LogcatBufferSizeOption[] = ["256K", "1M", "4M", "8M", "16M", "32M", "64M"];

export const DeviceUtilitiesPanel: React.FC<DeviceUtilitiesPanelProps> = ({
  targetSerials,
  outputDir,
  disabled,
  onNotify,
  onAfterServerChange,
}) => {
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [bufferSize, setBufferSize] = useState<LogcatBufferSizeOption>("16M");
  const [results, setResults] = useState<CommandResult[]>([]);
  const [serverOutput, setServerOutput] = useState<string | null>(null);

  const isBusy = disabled || runningAction !== null;
  const hasDevices = targetSerials.length > 0;

  const formatErr = (error: unknown) => {
    if (error && typeof error === "object" && "error" in error) {
      return String((error as { error: string }).error);
    }
    return error instanceof Error ? error.message : String(error);
  };

  const runServerAction = async (action: AdbServerAction) => {
    setRunningAction(`server:${action}`);
    try {
      const response = await adbServerControl(action);
      const out = [response.data.stdout.trim(), response.data.stderr.trim()].filter(Boolean).join("\n");
      setServerOutput(out || `adb ${action}-server completed (exit ${response.data.exit_code ?? 0}).`);
      onNotify(`ADB server ${action} completed.`, "info");
      onAfterServerChange?.();
    } catch (error) {
      onNotify(formatErr(error), "error");
    } finally {
      setRunningAction(null);
    }
  };

  const runBatch = async (label: string, runner: () => Promise<{ data: CommandResult[] }>) => {
    if (!hasDevices) {
      onNotify("Select at least one online Android device.", "error");
      return;
    }
    setRunningAction(label);
    try {
      const response = await runner();
      setResults(response.data);
      const okCount = response.data.filter((item) => item.exit_code === 0).length;
      onNotify(`${label}: ${okCount}/${response.data.length} succeeded.`, okCount === response.data.length ? "info" : "error");
    } catch (error) {
      onNotify(formatErr(error), "error");
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>ADB Server Control</h2>
            <span>Manage the local host ADB daemon directly.</span>
          </div>
          <div className="button-row compact">
            <button type="button" className="ghost" disabled={isBusy} onClick={() => void runServerAction("start")}>
              {runningAction === "server:start" ? "Starting…" : "Start Server"}
            </button>
            <button type="button" className="ghost" disabled={isBusy} onClick={() => void runServerAction("kill")}>
              {runningAction === "server:kill" ? "Killing…" : "Kill Server"}
            </button>
            <button type="button" disabled={isBusy} onClick={() => void runServerAction("restart")}>
              {runningAction === "server:restart" ? "Restarting…" : "Restart Server"}
            </button>
          </div>
        </div>
        {serverOutput && <pre className="output-block">{serverOutput}</pre>}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Batch Android Utilities</h2>
            <span>
              {hasDevices
                ? `${targetSerials.length} Android device(s) targeted · Output: ${outputDir || "(default)"}`
                : "Select online Android devices to run batch utilities."}
            </span>
          </div>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <div className="form-row">
            <label>Logcat Buffer Size</label>
            <select
              value={bufferSize}
              onChange={(event) => setBufferSize(event.target.value as LogcatBufferSizeOption)}
              disabled={isBusy}
            >
              {BUFFER_SIZES.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isBusy || !hasDevices}
              onClick={() =>
                void runBatch(`Set logcat buffer (${bufferSize})`, () =>
                  setLogcatBufferSize(targetSerials, bufferSize),
                )
              }
            >
              {runningAction?.startsWith("Set logcat") ? "Applying…" : "Apply Buffer Size"}
            </button>
          </div>

          <div className="button-row">
            <button
              type="button"
              disabled={isBusy || !hasDevices || !outputDir.trim()}
              onClick={() =>
                void runBatch("Pull DCIM", () => pullDeviceDcimBatch(targetSerials, outputDir.trim()))
              }
            >
              {runningAction === "Pull DCIM" ? "Pulling DCIM…" : "Batch Pull /sdcard/DCIM"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={isBusy || !hasDevices || !outputDir.trim()}
              onClick={() =>
                void runBatch("DiscoveryService dump", () =>
                  exportDiscoveryServiceDump(targetSerials, outputDir.trim()),
                )
              }
            >
              {runningAction === "DiscoveryService dump"
                ? "Exporting…"
                : "Export DiscoveryService Dump"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={isBusy || !hasDevices}
              onClick={() => void runBatch("ADB Root", () => adbRootDevices(targetSerials))}
            >
              {runningAction === "ADB Root" ? "Running…" : "ADB Root"}
            </button>
          </div>

          {results.length > 0 && (
            <div className="output-block">
              {results.map((item) => (
                <div key={item.serial} className="stack" style={{ gap: 2, marginBottom: 8 }}>
                  <div className="inline-row">
                    <strong>{item.serial}</strong>
                    <span className={`status-pill ${item.exit_code === 0 ? "ok" : "error"}`}>
                      exit {item.exit_code ?? "?"}
                    </span>
                  </div>
                  {item.stdout.trim() && <pre>{item.stdout.trim()}</pre>}
                  {item.stderr.trim() && <pre className="muted">{item.stderr.trim()}</pre>}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
