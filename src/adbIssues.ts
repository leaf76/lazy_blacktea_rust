import type { AdbInfo } from "./types";

export const ADB_ISSUE_MACOS_GATEKEEPER_QUARANTINE = "macos_gatekeeper_quarantine";

export const getAdbIssueRecoveryMessages = (
  adbInfo: Pick<AdbInfo, "issue_code"> | null | undefined,
): string[] => {
  if (adbInfo?.issue_code !== ADB_ISSUE_MACOS_GATEKEEPER_QUARANTINE) {
    return [];
  }

  return [
    "macOS blocked this ADB executable before Lazy Blacktea could run it.",
    "Select a trusted Android SDK platform-tools adb path in Settings, reinstall Android Platform Tools, or only approve/remove quarantine for this exact binary after you trust it.",
    "Lazy Blacktea does not remove quarantine automatically.",
  ];
};
