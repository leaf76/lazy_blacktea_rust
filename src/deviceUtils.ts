import type { DeviceDetail, DeviceInfo } from "./types";
import { formatBytes } from "./perf";

type DeviceDetailPatch = Partial<Omit<DeviceDetail, "serial">>;
type DeviceValue = string | number | boolean | null | undefined;

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
