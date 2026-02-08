import { describe, expect, it } from "vitest";
import {
  addLogTextChip,
  buildLogTextFilters,
  removeLogTextChip,
  type LogTextChip,
} from "./logTextFilters";

describe("logTextFilters", () => {
  it("adds include chips and de-dupes by case-insensitive id", () => {
    const chips: LogTextChip[] = [];
    const next = addLogTextChip(chips, "include", "Bluetooth");
    const next2 = addLogTextChip(next, "include", "bluetooth");
    expect(next).toHaveLength(1);
    expect(next2).toHaveLength(1);
    expect(next2[0].value).toBe("Bluetooth");
  });

  it("adds exclude chips separately from include chips", () => {
    const chips: LogTextChip[] = [];
    const next = addLogTextChip(chips, "include", "foo");
    const next2 = addLogTextChip(next, "exclude", "foo");
    expect(next2).toHaveLength(2);
  });

  it("removes chips by id", () => {
    const chips = addLogTextChip([], "include", "foo");
    const id = chips[0].id;
    expect(removeLogTextChip(chips, id)).toEqual([]);
  });

  it("builds payload with include terms OR list and excludes", () => {
    const chips = [
      ...addLogTextChip([], "include", "wifi"),
      ...addLogTextChip([], "exclude", "Bluetooth"),
    ];
    const payload = buildLogTextFilters(chips);
    expect(payload.text_terms).toEqual(["wifi"]);
    expect(payload.text_excludes).toEqual(["Bluetooth"]);
  });
});

