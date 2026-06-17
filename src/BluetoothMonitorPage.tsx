import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isTauriRuntime } from "./tauriEnv";
import type {
  BluetoothDiscoveredDeviceRow,
  BluetoothEventEvent,
  BluetoothMonitorEventEntry,
  BluetoothParsedSnapshot,
  BluetoothPairedDeviceRow,
  BluetoothSnapshotEvent,
  BluetoothStateEvent,
  BluetoothStateSummary,
} from "./types";
import {
  BLUETOOTH_MONITOR_RECENT_DATA_MS,
  buildBluetoothDiscoveredDeviceRows,
  buildBluetoothPairedDeviceRows,
  hasBluetoothMonitorSessionData,
  readBluetoothNumberMetric,
  resolveBluetoothActiveStates,
  resolveBluetoothAdapterEnabled,
  resolveBluetoothBondedEmptyState,
  resolveBluetoothMonitorSessionState,
  resolveBluetoothTimelineEmptyState,
  valueToChipText,
} from "./bluetoothMonitorState";
import {
  bluetoothEventCategory,
  bluetoothEventLabel,
  bluetoothStateLabel,
  formatClockTime,
  formatRelativeFromMs,
  toUnixSeconds,
  type BluetoothEventCategory,
} from "./bluetoothMonitorUtils";

type MonitorCommandOptions = {
  announce?: boolean;
};

type MonitorCommandResult = {
  ok: boolean;
  running: boolean;
  message?: string;
};

type ToggleCommandResult = {
  ok: boolean;
  message?: string;
};

type Props = {
  serial: string | null;
  serialLabel: string;
  commandBusy: boolean;
  monitoringDesired: boolean;
  singleSelectionWarning: boolean;
  singleSelectionWarningMessage: string;
  onSetMonitorDesired: (
    serial: string,
    enable: boolean,
    options?: MonitorCommandOptions,
  ) => Promise<MonitorCommandResult>;
  onEnableBluetooth: (serial: string) => Promise<ToggleCommandResult>;
};

const EVENT_LIMIT = 200;
const SESSION_EVENT_LIMIT = 500;

const sessionToneByState = {
  stopped: "idle",
  paused: "idle",
  starting: "busy",
  live: "ok",
  stale: "warn",
} as const;

const sessionLabelByState = {
  stopped: "Stopped",
  paused: "Paused",
  starting: "Preparing",
  live: "Live",
  stale: "Data stale",
} as const;

const eventCategoryOptions: Array<[BluetoothEventCategory, string]> = [
  ["scan", "Scan"],
  ["advertising", "Advertising"],
  ["connection", "Connection"],
  ["error", "Errors"],
];

type BluetoothEventRowProps = {
  entry: BluetoothMonitorEventEntry;
  onCopy: (rawLine: string) => void;
};

