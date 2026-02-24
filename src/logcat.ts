export type LogcatLevel = "V" | "D" | "I" | "W" | "E" | "F";
export type LogcatSourceMode = "tag" | "package" | "raw";

export type LogcatLevelsState = Record<LogcatLevel, boolean>;

export type LogcatFilterState = {
  levels: LogcatLevelsState;
  activePatterns: string[];
  excludePatterns?: string[];
  livePattern?: string;
  searchTerm?: string;
  searchCaseSensitive?: boolean;
  searchRegex?: boolean;
  searchOnly?: boolean;
};

export type FilteredLogcatResult = {
  lines: string[];
  matchIndices: number[];
};

export type LogcatLineEntry = { id: number; text: string };

export type FilteredLogcatEntriesResult = {
  lines: LogcatLineEntry[];
  matchIds: number[];
};

export type LogcatBaseFilterState = Pick<
  LogcatFilterState,
  "levels" | "activePatterns" | "excludePatterns" | "livePattern"
>;

export type LogcatSearchState = Pick<
  LogcatFilterState,
  "searchTerm" | "searchCaseSensitive" | "searchRegex" | "searchOnly"
>;

export const defaultLogcatLevels: LogcatLevelsState = {
  V: true,
  D: true,
  I: true,
  W: true,
  E: true,
  F: true,
};

const levelRegex = /\b([VDIWEF])\//;

export const parseLogcatLevel = (line: string): LogcatLevel | null => {
  const match = line.match(levelRegex);
  if (!match) {
    return null;
  }
  return match[1] as LogcatLevel;
};

export const parsePidOutput = (output: string): string[] => {
  return output
    .trim()
    .split(/\s+/)
    .map((pid) => pid.trim())
    .filter(Boolean);
};

export const buildLogcatFilter = ({
  sourceMode,
  sourceValue,
  pids,
}: {
  sourceMode: LogcatSourceMode;
  sourceValue: string;
  pids?: string[];
}): string => {
  const trimmed = sourceValue.trim();
  if (!trimmed) {
    return "";
  }
  if (sourceMode === "raw") {
    return trimmed;
  }
  if (sourceMode === "tag") {
    return `${trimmed}:V *:S`;
  }
  if (sourceMode === "package") {
    if (!pids || pids.length === 0) {
      return "";
    }
    const pidArgs = pids.map((pid) => `--pid=${pid}`).join(" ");
    return `${pidArgs} *:V`.trim();
  }
  return "";
};

