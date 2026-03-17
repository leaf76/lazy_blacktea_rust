import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import type {
  AdbInfo,
  ApkBatchInstallResult,
  AppConfig,
  AppBasicInfo,
  AppIcon,
  AppInfo,
  BugreportExtractIndexSummary,
  BugreportExtractQuery,
  BugreportExtractResult,
  BugreportLogAroundPage,
  BugreportLogFilters,
  BugreportLogPage,
  BugreportLogSearchResult,
  BugreportLogSummary,
  BugreportResult,
  CommandResponse,
  CommandResult,
  DeviceFileEntry,
  DeviceInfo,
  FilePreview,
  HostCommandResult,
  LegacyLogcatPreset,
  LogcatExportResult,
  LogcatStatus,
  ScreenRecordStartResult,
  ScreenRecordStatus,
  ScreenRecordStopResult,
  ScrcpyInfo,
  TerminalSessionInfo,
  UiHierarchyCaptureResult,
  UiHierarchyExportResult,
} from "./types";
import { recordExternalAppError } from "./errorRecords";
import { isTauriRuntime } from "./tauriEnv";

const createTraceId = () => crypto.randomUUID();

type InvokeErrorOptions = {
  recordError?: boolean;
  errorTitle?: string;
  errorSource?: string;
  serial?: string | null;
  route?: string | null;
};

