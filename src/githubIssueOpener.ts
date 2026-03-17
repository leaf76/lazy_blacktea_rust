export type GithubIssueOpenStatus = "opened" | "copied" | "failed";

export type GithubIssueOpenMethod = "openUrl" | "window.open" | "clipboard" | null;

export type GithubIssueOpenResult = {
  status: GithubIssueOpenStatus;
  method: GithubIssueOpenMethod;
};

export type OpenGithubIssueUrlDependencies = {
  openUrl: (url: string) => Promise<void>;
  openWindow: (url: string) => Window | null;
  copyText: (text: string) => Promise<void>;
  warn?: (message: string, error: unknown) => void;
  recordFailure?: (error: unknown) => void;
};

export const openGithubIssueUrl = async (
  url: string,
  deps: OpenGithubIssueUrlDependencies,
): Promise<GithubIssueOpenResult> => {
  let primaryError: unknown = null;

  try {
    await deps.openUrl(url);
    return { status: "opened", method: "openUrl" };
  } catch (error) {
    primaryError = error;
    deps.warn?.("Failed to open GitHub issue URL via opener plugin.", error);
  }

  try {
    const popup = deps.openWindow(url);
    if (popup) {
      return { status: "opened", method: "window.open" };
    }
  } catch (error) {
    deps.warn?.("Failed to open GitHub issue URL via window.open.", error);
  }

  try {
    await deps.copyText(url);
    deps.recordFailure?.(primaryError ?? new Error("GitHub issue URL could not be opened."));
    return { status: "copied", method: "clipboard" };
  } catch (error) {
    deps.warn?.("Failed to copy GitHub issue URL to clipboard.", error);
    deps.recordFailure?.(primaryError ?? error);
    return { status: "failed", method: null };
  }
};