// Memoized so that prepending a new event re-renders only the new row, not all (up to 200) rows.
// Relies on a stable per-entry `id` key and a stable `onCopy` callback from the parent.
const BluetoothEventRow = memo(({ entry, onCopy }: BluetoothEventRowProps) => {
  const { event, receivedAtMs } = entry;
  const category = bluetoothEventCategory(event.event_type);
  const time = formatClockTime(toUnixSeconds(event.timestamp, receivedAtMs));
  const metadataEntries = Object.entries(event.metadata ?? {})
    .map(([key, value]) => {
      const text = valueToChipText(value);
      return text ? `${key}: ${text}` : null;
    })
    .filter((value): value is string => Boolean(value));
  return (
    <details className={`bluetooth-monitor-event bluetooth-monitor-event-${category}`}>
      <summary className="bluetooth-monitor-event-summary">
        <div className="bluetooth-monitor-event-time muted">{time}</div>
        <div className="bluetooth-monitor-event-main">
          <div className="bluetooth-monitor-event-title">
            <span className="bluetooth-monitor-event-dot" />
            <strong>{bluetoothEventLabel(event.event_type)}</strong>
            {event.tag ? (
              <span className="filter-chip bluetooth-monitor-chip bluetooth-monitor-tag">{event.tag}</span>
            ) : null}
          </div>
          <div className="bluetooth-monitor-event-message">{event.message}</div>
          {metadataEntries.length ? (
            <div className="bluetooth-monitor-chip-row">
              {metadataEntries.slice(0, 3).map((chip) => (
                <span key={chip} className="filter-chip bluetooth-monitor-chip">
                  {chip}
                </span>
              ))}
              {metadataEntries.length > 3 ? (
                <span className="muted">+{metadataEntries.length - 3} more</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </summary>

      <div className="bluetooth-monitor-event-details">
        {metadataEntries.length ? (
          <div className="bluetooth-monitor-chip-row">
            {metadataEntries.map((chip) => (
              <span key={chip} className="filter-chip bluetooth-monitor-chip">
                {chip}
              </span>
            ))}
          </div>
        ) : null}
        <pre className="bluetooth-monitor-event-raw">{event.raw_line}</pre>
        <div className="button-row compact">
          <button type="button" className="ghost" onClick={() => onCopy(event.raw_line)}>
            Copy row
          </button>
        </div>
      </div>
    </details>
  );
});
BluetoothEventRow.displayName = "BluetoothEventRow";

const formatScannerClientLabel = (client: string) => {
  const trimmed = client.trim();
  if (!trimmed) {
    return "Unknown scanner";
  }
  if (trimmed.startsWith("uid/")) {
    return `UID ${trimmed.slice(4)}`;
  }
  return trimmed;
};

export const BluetoothMonitorPage = ({
  serial,
  serialLabel,
  commandBusy,
  monitoringDesired,
  singleSelectionWarning,
  singleSelectionWarningMessage,
  onSetMonitorDesired,
  onEnableBluetooth,
}: Props) => {
  const tauriAvailable = isTauriRuntime();
  const serialRef = useRef<string | null>(serial);
  const ownedSerialRef = useRef<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const pendingEventsRef = useRef<BluetoothMonitorEventEntry[]>([]);
  const timelinePausedRef = useRef(false);
  const eventIdRef = useRef(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingMonitoringDesired, setPendingMonitoringDesired] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<BluetoothParsedSnapshot | null>(null);
  const [snapshotReceivedAtMs, setSnapshotReceivedAtMs] = useState<number | null>(null);
  const [stateSummary, setStateSummary] = useState<BluetoothStateSummary | null>(null);
  const [stateReceivedAtMs, setStateReceivedAtMs] = useState<number | null>(null);
  const [events, setEvents] = useState<BluetoothMonitorEventEntry[]>([]);
  const [sessionEvents, setSessionEvents] = useState<BluetoothMonitorEventEntry[]>([]);
  const [lastEventReceivedAtMs, setLastEventReceivedAtMs] = useState<number | null>(null);
  const [timelinePaused, setTimelinePaused] = useState(false);
  const [timelineNewCount, setTimelineNewCount] = useState(0);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterCategories, setFilterCategories] = useState<Record<BluetoothEventCategory, boolean>>({
    scan: true,
    advertising: true,
    connection: true,
    error: true,
  });
  const [rawOpen, setRawOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [bondSearch, setBondSearch] = useState("");
  const [bondShowAll, setBondShowAll] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(true);
  const [snapshotCollapsed, setSnapshotCollapsed] = useState(true);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    serialRef.current = serial;
    pendingEventsRef.current = [];
    setSnapshot(null);
    setSnapshotReceivedAtMs(null);
    setStateSummary(null);
    setStateReceivedAtMs(null);
    setEvents([]);
    setSessionEvents([]);
    setLastEventReceivedAtMs(null);
    setTimelinePaused(false);
    setTimelineNewCount(0);
    setCopyNotice(null);
    setCommandError(null);
    setBondSearch("");
    setBondShowAll(false);
    setTimelineCollapsed(true);
    setSnapshotCollapsed(true);
    setRawOpen(false);
    setPendingMonitoringDesired(null);
  }, [serial]);

  useEffect(() => {
    timelinePausedRef.current = timelinePaused;
  }, [timelinePaused]);

  useEffect(() => {
    if (!tauriAvailable) {
      return;
    }
    const unlistenSnapshot = listen<BluetoothSnapshotEvent>("bluetooth-snapshot", (event) => {
      const payload = event.payload;
      const currentSerial = serialRef.current;
      if (!currentSerial || payload.snapshot.serial !== currentSerial) {
        return;
      }
      const receivedAtMs = Date.now();
      setSnapshot(payload.snapshot);
      setSnapshotReceivedAtMs(receivedAtMs);
    });

    const unlistenState = listen<BluetoothStateEvent>("bluetooth-state", (event) => {
      const payload = event.payload;
      const currentSerial = serialRef.current;
      if (!currentSerial || payload.state.serial !== currentSerial) {
        return;
      }
      const receivedAtMs = Date.now();
      setStateSummary(payload.state);
      setStateReceivedAtMs(receivedAtMs);
    });

    const unlistenEvent = listen<BluetoothEventEvent>("bluetooth-event", (event) => {
      const payload = event.payload;
      const currentSerial = serialRef.current;
      if (!currentSerial || payload.event.serial !== currentSerial) {
        return;
      }
      const receivedAtMs = Date.now();
      setLastEventReceivedAtMs(receivedAtMs);
      const nextEntry = { id: eventIdRef.current++, event: payload.event, receivedAtMs };
      setSessionEvents((prev) => [nextEntry, ...prev].slice(0, SESSION_EVENT_LIMIT));
      if (timelinePausedRef.current) {
        pendingEventsRef.current = [nextEntry, ...pendingEventsRef.current].slice(0, EVENT_LIMIT);
        setTimelineNewCount((prev) => prev + 1);
        return;
      }
      setEvents((prev) => [nextEntry, ...prev].slice(0, EVENT_LIMIT));
    });

    return () => {
      void unlistenSnapshot.then((unlisten) => unlisten());
      void unlistenState.then((unlisten) => unlisten());
      void unlistenEvent.then((unlisten) => unlisten());
    };
  }, [tauriAvailable]);

  useEffect(() => {
    if (!timelinePaused) {
      return;
    }
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
    if (timelinePaused || !pendingEventsRef.current.length) {
      return;
    }
    const pending = pendingEventsRef.current;
    pendingEventsRef.current = [];
    setTimelineNewCount(0);
    setEvents((prev) => [...pending, ...prev].slice(0, EVENT_LIMIT));
  }, [timelinePaused]);

  useEffect(() => {
    return () => {
      if (!tauriAvailable) {
        return;
      }
      const serialToStop = ownedSerialRef.current;
      ownedSerialRef.current = null;
      if (serialToStop) {
        void onSetMonitorDesired(serialToStop, false, { announce: false });
      }
    };
  }, [onSetMonitorDesired, tauriAvailable]);

  const effectiveMonitoringDesired = pendingMonitoringDesired ?? monitoringDesired;

  const adapterEnabled = useMemo(
    () => resolveBluetoothAdapterEnabled(snapshot, stateSummary),
    [snapshot, stateSummary],
  );

  const activeStates = useMemo(
    () => resolveBluetoothActiveStates(snapshot, stateSummary),
    [snapshot, stateSummary],
  );

  const lastAnyDataAtMs = useMemo(() => {
    const timestamps = [snapshotReceivedAtMs, stateReceivedAtMs, lastEventReceivedAtMs].filter(
      (value): value is number => value != null,
    );
    if (!timestamps.length) {
      return null;
    }
    return Math.max(...timestamps);
  }, [lastEventReceivedAtMs, snapshotReceivedAtMs, stateReceivedAtMs]);

  const sessionState = resolveBluetoothMonitorSessionState({
    serial,
    monitoringDesired: effectiveMonitoringDesired,
    lastAnyDataAtMs,
    nowMs,
    recentDataMs: BLUETOOTH_MONITOR_RECENT_DATA_MS,
  });

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

  const pairedDevices = useMemo<BluetoothPairedDeviceRow[]>(
    () =>
      buildBluetoothPairedDeviceRows({
        snapshot,
        stateSummary,
        events: sessionEvents,
      }),
    [sessionEvents, snapshot, stateSummary],
  );
  const discoveredDevices = useMemo<BluetoothDiscoveredDeviceRow[]>(
    () =>
      buildBluetoothDiscoveredDeviceRows({
        snapshot,
        events: sessionEvents,
      }),
    [sessionEvents, snapshot],
  );
  const bondedDevicesFiltered = useMemo(() => {
    const list = pairedDevices;
    const query = bondSearch.trim().toLowerCase();
    if (!query) {
      return list;
    }
    return list.filter((device) => {
      const name = (device.name ?? "").toLowerCase();
      const address = device.address.toLowerCase();
      return name.includes(query) || address.includes(query);
    });
  }, [bondSearch, pairedDevices]);
  const profiles = useMemo(() => Object.entries(snapshot?.profiles ?? {}), [snapshot]);
  const scanningClientCount =
    snapshot?.scanning.clients.length ?? readBluetoothNumberMetric(stateSummary?.metrics, "scanners") ?? 0;
  const advertisingSetCount =
    snapshot?.advertising.sets.length ?? readBluetoothNumberMetric(stateSummary?.metrics, "advertising_sets") ?? 0;
  const hasActiveFilters =
    filterSearch.trim().length > 0 || Object.values(filterCategories).some((enabled) => !enabled);
  const timelineEmptyState = resolveBluetoothTimelineEmptyState({
    totalEvents: events.length,
    filteredEvents: filteredEvents.length,
    hasFilters: hasActiveFilters,
  });
  const bondedEmptyState = resolveBluetoothBondedEmptyState({
    totalDevices: pairedDevices.length,
    filteredDevices: bondedDevicesFiltered.length,
    hasSearch: bondSearch.trim().length > 0,
  });

  const statusTone = sessionToneByState[sessionState];
  const statusLabel = sessionLabelByState[sessionState];
  const lastSnapshotText = formatRelativeFromMs(nowMs, snapshotReceivedAtMs);
  const lastEventText = formatRelativeFromMs(nowMs, lastEventReceivedAtMs);
  const lastActivityText = formatRelativeFromMs(nowMs, lastAnyDataAtMs);
  const bluetoothOff = adapterEnabled === false || activeStates.includes("Off");
  const advertisingActive = (snapshot?.advertising.is_advertising ?? false) || activeStates.includes("Advertising");
  const scanningActive = (snapshot?.scanning.is_scanning ?? false) || activeStates.includes("Scanning");
  const scannerPreview = useMemo(
    () => (snapshot?.scanning.clients ?? []).slice(0, 3).map(formatScannerClientLabel),
    [snapshot],
  );
  const advertisingHeadline = advertisingActive ? "Advertising now" : "Not advertising";
  const advertisingSummary = advertisingActive
    ? advertisingSetCount > 0
      ? `${advertisingSetCount} active set${advertisingSetCount === 1 ? "" : "s"} detected in the latest snapshot.`
      : "Advertising activity is present, but no active set details were captured."
    : "No active advertising sets in the latest snapshot.";
  const scanningHeadline = scanningActive ? "Scanning now" : "Not scanning";
  const scanningSummary = scanningActive
    ? scanningClientCount > 0
      ? `${scanningClientCount} scanner${scanningClientCount === 1 ? "" : "s"} active right now.`
      : "Scanning activity is present, but no scanner list was captured."
    : "No active scanners in the latest snapshot.";
  const hasClearableSessionData = hasBluetoothMonitorSessionData({
    visibleEvents: events.length,
    sessionEvents: sessionEvents.length,
    queuedEvents: timelineNewCount,
  });

  const handleCopyText = useCallback(async (text: string, successMessage: string) => {
    if (!text.trim()) {
      setCopyNotice("Nothing to copy.");
      return;
    }
    try {
      await writeText(text);
      setCopyNotice(successMessage);
    } catch {
      setCopyNotice("Copy failed.");
    }
  }, []);

  // Stable identity so the memoized event rows are not invalidated on every parent render.
  const handleCopyEventRow = useCallback(
    (rawLine: string) => {
      void handleCopyText(rawLine, "Copied event row to clipboard.");
    },
    [handleCopyText],
  );

  const handleCopyRaw = async () => {
    await handleCopyText(snapshot?.raw_text?.trim() ?? "", "Copied raw snapshot to clipboard.");
  };

  const handleMonitorAction = async () => {
    if (!serial) {
      return;
    }
    setCommandError(null);
    const nextDesired = !monitoringDesired;
    setPendingMonitoringDesired(nextDesired);
    const result = await onSetMonitorDesired(serial, nextDesired, { announce: true });
    setPendingMonitoringDesired(null);
    if (!result.ok) {
      setCommandError(result.message ?? "Bluetooth monitor command failed.");
      return;
    }
    if (result.running) {
      ownedSerialRef.current = serial;
      return;
    }
    if (ownedSerialRef.current === serial) {
      ownedSerialRef.current = null;
    }
  };

  const handleEnableBluetooth = async () => {
    if (!serial) {
      return;
    }
    setCommandError(null);
    const result = await onEnableBluetooth(serial);
    if (!result.ok) {
      setCommandError(result.message ?? "Failed to enable Bluetooth.");
    }
  };

  const handleClearEvents = () => {
    pendingEventsRef.current = [];
    setTimelineNewCount(0);
    setEvents([]);
    setSessionEvents([]);
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

  if (!serial) {
    return (
      <section className="panel empty-state">
        <div>
          <h2>Select a device</h2>
          <p className="muted">Choose a primary device to inspect Bluetooth state and events.</p>
        </div>
      </section>
    );
  }

  return (
    <div className="bluetooth-monitor">
      {singleSelectionWarning && (
        <div className="inline-alert info">
          <strong>Primary device in use</strong>
          <span>{singleSelectionWarningMessage}</span>
        </div>
      )}

      {!tauriAvailable ? (
        <div className="inline-alert info">
          <strong>Browser preview mode</strong>
          <span>Bluetooth monitoring commands are unavailable until the app runs inside Tauri.</span>
        </div>
      ) : null}

      {commandError ? (
        <div className="inline-alert error">
          <strong>Bluetooth monitor error</strong>
          <span>{commandError}</span>
        </div>
      ) : null}

      {!commandError && bluetoothOff ? (
        <div className="inline-alert warn">
          <strong>Bluetooth is off</strong>
          <span>Turn Bluetooth on for the selected device before using Bluetooth Monitor features.</span>
          <div className="button-row compact">
            <button type="button" onClick={handleEnableBluetooth} disabled={commandBusy || !tauriAvailable}>
              Enable Bluetooth
            </button>
          </div>
        </div>
      ) : null}

      {!commandError && !bluetoothOff && sessionState === "starting" ? (
        <div className="inline-alert info">
          <strong>Preparing monitor</strong>
          <span>Connecting to the selected device and waiting for the first Bluetooth snapshot.</span>
        </div>
      ) : null}

      {!commandError && !bluetoothOff && sessionState === "stale" ? (
        <div className="inline-alert warn">
          <strong>Data is stale</strong>
          <span>Monitoring is on, but no recent Bluetooth data arrived. Check the device or resume monitoring.</span>
        </div>
      ) : null}

      <section className="panel bluetooth-monitor-hero">
        <div className="bluetooth-monitor-hero-main">
          <div className="bluetooth-monitor-status-row">
            <span className={`status-pill ${statusTone}`}>{statusLabel}</span>
            <span className={`status-pill ${adapterEnabled == null ? "warn" : adapterEnabled ? "ok" : "error"}`}>
              {adapterEnabled == null
                ? "Adapter unknown"
                : adapterEnabled
                  ? "Adapter enabled"
                  : "Adapter disabled"}
            </span>
            {activeStates.map((state) => (
              <span
                key={state}
                className={`status-pill ${state === "Unknown" ? "warn" : state === "Off" ? "error" : "idle"}`}
              >
                {bluetoothStateLabel(state)}
              </span>
            ))}
          </div>
          <div className="bluetooth-monitor-meta">
            <span className="muted">
              Device: <strong>{serialLabel}</strong>
            </span>
            <span className="muted">
              Adapter address: <code>{snapshot?.address ?? "—"}</code>
            </span>
            <span className="muted">Updated: {lastActivityText}</span>
            <span className="muted">Snapshot: {lastSnapshotText}</span>
            <span className="muted">Events: {lastEventText}</span>
          </div>

          <div className="bluetooth-monitor-current-activity" aria-label="Current Bluetooth activity">
            <div className={`bluetooth-monitor-activity-card ${advertisingActive ? "is-active" : ""}`}>
              <div className="bluetooth-monitor-activity-top">
                <span className="muted">Now Advertising</span>
                <span className={`status-pill ${advertisingActive ? "ok" : "idle"}`}>
                  {advertisingActive ? "Yes" : "No"}
                </span>
              </div>
              <strong>{advertisingHeadline}</strong>
              <span className="muted">{advertisingSummary}</span>
              {snapshot?.advertising.sets.length ? (
                <div className="bluetooth-monitor-chip-row bluetooth-monitor-chip-row-compact">
                  {snapshot.advertising.sets.slice(0, 3).map((set, index) => (
                    <span key={`${set.set_id ?? "set"}-${index}`} className="filter-chip bluetooth-monitor-chip">
                      Set {set.set_id ?? index + 1}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={`bluetooth-monitor-activity-card ${scanningActive ? "is-active" : ""}`}>
              <div className="bluetooth-monitor-activity-top">
                <span className="muted">Now Scanning</span>
                <span className={`status-pill ${scanningActive ? "busy" : "idle"}`}>
                  {scanningActive ? "Yes" : "No"}
                </span>
              </div>
              <strong>{scanningHeadline}</strong>
              <span className="muted">{scanningSummary}</span>
              {scannerPreview.length ? (
                <div className="bluetooth-monitor-chip-row bluetooth-monitor-chip-row-compact">
                  {scannerPreview.map((client) => (
                    <span key={client} className="filter-chip bluetooth-monitor-chip">
                      {client}
                    </span>
                  ))}
                  {scanningClientCount > scannerPreview.length ? (
                    <span className="muted">+{scanningClientCount - scannerPreview.length} more</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="bluetooth-monitor-hero-actions">
          <div className="button-row">
            <button
              type="button"
              onClick={handleMonitorAction}
              disabled={commandBusy || !tauriAvailable || bluetoothOff}
              title={bluetoothOff ? "Turn Bluetooth on before starting the monitor." : undefined}
            >
              {effectiveMonitoringDesired ? "Pause monitoring" : "Resume monitoring"}
            </button>
            <button type="button" className="ghost" onClick={handleClearEvents} disabled={!hasClearableSessionData}>
              Clear events
            </button>
            <button type="button" className="ghost" onClick={() => setRawOpen((prev) => !prev)}>
              {rawOpen ? "Hide raw snapshot" : "Show raw snapshot"}
            </button>
          </div>
        </div>
      </section>

      <div className="dashboard-grid bluetooth-monitor-grid">
        <section
          className={`panel card bluetooth-monitor-card bluetooth-monitor-card-timeline${
            timelineCollapsed ? " is-collapsed" : ""
          }`}
        >
          <div className="card-header">
            <h2>Live Events</h2>
            <div className="bluetooth-monitor-card-actions">
              <span className="status-pill idle">
                {hasActiveFilters ? `${filteredEvents.length} / ${events.length}` : filteredEvents.length}
              </span>
              <button
                type="button"
                className="ghost bluetooth-monitor-collapse-button"
                aria-expanded={!timelineCollapsed}
                onClick={() => setTimelineCollapsed((prev) => !prev)}
              >
                {timelineCollapsed ? "Expand" : "Collapse"}
              </button>
            </div>
          </div>

          {!timelineCollapsed ? (
            <>
          <div className="bluetooth-monitor-toolbar">
            <input
              value={filterSearch}
              onChange={(event) => setFilterSearch(event.target.value)}
              placeholder="Search events"
              aria-label="Search Bluetooth events"
            />
            <div className="filter-chip-list bluetooth-monitor-filterchips" aria-label="Bluetooth event category filters">
              {eventCategoryOptions.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`filter-chip ${filterCategories[key] ? "active" : ""}`}
                  aria-pressed={filterCategories[key]}
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
                <span className="muted">{timelineNewCount ? `${timelineNewCount} new` : "New events will queue"}</span>
                <button type="button" className="ghost" onClick={handleResumeTimeline}>
                  Resume
                </button>
              </div>
            ) : null}
          </div>

          {filteredEvents.length ? (
            <div className="bluetooth-monitor-timeline" ref={timelineRef} onScroll={handleTimelineScroll}>
              {filteredEvents.map((entry) => (
                <BluetoothEventRow key={entry.id} entry={entry} onCopy={handleCopyEventRow} />
              ))}
            </div>
          ) : (
            <div className="bluetooth-monitor-empty">
              <p>{timelineEmptyState.title}</p>
              <p className="muted">{timelineEmptyState.body}</p>
            </div>
          )}
            </>
          ) : (
            <div className="bluetooth-monitor-collapsed-summary">
              <span className="muted">
                {filteredEvents.length ? `Latest visible events: ${filteredEvents.length}` : timelineEmptyState.title}
              </span>
            </div>
          )}
        </section>

        <section
          className={`panel card bluetooth-monitor-card bluetooth-monitor-card-snapshot${
            snapshotCollapsed ? " is-collapsed" : ""
          }`}
        >
          <div className="card-header">
            <h2>Activity Snapshot</h2>
            <div className="bluetooth-monitor-card-actions">
              <span className={`status-pill ${sessionState === "live" ? "ok" : sessionState === "starting" ? "busy" : "idle"}`}>
                {sessionState === "live" ? "Fresh" : sessionState === "starting" ? "Loading" : "Snapshot"}
              </span>
              <button
                type="button"
                className="ghost bluetooth-monitor-collapse-button"
                aria-expanded={!snapshotCollapsed}
                onClick={() => setSnapshotCollapsed((prev) => !prev)}
              >
                {snapshotCollapsed ? "Expand" : "Collapse"}
              </button>
            </div>
          </div>

          {!snapshotCollapsed ? (
            <>
          <div className="bluetooth-monitor-kpis">
            <span className="muted">Advertising sets: {advertisingSetCount}</span>
            <span className="muted">Scanners: {scanningClientCount}</span>
          </div>

          <div className="bluetooth-monitor-section">
            <div className="bluetooth-monitor-section-header">
              <h3>Advertising</h3>
              <span className={`status-pill ${snapshot?.advertising.is_advertising ? "ok" : "idle"}`}>
                {snapshot?.advertising.is_advertising ? "Active" : "Inactive"}
              </span>
            </div>
            {snapshot?.advertising.sets.length ? (
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
                        {set.service_uuids.slice(0, 5).map((uuid) => (
                          <span key={uuid} className="filter-chip bluetooth-monitor-chip">
                            {uuid}
                          </span>
                        ))}
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
          </div>

          <div className="bluetooth-monitor-section">
            <div className="bluetooth-monitor-section-header">
              <h3>Scanning</h3>
              <span className={`status-pill ${snapshot?.scanning.is_scanning ? "busy" : "idle"}`}>
                {snapshot?.scanning.is_scanning ? "Active" : "Idle"}
              </span>
            </div>
            {snapshot?.scanning.clients.length ? (
              <div className="bluetooth-monitor-list">
                {snapshot.scanning.clients.slice(0, 12).map((client) => (
                  <div key={client} className="bluetooth-monitor-row bluetooth-monitor-row-tight">
                    <code>{client}</code>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No active scanners.</p>
            )}
          </div>

          <div className="bluetooth-monitor-section">
            <div className="bluetooth-monitor-section-header">
              <h3>Profiles</h3>
              <span className="muted">{profiles.length}</span>
            </div>
            {profiles.length ? (
              <div className="bluetooth-monitor-profiles">
                {profiles.slice(0, 12).map(([key, value]) => (
                  <span key={key} className="filter-chip bluetooth-monitor-chip">
                    {key}: {value}
                  </span>
                ))}
              </div>
          ) : (
              <p className="muted">No profile data detected.</p>
            )}
          </div>
            </>
          ) : (
            <div className="bluetooth-monitor-collapsed-summary">
              <span className="muted">
                Advertising sets: {advertisingSetCount} · Scanners: {scanningClientCount} · Profiles: {profiles.length}
              </span>
            </div>
          )}
        </section>

        <section className="panel card bluetooth-monitor-card bluetooth-monitor-card-paired">
          <div className="card-header">
            <h2>Paired Devices</h2>
            <span className="status-pill idle">{pairedDevices.length}</span>
          </div>

          <div className="bluetooth-monitor-section">
            <div className="bluetooth-monitor-section-header">
              <h3>Known on this device</h3>
              <span className="muted">{bondedDevicesFiltered.length}</span>
            </div>
            <div className="bluetooth-monitor-toolbar bluetooth-monitor-toolbar-compact">
              <input
                value={bondSearch}
                onChange={(event) => setBondSearch(event.target.value)}
                placeholder="Search name or address"
                aria-label="Search paired Bluetooth devices"
              />
              <button
                type="button"
                className="ghost"
                onClick={() => setBondShowAll((prev) => !prev)}
                disabled={!bondedDevicesFiltered.length}
              >
                {bondShowAll ? "Show less" : "Show more"}
              </button>
            </div>

            {bondedDevicesFiltered.length ? (
              <div className="bluetooth-monitor-list">
                {bondedDevicesFiltered.slice(0, bondShowAll ? 80 : 12).map((device) => (
                  <div key={device.address} className="bluetooth-monitor-row">
                    <div className="bluetooth-monitor-row-top">
                      <div className="bluetooth-monitor-row-inline">
                        <strong>{device.name?.trim() || "Unknown device"}</strong>
                        <div className="bluetooth-monitor-chip-row bluetooth-monitor-chip-row-compact">
                          <span className={`status-pill ${device.connection_tone}`}>
                            {device.connection_label}
                          </span>
                          <span className="filter-chip bluetooth-monitor-chip">{device.bond_state}</span>
                        </div>
                      </div>
                      <span className="muted">
                        <code>{device.address}</code>
                      </span>
                      {device.connection_detail ? <span className="muted">{device.connection_detail}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bluetooth-monitor-empty bluetooth-monitor-empty-compact">
                <p>{bondedEmptyState.title}</p>
                <p className="muted">{bondedEmptyState.body}</p>
              </div>
            )}
          </div>
        </section>

        <section className="panel card bluetooth-monitor-card bluetooth-monitor-card-discovered">
          <div className="card-header">
            <h2>Discovered Devices</h2>
            <span className="status-pill idle">{discoveredDevices.length}</span>
          </div>
          <div className="bluetooth-monitor-section">
            <div className="bluetooth-monitor-section-header">
              <h3>Seen in this monitor session</h3>
              <span className="muted">{sessionEvents.length} events tracked</span>
            </div>
            {discoveredDevices.length ? (
              <div className="bluetooth-monitor-list">
                {discoveredDevices.map((device) => (
                  <div key={device.address} className="bluetooth-monitor-row">
                    <div className="bluetooth-monitor-row-top">
                      <div className="bluetooth-monitor-row-inline">
                        <strong>{device.name?.trim() || "Unknown device"}</strong>
                        <div className="bluetooth-monitor-chip-row bluetooth-monitor-chip-row-compact">
                          {device.paired ? <span className="status-pill busy">Paired</span> : null}
                          <span className="filter-chip bluetooth-monitor-chip">
                            RSSI: {device.last_rssi != null ? `${device.last_rssi} dBm` : "—"}
                          </span>
                        </div>
                      </div>
                      <span className="muted">
                        <code>{device.address}</code>
                      </span>
                      <span className="muted">Last seen {formatRelativeFromMs(nowMs, device.last_seen_at_ms)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bluetooth-monitor-empty bluetooth-monitor-empty-compact">
                <p>No discovered devices yet.</p>
                <p className="muted">Scan results seen during this monitor session will accumulate here.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {rawOpen ? (
        <section className="panel bluetooth-monitor-raw">
          <div className="bluetooth-monitor-raw-header">
            <div>
              <h3>Raw Bluetooth Snapshot</h3>
              <p className="muted">Low-level diagnostic dump for deeper inspection.</p>
            </div>
            <div className="button-row">
              <button type="button" className="ghost" onClick={handleCopyRaw} disabled={!snapshot?.raw_text?.trim()}>
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
        </section>
      ) : null}
    </div>
  );
};
