import type {
  BugreportExtractResult,
  BugreportExtractTemplateKind,
} from "./types";

export const BUGREPORT_CUSTOM_VIEWS_STORAGE_KEY = "bugreport_extract_custom_views_v1";
export const DEFAULT_BUGREPORT_CUSTOM_VIEW_GROUP = "Uncategorized";
export const BUGREPORT_CUSTOM_VIEW_TEMPLATE_KINDS: BugreportExtractTemplateKind[] = [
  "service",
  "app",
  "keyword",
];

export type BugreportCustomViewTemplate = {
  id: string;
  group: string;
  name: string;
  template_kind: BugreportExtractTemplateKind;
  default_input?: string;
};

export type ActiveBugreportCustomViewSession = {
  template_id: string;
  input_value: string;
  overlay_preset_name: string | null;
  report_id: string;
  result_snapshot: BugreportExtractResult;
};

const normalizeIdentityPart = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeTemplateKind = (value: unknown): BugreportExtractTemplateKind => {
  if (typeof value !== "string") {
    return "keyword";
  }
  const lowered = value.trim().toLowerCase();
  if (BUGREPORT_CUSTOM_VIEW_TEMPLATE_KINDS.includes(lowered as BugreportExtractTemplateKind)) {
    return lowered as BugreportExtractTemplateKind;
  }
  return "keyword";
};

const parseBugreportCustomViewRecord = (value: unknown): BugreportCustomViewTemplate | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = normalizeOptionalText(record.name);
  if (!name) {
    return null;
  }
  const group =
    normalizeOptionalText(record.group) ?? DEFAULT_BUGREPORT_CUSTOM_VIEW_GROUP;
  const template_kind = normalizeTemplateKind(record.template_kind);
  const default_input = normalizeOptionalText(record.default_input);

  return {
    id: makeBugreportCustomViewId(group, name),
    group,
    name,
    template_kind,
    ...(default_input ? { default_input } : {}),
  };
};

export const makeBugreportCustomViewId = (group: string, name: string): string =>
  `${normalizeIdentityPart(group)}::${normalizeIdentityPart(name)}`;

export const parseBugreportCustomViewsFromStorage = (
  stored: string | null,
): BugreportCustomViewTemplate[] => {
  if (!stored) {
    return [];
  }
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const next: BugreportCustomViewTemplate[] = [];
    for (const item of parsed) {
      const template = parseBugreportCustomViewRecord(item);
      if (template) {
        next.push(template);
      }
    }
    return next;
  } catch {
    return [];
  }
};

export const groupBugreportCustomViews = (
  views: BugreportCustomViewTemplate[],
): Array<{ group: string; views: BugreportCustomViewTemplate[] }> => {
  const map = new Map<string, BugreportCustomViewTemplate[]>();
  for (const view of views) {
    const list = map.get(view.group) ?? [];
    list.push(view);
    map.set(view.group, list);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([group, groupedViews]) => ({
      group,
      views: [...groupedViews].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    }));
};

export const hasBugreportCustomViewNameConflict = (
  views: BugreportCustomViewTemplate[],
  group: string,
  name: string,
  ignoreId?: string,
): boolean => {
  const targetGroup = normalizeIdentityPart(group);
  const targetName = normalizeIdentityPart(name);
  return views.some((view) => {
    if (ignoreId && view.id === ignoreId) {
      return false;
    }
    return (
      normalizeIdentityPart(view.group) === targetGroup &&
      normalizeIdentityPart(view.name) === targetName
    );
  });
};
