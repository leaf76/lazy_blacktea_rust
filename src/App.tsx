import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openExternal } from "@tauri-apps/plugin-opener";
import type {
  AppConfig,
  AppInfo,
  BugreportResult,
  DeviceFileEntry,
  DeviceInfo,
  FilePreview,
  LogcatEvent,
  ScrcpyInfo,
} from "./types";
import {
  cancelBugreport,
  captureScreenshot,
  captureUiHierarchy,
  checkScrcpy,
  clearAppData,
  clearLogcat,
  forceStopApp,
  generateBugreport,
  getConfig,
  installApkBatch,
  launchScrcpy,
  listApps,
  listDeviceFiles,
  listDevices,
  openAppInfo,
  previewLocalFile,
  pullDeviceFile,
  rebootDevices,
  resetConfig,
  runShell,
  saveConfig,
  setAppEnabled,
  setBluetoothState,
  setWifiState,
  startBluetoothMonitor,
  startLogcat,
  startScreenRecord,
  stopBluetoothMonitor,
  stopLogcat,
  stopScreenRecord,
  uninstallApp,
} from "./api";
import "./App.css";

type Toast = { id: string; message: string; tone: "info" | "error" };
type BugreportProgress = { serial: string; progress: number; trace_id: string };

const tabList = [
  "Devices",
  "Commands",
  "Install",
  "Files",
  "Logcat",
  "Apps",
  "Bugreport",
  "Bluetooth",
  "Settings",
] as const;

