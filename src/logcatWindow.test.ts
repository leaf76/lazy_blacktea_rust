import { describe, expect, it } from "vitest";
import {
  buildLogcatPopupHash,
  buildLogcatPopupWindowLabel,
  parseLogcatPopupContext,
} from "./logcatWindow";

describe("logcatWindow", () => {
  it("parses popup context from hash search query", () => {
    expect(parseLogcatPopupContext("?popup=1&serial=emulator-5554")).toEqual({
      isPopup: true,
      serial: "emulator-5554",
    });
  });

  it("rejects popup mode when serial is missing", () => {
    expect(parseLogcatPopupContext("?popup=1")).toEqual({
      isPopup: false,
      serial: null,
    });
    expect(parseLogcatPopupContext("?popup=1&serial=")).toEqual({
      isPopup: false,
      serial: null,
    });
  });

  it("keeps normal mode when popup flag is not enabled", () => {
    expect(parseLogcatPopupContext("?serial=emulator-5554")).toEqual({
      isPopup: false,
      serial: null,
    });
  });

  it("builds deterministic popup labels from serial", () => {
    expect(buildLogcatPopupWindowLabel("emulator-5554")).toBe("logcat-popup-emulator-5554");
    expect(buildLogcatPopupWindowLabel("USB:ABC/12 34")).toBe("logcat-popup-usb-abc-12-34");
  });

  it("builds popup hash route with encoded serial", () => {
    expect(buildLogcatPopupHash("USB:ABC/12 34")).toBe("#/logcat?popup=1&serial=USB%3AABC%2F12%2034");
  });
});
