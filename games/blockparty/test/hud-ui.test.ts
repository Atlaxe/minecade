import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCKPARTY_HUD_FILE, blockpartyHudFile } from "../../../tools/assets/blockparty-hud-ui.ts";
import { loadingCode } from "../behavior_pack/scripts/bar-codes.ts";

describe("Block Party's own HUD", () => {
  it("is the file tools/assets/blockparty-hud-ui.ts writes (rerun it after changing the codes)", () => {
    expect(readFileSync(BLOCKPARTY_HUD_FILE, "utf8").replaceAll("\r\n", "\n")).toBe(blockpartyHudFile());
  });

  it("puts the loading screen's level on the line", () => {
    expect(loadingCode(0)).toBe("");
    expect(loadingCode(3)).toBe("§k§d§3");
    expect(loadingCode(99)).toBe("§k§d§8");
  });

  it("leaves the hotbar to vanilla (no pack hotbar in the HUD)", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud).not.toContain("blockparty_hud.hotbar");
    expect(hud).not.toContain("item_name_text_root");
  });
});
