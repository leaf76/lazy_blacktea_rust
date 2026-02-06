export type ApkInstallMode = "single" | "multiple" | "bundle";

export type ApkInstallerStoredStateV1 = {
  mode: ApkInstallMode;
  single_path: string;
  bundle_path: string;
  multi_paths: string[];
};

export type ApplyDroppedPathsResult =
  | { ok: true; selected: string[]; usedFirstOnly: boolean }
  | { ok: false; code: "NO_SUPPORTED" | "BUNDLE_ONLY"; message: string };

const MAX_PATH_LEN = 4096;
export const MAX_MULTI_PATHS = 50;

const getExtLower = (input: string): string | null => {
  const path = input.trim();
  if (!path) {
    return null;
  }
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return null;
  }
  return base.slice(dot + 1).toLowerCase();
};

export const isSupportedApkPath = (path: string): boolean => {
  const ext = getExtLower(path);
  return ext === "apk" || ext === "apks" || ext === "xapk";
};

export const isBundlePath = (path: string): boolean => {
  const ext = getExtLower(path);
  return ext === "apks" || ext === "xapk";
};

const normalizePaths = (
  paths: string[],
  predicate: (path: string) => boolean,
  maxItems: number,
): string[] => {
  const dedup = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.length > MAX_PATH_LEN) {
      continue;
    }
    if (!predicate(trimmed)) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (dedup.has(key)) {
      continue;
    }
    dedup.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
};

export const sanitizeMultiPathsForStorage = (paths: string[]): string[] =>
  normalizePaths(paths, isSupportedApkPath, MAX_MULTI_PATHS);

export const sanitizeStoredState = (raw: unknown): ApkInstallerStoredStateV1 | null => {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const mode = record.mode;
  if (mode !== "single" && mode !== "multiple" && mode !== "bundle") {
    return null;
  }

  const singleRaw = typeof record.single_path === "string" ? record.single_path : "";
  const bundleRaw = typeof record.bundle_path === "string" ? record.bundle_path : "";
  const multiRaw = Array.isArray(record.multi_paths) ? record.multi_paths : [];

  const singleTrimmed = singleRaw.trim();
  const bundleTrimmed = bundleRaw.trim();
  const multiStrings = multiRaw.filter((item): item is string => typeof item === "string");

  return {
    mode,
    single_path:
      singleTrimmed && singleTrimmed.length <= MAX_PATH_LEN && isSupportedApkPath(singleTrimmed)
        ? singleTrimmed
        : "",
    bundle_path:
      bundleTrimmed && bundleTrimmed.length <= MAX_PATH_LEN && isBundlePath(bundleTrimmed) ? bundleTrimmed : "",
    multi_paths: sanitizeMultiPathsForStorage(multiStrings),
  };
};

export const applyDroppedPaths = (mode: ApkInstallMode, droppedPaths: string[]): ApplyDroppedPathsResult => {
  if (mode === "bundle") {
    const selected = normalizePaths(droppedPaths, isBundlePath, 1);
    if (selected.length === 0) {
      return { ok: false, code: "BUNDLE_ONLY", message: "Bundle mode accepts .apks/.xapk only." };
    }
    return { ok: true, selected, usedFirstOnly: false };
  }

  if (mode === "single") {
    const normalized = normalizePaths(droppedPaths, isSupportedApkPath, MAX_MULTI_PATHS);
    if (normalized.length === 0) {
      return { ok: false, code: "NO_SUPPORTED", message: "No supported APK files dropped." };
    }
    return { ok: true, selected: [normalized[0]], usedFirstOnly: normalized.length > 1 };
  }

  const selected = normalizePaths(droppedPaths, isSupportedApkPath, MAX_MULTI_PATHS);
  if (selected.length === 0) {
    return { ok: false, code: "NO_SUPPORTED", message: "No supported APK files dropped." };
  }
  return { ok: true, selected, usedFirstOnly: false };
};

