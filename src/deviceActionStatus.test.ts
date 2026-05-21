import { describe, expect, it } from "vitest";

import {
  buildDeviceCommandStatusStack,
  buildDeviceQuickActionButtonLabel,
  buildDeviceQuickActionDeviceStatus,
  buildDeviceQuickActionSelectionStatus,
  type DeviceQuickActionKind,
  type DeviceQuickActionPhase,
  type DeviceQuickActionStatus,
} from "./deviceActionStatus";

const quickStatus = (
  kind: DeviceQuickActionKind,
  phase: DeviceQuickActionPhase,
  id = `${kind}-${phase}`,
): DeviceQuickActionStatus => ({
  id,
  kind,
  phase,
});

describe("device action status helpers", () => {
  it("does not show quick action status for idle devices", () => {
    expect(buildDeviceQuickActionDeviceStatus(undefined)).toBeNull();
    expect(buildDeviceQuickActionSelectionStatus(["alpha"], {})).toBeNull();
  });

  it("shows screenshot pending, success, and error status", () => {
    expect(buildDeviceQuickActionDeviceStatus(quickStatus("screenshot", "pending"))).toEqual({
      label: "Capturing...",
      tone: "busy",
      title: "Screenshot capture is running.",
    });
    expect(buildDeviceQuickActionDeviceStatus(quickStatus("screenshot", "success"))).toEqual({
      label: "Screenshot saved",
      tone: "ok",
      title: "Screenshot saved.",
    });
    expect(buildDeviceQuickActionDeviceStatus(quickStatus("screenshot", "error"))).toEqual({
      label: "Screenshot failed",
      tone: "error",
      title: "Screenshot failed.",
    });
    expect(
      buildDeviceQuickActionSelectionStatus(
        ["alpha", "bravo"],
        {
          alpha: quickStatus("screenshot", "pending"),
          bravo: quickStatus("screenshot", "pending"),
        },
      ),
    ).toEqual({
      text: "Capturing screenshots on 2 selected devices...",
      tone: "busy",
    });
  });

  it("summarizes mixed WiFi and Bluetooth results", () => {
    expect(
      buildDeviceQuickActionSelectionStatus(
        ["alpha", "bravo"],
        {
          alpha: quickStatus("wifi_on", "success"),
          bravo: quickStatus("wifi_on", "error"),
        },
      ),
    ).toEqual({
      text: "WiFi turned on for 1 selected device. Failed on 1 selected device.",
      tone: "error",
    });
    expect(
      buildDeviceQuickActionSelectionStatus(
        ["alpha"],
        {
          alpha: quickStatus("bluetooth_off", "pending"),
        },
      ),
    ).toEqual({
      text: "Turning Bluetooth off for 1 selected device...",
      tone: "busy",
    });
  });

  it("shows mirror launch and reboot feedback", () => {
    expect(buildDeviceQuickActionDeviceStatus(quickStatus("mirror_launch", "pending"))).toEqual({
      label: "Launching...",
      tone: "busy",
      title: "Live Mirror launch is running.",
    });
    expect(buildDeviceQuickActionDeviceStatus(quickStatus("mirror_launch", "success"))).toEqual({
      label: "Mirror launched",
      tone: "ok",
      title: "Live Mirror launched.",
    });
    expect(
      buildDeviceQuickActionSelectionStatus(
        ["alpha", "bravo"],
        {
          alpha: quickStatus("reboot", "success"),
          bravo: quickStatus("reboot", "error"),
        },
      ),
    ).toEqual({
      text: "Reboot sent to 1 selected device. Failed on 1 selected device.",
      tone: "error",
    });
  });

  it("overrides direct button labels while matching actions are pending", () => {
    expect(
      buildDeviceQuickActionButtonLabel(
        "Screenshot",
        "Capturing...",
        ["alpha"],
        { alpha: quickStatus("screenshot", "pending") },
        ["screenshot"],
      ),
    ).toBe("Capturing...");
    expect(
      buildDeviceQuickActionButtonLabel(
        "Live Mirror",
        "Launching...",
        ["alpha"],
        { alpha: quickStatus("wifi_on", "pending") },
        ["mirror_launch"],
      ),
    ).toBe("Live Mirror");
  });

  it("prioritizes pending summaries over older completed status", () => {
    expect(
      buildDeviceQuickActionSelectionStatus(
        ["alpha", "bravo"],
        {
          alpha: quickStatus("screenshot", "success", "old-screenshot"),
          bravo: quickStatus("wifi_on", "pending", "new-wifi"),
        },
      ),
    ).toEqual({
      text: "Turning WiFi on for 1 selected device...",
      tone: "busy",
    });
  });

  it("keeps quick action and recording summaries as separate stack items", () => {
    expect(
      buildDeviceCommandStatusStack(
        { text: "Capturing screenshots on 1 selected device...", tone: "busy" },
        { text: "Recording: /sdcard/alpha.mp4", tone: "error" },
      ),
    ).toEqual([
      { id: "quick-action", text: "Capturing screenshots on 1 selected device...", tone: "busy" },
      { id: "screen-record", text: "Recording: /sdcard/alpha.mp4", tone: "error" },
    ]);
  });
});
