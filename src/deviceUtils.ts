import type { AppConfig, DeviceDetail, DeviceInfo } from "./types";
import { formatBytes } from "./perf";

type DeviceDetailPatch = Partial<Omit<DeviceDetail, "serial">>;
type DeviceValue = string | number | boolean | null | undefined;
type ConnectivityFlagKey = "wifi_is_on" | "bt_is_on";
type TopbarTone = "ok" | "error" | "warn";
export type DeviceQuickMenuSource = "device_manager" | "quick_actions" | "task";
export type DeviceContextMenuScopeKind = "single" | "multi";
export type DeviceContextActionId =
  | "set_primary"
  | "copy_device_info"
  | "open_output"
  | "screenshot"
  | "record"
  | "reboot"
  | "wifi_enable"
  | "wifi_disable"
  | "bluetooth_enable"
  | "bluetooth_disable"
  | "logcat_clear"
  | "mirror"
  | "apk_installer";
export type DeviceContextActionSectionId =
  | "selection"
  | "capture"
  | "control"
  | "connectivity"
  | "debug"
  | "more";
export type DeviceContextActionScope = "single" | "multi" | "both";
export type DeviceContextActionTone = "danger";
export type DeviceQuickMenuAction = {
  id: DeviceContextActionId;
  label: string;
  section: DeviceContextActionSectionId;
  scope: DeviceContextActionScope;
  disabled?: boolean;
  hint?: string;
  description?: string;
  tone?: DeviceContextActionTone;
  hideWhenOutOfScope?: boolean;
};
export type DeviceQuickMenuSection = {
  id: DeviceContextActionSectionId;
  title: string;
  actions: DeviceQuickMenuAction[];
};
export type DeviceQuickMenuSelection = {
  scopeKind: DeviceContextMenuScopeKind;
  selectedSerials: string[];
  primarySerial: string;
};
export type DeviceGroupOption = {
  name: string;
  count: number;
  isActiveFilter: boolean;
};
export type DeviceGroupSelectionSummary = {
  kind: "none" | "single" | "multi";
  groupState: "ungrouped" | "single_group" | "mixed";
  groupName: string | null;
  selectedCount: number;
  assignedCount: number;
  canClear: boolean;
};
export type TopbarOverview = {
  selectedCount: number;
  onlineSelectedCount: number;
  primaryLabel: string;
  primaryTone: TopbarTone;
};
type ContextMenuPositionParams = {
  anchorX: number;
  anchorY: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
};

const DEVICE_CONTEXT_SECTION_ORDER: DeviceContextActionSectionId[] = [
  "selection",
  "capture",
  "control",
  "connectivity",
  "debug",
  "more",
];

const DEVICE_CONTEXT_SECTION_TITLE: Record<DeviceContextActionSectionId, string> = {
  selection: "Selection",
  capture: "Capture",
  control: "Control",
  connectivity: "Connectivity",
  debug: "Debug",
  more: "More",
};

const formatDeviceValue = (value: DeviceValue): string => {
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }
  if (typeof value === "boolean") {
    return value ? "On" : "Off";
  }
  return String(value);
};

export const resolveSelectedSerials = (previous: string[], devices: DeviceInfo[]): string[] => {
  if (!devices.length) {
    return [];
  }
  const stillValid = previous.filter((serial) =>
    devices.some((device) => device.summary.serial === serial),
  );
  if (stillValid.length > 0) {
    return stillValid;
  }
  const preferred = devices.find((device) => device.summary.state === "device") ?? devices[0];
  return preferred ? [preferred.summary.serial] : [];
};

export const resolvePrimarySerial = (selectedSerials: string[]): string | null => {
  return selectedSerials[0] ?? null;
};

export const formatPrimaryDeviceLabel = (
  serial: string | null | undefined,
  device: DeviceInfo | null | undefined,
): string => {
  if (!serial) {
    return "Unknown device";
  }
  const name = device?.detail?.model ?? device?.summary.model ?? "";
  if (!name || name === serial) {
    return serial;
  }
  return `${name} (${serial})`;
};

export const reduceSelectionToOne = (previous: string[], devices: DeviceInfo[]): string[] => {
  if (!devices.length) {
    return [];
  }
  const primary = previous[0];
  if (primary && devices.some((device) => device.summary.serial === primary)) {
    return [primary];
  }
  const preferred = devices.find((device) => device.summary.state === "device") ?? devices[0];
  return preferred ? [preferred.summary.serial] : [];
};

