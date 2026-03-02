import { describe, expect, it } from "vitest";
import {
  buildBugreportPopupHash,
  buildBugreportPopupWindowLabel,
  parseBugreportPopupContext,
} from "./bugreportWindow";

describe("bugreportWindow", () => {
  it("parses popup context when popup flag is enabled", () => {
    expect(parseBugreportPopupContext("?popup=1")).toEqual({
      isPopup: true,
      sourcePath: null,
    });
  });

  it("parses popup source from query", () => {
    expect(
      parseBugreportPopupContext(
        "?popup=1&source=%2Ftmp%2Fbugreport-2026-03-02.txt",
      ),
    ).toEqual({
      isPopup: true,
      sourcePath: "/tmp/bugreport-2026-03-02.txt",
    });
  });

  it("keeps normal mode when popup flag is not enabled", () => {
    expect(
      parseBugreportPopupContext(
        "?source=%2Ftmp%2Fbugreport-2026-03-02.txt",
      ),
    ).toEqual({
      isPopup: false,
      sourcePath: null,
    });
  });

  it("builds popup hash with and without source", () => {
    expect(buildBugreportPopupHash()).toBe("#/bugreport-logviewer?popup=1");
    expect(buildBugreportPopupHash("/tmp/a b.txt")).toBe(
      "#/bugreport-logviewer?popup=1&source=%2Ftmp%2Fa%20b.txt",
    );
  });

  it("builds deterministic popup labels from source path", () => {
    const source = "/tmp/a b.txt";
    expect(buildBugreportPopupWindowLabel(source)).toBe(
      buildBugreportPopupWindowLabel(source),
    );
    expect(buildBugreportPopupWindowLabel("")).toBe("bugreport-popup-empty");
    expect(buildBugreportPopupWindowLabel(source)).not.toBe(
      buildBugreportPopupWindowLabel("/tmp/c d.txt"),
    );
  });
});
