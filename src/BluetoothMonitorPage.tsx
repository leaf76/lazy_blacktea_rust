import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type {
  BluetoothEventEvent,
  BluetoothParsedEvent,
  BluetoothParsedSnapshot,
  BluetoothSnapshotEvent,
  BluetoothState,
  BluetoothStateEvent,
  BluetoothStateSummary,
} from "./types";
import {
  bluetoothEventCategory,
  bluetoothEventLabel,
  bluetoothStateLabel,
  formatClockTime,
  formatRelativeFromMs,
  toUnixSeconds,
  type BluetoothEventCategory,
} from "./bluetoothMonitorUtils";

type BluetoothEventWithReceivedAt = {
  event: BluetoothParsedEvent;
  receivedAtMs: number;
};

type Props = {
  serial: string | null;
  serialLabel: string;
  busy: boolean;
  singleSelectionWarning: boolean;
  onToggleMonitor: (enable: boolean) => Promise<boolean>;
};

const EVENT_LIMIT = 200;
const RECENT_DATA_MS = 15_000;

const readBooleanMetric = (metrics: Record<string, unknown> | null | undefined, key: string) => {
  const value = metrics?.[key];
  return typeof value === "boolean" ? value : null;
};

const readNumberMetric = (metrics: Record<string, unknown> | null | undefined, key: string) => {
  const value = metrics?.[key];
  return typeof value === "number" ? value : null;
};

const valueToChipText = (value: unknown) => {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
};

const inferStatesFromSnapshot = (snapshot: BluetoothParsedSnapshot | null): BluetoothState[] => {
  if (!snapshot) {
    return ["Unknown"];
  }
  if (!snapshot.adapter_enabled) {
    return ["Off"];
  }
  const inferred: BluetoothState[] = [];
  if (snapshot.scanning.is_scanning) {
    inferred.push("Scanning");
  }
  if (snapshot.advertising.is_advertising) {
    inferred.push("Advertising");
  }
  const hasConnectedProfile = Object.values(snapshot.profiles ?? {}).some((value) => {
    const upper = value.toUpperCase();
    return upper.includes("CONNECTED") && !upper.includes("DISCONNECTED");
  });
  if (hasConnectedProfile) {
    inferred.push("Connected");
  }
  if (!inferred.length) {
    inferred.push("Idle");
  }
  return inferred;
};

