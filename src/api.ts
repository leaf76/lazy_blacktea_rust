import { invoke } from "@tauri-apps/api/core";
import type {
  AdbInfo,
  ApkBatchInstallResult,
  AppConfig,
  AppInfo,
  BugreportLogFilters,
  BugreportLogPage,
  BugreportLogSummary,
  BugreportResult,
  CommandResponse,
  CommandResult,
  DeviceFileEntry,
  DeviceInfo,
  FilePreview,
  HostCommandResult,
  LogcatExportResult,
  ScrcpyInfo,
  TerminalSessionInfo,
  UiHierarchyCaptureResult,
  UiHierarchyExportResult,
} from "./types";

const createTraceId = () => crypto.randomUUID();

export const getConfig = async () => {
  const traceId = createTraceId();
  return invoke<CommandResponse<AppConfig>>("get_config", {
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
  return invoke<CommandResponse<AdbInfo>>("check_adb", payload);
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
  return invoke<CommandResponse<string>>("export_diagnostics_bundle", payload);
};

export const saveConfig = async (config: AppConfig) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<AppConfig>>("save_app_config", {
    config,
    trace_id: traceId,
    traceId,
  });
};

export const resetConfig = async () => {
  const traceId = createTraceId();
  return invoke<CommandResponse<AppConfig>>("reset_config", {
    trace_id: traceId,
    traceId,
  });
};

export const listDevices = async (detailed = true) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<DeviceInfo[]>>("list_devices", {
    detailed,
    trace_id: traceId,
    traceId,
  });
};

export const adbPair = async (address: string, pairingCode: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<HostCommandResult>>("adb_pair", {
    address,
    pairing_code: pairingCode,
    pairingCode,
    trace_id: traceId,
    traceId,
  });
};

export const adbConnect = async (address: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<HostCommandResult>>("adb_connect", {
    address,
    trace_id: traceId,
    traceId,
  });
};

export const runShell = async (
  serials: string[],
  command: string,
  parallel?: boolean,
) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<CommandResult[]>>("run_shell", {
    serials,
    command,
    parallel,
    trace_id: traceId,
    traceId,
  });
};

