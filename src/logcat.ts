export type LogcatLevel = "V" | "D" | "I" | "W" | "E" | "F";
export type LogcatSourceMode = "tag" | "package" | "raw";

export type LogcatLevelsState = Record<LogcatLevel, boolean>;

export type LogcatFilterState = {
  levels: LogcatLevelsState;
  activePatterns: string[];
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

const matchesAnyPattern = (line: string, patterns: RegExp[]) => {
  if (patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => pattern.test(line));
};

export const filterLogcatLines = (
  lines: string[],
  state: LogcatFilterState,
): FilteredLogcatResult => {
  const filteredByLevel = lines.filter((line) => {
    const level = parseLogcatLevel(line);
    if (!level) {
      return true;
    }
    return state.levels[level];
  });

  const patterns = [...state.activePatterns, state.livePattern ?? ""]
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

  const filteredByPatterns = filteredByLevel.filter((line) =>
    matchesAnyPattern(line, patterns),
  );

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
