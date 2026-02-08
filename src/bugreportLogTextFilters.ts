import {
  addLogTextChip,
  buildLogTextFilters,
  normalizeLogTextChipValue,
  removeLogTextChip,
  type LogTextChip,
  type LogTextChipKind,
} from "./logTextFilters";

export type BugreportLogTextChipKind = LogTextChipKind;
export type BugreportLogTextChip = LogTextChip;

export function normalizeBugreportLogTextChipValue(input: string): string | null {
  return normalizeLogTextChipValue(input);
}

export function addBugreportLogTextChip(
  chips: BugreportLogTextChip[],
  kind: BugreportLogTextChipKind,
  rawValue: string,
): BugreportLogTextChip[] {
  return addLogTextChip(chips, kind, rawValue);
}

export function removeBugreportLogTextChip(chips: BugreportLogTextChip[], id: string): BugreportLogTextChip[] {
  return removeLogTextChip(chips, id);
}

export function buildBugreportLogTextFilters(chips: BugreportLogTextChip[]): {
  text_terms: string[];
  text_excludes: string[];
} {
  return buildLogTextFilters(chips);
}