export const startTerminalSession = async (serial: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<TerminalSessionInfo>>("start_terminal_session", {
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
  return invoke<CommandResponse<boolean>>("write_terminal_session", {
    serial,
    data,
    newline,
    trace_id: traceId,
    traceId,
  });
};

export const stopTerminalSession = async (serial: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<boolean>>("stop_terminal_session", {
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
  return invoke<CommandResponse<boolean>>("persist_terminal_state", {
    restore_sessions,
    restoreSessions: restore_sessions,
    buffers,
    trace_id: traceId,
    traceId,
  });
};

export const rebootDevices = async (serials: string[], mode?: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<CommandResult[]>>("reboot_devices", {
    serials,
    mode,
    trace_id: traceId,
    traceId,
  });
};

export const setWifiState = async (serials: string[], enable: boolean) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<CommandResult[]>>("set_wifi_state", {
    serials,
    enable,
    trace_id: traceId,
    traceId,
  });
};

export const setBluetoothState = async (serials: string[], enable: boolean) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<CommandResult[]>>("set_bluetooth_state", {
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
) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<ApkBatchInstallResult>>("install_apk_batch", {
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
  });
};

export const captureScreenshot = async (serial: string, outputDir: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<string>>("capture_screenshot", {
    serial,
    output_dir: outputDir,
    outputDir,
    trace_id: traceId,
    traceId,
  });
};

export const startScreenRecord = async (serial: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<string>>("start_screen_record", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const stopScreenRecord = async (serial: string, outputDir?: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<string>>("stop_screen_record", {
    serial,
    output_dir: outputDir,
    outputDir,
    trace_id: traceId,
    traceId,
  });
};

export const listDeviceFiles = async (serial: string, path: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<DeviceFileEntry[]>>("list_device_files", {
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
) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return invoke<CommandResponse<string>>("pull_device_file", {
    serial,
    device_path: devicePath,
    output_dir: outputDir,
    devicePath,
    outputDir,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  });
};

export const pushDeviceFile = async (
  serial: string,
  localPath: string,
  devicePath: string,
  traceId?: string,
) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return invoke<CommandResponse<string>>("push_device_file", {
    serial,
    local_path: localPath,
    localPath,
    device_path: devicePath,
    devicePath,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  });
};

export const mkdirDeviceDir = async (serial: string, devicePath: string, traceId?: string) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return invoke<CommandResponse<string>>("mkdir_device_dir", {
    serial,
    device_path: devicePath,
    devicePath,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  });
};

export const renameDevicePath = async (
  serial: string,
  fromPath: string,
  toPath: string,
  traceId?: string,
) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return invoke<CommandResponse<string>>("rename_device_path", {
    serial,
    from_path: fromPath,
    to_path: toPath,
    fromPath,
    toPath,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  });
};

export const deleteDevicePath = async (
  serial: string,
  devicePath: string,
  recursive: boolean,
  traceId?: string,
) => {
  const resolvedTraceId = traceId ?? createTraceId();
  return invoke<CommandResponse<string>>("delete_device_path", {
    serial,
    device_path: devicePath,
    devicePath,
    recursive,
    trace_id: resolvedTraceId,
    traceId: resolvedTraceId,
  });
};

export const previewLocalFile = async (localPath: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<FilePreview>>("preview_local_file", {
    local_path: localPath,
    localPath,
    trace_id: traceId,
    traceId,
  });
};

export const captureUiHierarchy = async (serial: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<UiHierarchyCaptureResult>>("capture_ui_hierarchy", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const exportUiHierarchy = async (serial: string, outputDir?: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<UiHierarchyExportResult>>("export_ui_hierarchy", {
    serial,
    output_dir: outputDir,
    outputDir,
    trace_id: traceId,
    traceId,
  });
};

export const startLogcat = async (serial: string, filter?: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<boolean>>("start_logcat", {
    serial,
    filter,
    trace_id: traceId,
    traceId,
  });
};

export const stopLogcat = async (serial: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<boolean>>("stop_logcat", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const clearLogcat = async (serial: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<boolean>>("clear_logcat", {
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
  return invoke<CommandResponse<LogcatExportResult>>("export_logcat", {
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
  return invoke<CommandResponse<AppInfo[]>>("list_apps", {
    serial,
    third_party_only: thirdPartyOnly,
    thirdPartyOnly,
    include_versions: includeVersions,
    includeVersions,
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
  return invoke<CommandResponse<boolean>>("uninstall_app", {
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
  return invoke<CommandResponse<boolean>>("force_stop_app", {
    serial,
    package_name: packageName,
    packageName,
    trace_id: traceId,
    traceId,
  });
};

export const clearAppData = async (serial: string, packageName: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<boolean>>("clear_app_data", {
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
  return invoke<CommandResponse<boolean>>("set_app_enabled", {
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
  return invoke<CommandResponse<boolean>>("open_app_info", {
    serial,
    package_name: packageName,
    packageName,
    trace_id: traceId,
    traceId,
  });
};

export const launchApp = async (serials: string[], packageName: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<CommandResult[]>>("launch_app", {
    serials,
    package_name: packageName,
    packageName,
    trace_id: traceId,
    traceId,
  });
};

export const checkScrcpy = async () => {
  const traceId = createTraceId();
  return invoke<CommandResponse<ScrcpyInfo>>("check_scrcpy", {
    trace_id: traceId,
    traceId,
  });
};

export const launchScrcpy = async (serials: string[]) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<CommandResult[]>>("launch_scrcpy", {
    serials,
    trace_id: traceId,
    traceId,
  });
};

export const startBluetoothMonitor = async (serial: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<boolean>>("start_bluetooth_monitor", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const stopBluetoothMonitor = async (serial: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<boolean>>("stop_bluetooth_monitor", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const generateBugreport = async (serial: string, outputDir: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<BugreportResult>>("generate_bugreport", {
    serial,
    output_dir: outputDir,
    outputDir,
    trace_id: traceId,
    traceId,
  });
};

export const cancelBugreport = async (serial: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<boolean>>("cancel_bugreport", {
    serial,
    trace_id: traceId,
    traceId,
  });
};

export const prepareBugreportLogcat = async (sourcePath: string) => {
  const traceId = createTraceId();
  return invoke<CommandResponse<BugreportLogSummary>>("prepare_bugreport_logcat", {
    source_path: sourcePath,
    sourcePath,
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
  return invoke<CommandResponse<BugreportLogPage>>("query_bugreport_logcat", {
    report_id: reportId,
    reportId,
    filters,
    offset,
    limit,
    trace_id: traceId,
    traceId,
  });
};
