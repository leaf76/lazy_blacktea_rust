import { describe, expect, it } from "vitest";
import { parseIntegerSettingInput } from "./settingsInput";

describe("settings input helpers", () => {
  it("preserves the current value for blank or invalid numeric input", () => {
    expect(parseIntegerSettingInput("", 30)).toBe(30);
    expect(parseIntegerSettingInput("  ", 30)).toBe(30);
    expect(parseIntegerSettingInput("abc", 30)).toBe(30);
    expect(parseIntegerSettingInput("Infinity", 30)).toBe(30);
  });

  it("clamps parsed integer input to the configured minimum", () => {
    expect(parseIntegerSettingInput("0", 5, { min: 1 })).toBe(1);
    expect(parseIntegerSettingInput("-10", -1, { min: -1 })).toBe(-1);
    expect(parseIntegerSettingInput("12.9", 1, { min: 0 })).toBe(12);
  });
});
