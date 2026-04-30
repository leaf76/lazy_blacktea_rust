import type {
  AppConfig,
  ThemeBackgroundFit,
  ThemeBackgroundKind,
  ThemeBackgroundSource,
  ThemeColorSettings,
  ThemeCopyOverrides,
  ThemeStyleSettings,
  UiSettings,
} from "./types";

export type ThemeMode = "light" | "dark";

export type ThemePreset = {
  id: string;
  label: string;
  mode: ThemeMode;
  backgroundImage: string;
  colors: {
    app: string;
    panel: string;
    subtle: string;
    border: string;
    text: string;
    muted: string;
    primary: string;
    primaryStrong: string;
    accent: string;
    shadow: string;
  };
};

export const DEFAULT_THEME_PRESET_ID = "system";
export const DEFAULT_APP_TITLE = "Lazy Blacktea";
export const DEFAULT_APP_SUBTITLE = "Device Automation";
export const DEFAULT_SIDEBAR_STATUS_LABEL = "Device Status";

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "system",
    label: "System",
    mode: "light",
    backgroundImage:
      "radial-gradient(circle at top left, rgba(233, 239, 255, 0.95), rgba(244, 247, 251, 0.9) 45%, rgba(248, 251, 255, 0.95))",
    colors: {
      app: "#f4f7fb",
      panel: "#ffffff",
      subtle: "#eef2f7",
      border: "#d7dee8",
      text: "#0f172a",
      muted: "#5b6b7f",
      primary: "#2563eb",
      primaryStrong: "#1d4ed8",
      accent: "#0f766e",
      shadow: "rgba(15, 23, 42, 0.12)",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    mode: "dark",
    backgroundImage:
      "radial-gradient(circle at 18% 8%, rgba(14, 165, 233, 0.22), transparent 26%), linear-gradient(135deg, #09111f 0%, #101827 48%, #13221f 100%)",
    colors: {
      app: "#0b1220",
      panel: "#0f172a",
      subtle: "#111f35",
      border: "#22324d",
      text: "#e2e8f0",
      muted: "#94a3b8",
      primary: "#60a5fa",
      primaryStrong: "#3b82f6",
      accent: "#2dd4bf",
      shadow: "rgba(2, 6, 23, 0.62)",
    },
  },
  {
    id: "terminal",
    label: "Terminal",
    mode: "dark",
    backgroundImage:
      "linear-gradient(rgba(34, 197, 94, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 197, 94, 0.06) 1px, transparent 1px), linear-gradient(135deg, #07100c 0%, #101914 55%, #141710 100%)",
    colors: {
      app: "#07100c",
      panel: "#101914",
      subtle: "#16231b",
      border: "#294132",
      text: "#d8f3dc",
      muted: "#95b8a0",
      primary: "#22c55e",
      primaryStrong: "#16a34a",
      accent: "#facc15",
      shadow: "rgba(0, 0, 0, 0.55)",
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    mode: "dark",
    backgroundImage:
      "radial-gradient(circle at 80% 12%, rgba(250, 204, 21, 0.18), transparent 24%), linear-gradient(145deg, #18181b 0%, #27272a 45%, #1f2937 100%)",
    colors: {
      app: "#18181b",
      panel: "#27272a",
      subtle: "#303036",
      border: "#4b5563",
      text: "#f4f4f5",
      muted: "#cbd5e1",
      primary: "#facc15",
      primaryStrong: "#eab308",
      accent: "#38bdf8",
      shadow: "rgba(0, 0, 0, 0.46)",
    },
  },
  {
    id: "daylight",
    label: "Daylight",
    mode: "light",
    backgroundImage:
      "radial-gradient(circle at 20% 10%, rgba(20, 184, 166, 0.16), transparent 26%), linear-gradient(135deg, #fff7ed 0%, #f8fafc 50%, #ecfeff 100%)",
    colors: {
      app: "#f8fafc",
      panel: "#ffffff",
      subtle: "#f1f5f9",
      border: "#d8dee8",
      text: "#111827",
      muted: "#64748b",
      primary: "#0f766e",
      primaryStrong: "#0d9488",
      accent: "#ea580c",
      shadow: "rgba(15, 23, 42, 0.13)",
    },
  },
];

