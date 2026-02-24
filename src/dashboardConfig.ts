import type {
  DashboardCardId,
  DashboardCardPreference,
  DashboardFieldId,
  DashboardFieldPreference,
  DashboardSettings,
  DeviceInfo,
} from "./types";
import { formatBytes } from "./perf";

export type DashboardValueVariant = {
  serial: string;
  value: string;
};

export type DashboardFieldView = {
  id: DashboardFieldId;
  label: string;
  value: string;
  variants: DashboardValueVariant[];
};

export type DashboardCardView = {
  id: DashboardCardId;
  title: string;
  description: string;
  fields: DashboardFieldView[];
};

export type DashboardAggregationInput = {
  devices: DeviceInfo[];
  selectedSerials: string[];
  activeSerial?: string | null;
  runningTaskCount: number;
  selectedConnectedCount: number;
  adbAvailable?: boolean | null;
  scrcpyAvailable?: boolean | null;
};

const DASHBOARD_CARDS: Array<{
  id: DashboardCardId;
  title: string;
  description: string;
  fields: DashboardFieldId[];
}> = [
  {
    id: "overview",
    title: "Overview",
    description: "Selection and execution summary.",
    fields: [
      "selected_count",
      "online_count",
      "unauthorized_count",
      "offline_count",
      "primary_device",
      "running_tasks",
    ],
  },
  {
    id: "device_profile",
    title: "Device Profile",
    description: "Core hardware and Android profile.",
    fields: ["brand", "model", "android_version", "api_level", "processor", "resolution"],
  },
  {
    id: "capacity_battery",
    title: "Capacity & Battery",
    description: "Battery, memory, storage, and radios.",
    fields: ["battery_level", "memory_total", "storage_total", "wifi_state", "bt_state", "gms_version"],
  },
  {
    id: "connection_health",
    title: "Connection Health",
    description: "Host tooling and selected device readiness.",
    fields: ["adb_status", "scrcpy_status", "selected_connected", "selected_ready_ratio"],
  },
];

const FIELD_LABELS: Record<DashboardFieldId, string> = {
  selected_count: "Selected",
  online_count: "Online",
  unauthorized_count: "Unauthorized",
  offline_count: "Offline",
  primary_device: "Primary Device",
  running_tasks: "Tasks",
  brand: "Brand",
  model: "Model",
  android_version: "Android",
  api_level: "API",
  processor: "Processor",
  resolution: "Resolution",
  battery_level: "Battery",
  memory_total: "Memory",
  storage_total: "Storage",
  wifi_state: "WiFi",
  bt_state: "Bluetooth",
  gms_version: "GMS",
  adb_status: "ADB",
  scrcpy_status: "scrcpy",
  selected_connected: "Connected",
  selected_ready_ratio: "Ready Ratio",
};

export const getDashboardFieldLabel = (fieldId: DashboardFieldId): string =>
  FIELD_LABELS[fieldId] ?? fieldId;

const CARD_META_BY_ID = new Map(DASHBOARD_CARDS.map((card) => [card.id, card]));
const FIELD_TO_CARD = new Map<DashboardFieldId, DashboardCardId>();
DASHBOARD_CARDS.forEach((card) => {
  card.fields.forEach((field) => {
    FIELD_TO_CARD.set(field, card.id);
  });
});

const compareByOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

const formatOptional = (value: unknown): string => {
  if (value == null) {
    return "--";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : "--";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "--";
  }
  return String(value);
};

const formatBooleanState = (value: boolean | null | undefined): string => {
  if (value == null) {
    return "Unknown";
  }
  return value ? "On" : "Off";
};

const buildDefaultFieldPrefs = (fields: DashboardFieldId[]): DashboardFieldPreference[] =>
  fields.map((id, index) => ({ id, enabled: true, order: index }));

const buildDefaultCardPref = (
  card: (typeof DASHBOARD_CARDS)[number],
  order: number,
): DashboardCardPreference => ({
  id: card.id,
  enabled: true,
  order,
  fields: buildDefaultFieldPrefs(card.fields),
});

export const buildDefaultDashboardSettings = (): DashboardSettings => ({
  cards: DASHBOARD_CARDS.map((card, index) => buildDefaultCardPref(card, index)),
});

