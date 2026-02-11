export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

export type UpdaterUpdateLike = {
  version: string;
  body?: string | null;
  date?: string | null;
  downloadAndInstall: () => Promise<void>;
};

export type UpdateCheckResult =
  | { status: "up_to_date" }
  | { status: "update_available"; update: UpdaterUpdateLike }
  | { status: "error"; message: string };

export type UpdateInstallResult =
  | { status: "installed" }
  | { status: "installed_needs_restart"; message: string }
  | { status: "error"; message: string };

const UPDATE_LAST_CHECKED_KEY = "lazy_blacktea_update_last_checked_ms_v1";
const UPDATE_LAST_SEEN_VERSION_KEY = "lazy_blacktea_update_last_seen_version_v1";

function defaultStorage(): StorageLike | null {
  try {
    // `localStorage` is not available in node-mode tests or browser-only runs.
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage;
  } catch (_error) {
    return null;
  }
}

export function readUpdateLastCheckedMs(storage?: StorageLike | null): number | null {
  const s = storage ?? defaultStorage();
  if (!s) {
    return null;
  }
  try {
    const raw = s.getItem(UPDATE_LAST_CHECKED_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function writeUpdateLastCheckedMs(ms: number, storage?: StorageLike | null) {
  const s = storage ?? defaultStorage();
  if (!s) {
    return;
  }
  try {
    s.setItem(UPDATE_LAST_CHECKED_KEY, String(ms));
  } catch (_error) {
    // best-effort; update checks should still work without persistence
  }
}

export function readUpdateLastSeenVersion(storage?: StorageLike | null): string | null {
  const s = storage ?? defaultStorage();
  if (!s) {
    return null;
  }
  try {
    const raw = s.getItem(UPDATE_LAST_SEEN_VERSION_KEY);
    return raw ? raw : null;
  } catch (_error) {
    return null;
  }
}

function writeUpdateLastSeenVersion(version: string, storage?: StorageLike | null) {
  const s = storage ?? defaultStorage();
  if (!s) {
    return;
  }
  try {
    s.setItem(UPDATE_LAST_SEEN_VERSION_KEY, version);
  } catch (_error) {
    // best-effort
  }
}

export function shouldAutoCheck(nowMs: number, lastCheckedMs: number | null, minIntervalMs: number): boolean {
  if (lastCheckedMs == null) {
    return true;
  }
  if (!Number.isFinite(lastCheckedMs)) {
    return true;
  }
  return nowMs - lastCheckedMs >= minIntervalMs;
}

export async function checkForUpdate(opts?: {
  storage?: StorageLike | null;
  nowMs?: number;
}): Promise<UpdateCheckResult> {
  const storage = opts?.storage ?? null;
  const nowMs = opts?.nowMs ?? Date.now();

  // Persist the attempt time so auto-checks are naturally throttled.
  writeUpdateLastCheckedMs(nowMs, storage);

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = (await check()) as unknown;

    if (!update) {
      return { status: "up_to_date" };
    }

    const normalized = update as UpdaterUpdateLike;
    if (typeof normalized.version === "string" && normalized.version.trim()) {
      writeUpdateLastSeenVersion(normalized.version.trim(), storage);
    }

    return { status: "update_available", update: normalized };
  } catch (error) {
    console.warn("Failed to check for updates.", error);
    return { status: "error", message: "Unable to check for updates. Please try again." };
  }
}

export async function installUpdateAndRelaunch(update: UpdaterUpdateLike): Promise<UpdateInstallResult> {
  try {
    await update.downloadAndInstall();
  } catch (error) {
    console.warn("Failed to download/install update.", error);
    return { status: "error", message: "Unable to install updates. Please try again." };
  }

  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) {
    console.warn("Update installed, but failed to relaunch.", error);
    // The update should still be installed; ask the user to restart manually.
    return {
      status: "installed_needs_restart",
      message: "Update installed. Please restart the app manually.",
    };
  }

  return { status: "installed" };
}
