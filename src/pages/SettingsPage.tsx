import {
  memo,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import { getAdbIssueRecoveryMessages } from "../adbIssues";
import { clampIosRefreshIntervalSec } from "../deviceAutoRefresh";
import { clampRetentionTimeoutSec } from "../deviceRetention";
import { formatIosRefreshHint, type IosToolGuidanceRow, type HostOs } from "../deviceUtils";
import { parseIntegerSettingInput } from "../settingsInput";
import { isTauriRuntime } from "../tauriEnv";
import {
  THEME_PRESETS,
  buildDefaultThemeStyleSettings,
  normalizeThemeFontSize,
  normalizeUiDensity,
} from "../theme";
import type {
  AdbInfo,
  AppConfig,
  ThemeBackgroundFit,
  ThemeBackgroundKind,
  ThemeStyleSettings,
  UiDensity,
} from "../types";
import type { UpdaterUpdateLike } from "../updater";

export const SETTINGS_TABS = [
  { id: "connectivity", label: "Connectivity" },
  { id: "appearance", label: "Appearance" },
  { id: "system", label: "System" },
  { id: "operations", label: "Operations" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export const HOST_OS_LABELS: Record<HostOs, string> = {
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
  unknown: "Unknown",
};

export type UpdateUiStatus =
  | "idle"
  | "checking"
  | "up_to_date"
  | "update_available"
  | "publishing_pending"
  | "installing"
  | "installed"
  | "installed_needs_restart"
  | "error";

export type SettingsPageProps = {
  config: AppConfig | null;
  setConfig: Dispatch<SetStateAction<AppConfig | null>>;
  busy: boolean;
  adbInfo: AdbInfo | null;
  clearAdbInfo: () => void;
  hostOs: HostOs;
  iosToolGuidanceRows: IosToolGuidanceRow[];
  effectiveThemeStyle: ThemeStyleSettings;
  themeCopy: {
    app_title: string;
    app_subtitle: string;
    sidebar_status_label: string;
  };
  updateThemeStyle: (updater: (current: ThemeStyleSettings) => ThemeStyleSettings) => void;
  updateThemeColor: (
    key: "primary" | "accent" | "text" | "panel",
    value: string,
  ) => void;
  updateThemeCopy: (
    key: "app_title" | "app_subtitle" | "sidebar_status_label",
    value: string,
  ) => void;
  onBrowseAdbPath: () => void;
  onCheckAdb: () => void;
  onRestartAdbServer: () => Promise<void>;
  onKillAdbServer: () => Promise<void>;
  onCheckIosTools: () => void;
  onBrowseThemeBackgroundPath: () => void;
  onImportThemeBackgroundPath: () => void;
  onBrowseOutputPath: () => void;
  onBrowseFileExportPath: () => void;
  appVersionLabel: string;
  updateLastCheckedMs: number | null;
  updateStatus: UpdateUiStatus;
  updateLastCheckSource: "auto" | "manual" | null;
  updateAvailable: UpdaterUpdateLike | null;
  updatePublishingMessage: string;
  updateError: string | null;
  onManualUpdateCheck: () => void;
  onOpenUpdateModal: () => void;
  desktopNotificationPermission: string;
  onRefreshDesktopNotificationsPermission: () => Promise<unknown>;
  onRequestDesktopNotificationsPermission: () => Promise<unknown>;
  onSendTestDesktopNotification: () => Promise<unknown>;
  onSaveConfig: () => void;
  onResetConfig: () => void;
};

export const SettingsPage = memo(function SettingsPage({
  config,
  setConfig,
  busy,
  adbInfo,
  clearAdbInfo,
  hostOs,
  iosToolGuidanceRows,
  effectiveThemeStyle,
  themeCopy,
  updateThemeStyle,
  updateThemeColor,
  updateThemeCopy,
  onBrowseAdbPath,
  onCheckAdb,
  onRestartAdbServer,
  onKillAdbServer,
  onCheckIosTools,
  onBrowseThemeBackgroundPath,
  onImportThemeBackgroundPath,
  onBrowseOutputPath,
  onBrowseFileExportPath,
  appVersionLabel,
  updateLastCheckedMs,
  updateStatus,
  updateLastCheckSource,
  updateAvailable,
  updatePublishingMessage,
  updateError,
  onManualUpdateCheck,
  onOpenUpdateModal,
  desktopNotificationPermission,
  onRefreshDesktopNotificationsPermission,
  onRequestDesktopNotificationsPermission,
  onSendTestDesktopNotification,
  onSaveConfig,
  onResetConfig,
}: SettingsPageProps) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabId>("connectivity");
  const activeSettingsTabIndex = SETTINGS_TABS.findIndex((tab) => tab.id === activeSettingsTab);
  const activeSettingsTabConfig =
    SETTINGS_TABS[activeSettingsTabIndex >= 0 ? activeSettingsTabIndex : 0] ?? SETTINGS_TABS[0];

  const handleSettingsTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const currentIndex = activeSettingsTabIndex >= 0 ? activeSettingsTabIndex : 0;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? SETTINGS_TABS.length - 1
          : event.key === "ArrowLeft"
            ? (currentIndex - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length
            : (currentIndex + 1) % SETTINGS_TABS.length;
    const nextTab = SETTINGS_TABS[nextIndex];

    setActiveSettingsTab(nextTab.id);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-settings-tab="${nextTab.id}"]`)
      ?.focus();
  };

  if (!config) {
    return (
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
    );
  }

  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Persisted locally. Update defaults for actions.</p>
        </div>
      </div>
      <section className="panel settings-panel">
        <div className="panel-header">
          <h2>Settings</h2>
          <span>Saved locally</span>
        </div>
        <div
          className="settings-tabs"
          role="tablist"
          aria-label="Settings sections"
          onKeyDown={handleSettingsTabKeyDown}
        >
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`settings-tab-${tab.id}`}
              className="settings-tab"
              aria-selected={activeSettingsTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={activeSettingsTab === tab.id ? 0 : -1}
              data-settings-tab={tab.id}
              onClick={() => setActiveSettingsTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div
          id={`settings-panel-${activeSettingsTabConfig.id}`}
          className={`settings-tab-panel settings-tab-panel-${activeSettingsTabConfig.id}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeSettingsTabConfig.id}`}
        >
          <div className="settings-grid">
            <div className="settings-group settings-span-2 settings-section-connectivity">
              <h3>ADB</h3>
              <label>
                ADB executable path
                <input
                  placeholder="/path/to/platform-tools/adb or C:\\Android\\platform-tools\\adb.exe"
                  value={config.adb.command_path}
                  onChange={(event) => {
                    const commandPath = event.target.value;
                    setConfig((prev) =>
                      prev ? { ...prev, adb: { ...prev.adb, command_path: commandPath } } : prev,
                    );
                    clearAdbInfo();
                  }}
                />
              </label>
              <div className="muted settings-hint">
                Leave blank to use <code>adb</code> from your PATH. Otherwise select the{" "}
                <code>adb</code> executable from Android platform-tools.
              </div>
              <div className="button-row">
                <button type="button" className="ghost" onClick={onBrowseAdbPath} disabled={busy}>
                  Browse
                </button>
                <button type="button" className="ghost" onClick={onCheckAdb} disabled={busy}>
                  Test
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void onRestartAdbServer()}
                >
                  Restart ADB Server
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void onKillAdbServer()}
                >
                  Kill ADB Server
                </button>
              </div>
              {adbInfo && (
                <div className={`inline-alert ${adbInfo.available ? "info" : "error"}`}>
                  <strong>{adbInfo.available ? "ADB available" : "ADB not available"}</strong>
                  <span>
                    Command: <code>{adbInfo.command_path}</code>
                  </span>
                  {adbInfo.version_output && (
                    <span className="muted">
                      <code>{adbInfo.version_output}</code>
                    </span>
                  )}
                  {adbInfo.error && <span className="muted">Error: {adbInfo.error}</span>}
                  {getAdbIssueRecoveryMessages(adbInfo).map((message) => (
                    <span key={message} className="muted">
                      {message}
                    </span>
                  ))}
                  <span className="muted">Save Settings to apply this path globally.</span>
                </div>
              )}
            </div>
            <div className="settings-group settings-span-2 settings-section-connectivity">
              <h3>iOS Tools</h3>
              <div className="muted settings-hint">
                iOS device inventory uses Xcode <code>devicectl</code> on macOS or libimobiledevice
                with <code>usbmuxd</code> on Linux. These tools are not bundled with the app.
              </div>
              <div className="inline-alert info">
                <strong>Host setup</strong>
                <span>
                  Detected host: <code>{HOST_OS_LABELS[hostOs]}</code>
                </span>
                {hostOs === "linux" ? (
                  <>
                    <span>Ubuntu/Debian setup commands:</span>
                    <code>sudo apt install usbmuxd libimobiledevice-utils</code>
                    <code>sudo systemctl enable --now usbmuxd</code>
                    <code>idevice_id -l</code>
                    <code>ideviceinfo -u "&lt;UDID&gt;"</code>
                  </>
                ) : (
                  <>
                    <span>macOS setup commands:</span>
                    <code>xcode-select --install</code>
                    <code>cfgutil help</code>
                    <span className="muted">
                      Install Apple Configurator from the App Store, then install its command-line
                      tool to enable <code>cfgutil</code>.
                    </span>
                  </>
                )}
                <span className="muted">
                  Unlock the iPhone and accept the trust prompt before refreshing devices.
                </span>
              </div>
              <div className="button-row">
                <button type="button" className="ghost" onClick={onCheckIosTools} disabled={busy}>
                  Test iOS Tools
                </button>
              </div>
              <div className="inline-alert info">
                <strong>iOS tool status</strong>
                {iosToolGuidanceRows.map((row) => (
                  <span key={row.id}>
                    {row.label}: <code>{row.status}</code>{" "}
                    <span className="muted">({row.role})</span>
                    <span className="muted"> · {row.detail}</span>
                    {row.error ? <span className="muted"> · {row.error}</span> : null}
                  </span>
                ))}
                <span className="muted">
                  Linux does not use Xcode <code>devicectl</code>; missing devicectl is expected
                  there.
                </span>
              </div>
            </div>
            <div className="settings-group settings-span-2 appearance-settings-group settings-section-appearance">
              <h3>Appearance</h3>
              <div className="appearance-layout">
                <div className="appearance-controls">
                  <label>
                    Theme preset
                    <select
                      value={effectiveThemeStyle.preset_id}
                      onChange={(event) =>
                        updateThemeStyle((current) => ({
                          ...current,
                          preset_id: event.target.value,
                        }))
                      }
                    >
                      {THEME_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Background source
                    <select
                      value={effectiveThemeStyle.background_source.kind}
                      onChange={(event) =>
                        updateThemeStyle((current) => ({
                          ...current,
                          background_source: {
                            kind: event.target.value as ThemeBackgroundKind,
                            path:
                              event.target.value === "local_path" ||
                              event.target.value === "managed_path"
                                ? current.background_source.path
                                : "",
                          },
                        }))
                      }
                    >
                      <option value="preset">Preset background</option>
                      <option value="none">No background image</option>
                      <option value="local_path">Use local path</option>
                      <option value="managed_path">Imported image</option>
                    </select>
                  </label>
                  {(effectiveThemeStyle.background_source.kind === "local_path" ||
                    effectiveThemeStyle.background_source.kind === "managed_path") && (
                    <label>
                      Image path
                      <input
                        value={effectiveThemeStyle.background_source.path}
                        placeholder="/Users/me/Pictures/background.png"
                        onChange={(event) =>
                          updateThemeStyle((current) => ({
                            ...current,
                            background_source: {
                              ...current.background_source,
                              path: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  )}
                  <div className="button-row">
                    <button
                      type="button"
                      className="ghost"
                      onClick={onBrowseThemeBackgroundPath}
                      disabled={busy || !isTauriRuntime()}
                    >
                      Use Local Image
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={onImportThemeBackgroundPath}
                      disabled={busy || !isTauriRuntime()}
                    >
                      Import Image
                    </button>
                  </div>
                  {!isTauriRuntime() && (
                    <div className="inline-alert info">
                      Image picking and importing are available in the desktop app build.
                    </div>
                  )}
                  <label>
                    Background fit
                    <select
                      value={effectiveThemeStyle.background_fit}
                      onChange={(event) =>
                        updateThemeStyle((current) => ({
                          ...current,
                          background_fit: event.target.value as ThemeBackgroundFit,
                        }))
                      }
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                      <option value="repeat">Repeat</option>
                    </select>
                  </label>
                  <label>
                    Background opacity
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={effectiveThemeStyle.background_opacity}
                      onChange={(event) =>
                        updateThemeStyle((current) => ({
                          ...current,
                          background_opacity: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Panel opacity
                    <input
                      type="range"
                      min={0.72}
                      max={1}
                      step={0.02}
                      value={effectiveThemeStyle.panel_opacity}
                      onChange={(event) =>
                        updateThemeStyle((current) => ({
                          ...current,
                          panel_opacity: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Font size
                    <input
                      type="number"
                      min={10}
                      max={18}
                      value={config.ui.font_size}
                      onChange={(event) =>
                        setConfig((prev) =>
                          prev
                            ? {
                                ...prev,
                                ui: {
                                  ...prev.ui,
                                  font_size: normalizeThemeFontSize(event.target.value),
                                },
                              }
                            : prev,
                        )
                      }
                    />
                  </label>
                  <label>
                    UI density
                    <select
                      value={normalizeUiDensity(config.ui.density)}
                      onChange={(event) =>
                        setConfig((prev) =>
                          prev
                            ? {
                                ...prev,
                                ui: {
                                  ...prev.ui,
                                  density: normalizeUiDensity(event.target.value) as UiDensity,
                                },
                              }
                            : prev,
                        )
                      }
                    >
                      <option value="compact">Compact</option>
                      <option value="cozy">Cozy</option>
                      <option value="comfortable">Comfortable</option>
                    </select>
                  </label>
                  <div className="theme-color-grid">
                    <label>
                      Primary
                      <input
                        type="color"
                        value={effectiveThemeStyle.colors.primary || "#2563eb"}
                        onChange={(event) => updateThemeColor("primary", event.target.value)}
                      />
                    </label>
                    <label>
                      Accent
                      <input
                        type="color"
                        value={effectiveThemeStyle.colors.accent || "#0f766e"}
                        onChange={(event) => updateThemeColor("accent", event.target.value)}
                      />
                    </label>
                    <label>
                      Text
                      <input
                        type="color"
                        value={effectiveThemeStyle.colors.text || "#0f172a"}
                        onChange={(event) => updateThemeColor("text", event.target.value)}
                      />
                    </label>
                    <label>
                      Panel
                      <input
                        type="color"
                        value={effectiveThemeStyle.colors.panel || "#ffffff"}
                        onChange={(event) => updateThemeColor("panel", event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        setConfig((prev) =>
                          prev
                            ? {
                                ...prev,
                                ui: {
                                  ...prev.ui,
                                  density: "cozy",
                                  font_size: 13,
                                  theme_style: buildDefaultThemeStyleSettings(),
                                },
                              }
                            : prev,
                        )
                      }
                      disabled={busy}
                    >
                      Reset Appearance
                    </button>
                  </div>
                </div>
                <div className="appearance-preview" aria-label="Appearance preview">
                  <div className="appearance-preview-window">
                    <div className="appearance-preview-sidebar">
                      <strong>{themeCopy.app_title}</strong>
                      <span>{themeCopy.app_subtitle}</span>
                    </div>
                    <div className="appearance-preview-main">
                      <div className="appearance-preview-card">
                        <strong>Dashboard</strong>
                        <span>Primary actions and device status.</span>
                        <button type="button">Primary Action</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="appearance-copy-grid">
                <label>
                  App title
                  <input
                    value={effectiveThemeStyle.copy_overrides.app_title}
                    placeholder="Lazy Blacktea"
                    maxLength={80}
                    onChange={(event) => updateThemeCopy("app_title", event.target.value)}
                  />
                </label>
                <label>
                  App subtitle
                  <input
                    value={effectiveThemeStyle.copy_overrides.app_subtitle}
                    placeholder="Device Automation"
                    maxLength={120}
                    onChange={(event) => updateThemeCopy("app_subtitle", event.target.value)}
                  />
                </label>
                <label>
                  Sidebar status label
                  <input
                    value={effectiveThemeStyle.copy_overrides.sidebar_status_label}
                    placeholder="Device Status"
                    maxLength={40}
                    onChange={(event) =>
                      updateThemeCopy("sidebar_status_label", event.target.value)
                    }
                  />
                </label>
              </div>
              <div className="muted settings-hint">
                Appearance settings are saved locally. Imported images are copied into the
                app-managed theme folder; local image paths continue to reference the original file.
              </div>
            </div>
            <div className="settings-group settings-section-system">
              <h3>Output Paths</h3>
              <label>
                Default Output
                <input
                  placeholder="e.g. /Users/me/Downloads or C:\\Users\\me\\Downloads"
                  value={config.output_path}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev ? { ...prev, output_path: event.target.value } : prev,
                    )
                  }
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="ghost"
                  onClick={onBrowseOutputPath}
                  disabled={busy}
                >
                  Browse
                </button>
              </div>
              <div className="muted settings-hint">
                Default folder for screenshots, bugreports, and recordings. Use an absolute local
                folder path.
              </div>
              <label>
                File Export
                <input
                  placeholder="Leave blank to use Default Output"
                  value={config.file_gen_output_path}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev ? { ...prev, file_gen_output_path: event.target.value } : prev,
                    )
                  }
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="ghost"
                  onClick={onBrowseFileExportPath}
                  disabled={busy}
                >
                  Browse
                </button>
              </div>
              <div className="muted settings-hint">
                Folder for generated exports (logcat, UI inspector). Leave blank to reuse Default
                Output.
              </div>
            </div>
            <div className="settings-group settings-section-system">
              <h3>Updates</h3>
              <div className="muted settings-hint">
                Check for new versions from GitHub Releases. Installing updates will restart the
                app.
              </div>
              <div className="stack">
                <div className="inline-row">
                  <span className="muted">Current version</span>
                  <code>{appVersionLabel}</code>
                </div>
                <div className="inline-row">
                  <span className="muted">Last checked</span>
                  <span>
                    {updateLastCheckedMs ? new Date(updateLastCheckedMs).toLocaleString() : "--"}
                  </span>
                </div>
              </div>

              {!isTauriRuntime() && (
                <div className="inline-alert info">
                  Updates are available in the desktop app build.
                </div>
              )}

              <div className="button-row">
                <button
                  type="button"
                  className="ghost"
                  onClick={onManualUpdateCheck}
                  disabled={
                    !isTauriRuntime() ||
                    busy ||
                    updateStatus === "checking" ||
                    updateStatus === "installing"
                  }
                >
                  {updateStatus === "checking" && updateLastCheckSource === "manual"
                    ? "Checking..."
                    : "Check for updates"}
                </button>
                {updateAvailable &&
                  updateStatus !== "installed" &&
                  updateStatus !== "installed_needs_restart" && (
                    <button
                      type="button"
                      onClick={onOpenUpdateModal}
                      disabled={busy || updateStatus === "installing"}
                    >
                      Install and restart
                    </button>
                  )}
              </div>

              {updateStatus === "update_available" && updateAvailable && (
                <div className="inline-alert info">
                  <strong>Update available</strong>
                  <span className="muted">Latest: {updateAvailable.version}</span>
                </div>
              )}
              {updateStatus === "publishing_pending" && (
                <div className="inline-alert info">{updatePublishingMessage}</div>
              )}
              {updateStatus === "installed_needs_restart" && (
                <div className="inline-alert info">
                  <strong>Update installed</strong>
                  <span className="muted">Please restart the app manually.</span>
                </div>
              )}
              {updateStatus === "up_to_date" && updateLastCheckSource === "manual" && (
                <div className="inline-alert info">You are up to date.</div>
              )}
              {updateStatus === "error" && updateError && (
                <div className="inline-alert error">{updateError}</div>
              )}
            </div>

            <div className="settings-group settings-section-system">
              <h3>Notifications</h3>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.notifications.enabled}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              enabled: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Enable notifications
              </label>
              <div className="muted settings-hint">Controls task completion alerts.</div>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.notifications.in_app_modal_enabled}
                  disabled={!config.notifications.enabled}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              in_app_modal_enabled: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                In-app completion modal
              </label>
              <div className="muted settings-hint">
                Show an in-app modal when tracked tasks complete.
              </div>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.notifications.desktop_enabled}
                  disabled={!config.notifications.enabled}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              desktop_enabled: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Desktop notifications
              </label>
              <div className="muted settings-hint">Show OS notifications when tasks complete.</div>

              {!isTauriRuntime() && (
                <div className="inline-alert info">
                  Desktop notifications are available in the desktop app build.
                </div>
              )}

              <div className="stack">
                <div className="inline-row">
                  <span className="muted">Permission</span>
                  <code>{isTauriRuntime() ? desktopNotificationPermission : "browser"}</code>
                </div>
              </div>

              <div className="button-row">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void onRefreshDesktopNotificationsPermission()}
                  disabled={!isTauriRuntime() || busy}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void onRequestDesktopNotificationsPermission()}
                  disabled={!isTauriRuntime() || busy}
                >
                  Request permission
                </button>
                <button
                  type="button"
                  onClick={() => void onSendTestDesktopNotification()}
                  disabled={!isTauriRuntime() || busy}
                >
                  Send test
                </button>
              </div>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.notifications.desktop_only_when_unfocused}
                  disabled={!config.notifications.enabled || !config.notifications.desktop_enabled}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              desktop_only_when_unfocused: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Only when unfocused
              </label>
              <div className="muted settings-hint">
                When enabled, notifications are sent only when the app window is not focused.
              </div>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.notifications.desktop_on_error}
                  disabled={!config.notifications.enabled || !config.notifications.desktop_enabled}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              desktop_on_error: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Notify on errors
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.notifications.desktop_on_success}
                  disabled={!config.notifications.enabled || !config.notifications.desktop_enabled}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              desktop_on_success: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Notify on success
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.notifications.desktop_on_cancelled}
                  disabled={!config.notifications.enabled || !config.notifications.desktop_enabled}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              desktop_on_cancelled: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Notify on cancelled
              </label>
            </div>
            <div className="settings-group settings-section-connectivity">
              <h3>Devices</h3>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.device.auto_refresh_enabled}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            device: {
                              ...prev.device,
                              auto_refresh_enabled: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Auto-refresh device details
              </label>
              <div className="muted settings-hint">
                When enabled, background detail refresh keeps battery and connectivity fields up to
                date (no toast errors).
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.device.ios_auto_refresh_enabled === true}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            device: {
                              ...prev.device,
                              ios_auto_refresh_enabled: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Auto-refresh iOS inventory
              </label>
              <div className="muted settings-hint">
                {formatIosRefreshHint(config.device.ios_auto_refresh_enabled === true)} Android
                still uses ADB tracking for hot-plug.
              </div>
              <label>
                iOS refresh interval (sec)
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={config.device.ios_refresh_interval ?? 15}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            device: {
                              ...prev.device,
                              ios_refresh_interval: clampIosRefreshIntervalSec(
                                parseIntegerSettingInput(
                                  event.target.value,
                                  prev.device.ios_refresh_interval ?? 15,
                                ),
                              ),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <label>
                Refresh interval (sec)
                <input
                  type="number"
                  min={1}
                  value={config.device.refresh_interval}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            device: {
                              ...prev.device,
                              refresh_interval: parseIntegerSettingInput(
                                event.target.value,
                                prev.device.refresh_interval,
                                { min: 1 },
                              ),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Refresh interval for tracker recovery checks. Also used for detail sync when
                auto-refresh is enabled. Minimum 1 second.
              </div>
              <div className="muted settings-hint">
                Device connection state always follows <code>adb track-devices</code> events.{" "}
                <code>adb devices</code> is only used for startup or recovery sync, not fixed
                polling.
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.device.device_retention_enabled !== false}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            device: {
                              ...prev.device,
                              device_retention_enabled: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Retain rebooting and disconnected devices
              </label>
              <div className="muted settings-hint">
                Temporarily keeps rebooting and disconnected devices in the list with clear status
                to avoid losing selections.
              </div>
              {config.device.device_retention_enabled !== false && (
                <>
                  <label>
                    Reboot retention timeout (sec)
                    <input
                      type="number"
                      min={10}
                      max={600}
                      value={config.device.device_reboot_retention_timeout_sec ?? 90}
                      onChange={(event) =>
                        setConfig((prev) =>
                          prev
                            ? {
                                ...prev,
                                device: {
                                  ...prev.device,
                                  device_reboot_retention_timeout_sec: clampRetentionTimeoutSec(
                                    parseIntegerSettingInput(
                                      event.target.value,
                                      prev.device.device_reboot_retention_timeout_sec ?? 90,
                                    ),
                                    90,
                                  ),
                                },
                              }
                            : prev,
                        )
                      }
                    />
                  </label>
                  <label>
                    Disconnect retention timeout (sec)
                    <input
                      type="number"
                      min={0}
                      max={300}
                      value={config.device.device_disconnect_retention_timeout_sec ?? 45}
                      onChange={(event) =>
                        setConfig((prev) =>
                          prev
                            ? {
                                ...prev,
                                device: {
                                  ...prev.device,
                                  device_disconnect_retention_timeout_sec: clampRetentionTimeoutSec(
                                    parseIntegerSettingInput(
                                      event.target.value,
                                      prev.device.device_disconnect_retention_timeout_sec ?? 45,
                                    ),
                                    45,
                                  ),
                                },
                              }
                            : prev,
                        )
                      }
                    />
                  </label>
                </>
              )}
            </div>
            <div className="settings-group settings-section-operations">
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
                            command: {
                              ...prev.command,
                              command_timeout: parseIntegerSettingInput(
                                event.target.value,
                                prev.command.command_timeout,
                                { min: 1 },
                              ),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Shell Commands timeout in seconds. Increase if your <code>adb shell</code> commands
                are cut off.
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.command.parallel_execution}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            command: {
                              ...prev.command,
                              parallel_execution: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Parallel execution
              </label>
              <div className="muted settings-hint">
                Run multi-device operations in parallel (Shell Commands, APK batch installs).
                Disable if you see flaky ADB/USB behavior.
              </div>
            </div>
            <div className="settings-group settings-section-operations">
              <h3>Screenshot</h3>
              <label>
                Display ID
                <input
                  type="number"
                  min={-1}
                  value={config.screenshot.display_id}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            screenshot: {
                              ...prev.screenshot,
                              display_id: parseIntegerSettingInput(
                                event.target.value,
                                prev.screenshot.display_id,
                                { min: -1 },
                              ),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Use <code>-1</code> for the default display. Use <code>0+</code> to target a
                specific display.
              </div>
              <label>
                Extra args
                <input
                  value={config.screenshot.extra_args}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            screenshot: { ...prev.screenshot, extra_args: event.target.value },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Extra <code>screencap</code> flags, space-separated. Leave blank for defaults.
              </div>
            </div>
            <div className="settings-group settings-section-operations">
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
                            screen_record: {
                              ...prev.screen_record,
                              bit_rate: event.target.value,
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Video bit rate (bits per second). Example: <code>4000000</code>.
              </div>
              <label>
                Time limit (sec)
                <input
                  type="number"
                  min={0}
                  value={config.screen_record.time_limit_sec}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            screen_record: {
                              ...prev.screen_record,
                              time_limit_sec: parseIntegerSettingInput(
                                event.target.value,
                                prev.screen_record.time_limit_sec,
                                { min: 0 },
                              ),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Use <code>0</code> to record until stopped. Values above <code>180</code> use the
                long recording strategy automatically.
              </div>
              <label>
                Display ID
                <input
                  type="number"
                  min={-1}
                  value={config.screen_record.display_id}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            screen_record: {
                              ...prev.screen_record,
                              display_id: parseIntegerSettingInput(
                                event.target.value,
                                prev.screen_record.display_id,
                                { min: -1 },
                              ),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Use <code>-1</code> for the default display. Use <code>0+</code> to target a
                specific display.
              </div>
              <label>
                Size
                <input
                  placeholder="e.g. 1280x720"
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
              <div className="muted settings-hint">
                Optional size as <code>WIDTHxHEIGHT</code>. Leave blank to keep device native
                resolution.
              </div>
              <label>
                Extra args
                <input
                  value={config.screen_record.extra_args}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            screen_record: {
                              ...prev.screen_record,
                              extra_args: event.target.value,
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Extra <code>screenrecord</code> flags, space-separated. Leave blank for defaults.
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.screen_record.use_hevc}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            screen_record: {
                              ...prev.screen_record,
                              use_hevc: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Use HEVC
              </label>
              <div className="muted settings-hint">
                Use HEVC/H.265 codec (smaller files, may not be supported on older devices).
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.screen_record.bugreport}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            screen_record: {
                              ...prev.screen_record,
                              bugreport: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Bugreport overlay
              </label>
              <div className="muted settings-hint">
                Overlay bugreport info in the recording (Android feature).
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.screen_record.verbose}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            screen_record: {
                              ...prev.screen_record,
                              verbose: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Verbose output
              </label>
              <div className="muted settings-hint">
                Enable verbose <code>screenrecord</code> output for troubleshooting.
              </div>
            </div>
            <div className="settings-group settings-section-operations">
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
              <div className="muted settings-hint">Keep the device awake while mirroring.</div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.scrcpy.turn_screen_off}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            scrcpy: { ...prev.scrcpy, turn_screen_off: event.target.checked },
                          }
                        : prev,
                    )
                  }
                />
                Turn screen off
              </label>
              <div className="muted settings-hint">
                Turn off the device display while mirroring (stream stays on).
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.scrcpy.disable_screensaver}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            scrcpy: {
                              ...prev.scrcpy,
                              disable_screensaver: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Disable screensaver
              </label>
              <div className="muted settings-hint">Disable screensaver while mirroring.</div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.scrcpy.enable_audio_playback}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            scrcpy: {
                              ...prev.scrcpy,
                              enable_audio_playback: event.target.checked,
                            },
                          }
                        : prev,
                    )
                  }
                />
                Enable audio
              </label>
              <div className="muted settings-hint">
                Enable audio playback (depends on scrcpy version).
              </div>
              <label>
                Bit rate
                <input
                  placeholder="e.g. 8M"
                  value={config.scrcpy.bitrate}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev ? { ...prev, scrcpy: { ...prev.scrcpy, bitrate: event.target.value } } : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Video bit rate. scrcpy format, e.g. <code>8M</code> or <code>16M</code>.
              </div>
              <label>
                Max size
                <input
                  type="number"
                  min={0}
                  value={config.scrcpy.max_size}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            scrcpy: {
                              ...prev.scrcpy,
                              max_size: parseIntegerSettingInput(
                                event.target.value,
                                prev.scrcpy.max_size,
                                { min: 0 },
                              ),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <div className="muted settings-hint">
                Limit the max video dimension in pixels (<code>0</code> = no limit).
              </div>
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
              <div className="muted settings-hint">
                Additional scrcpy CLI args, space-separated. Leave blank for defaults.
              </div>
            </div>
          </div>
        </div>
        <div className="button-row settings-actions">
          <button onClick={onSaveConfig} disabled={busy}>
            Save Settings
          </button>
          <button onClick={onResetConfig} disabled={busy}>
            Reset Defaults
          </button>
        </div>
      </section>
    </div>
  );
});