export const setPrimarySelection = (previous: string[], serial: string): string[] => {
  if (previous[0] === serial) {
    return previous;
  }
  const others = previous.filter((item) => item !== serial);
  return [serial, ...others];
};

export const formatDeviceInfoMarkdown = (device: DeviceInfo): string => {
  const detail = device.detail;
  const lines = [
    `- **Serial:** ${formatDeviceValue(device.summary.serial)}`,
    `- **State:** ${formatDeviceValue(device.summary.state)}`,
    `- **Name:** ${formatDeviceValue(detail?.name)}`,
    `- **Brand:** ${formatDeviceValue(detail?.brand)}`,
    `- **Model:** ${formatDeviceValue(detail?.model ?? device.summary.model)}`,
    `- **Serial Number:** ${formatDeviceValue(detail?.serial_number)}`,
    `- **Android:** ${formatDeviceValue(detail?.android_version)}`,
    `- **API:** ${formatDeviceValue(detail?.api_level)}`,
    `- **Processor:** ${formatDeviceValue(detail?.processor)}`,
    `- **Resolution:** ${formatDeviceValue(detail?.resolution)}`,
    `- **Storage:** ${
      detail?.storage_total_bytes != null ? formatBytes(detail.storage_total_bytes) : "Unknown"
    }`,
    `- **Memory:** ${
      detail?.memory_total_bytes != null ? formatBytes(detail.memory_total_bytes) : "Unknown"
    }`,
    `- **WiFi:** ${formatDeviceValue(detail?.wifi_is_on)}`,
    `- **Bluetooth:** ${formatDeviceValue(detail?.bt_is_on)}`,
    `- **GMS:** ${formatDeviceValue(detail?.gms_version)}`,
    `- **Fingerprint:** ${formatDeviceValue(detail?.build_fingerprint)}`,
  ];
  return lines.join("\n");
};

export const mergeDeviceDetails = (
  current: DeviceInfo[],
  incoming: DeviceInfo[],
  options: { preserveMissingDetail?: boolean } = {},
): DeviceInfo[] => {
  if (!incoming.length) {
    return [];
  }
  if (!current.length) {
    return incoming;
  }

  const currentBySerial = new Map(current.map((device) => [device.summary.serial, device]));
  const preserveMissingDetail = options.preserveMissingDetail ?? false;

  return incoming.map((device) => {
    const existing = currentBySerial.get(device.summary.serial);
    return {
      summary: device.summary,
      detail: device.detail ?? (preserveMissingDetail ? existing?.detail : null) ?? null,
    };
  });
};

export const applyDeviceDetailPatch = (
  devices: DeviceInfo[],
  serials: string[],
  patch: DeviceDetailPatch,
): DeviceInfo[] => {
  if (!devices.length || !serials.length) {
    return devices;
  }
  const targetSerials = new Set(serials);
  return devices.map((device) => {
    if (!targetSerials.has(device.summary.serial)) {
      return device;
    }
    const baseDetail: DeviceDetail = {
      serial: device.summary.serial,
      ...(device.detail ?? {}),
    };
    return {
      ...device,
      detail: {
        ...baseDetail,
        ...patch,
        serial: device.summary.serial,
      },
    };
  });
};

export const filterDevicesBySearch = (devices: DeviceInfo[], searchText: string): DeviceInfo[] => {
  const search = searchText.trim().toLowerCase();
  if (!search) {
    return devices;
  }
  return devices.filter((device) => {
    const serial = device.summary.serial;
    const model = device.detail?.model ?? device.summary.model ?? "";
    return serial.toLowerCase().includes(search) || model.toLowerCase().includes(search);
  });
};

export const selectSerialsForGroup = (
  devices: DeviceInfo[],
  groupMap: Record<string, string>,
  group: string,
): string[] => {
  const serials = devices.map((device) => device.summary.serial);
  if (group === "__all_devices__") {
    return serials;
  }
  return serials.filter((serial) => groupMap[serial] === group);
};

export const applyGroupAssignment = (
  groupMap: Record<string, string>,
  serials: string[],
  groupName: string,
): Record<string, string> => {
  if (!serials.length) {
    return groupMap;
  }

  const next = { ...groupMap };
  for (const serial of serials) {
    if (groupName) {
      next[serial] = groupName;
    } else {
      delete next[serial];
    }
  }
  return next;
};

