export type UiBoundsRect = { x: number; y: number; w: number; h: number };

export type UiNodeInfo = {
  rect: UiBoundsRect;
  bounds: string;
  index?: string;
  text?: string;
  resourceId?: string;
  className?: string;
  packageName?: string;
  contentDesc?: string;
  clickable?: boolean;
  enabled?: boolean;
  focusable?: boolean;
  focused?: boolean;
  selected?: boolean;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAttr = (tag: string, attr: string) => {
  const re = new RegExp(`${escapeRegex(attr)}="([^"]*)"`);
  const match = re.exec(tag);
  return match ? match[1] : null;
};

const parseBoolAttr = (tag: string, attr: string) => {
  const value = getAttr(tag, attr);
  if (value === null) {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
};

export const parseUiBoundsRects = (xml: string, limit = 2500) => {
  const boundsRegex = /bounds="\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]"/g;
  const rects: UiBoundsRect[] = [];
  let truncated = false;
  let match: RegExpExecArray | null;

  while ((match = boundsRegex.exec(xml)) !== null) {
    const x1 = Number(match[1]);
    const y1 = Number(match[2]);
    const x2 = Number(match[3]);
    const y2 = Number(match[4]);
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      continue;
    }
    if (x2 <= x1 || y2 <= y1) {
      continue;
    }
    rects.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    if (rects.length >= limit) {
      truncated = true;
      break;
    }
  }

  return { rects, truncated };
};

export const parseUiNodes = (xml: string, limit = 2500) => {
  const nodeRegex = /<node\b[^>]*\bbounds="\[\s*-?\d+\s*,\s*-?\d+\s*\]\[\s*-?\d+\s*,\s*-?\d+\s*\]"[^>]*\/?>/g;
  const boundsRegex = /bounds="(\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\])"/;
  const nodes: UiNodeInfo[] = [];
  let truncated = false;
  let match: RegExpExecArray | null;

  while ((match = nodeRegex.exec(xml)) !== null) {
    const tag = match[0];
    const boundsMatch = boundsRegex.exec(tag);
    if (!boundsMatch) {
      continue;
    }
    const x1 = Number(boundsMatch[2]);
    const y1 = Number(boundsMatch[3]);
    const x2 = Number(boundsMatch[4]);
    const y2 = Number(boundsMatch[5]);
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      continue;
    }
    if (x2 <= x1 || y2 <= y1) {
      continue;
    }

    const node: UiNodeInfo = {
      rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
      bounds: boundsMatch[1],
    };

    const index = getAttr(tag, "index");
    const text = getAttr(tag, "text");
    const resourceId = getAttr(tag, "resource-id");
    const className = getAttr(tag, "class");
    const packageName = getAttr(tag, "package");
    const contentDesc = getAttr(tag, "content-desc");

    if (index) node.index = index;
    if (text) node.text = text;
    if (resourceId) node.resourceId = resourceId;
    if (className) node.className = className;
    if (packageName) node.packageName = packageName;
    if (contentDesc) node.contentDesc = contentDesc;

    const clickable = parseBoolAttr(tag, "clickable");
    const enabled = parseBoolAttr(tag, "enabled");
    const focusable = parseBoolAttr(tag, "focusable");
    const focused = parseBoolAttr(tag, "focused");
    const selected = parseBoolAttr(tag, "selected");

    if (clickable !== null) node.clickable = clickable;
    if (enabled !== null) node.enabled = enabled;
    if (focusable !== null) node.focusable = focusable;
    if (focused !== null) node.focused = focused;
    if (selected !== null) node.selected = selected;

    nodes.push(node);
    if (nodes.length >= limit) {
      truncated = true;
      break;
    }
  }

  return { nodes, truncated };
};

export const pickUiNodeAtPoint = (nodes: UiNodeInfo[], x: number, y: number) => {
  let bestIndex = -1;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let i = 0; i < nodes.length; i += 1) {
    const rect = nodes[i].rect;
    if (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) {
      continue;
    }
    const area = rect.w * rect.h;
    if (area < bestArea) {
      bestArea = area;
      bestIndex = i;
    }
  }
  return bestIndex;
};