const normalizeFields = (
  cardId: DashboardCardId,
  fields: DashboardFieldPreference[] | undefined,
): DashboardFieldPreference[] => {
  const cardMeta = CARD_META_BY_ID.get(cardId);
  if (!cardMeta) {
    return [];
  }

  const inputMap = new Map<DashboardFieldId, DashboardFieldPreference>();
  (fields ?? []).forEach((field) => {
    if (FIELD_TO_CARD.get(field.id) !== cardId) {
      return;
    }
    inputMap.set(field.id, field);
  });

  return cardMeta.fields
    .map((fieldId, index) => {
      const incoming = inputMap.get(fieldId);
      return {
        id: fieldId,
        enabled: incoming?.enabled ?? true,
        order: Number.isFinite(incoming?.order) ? Number(incoming?.order) : index,
      };
    })
    .sort(compareByOrder)
    .map((field, index) => ({ ...field, order: index }));
};

export const normalizeDashboardSettings = (
  settings?: DashboardSettings | null,
): DashboardSettings => {
  const defaults = buildDefaultDashboardSettings();
  if (!settings || !Array.isArray(settings.cards)) {
    return defaults;
  }

  const cardMap = new Map<DashboardCardId, DashboardCardPreference>();
  settings.cards.forEach((card) => {
    if (!CARD_META_BY_ID.has(card.id)) {
      return;
    }
    cardMap.set(card.id, card);
  });

  const cards = defaults.cards
    .map((card, index) => {
      const incoming = cardMap.get(card.id);
      return {
        id: card.id,
        enabled: incoming?.enabled ?? card.enabled,
        order: Number.isFinite(incoming?.order) ? Number(incoming?.order) : index,
        fields: normalizeFields(card.id, incoming?.fields),
      };
    })
    .sort(compareByOrder)
    .map((card, index) => ({ ...card, order: index }));

  return { cards };
};

export const toggleDashboardField = (
  settings: DashboardSettings,
  cardId: DashboardCardId,
  fieldId: DashboardFieldId,
  enabled: boolean,
): DashboardSettings => {
  const normalized = normalizeDashboardSettings(settings);
  return {
    cards: normalized.cards.map((card) => {
      if (card.id !== cardId) {
        return card;
      }
      return {
        ...card,
        fields: card.fields.map((field) =>
          field.id === fieldId ? { ...field, enabled } : field,
        ),
      };
    }),
  };
};

export const moveDashboardField = (
  settings: DashboardSettings,
  cardId: DashboardCardId,
  fieldId: DashboardFieldId,
  direction: "up" | "down",
): DashboardSettings => {
  const normalized = normalizeDashboardSettings(settings);
  return {
    cards: normalized.cards.map((card) => {
      if (card.id !== cardId) {
        return card;
      }
      const sorted = [...card.fields].sort(compareByOrder);
      const index = sorted.findIndex((field) => field.id === fieldId);
      if (index < 0) {
        return card;
      }
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= sorted.length) {
        return card;
      }
      const next = [...sorted];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return {
        ...card,
        fields: next.map((field, order) => ({ ...field, order })),
      };
    }),
  };
};

export const toggleDashboardCard = (
  settings: DashboardSettings,
  cardId: DashboardCardId,
  enabled: boolean,
): DashboardSettings => {
  const normalized = normalizeDashboardSettings(settings);
  return {
    cards: normalized.cards.map((card) =>
      card.id === cardId ? { ...card, enabled } : card,
    ),
  };
};

const selectedDevicesFromSerials = (devices: DeviceInfo[], selectedSerials: string[]) => {
  const bySerial = new Map(devices.map((device) => [device.summary.serial, device]));
  return selectedSerials
    .map((serial) => bySerial.get(serial))
    .filter((device): device is DeviceInfo => Boolean(device));
};

const aggregateSelectedValues = (
  selectedDevices: DeviceInfo[],
  resolver: (device: DeviceInfo) => string,
): { value: string; variants: DashboardValueVariant[] } => {
  if (!selectedDevices.length) {
    return { value: "--", variants: [] };
  }
  const variants = selectedDevices.map((device) => ({
    serial: device.summary.serial,
    value: resolver(device),
  }));
  const uniqueValues = Array.from(new Set(variants.map((item) => item.value)));
  if (uniqueValues.length <= 1) {
    return { value: uniqueValues[0] ?? "--", variants: [] };
  }
  return {
    value: `${uniqueValues.length} variants`,
    variants,
  };
};

const aggregatePrimary = (
  selectedDevices: DeviceInfo[],
  activeSerial?: string | null,
): string => {
  if (!selectedDevices.length) {
    return "--";
  }
  const active = activeSerial
    ? selectedDevices.find((device) => device.summary.serial === activeSerial) ?? selectedDevices[0]
    : selectedDevices[0];
  const model = active.detail?.model ?? active.summary.model ?? active.summary.serial;
  return `${model} (${active.summary.serial})`;
};

