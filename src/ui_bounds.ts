export type UiBoundsRect = { x: number; y: number; w: number; h: number };

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
