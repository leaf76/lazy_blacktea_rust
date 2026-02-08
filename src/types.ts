export type DeviceSummary = {
  serial: string;
  state: string;
  model?: string | null;
  product?: string | null;
  device?: string | null;
  transport_id?: string | null;
};

export type DeviceDetail = {
  serial: string;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  device?: string | null;
  serial_number?: string | null;
  android_version?: string | null;
  api_level?: string | null;
  battery_level?: number | null;
  wifi_is_on?: boolean | null;
  bt_is_on?: boolean | null;
  gms_version?: string | null;
  build_fingerprint?: string | null;
  processor?: string | null;
  resolution?: string | null;
  storage_total_bytes?: number | null;
  memory_total_bytes?: number | null;
  audio_state?: string | null;
  bluetooth_manager_state?: string | null;
};

export type DeviceInfo = {
  summary: DeviceSummary;
  detail?: DeviceDetail | null;
};

export type DeviceFileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size_bytes?: number | null;
  modified_at?: string | null;
};

export type CommandResult = {
  serial: string;
  stdout: string;
  stderr: string;
  exit_code?: number | null;
};

export type HostCommandResult = {
  stdout: string;
  stderr: string;
  exit_code?: number | null;
};

export type AdbInfo = {
  available: boolean;
  version_output: string;
  command_path: string;
  error?: string | null;
};

export type UiHierarchyCaptureResult = {
  html: string;
  xml: string;
  screenshot_data_url?: string | null;
  screenshot_error?: string | null;
};

export type UiHierarchyExportResult = {
  serial: string;
  xml_path: string;
  html_path: string;
  screenshot_path: string;
};

export type LogcatExportResult = {
  serial: string;
  output_path: string;
  line_count: number;
};

export type CommandResponse<T> = {
  trace_id: string;
  data: T;
};

export type BluetoothState =
  | "Idle"
  | "Scanning"
  | "Advertising"
  | "Connected"
  | "Off"
  | "Unknown";

export type BluetoothEventType =
  | "AdvertisingStart"
  | "AdvertisingStop"
  | "ScanStart"
  | "ScanResult"
  | "ScanStop"
  | "Connect"
  | "Disconnect"
  | "Error";

export type BluetoothAdvertisingSet = {
  set_id?: number | null;
  interval_ms?: number | null;
  tx_power?: string | null;
  data_length: number;
  service_uuids: string[];
};

export type BluetoothAdvertisingState = {
  is_advertising: boolean;
  sets: BluetoothAdvertisingSet[];
};

export type BluetoothScanningState = {
  is_scanning: boolean;
  clients: string[];
};

export type BluetoothBondState = "None" | "Bonding" | "Bonded";

export type BluetoothBondedDevice = {
  address: string;
  name?: string | null;
  bond_state: BluetoothBondState;
};

export type BluetoothParsedSnapshot = {
  serial: string;
  timestamp: number;
  adapter_enabled: boolean;
  address?: string | null;
  scanning: BluetoothScanningState;
  advertising: BluetoothAdvertisingState;
  profiles: Record<string, string>;
  bonded_devices: BluetoothBondedDevice[];
  raw_text: string;
};

export type BluetoothParsedEvent = {
  serial: string;
  timestamp: number;
  event_type: BluetoothEventType;
  message: string;
  tag?: string | null;
  metadata: Record<string, unknown>;
  raw_line: string;
};

export type BluetoothStateSummary = {
  serial: string;
  active_states: BluetoothState[];
  metrics: Record<string, unknown>;
  timestamp: number;
};

export type BluetoothSnapshotEvent = {
  trace_id: string;
  snapshot: BluetoothParsedSnapshot;
};

export type BluetoothStateEvent = {
  trace_id: string;
  state: BluetoothStateSummary;
};

export type BluetoothEventEvent = {
  trace_id: string;
  event: BluetoothParsedEvent;
};

export type LogcatEvent = {
  serial: string;
  line?: string;
  lines?: string[];
  trace_id: string;
};

export type PerfSnapshot = {
  ts_ms: number;
  cpu_total_percent_x100?: number | null;
  cpu_cores_percent_x100?: (number | null)[] | null;
  cpu_cores_freq_khz?: (number | null)[] | null;
  mem_total_bytes?: number | null;
  mem_used_bytes?: number | null;
  net_rx_bps?: number | null;
  net_tx_bps?: number | null;
  battery_level?: number | null;
  battery_temp_decic?: number | null;
  display_refresh_hz_x100?: number | null;
  missed_frames_per_sec_x100?: number | null;
};

export type PerfEvent = {
  serial: string;
  snapshot?: PerfSnapshot | null;
  error?: string | null;
  trace_id: string;
};

export type TerminalSessionInfo = {
  serial: string;
  session_id: string;
};

export type TerminalEvent = {
  serial: string;
  session_id: string;
  event: string;
  stream?: string | null;
  chunk?: string | null;
  exit_code?: number | null;
  trace_id: string;
};

export type TerminalSettings = {
  restore_sessions: string[];
  buffers: Record<string, string[]>;
};

export type ApkInfo = {
  path: string;
  package_name?: string | null;
  version_code?: number | null;
  version_name?: string | null;
  min_sdk_version?: number | null;
  target_sdk_version?: number | null;
  is_split_apk: boolean;
  split_apk_paths: string[];
  file_size_bytes: number;
  error?: string | null;
};

export type ApkInstallResult = {
  serial: string;
  success: boolean;
  error_code: string;
  raw_output: string;
  duration_seconds: number;
  device_model?: string | null;
};

export type ApkBatchInstallResult = {
  apk_path: string;
  apk_info?: ApkInfo | null;
  results: Record<string, ApkInstallResult>;
  total_duration_seconds: number;
};