export const buildSearchRegex = (
  term: string,
  {
    caseSensitive = false,
    regex = false,
  }: { caseSensitive?: boolean; regex?: boolean },
): RegExp | null => {
  if (!term.trim()) {
    return null;
  }
  try {
    if (regex) {
      return new RegExp(term, caseSensitive ? "g" : "gi");
    }
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
};

export const escapeRegexLiteral = (term: string): string => {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const matchesAnyPattern = (line: string, patterns: RegExp[]) => {
  if (patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => pattern.test(line));
};

const matchesNoExcludePattern = (line: string, excludePatterns: RegExp[]) => {
  if (excludePatterns.length === 0) {
    return true;
  }
  return !excludePatterns.some((pattern) => pattern.test(line));
};

const buildRegexPatterns = (patterns: string[]) =>
  patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => {
      try {
        return new RegExp(pattern, "i");
      } catch {
        return null;
      }
    })
    .filter((pattern): pattern is RegExp => Boolean(pattern));

const filterLogcatLinesByBaseFilters = (lines: string[], state: LogcatBaseFilterState): string[] => {
  const filteredByLevel = lines.filter((line) => {
    const level = parseLogcatLevel(line);
    if (!level) {
      return true;
    }
    return state.levels[level];
  });

  const patterns = buildRegexPatterns([...state.activePatterns, state.livePattern ?? ""]);
  const excludePatterns = buildRegexPatterns(state.excludePatterns ?? []);
  return filteredByLevel
    .filter((line) => matchesAnyPattern(line, patterns))
    .filter((line) => matchesNoExcludePattern(line, excludePatterns));
};

export const filterLogcatEntriesByBaseFilters = (
  entries: LogcatLineEntry[],
  state: LogcatBaseFilterState,
): LogcatLineEntry[] => {
  const filteredByLevel = entries.filter((entry) => {
    const level = parseLogcatLevel(entry.text);
    if (!level) {
      return true;
    }
    return state.levels[level];
  });

  const patterns = buildRegexPatterns([...state.activePatterns, state.livePattern ?? ""]);
  const excludePatterns = buildRegexPatterns(state.excludePatterns ?? []);
  return filteredByLevel
    .filter((entry) => matchesAnyPattern(entry.text, patterns))
    .filter((entry) => matchesNoExcludePattern(entry.text, excludePatterns));
};

export const isLogcatBaseFilterActive = (state: LogcatBaseFilterState): boolean => {
  const levelFiltered = Object.values(state.levels).some((enabled) => !enabled);
  if (levelFiltered) {
    return true;
  }

  const includePatterns = buildRegexPatterns([...state.activePatterns, state.livePattern ?? ""]);
  if (includePatterns.length > 0) {
    return true;
  }

  const excludePatterns = buildRegexPatterns(state.excludePatterns ?? []);
  return excludePatterns.length > 0;
};

export const mergeLogcatEntriesById = (
  left: LogcatLineEntry[],
  right: LogcatLineEntry[],
): LogcatLineEntry[] => {
  if (!left.length) {
    return right;
  }
  if (!right.length) {
    return left;
  }

  const merged: LogcatLineEntry[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    const a = left[i];
    const b = right[j];
    if (a.id === b.id) {
      merged.push(a);
      i += 1;
      j += 1;
      continue;
    }
    if (a.id < b.id) {
      merged.push(a);
      i += 1;
      continue;
    }
    merged.push(b);
    j += 1;
  }

  while (i < left.length) {
    merged.push(left[i]);
    i += 1;
  }
  while (j < right.length) {
    merged.push(right[j]);
    j += 1;
  }
  return merged;
};

export const appendRetainedLogcatEntries = (
  existing: LogcatLineEntry[],
  incoming: LogcatLineEntry[],
  limit: number,
): LogcatLineEntry[] => {
  if (incoming.length === 0) {
    return existing;
  }

  const seen = new Set(existing.map((entry) => entry.id));
  const next = [...existing];
  incoming.forEach((entry) => {
    if (seen.has(entry.id)) {
      return;
    }
    seen.add(entry.id);
    next.push(entry);
  });

  if (next.length <= limit) {
    return next;
  }
  return next.slice(-limit);
};

export const filterLogcatLines = (
  lines: string[],
  state: LogcatFilterState,
): FilteredLogcatResult => {
  const filteredByPatterns = filterLogcatLinesByBaseFilters(lines, {
    levels: state.levels,
    activePatterns: state.activePatterns,
    excludePatterns: state.excludePatterns,
    livePattern: state.livePattern,
  });

  const searchRegex = buildSearchRegex(state.searchTerm ?? "", {
    caseSensitive: state.searchCaseSensitive,
    regex: state.searchRegex,
  });

  const matchIndices: number[] = [];
  filteredByPatterns.forEach((line, index) => {
    if (searchRegex && searchRegex.test(line)) {
      matchIndices.push(index);
      searchRegex.lastIndex = 0;
    }
  });

  if (state.searchOnly && searchRegex) {
    const linesWithMatches = matchIndices.map((idx) => filteredByPatterns[idx]);
    return { lines: linesWithMatches, matchIndices: linesWithMatches.map((_, idx) => idx) };
  }

  return { lines: filteredByPatterns, matchIndices };
};

export const filterLogcatEntriesBySearch = (
  entries: LogcatLineEntry[],
  state: LogcatSearchState,
): FilteredLogcatEntriesResult => {
  const searchRegex = buildSearchRegex(state.searchTerm ?? "", {
    caseSensitive: state.searchCaseSensitive,
    regex: state.searchRegex,
  });

  const matchIds: number[] = [];
  const matchedEntries: LogcatLineEntry[] = [];
  entries.forEach((entry) => {
    if (searchRegex && searchRegex.test(entry.text)) {
      matchIds.push(entry.id);
      if (state.searchOnly) {
        matchedEntries.push(entry);
      }
      searchRegex.lastIndex = 0;
    }
  });

  if (state.searchOnly && searchRegex) {
    return { lines: matchedEntries, matchIds };
  }
  return { lines: entries, matchIds };
};

export const filterLogcatEntries = (
  entries: LogcatLineEntry[],
  state: LogcatFilterState,
): FilteredLogcatEntriesResult => {
  const filteredByPatterns = filterLogcatEntriesByBaseFilters(entries, {
    levels: state.levels,
    activePatterns: state.activePatterns,
    excludePatterns: state.excludePatterns,
    livePattern: state.livePattern,
  });
  return filterLogcatEntriesBySearch(filteredByPatterns, {
    searchTerm: state.searchTerm,
    searchCaseSensitive: state.searchCaseSensitive,
    searchRegex: state.searchRegex,
    searchOnly: state.searchOnly,
  });
};
