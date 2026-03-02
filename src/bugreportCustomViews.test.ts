import { describe, expect, it } from "vitest";
import {
  BUGREPORT_CUSTOM_VIEW_TEMPLATE_KINDS,
  DEFAULT_BUGREPORT_CUSTOM_VIEW_GROUP,
  groupBugreportCustomViews,
  hasBugreportCustomViewNameConflict,
  makeBugreportCustomViewId,
  parseBugreportCustomViewsFromStorage,
  type BugreportCustomViewTemplate,
} from "./bugreportCustomViews";

describe("bugreportCustomViews", () => {
  it("parses and normalizes stored custom view templates", () => {
    const raw = JSON.stringify([
      {
        name: "  Bluetooth Deep Dive  ",
        group: "  ",
        template_kind: "SERVICE",
        default_input: "  bluetooth_manager  ",
      },
      {
        name: " Audio App Focus ",
        group: "Apps",
        template_kind: "unknown-kind",
        default_input: "  com.example.audio  ",
      },
      {
        name: "   ",
      },
    ]);

    const templates = parseBugreportCustomViewsFromStorage(raw);
    expect(templates).toHaveLength(2);
    expect(templates[0]).toEqual({
      id: "uncategorized::bluetooth deep dive",
      group: DEFAULT_BUGREPORT_CUSTOM_VIEW_GROUP,
      name: "Bluetooth Deep Dive",
      template_kind: "service",
      default_input: "bluetooth_manager",
    });
    expect(templates[1]).toEqual({
      id: "apps::audio app focus",
      group: "Apps",
      name: "Audio App Focus",
      template_kind: "keyword",
      default_input: "com.example.audio",
    });
  });

  it("groups templates by group and sorts by group/name", () => {
    const templates: BugreportCustomViewTemplate[] = [
      {
        id: "bluetooth::zeta",
        group: "Bluetooth",
        name: "Zeta",
        template_kind: "service",
      },
      {
        id: "audio::beta",
        group: "Audio",
        name: "beta",
        template_kind: "keyword",
      },
      {
        id: "audio::alpha",
        group: "Audio",
        name: "Alpha",
        template_kind: "app",
      },
    ];

    const grouped = groupBugreportCustomViews(templates);
    expect(grouped.map((entry) => entry.group)).toEqual(["Audio", "Bluetooth"]);
    expect(grouped[0].views.map((entry) => entry.name)).toEqual(["Alpha", "beta"]);
  });

  it("detects name conflicts by group and allows ignore id", () => {
    const templates: BugreportCustomViewTemplate[] = [
      {
        id: "audio::crash",
        group: "Audio",
        name: "Crash",
        template_kind: "keyword",
      },
    ];

    expect(hasBugreportCustomViewNameConflict(templates, "Audio", "Crash")).toBe(true);
    expect(hasBugreportCustomViewNameConflict(templates, "audio", "crash")).toBe(true);
    expect(hasBugreportCustomViewNameConflict(templates, "Bluetooth", "Crash")).toBe(false);
    expect(
      hasBugreportCustomViewNameConflict(templates, "Audio", "Crash", "audio::crash"),
    ).toBe(false);
  });

  it("returns empty templates for invalid storage payload", () => {
    expect(parseBugreportCustomViewsFromStorage(null)).toEqual([]);
    expect(parseBugreportCustomViewsFromStorage("not-json")).toEqual([]);
    expect(parseBugreportCustomViewsFromStorage(JSON.stringify({}))).toEqual([]);
  });

  it("supports the built-in template kinds", () => {
    expect(BUGREPORT_CUSTOM_VIEW_TEMPLATE_KINDS).toEqual(["service", "app", "keyword"]);
    expect(makeBugreportCustomViewId("Audio", "Focus")).toBe("audio::focus");
  });
});
