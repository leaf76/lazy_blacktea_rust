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
  return invoke<CommandResponse<AppConfig>>("get_config", {
    trace_id: createTraceId(),
  });
};

export const checkAdb = async (commandPath?: string) => {
  const payload: Record<string, unknown> = {
    trace_id: createTraceId(),
  };
  if (commandPath && commandPath.trim()) {
    payload.command_path = commandPath;
  }
  return invoke<CommandResponse<AdbInfo>>("check_adb", payload);
};

export const saveConfig = async (config: AppConfig) => {
  return invoke<CommandResponse<AppConfig>>("save_app_config", {
    config,
    trace_id: createTraceId(),
  });
};

export const resetConfig = async () => {
  return invoke<CommandResponse<AppConfig>>("reset_config", {
    trace_id: createTraceId(),
  });
};

export const listDevices = async (detailed = true) => {
  return invoke<CommandResponse<DeviceInfo[]>>("list_devices", {
    detailed,
    trace_id: createTraceId(),
  });
};

export const adbPair = async (address: string, pairingCode: string) => {
  return invoke<CommandResponse<HostCommandResult>>("adb_pair", {
    address,
    pairing_code: pairingCode,
    trace_id: createTraceId(),
  });
};

export const adbConnect = async (address: string) => {
  return invoke<CommandResponse<HostCommandResult>>("adb_connect", {
    address,
    trace_id: createTraceId(),
  });
};

export const runShell = async (
  serials: string[],
  command: string,
  parallel?: boolean,
) => {
  return invoke<CommandResponse<CommandResult[]>>("run_shell", {
    serials,
    command,
    parallel,
    trace_id: createTraceId(),
  });
};

export const startTerminalSession = async (serial: string) => {
  return invoke<CommandResponse<TerminalSessionInfo>>("start_terminal_session", {
    serial,
    trace_id: createTraceId(),
  });
};

export const writeTerminalSession = async (
  serial: string,
  data: string,
  newline: boolean,
) => {
  return invoke<CommandResponse<boolean>>("write_terminal_session", {
    serial,
    data,
    newline,
    trace_id: createTraceId(),
  });
};

export const stopTerminalSession = async (serial: string) => {
  return invoke<CommandResponse<boolean>>("stop_terminal_session", {
    serial,
    trace_id: createTraceId(),
  });
};

export const persistTerminalState = async (
  restore_sessions: string[],
  buffers: Record<string, string[]>,
) => {
  return invoke<CommandResponse<boolean>>("persist_terminal_state", {
    restore_sessions,
    buffers,
    trace_id: createTraceId(),
  });
};

export const rebootDevices = async (serials: string[], mode?: string) => {
  return invoke<CommandResponse<CommandResult[]>>("reboot_devices", {
    serials,
    mode,
    trace_id: createTraceId(),
  });
};

export const setWifiState = async (serials: string[], enable: boolean) => {
  return invoke<CommandResponse<CommandResult[]>>("set_wifi_state", {
    serials,
    enable,
    trace_id: createTraceId(),
  });
};

