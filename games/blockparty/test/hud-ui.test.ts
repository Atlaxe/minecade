import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCKPARTY_HUD_FILE, blockpartyHudFile } from "../../../tools/assets/blockparty-hud-ui.ts";
import { BAR_ICONS, barCodes, loadingCode, slotCode } from "../behavior_pack/scripts/bar-codes.ts";

describe("Block Party's own HUD", () => {
  it("is the file tools/assets/blockparty-hud-ui.ts writes (rerun it after changing the codes or icons)", () => {
    expect(readFileSync(BLOCKPARTY_HUD_FILE, "utf8").replaceAll("\r\n", "\n")).toBe(blockpartyHudFile());
  });

  it("has a texture for every icon", () => {
    for (const icon of Object.keys(BAR_ICONS)) expect(existsSync(new URL(`../resource_pack/textures/blockparty/hud/icon_${icon}.png`, import.meta.url))).toBe(true);
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
    const codes = Object.values(BAR_ICONS);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]$/);
  });
});
