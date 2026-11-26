import {
  memo,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { DeviceGroupPanel } from "../DeviceGroupPanel";
import { DeviceQuickFilterBar } from "../DeviceQuickFilterBar";
import {
  buildDeviceQuickActionDeviceStatus,
  type DeviceCommandStatusStackItem,
  type DeviceQuickActionStatus,
} from "../deviceActionStatus";
import {
  getNextKeyboardDeviceIndex,
  toggleDeviceQuickFilter,
  type DeviceQuickFilterId,
} from "../deviceQuickFilters";
import {
  resolveDeviceDisplayStatus,
  type DeviceRetentionRecord,
} from "../deviceRetention";
import {
  DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS,
  DEVICE_ITEM_INFO_FIELD_OPTIONS,
  buildDeviceItemInfoFields,
  formatIosTrustLabel,
  getDevicePlatform,
  type DeviceContextActionId,
  type DeviceGroupOption,
  type DeviceInfoCopyItem,
  type DeviceItemInfoFieldId,
  type DeviceQuickMenuAction,
  type DeviceQuickMenuSection,
  type DeviceQuickMenuSource,
} from "../deviceUtils";
import {
  buildScreenRecordDeviceStatus,
  type ScreenRecordPendingAction,
} from "../screenRecord";
import type { AppConfig, DeviceInfo, ScreenRecordStatus } from "../types";
import type { ContextMenuPosition } from "../appsUtils";

export type DeviceSelectionMode = "single" | "multi";

export type DeviceCatalogActionEntry = DeviceQuickMenuAction & {
  onSelect: () => void;
};

export type DeviceContextMenuState = {
  x: number;
  y: number;
  serial: string;
  source: DeviceQuickMenuSource;
  outputPath: string | null;
  visibleActionIds: DeviceContextActionId[] | null;
};

export type DeviceContextSubmenuState = {
  x: number;
  y: number;
  triggerLeft: number;
  triggerRight: number;
  title: string;
  items: DeviceInfoCopyItem[];
};

export type DevicesPageProps = {
  busy: boolean;
  config: AppConfig | null;
  devices: DeviceInfo[];
  visibleDevices: DeviceInfo[];
  selectedDevices: DeviceInfo[];
  connectedDevicesCount: number;
  selectedCount: number;
  selectedOnlineCount: number;
  selectedSerials: string[];
  setSelectedSerials: Dispatch<SetStateAction<string[]>>;
  activeSerial: string | null;
  searchText: string;
  onSearchTextChange: (next: string) => void;
  deviceSearchInputRef: RefObject<HTMLInputElement | null>;
  groupFilter: string;
  onGroupFilterChange: (next: string) => void;
  groupOptions: string[];
  groupMap: Record<string, string>;
  groupName: string;
  onGroupNameChange: (next: string) => void;
  groupPanelGroups: DeviceGroupOption[];
  deviceSelectionMode: DeviceSelectionMode;
  onSetDeviceSelectionMode: (mode: DeviceSelectionMode) => void;
  deviceItemInfoFieldIds: DeviceItemInfoFieldId[];
  selectedDeviceItemInfoFieldSet: Set<DeviceItemInfoFieldId>;
  onResetDeviceItemInfoFields: () => void;
  onToggleDeviceItemInfoField: (fieldId: DeviceItemInfoFieldId, checked: boolean) => void;
  onRefreshDevices: () => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  deviceQuickFilters: DeviceQuickFilterId[];
  setDeviceQuickFilters: Dispatch<SetStateAction<DeviceQuickFilterId[]>>;
  onClearDeviceFilters: () => void;
  hasDeviceFilters: boolean;
  deviceListRef: RefObject<HTMLDivElement | null>;
  lastSelectedIndexRef: MutableRefObject<number | null>;
  retentionMap: Record<string, DeviceRetentionRecord>;
  screenRecordStatusBySerial: Record<string, ScreenRecordStatus>;
  screenRecordPendingBySerial: Record<string, ScreenRecordPendingAction | undefined>;
  screenRecordStatusLoadingBySerial: Record<string, boolean>;
  deviceQuickActionStatusBySerial: Record<string, DeviceQuickActionStatus | undefined>;
  onDeviceRowSelect: (
    event: ReactMouseEvent<HTMLDivElement>,
    serial: string,
    index: number,
  ) => void;
  onToggleDevice: (serial: string) => void;
  onSelectActiveSerial: (serial: string) => void;
  onDismissRetainedDevice: (serial: string) => void;
  onOpenDeviceQuickContextMenuFromKeyboard: (
    event: ReactKeyboardEvent<HTMLElement>,
    serial: string,
    options: { source: DeviceQuickMenuSource; rowIndex: number },
  ) => void;
  onOpenDeviceQuickContextMenuFromPointer: (
    event: ReactMouseEvent<HTMLElement>,
    serial: string,
    options: { source: DeviceQuickMenuSource; rowIndex: number; showSelectionHint?: boolean },
  ) => void;
  deviceCommandStatusStack: DeviceCommandStatusStackItem[];
  onQuickScreenshot: () => Promise<void>;
  screenshotDisabled: boolean;
  screenshotCommandLabel: string;
  onQuickScreenRecord: () => Promise<void>;
  screenRecordDisabled: boolean;
  screenRecordCommandLabel: string;
  onOpenSelectedDeviceActionMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    actionIds: DeviceContextActionId[],
  ) => void;
  wifiEligibleCount: number;
  bluetoothEligibleCount: number;
  onScrcpyLaunch: () => Promise<void>;
  hasSelectedAndroidActionTarget: boolean;
  mirrorCommandLabel: string;
  onOpenRunShell: () => void;
  onRequestRebootConfirm: () => void;
  rebootDisabled: boolean;
  rebootDirectCommandLabel: string;
  onAssignGroup: () => Promise<void>;
  onAssignExistingGroup: (group: string) => void;
  onClearGroupAssignment: () => Promise<void>;
  onApplyDeviceGroupFilter: (group: string) => void;
  onClearDeviceGroupFilter: () => void;
  deviceContextMenu: DeviceContextMenuState | null;
  deviceContextMenuPosition: ContextMenuPosition | null;
  deviceContextMenuRef: RefObject<HTMLDivElement | null>;
  onCloseDeviceContextMenu: () => void;
  deviceContextMenuHeaderTitle: string;
  deviceContextMenuHeaderSub: string;
  deviceContextMenuSections: DeviceQuickMenuSection[];
  deviceActionCatalogMap: Map<DeviceContextActionId, DeviceCatalogActionEntry>;
  onOpenDeviceInfoCopySubmenu: (triggerEl: HTMLButtonElement) => void;
  onOpenExternalPath: (path: string) => Promise<void>;
  deviceContextSubmenu: DeviceContextSubmenuState | null;
  deviceContextSubmenuPosition: ContextMenuPosition | null;
  deviceContextSubmenuRef: RefObject<HTMLDivElement | null>;
  deviceContextMenuCopyItemsCount: number;
  onCopyDeviceInfoValue: (value: string, message: string) => Promise<void>;
};

