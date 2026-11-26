import { memo, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import {
  getAppAvatarLetters,
  getAppDisplayName,
  getAppIconKey,
  getStableToneIndex,
  type AppActionKind,
  type AppIconCacheEntry,
  type AppsContextMenuState,
  type ContextMenuPosition,
} from "../appsUtils";
import { formatBytes } from "../perf";
import type { AppBasicInfo, AppInfo } from "../types";

export {
  getAppAvatarLetters,
  getAppDisplayName,
  getAppIconKey,
  getStableToneIndex,
  type AppActionKind,
  type AppIconCacheEntry,
  type AppsContextMenuState,
  type ContextMenuPosition,
};

export type AppsPageProps = {
  activeSerial: string | null;
  appsSerial: string | null;
  selectedSummaryLabel: string;
  singleSelectionWarning: boolean;
  singleSelectionWarningMessage: string;
  busy: boolean;
  appsFilter: string;
  onAppsFilterChange: (next: string) => void;
  appsThirdPartyOnly: boolean;
  onAppsThirdPartyOnlyChange: (next: boolean) => void;
  appsIncludeVersions: boolean;
  onAppsIncludeVersionsChange: (next: boolean) => void;
  appsLoading: boolean;
  onLoadApps: () => void;
  apps: AppInfo[];
  filteredApps: AppInfo[];
  visibleApps: AppInfo[];
  canLoadMoreApps: boolean;
  onLoadMoreApps: () => void;
  appIconsByKey: Record<string, AppIconCacheEntry>;
  appsListRef: RefObject<HTMLDivElement | null>;
  appsLoadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  selectedApp: AppInfo | null;
  selectedAppDetails: AppBasicInfo | null;
  appsDetailsBusy: boolean;
  onSelectAppRow: (app: AppInfo) => void;
  onAppDoubleClick: (app: AppInfo) => Promise<void>;
  onAppContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, app: AppInfo) => void;
  onAppAction: (action: AppActionKind) => void | Promise<void>;
  onContextForceStop: (app: AppInfo) => Promise<void>;
  onCopyPackageName: (packageName: string) => Promise<void>;
  appsContextMenu: AppsContextMenuState | null;
  appsContextMenuPosition: ContextMenuPosition | null;
  appsContextMenuRef: RefObject<HTMLDivElement | null>;
  onCloseAppsContextMenu: () => void;
};

