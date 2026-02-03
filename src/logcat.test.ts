import { describe, expect, it } from "vitest";
import {
  buildLogcatFilter,
  filterLogcatLines,
  parseLogcatLevel,
  parsePidOutput,
} from "./logcat";

describe("logcat helpers", () => {
  it("parses pid output", () => {
    expect(parsePidOutput("1234\n")).toEqual(["1234"]);
    expect(parsePidOutput("1234 5678")).toEqual(["1234", "5678"]);
    expect(parsePidOutput(" \n")).toEqual([]);
  });

  it("builds logcat filters", () => {
    expect(
      buildLogcatFilter({
        sourceMode: "raw",
        sourceValue: "ActivityManager:D *:S",
      }),
    ).toBe("ActivityManager:D *:S");

    expect(
      buildLogcatFilter({
        sourceMode: "tag",
        sourceValue: "ActivityManager",
      }),
    ).toBe("ActivityManager:V *:S");

    expect(
      buildLogcatFilter({
        sourceMode: "package",
        sourceValue: "com.example.app",
        pids: ["123", "456"],
      }),
    ).toBe("--pid=123 --pid=456 *:V");
  });

  it("parses logcat levels", () => {
    expect(parseLogcatLevel("D/ActivityManager( 123): msg")).toBe("D");
    expect(parseLogcatLevel("I/NetworkPolicy: something")).toBe("I");
    expect(parseLogcatLevel("random line")).toBeNull();
  });

  it("filters logcat lines and finds search matches", () => {
    const lines = [
      "D/ActivityManager( 123): start",
      "E/NetworkPolicy( 99): failed",
      "W/Other( 88): warning",
    ];
    const result = filterLogcatLines(lines, {
      levels: { V: false, D: false, I: false, W: true, E: true, F: false },
      activePatterns: ["Network", "Other"],
      livePattern: "",
      searchTerm: "fail",
      searchCaseSensitive: false,
      searchRegex: false,
      searchOnly: false,
    });
    expect(result.lines).toEqual([
      "E/NetworkPolicy( 99): failed",
      "W/Other( 88): warning",
    ]);
    expect(result.matchIndices).toEqual([0]);
  });
});