export const setBluetoothState = async (serials: string[], enable: boolean) => {
  return invoke<CommandResponse<CommandResult[]>>("set_bluetooth_state", {
    serials,
    enable,
    trace_id: createTraceId(),
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
  return invoke<CommandResponse<string>>("capture_screenshot", {
    serial,
    output_dir: outputDir,
    trace_id: createTraceId(),
  });
};

export const startScreenRecord = async (serial: string) => {
  return invoke<CommandResponse<string>>("start_screen_record", {
    serial,
    trace_id: createTraceId(),
  });
};

export const stopScreenRecord = async (serial: string, outputDir?: string) => {
  return invoke<CommandResponse<string>>("stop_screen_record", {
    serial,
    output_dir: outputDir,
    trace_id: createTraceId(),
  });
};

export const listDeviceFiles = async (serial: string, path: string) => {
  return invoke<CommandResponse<DeviceFileEntry[]>>("list_device_files", {
    serial,
    path,
    trace_id: createTraceId(),
  });
};

export const pullDeviceFile = async (
  serial: string,
  devicePath: string,
  outputDir: string,
  traceId?: string,
) => {
  return invoke<CommandResponse<string>>("pull_device_file", {
    serial,
    device_path: devicePath,
    output_dir: outputDir,
    trace_id: traceId ?? createTraceId(),
  });
};

export const pushDeviceFile = async (
  serial: string,
  localPath: string,
  devicePath: string,
  traceId?: string,
) => {
  return invoke<CommandResponse<string>>("push_device_file", {
    serial,
    local_path: localPath,
    device_path: devicePath,
    trace_id: traceId ?? createTraceId(),
  });
};

export const mkdirDeviceDir = async (serial: string, devicePath: string, traceId?: string) => {
  return invoke<CommandResponse<string>>("mkdir_device_dir", {
    serial,
    device_path: devicePath,
    trace_id: traceId ?? createTraceId(),
  });
};

export const renameDevicePath = async (
  serial: string,
  fromPath: string,
  toPath: string,
  traceId?: string,
) => {
  return invoke<CommandResponse<string>>("rename_device_path", {
    serial,
    from_path: fromPath,
    to_path: toPath,
    trace_id: traceId ?? createTraceId(),
  });
};

export const deleteDevicePath = async (
  serial: string,
  devicePath: string,
  recursive: boolean,
  traceId?: string,
) => {
  return invoke<CommandResponse<string>>("delete_device_path", {
    serial,
    device_path: devicePath,
    recursive,
    trace_id: traceId ?? createTraceId(),
  });
};

export const previewLocalFile = async (localPath: string) => {
  return invoke<CommandResponse<FilePreview>>("preview_local_file", {
    local_path: localPath,
    trace_id: createTraceId(),
  });
};

export const captureUiHierarchy = async (serial: string) => {
  return invoke<CommandResponse<UiHierarchyCaptureResult>>("capture_ui_hierarchy", {
    serial,
    trace_id: createTraceId(),
  });
};

export const exportUiHierarchy = async (serial: string, outputDir?: string) => {
  return invoke<CommandResponse<UiHierarchyExportResult>>("export_ui_hierarchy", {
    serial,
    output_dir: outputDir,
    trace_id: createTraceId(),
  });
};

export const startLogcat = async (serial: string, filter?: string) => {
  return invoke<CommandResponse<boolean>>("start_logcat", {
    serial,
    filter,
    trace_id: createTraceId(),
  });
};

export const stopLogcat = async (serial: string) => {
  return invoke<CommandResponse<boolean>>("stop_logcat", {
    serial,
    trace_id: createTraceId(),
  });
};

export const clearLogcat = async (serial: string) => {
  return invoke<CommandResponse<boolean>>("clear_logcat", {
    serial,
    trace_id: createTraceId(),
  });
};

export const exportLogcat = async (
  serial: string,
  lines: string[],
  outputDir?: string,
) => {
  return invoke<CommandResponse<LogcatExportResult>>("export_logcat", {
    serial,
    lines,
    output_dir: outputDir,
    trace_id: createTraceId(),
  });
};

export const listApps = async (
  serial: string,
  thirdPartyOnly?: boolean,
  includeVersions?: boolean,
) => {
  return invoke<CommandResponse<AppInfo[]>>("list_apps", {
    serial,
    third_party_only: thirdPartyOnly,
    include_versions: includeVersions,
    trace_id: createTraceId(),
  });
};

export const uninstallApp = async (
  serial: string,
  packageName: string,
  keepData: boolean,
) => {
  return invoke<CommandResponse<boolean>>("uninstall_app", {
    serial,
    package_name: packageName,
    keep_data: keepData,
    trace_id: createTraceId(),
  });
};

export const forceStopApp = async (serial: string, packageName: string) => {
  return invoke<CommandResponse<boolean>>("force_stop_app", {
    serial,
    package_name: packageName,
    trace_id: createTraceId(),
  });
};

export const clearAppData = async (serial: string, packageName: string) => {
  return invoke<CommandResponse<boolean>>("clear_app_data", {
    serial,
    package_name: packageName,
    trace_id: createTraceId(),
  });
};

export const setAppEnabled = async (
  serial: string,
  packageName: string,
  enable: boolean,
  userId?: number,
) => {
  return invoke<CommandResponse<boolean>>("set_app_enabled", {
    serial,
    package_name: packageName,
    enable,
    user_id: userId,
    trace_id: createTraceId(),
  });
};

export const openAppInfo = async (serial: string, packageName: string) => {
  return invoke<CommandResponse<boolean>>("open_app_info", {
    serial,
    package_name: packageName,
    trace_id: createTraceId(),
  });
};

export const launchApp = async (serials: string[], packageName: string) => {
  return invoke<CommandResponse<CommandResult[]>>("launch_app", {
    serials,
    package_name: packageName,
    trace_id: createTraceId(),
  });
};

export const checkScrcpy = async () => {
  return invoke<CommandResponse<ScrcpyInfo>>("check_scrcpy", {
    trace_id: createTraceId(),
  });
};

export const launchScrcpy = async (serials: string[]) => {
  return invoke<CommandResponse<CommandResult[]>>("launch_scrcpy", {
    serials,
    trace_id: createTraceId(),
  });
};

export const startBluetoothMonitor = async (serial: string) => {
  return invoke<CommandResponse<boolean>>("start_bluetooth_monitor", {
    serial,
    trace_id: createTraceId(),
  });
};

export const stopBluetoothMonitor = async (serial: string) => {
  return invoke<CommandResponse<boolean>>("stop_bluetooth_monitor", {
    serial,
    trace_id: createTraceId(),
  });
};

export const generateBugreport = async (serial: string, outputDir: string) => {
  return invoke<CommandResponse<BugreportResult>>("generate_bugreport", {
    serial,
    output_dir: outputDir,
    outputDir,
    trace_id: createTraceId(),
  });
};

export const cancelBugreport = async (serial: string) => {
  return invoke<CommandResponse<boolean>>("cancel_bugreport", {
    serial,
    trace_id: createTraceId(),
  });
};

export const prepareBugreportLogcat = async (sourcePath: string) => {
  return invoke<CommandResponse<BugreportLogSummary>>("prepare_bugreport_logcat", {
    source_path: sourcePath,
    sourcePath,
    trace_id: createTraceId(),
  });
};

export const queryBugreportLogcat = async (
  reportId: string,
  filters: BugreportLogFilters,
  offset?: number,
  limit?: number,
) => {
  return invoke<CommandResponse<BugreportLogPage>>("query_bugreport_logcat", {
    report_id: reportId,
    reportId,
    filters,
    offset,
    limit,
    trace_id: createTraceId(),
  });
};
