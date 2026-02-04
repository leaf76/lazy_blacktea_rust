export type BugreportLogTextChipKind = "include" | "exclude";

export type BugreportLogTextChip = {
  id: string;
  kind: BugreportLogTextChipKind;
  value: string;
};

export function normalizeBugreportLogTextChipValue(input: string): string | null {
  const trimmed = input.trim();
  return trimmed ? trimmed : null;
}

function makeChipId(kind: BugreportLogTextChipKind, value: string) {
  return `${kind}:${value.toLowerCase()}`;
}

export function addBugreportLogTextChip(
  chips: BugreportLogTextChip[],
  kind: BugreportLogTextChipKind,
  rawValue: string,
): BugreportLogTextChip[] {
  const value = normalizeBugreportLogTextChipValue(rawValue);
  if (!value) {
    return chips;
  }
  const id = makeChipId(kind, value);
  if (chips.some((chip) => chip.id === id)) {
    return chips;
  }
  return [...chips, { id, kind, value }];
}

export function removeBugreportLogTextChip(chips: BugreportLogTextChip[], id: string): BugreportLogTextChip[] {
  return chips.filter((chip) => chip.id !== id);
}

export function buildBugreportLogTextFilters(chips: BugreportLogTextChip[]): {
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

