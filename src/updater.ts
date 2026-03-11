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
  | { status: "publishing_pending"; message: string; latestVersion?: string }
  | { status: "error"; message: string };

export type UpdateInstallResult =
  | { status: "installed" }
  | { status: "installed_needs_restart"; message: string }
  | { status: "publishing_pending"; message: string; latestVersion?: string }
  | { status: "error"; message: string };

const UPDATE_LAST_CHECKED_KEY = "lazy_blacktea_update_last_checked_ms_v1";
const UPDATE_LAST_SEEN_VERSION_KEY = "lazy_blacktea_update_last_seen_version_v1";
const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/leaf76/lazy_blacktea_rust/releases/latest";
const GITHUB_LATEST_MANIFEST_URL = "https://github.com/leaf76/lazy_blacktea_rust/releases/latest/download/latest.json";
const UPDATE_ENDPOINT_STATUS_ERROR_PATTERN = /did not respond with a successful status code/i;
const GENERIC_UPDATE_CHECK_ERROR_MESSAGE = "Unable to check for updates. Please try again.";
const UPDATE_ARTIFACTS_PENDING_MESSAGE =
  "A newer release is available, but update artifacts are still publishing. Please try again shortly.";
const UPDATE_MANIFEST_MISSING_MESSAGE = "No published update package is available yet. Please try again later.";
const GENERIC_UPDATE_INSTALL_ERROR_MESSAGE = "Unable to install updates. Please try again.";
const UPDATE_INSTALL_PERMISSION_MESSAGE =
  "Unable to replace the app in the current location. Move the app to Applications and try again.";
const UPDATE_INSTALL_RETRYABLE_ERROR_PATTERN =
  /did not respond with a successful status code|timed out|timeout|connection reset|connection aborted|connection refused|temporar(?:y|ily)|network/i;
const UPDATE_INSTALL_ARTIFACT_ERROR_PATTERN = /did not respond with a successful status code|404|not found/i;
const UPDATE_INSTALL_PERMISSION_ERROR_PATTERN = /permission denied|operation not permitted|access is denied|read-only file system/i;
const DEFAULT_INSTALL_RETRY_DELAY_MS = 250;

type SleepFn = (ms: number) => Promise<void>;
type GithubLatestReleaseMetadata = {
  version: string | null;
  assetNames: string[];
};
type ManifestStatus = "missing" | "invalid" | "ready" | "unreachable";

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

function normalizeVersionTag(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^v/i, "");
}

function compareVersions(aRaw: string, bRaw: string): number {
  const a = aRaw.split("-")[0].split(".").map((part) => Number.parseInt(part, 10));
  const b = bRaw.split("-")[0].split(".").map((part) => Number.parseInt(part, 10));
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = Number.isFinite(a[i]) ? a[i]! : 0;
    const bv = Number.isFinite(b[i]) ? b[i]! : 0;
    if (av > bv) {
      return 1;
    }
    if (av < bv) {
      return -1;
    }
  }
  return 0;
}

async function fetchLatestReleaseMetadata(): Promise<GithubLatestReleaseMetadata> {
  const response = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    return { version: null, assetNames: [] };
  }
  const payload = (await response.json()) as {
    tag_name?: unknown;
    assets?: Array<{ name?: unknown }>;
  };
  const assetNames = Array.isArray(payload.assets)
    ? payload.assets
        .map((asset) => (typeof asset?.name === "string" ? asset.name : null))
        .filter((name): name is string => Boolean(name))
    : [];

  if (typeof payload.tag_name !== "string") {
    return { version: null, assetNames };
  }
  return {
    version: normalizeVersionTag(payload.tag_name),
    assetNames,
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }
  }
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryInstall(errorMessage: string): boolean {
  return UPDATE_INSTALL_RETRYABLE_ERROR_PATTERN.test(errorMessage);
}

function buildPublishingPendingResult(latestVersion?: string | null) {
  if (latestVersion) {
    return {
      status: "publishing_pending" as const,
      message: UPDATE_ARTIFACTS_PENDING_MESSAGE,
      latestVersion,
    };
  }

  return {
    status: "publishing_pending" as const,
    message: UPDATE_ARTIFACTS_PENDING_MESSAGE,
  };
}

function currentRuntimePlatformPrefix(): string | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("linux")) {
    return "linux-";
  }
  if (userAgent.includes("mac os") || userAgent.includes("macintosh")) {
    return "darwin-";
  }
  if (userAgent.includes("windows")) {
    return "windows-";
  }
  return null;
}

function relevantManifestPlatformKeys(keys: string[]): string[] {
  const platformPrefix = currentRuntimePlatformPrefix();
  if (!platformPrefix) {
    return keys;
  }
  const relevant = keys.filter((key) => key.startsWith(platformPrefix));
  return relevant.length > 0 ? relevant : keys;
}

function extractAssetNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.split("/").pop();
    return tail ? decodeURIComponent(tail) : null;
  } catch (_error) {
    return null;
  }
}

