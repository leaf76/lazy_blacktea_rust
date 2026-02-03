import { useEffect, useMemo, useReducer, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
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
  adbConnect,
  adbPair,
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
import {
  initialPairingState,
  pairingReducer,
  parseAdbPairOutput,
  parseQrPayload,
} from "./pairing";
import "./App.css";

type Toast = { id: string; message: string; tone: "info" | "error" };
type BugreportProgress = { serial: string; progress: number; trace_id: string };
type QuickActionId =
  | "screenshot"
  | "reboot"
  | "record"
  | "logcat-clear"
  | "install-apk"
  | "mirror";
type ActionFormState = {
  isOpen: boolean;
  actionId: QuickActionId | null;
  errors: string[];
};

const initialActionFormState: ActionFormState = {
  isOpen: false,
  actionId: null,
  errors: [],
};

function App() {
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
  const [pairingState, dispatchPairing] = useReducer(pairingReducer, initialPairingState);
  const [actionForm, setActionForm] = useState<ActionFormState>(initialActionFormState);
  const [actionOutputDir, setActionOutputDir] = useState("");
  const [actionRebootMode, setActionRebootMode] = useState("normal");
  const [actionDraftConfig, setActionDraftConfig] = useState<AppConfig | null>(null);

  const navigate = useNavigate();
  const activeSerial = selectedSerials[0];
  const activeDevice = useMemo(
    () => devices.find((device) => device.summary.serial === activeSerial) ?? null,
    [devices, activeSerial],
  );
  const hasDevices = devices.length > 0;
  const deviceStatus = activeDevice?.summary.state ?? "offline";
  const deviceStatusLabel = useMemo(() => {
    if (!activeSerial) {
      return "No device";
    }
    if (deviceStatus === "device") {
      return "Online";
    }
    if (deviceStatus === "unauthorized") {
      return "Unauthorized";
    }
    if (deviceStatus === "offline") {
      return "Offline";
    }
    return deviceStatus;
  }, [activeSerial, deviceStatus]);
  const deviceStatusTone = useMemo(() => {
    if (!activeSerial) {
      return "idle";
    }
    if (deviceStatus === "device") {
      return "ok";
    }
    if (deviceStatus === "unauthorized") {
      return "error";
    }
    return "warn";
  }, [activeSerial, deviceStatus]);

  const handleSelectActiveSerial = (serial: string) => {
    if (!serial) {
      return;
    }
    setSelectedSerials((prev) => {
      const remaining = prev.filter((item) => item !== serial);
      return [serial, ...remaining];
    });
  };

  const openPairingModal = () => dispatchPairing({ type: "OPEN" });
  const closePairingModal = () => dispatchPairing({ type: "CLOSE" });

  const openActionForm = (actionId: QuickActionId) => {
    setActionForm({ isOpen: true, actionId, errors: [] });
    setActionOutputDir(config?.output_path ?? "");
    setActionRebootMode("normal");
    setActionDraftConfig(config ? (JSON.parse(JSON.stringify(config)) as AppConfig) : null);
  };

  const closeActionForm = () => setActionForm(initialActionFormState);

  const validateHostPort = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Address is required (host:port).";
    }
    const [host, port] = trimmed.split(":");
    if (!host || !port) {
      return "Use host:port format.";
    }
    if (!Number.isInteger(Number(port)) || Number(port) <= 0) {
      return "Port must be a positive number.";
    }
    return null;
  };

  const validatePairingCode = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Pairing code is required.";
    }
    if (!/^[0-9]{6}$/.test(trimmed)) {
      return "Pairing code should be 6 digits.";
    }
    return null;
  };

  const updateDraftConfig = (updater: (current: AppConfig) => AppConfig) => {
    setActionDraftConfig((prev) => (prev ? updater(prev) : prev));
  };

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

  const handlePairSubmit = async () => {
    const addressError = validateHostPort(pairingState.pairAddress);
    const codeError = validatePairingCode(pairingState.pairingCode);
    if (addressError || codeError) {
      dispatchPairing({ type: "PAIR_ERROR", error: [addressError, codeError].filter(Boolean).join(" ") });
      return;
    }
    setBusy(true);
    dispatchPairing({ type: "PAIR_START" });
    try {
      const response = await adbPair(pairingState.pairAddress.trim(), pairingState.pairingCode.trim());
      const combined = `${response.data.stdout}\n${response.data.stderr}`;
      const parsed = parseAdbPairOutput(combined);
      const message = parsed.message || response.data.stdout.trim() || "Paired successfully.";
      dispatchPairing({
        type: "PAIR_SUCCESS",
        message,
        connectAddress: parsed.connectAddress || pairingState.connectAddress,
      });
      pushToast("Wireless pairing succeeded.", "info");
    } catch (error) {
      const message = formatError(error);
      dispatchPairing({ type: "PAIR_ERROR", error: message });
      pushToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleConnectSubmit = async () => {
    const addressError = validateHostPort(pairingState.connectAddress);
    if (addressError) {
      dispatchPairing({ type: "CONNECT_ERROR", error: addressError });
      return;
    }
    setBusy(true);
    dispatchPairing({ type: "CONNECT_START" });
    try {
      const response = await adbConnect(pairingState.connectAddress.trim());
      const message = response.data.stdout.trim() || "Connected.";
      dispatchPairing({ type: "CONNECT_SUCCESS", message });
      pushToast("Wireless connect succeeded.", "info");
      await refreshDevices();
    } catch (error) {
      const message = formatError(error);
      dispatchPairing({ type: "CONNECT_ERROR", error: message });
      pushToast(message, "error");
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

  const resolveOutputDir = async (value: string) => {
    let outputDir = value.trim();
    if (!outputDir) {
      outputDir = config?.output_path ?? "";
    }
    if (!outputDir) {
      const selected = await openDialog({
        title: "Select output folder",
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        return null;
      }
      outputDir = selected;
    }
    return outputDir;
  };

  const persistActionConfig = async () => {
    if (!actionDraftConfig) {
      return;
    }
    const updated = {
      ...actionDraftConfig,
      device_groups: expandGroups(groupMap),
    };
    const response = await saveConfig(updated);
    setConfig(response.data);
    setGroupMap(flattenGroups(response.data.device_groups));
  };

  const handleActionSubmit = async () => {
    if (!actionForm.actionId) {
      return;
    }
    const errors: string[] = [];
    if (actionForm.actionId !== "install-apk" && !activeSerial && actionForm.actionId !== "reboot") {
      errors.push("Select an active device to run this action.");
    }
    if (actionForm.actionId === "reboot" && !selectedSerials.length) {
      errors.push("Select at least one device to reboot.");
    }
    if (actionForm.actionId === "install-apk" && !selectedSerials.length) {
      errors.push("Select at least one device to install.");
    }
    if (actionForm.actionId === "install-apk" && !apkPath.trim()) {
      errors.push("Select an APK file before installing.");
    }
    if (actionForm.actionId === "screenshot" && !actionOutputDir.trim() && !config?.output_path) {
      errors.push("Select an output folder for screenshots.");
    }
    if (actionForm.actionId === "record" && screenRecordRemote && !actionOutputDir.trim() && !config?.output_path) {
      errors.push("Select an output folder for recordings.");
    }
    if (actionForm.actionId === "mirror" && !scrcpyInfo?.available) {
      errors.push("scrcpy is not available. Install it to enable live mirror.");
    }
    if (
      (actionForm.actionId === "screenshot" ||
        actionForm.actionId === "record" ||
        actionForm.actionId === "mirror") &&
      !actionDraftConfig
    ) {
      errors.push("Settings are still loading. Try again in a moment.");
    }
    if (errors.length) {
      setActionForm((prev) => ({ ...prev, errors }));
      return;
    }

    setBusy(true);
    setActionForm((prev) => ({ ...prev, errors: [] }));
    try {
      if (actionForm.actionId === "screenshot") {
        await persistActionConfig();
        const outputDir = await resolveOutputDir(actionOutputDir);
        if (!outputDir) {
          return;
        }
        const response = await captureScreenshot(activeSerial!, outputDir);
        pushToast(`Screenshot saved to ${response.data}`, "info");
      } else if (actionForm.actionId === "reboot") {
        await handleReboot(actionRebootMode === "normal" ? undefined : actionRebootMode);
      } else if (actionForm.actionId === "record") {
        await persistActionConfig();
        if (screenRecordRemote) {
          const outputDir = await resolveOutputDir(actionOutputDir);
          if (!outputDir) {
            return;
          }
          const response = await stopScreenRecord(activeSerial!, outputDir);
          setScreenRecordRemote(null);
          pushToast(response.data ? `Recording saved to ${response.data}` : "Screen recording stopped.", "info");
        } else {
          const response = await startScreenRecord(activeSerial!);
          setScreenRecordRemote(response.data);
          pushToast("Screen recording started.", "info");
        }
      } else if (actionForm.actionId === "logcat-clear") {
        await clearLogcat(activeSerial!);
        pushToast("Logcat cleared.", "info");
      } else if (actionForm.actionId === "install-apk") {
        await handleInstallApk();
      } else if (actionForm.actionId === "mirror") {
        await persistActionConfig();
        await handleScrcpyLaunch();
      }
      closeActionForm();
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

  const dashboardActions = [
    {
      id: "screenshot",
      title: "Screenshot",
      description: "Capture the current screen to the output folder.",
      onClick: () => openActionForm("screenshot"),
      disabled: busy || !activeSerial,
    },
    {
      id: "reboot",
      title: "Reboot",
      description: "Restart the active device.",
      onClick: () => openActionForm("reboot"),
      disabled: busy || !activeSerial,
    },
    {
      id: "record",
      title: screenRecordRemote ? "Stop Recording" : "Start Recording",
      description: screenRecordRemote
        ? "Finish and save the ongoing screen recording."
        : "Record the device screen for a short clip.",
      onClick: () => openActionForm("record"),
      disabled: busy || !activeSerial,
    },
    {
      id: "logcat-clear",
      title: "Clear Logcat",
      description: "Clear the logcat buffer for the active device.",
      onClick: () => openActionForm("logcat-clear"),
      disabled: busy || !activeSerial,
    },
    {
      id: "install-apk",
      title: "Install APK",
      description: "Install an APK on the selected devices.",
      onClick: () => openActionForm("install-apk"),
      disabled: busy || selectedSerials.length === 0,
    },
    {
      id: "mirror",
      title: "Live Mirror",
      description: scrcpyInfo?.available
        ? "Launch scrcpy for a live mirror window."
        : "Install scrcpy to enable live mirroring.",
      onClick: () => openActionForm("mirror"),
      disabled: busy || selectedSerials.length === 0,
    },
  ];

  const DashboardView = () => {
    const detail = activeDevice?.detail;
    const deviceName =
      detail?.model ?? activeDevice?.summary.model ?? activeSerial ?? "No device selected";
    const deviceState = activeDevice?.summary.state ?? "No device";
    const wifiState =
      detail?.wifi_is_on == null ? "Unknown" : detail.wifi_is_on ? "On" : "Off";
    const btState =
      detail?.bt_is_on == null ? "Unknown" : detail.bt_is_on ? "On" : "Off";

    if (!hasDevices) {
      return (
        <div className="page-section">
          <div className="page-header">
            <div>
              <h1>Dashboard</h1>
              <p className="muted">Connect a device to unlock quick actions and diagnostics.</p>
            </div>
          </div>
          <section className="panel empty-state">
            <div>
              <h2>Connect a device to get started</h2>
              <p className="muted">
                Plug in via USB or pair wirelessly. Once connected, you will see the device overview
                and quick actions here.
              </p>
              <ol className="step-list">
                <li>Enable Developer Options and USB/Wireless Debugging.</li>
                <li>Connect the device via USB or open Wireless Debugging.</li>
                <li>Pair using QR or pairing code, then refresh the device list.</li>
              </ol>
            </div>
            <div className="button-row">
              <button onClick={openPairingModal} disabled={busy}>
                Wireless Pairing
              </button>
              <button className="ghost" onClick={refreshDevices} disabled={busy}>
                Refresh Devices
              </button>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="page-section">
        <div className="page-header">
          <div>
            <h1>Dashboard</h1>
            <p className="muted">Overview, quick actions, and device health.</p>
          </div>
          <div className="page-actions">
            <button className="ghost" onClick={() => navigate("/devices")} disabled={busy}>
              Manage Devices
            </button>
          </div>
        </div>
        <div className="dashboard-grid">
          <section className="panel card">
            <div className="card-header">
              <h2>Device Overview</h2>
              <span className="badge">{deviceState}</span>
            </div>
            <div className="device-summary">
              <div>
                <p className="eyebrow">Active Device</p>
                <strong>{deviceName}</strong>
                <p className="muted">{activeSerial ?? "Select a device"}</p>
              </div>
              <div className="summary-grid">
                <div>
                  <span className="muted">Android</span>
                  <strong>{detail?.android_version ?? "--"}</strong>
                </div>
                <div>
                  <span className="muted">API</span>
                  <strong>{detail?.api_level ?? "--"}</strong>
                </div>
                <div>
                  <span className="muted">Battery</span>
                  <strong>{detail?.battery_level != null ? `${detail.battery_level}%` : "--"}</strong>
                </div>
                <div>
                  <span className="muted">WiFi</span>
                  <strong>{wifiState}</strong>
                </div>
                <div>
                  <span className="muted">Bluetooth</span>
                  <strong>{btState}</strong>
                </div>
                <div>
                  <span className="muted">GMS</span>
                  <strong>{detail?.gms_version ?? "--"}</strong>
                </div>
              </div>
            </div>
            <div className="button-row">
              <button className="ghost" onClick={handleCopyDeviceInfo} disabled={busy || !activeSerial}>
                Copy Device Info
              </button>
            </div>
          </section>

          <section className="panel card">
            <div className="card-header">
              <h2>Quick Actions</h2>
              <span className="muted">Most used</span>
            </div>
            <div className="quick-actions">
              {dashboardActions.map((action) => (
                <button
                  key={action.id}
                  className="quick-action"
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  <span>{action.title}</span>
                  <span className="muted">{action.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel card">
            <div className="card-header">
              <h2>Connection</h2>
              <span className="muted">{hasDevices ? "Online" : "Offline"}</span>
            </div>
            <div className="status-list">
              <div>
                <span className="muted">ADB Status</span>
                <strong>{busy ? "Working" : "Ready"}</strong>
              </div>
              <div>
                <span className="muted">Devices Connected</span>
                <strong>{devices.length}</strong>
              </div>
              <div>
                <span className="muted">scrcpy</span>
                <strong>{scrcpyInfo?.available ? "Available" : "Not installed"}</strong>
              </div>
            </div>
            {!scrcpyInfo?.available && (
              <p className="muted">
                Install scrcpy to enable live mirror and high-fidelity interaction.
              </p>
            )}
          </section>

          <section className="panel card">
            <div className="card-header">
              <h2>Recent Apps</h2>
              <span className="muted">Quick access</span>
            </div>
            {apps.length === 0 ? (
              <div className="empty-inline">
                <p className="muted">No app list loaded yet.</p>
                <button className="ghost" onClick={handleLoadApps} disabled={busy || !activeSerial}>
                  Load Apps
                </button>
              </div>
            ) : (
              <div className="list-compact">
                {apps.slice(0, 5).map((app) => (
                  <div key={app.package_name} className="list-row">
                    <div>
                      <strong>{app.package_name}</strong>
                      <p className="muted">{app.package_name}</p>
                    </div>
                    <button
                      className="ghost"
                      onClick={() => {
                        setSelectedApp(app);
                        navigate("/apps");
                      }}
                    >
                      Open
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  };

  const actionTitleMap: Record<QuickActionId, string> = {
    screenshot: "Screenshot",
    reboot: "Reboot",
    record: screenRecordRemote ? "Stop Recording" : "Start Recording",
    "logcat-clear": "Clear Logcat",
    "install-apk": "Install APK",
    mirror: "Live Mirror",
  };

  const actionNeedsConfig =
    actionForm.actionId === "screenshot" ||
    actionForm.actionId === "record" ||
    actionForm.actionId === "mirror";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-title">Lazy Blacktea</span>
          <span className="brand-subtitle">Device Automation</span>
        </div>
        <nav className="nav-links">
          <div className="nav-group">
            <span className="nav-title">Connect</span>
            <NavLink to="/" end>
              Dashboard
            </NavLink>
            <NavLink to="/devices">Device Manager</NavLink>
            <NavLink to="/bluetooth">Bluetooth Monitor</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">Debug</span>
            <NavLink to="/logcat">Logcat</NavLink>
            <NavLink to="/ui-inspector">UI Inspector</NavLink>
            <NavLink to="/bugreport">Bug Report</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">Manage</span>
            <NavLink to="/apps">App Manager</NavLink>
            <NavLink to="/files">File Explorer</NavLink>
            <NavLink to="/actions">Custom Actions</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-title">System</span>
            <NavLink to="/settings">Settings</NavLink>
          </div>
        </nav>
        <div className="sidebar-footer">
          <button className="ghost" onClick={openPairingModal} disabled={busy}>
            Connect Device
          </button>
          <button className="ghost" onClick={() => navigate("/settings")}>
            Settings
          </button>
          <div className="sidebar-status">
            <span className={`status-dot ${hasDevices ? "ok" : "warn"}`} />
            <span>{hasDevices ? `${devices.length} devices` : "No devices"}</span>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="top-bar">
          <div className="device-context">
            <div className="device-selector">
              <p className="eyebrow">Active Device</p>
              <select
                value={activeSerial ?? ""}
                onChange={(event) => handleSelectActiveSerial(event.target.value)}
              >
                <option value="">No device connected</option>
                {devices.map((device) => (
                  <option key={device.summary.serial} value={device.summary.serial}>
                    {device.detail?.model ?? device.summary.model ?? device.summary.serial}
                  </option>
                ))}
              </select>
            </div>
            <div className="device-status-row">
              <span className={`status-pill ${deviceStatusTone}`}>{deviceStatusLabel}</span>
              <span className="muted">
                {activeSerial ? `Selected: ${activeSerial}` : "Select a device to enable actions"}
              </span>
            </div>
          </div>
          <div className="top-actions">
            <button className="ghost" onClick={() => openActionForm("screenshot")} disabled={busy || !activeSerial}>
              Screenshot
            </button>
            <button className="ghost" onClick={() => openActionForm("reboot")} disabled={busy || !selectedSerials.length}>
              Reboot
            </button>
            <button className="ghost" onClick={openPairingModal} disabled={busy}>
              Wireless Pairing
            </button>
            <button className="ghost" onClick={refreshDevices} disabled={busy}>
              Refresh
            </button>
            <button className="ghost" onClick={() => openActionForm("mirror")} disabled={busy}>
              Live Mirror
            </button>
            <span className={`status-pill ${busy ? "busy" : ""}`}>{busy ? "Working..." : "Idle"}</span>
          </div>
        </header>

        <main className="page">
          <Routes>
            <Route path="/" element={<DashboardView />} />
            <Route
              path="/devices"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Device Manager</h1>
                      <p className="muted">Organize devices, groups, and connection status.</p>
                    </div>
                    <div className="page-actions">
                      <button className="ghost" onClick={refreshDevices} disabled={busy}>
                        Refresh Devices
                      </button>
                    </div>
                  </div>
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
                          <label
                            key={serial}
                            className={`device-card ${selectedSerials.includes(serial) ? "active" : ""}`}
                          >
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
                </div>
              }
            />
            <Route
              path="/actions"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Custom Actions</h1>
                      <p className="muted">Run shell commands and batch installs.</p>
                    </div>
                  </div>
                  <div className="stack">
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

                    <section className="panel">
                      <div className="panel-header">
                        <h2>APK Install</h2>
                        <span>{selectedSerials.length ? `${selectedSerials.length} selected` : "No devices selected"}</span>
                      </div>
                      <div className="form-row">
                        <label>APK Path</label>
                        <input
                          value={apkPath}
                          onChange={(event) => setApkPath(event.target.value)}
                          placeholder="Select an APK file"
                        />
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
                          <input
                            type="checkbox"
                            checked={apkReplace}
                            onChange={(event) => setApkReplace(event.target.checked)}
                          />
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
                          <input
                            type="checkbox"
                            checked={apkGrant}
                            onChange={(event) => setApkGrant(event.target.checked)}
                          />
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
                        <input
                          value={apkExtraArgs}
                          onChange={(event) => setApkExtraArgs(event.target.value)}
                          placeholder="e.g. --force-queryable"
                        />
                        <button onClick={handleInstallApk} disabled={busy}>
                          Install
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              }
            />
            <Route
              path="/files"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>File Explorer</h1>
                      <p className="muted">Browse device storage and pull files.</p>
                    </div>
                  </div>
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
                          <button onClick={() => openPath(filePreview.local_path)} disabled={busy}>
                            Open Externally
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              }
            />
            <Route
              path="/logcat"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Logcat</h1>
                      <p className="muted">Compact stream view with filters.</p>
                    </div>
                  </div>
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
                </div>
              }
            />
            <Route
              path="/ui-inspector"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>UI Inspector</h1>
                      <p className="muted">Capture hierarchy or launch live mirror.</p>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="panel-header">
                      <div>
                        <h2>UI Inspector</h2>
                        <span>{activeSerial ?? "No device selected"}</span>
                      </div>
                      <div className="button-row compact">
                        <button onClick={handleUiInspect} disabled={busy}>
                          Capture
                        </button>
                        <button
                          className="ghost"
                          onClick={handleScrcpyLaunch}
                          disabled={busy || !scrcpyInfo?.available}
                        >
                          Live Mirror
                        </button>
                      </div>
                    </div>
                    {!scrcpyInfo?.available && (
                      <p className="muted">Live mirror requires scrcpy. Install it and try again.</p>
                    )}
                    {uiHtml ? (
                      <iframe title="UI Inspector" srcDoc={uiHtml} className="ui-frame" />
                    ) : (
                      <p className="muted">Capture UI hierarchy to preview the structure.</p>
                    )}
                  </section>
                </div>
              }
            />
            <Route
              path="/apps"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>App Manager</h1>
                      <p className="muted">Search packages and execute common actions.</p>
                    </div>
                  </div>
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
                </div>
              }
            />
            <Route
              path="/bugreport"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Bug Report</h1>
                      <p className="muted">Generate bugreports with progress tracking.</p>
                    </div>
                  </div>
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
                        <div className="progress-fill" style={{ width: `${bugreportProgress ?? 0}%` }} />
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
                </div>
              }
            />
            <Route
              path="/bluetooth"
              element={
                <div className="page-section">
                  <div className="page-header">
                    <div>
                      <h1>Bluetooth Monitor</h1>
                      <p className="muted">Track Bluetooth state changes.</p>
                    </div>
                  </div>
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
                </div>
              }
            />
            <Route
              path="/settings"
              element={
                config ? (
                  <div className="page-section">
                    <div className="page-header">
                      <div>
                        <h1>Settings</h1>
                        <p className="muted">Persisted locally. Update defaults for actions.</p>
                      </div>
                    </div>
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
                  </div>
                ) : (
                  <div className="page-section">
                    <div className="page-header">
                      <div>
                        <h1>Settings</h1>
                        <p className="muted">Loading settings...</p>
                      </div>
                    </div>
                    <section className="panel">
                      <h2>Settings</h2>
                      <p className="muted">Loading settings...</p>
                    </section>
                  </div>
                )
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      {actionForm.isOpen && actionForm.actionId && (
        <div className="modal-backdrop" onClick={closeActionForm}>
          <div className="modal modal-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{actionTitleMap[actionForm.actionId]}</h3>
                <p className="muted">Configure parameters before running.</p>
              </div>
              <button className="ghost" onClick={closeActionForm}>
                Close
              </button>
            </div>
            {actionForm.errors.length > 0 && (
              <div className="inline-alert error">
                {actionForm.errors.map((error) => (
                  <span key={error}>{error}</span>
                ))}
              </div>
            )}

            {actionForm.actionId === "screenshot" && (
              <div className="stack">
                <label>
                  Output folder
                  <div className="inline-row">
                    <input
                      value={actionOutputDir}
                      onChange={(event) => setActionOutputDir(event.target.value)}
                      placeholder={config?.output_path || "Select output folder"}
                    />
                    <button
                      className="ghost"
                      onClick={async () => {
                        const selected = await openDialog({
                          title: "Select output folder",
                          directory: true,
                          multiple: false,
                        });
                        if (selected && !Array.isArray(selected)) {
                          setActionOutputDir(selected);
                        }
                      }}
                      disabled={busy}
                    >
                      Browse
                    </button>
                  </div>
                </label>
                {actionDraftConfig ? (
                  <div className="grid-two">
                    <label>
                      Display ID
                      <input
                        type="number"
                        value={actionDraftConfig.screenshot.display_id}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screenshot: {
                              ...current.screenshot,
                              display_id: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Extra args
                      <input
                        value={actionDraftConfig.screenshot.extra_args}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screenshot: {
                              ...current.screenshot,
                              extra_args: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <p className="muted">Loading screenshot settings...</p>
                )}
              </div>
            )}

            {actionForm.actionId === "reboot" && (
              <div className="stack">
                <label>
                  Reboot mode
                  <select value={actionRebootMode} onChange={(event) => setActionRebootMode(event.target.value)}>
                    <option value="normal">Normal</option>
                    <option value="recovery">Recovery</option>
                    <option value="bootloader">Bootloader</option>
                  </select>
                </label>
                <p className="muted">Reboot will run on all selected devices.</p>
              </div>
            )}

            {actionForm.actionId === "record" && (
              <div className="stack">
                <p className="muted">
                  {screenRecordRemote
                    ? "A recording is running. Configure output and stop it."
                    : "Configure recording parameters before starting."}
                </p>
                {screenRecordRemote && (
                  <label>
                    Output folder
                    <div className="inline-row">
                      <input
                        value={actionOutputDir}
                        onChange={(event) => setActionOutputDir(event.target.value)}
                        placeholder={config?.output_path || "Select output folder"}
                      />
                      <button
                        className="ghost"
                        onClick={async () => {
                          const selected = await openDialog({
                            title: "Select output folder",
                            directory: true,
                            multiple: false,
                          });
                          if (selected && !Array.isArray(selected)) {
                            setActionOutputDir(selected);
                          }
                        }}
                        disabled={busy}
                      >
                        Browse
                      </button>
                    </div>
                  </label>
                )}
                {actionDraftConfig ? (
                  <div className="grid-two">
                    <label>
                      Bit rate
                      <input
                        value={actionDraftConfig.screen_record.bit_rate}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              bit_rate: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Time limit (sec)
                      <input
                        type="number"
                        value={actionDraftConfig.screen_record.time_limit_sec}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              time_limit_sec: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Size
                      <input
                        value={actionDraftConfig.screen_record.size}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              size: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Display ID
                      <input
                        type="number"
                        value={actionDraftConfig.screen_record.display_id}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              display_id: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.screen_record.use_hevc}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              use_hevc: event.target.checked,
                            },
                          }))
                        }
                      />
                      Use HEVC
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.screen_record.bugreport}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              bugreport: event.target.checked,
                            },
                          }))
                        }
                      />
                      Bugreport overlay
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.screen_record.verbose}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            screen_record: {
                              ...current.screen_record,
                              verbose: event.target.checked,
                            },
                          }))
                        }
                      />
                      Verbose output
                    </label>
                  </div>
                ) : (
                  <p className="muted">Loading screen record settings...</p>
                )}
              </div>
            )}

            {actionForm.actionId === "logcat-clear" && (
              <div className="stack">
                <p className="muted">This clears the logcat buffer for the active device.</p>
              </div>
            )}

            {actionForm.actionId === "install-apk" && (
              <div className="stack">
                <label>
                  APK Path
                  <div className="inline-row">
                    <input
                      value={apkPath}
                      onChange={(event) => setApkPath(event.target.value)}
                      placeholder="Select an APK file"
                    />
                    <button
                      className="ghost"
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
                </label>
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
                    <input
                      type="checkbox"
                      checked={apkGrant}
                      onChange={(event) => setApkGrant(event.target.checked)}
                    />
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
                <label>
                  Extra Args
                  <input
                    value={apkExtraArgs}
                    onChange={(event) => setApkExtraArgs(event.target.value)}
                    placeholder="e.g. --force-queryable"
                  />
                </label>
              </div>
            )}

            {actionForm.actionId === "mirror" && (
              <div className="stack">
                {!scrcpyInfo?.available && (
                  <div className="inline-alert error">
                    scrcpy is not available. Install it to enable live mirror.
                  </div>
                )}
                {actionDraftConfig ? (
                  <div className="grid-two">
                    <label>
                      Bit rate
                      <input
                        value={actionDraftConfig.scrcpy.bitrate}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              bitrate: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Max size
                      <input
                        type="number"
                        value={actionDraftConfig.scrcpy.max_size}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              max_size: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.scrcpy.stay_awake}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              stay_awake: event.target.checked,
                            },
                          }))
                        }
                      />
                      Stay awake
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.scrcpy.turn_screen_off}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              turn_screen_off: event.target.checked,
                            },
                          }))
                        }
                      />
                      Turn screen off
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.scrcpy.disable_screensaver}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              disable_screensaver: event.target.checked,
                            },
                          }))
                        }
                      />
                      Disable screensaver
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={actionDraftConfig.scrcpy.enable_audio_playback}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              enable_audio_playback: event.target.checked,
                            },
                          }))
                        }
                      />
                      Enable audio
                    </label>
                    <label>
                      Extra args
                      <input
                        value={actionDraftConfig.scrcpy.extra_args}
                        onChange={(event) =>
                          updateDraftConfig((current) => ({
                            ...current,
                            scrcpy: {
                              ...current.scrcpy,
                              extra_args: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <p className="muted">Loading scrcpy settings...</p>
                )}
              </div>
            )}

            <div className="button-row">
              <button onClick={handleActionSubmit} disabled={busy || (actionNeedsConfig && !actionDraftConfig)}>
                Run Action
              </button>
              <button className="ghost" onClick={closeActionForm}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pairingState.isOpen && (
        <div className="modal-backdrop" onClick={closePairingModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Wireless Pairing</h3>
              <button className="ghost" onClick={closePairingModal}>
                Close
              </button>
            </div>
            <div className="pairing-content">
              <div className="pairing-step">
                <div className="pairing-step-header">
                  <h4>Step 1: Pair</h4>
                  <span className="muted">
                    {pairingState.status === "pairing"
                      ? "Pairing..."
                      : pairingState.status === "paired"
                        ? "Paired"
                        : "Enter pairing info"}
                  </span>
                </div>
                <p className="muted">
                  Enable Wireless Debugging on the device, then scan a QR code or enter the pairing code.
                </p>
                <div className="toggle-group">
                  <button
                    className={pairingState.mode === "qr" ? "toggle active" : "toggle"}
                    onClick={() => dispatchPairing({ type: "SET_MODE", mode: "qr" })}
                  >
                    QR Pairing
                  </button>
                  <button
                    className={pairingState.mode === "code" ? "toggle active" : "toggle"}
                    onClick={() => dispatchPairing({ type: "SET_MODE", mode: "code" })}
                  >
                    Pairing Code
                  </button>
                </div>
                <label>
                  QR Payload (paste to auto-fill)
                  <div className="inline-row">
                    <input
                      value={pairingState.qrPayload}
                      onChange={(event) =>
                        dispatchPairing({ type: "SET_QR_PAYLOAD", value: event.target.value })
                      }
                      placeholder="WIFI:T:ADB;S:192.168.0.10:37145;P:123456;;"
                    />
                    <button
                      className="ghost"
                      onClick={() => {
                        const parsed = parseQrPayload(pairingState.qrPayload);
                        if (!parsed.pairAddress && !parsed.pairingCode) {
                          pushToast("Unable to parse QR payload.", "error");
                          return;
                        }
                        if (parsed.pairAddress) {
                          dispatchPairing({ type: "SET_PAIR_ADDRESS", value: parsed.pairAddress });
                        }
                        if (parsed.pairingCode) {
                          dispatchPairing({ type: "SET_PAIR_CODE", value: parsed.pairingCode });
                        }
                        dispatchPairing({ type: "SET_MODE", mode: "qr" });
                      }}
                    >
                      Parse
                    </button>
                  </div>
                </label>
                <label>
                  Pairing Address (host:port)
                  <input
                    value={pairingState.pairAddress}
                    onChange={(event) =>
                      dispatchPairing({ type: "SET_PAIR_ADDRESS", value: event.target.value })
                    }
                    placeholder="192.168.0.10:37145"
                  />
                </label>
                <label>
                  Pairing Code
                  <input
                    value={pairingState.pairingCode}
                    onChange={(event) =>
                      dispatchPairing({ type: "SET_PAIR_CODE", value: event.target.value })
                    }
                    placeholder="123456"
                  />
                </label>
                <div className="button-row">
                  <button onClick={handlePairSubmit} disabled={busy}>
                    Pair Device
                  </button>
                  <button
                    className="ghost"
                    onClick={() => dispatchPairing({ type: "RESET" })}
                    disabled={busy}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="pairing-step">
                <div className="pairing-step-header">
                  <h4>Step 2: Connect</h4>
                  <span className="muted">
                    {pairingState.status === "connecting"
                      ? "Connecting..."
                      : pairingState.status === "connected"
                        ? "Connected"
                        : "Connect after pairing"}
                  </span>
                </div>
                <label>
                  Device Address (host:port)
                  <input
                    value={pairingState.connectAddress}
                    onChange={(event) =>
                      dispatchPairing({ type: "SET_CONNECT_ADDRESS", value: event.target.value })
                    }
                    placeholder="192.168.0.10:5555"
                  />
                </label>
                <div className="button-row">
                  <button onClick={handleConnectSubmit} disabled={busy}>
                    Connect
                  </button>
                  <button className="ghost" onClick={refreshDevices} disabled={busy}>
                    Refresh Devices
                  </button>
                </div>
              </div>
            </div>

            {(pairingState.error || pairingState.message) && (
              <div className={`inline-alert ${pairingState.error ? "error" : "info"}`}>
                {pairingState.error ?? pairingState.message}
              </div>
            )}
          </div>
        </div>
      )}

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