const COMMAND_ERROR_META: Record<string, { title: string; source: string }> = {
  get_config: { title: "Load Settings", source: "settings.load" },
  save_app_config: { title: "Save Settings", source: "settings.save" },
  reset_config: { title: "Reset Settings", source: "settings.reset" },
  check_adb: { title: "ADB Check", source: "adb.check" },
  list_devices: { title: "Refresh Devices", source: "devices.list" },
  adb_pair: { title: "Wireless Pair", source: "wireless.pair" },
  adb_connect: { title: "Wireless Connect", source: "wireless.connect" },
  run_shell: { title: "Run Shell Command", source: "shell.run" },
  start_terminal_session: { title: "Open Terminal Session", source: "terminal.start" },
  write_terminal_session: { title: "Write Terminal Session", source: "terminal.write" },
  stop_terminal_session: { title: "Close Terminal Session", source: "terminal.stop" },
  persist_terminal_state: { title: "Persist Terminal State", source: "terminal.persist" },
  reboot_devices: { title: "Reboot Devices", source: "devices.reboot" },
  set_wifi_state: { title: "Set Wi-Fi State", source: "devices.wifi" },
  set_bluetooth_state: { title: "Set Bluetooth State", source: "devices.bluetooth" },
  install_apk_batch: { title: "Install APK", source: "apk.install" },
  capture_screenshot: { title: "Capture Screenshot", source: "screenshot.capture" },
  start_screen_record: { title: "Start Screen Record", source: "screen_record.start" },
  stop_screen_record: { title: "Stop Screen Record", source: "screen_record.stop" },
  get_screen_record_status: { title: "Screen Record Status", source: "screen_record.status" },
  list_device_files: { title: "List Device Files", source: "files.list" },
  pull_device_file: { title: "Pull Device File", source: "files.pull" },
  push_device_file: { title: "Push Device File", source: "files.push" },
  mkdir_device_dir: { title: "Create Device Folder", source: "files.mkdir" },
  rename_device_path: { title: "Rename Device Path", source: "files.rename" },
  delete_device_path: { title: "Delete Device Path", source: "files.delete" },
  preview_local_file: { title: "Preview Local File", source: "files.preview" },
  capture_ui_hierarchy: { title: "UI Inspector Capture", source: "ui_inspector.capture" },
  export_ui_hierarchy: { title: "UI Inspector Export", source: "ui_inspector.export" },
  start_perf_monitor: { title: "Start Performance Monitor", source: "perf.start" },
  stop_perf_monitor: { title: "Stop Performance Monitor", source: "perf.stop" },
  start_net_profiler: { title: "Start Network Profiler", source: "net_profiler.start" },
  stop_net_profiler: { title: "Stop Network Profiler", source: "net_profiler.stop" },
  set_net_profiler_pinned_uids: { title: "Pin Network Profiler UIDs", source: "net_profiler.pin" },
  start_logcat: { title: "Start Logcat", source: "logcat.start" },
  stop_logcat: { title: "Stop Logcat", source: "logcat.stop" },
  get_logcat_status: { title: "Logcat Status", source: "logcat.status" },
  load_legacy_logcat_presets: { title: "Load Logcat Presets", source: "logcat.presets.load" },
  clear_logcat: { title: "Clear Logcat", source: "logcat.clear" },
  export_logcat: { title: "Export Logcat", source: "logcat.export" },
  list_apps: { title: "List Apps", source: "apps.list" },
  get_app_basic_info: { title: "Load App Details", source: "apps.detail" },
  get_app_icon: { title: "Load App Icon", source: "apps.icon" },
  uninstall_app: { title: "Uninstall App", source: "apps.uninstall" },
  force_stop_app: { title: "Force Stop App", source: "apps.force_stop" },
  clear_app_data: { title: "Clear App Data", source: "apps.clear_data" },
  set_app_enabled: { title: "Set App Enabled State", source: "apps.set_enabled" },
  open_app_info: { title: "Open App Info", source: "apps.open_info" },
  launch_app: { title: "Launch App", source: "apps.launch" },
  check_scrcpy: { title: "Check scrcpy", source: "scrcpy.check" },
  launch_scrcpy: { title: "Launch scrcpy", source: "scrcpy.launch" },
  start_bluetooth_monitor: { title: "Start Bluetooth Monitor", source: "bluetooth_monitor.start" },
  stop_bluetooth_monitor: { title: "Stop Bluetooth Monitor", source: "bluetooth_monitor.stop" },
  generate_bugreport: { title: "Generate Bugreport", source: "bugreport.generate" },
  cancel_bugreport: { title: "Cancel Bugreport", source: "bugreport.cancel" },
  prepare_bugreport_logcat: { title: "Prepare Bugreport Logcat", source: "bugreport.logcat.prepare" },
  prepare_bugreport_extract_index: { title: "Prepare Bugreport Extract Index", source: "bugreport.extract.prepare" },
  query_bugreport_extract: { title: "Query Bugreport Extract", source: "bugreport.extract.query" },
  query_bugreport_logcat: { title: "Query Bugreport Logcat", source: "bugreport.logcat.query" },
  search_bugreport_logcat: { title: "Search Bugreport Logcat", source: "bugreport.logcat.search" },
  query_bugreport_logcat_around: { title: "Query Bugreport Context", source: "bugreport.logcat.around" },
  export_diagnostics_bundle: { title: "Export Diagnostics Bundle", source: "diagnostics.export" },
};

const resolveRoute = () => {
  if (typeof window === "undefined") {
    return null;
  }
  const hash = window.location.hash.trim();
  if (hash.startsWith("#")) {
    const route = hash.slice(1).trim();
    return route || "/";
  }
  return window.location.pathname.trim() || "/";
};

const resolveSerialFromArgs = (args?: InvokeArgs) => {
  if (!args || typeof args !== "object") {
    return null;
  }
  const record = args as Record<string, unknown>;
  if (typeof record.serial === "string" && record.serial.trim()) {
    return record.serial.trim();
  }
  if (Array.isArray(record.serials) && record.serials.length === 1 && typeof record.serials[0] === "string") {
    const value = record.serials[0].trim();
    return value || null;
  }
  return null;
};

