import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCKPARTY_HUD_FILE, blockpartyHudFile } from "../../../tools/assets/blockparty-hud-ui.ts";
import { BAR_ICONS, barCodes, loadingCode, slotCode } from "../behavior_pack/scripts/bar-codes.ts";

describe("Block Party's own HUD", () => {
  it("is the file tools/assets/blockparty-hud-ui.ts writes (rerun it after changing the codes or icons)", () => {
    expect(readFileSync(BLOCKPARTY_HUD_FILE, "utf8").replaceAll("\r\n", "\n")).toBe(blockpartyHudFile());
  });

  it("has an item of the pack's own for every icon, with the clear texture", () => {
    expect(existsSync(new URL("../resource_pack/textures/blockparty/items/blank.png", import.meta.url))).toBe(true);
    for (const icon of Object.keys(BAR_ICONS)) {
      const item = JSON.parse(readFileSync(new URL(`../behavior_pack/items/bar_${icon}.json`, import.meta.url), "utf8"));
      expect(item["minecraft:item"].description.identifier).toBe(`blockparty:bar_${icon}`);
      expect(item["minecraft:item"].components["minecraft:icon"].textures.default).toBe("blockparty_blank");
    }
  });

  it("puts each slot's code, its icon's and the selected slot's on the line", () => {
    expect(slotCode(6, "items")).toBe("§k§f§6§a");
    expect(barCodes([{ slot: 7, icon: "dice" }, { slot: 8, icon: "tests" }], 7)).toBe("§k§f§7§b§k§f§8§c§k§o§7");
    expect(barCodes([], undefined)).toBe("");
    expect(loadingCode(0)).toBe("");
    expect(loadingCode(3)).toBe("§k§d§3");
    expect(loadingCode(99)).toBe("§k§d§8");
  });

  it("gives no two icons the same code, and none a slot's digit", () => {
    const codes = Object.values(BAR_ICONS).map((icon) => icon.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]$/);
  });
});
