import { describe, expect, it } from "vitest";

import {
  ADB_ISSUE_MACOS_GATEKEEPER_QUARANTINE,
  getAdbIssueRecoveryMessages,
} from "./adbIssues";

describe("getAdbIssueRecoveryMessages", () => {
  it("returns macOS Gatekeeper recovery guidance for quarantined ADB", () => {
    expect(
      getAdbIssueRecoveryMessages({
        issue_code: ADB_ISSUE_MACOS_GATEKEEPER_QUARANTINE,
      }),
    ).toEqual([
      "macOS blocked this ADB executable before Lazy Blacktea could run it.",
      "Select a trusted Android SDK platform-tools adb path in Settings, reinstall Android Platform Tools, or only approve/remove quarantine for this exact binary after you trust it.",
      "Lazy Blacktea does not remove quarantine automatically.",
    ]);
  });

  it("returns no guidance for unrelated ADB failures", () => {
    expect(getAdbIssueRecoveryMessages({ issue_code: null })).toEqual([]);
    expect(getAdbIssueRecoveryMessages({ issue_code: "other_issue" })).toEqual([]);
    expect(getAdbIssueRecoveryMessages(null)).toEqual([]);
  });
});
