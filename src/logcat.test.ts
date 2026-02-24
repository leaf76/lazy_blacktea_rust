import { describe, expect, it } from "vitest";
import {
  appendRetainedLogcatEntries,
  buildLogcatFilter,
  filterLogcatEntriesByBaseFilters,
  filterLogcatEntriesBySearch,
  filterLogcatLines,
  isLogcatBaseFilterActive,
  mergeLogcatEntriesById,
  parseLogcatLevel,
  parsePidOutput,
  type LogcatBaseFilterState,
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

  it("supports exclude patterns without requiring include patterns", () => {
    const lines = [
      "D/ActivityManager( 123): start",
      "E/NetworkPolicy( 99): failed",
      "W/Other( 88): warning",
    ];
    const result = filterLogcatLines(lines, {
      levels: { V: true, D: true, I: true, W: true, E: true, F: true },
      activePatterns: [],
      excludePatterns: ["Network"],
      livePattern: "",
      searchTerm: "",
      searchCaseSensitive: false,
      searchRegex: false,
      searchOnly: false,
    });
    expect(result.lines).toEqual([
      "D/ActivityManager( 123): start",
      "W/Other( 88): warning",
    ]);
    expect(result.matchIndices).toEqual([]);
  });

  it("applies include patterns first and then excludes matching lines", () => {
    const lines = [
      "D/ActivityManager( 123): start",
      "E/NetworkPolicy( 99): failed",
      "W/Other( 88): warning",
    ];
    const result = filterLogcatLines(lines, {
      levels: { V: true, D: true, I: true, W: true, E: true, F: true },
      activePatterns: ["Network", "Other"],
      excludePatterns: ["Other"],
      livePattern: "",
      searchTerm: "",
      searchCaseSensitive: false,
      searchRegex: false,
      searchOnly: false,
    });
    expect(result.lines).toEqual(["E/NetworkPolicy( 99): failed"]);
    expect(result.matchIndices).toEqual([]);
  });

  it("detects when base filters are active", () => {
    expect(
      isLogcatBaseFilterActive({
        levels: { V: true, D: true, I: true, W: true, E: true, F: true },
        activePatterns: [],
        excludePatterns: [],
        livePattern: "",
      }),
    ).toBe(false);

    expect(
      isLogcatBaseFilterActive({
        levels: { V: false, D: true, I: true, W: true, E: true, F: true },
        activePatterns: [],
        excludePatterns: [],
        livePattern: "",
      }),
    ).toBe(true);
  });

  it("appends retained logcat entries with dedupe and limit", () => {
    const existing = [
      { id: 1, text: "E/Tag: first" },
      { id: 2, text: "E/Tag: second" },
    ];
    const incoming = [
      { id: 2, text: "E/Tag: second duplicate" },
      { id: 3, text: "E/Tag: third" },
      { id: 4, text: "E/Tag: fourth" },
    ];

    expect(appendRetainedLogcatEntries(existing, incoming, 3)).toEqual([
      { id: 2, text: "E/Tag: second" },
      { id: 3, text: "E/Tag: third" },
      { id: 4, text: "E/Tag: fourth" },
    ]);
  });

  it("merges retained entries and raw filtered entries by id", () => {
    const retained = [
      { id: 1, text: "E/Tag: old match" },
      { id: 5, text: "W/Tag: retained" },
    ];
    const rawFiltered = [
      { id: 5, text: "W/Tag: from raw" },
      { id: 9, text: "E/Tag: new match" },
    ];

    expect(mergeLogcatEntriesById(retained, rawFiltered)).toEqual([
      { id: 1, text: "E/Tag: old match" },
      { id: 5, text: "W/Tag: retained" },
      { id: 9, text: "E/Tag: new match" },
    ]);
  });

  it("keeps base filtering and search filtering as separate stages", () => {
    const batchA = [
      { id: 1, text: "E/Tag(  1): crash alpha" },
      { id: 2, text: "I/Tag(  1): noise" },
      { id: 3, text: "E/Tag(  1): crash beta" },
    ];
    const batchB = Array.from({ length: 2500 }, (_, index) => ({
      id: index + 4,
      text: "I/Tag(  1): noise",
    }));

    const baseState: LogcatBaseFilterState = {
      levels: { V: false, D: false, I: false, W: true, E: true, F: true },
      activePatterns: ["crash"],
      excludePatterns: [],
      livePattern: "",
    };

    const retainedFromA = filterLogcatEntriesByBaseFilters(batchA, baseState);
    const rawWindowFromB = filterLogcatEntriesByBaseFilters(batchB, baseState);
    expect(rawWindowFromB).toEqual([]);

    const merged = mergeLogcatEntriesById(retainedFromA, rawWindowFromB);
    expect(merged).toEqual([
      { id: 1, text: "E/Tag(  1): crash alpha" },
      { id: 3, text: "E/Tag(  1): crash beta" },
    ]);

    const searched = filterLogcatEntriesBySearch(merged, {
      searchTerm: "alpha",
      searchCaseSensitive: false,
      searchRegex: false,
      searchOnly: true,
    });

    expect(searched.lines).toEqual([{ id: 1, text: "E/Tag(  1): crash alpha" }]);
    expect(searched.matchIds).toEqual([1]);
  });
});
