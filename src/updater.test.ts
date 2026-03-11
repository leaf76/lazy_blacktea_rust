import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import {
  checkForUpdate,
  installUpdateAndRelaunch,
  readUpdateLastCheckedMs,
  readUpdateLastSeenVersion,
  shouldAutoCheck,
} from "./updater";

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  (check as unknown as { mockReset: () => void }).mockReset();
  (relaunch as unknown as { mockReset: () => void }).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  warnSpy?.mockRestore();
  warnSpy = null;
});

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("shouldAutoCheck", () => {
  it("checks when there is no previous check time", () => {
    expect(shouldAutoCheck(1_000, null, 60_000)).toBe(true);
  });

  it("does not check when within the minimum interval", () => {
    expect(shouldAutoCheck(1_000, 900, 200)).toBe(false);
  });

  it("checks when outside the minimum interval", () => {
    expect(shouldAutoCheck(1_000, 700, 200)).toBe(true);
  });
});

describe("checkForUpdate", () => {
  it("returns up_to_date and persists last checked time", async () => {
    const storage = createMemoryStorage();
    (check as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(null);

    const result = await checkForUpdate({ storage, nowMs: 1_000 });

    expect(result.status).toBe("up_to_date");
    expect(readUpdateLastCheckedMs(storage)).toBe(1_000);
    expect(readUpdateLastSeenVersion(storage)).toBeNull();
  });

  it("returns update_available and persists last seen version", async () => {
    const storage = createMemoryStorage();
    const update = { version: "0.0.54", body: "notes", downloadAndInstall: vi.fn().mockResolvedValue(undefined) };
    (check as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(update);

    const result = await checkForUpdate({ storage, nowMs: 2_000 });

    expect(result.status).toBe("update_available");
    if (result.status !== "update_available") {
      throw new Error(`Expected update_available, got ${result.status}`);
    }
    expect(result.update.version).toBe("0.0.54");
    expect(readUpdateLastCheckedMs(storage)).toBe(2_000);
    expect(readUpdateLastSeenVersion(storage)).toBe("0.0.54");
  });

  it("returns error with a user-safe message", async () => {
    const storage = createMemoryStorage();
    (check as unknown as { mockRejectedValue: (value: unknown) => void }).mockRejectedValue(new Error("network down"));

    const result = await checkForUpdate({ storage, nowMs: 3_000 });

    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error(`Expected error, got ${result.status}`);
    }
    expect(result.message).toMatch(/Unable to check for updates/i);
    expect(result.message).not.toMatch(/network down/i);
    expect(readUpdateLastCheckedMs(storage)).toBe(3_000);
  });

  it("returns up_to_date when latest release tag matches current version", async () => {
    const storage = createMemoryStorage();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v0.0.57" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkForUpdate({ storage, nowMs: 4_000, currentVersion: "0.0.57" });

    expect(result.status).toBe("up_to_date");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
    expect(readUpdateLastCheckedMs(storage)).toBe(4_000);
  });

  it("returns publishing_pending when release tag is newer but updater artifacts are missing", async () => {
    const storage = createMemoryStorage();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/releases/latest") && !url.endsWith("/download/latest.json")) {
        return {
          ok: true,
          json: async () => ({ tag_name: "v0.0.58", assets: [] }),
        };
      }
      if (url.endsWith("/download/latest.json")) {
        return {
          ok: false,
          status: 404,
          json: async () => {
            throw new Error("unexpected json");
          },
        };
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    (check as unknown as { mockRejectedValue: (value: unknown) => void }).mockRejectedValue(
      new Error("update endpoint did not respond with a successful status code"),
    );

    const result = await checkForUpdate({ storage, nowMs: 5_000, currentVersion: "0.0.57" });

    expect(result.status).toBe("publishing_pending");
    if (result.status !== "publishing_pending") {
      throw new Error(`Expected publishing_pending, got ${result.status}`);
    }
    expect(result.message).toMatch(/newer release is available/i);
    expect(result.message).not.toMatch(/successful status code/i);
    expect(result.latestVersion).toBe("0.0.58");
    expect(readUpdateLastCheckedMs(storage)).toBe(5_000);
  });

  it("returns error when release tag is newer but manifest points to missing assets", async () => {
    const storage = createMemoryStorage();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/releases/latest") && !url.endsWith("/download/latest.json")) {
        return {
          ok: true,
          json: async () => ({
            tag_name: "v0.0.58",
            assets: [
              { name: "Lazy.Blacktea_0.0.58_amd64.AppImage" },
              { name: "Lazy.Blacktea_0.0.58_amd64.deb" },
            ],
          }),
        };
      }
      if (url.endsWith("/download/latest.json")) {
        return {
          ok: true,
          json: async () => ({
            version: "0.0.58",
            platforms: {
              "linux-x86_64-appimage": {
                url: "https://github.com/leaf76/lazy_blacktea_rust/releases/download/v0.0.58/Lazy Blacktea_0.0.58_amd64.AppImage",
                signature: "sig",
              },
              "linux-x86_64-deb": {
                url: "https://github.com/leaf76/lazy_blacktea_rust/releases/download/v0.0.58/Lazy Blacktea_0.0.58_amd64.deb",
                signature: "sig",
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
    (check as unknown as { mockRejectedValue: (value: unknown) => void }).mockRejectedValue(
      new Error("update endpoint did not respond with a successful status code"),
    );

    const result = await checkForUpdate({ storage, nowMs: 6_000, currentVersion: "0.0.57" });

    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error(`Expected error, got ${result.status}`);
    }
    expect(result.message).toMatch(/Unable to check for updates/i);
    expect(result.message).not.toMatch(/still publishing/i);
    expect(readUpdateLastCheckedMs(storage)).toBe(6_000);
  });
});

describe("installUpdateAndRelaunch", () => {
  it("downloads, installs, and relaunches", async () => {
    const update = { version: "0.0.54", downloadAndInstall: vi.fn().mockResolvedValue(undefined) };
    (relaunch as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(undefined);

    const result = await installUpdateAndRelaunch(update);

    expect(result.status).toBe("installed");
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("retries once for transient install errors before succeeding", async () => {
    const downloadAndInstall = vi
      .fn()
      .mockRejectedValueOnce(new Error("update endpoint did not respond with a successful status code"))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const update = { version: "0.0.54", downloadAndInstall };
    (relaunch as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(undefined);

    const result = await installUpdateAndRelaunch(update, { retryDelayMs: 250, sleep });

    expect(result.status).toBe("installed");
    expect(downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("returns publishing_pending when transient install failures persist", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const update = {
      version: "0.0.54",
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("update endpoint did not respond with a successful status code")),
    };
    (relaunch as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(undefined);

    const result = await installUpdateAndRelaunch(update, { retryDelayMs: 250, sleep });

    expect(result.status).toBe("publishing_pending");
    if (result.status !== "publishing_pending") {
      throw new Error(`Expected publishing_pending, got ${result.status}`);
    }
    expect(result.message).toMatch(/still publishing/i);
    expect(result.message).not.toMatch(/successful status code/i);
    expect(result.latestVersion).toBe("0.0.54");
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(0);
  });

  it("returns actionable message for permission-related install failures", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const update = {
      version: "0.0.54",
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("Permission denied")),
    };
    (relaunch as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(undefined);

    const result = await installUpdateAndRelaunch(update, { retryDelayMs: 250, sleep });

    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error(`Expected error, got ${result.status}`);
    }
    expect(result.message).toMatch(/Move the app to Applications/i);
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(0);
    expect(relaunch).toHaveBeenCalledTimes(0);
  });

  it("returns installed_needs_restart when relaunch fails after install", async () => {
    const update = { version: "0.0.54", downloadAndInstall: vi.fn().mockResolvedValue(undefined) };
    (relaunch as unknown as { mockRejectedValue: (value: unknown) => void }).mockRejectedValue(new Error("no perms"));

    const result = await installUpdateAndRelaunch(update);

    expect(result.status).toBe("installed_needs_restart");
    if (result.status !== "installed_needs_restart") {
      throw new Error(`Expected installed_needs_restart, got ${result.status}`);
    }
    expect(result.message).toMatch(/restart/i);
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("returns error if download/install fails and does not relaunch", async () => {
    const update = { version: "0.0.54", downloadAndInstall: vi.fn().mockRejectedValue(new Error("disk full")) };
    (relaunch as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(undefined);

    const result = await installUpdateAndRelaunch(update);

    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error(`Expected error, got ${result.status}`);
    }
    expect(result.message).toMatch(/Unable to install updates/i);
    expect(result.message).not.toMatch(/disk full/i);
    expect(relaunch).toHaveBeenCalledTimes(0);
  });
});