const tauriInvoke = <T>(command: string, args?: InvokeArgs, options: InvokeErrorOptions = {}) => {
  if (!isTauriRuntime()) {
    return Promise.reject(
      new Error('Tauri runtime not available. Run this app using "npm run tauri dev".'),
    );
  }
  return invoke<T>(command, args).catch((error) => {
    if (options.recordError !== false) {
      const meta = COMMAND_ERROR_META[command] ?? {
        title: command,
        source: command.replace(/_/g, "."),
      };
      recordExternalAppError({
        title: options.errorTitle ?? meta.title,
        source: options.errorSource ?? meta.source,
        error,
        serial: options.serial ?? resolveSerialFromArgs(args),
        route: options.route ?? resolveRoute(),
      });
    }
    throw error;
  });
};

export const getConfig = async () => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<AppConfig>>("get_config", {
    trace_id: traceId,
    traceId,
  });
};

export const checkAdb = async (commandPath?: string) => {
  const traceId = createTraceId();
  const payload: Record<string, unknown> = {
    trace_id: traceId,
    traceId,
  };
  if (commandPath && commandPath.trim()) {
    payload.command_path = commandPath;
    payload.commandPath = commandPath;
  }
  return tauriInvoke<CommandResponse<AdbInfo>>("check_adb", payload);
};

export const exportDiagnosticsBundle = async (outputDir?: string) => {
  const traceId = createTraceId();
  const payload: Record<string, unknown> = {
    trace_id: traceId,
    traceId,
  };
  if (outputDir && outputDir.trim()) {
    payload.output_dir = outputDir;
    // Tauri command args are often camelCase on the JS side; keep both for compatibility.
    payload.outputDir = outputDir;
  }
  return tauriInvoke<CommandResponse<string>>("export_diagnostics_bundle", payload);
};

export const saveConfig = async (config: AppConfig) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<AppConfig>>("save_app_config", {
    config,
    trace_id: traceId,
    traceId,
  });
};

export const resetConfig = async () => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<AppConfig>>("reset_config", {
    trace_id: traceId,
    traceId,
  });
};

export const listDevices = async (detailed = true, options?: InvokeErrorOptions) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<DeviceInfo[]>>("list_devices", {
    detailed,
    trace_id: traceId,
    traceId,
  }, options);
};

export const startDeviceTracking = async () => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("start_device_tracking", {
    trace_id: traceId,
    traceId,
  });
};

export const stopDeviceTracking = async () => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("stop_device_tracking", {
    trace_id: traceId,
    traceId,
  });
};

export const adbPair = async (address: string, pairingCode: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<HostCommandResult>>("adb_pair", {
    address,
    pairing_code: pairingCode,
    pairingCode,
    trace_id: traceId,
    traceId,
  });
};

export const adbConnect = async (address: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<HostCommandResult>>("adb_connect", {
    address,
    trace_id: traceId,
    traceId,
  });
};

export const runShell = async (
  serials: string[],
  command: string,
  parallel?: boolean,
  options?: InvokeErrorOptions,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<CommandResult[]>>("run_shell", {
    serials,
    command,
    parallel,
    trace_id: traceId,
    traceId,
  }, options);
};

