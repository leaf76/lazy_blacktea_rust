import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");

const readCssRule = (selector: string): string => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`).exec(appCss)?.groups?.body ?? "";
};

describe("app shell theme cascade", () => {
  it("sets the inherited text color from active theme variables", () => {
    expect(readCssRule(".app-shell")).toContain("color: var(--color-text)");
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
