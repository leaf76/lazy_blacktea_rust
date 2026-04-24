import { describe, expect, it } from "vitest";
import tauriConfig from "../src-tauri/tauri.conf.json";

type TauriConfigWithAssetProtocol = {
  app?: {
    security?: {
      assetProtocol?: {
        enable?: boolean;
        scope?: unknown;
      };
    };
  };
};

describe("tauri asset protocol", () => {
  it("allows imported theme backgrounds to render through convertFileSrc", () => {
    const assetProtocol = (tauriConfig as TauriConfigWithAssetProtocol).app?.security?.assetProtocol;

    expect(assetProtocol?.enable).toBe(true);
    expect(assetProtocol?.scope).toContain("$HOME/.lazy_blacktea/themes/backgrounds/**");
  });
});
