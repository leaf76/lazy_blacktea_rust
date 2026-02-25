import { describe, expect, it } from "vitest";
import {
  applyDeviceDetailPatch,
  filterDevicesBySearch,
  formatPrimaryDeviceLabel,
  formatDeviceInfoMarkdown,
  mergeDeviceDetails,
  reduceSelectionToOne,
  resolvePrimarySerial,
  resolveSelectedSerials,
  setPrimarySelection,
  shouldEnableConnectivityForSelection,
  selectSerialsForGroup,
} from "./deviceUtils";
import type { DeviceInfo } from "./types";

describe("deviceUtils", () => {
  it("merges detailed device info and drops missing devices", () => {
    const current: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: { serial: "alpha", wifi_is_on: false },
      },
      {
        summary: { serial: "bravo", state: "offline" },
        detail: null,
      },
    ];

    const detailed: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device", model: "Pixel" },
        detail: { serial: "alpha", wifi_is_on: true, bt_is_on: false },
      },
      {
        summary: { serial: "charlie", state: "device" },
        detail: { serial: "charlie", wifi_is_on: true },
      },
    ];

    const merged = mergeDeviceDetails(current, detailed);

    expect(merged).toHaveLength(2);
    expect(merged[0].summary.serial).toBe("alpha");
    expect(merged[0].detail?.wifi_is_on).toBe(true);
    expect(merged[1].summary.serial).toBe("charlie");
  });

  it("preserves existing detail when incoming detail is missing", () => {
    const current: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: { serial: "alpha", wifi_is_on: true },
      },
    ];

    const incoming: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: null,
      },
    ];

    const merged = mergeDeviceDetails(current, incoming, { preserveMissingDetail: true });

    expect(merged[0].detail?.wifi_is_on).toBe(true);
  });

  it("applies detail patches only to targeted devices", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: { serial: "alpha", wifi_is_on: false, bt_is_on: false },
      },
      {
        summary: { serial: "bravo", state: "device" },
        detail: null,
      },
    ];

    const updated = applyDeviceDetailPatch(devices, ["bravo"], { wifi_is_on: true });

    expect(updated[0].detail?.wifi_is_on).toBe(false);
    expect(updated[1].detail?.wifi_is_on).toBe(true);
    expect(updated[1].detail?.serial).toBe("bravo");
  });

  it("resolves selection to preferred device when previous selection is invalid", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "offline" }, detail: null },
      { summary: { serial: "bravo", state: "device" }, detail: null },
    ];

    const resolved = resolveSelectedSerials(["missing"], devices);

    expect(resolved).toEqual(["bravo"]);
  });

  it("resolves primary serial from the first selected device", () => {
    expect(resolvePrimarySerial([])).toBeNull();
    expect(resolvePrimarySerial(["alpha"])).toBe("alpha");
    expect(resolvePrimarySerial(["alpha", "bravo"])).toBe("alpha");
  });

  it("formats primary device label with model and serial", () => {
    const device: DeviceInfo = {
      summary: { serial: "alpha", state: "device", model: "Pixel 8" },
      detail: { serial: "alpha", model: "Pixel 8 Pro" },
    };
    expect(formatPrimaryDeviceLabel("alpha", device)).toBe("Pixel 8 Pro (alpha)");
    expect(formatPrimaryDeviceLabel("alpha", null)).toBe("alpha");
    expect(formatPrimaryDeviceLabel(null, null)).toBe("Unknown device");
  });

  it("formats device info as a markdown list", () => {
    const device: DeviceInfo = {
      summary: { serial: "alpha", state: "device", model: "Pixel" },
      detail: {
        serial: "alpha",
        name: "panther",
        brand: "google",
        serial_number: "ABC123",
        android_version: "15",
        api_level: "35",
        processor: "Tensor",
        resolution: "1080x2400",
        storage_total_bytes: 137_438_953_472,
        memory_total_bytes: 8 * 1024 * 1024 * 1024,
        wifi_is_on: true,
        bt_is_on: false,
        gms_version: "24.02",
        build_fingerprint: "fingerprint",
      },
    };

    const markdown = formatDeviceInfoMarkdown(device);

    expect(markdown).toContain("- **Serial:** alpha");
    expect(markdown).toContain("- **Name:** panther");
    expect(markdown).toContain("- **Brand:** google");
    expect(markdown).toContain("- **Serial Number:** ABC123");
    expect(markdown).toContain("- **Processor:** Tensor");
    expect(markdown).toContain("- **Resolution:** 1080x2400");
    expect(markdown).toContain("- **Storage:** 128 GB");
    expect(markdown).toContain("- **Memory:** 8.00 GB");
    expect(markdown).toContain("- **WiFi:** On");
    expect(markdown).toContain("- **Bluetooth:** Off");
  });

  it("reduces selection to one device while keeping the primary when possible", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "offline" }, detail: null },
      { summary: { serial: "bravo", state: "device" }, detail: null },
    ];

    expect(reduceSelectionToOne([], devices)).toEqual(["bravo"]);
    expect(reduceSelectionToOne(["alpha", "bravo"], devices)).toEqual(["alpha"]);
    expect(reduceSelectionToOne(["missing"], devices)).toEqual(["bravo"]);
    expect(reduceSelectionToOne(["missing"], [])).toEqual([]);
  });

  it("filters devices by search text (serial or model)", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "alpha-1", state: "device", model: "Pixel" },
        detail: { serial: "alpha-1", model: "Pixel 8" },
      },
      {
        summary: { serial: "bravo-2", state: "device", model: "Nexus" },
        detail: null,
      },
    ];

    expect(filterDevicesBySearch(devices, "")).toHaveLength(2);
    expect(filterDevicesBySearch(devices, "ALPHA")).toEqual([devices[0]]);
    expect(filterDevicesBySearch(devices, "pixel")).toEqual([devices[0]]);
    expect(filterDevicesBySearch(devices, "  nexus  ")).toEqual([devices[1]]);
  });

  it("selects serials by group, keeping device order and supporting all-devices preset", () => {
    const devices: DeviceInfo[] = [
      { summary: { serial: "alpha", state: "device" }, detail: null },
      { summary: { serial: "bravo", state: "device" }, detail: null },
      { summary: { serial: "charlie", state: "device" }, detail: null },
    ];
    const groupMap: Record<string, string> = {
      alpha: "Test",
      bravo: "Prod",
    };

    expect(selectSerialsForGroup(devices, groupMap, "Test")).toEqual(["alpha"]);
    expect(selectSerialsForGroup(devices, groupMap, "__all_devices__")).toEqual(["alpha", "bravo", "charlie"]);
    expect(selectSerialsForGroup(devices, groupMap, "Missing")).toEqual([]);
  });

  it("reorders selection when setting primary while preserving remaining order", () => {
    expect(setPrimarySelection(["alpha", "bravo", "charlie"], "bravo")).toEqual([
      "bravo",
      "alpha",
      "charlie",
    ]);
  });

  it("keeps selection unchanged when target is already primary", () => {
    const selection = ["alpha", "bravo", "charlie"];
    expect(setPrimarySelection(selection, "alpha")).toEqual(selection);
  });

  it("inserts target as primary when target is not in selection", () => {
    expect(setPrimarySelection(["alpha", "bravo"], "charlie")).toEqual(["charlie", "alpha", "bravo"]);
  });

  it("uses force-enable strategy for connectivity quick actions", () => {
    const devices: DeviceInfo[] = [
      {
        summary: { serial: "alpha", state: "device" },
        detail: { serial: "alpha", wifi_is_on: true, bt_is_on: true },
      },
      {
        summary: { serial: "bravo", state: "device" },
        detail: { serial: "bravo", wifi_is_on: false, bt_is_on: true },
      },
      {
        summary: { serial: "charlie", state: "offline" },
        detail: null,
      },
    ];

    expect(shouldEnableConnectivityForSelection(devices, ["alpha"], "wifi_is_on")).toBe(false);
    expect(shouldEnableConnectivityForSelection(devices, ["alpha", "bravo"], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, ["alpha", "charlie"], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, ["charlie"], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, [], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, ["missing"], "wifi_is_on")).toBe(true);
    expect(shouldEnableConnectivityForSelection(devices, ["alpha", "bravo"], "bt_is_on")).toBe(false);
  });
});
