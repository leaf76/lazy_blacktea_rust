export type BugreportPopupContext = {
  isPopup: boolean;
  sourcePath: string | null;
};

const POPUP_QUERY_VALUE = "1";
const BUGREPORT_POPUP_PREFIX = "bugreport-popup-";
const MAX_LABEL_SOURCE_SEGMENT = 24;

const normalizeQuery = (search: string) => (search.startsWith("?") ? search.slice(1) : search);

const hashLabelSource = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const sanitizeSourceForLabel = (sourcePath: string): string => {
  const normalized = sourcePath
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, MAX_LABEL_SOURCE_SEGMENT) || "source";
};

export const parseBugreportPopupContext = (search: string): BugreportPopupContext => {
  const params = new URLSearchParams(normalizeQuery(search));
  const popupRaw = (params.get("popup") ?? "").trim().toLowerCase();
  const popupEnabled = popupRaw === POPUP_QUERY_VALUE || popupRaw === "true";
  if (!popupEnabled) {
    return { isPopup: false, sourcePath: null };
  }
  const sourcePath = (params.get("source") ?? "").trim();
  return {
    isPopup: true,
    sourcePath: sourcePath || null,
  };
};

export const buildBugreportPopupWindowLabel = (sourcePath?: string): string => {
  const normalized = sourcePath?.trim() ?? "";
  if (!normalized) {
    return `${BUGREPORT_POPUP_PREFIX}empty`;
  }
  const sanitized = sanitizeSourceForLabel(normalized);
  const hash = hashLabelSource(normalized);
  return `${BUGREPORT_POPUP_PREFIX}${sanitized}-${hash}`;
};

export const buildBugreportPopupHash = (sourcePath?: string): string => {
  const base = "#/bugreport-logviewer?popup=1";
  const normalized = sourcePath?.trim() ?? "";
  if (!normalized) {
    return base;
  }
  return `${base}&source=${encodeURIComponent(normalized)}`;
};