const THEME_MODE_TOKENS: Record<ThemeMode, Record<string, string>> = {
  light: {
    "--theme-color-scheme": "light",
    "--color-success": "#16a34a",
    "--color-warning": "#d97706",
    "--color-danger": "#dc2626",
    "--color-logcat-bg": "#0f172a",
    "--color-logcat-text": "#e2e8f0",
    "--pill-idle-bg": "#eef2f7",
    "--pill-idle-text": "#334155",
    "--pill-ok-bg": "#dcfce7",
    "--pill-ok-text": "#166534",
    "--pill-warn-bg": "#fef3c7",
    "--pill-warn-text": "#92400e",
    "--pill-error-bg": "#fee2e2",
    "--pill-error-text": "#991b1b",
    "--nav-active-bg": "#e0e7ff",
    "--nav-active-border": "#c7d2fe",
    "--nav-active-text": "#1e293b",
    "--badge-bg": "#e5e7eb",
    "--badge-text": "#111827",
    "--tag-bg": "#e0e7ff",
    "--tag-text": "#3730a3",
    "--toggle-active-bg": "#e0e7ff",
    "--toggle-active-border": "#c7d2fe",
    "--toggle-active-text": "#1f2937",
    "--progress-track": "#e5e7eb",
    "--alert-error-border": "rgba(220, 38, 38, 0.4)",
    "--alert-error-bg": "rgba(220, 38, 38, 0.08)",
    "--alert-error-text": "#7f1d1d",
    "--alert-info-border": "rgba(37, 99, 235, 0.3)",
    "--alert-info-bg": "rgba(37, 99, 235, 0.08)",
    "--alert-info-text": "#1e3a8a",
    "--dashboard-hero-accent": "rgba(37, 99, 235, 0.08)",
    "--dashboard-hero-border": "rgba(37, 99, 235, 0.25)",
    "--modal-backdrop": "rgba(15, 23, 42, 0.45)",
    "--shadow-card": "0 8px 20px var(--color-shadow)",
  },
  dark: {
    "--theme-color-scheme": "dark",
    "--color-success": "#22c55e",
    "--color-warning": "#fbbf24",
    "--color-danger": "#f87171",
    "--color-logcat-bg": "#0b1220",
    "--color-logcat-text": "#dbeafe",
    "--pill-idle-bg": "#1e293b",
    "--pill-idle-text": "#e2e8f0",
    "--pill-ok-bg": "#064e3b",
    "--pill-ok-text": "#a7f3d0",
    "--pill-warn-bg": "#78350f",
    "--pill-warn-text": "#fde68a",
    "--pill-error-bg": "#7f1d1d",
    "--pill-error-text": "#fecaca",
    "--nav-active-bg": "#1e2a44",
    "--nav-active-border": "#334155",
    "--nav-active-text": "#e2e8f0",
    "--badge-bg": "#1f2937",
    "--badge-text": "#e2e8f0",
    "--tag-bg": "#1e293b",
    "--tag-text": "#c7d2fe",
    "--toggle-active-bg": "#1e2a44",
    "--toggle-active-border": "#334155",
    "--toggle-active-text": "#e2e8f0",
    "--progress-track": "#1f2a44",
    "--alert-error-border": "rgba(248, 113, 113, 0.45)",
    "--alert-error-bg": "rgba(248, 113, 113, 0.12)",
    "--alert-error-text": "#fecaca",
    "--alert-info-border": "rgba(96, 165, 250, 0.35)",
    "--alert-info-bg": "rgba(96, 165, 250, 0.12)",
    "--alert-info-text": "#bfdbfe",
    "--dashboard-hero-accent": "rgba(96, 165, 250, 0.12)",
    "--dashboard-hero-border": "rgba(96, 165, 250, 0.28)",
    "--modal-backdrop": "rgba(2, 6, 23, 0.65)",
    "--shadow-card": "0 8px 20px var(--color-shadow)",
  },
};

const DEFAULT_COLORS: ThemeColorSettings = {
  primary: "",
  accent: "",
  text: "",
  muted_text: "",
  panel: "",
};

const DEFAULT_COPY: ThemeCopyOverrides = {
  app_title: "",
  app_subtitle: "",
  sidebar_status_label: "",
};

const DEFAULT_BACKGROUND_SOURCE: ThemeBackgroundSource = {
  kind: "preset",
  path: "",
};

const COPY_LIMITS: Record<keyof ThemeCopyOverrides, number> = {
  app_title: 80,
  app_subtitle: 120,
  sidebar_status_label: 40,
};

const BACKGROUND_KINDS = new Set<ThemeBackgroundKind>(["preset", "none", "local_path", "managed_path"]);
const BACKGROUND_FITS = new Set<ThemeBackgroundFit>(["cover", "contain", "repeat"]);

export const buildDefaultThemeStyleSettings = (): ThemeStyleSettings => ({
  preset_id: DEFAULT_THEME_PRESET_ID,
  background_source: { ...DEFAULT_BACKGROUND_SOURCE },
  background_fit: "cover",
  background_opacity: 1,
  panel_opacity: 1,
  colors: { ...DEFAULT_COLORS },
  copy_overrides: { ...DEFAULT_COPY },
});

