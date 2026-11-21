import { describe, expect, it } from "vitest";
import { buildUiNodeSelectors } from "./uiInspectorSelectors";
import type { UiNodeInfo } from "./ui_bounds";

const baseRect = { x: 0, y: 0, w: 100, h: 40 };

describe("uiInspectorSelectors", () => {
  it("prefers resource-id for XPath and UiSelector", () => {
    const node: UiNodeInfo = {
      rect: baseRect,
      bounds: "[0,0][100,40]",
      className: "android.widget.Button",
      resourceId: "com.example:id/submit_btn",
      text: "Submit",
      clickable: true,
      enabled: true,
    };
    const result = buildUiNodeSelectors(node);
    expect(result.xpath).toBe('//android.widget.Button[@resource-id="com.example:id/submit_btn"]');
    expect(result.uiSelector).toBe(
      'new UiSelector().className("android.widget.Button").resourceId("com.example:id/submit_btn")',
    );
    expect(result.flags).toEqual(["clickable", "enabled"]);
  });

  it("falls back to content-desc, then text, and safely escapes quotes", () => {
    const byDesc = buildUiNodeSelectors({
      rect: baseRect,
      bounds: "[0,0][100,40]",
      className: "android.widget.ImageView",
      contentDesc: 'Say "Hi"',
    });
    expect(byDesc.xpath).toBe(`//android.widget.ImageView[@content-desc='Say "Hi"']`);
    expect(byDesc.uiSelector).toContain('.description("Say \\"Hi\\"")');

    const byText = buildUiNodeSelectors({
      rect: baseRect,
      bounds: "[0,0][100,40]",
      className: "android.widget.TextView",
      text: "Hello",
    });
    expect(byText.xpath).toBe('//android.widget.TextView[@text="Hello"]');
    expect(byText.uiSelector).toBe('new UiSelector().className("android.widget.TextView").text("Hello")');
  });
});