export const startTerminalSession = async (serial: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<TerminalSessionInfo>>("start_terminal_session", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const writeTerminalSession = async (
  serial: string,
  data: string,
  newline: boolean,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("write_terminal_session", {
    serial,
    data,
    newline,
    trace_id: traceId,
    traceId,
  });
};

export const stopTerminalSession = async (serial: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("stop_terminal_session", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const persistTerminalState = async (
  restore_sessions: string[],
  buffers: Record<string, string[]>,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("persist_terminal_state", {
    restore_sessions,
    restoreSessions: restore_sessions,
    buffers,
    trace_id: traceId,
    traceId,
  });
};

export const rebootDevices = async (serials: string[], mode?: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<CommandResult[]>>("reboot_devices", {
    serials,
    mode,
    trace_id: traceId,
    traceId,
  });
};

export const setWifiState = async (serials: string[], enable: boolean) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<CommandResult[]>>("set_wifi_state", {
    serials,
    enable,
    trace_id: traceId,
    traceId,
  });
};

export const setBluetoothState = async (serials: string[], enable: boolean) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<CommandResult[]>>("set_bluetooth_state", {
    serials,
    enable,
    trace_id: traceId,
    traceId,
  });
};

export const installApkBatch = async (
  serials: string[],
  apkPath: string,
  replace: boolean,
  allowDowngrade: boolean,
  grant: boolean,
  allowTestPackages: boolean,
  extraArgs?: string,
  traceIdOverride?: string,
  options?: InvokeErrorOptions,
) => {
  const traceId = traceIdOverride ?? createTraceId();
  return tauriInvoke<CommandResponse<ApkBatchInstallResult>>("install_apk_batch", {
    serials,
    apk_path: apkPath,
    apkPath,
    replace,
    allow_downgrade: allowDowngrade,
    allowDowngrade,
    grant,
    allow_test_packages: allowTestPackages,
    allowTestPackages,
    extra_args: extraArgs,
    extraArgs,
    trace_id: traceId,
    traceId,
  }, options);
};

export const captureScreenshot = async (serial: string, outputDir: string, options?: InvokeErrorOptions) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<string>>("capture_screenshot", {
    serial,
    output_dir: outputDir,
    outputDir,
    trace_id: traceId,
    traceId,
  }, options);
};

export const startScreenRecord = async (serial: string, options?: InvokeErrorOptions) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<ScreenRecordStartResult>>("start_screen_record", {
    serial,
    trace_id: traceId,
    traceId,
  }, options);
};

export const stopScreenRecord = async (serial: string, outputDir?: string, options?: InvokeErrorOptions) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<ScreenRecordStopResult>>("stop_screen_record", {
    serial,
    output_dir: outputDir,
    outputDir,
    trace_id: traceId,
    traceId,
  }, options);
};

export const getScreenRecordStatus = async (serial: string, options?: InvokeErrorOptions) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<ScreenRecordStatus>>("get_screen_record_status", {
    serial,
    trace_id: traceId,
    traceId,
  }, options);
};

export const listDeviceFiles = async (serial: string, path: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<DeviceFileEntry[]>>("list_device_files", {
    serial,
    path,
    trace_id: traceId,
    traceId,
  });
};

export const pullDeviceFile = async (
  serial: string,
  devicePath: string,
  outputDir: string,
  traceId?: string,
  options?: InvokeErrorOptions,
) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return tauriInvoke<CommandResponse<string>>("pull_device_file", {
    serial,
    device_path: devicePath,
    output_dir: outputDir,
    devicePath,
    outputDir,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  }, options);
};

export const pushDeviceFile = async (
  serial: string,
  localPath: string,
  devicePath: string,
  traceId?: string,
  options?: InvokeErrorOptions,
) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return tauriInvoke<CommandResponse<string>>("push_device_file", {
    serial,
    local_path: localPath,
    localPath,
    device_path: devicePath,
    devicePath,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  }, options);
};

export const mkdirDeviceDir = async (
  serial: string,
  devicePath: string,
  traceId?: string,
  options?: InvokeErrorOptions,
) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return tauriInvoke<CommandResponse<string>>("mkdir_device_dir", {
    serial,
    device_path: devicePath,
    devicePath,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  }, options);
};

export const renameDevicePath = async (
  serial: string,
  fromPath: string,
  toPath: string,
  traceId?: string,
  options?: InvokeErrorOptions,
) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return tauriInvoke<CommandResponse<string>>("rename_device_path", {
    serial,
    from_path: fromPath,
    to_path: toPath,
    fromPath,
    toPath,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  }, options);
};

export const deleteDevicePath = async (
  serial: string,
  devicePath: string,
  recursive: boolean,
  traceId?: string,
  options?: InvokeErrorOptions,
) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return tauriInvoke<CommandResponse<string>>("delete_device_path", {
    serial,
    device_path: devicePath,
    devicePath,
    recursive,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  }, options);
};

