import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_PREVIEW_ZOOM,
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  formatImageZoomLabel,
  stepImageZoom,
} from "./imagePreviewZoom";

describe("imagePreviewZoom", () => {
  it("steps zoom in and out from fit mode and clamps bounds", () => {
    const zoomedIn = stepImageZoom(DEFAULT_IMAGE_PREVIEW_ZOOM, "in");
    expect(zoomedIn).toEqual({ mode: "custom", scale: 1.25 });
    expect(formatImageZoomLabel(zoomedIn)).toBe("125%");

    const zoomedOut = stepImageZoom({ mode: "custom", scale: IMAGE_ZOOM_MIN }, "out");
    expect(zoomedOut.scale).toBe(IMAGE_ZOOM_MIN);

    const maxZoom = stepImageZoom({ mode: "custom", scale: IMAGE_ZOOM_MAX }, "in");
    expect(maxZoom.scale).toBe(IMAGE_ZOOM_MAX);

    expect(formatImageZoomLabel(DEFAULT_IMAGE_PREVIEW_ZOOM)).toBe("Fit");
  });
});