export const BluetoothMonitorPage = ({
  serial,
  serialLabel,
  busy,
  singleSelectionWarning,
  onToggleMonitor,
}: Props) => {
  const serialRef = useRef<string | null>(serial);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const pendingEventsRef = useRef<BluetoothEventWithReceivedAt[]>([]);
  const timelinePausedRef = useRef(false);
  const [snapshot, setSnapshot] = useState<BluetoothParsedSnapshot | null>(null);
  const [snapshotReceivedAtMs, setSnapshotReceivedAtMs] = useState<number | null>(null);
  const [stateSummary, setStateSummary] = useState<BluetoothStateSummary | null>(null);
  const [stateReceivedAtMs, setStateReceivedAtMs] = useState<number | null>(null);
  const [events, setEvents] = useState<BluetoothEventWithReceivedAt[]>([]);
  const [lastEventReceivedAtMs, setLastEventReceivedAtMs] = useState<number | null>(null);
  const [monitoringDesired, setMonitoringDesired] = useState<boolean>(false);
  const [timelinePaused, setTimelinePaused] = useState(false);
  const [timelineNewCount, setTimelineNewCount] = useState(0);
  const [filterSearch, setFilterSearch] = useState<string>("");
  const [filterCategories, setFilterCategories] = useState<Record<BluetoothEventCategory, boolean>>({
    scan: true,
    advertising: true,
    connection: true,
    error: true,
  });
  const [rawOpen, setRawOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [bondSearch, setBondSearch] = useState("");
  const [bondShowAll, setBondShowAll] = useState(false);

  useEffect(() => {
    serialRef.current = serial;
    pendingEventsRef.current = [];
    setSnapshot(null);
    setSnapshotReceivedAtMs(null);
    setStateSummary(null);
    setStateReceivedAtMs(null);
    setEvents([]);
    setLastEventReceivedAtMs(null);
    setMonitoringDesired(false);
    setTimelinePaused(false);
    setTimelineNewCount(0);
    setCopyNotice(null);
    setBondSearch("");
    setBondShowAll(false);
  }, [serial]);

  useEffect(() => {
    timelinePausedRef.current = timelinePaused;
  }, [timelinePaused]);

  useEffect(() => {
    const unlistenSnapshot = listen<BluetoothSnapshotEvent>("bluetooth-snapshot", (event) => {
      const payload = event.payload;
      const currentSerial = serialRef.current;
      if (!currentSerial || payload.snapshot.serial !== currentSerial) {
        return;
      }
      const now = Date.now();
      setSnapshot(payload.snapshot);
      setSnapshotReceivedAtMs(now);
    });

    const unlistenState = listen<BluetoothStateEvent>("bluetooth-state", (event) => {
      const payload = event.payload;
      const currentSerial = serialRef.current;
      if (!currentSerial || payload.state.serial !== currentSerial) {
        return;
      }
      const now = Date.now();
      setStateSummary(payload.state);
      setStateReceivedAtMs(now);
    });

    const unlistenEvent = listen<BluetoothEventEvent>("bluetooth-event", (event) => {
      const payload = event.payload;
      const currentSerial = serialRef.current;
      if (!currentSerial || payload.event.serial !== currentSerial) {
        return;
      }
      const now = Date.now();
      setLastEventReceivedAtMs(now);
      if (timelinePausedRef.current) {
        pendingEventsRef.current = [{ event: payload.event, receivedAtMs: now }, ...pendingEventsRef.current].slice(
          0,
          EVENT_LIMIT,
        );
        setTimelineNewCount((prev) => prev + 1);
        return;
      }
      setEvents((prev) => [{ event: payload.event, receivedAtMs: now }, ...prev].slice(0, EVENT_LIMIT));
    });

    return () => {
      void unlistenSnapshot.then((unlisten) => unlisten());
      void unlistenState.then((unlisten) => unlisten());
      void unlistenEvent.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!timelinePaused) {
      return;
    }
    // When user scrolls back to the top, resume automatically.
    const node = timelineRef.current;
    if (!node) {
      return;
    }
    const onScroll = () => {
      if (node.scrollTop <= 4) {
        setTimelinePaused(false);
      }
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
    };
  }, [timelinePaused]);

  useEffect(() => {
    if (timelinePaused) {
      return;
    }
    if (!pendingEventsRef.current.length) {
      return;
    }
    const pending = pendingEventsRef.current;
    pendingEventsRef.current = [];
    setTimelineNewCount(0);
    setEvents((prev) => [...pending, ...prev].slice(0, EVENT_LIMIT));
  }, [timelinePaused]);

  const adapterEnabled = useMemo(() => {
    const byMetric = readBooleanMetric(stateSummary?.metrics, "adapter_enabled");
    if (byMetric != null) {
      return byMetric;
    }
    if (snapshot) {
      return snapshot.adapter_enabled;
    }
    return null;
  }, [snapshot, stateSummary]);

  const activeStates = useMemo(() => {
    const states = stateSummary?.active_states ?? null;
    if (states && states.length) {
      return states;
    }
    return inferStatesFromSnapshot(snapshot);
  }, [snapshot, stateSummary]);

  const lastAnyDataAtMs = useMemo(() => {
    const times = [snapshotReceivedAtMs, stateReceivedAtMs, lastEventReceivedAtMs].filter(
      (value): value is number => value != null,
    );
    if (!times.length) {
      return null;
    }
    return Math.max(...times);
  }, [lastEventReceivedAtMs, snapshotReceivedAtMs, stateReceivedAtMs]);

  const monitoringDetected = useMemo(() => {
    const now = Date.now();
    if (!serial) {
      return false;
    }
    return lastAnyDataAtMs != null && now - lastAnyDataAtMs <= RECENT_DATA_MS;
  }, [lastAnyDataAtMs, serial]);

  const filteredEvents = useMemo(() => {
    const query = filterSearch.trim().toLowerCase();
    return events.filter(({ event }) => {
      const category = bluetoothEventCategory(event.event_type);
      if (!filterCategories[category]) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = `${event.message} ${event.tag ?? ""} ${event.raw_line}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [events, filterCategories, filterSearch]);

  const scanningClientCount = snapshot?.scanning.clients.length ?? readNumberMetric(stateSummary?.metrics, "scanners") ?? 0;
  const advertisingSetCount =
    snapshot?.advertising.sets.length ?? readNumberMetric(stateSummary?.metrics, "advertising_sets") ?? 0;

  const nowMs = Date.now();
  const lastSnapshotText = formatRelativeFromMs(nowMs, snapshotReceivedAtMs);
  const lastEventText = formatRelativeFromMs(nowMs, lastEventReceivedAtMs);

  const handleCopyRaw = async () => {
    const text = snapshot?.raw_text?.trim() ?? "";
    if (!text) {
      setCopyNotice("Nothing to copy.");
      return;
    }
    try {
      await writeText(text);
      setCopyNotice("Copied raw dump to clipboard.");
    } catch {
      setCopyNotice("Copy failed.");
    }
  };

  const handleClearEvents = () => {
    pendingEventsRef.current = [];
    setTimelineNewCount(0);
    setEvents([]);
  };

  const handleResumeTimeline = () => {
    if (!timelineRef.current) {
      setTimelinePaused(false);
      return;
    }
    timelineRef.current.scrollTop = 0;
    setTimelinePaused(false);
  };

  const handleTimelineScroll = () => {
    const node = timelineRef.current;
    if (!node) {
      return;
    }
    if (node.scrollTop > 8 && !timelinePaused) {
      setTimelinePaused(true);
    }
  };

  const bondedDevicesFiltered = useMemo(() => {
    const list = snapshot?.bonded_devices ?? [];
    const query = bondSearch.trim().toLowerCase();
    if (!query) {
      return list;
    }
    return list.filter((device) => {
      const name = (device.name ?? "").toLowerCase();
      const addr = (device.address ?? "").toLowerCase();
      return name.includes(query) || addr.includes(query);
    });
  }, [bondSearch, snapshot?.bonded_devices]);

  const handleToggle = async () => {
    if (!serial) {
      return;
    }
    const next = !monitoringDesired;
    const ok = await onToggleMonitor(next);
    if (ok) {
      setMonitoringDesired(next);
    }
  };

  return (
    <section className="panel bluetooth-monitor">
      <div className="panel-header">
        <div>
          <h2>Bluetooth Monitor</h2>
          <p className="muted">State dashboard and event timeline for the selected device.</p>
        </div>
        <span>{serialLabel}</span>
      </div>

      {singleSelectionWarning && (
        <div className="inline-alert info">
          <strong>Single device required</strong>
          <span>Keep only one device selected (Device Context: Single) to use this page.</span>
        </div>
      )}

      <div className="bluetooth-monitor-header">
        <div className="bluetooth-monitor-header-left">
          <div className="bluetooth-monitor-status-row">
            <span
              className={`status-pill ${
                adapterEnabled == null ? "warn" : adapterEnabled ? "ok" : "error"
              }`}
            >
              {adapterEnabled == null
                ? "Adapter unknown"
                : adapterEnabled
                  ? "Adapter enabled"
                  : "Adapter disabled"}
            </span>
            <div className="bluetooth-monitor-state-pills">
              {activeStates.map((state) => (
                <span
                  key={state}
                  className={`status-pill ${
                    state === "Unknown" ? "warn" : state === "Off" ? "error" : "idle"
                  }`}
                >
                  {bluetoothStateLabel(state)}
                </span>
              ))}
            </div>
          </div>
          <div className="bluetooth-monitor-meta">
            <span className="muted">
              Adapter address: <code>{snapshot?.address ?? "—"}</code>
            </span>
            <span className="muted">Last snapshot: {lastSnapshotText}</span>
            <span className="muted">Last event: {lastEventText}</span>
          </div>
          {!serial ? (
            <div className="inline-alert info">
              <strong>Select a device</strong>
              <span>Choose exactly one device to start monitoring Bluetooth state.</span>
            </div>
          ) : !monitoringDetected && monitoringDesired ? (
            <div className="inline-alert warn">
              <strong>Waiting for data</strong>
              <span>
                Monitor is on, but no recent data arrived. Try toggling Bluetooth on the device or
                confirm ADB authorization.
              </span>
            </div>
          ) : null}
        </div>

        <div className="bluetooth-monitor-header-right">
          <div className="button-row">
            <button type="button" onClick={handleToggle} disabled={busy || !serial}>
              {monitoringDesired ? "Stop monitoring" : "Start monitoring"}
            </button>
            <button type="button" className="ghost" onClick={handleClearEvents} disabled={!events.length}>
              Clear events
            </button>
            <button type="button" className="ghost" onClick={() => setRawOpen((prev) => !prev)}>
              {rawOpen ? "Hide raw dump" : "Show raw dump"}
            </button>
          </div>
          <div className="bluetooth-monitor-header-note muted">
            {monitoringDetected ? "Receiving data" : "No recent data"}
          </div>
        </div>
      </div>

      <div className="dashboard-grid bluetooth-monitor-grid">
        <section className="panel card bluetooth-monitor-card bluetooth-monitor-card-adv">
          <div className="card-header">
            <h2>Advertising</h2>
            <span className={`status-pill ${snapshot?.advertising.is_advertising ? "ok" : "idle"}`}>
              {snapshot?.advertising.is_advertising ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="bluetooth-monitor-kpis">
            <span className="muted">Sets: {advertisingSetCount}</span>
          </div>
          {snapshot?.advertising.is_advertising && snapshot.advertising.sets.length ? (
            <div className="bluetooth-monitor-list">
              {snapshot.advertising.sets.map((set, index) => (
                <div key={`${set.set_id ?? "set"}-${index}`} className="bluetooth-monitor-row">
                  <div className="bluetooth-monitor-row-top">
                    <strong>Set {set.set_id ?? "—"}</strong>
                    <span className="muted">
                      Interval: {set.interval_ms ?? "—"}ms · TX: {set.tx_power ?? "—"} · Data: {set.data_length} bytes
                    </span>
                  </div>
                  {set.service_uuids.length ? (
                    <div className="bluetooth-monitor-chip-row">
                      {set.service_uuids.slice(0, 6).map((uuid) => (
                        <span key={uuid} className="filter-chip bluetooth-monitor-chip">
                          {uuid}
                        </span>
                      ))}
                      {set.service_uuids.length > 6 ? (
                        <span className="muted">+{set.service_uuids.length - 6} more</span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="muted">No service UUIDs detected.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No active advertising sets.</p>
          )}
        </section>

        <section className="panel card bluetooth-monitor-card bluetooth-monitor-card-scan">
          <div className="card-header">
            <h2>Scanning</h2>
            <span className={`status-pill ${snapshot?.scanning.is_scanning ? "busy" : "idle"}`}>
              {snapshot?.scanning.is_scanning ? "Active" : "Idle"}
            </span>
          </div>
          <div className="bluetooth-monitor-kpis">
            <span className="muted">Clients: {scanningClientCount}</span>
          </div>
          {snapshot?.scanning.is_scanning && snapshot.scanning.clients.length ? (
            <div className="bluetooth-monitor-list">
              {snapshot.scanning.clients.slice(0, 24).map((client) => (
                <div key={client} className="bluetooth-monitor-row bluetooth-monitor-row-tight">
                  <code>{client}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No active scanners.</p>
          )}
        </section>

        <section className="panel card bluetooth-monitor-card bluetooth-monitor-card-bond">
          <div className="card-header">
            <h2>Bonded Devices</h2>
            <span className="status-pill idle">{bondedDevicesFiltered.length}</span>
          </div>
          <div className="bluetooth-monitor-timeline-toolbar">
            <input
              value={bondSearch}
              onChange={(event) => setBondSearch(event.target.value)}
              placeholder="Search name or address"
            />
            <div className="button-row">
              <button
                type="button"
                className="ghost"
                onClick={() => setBondShowAll((prev) => !prev)}
                disabled={!bondedDevicesFiltered.length}
              >
                {bondShowAll ? "Show less" : "Show more"}
              </button>
            </div>
          </div>
          {bondedDevicesFiltered.length ? (
            <div className="bluetooth-monitor-list">
              {bondedDevicesFiltered.slice(0, bondShowAll ? 80 : 16).map((device) => (
                <div key={device.address} className="bluetooth-monitor-row">
                  <div className="bluetooth-monitor-row-top">
                    <strong>{device.name?.trim() || "Unknown device"}</strong>
                    <span className="muted">
                      <code>{device.address}</code>
                    </span>
                  </div>
                </div>
              ))}
              {bondedDevicesFiltered.length > (bondShowAll ? 80 : 16) ? (
                <p className="muted">
                  Showing {bondShowAll ? 80 : 16} of {bondedDevicesFiltered.length}.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="muted">No bonded devices found in snapshot.</p>
          )}

          <div className="bluetooth-monitor-divider" />
          <p className="eyebrow">Profiles</p>
          {snapshot && Object.keys(snapshot.profiles).length ? (
            <div className="bluetooth-monitor-profiles">
              {Object.entries(snapshot.profiles)
                .slice(0, 12)
                .map(([key, value]) => (
                  <span key={key} className="filter-chip bluetooth-monitor-chip">
                    {key}: {value}
                  </span>
                ))}
            </div>
          ) : (
            <p className="muted">No profile data detected.</p>
          )}
        </section>

        <section className="panel card bluetooth-monitor-card bluetooth-monitor-card-timeline">
          <div className="card-header">
            <h2>Live Events</h2>
            <span className="status-pill idle">{filteredEvents.length}</span>
          </div>

          <div className="bluetooth-monitor-timeline-toolbar">
            <input
              value={filterSearch}
              onChange={(event) => setFilterSearch(event.target.value)}
              placeholder="Search events"
            />
            <div className="filter-chip-list bluetooth-monitor-filterchips">
              {(
                [
                  ["scan", "Scan"],
                  ["advertising", "Advertising"],
                  ["connection", "Connection"],
                  ["error", "Errors"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`filter-chip ${filterCategories[key] ? "active" : ""}`}
                  onClick={() =>
                    setFilterCategories((prev) => ({
                      ...prev,
                      [key]: !prev[key],
                    }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {timelinePaused ? (
              <div className="bluetooth-monitor-paused">
                <span className="status-pill warn">Paused</span>
                <span className="muted">{timelineNewCount ? `${timelineNewCount} new` : ""}</span>
                <button type="button" className="ghost" onClick={handleResumeTimeline}>
                  Resume
                </button>
              </div>
            ) : null}
          </div>

          {filteredEvents.length ? (
            <div className="bluetooth-monitor-timeline" ref={timelineRef} onScroll={handleTimelineScroll}>
              {filteredEvents.map(({ event, receivedAtMs }, index) => {
                const category = bluetoothEventCategory(event.event_type);
                const time = formatClockTime(toUnixSeconds(event.timestamp, receivedAtMs));
                const label = bluetoothEventLabel(event.event_type);
                const metaKeys: Array<[string, string]> = [
                  ["client", "Client"],
                  ["set_id", "Set"],
                  ["tx_power", "TX"],
                  ["data_length", "Data"],
                ];
                const chips = metaKeys
                  .map(([key, prefix]) => {
                    const text = valueToChipText(event.metadata?.[key]);
                    return text ? `${prefix}: ${text}` : null;
                  })
                  .filter((value): value is string => Boolean(value));
                return (
                  <div
                    key={`${event.raw_line}-${event.timestamp}-${index}`}
                    className={`bluetooth-monitor-event bluetooth-monitor-event-${category}`}
                    title={event.raw_line}
                  >
                    <div className="bluetooth-monitor-event-time muted">{time}</div>
                    <div className="bluetooth-monitor-event-main">
                      <div className="bluetooth-monitor-event-title">
                        <span className="bluetooth-monitor-event-dot" />
                        <strong>{label}</strong>
                        {event.tag ? (
                          <span className="filter-chip bluetooth-monitor-chip bluetooth-monitor-tag">
                            {event.tag}
                          </span>
                        ) : null}
                      </div>
                      <div className="bluetooth-monitor-event-message">{event.message}</div>
                      {chips.length ? (
                        <div className="bluetooth-monitor-chip-row">
                          {chips.map((chip) => (
                            <span key={chip} className="filter-chip bluetooth-monitor-chip">
                              {chip}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bluetooth-monitor-empty">
              <p className="muted">No Bluetooth events yet.</p>
              <p className="muted">
                Try toggling Bluetooth, starting a scan, or connecting a headset to generate events.
              </p>
            </div>
          )}
        </section>
      </div>

      {rawOpen ? (
        <div className="bluetooth-monitor-raw">
          <div className="bluetooth-monitor-raw-header">
            <h3>Raw Bluetooth Dump</h3>
            <div className="button-row">
              <button
                type="button"
                className="ghost"
                onClick={handleCopyRaw}
                disabled={!snapshot?.raw_text?.trim()}
              >
                Copy
              </button>
            </div>
          </div>
          {copyNotice ? <p className="muted">{copyNotice}</p> : null}
          <div className="logcat-output bluetooth-monitor-raw-output">
            <div className="logcat-viewport">
              {(snapshot?.raw_text?.trim() || "No snapshot yet.").split("\n").map((line, index) => (
                <div key={`${index}-${line}`} className="logcat-line">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
