import { describe, expect, it } from "vitest";
import {
  applyDeviceDetailPatch,
  formatDeviceInfoMarkdown,
  mergeDeviceDetails,
  resolveSelectedSerials,
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

  it("formats device info as a markdown list", () => {
    const device: DeviceInfo = {
      summary: { serial: "alpha", state: "device", model: "Pixel" },
      detail: {
        serial: "alpha",
        android_version: "15",
        api_level: "35",
        wifi_is_on: true,
        bt_is_on: false,
        gms_version: "24.02",
        build_fingerprint: "fingerprint",
      },
    };

    const markdown = formatDeviceInfoMarkdown(device);

    expect(markdown).toContain("- **Serial:** alpha");
    expect(markdown).toContain("- **WiFi:** On");
    expect(markdown).toContain("- **Bluetooth:** Off");
  });
});
