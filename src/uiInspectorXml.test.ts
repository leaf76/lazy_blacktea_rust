import { describe, expect, it } from "vitest";
import { buildUiInspectorXmlView, filterUiInspectorXmlLines } from "./uiInspectorXml";

describe("uiInspectorXml", () => {
  it("pretty prints nested xml with indentation", () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><hierarchy><node text="Root"><child text="Leaf"/></node></hierarchy>';

    const view = buildUiInspectorXmlView(xml);

    expect(view.pretty).toContain("\n  <node text=\"Root\">");
    expect(view.pretty).toContain("\n    <child text=\"Leaf\"/>");
    expect(view.pretty).toContain("\n  </node>");
  });

  it("falls back to raw xml when pretty formatting fails", () => {
    const xml = "<hierarchy><node></hierarchy>";
    const view = buildUiInspectorXmlView(xml);

    expect(view.pretty).toBe(xml);
    expect(view.prettyAvailable).toBe(false);
  });

  it("filters xml by query using case-insensitive line matching", () => {
    const xml = ["<hierarchy>", '  <node text="Home"/>', '  <node text="Settings"/>', "</hierarchy>"].join("\n");

    expect(filterUiInspectorXmlLines(xml, "setTings")).toBe('  <node text="Settings"/>');
  });
});
