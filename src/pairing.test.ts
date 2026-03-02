import { describe, expect, it } from "vitest";
import {
  extractHostPort,
  initialPairingState,
  pairingReducer,
  parseAdbPairOutput,
  parseQrPayload,
} from "./pairing";

describe("pairing parsing", () => {
  it("extracts host:port from adb pair output", () => {
    const output = "Successfully paired to 192.168.0.10:37145\n";
    expect(extractHostPort(output)).toBe("192.168.0.10:37145");
    expect(parseAdbPairOutput(output).connectAddress).toBe("192.168.0.10:37145");
  });

  it("parses QR payload format", () => {
    const payload = "WIFI:T:ADB;S:192.168.0.10:37145;P:123456;;";
    const parsed = parseQrPayload(payload);
    expect(parsed.pairAddress).toBe("192.168.0.10:37145");
    expect(parsed.pairingCode).toBe("123456");
  });

  it("parses raw payload with address and code", () => {
    const payload = "192.168.0.10:37145 123456";
    const parsed = parseQrPayload(payload);
    expect(parsed.pairAddress).toBe("192.168.0.10:37145");
    expect(parsed.pairingCode).toBe("123456");
  });

  it("parses QR payload when copied with surrounding spaces", () => {
    const payload = "  WIFI:T:ADB;S:10.0.0.7:33899;P:654321;;  ";
    const parsed = parseQrPayload(payload);
    expect(parsed.pairAddress).toBe("10.0.0.7:33899");
    expect(parsed.pairingCode).toBe("654321");
  });

  it("returns trimmed adb pair message", () => {
    const output = "Successfully paired to 10.0.0.7:33899\n\n";
    const parsed = parseAdbPairOutput(output);
    expect(parsed.connectAddress).toBe("10.0.0.7:33899");
    expect(parsed.message).toBe("Successfully paired to 10.0.0.7:33899");
  });
});

describe("pairing reducer", () => {
  it("opens and closes modal", () => {
    const opened = pairingReducer(initialPairingState, { type: "OPEN" });
    expect(opened.isOpen).toBe(true);
    const closed = pairingReducer(opened, { type: "CLOSE" });
    expect(closed.isOpen).toBe(false);
  });

  it("sets connect address on pair success", () => {
    const state = pairingReducer(initialPairingState, {
      type: "PAIR_SUCCESS",
      message: "ok",
      connectAddress: "192.168.0.10:5555",
    });
    expect(state.connectAddress).toBe("192.168.0.10:5555");
  });
});
