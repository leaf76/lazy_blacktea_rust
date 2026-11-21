import type { ApkInfo, DeviceInfo } from "./types";
import type { TaskStatus } from "./tasks";

export type ApkInstallEventPayload = {
  serial: string;
  event: "start" | "progress" | "complete";
  stage?: string | null;
  progress?: number | null;
  success?: boolean | null;
  message?: string | null;
  error_code?: string | null;
  error_description?: string | null;
  raw_output?: string | null;
  trace_id: string;
};

export type DeviceApkCompatibility = {
  serial: string;
  label: string;
  apiLevel: number | null;
  compatible: boolean | null;
  reason: string | null;
};

export type ApkCompatibilitySummary = {
  devices: DeviceApkCompatibility[];
  incompatibleCount: number;
  unknownCount: number;
};

const APK_ERROR_DESCRIPTIONS: Record<string, string> = {
  INSTALL_FAILED_ALREADY_EXISTS: "App already installed with different signature",
  INSTALL_FAILED_UPDATE_INCOMPATIBLE: "Update incompatible with existing installation",
  INSTALL_FAILED_DUPLICATE_PACKAGE: "Package already exists on device",
  INSTALL_FAILED_OLDER_SDK: "Device Android version too old for this APK",
  INSTALL_FAILED_NEWER_SDK: "APK requires older Android version",
  INSTALL_FAILED_VERSION_DOWNGRADE: "Cannot downgrade — enable Allow downgrade (-d) or uninstall first",
  INSTALL_FAILED_INSUFFICIENT_STORAGE: "Not enough storage space on device",
  INSTALL_FAILED_MEDIA_UNAVAILABLE: "Storage media not available",
  INSTALL_FAILED_USER_RESTRICTED: "User restricted from installing apps",
  INSTALL_FAILED_VERIFICATION_FAILURE: "Package verification failed",
  INSTALL_PARSE_FAILED_NOT_APK: "File is not a valid APK",
  INSTALL_PARSE_FAILED_BAD_MANIFEST: "Invalid AndroidManifest.xml in APK",
  INSTALL_PARSE_FAILED_NO_CERTIFICATES: "APK is not signed",
  INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES: "APK signature inconsistent with installed version",
  INSTALL_FAILED_INVALID_APK: "APK file is corrupted or invalid",
  INSTALL_FAILED_ABORTED: "Installation was cancelled or aborted",
  INSTALL_FAILED_NO_MATCHING_ABIS: "APK not compatible with device CPU architecture",
  INSTALL_FAILED_TEST_ONLY: "Test-only APK — enable Allow test packages (-t)",
};

export const formatApkFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(2)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

export const parseDeviceApiLevel = (value?: string | null): number | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

export const evaluateApkCompatibility = (
  apkInfo: ApkInfo | null,
  selectedDevices: DeviceInfo[],
): ApkCompatibilitySummary => {
  const minSdk = apkInfo?.min_sdk_version ?? null;
  const devices: DeviceApkCompatibility[] = selectedDevices
    .filter((device) => (device.summary.platform ?? "android") === "android")
    .map((device) => {
      const serial = device.summary.serial;
      const model = device.detail?.model || device.summary.model;
      const label = model ? `${model} (${serial})` : serial;
      const apiLevel = parseDeviceApiLevel(device.detail?.api_level);
      if (minSdk == null || apiLevel == null) {
        return {
          serial,
          label,
          apiLevel,
          compatible: null,
          reason: null,
        };
      }
      if (apiLevel < minSdk) {
        return {
          serial,
          label,
          apiLevel,
          compatible: false,
          reason: `Device API ${apiLevel} < required minSdk ${minSdk}`,
        };
      }
      return {
        serial,
        label,
        apiLevel,
        compatible: true,
        reason: null,
      };
    });

  return {
    devices,
    incompatibleCount: devices.filter((item) => item.compatible === false).length,
    unknownCount: devices.filter((item) => item.compatible === null).length,
  };
};

export const describeApkErrorCode = (errorCode?: string | null): string | null => {
  if (!errorCode) {
    return null;
  }
  const normalized = errorCode.trim().toUpperCase();
  return APK_ERROR_DESCRIPTIONS[normalized] ?? null;
};

export const formatApkInstallFailureMessage = (
  errorCode?: string | null,
  errorDescription?: string | null,
  rawOutput?: string | null,
): string => {
  const desc = errorDescription?.trim() || describeApkErrorCode(errorCode);
  const raw = rawOutput?.trim();
  if (desc && raw && !raw.toLowerCase().includes(desc.toLowerCase())) {
    const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? "";
    if (firstLine && firstLine.length <= 120) {
      return `${desc} (${firstLine})`;
    }
    return desc;
  }
  return desc || raw || errorCode || "Install failed.";
};

export const resolveApkInstallEventPatch = (
  payload: ApkInstallEventPayload,
): { status: TaskStatus; progress: number | null; message: string } | null => {
  if (payload.event === "start") {
    return {
      status: "running",
      progress: payload.progress ?? null,
      message: payload.message ?? "Preparing install...",
    };
  }
  if (payload.event === "progress") {
    const progress =
      typeof payload.progress === "number" && Number.isFinite(payload.progress)
        ? Math.max(0, Math.min(100, Math.round(payload.progress)))
        : null;
    const defaultMsg =
      payload.stage === "pushing"
        ? progress != null
          ? `Pushing APK... (${progress}%)`
          : "Pushing APK..."
        : payload.stage === "installing"
          ? "Installing package..."
          : "Installing...";
    return {
      status: "running",
      progress,
      message: payload.message ?? defaultMsg,
    };
  }
  if (payload.event === "complete") {
    if (payload.stage === "cancelled") {
      return {
        status: "cancelled",
        progress: null,
        message: payload.message ?? "Cancelled.",
      };
    }
    if (payload.success === true) {
      return {
        status: "success",
        progress: 100,
        message: payload.message ?? "Installed.",
      };
    }
    return {
      status: "error",
      progress: null,
      message: formatApkInstallFailureMessage(
        payload.error_code,
        payload.error_description,
        payload.raw_output ?? payload.message,
      ),
    };
  }
  return null;
};