export const previewLocalFile = async (localPath: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<FilePreview>>("preview_local_file", {
    local_path: localPath,
    localPath,
    trace_id: traceId,
    traceId,
  });
};

export const captureUiHierarchy = async (serial: string, options?: InvokeErrorOptions) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<UiHierarchyCaptureResult>>("capture_ui_hierarchy", {
    serial,
    trace_id: traceId,
    traceId,
  }, options);
};

export const exportUiHierarchy = async (serial: string, outputDir?: string, options?: InvokeErrorOptions) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<UiHierarchyExportResult>>("export_ui_hierarchy", {
    serial,
    output_dir: outputDir,
    outputDir,
    trace_id: traceId,
    traceId,
  }, options);
};

export const startPerfMonitor = async (serial: string, intervalMs?: number) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("start_perf_monitor", {
    serial,
    interval_ms: intervalMs,
    intervalMs,
    trace_id: traceId,
    traceId,
  });
};

export const stopPerfMonitor = async (serial: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("stop_perf_monitor", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const startNetProfiler = async (
  serial: string,
  intervalMs?: number,
  topN?: number,
  pinnedUids?: number[],
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("start_net_profiler", {
    serial,
    interval_ms: intervalMs,
    intervalMs,
    top_n: topN,
    topN,
    pinned_uids: pinnedUids,
    pinnedUids,
    trace_id: traceId,
    traceId,
  });
};

export const stopNetProfiler = async (serial: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("stop_net_profiler", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const setNetProfilerPinnedUids = async (serial: string, pinnedUids?: number[]) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("set_net_profiler_pinned_uids", {
    serial,
    pinned_uids: pinnedUids,
    pinnedUids,
    trace_id: traceId,
    traceId,
  });
};

export const startLogcat = async (serial: string, filter?: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("start_logcat", {
    serial,
    filter,
    trace_id: traceId,
    traceId,
  });
};

export const stopLogcat = async (serial: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("stop_logcat", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const getLogcatStatus = async (serial: string, options?: InvokeErrorOptions) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<LogcatStatus>>("get_logcat_status", {
    serial,
    trace_id: traceId,
    traceId,
  }, options);
};

export const loadLegacyLogcatPresets = async () => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<LegacyLogcatPreset[]>>("load_legacy_logcat_presets", {
    trace_id: traceId,
    traceId,
  });
};

export const clearLogcat = async (serial: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("clear_logcat", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const exportLogcat = async (
  serial: string,
  lines: string[],
  outputDir?: string,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<LogcatExportResult>>("export_logcat", {
    serial,
    lines,
    output_dir: outputDir,
    outputDir,
    trace_id: traceId,
    traceId,
  });
};

export const listApps = async (
  serial: string,
  thirdPartyOnly?: boolean,
  includeVersions?: boolean,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<AppInfo[]>>("list_apps", {
    serial,
    third_party_only: thirdPartyOnly,
    thirdPartyOnly,
    include_versions: includeVersions,
    includeVersions,
    trace_id: traceId,
    traceId,
  });
};

export const getAppBasicInfo = async (serial: string, packageName: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<AppBasicInfo>>("get_app_basic_info", {
    serial,
    package_name: packageName,
    packageName,
    trace_id: traceId,
    traceId,
  });
};

export const getAppIcon = async (serial: string, packageName: string, apkPath?: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<AppIcon>>("get_app_icon", {
    serial,
    package_name: packageName,
    packageName,
    apk_path: apkPath,
    apkPath,
    trace_id: traceId,
    traceId,
  });
};

export const uninstallApp = async (
  serial: string,
  packageName: string,
  keepData: boolean,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("uninstall_app", {
    serial,
    package_name: packageName,
    keep_data: keepData,
    packageName,
    keepData,
    trace_id: traceId,
    traceId,
  });
};

export const forceStopApp = async (serial: string, packageName: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("force_stop_app", {
    serial,
    package_name: packageName,
    packageName,
    trace_id: traceId,
    traceId,
  });
};

export const clearAppData = async (serial: string, packageName: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("clear_app_data", {
    serial,
    package_name: packageName,
    packageName,
    trace_id: traceId,
    traceId,
  });
};

export const setAppEnabled = async (
  serial: string,
  packageName: string,
  enable: boolean,
  userId?: number,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("set_app_enabled", {
    serial,
    package_name: packageName,
    enable,
    user_id: userId,
    packageName,
    userId,
    trace_id: traceId,
    traceId,
  });
};

export const openAppInfo = async (serial: string, packageName: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("open_app_info", {
    serial,
    package_name: packageName,
    packageName,
    trace_id: traceId,
    traceId,
  });
};

export const launchApp = async (serials: string[], packageName: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<CommandResult[]>>("launch_app", {
    serials,
    package_name: packageName,
    packageName,
    trace_id: traceId,
    traceId,
  });
};

export const checkScrcpy = async () => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<ScrcpyInfo>>("check_scrcpy", {
    trace_id: traceId,
    traceId,
  });
};

export const launchScrcpy = async (serials: string[]) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<CommandResult[]>>("launch_scrcpy", {
    serials,
    trace_id: traceId,
    traceId,
  });
};

export const startBluetoothMonitor = async (serial: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("start_bluetooth_monitor", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const stopBluetoothMonitor = async (serial: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("stop_bluetooth_monitor", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const generateBugreport = async (serial: string, outputDir: string, options?: InvokeErrorOptions) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<BugreportResult>>("generate_bugreport", {
    serial,
    output_dir: outputDir,
    outputDir,
    trace_id: traceId,
    traceId,
  }, options);
};

export const cancelBugreport = async (serial: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<boolean>>("cancel_bugreport", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const prepareBugreportLogcat = async (sourcePath: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<BugreportLogSummary>>("prepare_bugreport_logcat", {
    source_path: sourcePath,
    sourcePath,
    trace_id: traceId,
    traceId,
  });
};

export const prepareBugreportExtractIndex = async (sourcePath: string) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<BugreportExtractIndexSummary>>("prepare_bugreport_extract_index", {
    source_path: sourcePath,
    sourcePath,
    trace_id: traceId,
    traceId,
  });
};

export const queryBugreportExtract = async (
  reportId: string,
  query: BugreportExtractQuery,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<BugreportExtractResult>>("query_bugreport_extract", {
    report_id: reportId,
    reportId,
    query,
    trace_id: traceId,
    traceId,
  });
};

export const queryBugreportLogcat = async (
  reportId: string,
  filters: BugreportLogFilters,
  offset?: number,
  limit?: number,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<BugreportLogPage>>("query_bugreport_logcat", {
    report_id: reportId,
    reportId,
    filters,
    offset,
    limit,
    trace_id: traceId,
    traceId,
  });
};

export const searchBugreportLogcat = async (
  reportId: string,
  query: string,
  filters: BugreportLogFilters,
  limit?: number,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<BugreportLogSearchResult>>("search_bugreport_logcat", {
    report_id: reportId,
    reportId,
    query,
    filters,
    limit,
    trace_id: traceId,
    traceId,
  });
};

export const queryBugreportLogcatAround = async (
  reportId: string,
  anchorId: number,
  filters: BugreportLogFilters,
  before?: number,
  after?: number,
) => {
  const traceId = createTraceId();
  return tauriInvoke<CommandResponse<BugreportLogAroundPage>>("query_bugreport_logcat_around", {
    report_id: reportId,
    reportId,
    anchor_id: anchorId,
    anchorId,
    before,
    after,
    filters,
    trace_id: traceId,
    traceId,
  });
};
