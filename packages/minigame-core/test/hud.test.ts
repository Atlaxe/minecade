import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHIMES, COUNT_PLACES, HUD_MARK, countCodes, countdownChime, hudLine, playChime } from "../src/hud.ts";
import { stripColors } from "../src/text.ts";
import { world } from "./fake-mc-server.ts";

describe("hudLine", () => {
  it("starts with the invisible mark, then the clock and the rest of the line", () => {
    expect(hudLine(299)).toBe(`${HUD_MARK}§f4:59`);
    expect(hudLine(65, "Lives: 2")).toBe(`${HUD_MARK}§f1:05§7   Lives: 2`);
    expect(hudLine(4.2)).toBe(`${HUD_MARK}§c0:05`); // partial seconds round up
    expect(stripColors(hudLine(600, "Respawning in 3"))).toBe("10:00   Respawning in 3");
  });

  it("turns the clock red in the last 30 seconds", () => {
    expect(hudLine(31)).toBe(`${HUD_MARK}§f0:31`);
    expect(hudLine(30)).toBe(`${HUD_MARK}§c0:30`);
  });

  it("uses the same mark as the core resource pack", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud.split(`'${HUD_MARK}'`).length - 1).toBe(2);
    expect(stripColors(HUD_MARK)).toBe("");
  });

  it("is just the line without a clock", () => {
    expect(hudLine(undefined, "Respawning in 3")).toBe("Respawning in 3");
    expect(hudLine(undefined)).toBe("");
  });

  it("ends with the player's own score as codes, which never show in the clock's box", () => {
    expect(hudLine(65, "+1 arrow", 15)).toBe(`${HUD_MARK}§f1:05§7   +1 arrow§k§t§1§k§u§5§r`);
    expect(stripColors(hudLine(65, "", 7))).toBe("1:05");
  });
});

describe("countCodes", () => {
  it("names each digit by its place, leaving out leading zeros", () => {
    expect(countCodes(0)).toBe("§k§u§0§r");
    expect(countCodes(7)).toBe("§k§u§7§r");
    expect(countCodes(15)).toBe("§k§t§1§k§u§5§r");
    expect(countCodes(208)).toBe("§k§h§2§k§t§0§k§u§8§r");
    expect(stripColors(countCodes(208))).toBe("");
  });

  it("keeps to whole numbers from 0 to 999", () => {
    expect(countCodes(-3)).toBe(countCodes(0));
    expect(countCodes(1234)).toBe(countCodes(999));
    expect(countCodes(4.6)).toBe(countCodes(5));
  });

  it("matches the core resource pack: a label for every digit in every place, and the box keyed on the units", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    COUNT_PLACES.forEach((place, index) => {
      for (let digit = index === 0 ? 1 : 0; digit <= 9; digit++) {
        expect(hud).toContain(`"text": "${digit}", "ignored": "(($atext - '${place}§${digit}') = $atext)"`);
      }
    });
    expect(hud).toContain(`"ignored": "(($atext - '${COUNT_PLACES[2]}') = $atext)"`);
  });
});

describe("countdown chimes", () => {
  it("ticks above 3, rings a bell for 3, 2 and 1, and plays the flourish at 0", () => {
    expect([10, 5, 4, 3, 2, 1, 0].map(countdownChime)).toEqual(["tick", "tick", "tick", "bell", "bell", "bell", "go"]);
  });

  it("plays the chime's sound, and skips a player who left", () => {
    const player = world.join("Alex");
    playChime(player as never, "bell");
    expect(player.sounds).toEqual([{ id: CHIMES.bell.id, pitch: CHIMES.bell.pitch, volume: CHIMES.bell.volume }]);
    player.isValid = false;
    playChime(player as never, "go");
    expect(player.sounds).toHaveLength(1);
    world.reset();
  });
});