export const flattenDeviceGroups = (groups: Record<string, string[]>): Record<string, string> => {
  const map: Record<string, string> = {};
  Object.entries(groups || {}).forEach(([group, serials]) => {
    serials.forEach((serial) => {
      map[serial] = group;
    });
  });
  return map;
};

export const expandDeviceGroups = (map: Record<string, string>): Record<string, string[]> => {
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
};

export const buildDeviceGroupOptions = (
  groupMap: Record<string, string>,
  activeFilter: string,
): DeviceGroupOption[] =>
  Object.entries(expandDeviceGroups(groupMap))
    .map(([name, serials]) => ({
      name,
      count: serials.length,
      isActiveFilter: activeFilter === name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

export const buildDeviceGroupSelectionSummary = (
  selectedSerials: string[],
  groupMap: Record<string, string>,
): DeviceGroupSelectionSummary => {
  if (!selectedSerials.length) {
    return {
      kind: "none",
      groupState: "ungrouped",
      groupName: null,
      selectedCount: 0,
      assignedCount: 0,
      canClear: false,
    };
  }

  const selectedGroups = selectedSerials
    .map((serial) => groupMap[serial] ?? null)
    .filter((group): group is string => Boolean(group));
  const distinctGroups = Array.from(new Set(selectedGroups));
  const assignedCount = selectedGroups.length;
  const canClear = assignedCount > 0;

  if (selectedSerials.length === 1) {
    return {
      kind: "single",
      groupState: distinctGroups.length === 1 ? "single_group" : "ungrouped",
      groupName: distinctGroups[0] ?? null,
      selectedCount: 1,
      assignedCount,
      canClear,
    };
  }

  if (assignedCount === 0) {
    return {
      kind: "multi",
      groupState: "ungrouped",
      groupName: null,
      selectedCount: selectedSerials.length,
      assignedCount: 0,
      canClear: false,
    };
  }

  if (assignedCount === selectedSerials.length && distinctGroups.length === 1) {
    return {
      kind: "multi",
      groupState: "single_group",
      groupName: distinctGroups[0] ?? null,
      selectedCount: selectedSerials.length,
      assignedCount,
      canClear: true,
    };
  }

  return {
    kind: "multi",
    groupState: "mixed",
    groupName: null,
    selectedCount: selectedSerials.length,
    assignedCount,
    canClear,
  };
};

export const withDeviceGroups = (
  config: AppConfig,
  groupMap: Record<string, string>,
): AppConfig => ({
  ...config,
  device_groups: expandDeviceGroups(groupMap),
});

export const resolveDeviceQuickMenuSelection = ({
  source,
  clickedSerial,
  selectedSerials,
}: {
  source: DeviceQuickMenuSource;
  clickedSerial: string;
  selectedSerials: string[];
}): DeviceQuickMenuSelection => {
  if (source === "task") {
    return {
      scopeKind: "single",
      selectedSerials: [clickedSerial],
      primarySerial: clickedSerial,
    };
  }

  if (selectedSerials.includes(clickedSerial) && selectedSerials.length > 1) {
    return {
      scopeKind: "multi",
      selectedSerials,
      primarySerial: selectedSerials[0] ?? clickedSerial,
    };
  }

  return {
    scopeKind: "single",
    selectedSerials: [clickedSerial],
    primarySerial: clickedSerial,
  };
};

const isActionOutOfScope = (
  scopeKind: DeviceContextMenuScopeKind,
  actionScope: DeviceContextActionScope,
): boolean => {
  if (actionScope === "both") {
    return false;
  }
  return actionScope !== scopeKind;
};

const buildTaskQuickMenuActions = (outputPath?: string | null): DeviceQuickMenuAction[] => {
  const actions: DeviceQuickMenuAction[] = [
    {
      id: "set_primary",
      label: "Set Primary",
      section: "selection",
      scope: "single",
    },
    {
      id: "copy_device_info",
      label: "Copy Device Info",
      section: "selection",
      scope: "single",
    },
  ];
  if (outputPath?.trim()) {
    actions.push({
      id: "open_output",
      label: "Open Output",
      section: "selection",
      scope: "single",
    });
  }
  return actions;
};

export const buildDeviceQuickMenuActions = ({
  source,
  scopeKind,
  actions,
  outputPath,
}: {
  source: DeviceQuickMenuSource;
  scopeKind: DeviceContextMenuScopeKind;
  actions: DeviceQuickMenuAction[];
  outputPath?: string | null;
}): DeviceQuickMenuSection[] => {
  const rawActions =
    actions.length > 0 ? actions : source === "task" ? buildTaskQuickMenuActions(outputPath) : [];

  const grouped = new Map<DeviceContextActionSectionId, DeviceQuickMenuAction[]>();

  rawActions.forEach((action) => {
    if (isActionOutOfScope(scopeKind, action.scope)) {
      if (action.hideWhenOutOfScope) {
        return;
      }
      const scopedAction: DeviceQuickMenuAction = {
        id: action.id,
        label: action.label,
        section: action.section,
        scope: action.scope,
        ...(action.description ? { description: action.description } : {}),
        ...(action.hint ? { hint: action.hint } : {}),
        ...(action.tone ? { tone: action.tone } : {}),
        disabled: true,
      };
      const items = grouped.get(action.section) ?? [];
      items.push(scopedAction);
      grouped.set(action.section, items);
      return;
    }

    const scopedAction: DeviceQuickMenuAction = {
      id: action.id,
      label: action.label,
      section: action.section,
      scope: action.scope,
      ...(action.description ? { description: action.description } : {}),
      ...(action.hint ? { hint: action.hint } : {}),
      ...(action.tone ? { tone: action.tone } : {}),
      ...(action.disabled ? { disabled: true } : {}),
    };
    const items = grouped.get(action.section) ?? [];
    items.push(scopedAction);
    grouped.set(action.section, items);
  });

  return DEVICE_CONTEXT_SECTION_ORDER.flatMap((sectionId) => {
    const sectionActions = grouped.get(sectionId) ?? [];
    if (!sectionActions.length) {
      return [];
    }
    return [
      {
        id: sectionId,
        title: DEVICE_CONTEXT_SECTION_TITLE[sectionId],
        actions: sectionActions,
      },
    ];
  });
};

export const computeContextMenuPosition = ({
  anchorX,
  anchorY,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  margin = 10,
}: ContextMenuPositionParams): { top: number; left: number } => {
  const safeWidth = Math.max(1, menuWidth);
  const safeHeight = Math.max(1, menuHeight);
  const safeMargin = Math.max(0, margin);

  let left = anchorX;
  let top = anchorY;

  if (left + safeWidth + safeMargin > viewportWidth) {
    left = anchorX - safeWidth;
  }
  if (top + safeHeight + safeMargin > viewportHeight) {
    top = anchorY - safeHeight;
  }

  const maxLeft = Math.max(safeMargin, viewportWidth - safeWidth - safeMargin);
  const maxTop = Math.max(safeMargin, viewportHeight - safeHeight - safeMargin);

  left = Math.min(Math.max(left, safeMargin), maxLeft);
  top = Math.min(Math.max(top, safeMargin), maxTop);

  return {
    top: Math.round(top),
    left: Math.round(left),
  };
};

export const shouldEnableConnectivityForSelection = (
  devices: DeviceInfo[],
  selectedSerials: string[],
  key: ConnectivityFlagKey,
): boolean => {
  if (!selectedSerials.length) {
    return true;
  }
  const deviceBySerial = new Map(devices.map((device) => [device.summary.serial, device]));
  for (const serial of selectedSerials) {
    const value = deviceBySerial.get(serial)?.detail?.[key];
    if (value !== true) {
      return true;
    }
  }
  return false;
};

const toTopbarTone = (state: string | undefined): TopbarTone => {
  if (state === "device") {
    return "ok";
  }
  if (state === "unauthorized") {
    return "error";
  }
  return "warn";
};

export const buildTopbarOverview = (
  devices: DeviceInfo[],
  selectedSerials: string[],
  activeSerial: string | null,
): TopbarOverview => {
  const selectedCount = selectedSerials.length;
  const deviceBySerial = new Map(devices.map((device) => [device.summary.serial, device]));
  const onlineSelectedCount = selectedSerials.reduce((count, serial) => {
    return count + (deviceBySerial.get(serial)?.summary.state === "device" ? 1 : 0);
  }, 0);

  const primaryDevice = activeSerial ? deviceBySerial.get(activeSerial) : undefined;
  const primaryLabel =
    primaryDevice?.detail?.model ?? primaryDevice?.summary.model ?? primaryDevice?.summary.serial ?? "None";
  const primaryTone = toTopbarTone(primaryDevice?.summary.state);

  return {
    selectedCount,
    onlineSelectedCount,
    primaryLabel,
    primaryTone,
  };
};
