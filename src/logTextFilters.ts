export type LogTextChipKind = "include" | "exclude";

export type LogTextChip = {
  id: string;
  kind: LogTextChipKind;
  value: string;
};

export function normalizeLogTextChipValue(input: string): string | null {
  const trimmed = input.trim();
  return trimmed ? trimmed : null;
}

function makeChipId(kind: LogTextChipKind, value: string) {
  return `${kind}:${value.toLowerCase()}`;
}

export function addLogTextChip(
  chips: LogTextChip[],
  kind: LogTextChipKind,
  rawValue: string,
): LogTextChip[] {
  const value = normalizeLogTextChipValue(rawValue);
  if (!value) {
    return chips;
  }
  const id = makeChipId(kind, value);
  if (chips.some((chip) => chip.id === id)) {
    return chips;
  }
  return [...chips, { id, kind, value }];
}

export function removeLogTextChip(chips: LogTextChip[], id: string): LogTextChip[] {
  return chips.filter((chip) => chip.id !== id);
}

export function buildLogTextFilters(chips: LogTextChip[]): {
  text_terms: string[];
  text_excludes: string[];
} {
  const text_terms: string[] = [];
  const text_excludes: string[] = [];
  for (const chip of chips) {
    if (chip.kind === "exclude") {
      text_excludes.push(chip.value);
    } else {
      text_terms.push(chip.value);
    }
  }
  return { text_terms, text_excludes };
}

