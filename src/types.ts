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
  brand?: string | null;
  model?: string | null;
  device?: string | null;
  android_version?: string | null;
  api_level?: string | null;
  battery_level?: number | null;
  wifi_is_on?: boolean | null;
  bt_is_on?: boolean | null;
  gms_version?: string | null;
  build_fingerprint?: string | null;
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

export type LogcatEvent = {
  serial: string;
  line: string;
  trace_id: string;
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

export type BugreportResult = {
  serial: string;
  success: boolean;
  output_path?: string | null;
  error?: string | null;
  stream_supported: boolean;
  progress?: number | null;
};

export type FilePreview = {
  local_path: string;
  mime_type: string;
  is_text: boolean;
  preview_text?: string | null;
};

export type ScrcpyInfo = {
  available: boolean;
  version_output: string;
  major_version: number;
  command_path: string;
};

export type BluetoothSnapshotEvent = {
  trace_id: string;
  snapshot: Record<string, unknown>;
};

export type BluetoothStateEvent = {
  trace_id: string;
  state: Record<string, unknown>;
};

export type BluetoothLogEvent = {
  trace_id: string;
  event: Record<string, unknown>;
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
  command_history: string[];
  device_groups: Record<string, string[]>;
  output_path: string;
  file_gen_output_path: string;
  version: string;
};