const buildFieldValue = (
  fieldId: DashboardFieldId,
  input: DashboardAggregationInput,
  selectedDevices: DeviceInfo[],
): { value: string; variants: DashboardValueVariant[] } => {
  const selectedCount = selectedDevices.length;
  const onlineCount = selectedDevices.filter((device) => device.summary.state === "device").length;
  const unauthorizedCount = selectedDevices.filter((device) => device.summary.state === "unauthorized").length;
  const offlineCount = selectedDevices.filter((device) => device.summary.state === "offline").length;

  switch (fieldId) {
    case "selected_count":
      return { value: String(selectedCount), variants: [] };
    case "online_count":
      return { value: String(onlineCount), variants: [] };
    case "unauthorized_count":
      return { value: String(unauthorizedCount), variants: [] };
    case "offline_count":
      return { value: String(offlineCount), variants: [] };
    case "primary_device":
      return { value: aggregatePrimary(selectedDevices, input.activeSerial), variants: [] };
    case "running_tasks":
      return { value: input.runningTaskCount > 0 ? `${input.runningTaskCount} running` : "Idle", variants: [] };
    case "brand":
      return aggregateSelectedValues(selectedDevices, (device) => formatOptional(device.detail?.brand));
    case "model":
      return aggregateSelectedValues(selectedDevices, (device) =>
        formatOptional(device.detail?.model ?? device.summary.model),
      );
    case "android_version":
      return aggregateSelectedValues(selectedDevices, (device) =>
        formatOptional(device.detail?.android_version),
      );
    case "api_level":
      return aggregateSelectedValues(selectedDevices, (device) => formatOptional(device.detail?.api_level));
    case "processor":
      return aggregateSelectedValues(selectedDevices, (device) => formatOptional(device.detail?.processor));
    case "resolution":
      return aggregateSelectedValues(selectedDevices, (device) => formatOptional(device.detail?.resolution));
    case "battery_level":
      return aggregateSelectedValues(selectedDevices, (device) =>
        device.detail?.battery_level == null ? "--" : `${device.detail.battery_level}%`,
      );
    case "memory_total":
      return aggregateSelectedValues(selectedDevices, (device) =>
        device.detail?.memory_total_bytes == null ? "--" : formatBytes(device.detail.memory_total_bytes),
      );
    case "storage_total":
      return aggregateSelectedValues(selectedDevices, (device) =>
        device.detail?.storage_total_bytes == null ? "--" : formatBytes(device.detail.storage_total_bytes),
      );
    case "wifi_state":
      return aggregateSelectedValues(selectedDevices, (device) => formatBooleanState(device.detail?.wifi_is_on));
    case "bt_state":
      return aggregateSelectedValues(selectedDevices, (device) => formatBooleanState(device.detail?.bt_is_on));
    case "gms_version":
      return aggregateSelectedValues(selectedDevices, (device) => formatOptional(device.detail?.gms_version));
    case "adb_status":
      return {
        value:
          input.adbAvailable == null
            ? "Checking..."
            : input.adbAvailable
              ? "Available"
              : "Not available",
        variants: [],
      };
    case "scrcpy_status":
      return {
        value:
          input.scrcpyAvailable == null
            ? "Checking..."
            : input.scrcpyAvailable
              ? "Available"
              : "Not installed",
        variants: [],
      };
    case "selected_connected":
      return {
        value: selectedCount ? `${input.selectedConnectedCount}/${selectedCount}` : "0/0",
        variants: [],
      };
    case "selected_ready_ratio":
      return {
        value: selectedCount ? `${onlineCount}/${selectedCount}` : "0/0",
        variants: [],
      };
    default:
      return { value: "--", variants: [] };
  }
};

export const buildDashboardCardViews = (
  input: DashboardAggregationInput,
  settings?: DashboardSettings | null,
): DashboardCardView[] => {
  const normalized = normalizeDashboardSettings(settings);
  const selectedDevices = selectedDevicesFromSerials(input.devices, input.selectedSerials);

  return normalized.cards
    .filter((card) => card.enabled)
    .sort(compareByOrder)
    .map((card) => {
      const cardMeta = CARD_META_BY_ID.get(card.id);
      const fields = card.fields
        .filter((field) => field.enabled)
        .sort(compareByOrder)
        .map((field) => {
          const fieldValue = buildFieldValue(field.id, input, selectedDevices);
          return {
            id: field.id,
            label: getDashboardFieldLabel(field.id),
            value: fieldValue.value,
            variants: fieldValue.variants,
          };
        });

      return {
        id: card.id,
        title: cardMeta?.title ?? card.id,
        description: cardMeta?.description ?? "",
        fields,
      };
    });
};
