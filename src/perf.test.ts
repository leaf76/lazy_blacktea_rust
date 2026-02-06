import { describe, expect, it } from "vitest";
import {
  buildSparklinePoints,
  formatBps,
  formatBytes,
  formatHzX100,
  formatKhz,
  formatPerSecX100,
} from "./perf";

describe("perf helpers", () => {
  it("formatBytes returns -- for null", () => {
    expect(formatBytes(null)).toBe("--");
  });

  it("formatBytes formats bytes in KB", () => {
    expect(formatBytes(1024)).toBe("1.00 KB");
  });

  it("formatBps appends /s", () => {
    expect(formatBps(2048)).toBe("2.00 KB/s");
  });

  it("formatKhz returns GHz for large frequencies", () => {
    expect(formatKhz(1_800_000)).toBe("1.80 GHz");
  });

  it("formatHzX100 formats Hz", () => {
    expect(formatHzX100(6000)).toBe("60.00 Hz");
  });

  it("formatPerSecX100 formats per-second values", () => {
    expect(formatPerSecX100(123)).toBe("1.23 /s");
  });

  it("buildSparklinePoints returns empty for <2 values", () => {
    expect(buildSparklinePoints([1], 100, 20)).toBe("");
  });

  it("buildSparklinePoints returns stable points", () => {
    const points = buildSparklinePoints([0, 50, 100], 100, 20);
    expect(points).toBe("0.0,20.0 50.0,10.0 100.0,0.0");
  });

  it("buildSparklinePoints avoids NaN when flat", () => {
    const points = buildSparklinePoints([1, 1, 1], 90, 30);
    expect(points).toBe("0.0,15.0 45.0,15.0 90.0,15.0");
  });
});