const findPreset = (id: string): ThemePreset =>
  THEME_PRESETS.find((preset) => preset.id === id) ?? THEME_PRESETS[0];

const resolvePresetForUi = (id: string, legacyTheme: string): ThemePreset => {
  if (id === DEFAULT_THEME_PRESET_ID && legacyTheme.trim().toLowerCase() === "dark") {
    return findPreset("midnight");
  }
  return findPreset(id);
};

const normalizeHexColor = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(trimmed);
  if (short) {
    return `#${short[1].split("").map((char) => `${char}${char}`).join("")}`;
  }
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : "";
};

const hexToRgb = (value: string): [number, number, number] | null => {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return null;
  }
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
};

const relativeLuminance = (value: string): number | null => {
  const rgb = hexToRgb(value);
  if (!rgb) {
    return null;
  }
  const channels = rgb.map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

export const getContrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance == null || backgroundLuminance == null) {
    return 0;
  }
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

const pickReadableColor = (background: string): string =>
  getContrastRatio("#ffffff", background) >= getContrastRatio("#111827", background) ? "#ffffff" : "#111827";

const ensureReadableColor = (
  requested: string,
  fallback: string,
  background: string,
  minimumRatio: number,
): string => {
  if (!requested) {
    return fallback;
  }
  if (getContrastRatio(requested, background) >= minimumRatio) {
    return requested;
  }
  if (getContrastRatio(fallback, background) >= minimumRatio) {
    return fallback;
  }
  return pickReadableColor(background);
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
};

const normalizeCopyValue = (value: unknown, limit: number): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, limit);
};

export const normalizeThemeStyleSettings = (
  settings?: Partial<ThemeStyleSettings> | null,
): ThemeStyleSettings => {
  const defaults = buildDefaultThemeStyleSettings();
  const presetId = typeof settings?.preset_id === "string" ? settings.preset_id.trim() : "";
  const backgroundKind =
    settings?.background_source && BACKGROUND_KINDS.has(settings.background_source.kind)
      ? settings.background_source.kind
      : defaults.background_source.kind;
  const backgroundPath =
    typeof settings?.background_source?.path === "string"
      ? settings.background_source.path.trim().slice(0, 2048)
      : "";

  return {
    preset_id: THEME_PRESETS.some((preset) => preset.id === presetId) ? presetId : defaults.preset_id,
    background_source: {
      kind: backgroundKind,
      path:
        backgroundKind === "local_path" || backgroundKind === "managed_path"
          ? backgroundPath
          : "",
    },
    background_fit:
      settings?.background_fit && BACKGROUND_FITS.has(settings.background_fit)
        ? settings.background_fit
        : defaults.background_fit,
    background_opacity: clamp(settings?.background_opacity, 0, 1, defaults.background_opacity),
    panel_opacity: clamp(settings?.panel_opacity, 0.72, 1, defaults.panel_opacity),
    colors: {
      primary: normalizeHexColor(settings?.colors?.primary),
      accent: normalizeHexColor(settings?.colors?.accent),
      text: normalizeHexColor(settings?.colors?.text),
      muted_text: normalizeHexColor(settings?.colors?.muted_text),
      panel: normalizeHexColor(settings?.colors?.panel),
    },
    copy_overrides: {
      app_title: normalizeCopyValue(settings?.copy_overrides?.app_title, COPY_LIMITS.app_title),
      app_subtitle: normalizeCopyValue(settings?.copy_overrides?.app_subtitle, COPY_LIMITS.app_subtitle),
      sidebar_status_label: normalizeCopyValue(
        settings?.copy_overrides?.sidebar_status_label,
        COPY_LIMITS.sidebar_status_label,
      ),
    },
  };
};

export const normalizeThemeFontSize = (value: unknown): number => Math.round(clamp(value, 10, 18, 13));

export const buildConfigWithThemeStyleUpdate = (
  config: AppConfig,
  updater: (current: ThemeStyleSettings) => ThemeStyleSettings,
): AppConfig => {
  const current = normalizeThemeStyleSettings(config.ui.theme_style);
  return {
    ...config,
    ui: {
      ...config.ui,
      theme_style: normalizeThemeStyleSettings(updater(current)),
    },
  };
};

export const mergeSavedThemeBackgroundSourceIntoDraft = (
  draftConfig: AppConfig,
  savedConfig: AppConfig,
): AppConfig => {
  const savedTheme = normalizeThemeStyleSettings(savedConfig.ui.theme_style);
  return buildConfigWithThemeStyleUpdate(draftConfig, (current) => ({
    ...current,
    background_source: savedTheme.background_source,
  }));
};

