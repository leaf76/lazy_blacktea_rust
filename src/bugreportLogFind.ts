export type BugreportLogFindOptions = {
  caseSensitive: boolean;
  regex: boolean;
};

export type BugreportLogFindPattern = {
  test: RegExp;
  error: string | null;
};

export function buildBugreportLogFindPattern(
  term: string,
  options: BugreportLogFindOptions,
): BugreportLogFindPattern | null {
  const trimmed = term.trim();
  if (!trimmed) {
    return null;
  }

  const flags = options.caseSensitive ? "" : "i";
  try {
    if (options.regex) {
      return { test: new RegExp(trimmed, flags), error: null };
    }
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { test: new RegExp(escaped, flags), error: null };
  } catch (error) {
    return {
      test: /$^/,
      error: error instanceof Error ? error.message : "Invalid pattern",
    };
  }
}

export function bugreportLogLineMatches(pattern: BugreportLogFindPattern | null, line: string): boolean {
  if (!pattern) {
    return false;
  }
  pattern.test.lastIndex = 0;
  return pattern.test.test(line);
}

