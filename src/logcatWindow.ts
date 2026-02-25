export type LogcatPopupContext = {
  isPopup: boolean;
  serial: string | null;
};

const POPUP_QUERY_VALUE = "1";
const LOGCAT_POPUP_PREFIX = "logcat-popup-";
const MAX_LABEL_SERIAL_SEGMENT = 48;

const normalizeQuery = (search: string) => (search.startsWith("?") ? search.slice(1) : search);

export const parseLogcatPopupContext = (search: string): LogcatPopupContext => {
  const params = new URLSearchParams(normalizeQuery(search));
  const popupRaw = (params.get("popup") ?? "").trim().toLowerCase();
  const serial = (params.get("serial") ?? "").trim();
  const popupEnabled = popupRaw === POPUP_QUERY_VALUE || popupRaw === "true";
  if (!popupEnabled || !serial) {
    return { isPopup: false, serial: null };
  }
  return {
    isPopup: true,
    serial,
  };
};

const sanitizeSerialForLabel = (serial: string): string => {
  const sanitized = serial
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!sanitized) {
    return "device";
  }
  return sanitized.slice(0, MAX_LABEL_SERIAL_SEGMENT);
};

export const buildLogcatPopupWindowLabel = (serial: string): string => {
  return `${LOGCAT_POPUP_PREFIX}${sanitizeSerialForLabel(serial)}`;
};

export const buildLogcatPopupHash = (serial: string): string => {
  const normalized = serial.trim();
  if (!normalized) {
    return "#/logcat";
  }
  return `#/logcat?popup=1&serial=${encodeURIComponent(normalized)}`;
};
