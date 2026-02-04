import { describe, expect, it } from "vitest";
import { parseUiBoundsRects } from "./ui_bounds";

describe("parseUiBoundsRects", () => {
  it("parses uiautomator bounds", () => {
    const xml = `<node bounds="[0,0][1344,2992]" />`;
    const result = parseUiBoundsRects(xml);
    expect(result.rects).toHaveLength(1);
    expect(result.rects[0]).toEqual({ x: 0, y: 0, w: 1344, h: 2992 });
  });

  it("supports negative coords and whitespace", () => {
    const xml = `<node bounds="[ -1, 2 ][ 10, 12 ]" />`;
    const result = parseUiBoundsRects(xml);
    expect(result.rects).toHaveLength(1);
    expect(result.rects[0]).toEqual({ x: -1, y: 2, w: 11, h: 10 });
  });
});

