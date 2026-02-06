import { describe, expect, it } from "vitest";
import { applyDroppedPaths, isBundlePath, isSupportedApkPath, sanitizeStoredState } from "./apkInstallerState";

describe("apkInstallerState", () => {
  it("detects supported APK paths by extension", () => {
    expect(isSupportedApkPath("/tmp/app.apk")).toBe(true);
    expect(isSupportedApkPath("/tmp/app.APK")).toBe(true);
    expect(isSupportedApkPath("C:\\tmp\\bundle.apks")).toBe(true);
    expect(isSupportedApkPath("/tmp/app.xapk")).toBe(true);
    expect(isSupportedApkPath("/tmp/app")).toBe(false);
    expect(isSupportedApkPath("/tmp/app.tar.gz")).toBe(false);
  });

  it("detects bundle paths by extension", () => {
    expect(isBundlePath("/tmp/bundle.apks")).toBe(true);
    expect(isBundlePath("/tmp/bundle.XAPK")).toBe(true);
    expect(isBundlePath("/tmp/app.apk")).toBe(false);
  });

  it("sanitizes stored state strictly and clamps multi_paths", () => {
    expect(sanitizeStoredState(null)).toBeNull();
    expect(sanitizeStoredState({ mode: "nope" })).toBeNull();

    const raw = {
      mode: "multiple",
      single_path: "/tmp/app.apk",
      bundle_path: "/tmp/app.apk",
      multi_paths: [
        "/tmp/a.apk",
        "/tmp/A.apk",
        "/tmp/b.unknown",
        "   ",
        ...Array.from({ length: 100 }, (_, i) => `/tmp/${i}.apk`),
      ],
    };
    const sanitized = sanitizeStoredState(raw);
    expect(sanitized).not.toBeNull();
    expect(sanitized?.mode).toBe("multiple");
    // bundle_path must be a bundle (.apks/.xapk)
    expect(sanitized?.bundle_path).toBe("");
    // multi_paths are supported, deduped, and clamped
    expect(sanitized?.multi_paths.length).toBe(50);
    expect(sanitized?.multi_paths[0]).toBe("/tmp/a.apk");
  });

  it("applies dropped paths by mode", () => {
    const single = applyDroppedPaths("single", ["/tmp/a.apk", "/tmp/b.apk"]);
    expect(single.ok).toBe(true);
    if (single.ok) {
      expect(single.selected).toEqual(["/tmp/a.apk"]);
      expect(single.usedFirstOnly).toBe(true);
    }

    const bundleBad = applyDroppedPaths("bundle", ["/tmp/a.apk"]);
    expect(bundleBad.ok).toBe(false);
    if (!bundleBad.ok) {
      expect(bundleBad.code).toBe("BUNDLE_ONLY");
    }

    const multiple = applyDroppedPaths("multiple", ["/tmp/a.apk", "/tmp/A.apk", "/tmp/b.apks", "/tmp/c.txt"]);
    expect(multiple.ok).toBe(true);
    if (multiple.ok) {
      expect(multiple.selected).toEqual(["/tmp/a.apk", "/tmp/b.apks"]);
    }
  });
});