async function inspectLatestManifestStatus(releaseAssetNames: string[]): Promise<ManifestStatus> {
  try {
    const response = await fetch(GITHUB_LATEST_MANIFEST_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return response.status === 404 ? "missing" : "unreachable";
    }

    const payload = (await response.json()) as {
      platforms?: Record<string, { url?: unknown }>;
    };
    if (!payload.platforms || typeof payload.platforms !== "object") {
      return "invalid";
    }

    const platformKeys = relevantManifestPlatformKeys(Object.keys(payload.platforms));
    if (platformKeys.length === 0) {
      return "invalid";
    }

    const releaseAssetSet = new Set(releaseAssetNames);
    for (const key of platformKeys) {
      const entry = payload.platforms[key];
      if (!entry || typeof entry.url !== "string") {
        return "invalid";
      }
      const assetName = extractAssetNameFromUrl(entry.url);
      if (!assetName || !releaseAssetSet.has(assetName)) {
        return "invalid";
      }
    }

    return "ready";
  } catch (error) {
    console.warn("Failed to validate latest updater manifest.", error);
    return "unreachable";
  }
}

function mapInstallErrorResult(errorMessage: string, latestVersion?: string | null): UpdateInstallResult {
  if (UPDATE_INSTALL_ARTIFACT_ERROR_PATTERN.test(errorMessage)) {
    return buildPublishingPendingResult(latestVersion);
  }
  if (UPDATE_INSTALL_PERMISSION_ERROR_PATTERN.test(errorMessage)) {
    return { status: "error", message: UPDATE_INSTALL_PERMISSION_MESSAGE };
  }
  return { status: "error", message: GENERIC_UPDATE_INSTALL_ERROR_MESSAGE };
}

export async function checkForUpdate(opts?: {
  storage?: StorageLike | null;
  nowMs?: number;
  currentVersion?: string;
}): Promise<UpdateCheckResult> {
  const storage = opts?.storage ?? null;
  const nowMs = opts?.nowMs ?? Date.now();
  const currentVersion = normalizeVersionTag(opts?.currentVersion);
  let latestReleaseMetadata: GithubLatestReleaseMetadata | null | undefined;

  // Persist the attempt time so auto-checks are naturally throttled.
  writeUpdateLastCheckedMs(nowMs, storage);

  if (currentVersion) {
    latestReleaseMetadata = null;
    try {
      latestReleaseMetadata = await fetchLatestReleaseMetadata();
      const latestReleaseVersion = latestReleaseMetadata.version;
      if (latestReleaseVersion && compareVersions(latestReleaseVersion, currentVersion) <= 0) {
        return { status: "up_to_date" };
      }
    } catch (error) {
      console.warn("Failed to read latest release metadata.", error);
    }
  }

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
    const errorMessage = extractErrorMessage(error);
    if (currentVersion && UPDATE_ENDPOINT_STATUS_ERROR_PATTERN.test(errorMessage)) {
      if (latestReleaseMetadata === undefined) {
        latestReleaseMetadata = null;
        try {
          latestReleaseMetadata = await fetchLatestReleaseMetadata();
        } catch (metadataError) {
          console.warn("Failed to read latest release metadata.", metadataError);
        }
      }

      const latestReleaseVersion = latestReleaseMetadata?.version ?? null;
      if (latestReleaseVersion) {
        if (compareVersions(latestReleaseVersion, currentVersion) <= 0) {
          return { status: "up_to_date" };
        }
        const releaseAssetNames = latestReleaseMetadata?.assetNames ?? [];
        if (releaseAssetNames.length > 0) {
          const manifestStatus = await inspectLatestManifestStatus(releaseAssetNames);
          if (manifestStatus === "missing") {
            return buildPublishingPendingResult(latestReleaseVersion);
          }
          return { status: "error", message: GENERIC_UPDATE_CHECK_ERROR_MESSAGE };
        }
        return buildPublishingPendingResult(latestReleaseVersion);
      }

      return { status: "error", message: UPDATE_MANIFEST_MISSING_MESSAGE };
    }

    return { status: "error", message: GENERIC_UPDATE_CHECK_ERROR_MESSAGE };
  }
}

export async function installUpdateAndRelaunch(
  update: UpdaterUpdateLike,
  opts?: {
    retryDelayMs?: number;
    sleep?: SleepFn;
  },
): Promise<UpdateInstallResult> {
  const retryDelayMs = Math.max(0, opts?.retryDelayMs ?? DEFAULT_INSTALL_RETRY_DELAY_MS);
  const sleepFn = opts?.sleep ?? sleep;
  let installError: unknown = null;

  try {
    await update.downloadAndInstall();
  } catch (error) {
    installError = error;
  }

  if (installError) {
    const firstErrorMessage = extractErrorMessage(installError);
    if (shouldRetryInstall(firstErrorMessage)) {
      try {
        await sleepFn(retryDelayMs);
        await update.downloadAndInstall();
        installError = null;
      } catch (retryError) {
        installError = retryError;
      }
    }
  }

  if (installError) {
    console.warn("Failed to download/install update.", installError);
    return mapInstallErrorResult(extractErrorMessage(installError), normalizeVersionTag(update.version));
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