export const resolveThemeCopy = (settings?: Partial<ThemeStyleSettings> | null) => {
  const normalized = normalizeThemeStyleSettings(settings);
  return {
    app_title: normalized.copy_overrides.app_title || DEFAULT_APP_TITLE,
    app_subtitle: normalized.copy_overrides.app_subtitle || DEFAULT_APP_SUBTITLE,
    sidebar_status_label: normalized.copy_overrides.sidebar_status_label || DEFAULT_SIDEBAR_STATUS_LABEL,
  };
};

export const resolveThemeBackgroundImage = (
  settings?: Partial<ThemeStyleSettings> | null,
  options: { isTauriRuntime: boolean; convertFileSrc?: (path: string) => string; legacyTheme?: string } = {
    isTauriRuntime: false,
  },
): string => {
  const normalized = normalizeThemeStyleSettings(settings);
  const preset = resolvePresetForUi(normalized.preset_id, options.legacyTheme ?? "");
  const source = normalized.background_source;
  if (
    options.isTauriRuntime &&
    options.convertFileSrc &&
    (source.kind === "local_path" || source.kind === "managed_path") &&
    source.path
  ) {
    return `url("${options.convertFileSrc(source.path)}")`;
  }
  if (source.kind === "none") {
    return "none";
  }
  return preset.backgroundImage;
};

export const buildThemeCssVariables = (
  ui: UiSettings,
  options: { isTauriRuntime: boolean; convertFileSrc?: (path: string) => string },
): Record<string, string> => {
  const theme = normalizeThemeStyleSettings(ui.theme_style);
  const preset = resolvePresetForUi(theme.preset_id, ui.theme);
  const colors = theme.colors;
  const isRepeat = theme.background_fit === "repeat";
  const panelColor = colors.panel || preset.colors.panel;
  const primaryColor = colors.primary || preset.colors.primary;
  const accentColor = colors.accent || preset.colors.accent;
  const textColor = ensureReadableColor(colors.text, preset.colors.text, panelColor, 4.5);
  const mutedTextColor = ensureReadableColor(colors.muted_text, preset.colors.muted, panelColor, 3);
  return {
    ...THEME_MODE_TOKENS[preset.mode],
    "--color-bg-app": preset.colors.app,
    "--color-bg-panel": panelColor,
    "--color-bg-subtle": preset.colors.subtle,
    "--color-border": preset.colors.border,
    "--color-text": textColor,
    "--color-text-muted": mutedTextColor,
    "--color-primary": primaryColor,
    "--color-primary-600": primaryColor,
    "--color-primary-contrast": pickReadableColor(primaryColor),
    "--color-accent": accentColor,
    "--color-accent-contrast": pickReadableColor(accentColor),
    "--color-shadow": preset.colors.shadow,
    "--theme-background-image": resolveThemeBackgroundImage(theme, { ...options, legacyTheme: ui.theme }),
    "--theme-background-size": isRepeat ? "auto" : theme.background_fit,
    "--theme-background-repeat": isRepeat ? "repeat" : "no-repeat",
    "--theme-background-opacity": String(theme.background_opacity),
    "--theme-background-opacity-percent": `${Math.round(theme.background_opacity * 100)}%`,
    "--theme-panel-opacity": String(theme.panel_opacity),
    "--theme-panel-opacity-percent": `${Math.round(theme.panel_opacity * 100)}%`,
    "--surface-panel-bg": "color-mix(in srgb, var(--color-bg-panel) var(--theme-panel-opacity-percent), transparent)",
    "--surface-subtle-bg": "color-mix(in srgb, var(--color-bg-subtle) var(--theme-panel-opacity-percent), transparent)",
    "--surface-control-bg": "color-mix(in srgb, var(--color-bg-panel) var(--theme-panel-opacity-percent), transparent)",
    "--surface-popover-bg": "color-mix(in srgb, var(--color-bg-panel) var(--theme-panel-opacity-percent), transparent)",
    "--surface-active-bg": "color-mix(in srgb, var(--nav-active-bg) var(--theme-panel-opacity-percent), transparent)",
    "--surface-badge-bg": "color-mix(in srgb, var(--badge-bg) var(--theme-panel-opacity-percent), transparent)",
    "--surface-tag-bg": "color-mix(in srgb, var(--tag-bg) var(--theme-panel-opacity-percent), transparent)",
    "--theme-font-size": `${normalizeThemeFontSize(ui.font_size)}px`,
  };
};
