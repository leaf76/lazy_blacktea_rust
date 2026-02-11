import { isTauriRuntime } from "./tauriEnv";

export type DesktopNotificationPermissionState = "unknown" | "granted" | "not_granted";

export const isAppUnfocused = (): boolean => {
  if (typeof document === "undefined") {
    return false;
  }

  const hasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  const hidden = document.visibilityState === "hidden";
  return !hasFocus || hidden;
};

export const getDesktopNotificationPermission = async (): Promise<DesktopNotificationPermissionState> => {
  if (!isTauriRuntime()) {
    return "unknown";
  }

  try {
    const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
    const granted = await isPermissionGranted();
    return granted ? "granted" : "not_granted";
  } catch {
    return "unknown";
  }
};

export const requestDesktopNotificationPermission = async (): Promise<DesktopNotificationPermissionState> => {
  if (!isTauriRuntime()) {
    return "unknown";
  }

  try {
    const { requestPermission } = await import("@tauri-apps/plugin-notification");
    const result = await requestPermission();
    return result === "granted" ? "granted" : "not_granted";
  } catch {
    return "unknown";
  }
};

export const sendDesktopNotification = async (params: {
  title: string;
  body?: string;
}): Promise<boolean> => {
  if (!isTauriRuntime()) {
    return false;
  }
  if (!params.title.trim()) {
    return false;
  }

  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    sendNotification({ title: params.title, body: params.body });
    return true;
  } catch {
    return false;
  }
};
