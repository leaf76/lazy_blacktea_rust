import type { DashboardCardView } from "./dashboardConfig";
import type { DashboardCardId, DashboardFieldId } from "./types";

type DashboardCopyOptions = {
  isFieldVariantVisible?: (cardId: DashboardCardId, fieldId: DashboardFieldId) => boolean;
};

const compactText = (value: string): string => {
  const normalized = value.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || "--";
};

export const buildDashboardPlainValueText = (value: string): string => compactText(value);

export const buildDashboardFieldMarkdown = (
  cardTitle: string,
  fieldLabel: string,
  value: string,
): string => {
  return `**${compactText(cardTitle)}** ${compactText(fieldLabel)}: ${compactText(value)}`;
};

export const buildDashboardVariantMarkdown = (
  cardTitle: string,
  fieldLabel: string,
  serial: string,
  value: string,
): string => {
  return `**${compactText(cardTitle)}** ${compactText(fieldLabel)} (${compactText(serial)}): ${compactText(value)}`;
};

export const buildDashboardCardMarkdown = (
  card: DashboardCardView,
  options: DashboardCopyOptions = {},
): string => {
  const isVariantVisible = options.isFieldVariantVisible ?? (() => true);
  const lines = [`## ${compactText(card.title)}`];

  if (card.fields.length === 0) {
    lines.push("- No fields visible.");
    return lines.join("\n");
  }

  card.fields.forEach((field) => {
    lines.push(`- ${compactText(field.label)}: ${compactText(field.value)}`);
    if (!field.variants.length || !isVariantVisible(card.id, field.id)) {
      return;
    }
    field.variants.forEach((variant) => {
      lines.push(`  - ${compactText(variant.serial)}: ${compactText(variant.value)}`);
    });
  });

  return lines.join("\n");
};

export const buildDashboardVisibleMarkdown = (
  cards: DashboardCardView[],
  options: DashboardCopyOptions = {},
): string => {
  return cards.map((card) => buildDashboardCardMarkdown(card, options)).join("\n\n").trim();
};
