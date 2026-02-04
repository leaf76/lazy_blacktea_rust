import { describe, expect, it } from "vitest";
import { bugreportLogLineMatches, buildBugreportLogFindPattern } from "./bugreportLogFind";

describe("bugreportLogFind", () => {
  it("returns null for empty term", () => {
    expect(buildBugreportLogFindPattern("   ", { caseSensitive: false, regex: false })).toBeNull();
  });

  it("matches plain text case-insensitively by default", () => {
    const pattern = buildBugreportLogFindPattern("bluetooth", { caseSensitive: false, regex: false });
    expect(bugreportLogLineMatches(pattern, "Bluetooth service started")).toBe(true);
  });

  it("respects case sensitivity", () => {
    const pattern = buildBugreportLogFindPattern("bluetooth", { caseSensitive: true, regex: false });
    expect(bugreportLogLineMatches(pattern, "Bluetooth service started")).toBe(false);
  });

  it("supports regex", () => {
    const pattern = buildBugreportLogFindPattern("b.*h", { caseSensitive: false, regex: true });
    expect(bugreportLogLineMatches(pattern, "Bluetooth service started")).toBe(true);
  });

  it("reports invalid regex", () => {
    const pattern = buildBugreportLogFindPattern("(", { caseSensitive: false, regex: true });
    expect(pattern).not.toBeNull();
    expect(pattern?.error).toBeTruthy();
    expect(bugreportLogLineMatches(pattern, "anything")).toBe(false);
  });
});

