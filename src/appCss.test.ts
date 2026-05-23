import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");

const readCssRule = (selector: string): string => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`).exec(appCss)?.groups?.body ?? "";
};

const readNumericDeclaration = (selector: string, property: string): number => {
  const body = readCssRule(selector);
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rawValue = new RegExp(`${escapedProperty}\\s*:\\s*(?<value>-?\\d+)\\s*;`).exec(body)?.groups?.value;
  expect(rawValue, `${selector} should define ${property}`).toBeDefined();
  return Number(rawValue);
};

describe("app shell theme cascade", () => {
  it("sets the inherited text color from active theme variables", () => {
    expect(readCssRule(".app-shell")).toContain("color: var(--color-text)");
  });

  it("sets native control color scheme from the active theme", () => {
    expect(readCssRule(".app-shell")).toContain("color-scheme: var(--theme-color-scheme)");
  });

  it("routes major surfaces through the user-controlled panel opacity tokens", () => {
    const rootRule = readCssRule(":root");

    expect(rootRule).toContain(
      "--surface-panel-bg: color-mix(in srgb, var(--color-bg-panel) var(--theme-panel-opacity-percent), transparent)",
    );
    expect(rootRule).toContain(
      "--surface-subtle-bg: color-mix(in srgb, var(--color-bg-subtle) var(--theme-panel-opacity-percent), transparent)",
    );
    expect(rootRule).toContain(
      "--surface-active-bg: color-mix(in srgb, var(--nav-active-bg) var(--theme-panel-opacity-percent), transparent)",
    );
    expect(readCssRule(".panel")).toContain("background: var(--surface-panel-bg)");
    expect(readCssRule(".settings-group")).toContain("background: var(--surface-subtle-bg)");
    expect(readCssRule(".device-popover")).toContain("background: var(--surface-popover-bg)");
    expect(readCssRule(".modal")).toContain("background: var(--surface-popover-bg)");
  });
});

describe("app shell stacking order", () => {
  it("keeps the header device popover stack above the Bluetooth monitor hero", () => {
    expect(readNumericDeclaration(".top-bar", "z-index")).toBeGreaterThan(
      readNumericDeclaration(".bluetooth-monitor-hero", "z-index"),
    );
  });

  it("keeps page-local sticky and inline overlays below the top bar stack", () => {
    const topBarZIndex = readNumericDeclaration(".top-bar", "z-index");
    const pageLocalSelectors = [
      ".device-filter-bar",
      ".device-command-bar",
      ".device-list-header",
      ".developer-options-matrix-table thead th",
      ".developer-options-matrix-option-col",
      ".shell-terminal-header.panel",
      ".logcat-search-overlay",
      ".bugreport-log-findbar",
      ".net-profiler-chart-overlay",
    ];

    pageLocalSelectors.forEach((selector) => {
      expect(readNumericDeclaration(selector, "z-index"), selector).toBeLessThan(topBarZIndex);
    });
  });
});

describe("device manager layout", () => {
  it("lets device status actions wrap before they can overlap info columns", () => {
    expect(readCssRule(".device-status-actions")).toContain("flex-wrap: wrap");
    expect(readCssRule(".device-state")).toContain("flex: 1 1 190px");
    expect(readCssRule(".device-state")).toContain("min-width: 0");
  });
});
