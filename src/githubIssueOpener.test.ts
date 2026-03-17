import { describe, expect, it, vi } from "vitest";
import { openGithubIssueUrl } from "./githubIssueOpener";

describe("openGithubIssueUrl", () => {
  it("opens via opener plugin when openUrl succeeds", async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn();
    const copyText = vi.fn();
    const recordFailure = vi.fn();

    const result = await openGithubIssueUrl("https://example.com", {
      openUrl,
      openWindow,
      copyText,
      recordFailure,
    });

    expect(result).toEqual({ status: "opened", method: "openUrl" });
    expect(openWindow).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("falls back to window.open when opener plugin fails", async () => {
    const openUrl = vi.fn().mockRejectedValue(new Error("Not allowed"));
    const popup = {} as Window;
    const openWindow = vi.fn().mockReturnValue(popup);
    const copyText = vi.fn();
    const recordFailure = vi.fn();
    const warn = vi.fn();

    const result = await openGithubIssueUrl("https://example.com", {
      openUrl,
      openWindow,
      copyText,
      warn,
      recordFailure,
    });

    expect(result).toEqual({ status: "opened", method: "window.open" });
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(copyText).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("copies the URL when browser opening fails", async () => {
    const primaryError = new Error("Not allowed");
    const openUrl = vi.fn().mockRejectedValue(primaryError);
    const openWindow = vi.fn().mockReturnValue(null);
    const copyText = vi.fn().mockResolvedValue(undefined);
    const recordFailure = vi.fn();

    const result = await openGithubIssueUrl("https://example.com", {
      openUrl,
      openWindow,
      copyText,
      recordFailure,
    });

    expect(result).toEqual({ status: "copied", method: "clipboard" });
    expect(copyText).toHaveBeenCalledWith("https://example.com");
    expect(recordFailure).toHaveBeenCalledWith(primaryError);
  });

  it("reports failure when opening and clipboard fallback both fail", async () => {
    const primaryError = new Error("Not allowed");
    const copyError = new Error("Clipboard unavailable");
    const openUrl = vi.fn().mockRejectedValue(primaryError);
    const openWindow = vi.fn().mockReturnValue(null);
    const copyText = vi.fn().mockRejectedValue(copyError);
    const recordFailure = vi.fn();
    const warn = vi.fn();

    const result = await openGithubIssueUrl("https://example.com", {
      openUrl,
      openWindow,
      copyText,
      warn,
      recordFailure,
    });

    expect(result).toEqual({ status: "failed", method: null });
    expect(recordFailure).toHaveBeenCalledWith(primaryError);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
