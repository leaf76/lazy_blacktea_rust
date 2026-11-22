import type { ReactNode } from "react";

export function renderHighlightedLogcatLine(line: string, searchPattern: RegExp | null) {
  if (!searchPattern) {
    return line;
  }
  const parts: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  searchPattern.lastIndex = 0;
  let match = searchPattern.exec(line);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > lastIndex) {
      parts.push({ text: line.slice(lastIndex, start), match: false });
    }
    parts.push({ text: line.slice(start, end), match: true });
    lastIndex = end;
    match = searchPattern.exec(line);
  }
  if (lastIndex < line.length) {
    parts.push({ text: line.slice(lastIndex), match: false });
  }
  searchPattern.lastIndex = 0;
  return parts.map((part, index) =>
    part.match ? (
      <mark key={`${part.text}-${index}`}>{part.text}</mark>
    ) : (
      <span key={`${part.text}-${index}`}>{part.text}</span>
    ),
  );
}

export function renderHighlightedSnippet(
  snippet: string,
  searchPattern: RegExp | null,
): ReactNode[] {
  return snippet.split("\n").map((line, index) => (
    <div key={`${line}-${index}`} className="bugreport-extract-snippet-line">
      {renderHighlightedLogcatLine(line, searchPattern)}
    </div>
  ));
}
