import { describe, expect, it } from "vitest";
import type { DashboardCardView } from "./dashboardConfig";
import {
  buildDashboardCardMarkdown,
  buildDashboardFieldMarkdown,
  buildDashboardVariantMarkdown,
  buildDashboardVisibleMarkdown,
} from "./dashboardCopy";

describe("dashboardCopy", () => {
  it("formats field markdown as a single readable line", () => {
    const markdown = buildDashboardFieldMarkdown("Overview", "Primary Device", "Pixel 8\n(ABC)");

    expect(markdown).toBe("**Overview** Primary Device: Pixel 8 (ABC)");
  });

  it("formats variant markdown with serial context", () => {
    const markdown = buildDashboardVariantMarkdown(
      "Capacity & Battery",
      "Battery",
      "emulator-5554",
      "88%",
    );

    expect(markdown).toBe("**Capacity & Battery** Battery (emulator-5554): 88%");
  });

  it("builds card markdown and includes only visible variants", () => {
    const card: DashboardCardView = {
      id: "capacity_battery",
      title: "Capacity & Battery",
      description: "Battery, memory, storage, and radios.",
      fields: [
        {
          id: "battery_level",
          label: "Battery",
          value: "2 variants",
          variants: [
            { serial: "A1", value: "88%" },
            { serial: "B2", value: "42%" },
          ],
        },
        {
          id: "memory_total",
          label: "Memory",
          value: "8 GB",
          variants: [],
        },
      ],
    };

    const hiddenVariants = buildDashboardCardMarkdown(card, {
      isFieldVariantVisible: () => false,
    });
    const visibleVariants = buildDashboardCardMarkdown(card, {
      isFieldVariantVisible: (cardId, fieldId) =>
        cardId === "capacity_battery" && fieldId === "battery_level",
    });

    expect(hiddenVariants).toBe(["## Capacity & Battery", "- Battery: 2 variants", "- Memory: 8 GB"].join("\n"));
    expect(visibleVariants).toBe(
      [
        "## Capacity & Battery",
        "- Battery: 2 variants",
        "  - A1: 88%",
        "  - B2: 42%",
        "- Memory: 8 GB",
      ].join("\n"),
    );
  });

  it("builds visible markdown by card order", () => {
    const cards: DashboardCardView[] = [
      {
        id: "overview",
        title: "Overview",
        description: "Selection and execution summary.",
        fields: [{ id: "selected_count", label: "Selected", value: "2", variants: [] }],
      },
      {
        id: "connection_health",
        title: "Connection Health",
        description: "Host tooling and selected device readiness.",
        fields: [{ id: "adb_status", label: "ADB", value: "Available", variants: [] }],
      },
    ];

    const markdown = buildDashboardVisibleMarkdown(cards);

    expect(markdown).toBe(
      ["## Overview", "- Selected: 2", "", "## Connection Health", "- ADB: Available"].join("\n"),
    );
  });
});