function App() {
  const [activeTab, setActiveTab] = useState<(typeof tabList)[number]>("Devices");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [shellCommand, setShellCommand] = useState("");
  const [shellOutput, setShellOutput] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [logcatFilter, setLogcatFilter] = useState("");
  const [logcatLines, setLogcatLines] = useState<Record<string, string[]>>({});
  const [filesPath, setFilesPath] = useState("/sdcard");
  const [files, setFiles] = useState<DeviceFileEntry[]>([]);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [uiHtml, setUiHtml] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [groupMap, setGroupMap] = useState<Record<string, string>>({});
  const [groupName, setGroupName] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [apkPath, setApkPath] = useState("");
  const [apkExtraArgs, setApkExtraArgs] = useState("");
  const [apkAllowDowngrade, setApkAllowDowngrade] = useState(true);
  const [apkReplace, setApkReplace] = useState(true);
  const [apkGrant, setApkGrant] = useState(true);
  const [apkAllowTest, setApkAllowTest] = useState(false);
  const [screenRecordRemote, setScreenRecordRemote] = useState<string | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [appsFilter, setAppsFilter] = useState("");
  const [appsThirdPartyOnly, setAppsThirdPartyOnly] = useState(true);
  const [appsIncludeVersions, setAppsIncludeVersions] = useState(false);
  const [selectedApp, setSelectedApp] = useState<AppInfo | null>(null);
  const [bugreportProgress, setBugreportProgress] = useState<number | null>(null);
  const [bugreportResult, setBugreportResult] = useState<BugreportResult | null>(null);
  const [bluetoothEvents, setBluetoothEvents] = useState<string[]>([]);
  const [bluetoothState, setBluetoothStateText] = useState<string>("");
  const [scrcpyInfo, setScrcpyInfo] = useState<ScrcpyInfo | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);

  const activeSerial = selectedSerials[0];

  const pushToast = (message: string, tone: Toast["tone"]) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  };

  const refreshDevices = async () => {
    setBusy(true);
    try {
      const response = await listDevices(true);
      setDevices(response.data);
      setSelectedSerials((prev) =>
        prev.filter((serial) => response.data.some((device) => device.summary.serial === serial)),
      );
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const loadConfig = async () => {
    try {
      const response = await getConfig();
      setConfig(response.data);
      setApkExtraArgs(response.data.apk_install.extra_args);
      setApkAllowDowngrade(response.data.apk_install.allow_downgrade);
      setApkReplace(response.data.apk_install.replace_existing);
      setApkGrant(response.data.apk_install.grant_permissions);
      setApkAllowTest(response.data.apk_install.allow_test_packages);
      setGroupMap(flattenGroups(response.data.device_groups));
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  useEffect(() => {
    refreshDevices();
    loadConfig();
    void checkScrcpy().then((response) => setScrcpyInfo(response.data)).catch(() => null);
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }
    setConfig((prev) =>
      prev ? { ...prev, device_groups: expandGroups(groupMap) } : prev,
    );
  }, [groupMap]);

  useEffect(() => {
    const unlistenLogcat = listen<LogcatEvent>("logcat-line", (event) => {
      const payload = event.payload;
      setLogcatLines((prev) => {
        const current = prev[payload.serial] ?? [];
        const updated = [...current, payload.line].slice(-2000);
        return { ...prev, [payload.serial]: updated };
      });
    });
    const unlistenBluetoothSnapshot = listen("bluetooth-snapshot", (event) => {
      const payload = event.payload as { snapshot?: { summary?: string } };
      if (payload?.snapshot?.summary) {
        setBluetoothStateText(payload.snapshot.summary);
      }
    });
    const unlistenBluetoothState = listen("bluetooth-state", (event) => {
      const payload = event.payload as { state?: { summary?: string } };
      if (payload?.state?.summary) {
        setBluetoothStateText(payload.state.summary);
      }
    });
    const unlistenBluetoothEvent = listen("bluetooth-event", (event) => {
      const payload = event.payload as { event?: { message?: string } };
      if (payload?.event?.message) {
        setBluetoothEvents((prev) => [payload.event?.message ?? "", ...prev].slice(0, 200));
      }
    });
    const unlistenBugreportProgress = listen<BugreportProgress>("bugreport-progress", (event) => {
      const payload = event.payload;
      if (!activeSerial || payload.serial === activeSerial) {
        setBugreportProgress(payload.progress);
      }
    });
    const unlistenBugreportComplete = listen("bugreport-complete", (event) => {
      const payload = event.payload as { result?: BugreportResult };
      if (payload?.result) {
        setBugreportResult(payload.result);
        setBugreportProgress(payload.result.progress ?? null);
      }
    });

    return () => {
      void unlistenLogcat.then((unlisten) => unlisten());
      void unlistenBluetoothSnapshot.then((unlisten) => unlisten());
      void unlistenBluetoothState.then((unlisten) => unlisten());
      void unlistenBluetoothEvent.then((unlisten) => unlisten());
      void unlistenBugreportProgress.then((unlisten) => unlisten());
      void unlistenBugreportComplete.then((unlisten) => unlisten());
    };
  }, [activeSerial]);

  const groupOptions = useMemo(
    () => Array.from(new Set(Object.values(groupMap))).filter(Boolean).sort(),
    [groupMap],
  );

  const visibleDevices = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    return devices.filter((device) => {
      const serial = device.summary.serial;
      const model = device.detail?.model ?? device.summary.model ?? "";
      const matchesSearch = !search || serial.toLowerCase().includes(search) || model.toLowerCase().includes(search);
      if (!matchesSearch) {
        return false;
      }
      if (groupFilter === "all") {
        return true;
      }
      return groupMap[serial] === groupFilter;
    });
  }, [devices, groupFilter, groupMap, searchText]);

  const toggleDevice = (serial: string) => {
    setSelectedSerials((prev) =>
      prev.includes(serial) ? prev.filter((item) => item !== serial) : [...prev, serial],
    );
  };

  const selectAllVisible = () => {
    setSelectedSerials(visibleDevices.map((device) => device.summary.serial));
  };

  const clearSelection = () => {
    setSelectedSerials([]);
  };

  const handleAssignGroup = () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device to assign group.", "error");
      return;
    }
    const trimmed = groupName.trim();
    setGroupMap((prev) => {
      const next = { ...prev };
      for (const serial of selectedSerials) {
        if (trimmed) {
          next[serial] = trimmed;
        } else {
          delete next[serial];
        }
      }
      return next;
    });
    pushToast(trimmed ? `Assigned ${trimmed}.` : "Cleared group assignment.", "info");
  };

  const handleRunShell = async () => {
    if (!shellCommand.trim()) {
      pushToast("Please enter a shell command.", "error");
      return;
    }
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await runShell(selectedSerials, shellCommand, config?.command.parallel_execution);
      const output = response.data.map(
        (result) =>
          `${result.serial} (${result.exit_code ?? "?"}):\n${result.stdout || result.stderr || ""}`,
      );
      setShellOutput(output);
      pushToast("Shell command completed.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleReboot = async (mode?: string) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      await rebootDevices(selectedSerials, mode);
      pushToast("Reboot command sent.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleWifi = async (enable: boolean) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      await setWifiState(selectedSerials, enable);
      pushToast(enable ? "WiFi enabled." : "WiFi disabled.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBluetooth = async (enable: boolean) => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      await setBluetoothState(selectedSerials, enable);
      pushToast(enable ? "Bluetooth enabled." : "Bluetooth disabled.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleInstallApk = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device for APK install.", "error");
      return;
    }
    let path = apkPath;
    if (!path) {
      const selected = await openDialog({
        title: "Select APK",
        multiple: false,
        filters: [{ name: "APK", extensions: ["apk"] }],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      path = selected;
      setApkPath(path);
    }
    setBusy(true);
    try {
      const response = await installApkBatch(
        selectedSerials,
        path,
        apkReplace,
        apkAllowDowngrade,
        apkGrant,
        apkAllowTest,
        apkExtraArgs,
      );
      const results = Object.values(response.data.results || {});
      const successCount = results.filter((item) => item.success).length;
      const summary = `Installed ${successCount}/${results.length} device(s)`;
      setShellOutput([summary]);
      pushToast("APK install completed.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleScreenshot = async () => {
    if (!activeSerial) {
      pushToast("Select one device for screenshot.", "error");
      return;
    }
    let outputDir = config?.output_path || "";
    if (!outputDir) {
      const selected = await openDialog({
        title: "Select output folder",
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      outputDir = selected;
    }
    setBusy(true);
    try {
      const response = await captureScreenshot(activeSerial, outputDir);
      pushToast(`Screenshot saved to ${response.data}`, "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleScreenRecordStart = async () => {
    if (!activeSerial) {
      pushToast("Select one device for screen record.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await startScreenRecord(activeSerial);
      setScreenRecordRemote(response.data);
      pushToast("Screen recording started.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleScreenRecordStop = async () => {
    if (!activeSerial) {
      pushToast("Select one device for screen record.", "error");
      return;
    }
    let outputDir = config?.output_path || "";
    if (!outputDir) {
      const selected = await openDialog({
        title: "Select output folder",
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      outputDir = selected;
    }
    setBusy(true);
    try {
      const response = await stopScreenRecord(activeSerial, outputDir);
      setScreenRecordRemote(null);
      if (response.data) {
        pushToast(`Recording saved to ${response.data}`, "info");
      } else {
        pushToast("Screen recording stopped.", "info");
      }
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleBugreport = async () => {
    if (!activeSerial) {
      pushToast("Select one device for bugreport.", "error");
      return;
    }
    let outputDir = config?.output_path || "";
    if (!outputDir) {
      const selected = await openDialog({
        title: "Select output folder",
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      outputDir = selected;
    }
    setBusy(true);
    setBugreportProgress(0);
    try {
      const response = await generateBugreport(activeSerial, outputDir);
      setBugreportResult(response.data);
      if (response.data.success) {
        pushToast(`Bugreport saved to ${response.data.output_path}`, "info");
      } else {
        pushToast(response.data.error || "Bugreport failed", "error");
      }
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleCancelBugreport = async () => {
    if (!activeSerial) {
      return;
    }
    try {
      await cancelBugreport(activeSerial);
      pushToast("Bugreport cancelled.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const handleLogcatStart = async () => {
    if (!activeSerial) {
      pushToast("Select one device for logcat.", "error");
      return;
    }
    setBusy(true);
    try {
      await startLogcat(activeSerial, logcatFilter);
      pushToast("Logcat started.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatStop = async () => {
    if (!activeSerial) {
      pushToast("Select one device for logcat.", "error");
      return;
    }
    setBusy(true);
    try {
      await stopLogcat(activeSerial);
      pushToast("Logcat stopped.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLogcatClear = async () => {
    if (!activeSerial) {
      pushToast("Select one device for logcat.", "error");
      return;
    }
    setBusy(true);
    try {
      await clearLogcat(activeSerial);
      setLogcatLines((prev) => ({ ...prev, [activeSerial]: [] }));
      pushToast("Logcat cleared.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFilesRefresh = async () => {
    if (!activeSerial) {
      pushToast("Select one device for file browse.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await listDeviceFiles(activeSerial, filesPath);
      setFiles(response.data);
      setFilePreview(null);
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFilePull = async (entry: DeviceFileEntry) => {
    if (!activeSerial) {
      pushToast("Select one device for file pull.", "error");
      return;
    }
    let outputDir = config?.file_gen_output_path || config?.output_path || "";
    if (!outputDir) {
      const selected = await openDialog({
        title: "Select output folder",
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      outputDir = selected;
    }
    setBusy(true);
    try {
      const response = await pullDeviceFile(activeSerial, entry.path, outputDir);
      pushToast(`Pulled to ${response.data}`, "info");
      const preview = await previewLocalFile(response.data);
      setFilePreview(preview.data);
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleUiInspect = async () => {
    if (!activeSerial) {
      pushToast("Select one device for UI inspector.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await captureUiHierarchy(activeSerial);
      setUiHtml(response.data);
      pushToast("UI hierarchy captured.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleLoadApps = async () => {
    if (!activeSerial) {
      pushToast("Select one device.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await listApps(
        activeSerial,
        appsThirdPartyOnly ? true : undefined,
        appsIncludeVersions,
      );
      setApps(response.data);
      setSelectedApp(null);
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleAppAction = async (action: "uninstall" | "forceStop" | "clear" | "enable" | "disable" | "info") => {
    if (!activeSerial || !selectedApp) {
      pushToast("Select an app.", "error");
      return;
    }
    setBusy(true);
    try {
      if (action === "uninstall") {
        await uninstallApp(activeSerial, selectedApp.package_name, false);
      } else if (action === "forceStop") {
        await forceStopApp(activeSerial, selectedApp.package_name);
      } else if (action === "clear") {
        await clearAppData(activeSerial, selectedApp.package_name);
      } else if (action === "enable") {
        await setAppEnabled(activeSerial, selectedApp.package_name, true);
      } else if (action === "disable") {
        await setAppEnabled(activeSerial, selectedApp.package_name, false);
      } else if (action === "info") {
        await openAppInfo(activeSerial, selectedApp.package_name);
      }
      pushToast("App action sent.", "info");
      if (action === "uninstall") {
        await handleLoadApps();
      }
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleScrcpyLaunch = async () => {
    if (!selectedSerials.length) {
      pushToast("Select at least one device.", "error");
      return;
    }
    setBusy(true);
    try {
      await launchScrcpy(selectedSerials);
      pushToast("scrcpy launched.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleBluetoothMonitor = async (enable: boolean) => {
    if (!activeSerial) {
      pushToast("Select one device.", "error");
      return;
    }
    setBusy(true);
    try {
      if (enable) {
        await startBluetoothMonitor(activeSerial);
      } else {
        await stopBluetoothMonitor(activeSerial);
      }
      pushToast(enable ? "Bluetooth monitor started." : "Bluetooth monitor stopped.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!config) {
      return;
    }
    setBusy(true);
    try {
      const updated = {
        ...config,
        apk_install: {
          ...config.apk_install,
          allow_downgrade: apkAllowDowngrade,
          replace_existing: apkReplace,
          grant_permissions: apkGrant,
          allow_test_packages: apkAllowTest,
          extra_args: apkExtraArgs,
        },
        device_groups: expandGroups(groupMap),
      };
      const response = await saveConfig(updated);
      setConfig(response.data);
      setGroupMap(flattenGroups(response.data.device_groups));
      pushToast("Settings saved.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleResetConfig = async () => {
    setBusy(true);
    try {
      const response = await resetConfig();
      setConfig(response.data);
      setGroupMap(flattenGroups(response.data.device_groups));
      setApkExtraArgs(response.data.apk_install.extra_args);
      setApkAllowDowngrade(response.data.apk_install.allow_downgrade);
      setApkReplace(response.data.apk_install.replace_existing);
      setApkGrant(response.data.apk_install.grant_permissions);
      setApkAllowTest(response.data.apk_install.allow_test_packages);
      pushToast("Settings reset.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleCopyDeviceInfo = async () => {
    if (!activeSerial) {
      pushToast("Select one device.", "error");
      return;
    }
    const device = devices.find((item) => item.summary.serial === activeSerial);
    if (!device) {
      return;
    }
    const detail = device.detail;
    const lines = [
      `Serial: ${device.summary.serial}`,
      `State: ${device.summary.state}`,
      `Model: ${detail?.model ?? device.summary.model ?? ""}`,
      `Android: ${detail?.android_version ?? ""}`,
      `API: ${detail?.api_level ?? ""}`,
      `WiFi: ${detail?.wifi_is_on != null ? (detail.wifi_is_on ? "On" : "Off") : "Unknown"}`,
      `Bluetooth: ${detail?.bt_is_on != null ? (detail.bt_is_on ? "On" : "Off") : "Unknown"}`,
      `GMS: ${detail?.gms_version ?? ""}`,
      `Fingerprint: ${detail?.build_fingerprint ?? ""}`,
    ];
    try {
      await writeText(lines.join("\n"));
      pushToast("Device info copied.", "info");
    } catch (error) {
      pushToast(formatError(error), "error");
    }
  };

  const filteredApps = useMemo(() => {
    const query = appsFilter.trim().toLowerCase();
    if (!query) {
      return apps;
    }
    return apps.filter((app) => app.package_name.toLowerCase().includes(query));
  }, [apps, appsFilter]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Lazy Blacktea</p>
          <h1>Device Automation Console</h1>
          <p className="subtle">Rust + Tauri edition</p>
        </div>
        <div className="actions">
          <button className="ghost" onClick={refreshDevices} disabled={busy}>
            Refresh Devices
          </button>
          <button className="ghost" onClick={handleScrcpyLaunch} disabled={busy || !scrcpyInfo?.available}>
            Launch scrcpy
          </button>
          <span className={`status-pill ${busy ? "busy" : ""}`}>{busy ? "Working..." : "Idle"}</span>
        </div>
      </header>

      <nav className="tab-bar">
        {tabList.map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      <main className="tab-panels">
        {activeTab === "Devices" && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Devices</h2>
                <span>{devices.length} connected</span>
              </div>
              <div className="button-row compact">
                <button onClick={selectAllVisible} disabled={busy}>
                  Select Visible
                </button>
                <button onClick={clearSelection} disabled={busy}>
                  Clear
                </button>
              </div>
            </div>
            <div className="toolbar">
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search serial or model"
              />
              <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                <option value="all">All groups</option>
                {groupOptions.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Group name"
              />
              <button onClick={handleAssignGroup} disabled={busy}>
                Assign
              </button>
            </div>
            <div className="device-list">
              {visibleDevices.map((device) => {
                const serial = device.summary.serial;
                const detail = device.detail;
                const wifi = detail?.wifi_is_on;
                const bt = detail?.bt_is_on;
                return (
                  <label key={serial} className={`device-card ${selectedSerials.includes(serial) ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={selectedSerials.includes(serial)}
                      onChange={() => toggleDevice(serial)}
                    />
                    <div className="device-main">
                      <strong>{detail?.model ?? device.summary.model ?? serial}</strong>
                      <p>{serial}</p>
                      {groupMap[serial] && <span className="group-tag">{groupMap[serial]}</span>}
                    </div>
                    <div className="device-meta">
                      <span>{device.summary.state}</span>
                      <span>{detail?.android_version ? `Android ${detail.android_version}` : "--"}</span>
                      <span>{detail?.battery_level != null ? `${detail.battery_level}%` : "--"}</span>
                      <span>{wifi == null ? "WiFi --" : wifi ? "WiFi On" : "WiFi Off"}</span>
                      <span>{bt == null ? "BT --" : bt ? "BT On" : "BT Off"}</span>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="button-row">
              <button onClick={() => handleReboot()} disabled={busy}>
                Reboot
              </button>
              <button onClick={() => handleReboot("recovery")} disabled={busy}>
                Reboot Recovery
              </button>
              <button onClick={() => handleReboot("bootloader")} disabled={busy}>
                Reboot Bootloader
              </button>
              <button onClick={() => handleToggleWifi(true)} disabled={busy}>
                WiFi On
              </button>
              <button onClick={() => handleToggleWifi(false)} disabled={busy}>
                WiFi Off
              </button>
              <button onClick={() => handleToggleBluetooth(true)} disabled={busy}>
                Bluetooth On
              </button>
              <button onClick={() => handleToggleBluetooth(false)} disabled={busy}>
                Bluetooth Off
              </button>
              <button onClick={handleCopyDeviceInfo} disabled={busy}>
                Copy Device Info
              </button>
            </div>
          </section>
        )}

        {activeTab === "Commands" && (
          <section className="panel">
            <div className="panel-header">
              <h2>Shell Commands</h2>
              <span>{activeSerial ?? "No device selected"}</span>
            </div>
            {screenRecordRemote && (
              <p className="muted">Recording in progress: {screenRecordRemote}</p>
            )}
            <div className="form-row">
              <label>Shell Command</label>
              <input
                value={shellCommand}
                onChange={(event) => setShellCommand(event.target.value)}
                placeholder="e.g. pm list packages"
              />
              <button onClick={handleRunShell} disabled={busy}>
                Run
              </button>
            </div>
            <div className="output-block">
              <h3>Latest Output</h3>
              {shellOutput.length === 0 ? (
                <p className="muted">No output yet.</p>
              ) : (
                <pre>{shellOutput.join("\n\n")}</pre>
              )}
            </div>
          </section>
        )}

        {activeTab === "Install" && (
          <section className="panel">
            <div className="panel-header">
              <h2>APK Install</h2>
              <span>{selectedSerials.length ? `${selectedSerials.length} selected` : "No devices selected"}</span>
            </div>
            <div className="form-row">
              <label>APK Path</label>
              <input value={apkPath} onChange={(event) => setApkPath(event.target.value)} placeholder="Select an APK file" />
              <button
                onClick={async () => {
                  const selected = await openDialog({
                    title: "Select APK",
                    multiple: false,
                    filters: [{ name: "APK", extensions: ["apk"] }],
                  });
                  if (selected && !Array.isArray(selected)) {
                    setApkPath(selected);
                  }
                }}
                disabled={busy}
              >
                Browse
              </button>
            </div>
            <div className="grid-two">
              <label className="toggle">
                <input type="checkbox" checked={apkReplace} onChange={(event) => setApkReplace(event.target.checked)} />
                Replace existing
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={apkAllowDowngrade}
                  onChange={(event) => setApkAllowDowngrade(event.target.checked)}
                />
                Allow downgrade
              </label>
              <label className="toggle">
                <input type="checkbox" checked={apkGrant} onChange={(event) => setApkGrant(event.target.checked)} />
                Grant permissions
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={apkAllowTest}
                  onChange={(event) => setApkAllowTest(event.target.checked)}
                />
                Allow test packages
              </label>
            </div>
            <div className="form-row">
              <label>Extra Args</label>
              <input value={apkExtraArgs} onChange={(event) => setApkExtraArgs(event.target.value)} placeholder="e.g. --force-queryable" />
              <button onClick={handleInstallApk} disabled={busy}>
                Install
              </button>
            </div>
          </section>
        )}

        {activeTab === "Files" && (
          <section className="panel">
            <div className="panel-header">
              <h2>Device Files</h2>
              <span>{activeSerial ?? "No device selected"}</span>
            </div>
            <div className="form-row">
              <label>Path</label>
              <input value={filesPath} onChange={(event) => setFilesPath(event.target.value)} />
              <button onClick={handleFilesRefresh} disabled={busy}>
                Load
              </button>
            </div>
            <div className="split">
              <div className="file-list">
                {files.length === 0 ? (
                  <p className="muted">No files loaded.</p>
                ) : (
                  files.map((entry) => (
                    <div key={entry.path} className="file-row">
                      <div>
                        <strong>{entry.name}</strong>
                        <p className="muted">
                          {entry.is_dir ? "Directory" : "File"} · {entry.size_bytes ?? "--"} bytes
                        </p>
                      </div>
                      {!entry.is_dir && (
                        <button onClick={() => handleFilePull(entry)} disabled={busy}>
                          Pull
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="preview-panel">
                <h3>Preview</h3>
                {filePreview?.is_text && filePreview.preview_text ? (
                  <pre>{filePreview.preview_text}</pre>
                ) : (
                  <p className="muted">
                    {filePreview
                      ? `Preview not available (${filePreview.mime_type}).`
                      : "Pull a file to preview."}
                  </p>
                )}
                {filePreview && (
                  <button onClick={() => openExternal(filePreview.local_path)} disabled={busy}>
                    Open Externally
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "Logcat" && (
          <section className="panel">
            <div className="panel-header">
              <h2>Logcat</h2>
              <span>{activeSerial ?? "No device selected"}</span>
            </div>
            <div className="form-row">
              <label>Filter</label>
              <input
                value={logcatFilter}
                onChange={(event) => setLogcatFilter(event.target.value)}
                placeholder="e.g. ActivityManager:D *:S"
              />
              <div className="button-row compact">
                <button onClick={handleLogcatStart} disabled={busy}>
                  Start
                </button>
                <button onClick={handleLogcatStop} disabled={busy}>
                  Stop
                </button>
                <button onClick={handleLogcatClear} disabled={busy}>
                  Clear
                </button>
              </div>
            </div>
            <div className="logcat-output">
              {(activeSerial ? logcatLines[activeSerial] ?? [] : []).map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "Apps" && (
          <section className="panel">
            <div className="panel-header">
              <h2>App Management</h2>
              <span>{activeSerial ?? "No device selected"}</span>
            </div>
            <div className="toolbar">
              <input
                value={appsFilter}
                onChange={(event) => setAppsFilter(event.target.value)}
                placeholder="Search package"
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={appsThirdPartyOnly}
                  onChange={(event) => setAppsThirdPartyOnly(event.target.checked)}
                />
                Third-party only
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={appsIncludeVersions}
                  onChange={(event) => setAppsIncludeVersions(event.target.checked)}
                />
                Include versions
              </label>
              <button onClick={handleLoadApps} disabled={busy}>
                Load Apps
              </button>
            </div>
            <div className="split">
              <div className="file-list">
                {filteredApps.map((app) => (
                  <button
                    key={app.package_name}
                    className={`app-row ${selectedApp?.package_name === app.package_name ? "active" : ""}`}
                    onClick={() => setSelectedApp(app)}
                  >
                    <strong>{app.package_name}</strong>
                    <span>{app.version_name ?? ""}</span>
                    {app.is_system && <span className="badge">System</span>}
                  </button>
                ))}
              </div>
              <div className="preview-panel">
                <h3>Selected App</h3>
                {selectedApp ? (
                  <div className="stack">
                    <p>{selectedApp.package_name}</p>
                    <p className="muted">Version: {selectedApp.version_name ?? "--"}</p>
                    <div className="button-row">
                      <button onClick={() => handleAppAction("forceStop")} disabled={busy}>
                        Force Stop
                      </button>
                      <button onClick={() => handleAppAction("clear")} disabled={busy}>
                        Clear Data
                      </button>
                      <button onClick={() => handleAppAction("info")} disabled={busy}>
                        Open Info
                      </button>
                      <button onClick={() => handleAppAction("enable")} disabled={busy}>
                        Enable
                      </button>
                      <button onClick={() => handleAppAction("disable")} disabled={busy}>
                        Disable
                      </button>
                      <button onClick={() => handleAppAction("uninstall")} disabled={busy}>
                        Uninstall
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="muted">Select an app to manage.</p>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "Bugreport" && (
          <section className="panel">
            <div className="panel-header">
              <h2>Bugreport</h2>
              <span>{activeSerial ?? "No device selected"}</span>
            </div>
            <div className="button-row">
              <button onClick={handleBugreport} disabled={busy}>
                Generate Bugreport
              </button>
              <button onClick={handleCancelBugreport} disabled={busy}>
                Cancel
              </button>
            </div>
            <div className="progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${bugreportProgress ?? 0}%` }}
                />
              </div>
              <span>{bugreportProgress != null ? `${bugreportProgress}%` : "Idle"}</span>
            </div>
            {bugreportResult && (
              <div className="output-block">
                <h3>Last Result</h3>
                <p>Status: {bugreportResult.success ? "Success" : "Failed"}</p>
                <p>Output: {bugreportResult.output_path ?? "--"}</p>
                <p>Error: {bugreportResult.error ?? "--"}</p>
              </div>
            )}
          </section>
        )}

        {activeTab === "Bluetooth" && (
          <section className="panel">
            <div className="panel-header">
              <h2>Bluetooth Monitor</h2>
              <span>{activeSerial ?? "No device selected"}</span>
            </div>
            <div className="button-row">
              <button onClick={() => handleBluetoothMonitor(true)} disabled={busy}>
                Start Monitor
              </button>
              <button onClick={() => handleBluetoothMonitor(false)} disabled={busy}>
                Stop Monitor
              </button>
            </div>
            <div className="output-block">
              <h3>Current State</h3>
              <p>{bluetoothState || "No state yet."}</p>
            </div>
            <div className="logcat-output">
              {bluetoothEvents.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "Settings" && config && (
          <section className="panel">
            <div className="panel-header">
              <h2>Settings</h2>
              <span>Saved locally</span>
            </div>
            <div className="settings-grid">
              <div>
                <h3>Output Paths</h3>
                <label>
                  Default Output
                  <input
                    value={config.output_path}
                    onChange={(event) =>
                      setConfig((prev) => (prev ? { ...prev, output_path: event.target.value } : prev))
                    }
                  />
                </label>
                <label>
                  File Export
                  <input
                    value={config.file_gen_output_path}
                    onChange={(event) =>
                      setConfig((prev) =>
                        prev ? { ...prev, file_gen_output_path: event.target.value } : prev,
                      )
                    }
                  />
                </label>
              </div>
              <div>
                <h3>Commands</h3>
                <label>
                  Timeout (sec)
                  <input
                    type="number"
                    value={config.command.command_timeout}
                    onChange={(event) =>
                      setConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              command: { ...prev.command, command_timeout: Number(event.target.value) },
                            }
                          : prev,
                      )
                    }
                  />
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={config.command.parallel_execution}
                    onChange={(event) =>
                      setConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              command: { ...prev.command, parallel_execution: event.target.checked },
                            }
                          : prev,
                      )
                    }
                  />
                  Parallel execution
                </label>
              </div>
              <div>
                <h3>Screenrecord</h3>
                <label>
                  Bit rate
                  <input
                    value={config.screen_record.bit_rate}
                    onChange={(event) =>
                      setConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              screen_record: { ...prev.screen_record, bit_rate: event.target.value },
                            }
                          : prev,
                      )
                    }
                  />
                </label>
                <label>
                  Size
                  <input
                    value={config.screen_record.size}
                    onChange={(event) =>
                      setConfig((prev) =>
                        prev
                          ? { ...prev, screen_record: { ...prev.screen_record, size: event.target.value } }
                          : prev,
                      )
                    }
                  />
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={config.screen_record.use_hevc}
                    onChange={(event) =>
                      setConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              screen_record: { ...prev.screen_record, use_hevc: event.target.checked },
                            }
                          : prev,
                      )
                    }
                  />
                  Use HEVC
                </label>
              </div>
              <div>
                <h3>scrcpy</h3>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={config.scrcpy.stay_awake}
                    onChange={(event) =>
                      setConfig((prev) =>
                        prev
                          ? { ...prev, scrcpy: { ...prev.scrcpy, stay_awake: event.target.checked } }
                          : prev,
                      )
                    }
                  />
                  Stay awake
                </label>
                <label>
                  Bit rate
                  <input
                    value={config.scrcpy.bitrate}
                    onChange={(event) =>
                      setConfig((prev) =>
                        prev ? { ...prev, scrcpy: { ...prev.scrcpy, bitrate: event.target.value } } : prev,
                      )
                    }
                  />
                </label>
                <label>
                  Extra args
                  <input
                    value={config.scrcpy.extra_args}
                    onChange={(event) =>
                      setConfig((prev) =>
                        prev
                          ? { ...prev, scrcpy: { ...prev.scrcpy, extra_args: event.target.value } }
                          : prev,
                      )
                    }
                  />
                </label>
              </div>
            </div>
            <div className="button-row">
              <button onClick={handleSaveConfig} disabled={busy}>
                Save Settings
              </button>
              <button onClick={handleResetConfig} disabled={busy}>
                Reset Defaults
              </button>
            </div>
          </section>
        )}
      </main>

      <section className="panel ui-inspector">
        <div className="panel-header">
          <h2>UI Inspector</h2>
          <button onClick={handleUiInspect} disabled={busy}>
            Capture
          </button>
        </div>
        {uiHtml ? (
          <iframe title="UI Inspector" srcDoc={uiHtml} className="ui-frame" />
        ) : (
          <p className="muted">Capture UI hierarchy to preview the structure.</p>
        )}
      </section>

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function flattenGroups(groups: Record<string, string[]>) {
  const map: Record<string, string> = {};
  Object.entries(groups || {}).forEach(([group, serials]) => {
    serials.forEach((serial) => {
      map[serial] = group;
    });
  });
  return map;
}

function expandGroups(map: Record<string, string>) {
  const groups: Record<string, string[]> = {};
  Object.entries(map).forEach(([serial, group]) => {
    if (!group) {
      return;
    }
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(serial);
  });
  return groups;
}

function formatError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "error" in error) {
    const payload = error as { error: string; code?: string; trace_id?: string };
    return `${payload.error} ${payload.code ? `(${payload.code})` : ""} ${payload.trace_id ?? ""}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

export default App;
