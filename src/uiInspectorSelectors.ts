import type { UiNodeInfo } from "./ui_bounds";

export type UiNodeSelectors = {
  xpath: string;
  uiSelector: string;
  flags: string[];
};

const escapeXPathLiteral = (value: string): string => {
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  const parts = value.split('"').map((part) => `"${part}"`);
  return `concat(${parts.join(`, '"', `)})`;
};

const escapeJavaString = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");

export const buildUiNodeSelectors = (node: UiNodeInfo): UiNodeSelectors => {
  const tag = node.className?.trim() || "*";
  const predicates: string[] = [];
  const uiParts: string[] = ["new UiSelector()"];

  if (node.className?.trim()) {
    uiParts.push(`.className("${escapeJavaString(node.className.trim())}")`);
  }

  if (node.resourceId?.trim()) {
    const rid = node.resourceId.trim();
    predicates.push(`@resource-id=${escapeXPathLiteral(rid)}`);
    uiParts.push(`.resourceId("${escapeJavaString(rid)}")`);
  } else if (node.contentDesc?.trim()) {
    const desc = node.contentDesc.trim();
    predicates.push(`@content-desc=${escapeXPathLiteral(desc)}`);
    uiParts.push(`.description("${escapeJavaString(desc)}")`);
  } else if (node.text?.trim()) {
    const text = node.text.trim();
    predicates.push(`@text=${escapeXPathLiteral(text)}`);
    uiParts.push(`.text("${escapeJavaString(text)}")`);
  } else if (node.index?.trim()) {
    predicates.push(`@index=${escapeXPathLiteral(node.index.trim())}`);
    const parsedIndex = Number.parseInt(node.index.trim(), 10);
    if (Number.isFinite(parsedIndex)) {
      uiParts.push(`.index(${parsedIndex})`);
    }
  }

  const xpath = predicates.length > 0 ? `//${tag}[${predicates.join(" and ")}]` : `//${tag}`;

  const flags: string[] = [];
  if (node.clickable) flags.push("clickable");
  if (node.enabled) flags.push("enabled");
  if (node.focusable) flags.push("focusable");
  if (node.focused) flags.push("focused");
  if (node.selected) flags.push("selected");

  return {
    xpath,
    uiSelector: uiParts.join(""),
    flags,
  };
};