export const AppsPage = memo(function AppsPage({
  activeSerial,
  appsSerial,
  selectedSummaryLabel,
  singleSelectionWarning,
  singleSelectionWarningMessage,
  busy,
  appsFilter,
  onAppsFilterChange,
  appsThirdPartyOnly,
  onAppsThirdPartyOnlyChange,
  appsIncludeVersions,
  onAppsIncludeVersionsChange,
  appsLoading,
  onLoadApps,
  apps,
  filteredApps,
  visibleApps,
  canLoadMoreApps,
  onLoadMoreApps,
  appIconsByKey,
  appsListRef,
  appsLoadMoreSentinelRef,
  selectedApp,
  selectedAppDetails,
  appsDetailsBusy,
  onSelectAppRow,
  onAppDoubleClick,
  onAppContextMenu,
  onAppAction,
  onContextForceStop,
  onCopyPackageName,
  appsContextMenu,
  appsContextMenuPosition,
  appsContextMenuRef,
  onCloseAppsContextMenu,
}: AppsPageProps) {
  return (
    <div className="page-section page-section-stretch apps-workspace">
      <div className="page-header">
        <div>
          <h1>App Manager</h1>
          <p className="muted">Search packages and execute common actions.</p>
        </div>
      </div>
      <section className="panel panel-stretch">
        <div className="panel-header">
          <h2>App Management</h2>
          <span>{selectedSummaryLabel}</span>
        </div>
        {singleSelectionWarning && (
          <div className="inline-alert info">
            <strong>Primary device in use</strong>
            <span>{singleSelectionWarningMessage}</span>
          </div>
        )}
        <div className="toolbar">
          <input
            value={appsFilter}
            onChange={(event) => onAppsFilterChange(event.target.value)}
            placeholder="Search package"
          />
          <label className="toggle">
            <input
              type="checkbox"
              checked={appsThirdPartyOnly}
              onChange={(event) => onAppsThirdPartyOnlyChange(event.target.checked)}
            />
            Third-party only
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={appsIncludeVersions}
              onChange={(event) => onAppsIncludeVersionsChange(event.target.checked)}
            />
            Include versions
          </label>
          <button onClick={onLoadApps} disabled={busy || !activeSerial}>
            {appsLoading ? "Loading…" : "Load Apps"}
          </button>
          {(() => {
            if (!appsSerial || apps.length === 0) {
              return null;
            }
            const prefix = `${appsSerial}::`;
            const entries = Object.entries(appIconsByKey).filter(([key]) => key.startsWith(prefix));
            const readyCount = entries.filter(([, item]) => item.status === "ready").length;
            const queuedCount = entries.filter(([, item]) => item.status === "queued").length;
            const loadingCount = entries.filter(([, item]) => item.status === "loading").length;
            const errorCount = entries.filter(([, item]) => item.status === "error").length;
            return (
              <span className="muted app-icons-progress" title="App icon loading">
                Icons {readyCount}/{apps.length}
                {loadingCount || queuedCount ? " · loading" : ""}
                {errorCount ? ` · ${errorCount} failed` : ""}
              </span>
            );
          })()}
        </div>
        <div className="split split-stretch apps-split">
          <div className="app-list" ref={appsListRef} role="list" aria-label="Apps">
            {apps.length === 0 ? (
              <p className="muted">No apps loaded. Click Load Apps.</p>
            ) : filteredApps.length === 0 ? (
              <p className="muted">No matches.</p>
            ) : (
              <>
                {visibleApps.map((app) => {
                  const isActive = selectedApp?.package_name === app.package_name;
                  const tone = getStableToneIndex(app.package_name);
                  const displayName = getAppDisplayName(app.package_name);
                  const letters = getAppAvatarLetters(app.package_name);
                  const versionLabel = appsIncludeVersions ? app.version_name ?? "" : "";
                  const iconKey = appsSerial ? getAppIconKey(appsSerial, app.package_name) : null;
                  const iconUrl = iconKey ? appIconsByKey[iconKey]?.dataUrl : undefined;
                  return (
                    <button
                      key={app.package_name}
                      className={`app-row${isActive ? " active" : ""}`}
                      type="button"
                      onClick={() => onSelectAppRow(app)}
                      onDoubleClick={() => void onAppDoubleClick(app)}
                      onContextMenu={(event) => onAppContextMenu(event, app)}
                      role="listitem"
                      aria-current={isActive ? "true" : undefined}
                      data-app-pkg={app.package_name}
                    >
                      <div
                        className={`app-avatar tone-${tone}`}
                        aria-hidden="true"
                        title={
                          iconKey && appIconsByKey[iconKey]?.status === "error"
                            ? appIconsByKey[iconKey]?.error
                            : undefined
                        }
                      >
                        {iconUrl ? <img className="app-icon-img" src={iconUrl} alt="" /> : letters}
                        {iconKey && appIconsByKey[iconKey]?.status === "loading" ? (
                          <span className="app-icon-spinner" aria-hidden="true" />
                        ) : iconKey && appIconsByKey[iconKey]?.status === "queued" ? (
                          <span className="app-icon-dot" aria-hidden="true" />
                        ) : iconKey && appIconsByKey[iconKey]?.status === "error" ? (
                          <span className="app-icon-error" aria-hidden="true">
                            !
                          </span>
                        ) : null}
                      </div>
                      <div className="app-row-main">
                        <div className="app-row-title">
                          <strong>{displayName}</strong>
                          {app.is_system && <span className="badge">System</span>}
                        </div>
                        <div className="app-row-sub">
                          <span className="app-row-package">{app.package_name}</span>
                          {versionLabel ? (
                            <span className="app-row-version">{versionLabel}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="app-row-tail" aria-hidden="true">
                        <span className="chevron">›</span>
                      </div>
                    </button>
                  );
                })}
                <div className="app-list-footer">
                  <span className="muted">
                    Showing {visibleApps.length}/{filteredApps.length}
                  </span>
                  {canLoadMoreApps ? (
                    <button type="button" className="ghost" onClick={onLoadMoreApps}>
                      Load more
                    </button>
                  ) : (
                    <span className="muted">All loaded</span>
                  )}
                </div>
                <div className="app-load-more-sentinel" ref={appsLoadMoreSentinelRef} />
              </>
            )}
          </div>
          <div className="preview-panel app-details">
            <h3>Selected App</h3>
            {selectedApp ? (
              <div className="stack">
                {(() => {
                  const tone = getStableToneIndex(selectedApp.package_name);
                  const displayName = getAppDisplayName(selectedApp.package_name);
                  const letters = getAppAvatarLetters(selectedApp.package_name);
                  const iconKey = appsSerial
                    ? getAppIconKey(appsSerial, selectedApp.package_name)
                    : null;
                  const iconUrl = iconKey ? appIconsByKey[iconKey]?.dataUrl : undefined;
                  return (
                    <div className="app-details-header">
                      <div className={`app-avatar large tone-${tone}`} aria-hidden="true">
                        {iconUrl ? <img className="app-icon-img" src={iconUrl} alt="" /> : letters}
                      </div>
                      <div className="app-details-title">
                        <div className="app-details-name">{displayName}</div>
                        <div className="app-details-package">{selectedApp.package_name}</div>
                      </div>
                    </div>
                  );
                })()}
                {appsDetailsBusy && <p className="muted">Loading details...</p>}
                <div className="stack">
                  <p className="muted">
                    Version: {selectedAppDetails?.version_name ?? selectedApp.version_name ?? "--"}
                  </p>
                  <details>
                    <summary className="muted">Install source</summary>
                    <div className="stack">
                      <p className="muted">
                        Installer: {selectedAppDetails?.installer_package_name ?? "--"}
                      </p>
                      <p className="muted">
                        Installing: {selectedAppDetails?.installing_package_name ?? "--"}
                      </p>
                      <p className="muted">
                        Originating: {selectedAppDetails?.originating_package_name ?? "--"}
                      </p>
                      <p className="muted">
                        Initiating: {selectedAppDetails?.initiating_package_name ?? "--"}
                      </p>
                    </div>
                  </details>
                  <p className="muted">UID: {selectedAppDetails?.uid ?? "--"}</p>
                  <p className="muted">Data dir: {selectedAppDetails?.data_dir ?? "--"}</p>
                  <p className="muted">Target SDK: {selectedAppDetails?.target_sdk ?? "--"}</p>
                  <details>
                    <summary className="muted">
                      Permissions (granted {selectedAppDetails?.granted_permissions?.length ?? 0} /
                      requested {selectedAppDetails?.requested_permissions?.length ?? 0})
                    </summary>
                    <div className="stack">
                      <p className="muted">Granted</p>
                      <pre>{(selectedAppDetails?.granted_permissions ?? []).join("\n")}</pre>
                      <p className="muted">Requested</p>
                      <pre>{(selectedAppDetails?.requested_permissions ?? []).join("\n")}</pre>
                    </div>
                  </details>
                  <details>
                    <summary className="muted">Components</summary>
                    <div className="stack">
                      <p className="muted">
                        Activities: {selectedAppDetails?.components_summary?.activities ?? 0}
                      </p>
                      <p className="muted">
                        Services: {selectedAppDetails?.components_summary?.services ?? 0}
                      </p>
                      <p className="muted">
                        Receivers: {selectedAppDetails?.components_summary?.receivers ?? 0}
                      </p>
                      <p className="muted">
                        Providers: {selectedAppDetails?.components_summary?.providers ?? 0}
                      </p>
                    </div>
                  </details>
                  <p className="muted">
                    First install: {selectedAppDetails?.first_install_time ?? "--"}
                  </p>
                  <p className="muted">
                    Last update: {selectedAppDetails?.last_update_time ?? "--"}
                  </p>
                  <p className="muted">
                    APK size:{" "}
                    {selectedAppDetails?.apk_size_bytes_total != null
                      ? formatBytes(selectedAppDetails.apk_size_bytes_total)
                      : "--"}
                  </p>
                </div>
                <div className="button-row compact">
                  <button
                    onClick={() => void onAppDoubleClick(selectedApp)}
                    disabled={busy || !activeSerial}
                  >
                    Launch
                  </button>
                  <button
                    onClick={() => void onAppAction("info")}
                    disabled={busy || !activeSerial}
                  >
                    Open Info
                  </button>
                </div>
                <div className="button-row compact">
                  <button
                    onClick={() => void onAppAction("forceStop")}
                    disabled={busy || !activeSerial}
                  >
                    Force Stop
                  </button>
                  <button
                    onClick={() => void onAppAction("clear")}
                    disabled={busy || !activeSerial}
                  >
                    Clear Data
                  </button>
                  <button
                    className="ghost"
                    onClick={() => void onAppAction("enable")}
                    disabled={busy || !activeSerial}
                  >
                    Enable
                  </button>
                  <button
                    className="ghost"
                    onClick={() => void onAppAction("disable")}
                    disabled={busy || !activeSerial}
                  >
                    Disable
                  </button>
                  <button
                    className="danger"
                    onClick={() => void onAppAction("uninstall")}
                    disabled={busy || !activeSerial}
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted">Select an app to manage.</p>
            )}
          </div>
        </div>
        {appsContextMenu && (
          <>
            <div className="context-menu-backdrop" onMouseDown={onCloseAppsContextMenu} />
            <div
              ref={appsContextMenuRef}
              className="context-menu context-menu-scrollable"
              style={{
                left: appsContextMenuPosition?.left ?? appsContextMenu.x,
                top: appsContextMenuPosition?.top ?? appsContextMenu.y,
                maxHeight: appsContextMenuPosition?.maxHeight,
                width: 240,
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {(() => {
                const app = appsContextMenu.app;
                const displayName = getAppDisplayName(app.package_name);
                return (
                  <>
                    <div className="context-menu-header">
                      <div className="context-menu-header-title">{displayName}</div>
                      <div className="context-menu-header-sub">{app.package_name}</div>
                      <div className="context-menu-header-sub">
                        {app.is_system ? "System" : "Third-party"}
                        {appsIncludeVersions && app.version_name ? ` · ${app.version_name}` : ""}
                      </div>
                    </div>
                    <div className="context-menu-sep" />
                  </>
                );
              })()}
              <button
                type="button"
                className="context-menu-item"
                onClick={() => void onAppDoubleClick(appsContextMenu.app)}
                disabled={busy || !activeSerial}
              >
                Launch
              </button>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => void onContextForceStop(appsContextMenu.app)}
                disabled={busy || !activeSerial}
              >
                Force Stop
              </button>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => void onAppAction("clear")}
                disabled={busy || !activeSerial}
              >
                Clear Data
              </button>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => void onAppAction("info")}
                disabled={busy || !activeSerial}
              >
                Open Info
              </button>
              <div className="context-menu-sep" />
              <button
                type="button"
                className="context-menu-item"
                onClick={() => void onAppAction("enable")}
                disabled={busy || !activeSerial}
              >
                Enable
              </button>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => void onAppAction("disable")}
                disabled={busy || !activeSerial}
              >
                Disable
              </button>
              <div className="context-menu-sep" />
              <button
                type="button"
                className="context-menu-item"
                onClick={() => {
                  void onCopyPackageName(appsContextMenu.app.package_name);
                  onCloseAppsContextMenu();
                }}
              >
                Copy package
              </button>
              <button
                type="button"
                className="context-menu-item danger"
                onClick={() => void onAppAction("uninstall")}
                disabled={busy || !activeSerial}
              >
                Uninstall
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
});
