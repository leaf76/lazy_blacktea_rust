import { describe, expect, it } from "vitest";
import {
  buildConfigWithThemeStyleUpdate,
  buildThemeCssVariables,
  getContrastRatio,
  mergeSavedThemeBackgroundSourceIntoDraft,
  normalizeThemeStyleSettings,
  resolveThemeBackgroundImage,
  resolveThemeCopy,
} from "./theme";
import type { AppConfig, ThemeStyleSettings, UiSettings } from "./types";

const baseUi = (themeStyle: Partial<ThemeStyleSettings> = {}): UiSettings => ({
  window_width: 1280,
  window_height: 760,
  window_x: 100,
  window_y: 100,
  ui_scale: 1,
  theme: "dark",
  font_size: 13,
  show_console_panel: false,
  single_selection: true,
  default_output_path: "/tmp",
  theme_style: normalizeThemeStyleSettings(themeStyle),
});

describe("theme settings", () => {
  it("normalizes invalid colors, copy, opacity, and background source", () => {
    const normalized = normalizeThemeStyleSettings({
      preset_id: "missing",
      background_fit: "stretch" as ThemeStyleSettings["background_fit"],
      background_opacity: 8,
      panel_opacity: 0.1,
      background_source: {
        kind: "remote" as ThemeStyleSettings["background_source"]["kind"],
        path: "/tmp/bg.png",
      },
      colors: {
        primary: "blue",
        accent: "#0F766E",
        text: "#abc",
        muted_text: "inherit",
        panel: "#111827",
      },
      copy_overrides: {
        app_title: "  My Lab  ",
        app_subtitle: "x".repeat(200),
        sidebar_status_label: "",
      },
    });

    expect(normalized.preset_id).toBe("system");
    expect(normalized.background_fit).toBe("cover");
    expect(normalized.background_opacity).toBe(1);
    expect(normalized.panel_opacity).toBe(0.72);
    expect(normalized.background_source).toEqual({ kind: "preset", path: "" });
    expect(normalized.colors.primary).toBe("");
    expect(normalized.colors.accent).toBe("#0f766e");
    expect(normalized.colors.text).toBe("#aabbcc");
    expect(normalized.colors.muted_text).toBe("");
    expect(normalized.colors.panel).toBe("#111827");
    expect(normalized.copy_overrides.app_title).toBe("My Lab");
    expect(normalized.copy_overrides.app_subtitle.length).toBe(120);
  });

  it("builds CSS variables from preset values and user overrides", () => {
    const css = buildThemeCssVariables(
      baseUi({
        preset_id: "terminal",
        background_opacity: 0.45,
        panel_opacity: 0.86,
        colors: {
          primary: "#ffcc00",
          accent: "",
          text: "#f8fafc",
          muted_text: "",
          panel: "",
        },
      }),
      { isTauriRuntime: false },
    );

    expect(css["--color-primary"]).toBe("#ffcc00");
    expect(css["--color-text"]).toBe("#f8fafc");
    expect(css["--theme-background-opacity"]).toBe("0.45");
    expect(css["--theme-panel-opacity"]).toBe("0.86");
    expect(css["--theme-background-image"]).toContain("linear-gradient");
  });

  it("keeps the legacy dark default readable when using the system preset", () => {
    const css = buildThemeCssVariables(baseUi({ preset_id: "system" }), { isTauriRuntime: false });

    expect(css["--color-bg-panel"]).toBe("#0f172a");
    expect(css["--color-text"]).toBe("#e2e8f0");
    expect(css["--theme-background-image"]).toContain("#09111f");
    expect(getContrastRatio(css["--color-text"], css["--color-bg-panel"])).toBeGreaterThanOrEqual(4.5);
  });

  it("uses converted local images only in Tauri and falls back otherwise", () => {
    const settings = normalizeThemeStyleSettings({
      preset_id: "graphite",
      background_source: {
        kind: "local_path",
        path: "/Users/me/Pictures/bg.png",
      },
    });

    expect(resolveThemeBackgroundImage(settings, { isTauriRuntime: false })).toContain("linear-gradient");
    expect(
      resolveThemeBackgroundImage(settings, {
        isTauriRuntime: true,
        convertFileSrc: (path) => `asset://${path}`,
      }),
    ).toBe('url("asset:///Users/me/Pictures/bg.png")');
  });

  it("keeps an empty local background source editable before a path is entered", () => {
    const settings = normalizeThemeStyleSettings({
      preset_id: "graphite",
      background_source: {
        kind: "local_path",
        path: "",
      },
    });

    expect(settings.background_source).toEqual({ kind: "local_path", path: "" });
    expect(
      resolveThemeBackgroundImage(settings, {
        isTauriRuntime: true,
        convertFileSrc: (path) => `asset://${path}`,
      }),
    ).toContain("linear-gradient");
  });

  it("builds a persistable config when theme background source changes", () => {
    const config = {
      ui: baseUi({
        preset_id: "graphite",
        background_source: { kind: "preset", path: "" },
        background_fit: "contain",
        background_opacity: 0.6,
      }),
    } as unknown as AppConfig;

    const updated = buildConfigWithThemeStyleUpdate(config, (current) => ({
      ...current,
      background_source: {
        kind: "managed_path",
        path: "/Users/me/.lazy_blacktea/themes/backgrounds/theme-background-test.png",
      },
    }));

    expect(updated).not.toBe(config);
    expect(updated.ui).not.toBe(config.ui);
    expect(updated.ui.theme_style.background_source).toEqual({
      kind: "managed_path",
      path: "/Users/me/.lazy_blacktea/themes/backgrounds/theme-background-test.png",
    });
    expect(updated.ui.theme_style.background_fit).toBe("contain");
    expect(updated.ui.theme_style.background_opacity).toBe(0.6);
    expect(config.ui.theme_style.background_source).toEqual({ kind: "preset", path: "" });
  });

  it("merges saved background source into the current draft without saving unrelated draft settings", () => {
    const draft = {
      adb: { command_path: "/draft/adb" },
      ui: baseUi({
        preset_id: "terminal",
        background_source: { kind: "preset", path: "" },
        background_fit: "contain",
        background_opacity: 0.6,
      }),
    } as unknown as AppConfig;
    const saved = {
      adb: { command_path: "/persisted/adb" },
      ui: baseUi({
        preset_id: "graphite",
        background_source: {
          kind: "managed_path",
          path: "/Users/me/.lazy_blacktea/themes/backgrounds/theme-background-test.png",
        },
        background_fit: "cover",
        background_opacity: 1,
      }),
    } as unknown as AppConfig;

    const merged = mergeSavedThemeBackgroundSourceIntoDraft(draft, saved);

    expect(merged.adb.command_path).toBe("/draft/adb");
    expect(merged.ui.theme_style.preset_id).toBe("terminal");
    expect(merged.ui.theme_style.background_fit).toBe("contain");
    expect(merged.ui.theme_style.background_opacity).toBe(0.6);
    expect(merged.ui.theme_style.background_source).toEqual({
      kind: "managed_path",
      path: "/Users/me/.lazy_blacktea/themes/backgrounds/theme-background-test.png",
    });
  });

  it("resolves copy overrides with defaults", () => {
    const copy = resolveThemeCopy(
      normalizeThemeStyleSettings({
        copy_overrides: {
          app_title: "Desk Lab",
          app_subtitle: "",
          sidebar_status_label: "Lab State",
        },
      }),
    );

    expect(copy.app_title).toBe("Desk Lab");
    expect(copy.app_subtitle).toBe("Device Automation");
    expect(copy.sidebar_status_label).toBe("Lab State");
  });

  it("keeps light theme text and primary button contrast readable", () => {
    const css = buildThemeCssVariables(
      baseUi({
        preset_id: "daylight",
        colors: {
          primary: "#facc15",
          accent: "",
          text: "#ffffff",
          muted_text: "#f8fafc",
          panel: "#ffffff",
        },
      }),
      { isTauriRuntime: false },
    );

    expect(css["--color-text"]).toBe("#111827");
    expect(css["--color-text-muted"]).toBe("#64748b");
    expect(css["--color-primary-contrast"]).toBe("#111827");
    expect(getContrastRatio(css["--color-text"], css["--color-bg-panel"])).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(css["--color-text-muted"], css["--color-bg-panel"])).toBeGreaterThanOrEqual(3);
    expect(getContrastRatio(css["--color-primary-contrast"], css["--color-primary"])).toBeGreaterThanOrEqual(4.5);
  });
});