export type AppInfo = {
  package_name: string;
  version_name?: string | null;
  version_code?: string | null;
  is_system: boolean;
  apk_path?: string | null;
};

export type AppBasicInfo = {
  package_name: string;
  version_name?: string | null;
  version_code?: string | null;
  first_install_time?: string | null;
  last_update_time?: string | null;
  installer_package_name?: string | null;
  installing_package_name?: string | null;
  originating_package_name?: string | null;
  initiating_package_name?: string | null;
  uid?: number | null;
  data_dir?: string | null;
  target_sdk?: number | null;
  requested_permissions?: string[];
  granted_permissions?: string[];
  components_summary?: {
    activities: number;
    services: number;
    receivers: number;
    providers: number;
  } | null;
  apk_paths: string[];
  apk_size_bytes_total?: number | null;
};

export type AppIcon = {
  package_name: string;
  mime_type: string;
  data_url: string;
  from_cache: boolean;
};

export type BugreportResult = {
  serial: string;
  success: boolean;
  output_path?: string | null;
  error?: string | null;
  stream_supported: boolean;
  progress?: number | null;
};

export type BugreportTaskStatus = "running" | "success" | "error" | "cancelled";
export type BugreportTaskKind =
  | "shell"
  | "apk_install"
  | "bugreport"
  | "screenshot"
  | "screen_record_start"
  | "screen_record_stop"
  | "file_pull"
  | "file_push"
  | "file_mkdir"
  | "file_rename"
  | "file_delete";

export type BugreportTaskDeviceSnapshot = {
  serial: string;
  status: BugreportTaskStatus;
  message?: string | null;
  output_path?: string | null;
  exit_code?: number | null;
};

export type BugreportTaskSnapshot = {
  id: string;
  trace_id?: string | null;
  kind: BugreportTaskKind;
  title: string;
  status: BugreportTaskStatus;
  started_at: number;
  finished_at?: number | null;
  devices: Record<string, BugreportTaskDeviceSnapshot>;
};

export type BugreportLogSummary = {
  report_id: string;
  source_path: string;
  db_path: string;
  total_rows: number;
  min_ts?: string | null;
  max_ts?: string | null;
  levels: Record<string, number>;
};

export type BugreportLogFilters = {
  levels: string[];
  tag?: string | null;
  pid?: number | null;
  text_terms?: string[];
  text_excludes?: string[];
  text?: string | null;
  regex_terms?: string[];
  regex_excludes?: string[];
  start_ts?: string | null;
  end_ts?: string | null;
};

export type BugreportLogRow = {
  id: number;
  ts: string;
  level: string;
  tag: string;
  pid: number;
  tid: number;
  msg: string;
  raw_line: string;
};

export type BugreportLogPage = {
  rows: BugreportLogRow[];
  has_more: boolean;
  next_offset: number;
};

export type FilePreview = {
  local_path: string;
  mime_type: string;
  is_text: boolean;
  preview_text?: string | null;
  preview_data_url?: string | null;
};

export type ScrcpyInfo = {
  available: boolean;
  version_output: string;
  major_version: number;
  command_path: string;
};

export type UiSettings = {
  window_width: number;
  window_height: number;
  window_x: number;
  window_y: number;
  ui_scale: number;
  theme: string;
  font_size: number;
  show_console_panel: boolean;
  single_selection: boolean;
  default_output_path: string;
};

export type DeviceSettings = {
  refresh_interval: number;
  auto_refresh_enabled: boolean;
  auto_connect: boolean;
  show_offline_devices: boolean;
  preferred_devices: string[];
};

export type CommandSettings = {
  max_history_size: number;
  auto_save_history: boolean;
  command_timeout: number;
  parallel_execution: boolean;
};

export type AdbSettings = {
  command_path: string;
};

export type LoggingSettings = {
  log_level: string;
  log_to_file: boolean;
  max_log_files: number;
  log_file_size_mb: number;
};

export type LogcatSettings = {
  max_lines: number;
  history_multiplier: number;
  update_interval_ms: number;
  max_lines_per_update: number;
  max_buffer_size: number;
};

export type ScrcpySettings = {
  stay_awake: boolean;
  turn_screen_off: boolean;
  disable_screensaver: boolean;
  enable_audio_playback: boolean;
  bitrate: string;
  max_size: number;
  extra_args: string;
};

export type ApkInstallSettings = {
  replace_existing: boolean;
  allow_downgrade: boolean;
  grant_permissions: boolean;
  allow_test_packages: boolean;
  extra_args: string;
};

export type ScreenshotSettings = {
  extra_args: string;
  display_id: number;
};

export type ScreenRecordSettings = {
  bit_rate: string;
  time_limit_sec: number;
  size: string;
  extra_args: string;
  use_hevc: boolean;
  bugreport: boolean;
  verbose: boolean;
  display_id: number;
};

export type LogcatViewerSettings = {
  compact_mode: boolean;
  show_preview_panel: boolean;
  preview_collapsed: boolean;
  recording_collapsed: boolean;
  levels_collapsed: boolean;
  filters_collapsed: boolean;
  auto_scroll_enabled: boolean;
};

export type AppConfig = {
  ui: UiSettings;
  device: DeviceSettings;
  command: CommandSettings;
  adb: AdbSettings;
  logging: LoggingSettings;
  logcat: LogcatSettings;
  scrcpy: ScrcpySettings;
  apk_install: ApkInstallSettings;
  screenshot: ScreenshotSettings;
  screen_record: ScreenRecordSettings;
  logcat_viewer: LogcatViewerSettings;
  terminal: TerminalSettings;
  command_history: string[];
  device_groups: Record<string, string[]>;
  output_path: string;
  file_gen_output_path: string;
  version: string;
};
