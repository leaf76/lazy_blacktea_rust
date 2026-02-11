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
