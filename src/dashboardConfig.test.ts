import { describe, expect, it } from "vitest";
import {
  buildDashboardCardViews,
  buildDefaultDashboardSettings,
  moveDashboardField,
  normalizeDashboardSettings,
  resolveDashboardPrimaryDeviceParts,
  toggleDashboardField,
} from "./dashboardConfig";
import type { DashboardSettings, DeviceInfo } from "./types";

const buildDevice = (
  serial: string,
  overrides: Partial<DeviceInfo> = {},
): DeviceInfo => ({
  summary: {
    serial,
    state: "device",
    model: serial,
    ...(overrides.summary ?? {}),
  },
  detail: {
    serial,
    model: serial,
    ...(overrides.detail ?? {}),
  },
});

describe("dashboardConfig", () => {
  it("resolves primary device parts from active serial when available", () => {
    const devices: DeviceInfo[] = [
      buildDevice("A", { detail: { serial: "A", model: "Pixel 8" } }),
      buildDevice("B", { detail: { serial: "B", model: "Pixel 9 Pro" } }),
    ];

    expect(resolveDashboardPrimaryDeviceParts(devices, ["A", "B"], "B")).toEqual({
      name: "Pixel 9 Pro",
      serial: "B",
    });
  });

  it("falls back to the first selected device when active serial is missing", () => {
    const devices: DeviceInfo[] = [
      buildDevice("A", { detail: { serial: "A", model: "Pixel 8" } }),
      buildDevice("B", { detail: { serial: "B", model: "Pixel 9" } }),
    ];

    expect(resolveDashboardPrimaryDeviceParts(devices, ["A", "B"], "C")).toEqual({
      name: "Pixel 8",
      serial: "A",
    });
  });

  it("returns null when there are no selected devices", () => {
    const devices: DeviceInfo[] = [buildDevice("A", { detail: { serial: "A", model: "Pixel 8" } })];

    expect(resolveDashboardPrimaryDeviceParts(devices, [], "A")).toBeNull();
  });

  it("uses fallback chain for primary name: detail.model -> summary.model -> serial", () => {
    const withDetail: DeviceInfo = buildDevice("A", {
      summary: { serial: "A", state: "device", model: "Summary Model A" },
      detail: { serial: "A", model: "Detail Model A" },
    });
    const withSummaryOnly: DeviceInfo = {
      summary: { serial: "B", state: "device", model: "Summary Model B" },
      detail: { serial: "B", model: "   " },
    };
    const withSerialOnly: DeviceInfo = {
      summary: { serial: "C", state: "device", model: "   " },
      detail: { serial: "C", model: "   " },
    };

    expect(resolveDashboardPrimaryDeviceParts([withDetail], ["A"], "A")).toEqual({
      name: "Detail Model A",
      serial: "A",
    });
    expect(resolveDashboardPrimaryDeviceParts([withSummaryOnly], ["B"], "B")).toEqual({
      name: "Summary Model B",
      serial: "B",
    });
    expect(resolveDashboardPrimaryDeviceParts([withSerialOnly], ["C"], "C")).toEqual({
      name: "C",
      serial: "C",
    });
  });

  it("returns balanced defaults when settings are missing", () => {
    const normalized = normalizeDashboardSettings();
    expect(normalized.cards).toHaveLength(4);
    expect(normalized.cards[0]?.id).toBe("overview");
    expect(normalized.cards[0]?.fields).toHaveLength(6);
  });

  it("preserves explicit field toggles while restoring missing fields", () => {
    const partial: DashboardSettings = {
      cards: [
        {
          id: "overview",
          enabled: true,
          order: 0,
          fields: [
            { id: "selected_count", enabled: false, order: 0 },
            { id: "online_count", enabled: true, order: 1 },
          ],
        },
      ],
    };

    const normalized = normalizeDashboardSettings(partial);
    const overview = normalized.cards.find((card) => card.id === "overview");
    expect(overview).toBeTruthy();
    expect(overview?.fields).toHaveLength(6);
    expect(overview?.fields.find((field) => field.id === "selected_count")?.enabled).toBe(false);
    expect(overview?.fields.find((field) => field.id === "offline_count")?.enabled).toBe(true);
  });

  it("moves field order up and down with stable boundaries", () => {
    const defaults = buildDefaultDashboardSettings();
    const movedUp = moveDashboardField(defaults, "overview", "primary_device", "up");
    const overviewUp = movedUp.cards.find((card) => card.id === "overview");
    const primaryUp = overviewUp?.fields.find((field) => field.id === "primary_device");
    expect(primaryUp?.order).toBe(3);

    const movedDown = moveDashboardField(movedUp, "overview", "selected_count", "down");
    const overviewDown = movedDown.cards.find((card) => card.id === "overview");
    const selectedDown = overviewDown?.fields.find((field) => field.id === "selected_count");
    expect(selectedDown?.order).toBe(1);
  });

  it("builds variant summary for multi-device mismatched values", () => {
    const devices: DeviceInfo[] = [
      buildDevice("A", { detail: { serial: "A", model: "Pixel 8" } }),
      buildDevice("B", { detail: { serial: "B", model: "Pixel 9" } }),
    ];

    const cards = buildDashboardCardViews(
      {
        devices,
        selectedSerials: ["A", "B"],
        activeSerial: "A",
        runningTaskCount: 2,
        selectedConnectedCount: 2,
        adbAvailable: true,
        scrcpyAvailable: false,
      },
      undefined,
    );

    const profile = cards.find((card) => card.id === "device_profile");
    const model = profile?.fields.find((field) => field.id === "model");
    expect(model?.value).toBe("2 variants");
    expect(model?.variants).toHaveLength(2);
  });

  it("supports disabling fields through toggle", () => {
    const defaults = buildDefaultDashboardSettings();
    const next = toggleDashboardField(defaults, "overview", "running_tasks", false);
    const overview = next.cards.find((card) => card.id === "overview");
    expect(overview?.fields.find((field) => field.id === "running_tasks")?.enabled).toBe(false);
  });
});
