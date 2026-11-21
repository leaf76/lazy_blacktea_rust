export type ImagePreviewZoomState = {
  mode: "fit" | "custom";
  scale: number;
};

export const IMAGE_ZOOM_MIN = 0.25;
export const IMAGE_ZOOM_MAX = 4.0;
export const IMAGE_ZOOM_STEP = 0.25;

export const DEFAULT_IMAGE_PREVIEW_ZOOM: ImagePreviewZoomState = {
  mode: "fit",
  scale: 1,
};

export const clampImageZoomScale = (scale: number): number => {
  if (!Number.isFinite(scale)) {
    return 1;
  }
  const rounded = Math.round(scale * 100) / 100;
  return Math.max(IMAGE_ZOOM_MIN, Math.min(IMAGE_ZOOM_MAX, rounded));
};

export const stepImageZoom = (
  current: ImagePreviewZoomState,
  direction: "in" | "out",
): ImagePreviewZoomState => {
  const base = current.mode === "fit" ? 1 : current.scale;
  const delta = direction === "in" ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP;
  return {
    mode: "custom",
    scale: clampImageZoomScale(base + delta),
  };
};

export const formatImageZoomLabel = (state: ImagePreviewZoomState): string => {
  if (state.mode === "fit") {
    return "Fit";
  }
  return `${Math.round(state.scale * 100)}%`;
};
