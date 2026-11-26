export type TerminalDeviceState = {
  connected: boolean;
  sessionId: string | null;
  lines: string[];
  tail: string;
  autoScroll: boolean;
};

export const createDefaultTerminalState = (): TerminalDeviceState => ({
  connected: false,
  sessionId: null,
  lines: [],
  tail: "",
  autoScroll: true,
});

export const appendTerminalBuffer = (
  lines: string[],
  tail: string,
  chunk: string,
  maxLines: number,
) => {
  if (!chunk) {
    return { lines, tail };
  }
  const combined = `${tail}${chunk}`;
  const parts = combined.split("\n");
  const nextTail = parts.pop() ?? "";
  let nextLines = lines.concat(parts);
  if (nextLines.length > maxLines) {
    nextLines = nextLines.slice(-maxLines);
  }
  return { lines: nextLines, tail: nextTail };
};

export const renderTerminalBuffer = (lines: string[], tail: string) => {
  if (!lines.length && !tail) {
    return "No output yet.";
  }
  if (!lines.length) {
    return tail;
  }
  if (tail) {
    return `${lines.join("\n")}\n${tail}`;
  }
  return lines.join("\n");
};
