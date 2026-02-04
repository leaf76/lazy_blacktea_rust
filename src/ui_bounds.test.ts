import { describe, expect, it } from "vitest";
import { parseUiBoundsRects, parseUiNodes, pickUiNodeAtPoint } from "./ui_bounds";

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

describe("parseUiNodes", () => {
  it("extracts node metadata from uiautomator XML", () => {
    const xml =
      `<node index="0" text="Hello" resource-id="android:id/content" class="android.widget.FrameLayout" ` +
      `package="com.example" content-desc="desc" clickable="true" enabled="false" ` +
      `bounds="[0,0][10,20]" />`;
    const parsed = parseUiNodes(xml);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].rect).toEqual({ x: 0, y: 0, w: 10, h: 20 });
    expect(parsed.nodes[0].text).toBe("Hello");
    expect(parsed.nodes[0].resourceId).toBe("android:id/content");
    expect(parsed.nodes[0].className).toBe("android.widget.FrameLayout");
    expect(parsed.nodes[0].packageName).toBe("com.example");
    expect(parsed.nodes[0].contentDesc).toBe("desc");
    expect(parsed.nodes[0].clickable).toBe(true);
    expect(parsed.nodes[0].enabled).toBe(false);
  });
});

describe("pickUiNodeAtPoint", () => {
  it("prefers the smallest node that contains the point", () => {
    const xml =
      `<node bounds="[0,0][100,100]" />` +
      `<node bounds="[10,10][20,20]" />` +
      `<node bounds="[30,30][90,90]" />`;
    const parsed = parseUiNodes(xml);
    const idx = pickUiNodeAtPoint(parsed.nodes, 15, 15);
    expect(idx).toBe(1);
  });
});
