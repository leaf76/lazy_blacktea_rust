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
});