export const DevicesPage = memo(function DevicesPage({
  busy,
  config,
  devices,
  visibleDevices,
  selectedDevices,
  connectedDevicesCount,
  selectedCount,
  selectedOnlineCount,
  selectedSerials,
  setSelectedSerials,
  activeSerial,
  searchText,
  onSearchTextChange,
  deviceSearchInputRef,
  groupFilter,
  onGroupFilterChange,
  groupOptions,
  groupMap,
  groupName,
  onGroupNameChange,
  groupPanelGroups,
  deviceSelectionMode,
  onSetDeviceSelectionMode,
  deviceItemInfoFieldIds,
  selectedDeviceItemInfoFieldSet,
  onResetDeviceItemInfoFields,
  onToggleDeviceItemInfoField,
  onRefreshDevices,
  onSelectAllVisible,
  onClearSelection,
  deviceQuickFilters,
  setDeviceQuickFilters,
  onClearDeviceFilters,
  hasDeviceFilters,
  deviceListRef,
  lastSelectedIndexRef,
  retentionMap,
  screenRecordStatusBySerial,
  screenRecordPendingBySerial,
  screenRecordStatusLoadingBySerial,
  deviceQuickActionStatusBySerial,
  onDeviceRowSelect,
  onToggleDevice,
  onSelectActiveSerial,
  onDismissRetainedDevice,
  onOpenDeviceQuickContextMenuFromKeyboard,
  onOpenDeviceQuickContextMenuFromPointer,
  deviceCommandStatusStack,
  onQuickScreenshot,
  screenshotDisabled,
  screenshotCommandLabel,
  onQuickScreenRecord,
  screenRecordDisabled,
  screenRecordCommandLabel,
  onOpenSelectedDeviceActionMenu,
  wifiEligibleCount,
  bluetoothEligibleCount,
  onScrcpyLaunch,
  hasSelectedAndroidActionTarget,
  mirrorCommandLabel,
  onOpenRunShell,
  onRequestRebootConfirm,
  rebootDisabled,
  rebootDirectCommandLabel,
  onAssignGroup,
  onAssignExistingGroup,
  onClearGroupAssignment,
  onApplyDeviceGroupFilter,
  onClearDeviceGroupFilter,
  deviceContextMenu,
  deviceContextMenuPosition,
  deviceContextMenuRef,
  onCloseDeviceContextMenu,
  deviceContextMenuHeaderTitle,
  deviceContextMenuHeaderSub,
  deviceContextMenuSections,
  deviceActionCatalogMap,
  onOpenDeviceInfoCopySubmenu,
  onOpenExternalPath,
  deviceContextSubmenu,
  deviceContextSubmenuPosition,
  deviceContextSubmenuRef,
  deviceContextMenuCopyItemsCount,
  onCopyDeviceInfoValue,
}: DevicesPageProps) {
  return (
    <div className="page-section page-section-stretch devices-workspace">
      <div className="page-header">
        <div>
          <h1>Device Manager</h1>
          <p className="muted">Organize devices, groups, and connection status.</p>
        </div>
        <div className="page-actions">
          <button className="ghost" onClick={onRefreshDevices} disabled={busy}>
            Refresh Devices
          </button>
        </div>
      </div>
      <section
        className={`panel panel-stretch logcat-panel device-manager-panel${deviceContextMenu ? " is-context-menu-open" : ""}`}
      >
        <div className="panel-header">
          <div>
            <h2>Devices</h2>
            <span>
              {connectedDevicesCount} connected · {devices.length} total
            </span>
          </div>
          <div className="device-panel-meta">
            <span className="badge">{visibleDevices.length} visible</span>
            <span className="badge">{selectedCount} selected</span>
            {busy && <span className="status-pill busy">Refreshing…</span>}
          </div>
        </div>
        <div className="device-manager-content">
          <div className="device-manager-main">
            <div className="device-filter-bar">
              <div className="device-filter-main">
                <input
                  ref={deviceSearchInputRef}
                  value={searchText}
                  onChange={(event) => onSearchTextChange(event.target.value)}
                  placeholder="Search by serial or model (/)"
                  aria-label="Search devices"
                />
                <select
                  value={groupFilter}
                  onChange={(event) => onGroupFilterChange(event.target.value)}
                  aria-label="Filter by group"
                >
                  <option value="all">All groups</option>
                  {groupOptions.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </div>
              <div className="device-filter-actions">
                <div
                  className="toggle-group device-selection-toggle"
                  role="group"
                  aria-label="Selection mode"
                >
                  <button
                    type="button"
                    className={`toggle${deviceSelectionMode === "single" ? " active" : ""}`}
                    onClick={() => onSetDeviceSelectionMode("single")}
                    disabled={busy}
                  >
                    Single
                  </button>
                  <button
                    type="button"
                    className={`toggle${deviceSelectionMode === "multi" ? " active" : ""}`}
                    onClick={() => onSetDeviceSelectionMode("multi")}
                    disabled={busy}
                  >
                    Multi
                  </button>
                </div>
                <details className="device-field-picker">
                  <summary aria-label="Customize device item info fields">
                    Fields
                    <span className="badge">{deviceItemInfoFieldIds.length}</span>
                  </summary>
                  <div className="device-field-picker-menu">
                    <div className="device-field-picker-header">
                      <strong>Item Info</strong>
                      <button
                        type="button"
                        className="ghost"
                        onClick={onResetDeviceItemInfoFields}
                        disabled={
                          deviceItemInfoFieldIds.length ===
                            DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS.length &&
                          DEFAULT_DEVICE_ITEM_INFO_FIELD_IDS.every(
                            (fieldId, index) => fieldId === deviceItemInfoFieldIds[index],
                          )
                        }
                      >
                        Reset
                      </button>
                    </div>
                    <div className="device-field-options">
                      {DEVICE_ITEM_INFO_FIELD_OPTIONS.map((field) => {
                        const checked = selectedDeviceItemInfoFieldSet.has(field.id);
                        const isLastChecked = checked && deviceItemInfoFieldIds.length <= 1;
                        return (
                          <label key={field.id} className="device-field-option">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isLastChecked}
                              title={
                                isLastChecked
                                  ? "At least one field must remain visible."
                                  : undefined
                              }
                              onChange={(event) =>
                                onToggleDeviceItemInfoField(field.id, event.target.checked)
                              }
                            />
                            <span>{field.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </details>
                <button onClick={onSelectAllVisible} disabled={busy}>
                  Select Visible
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={onClearSelection}
                  disabled={busy || devices.length === 0}
                  title={
                    devices.length === 0 ? "No devices detected." : "Keep one device selected."
                  }
                >
                  Keep One
                </button>
                <span className="device-selection-count muted">{selectedCount} selected</span>
              </div>
            </div>
            <DeviceQuickFilterBar
              activeFilters={deviceQuickFilters}
              onToggle={(id) =>
                setDeviceQuickFilters((prev) => toggleDeviceQuickFilter(prev, id))
              }
              onClearAll={onClearDeviceFilters}
              hasAnyFilter={hasDeviceFilters}
            />
            <div ref={deviceListRef} className="device-list device-list-stretch">
              <div className="device-list-header">
                <span />
                <span>Identity</span>
                <span>Info</span>
                <span>Status & Actions</span>
              </div>
              {visibleDevices.length === 0 ? (
                <div className="device-list-empty" role="status" aria-live="polite">
                  <strong>
                    {busy
                      ? "Refreshing devices…"
                      : devices.length === 0
                        ? "No devices connected"
                        : "No devices match the current filters"}
                  </strong>
                  <p className="muted">
                    {busy
                      ? "Please wait while the latest device status is loaded."
                      : devices.length === 0
                        ? "Connect a device or start an emulator, then refresh devices."
                        : "Adjust search text or group filter to broaden results."}
                  </p>
                  <div className="device-list-empty-actions">
                    {hasDeviceFilters && !busy && (
                      <button type="button" className="ghost" onClick={onClearDeviceFilters}>
                        Clear Filters
                      </button>
                    )}
                    {!busy && (
                      <button type="button" className="ghost" onClick={onRefreshDevices}>
                        Refresh Devices
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                visibleDevices.map((device, index) => {
                  const serial = device.summary.serial;
                  const detail = device.detail;
                  const devicePlatform = getDevicePlatform(device);
                  const modelLabel =
                    detail?.device_name ?? detail?.model ?? device.summary.model ?? serial;
                  const secondaryLabel =
                    detail?.name && detail.name !== modelLabel ? detail.name : serial;
                  const showSecondaryLabel = secondaryLabel !== modelLabel;
                  const showSerialMeta = serial !== modelLabel && serial !== secondaryLabel;
                  const itemInfoFields = buildDeviceItemInfoFields(device, deviceItemInfoFieldIds);
                  const groupLabel = groupMap[serial] ?? null;
                  const isSelected = selectedSerials.includes(serial);
                  const isActive = serial === activeSerial;
                  const displayStatus = resolveDeviceDisplayStatus(device, retentionMap[serial]);
                  const isRetained = displayStatus.isRetained;
                  const screenRecordDeviceStatus = buildScreenRecordDeviceStatus(
                    serial,
                    screenRecordStatusBySerial[serial],
                    screenRecordPendingBySerial[serial],
                    screenRecordStatusLoadingBySerial[serial] === true,
                  );
                  const deviceQuickActionStatus = buildDeviceQuickActionDeviceStatus(
                    deviceQuickActionStatusBySerial[serial],
                  );
                  return (
                    <div
                      key={serial}
                      className={`device-row${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}${isRetained ? " is-retained" : ""}`}
                      data-device-row-index={index}
                      data-device-state={device.summary.state}
                      onClick={(event) => onDeviceRowSelect(event, serial, index)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        const target = event.target as HTMLElement | null;
                        if (
                          target?.closest(".device-check") ||
                          target?.closest(".device-primary-action")
                        ) {
                          return;
                        }
                        const mod = event.ctrlKey || event.metaKey;
                        if (mod && event.key.toLowerCase() === "a") {
                          event.preventDefault();
                          if (event.shiftKey) {
                            onClearSelection();
                          } else {
                            onSelectAllVisible();
                          }
                          return;
                        }
                        const nextIdx = getNextKeyboardDeviceIndex(
                          index,
                          event.key,
                          visibleDevices.length,
                        );
                        if (nextIdx !== null) {
                          event.preventDefault();
                          const nextRow = deviceListRef.current?.querySelector<HTMLElement>(
                            `[data-device-row-index="${nextIdx}"]`,
                          );
                          nextRow?.focus();
                          return;
                        }
                        if (event.key === " " || event.key === "Enter") {
                          event.preventDefault();
                          if (deviceSelectionMode === "multi") {
                            onToggleDevice(serial);
                          } else {
                            setSelectedSerials([serial]);
                            onSelectActiveSerial(serial);
                          }
                          lastSelectedIndexRef.current = index;
                          return;
                        }
                        onOpenDeviceQuickContextMenuFromKeyboard(event, serial, {
                          source: "device_manager",
                          rowIndex: index,
                        });
                      }}
                      onContextMenu={(event) =>
                        onOpenDeviceQuickContextMenuFromPointer(event, serial, {
                          source: "device_manager",
                          rowIndex: index,
                          showSelectionHint: true,
                        })
                      }
                    >
                      <label className="device-check" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (deviceSelectionMode === "multi") {
                              onToggleDevice(serial);
                            } else {
                              setSelectedSerials((prev) =>
                                prev.length === 1 && prev[0] === serial ? prev : [serial],
                              );
                            }
                            lastSelectedIndexRef.current = index;
                          }}
                          onChange={() => {}}
                        />
                      </label>
                      <div className="device-cell device-identity">
                        <div className="device-identity-main">
                          <div className="device-identity-heading">
                            <strong>{modelLabel}</strong>
                            <span className="badge">
                              {devicePlatform === "ios" ? "iOS" : "Android"}
                            </span>
                            {isActive && <span className="device-active-badge">Primary</span>}
                            {groupLabel && <span className="group-tag">{groupLabel}</span>}
                          </div>
                          {showSecondaryLabel && (
                            <div className="device-identity-sub">
                              <span>{secondaryLabel}</span>
                            </div>
                          )}
                        </div>
                        {showSerialMeta && (
                          <div className="device-identity-meta">
                            <span className="device-serial">{serial}</span>
                          </div>
                        )}
                        {devicePlatform === "ios" && (
                          <div className="device-identity-meta">
                            <span className="muted">
                              {formatIosTrustLabel(device) ??
                                (config?.device.ios_auto_refresh_enabled
                                  ? "iOS · auto-refresh on"
                                  : "iOS · manual refresh")}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="device-cell device-capability">
                        <div
                          className="device-info-fields"
                          aria-label={`${modelLabel} device info`}
                        >
                          {itemInfoFields.map((field) => (
                            <span
                              key={field.id}
                              className={`device-info-field device-info-field-${field.id}`}
                            >
                              <span className="device-info-label">{field.label}</span>
                              <span className="device-info-value" title={field.value}>
                                {field.value}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="device-cell device-status-actions">
                        <div className="device-state">
                          <span
                            className={`status-pill ${displayStatus.tone}`}
                            title={displayStatus.title}
                          >
                            {displayStatus.kind === "rebooting" ? (
                              <span className="rebooting-indicator">
                                <span className="pulse-dot" />
                                {displayStatus.label}
                              </span>
                            ) : (
                              displayStatus.label
                            )}
                          </span>
                          {screenRecordDeviceStatus && (
                            <span
                              className={`status-pill screen-record-status ${screenRecordDeviceStatus.tone}`}
                              title={screenRecordDeviceStatus.title}
                            >
                              {screenRecordDeviceStatus.label}
                            </span>
                          )}
                          {deviceQuickActionStatus && (
                            <span
                              className={`status-pill device-quick-action-status ${deviceQuickActionStatus.tone}`}
                              title={deviceQuickActionStatus.title}
                            >
                              {deviceQuickActionStatus.label}
                            </span>
                          )}
                        </div>
                        <div className="device-actions">
                          {isRetained ? (
                            <button
                              type="button"
                              className="ghost danger-text"
                              onClick={(event) => {
                                event.stopPropagation();
                                onDismissRetainedDevice(serial);
                              }}
                              title="Dismiss offline device from list"
                            >
                              Dismiss
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={`ghost device-primary-action${isActive ? " is-primary" : ""}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!isActive) {
                                  onSelectActiveSerial(serial);
                                }
                              }}
                              disabled={busy || isActive}
                              aria-label={
                                isActive
                                  ? `${modelLabel} is primary device`
                                  : `Set ${modelLabel} as primary device`
                              }
                              title={isActive ? "Primary device" : "Set as primary device"}
                            >
                              {isActive ? "Primary" : "Set Primary"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="ghost icon-only"
                            onClick={(e) => {
                              onOpenDeviceQuickContextMenuFromPointer(e, serial, {
                                source: "device_manager",
                                rowIndex: index,
                              });
                            }}
                            disabled={busy}
                            title="Device actions"
                          >
                            ⋯
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {selectedCount > 0 && (
              <div
                className="device-command-bar"
                role="region"
                aria-label="Selected device actions"
              >
                <div className="device-command-summary">
                  <strong>{selectedCount} selected</strong>
                  <span className="muted">
                    {selectedOnlineCount}/{selectedCount} online
                  </span>
                  {deviceCommandStatusStack.length > 0 && (
                    <div className="device-command-status-stack" aria-live="polite">
                      {deviceCommandStatusStack.map((status) => (
                        <span
                          key={status.id}
                          className={`device-command-status ${
                            status.id === "quick-action"
                              ? "device-quick-action-command-status"
                              : "screen-record-command-status"
                          } ${status.tone}`}
                        >
                          {status.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="button-row device-command-actions">
                  <button
                    type="button"
                    onClick={() => void onQuickScreenshot()}
                    disabled={screenshotDisabled}
                  >
                    {screenshotCommandLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onQuickScreenRecord()}
                    disabled={screenRecordDisabled}
                  >
                    {screenRecordCommandLabel}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={(event) =>
                      onOpenSelectedDeviceActionMenu(event, ["wifi_enable", "wifi_disable"])
                    }
                    disabled={busy || selectedCount === 0 || wifiEligibleCount === 0}
                  >
                    WiFi…
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={(event) =>
                      onOpenSelectedDeviceActionMenu(event, [
                        "bluetooth_enable",
                        "bluetooth_disable",
                      ])
                    }
                    disabled={busy || selectedCount === 0 || bluetoothEligibleCount === 0}
                  >
                    Bluetooth…
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void onScrcpyLaunch()}
                    disabled={busy || selectedCount === 0 || !hasSelectedAndroidActionTarget}
                  >
                    {mirrorCommandLabel}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={onOpenRunShell}
                    disabled={busy || selectedCount === 0 || !hasSelectedAndroidActionTarget}
                  >
                    Run Shell
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={onRequestRebootConfirm}
                    disabled={rebootDisabled}
                  >
                    {rebootDirectCommandLabel}
                  </button>
                </div>
              </div>
            )}
          </div>

          <DeviceGroupPanel
            busy={busy}
            selectedDevices={selectedDevices}
            selectedCount={selectedCount}
            selectedOnlineCount={selectedOnlineCount}
            groupMap={groupMap}
            groupName={groupName}
            groupFilter={groupFilter}
            groups={groupPanelGroups}
            onGroupNameChange={onGroupNameChange}
            onAssignGroup={() => void onAssignGroup()}
            onAssignExistingGroup={onAssignExistingGroup}
            onClearAssignment={() => void onClearGroupAssignment()}
            onApplyFilter={onApplyDeviceGroupFilter}
            onClearFilter={onClearDeviceGroupFilter}
          />
        </div>
        {deviceContextMenu &&
          typeof document !== "undefined" &&
          createPortal(
            <>
              <div className="context-menu-backdrop" onClick={onCloseDeviceContextMenu} />
              <div
                ref={deviceContextMenuRef}
                className="context-menu context-menu-scrollable"
                style={{
                  top: deviceContextMenuPosition?.top ?? deviceContextMenu.y,
                  left: deviceContextMenuPosition?.left ?? deviceContextMenu.x,
                  maxHeight: deviceContextMenuPosition?.maxHeight,
                  width: 230,
                }}
              >
                <div className="context-menu-header">
                  <span className="context-menu-header-title">
                    {deviceContextMenuHeaderTitle}
                  </span>
                  <span className="context-menu-header-sub">{deviceContextMenuHeaderSub}</span>
                </div>
                {deviceContextMenuSections.map((section, index) => (
                  <div key={section.id}>
                    {index > 0 && <div className="context-menu-sep" />}
                    <div className="context-menu-section-label">{section.title}</div>
                    {section.actions.map((action) => {
                      const catalogAction = deviceActionCatalogMap.get(action.id);
                      const disabled =
                        action.disabled ||
                        (action.id === "open_output" && !deviceContextMenu.outputPath) ||
                        (!catalogAction && action.id !== "open_output");
                      const hasSubmenu = action.id === "copy_device_info";
                      return (
                        <button
                          key={action.id}
                          type="button"
                          className={`context-menu-item${action.tone === "danger" ? " danger" : ""}${hasSubmenu ? " has-submenu" : ""}`}
                          onClick={(event) => {
                            if (hasSubmenu) {
                              event.stopPropagation();
                              onOpenDeviceInfoCopySubmenu(event.currentTarget);
                              return;
                            }
                            if (action.id === "open_output") {
                              if (deviceContextMenu.outputPath) {
                                void onOpenExternalPath(deviceContextMenu.outputPath);
                              }
                            } else {
                              catalogAction?.onSelect();
                            }
                            onCloseDeviceContextMenu();
                          }}
                          disabled={disabled}
                        >
                          {hasSubmenu ? (
                            <>
                              <span className="context-menu-item-label">{action.label}</span>
                              <span className="context-menu-item-caret" aria-hidden="true">
                                ›
                              </span>
                            </>
                          ) : (
                            action.label
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              {deviceContextSubmenu && (
                <div
                  ref={deviceContextSubmenuRef}
                  className="context-menu context-menu-submenu"
                  style={{
                    top: deviceContextSubmenuPosition?.top ?? deviceContextSubmenu.y,
                    left: deviceContextSubmenuPosition?.left ?? deviceContextSubmenu.x,
                    maxHeight: deviceContextSubmenuPosition?.maxHeight,
                    width: 250,
                  }}
                >
                  <div className="context-menu-header">
                    <span className="context-menu-header-title">{deviceContextSubmenu.title}</span>
                    <span className="context-menu-header-sub">
                      {deviceContextMenuCopyItemsCount
                        ? `${deviceContextMenuCopyItemsCount} copy options`
                        : "Copy individual fields"}
                    </span>
                  </div>
                  {deviceContextSubmenu.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="context-menu-item"
                      onClick={() => {
                        void onCopyDeviceInfoValue(
                          item.value,
                          item.id === "all" ? "Device info copied." : `${item.label} copied.`,
                        );
                        onCloseDeviceContextMenu();
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </>,
            document.body,
          )}
      </section>
    </div>
  );
});
