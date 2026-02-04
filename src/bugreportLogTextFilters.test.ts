import { describe, expect, it } from "vitest";
import {
  addBugreportLogTextChip,
  buildBugreportLogTextFilters,
  removeBugreportLogTextChip,
  type BugreportLogTextChip,
} from "./bugreportLogTextFilters";

describe("bugreportLogTextFilters", () => {
  it("adds include chips and de-dupes by case-insensitive id", () => {
    const chips: BugreportLogTextChip[] = [];
    const next = addBugreportLogTextChip(chips, "include", "Bluetooth");
    const next2 = addBugreportLogTextChip(next, "include", "bluetooth");
    expect(next).toHaveLength(1);
    expect(next2).toHaveLength(1);
    expect(next2[0].value).toBe("Bluetooth");
  });

  it("adds exclude chips separately from include chips", () => {
    const chips: BugreportLogTextChip[] = [];
    const next = addBugreportLogTextChip(chips, "include", "foo");
    const next2 = addBugreportLogTextChip(next, "exclude", "foo");
    expect(next2).toHaveLength(2);
  });

  it("removes chips by id", () => {
    const chips = addBugreportLogTextChip([], "include", "foo");
    const id = chips[0].id;
    expect(removeBugreportLogTextChip(chips, id)).toEqual([]);
  });

  it("builds payload with include terms OR list and excludes", () => {
    const chips = [
      ...addBugreportLogTextChip([], "include", "wifi"),
      ...addBugreportLogTextChip([], "exclude", "Bluetooth"),
    ];
    const payload = buildBugreportLogTextFilters(chips);
    expect(payload.text_terms).toEqual(["wifi"]);
    expect(payload.text_excludes).toEqual(["Bluetooth"]);
  });
});

