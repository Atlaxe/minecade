import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { ROUNDS_HUD_FILE, roundsHudFile } from "../../../tools/assets/rounds-hud.ts";
import {
  CHIMES,
  COUNT_PLACES,
  EMPTY_CLOCK_BOX,
  HUD_MARK,
  NO_CLOCK,
  ROUND_COLORS,
  bestOfCodes,
  countCodes,
  countdownChime,
  hudLine,
  playChime,
} from "../src/hud.ts";
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

describe("best-of rounds on the HUD", () => {
  it("names the circles and each won circle's winner color, gray for a drawn round", () => {
    expect(bestOfCodes({ display: "icons", rounds: 5, winners: [] })).toBe("§k§i§5§r");
    expect(bestOfCodes({ display: "icons", rounds: 5, winners: ["§c", "§9", undefined] })).toBe("§k§i§5§k§j§1§c§k§j§2§9§k§j§3§7§r");
    expect(bestOfCodes({ display: "icons", rounds: 9, winners: [] })).toBe("§k§i§7§r"); // room for 7
    expect(stripColors(bestOfCodes({ display: "icons", rounds: 3, winners: ["§c"] }))).toBe("");
  });

  it("gives each side's color and wins, tens only from 10, white for colors it can't draw", () => {
    expect(bestOfCodes({ display: "score", sides: [{ color: "§c", wins: 2 }, { color: "§9", wins: 0 }] })).toBe("§k§q§1§c§k§s§1§2§k§q§2§9§k§s§2§0§r");
    expect(bestOfCodes({ display: "score", sides: [{ color: "§3", wins: 10 }] })).toBe("§k§q§1§f§k§m§1§1§k§s§1§0§r");
    expect(bestOfCodes({ display: "score", sides: [{ color: "§c", wins: 250 }] })).toBe("§k§q§1§c§k§m§1§9§k§s§1§9§r");
  });

  it("rides on the HUD line after the clock and the own score, or marks a line with no clock", () => {
    const rounds = bestOfCodes({ display: "icons", rounds: 5, winners: [] });
    expect(hudLine(65, "", 3, rounds)).toBe(`${HUD_MARK}§f1:05§k§u§3§r${rounds}`);
    expect(hudLine(undefined, "", undefined, rounds)).toBe(`${HUD_MARK}${EMPTY_CLOCK_BOX}${rounds}`);
    expect(hudLine(undefined, "Lives: 2", undefined, rounds)).toBe(`${HUD_MARK}§fLives: 2${NO_CLOCK}${rounds}`);
    expect(stripColors(hudLine(undefined, "Lives: 2", undefined, rounds))).toBe("Lives: 2");
  });

  it("matches the core pack: the generated box is current, and the clock's box reads the no-clock codes", () => {
    expect(readFileSync(ROUNDS_HUD_FILE, "utf8").replaceAll("\r\n", "\n")).toBe(roundsHudFile());
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud).toContain(`"ignored": "(not (($atext - '${EMPTY_CLOCK_BOX}') = $atext))"`);
    expect(hud).toContain(`"ignored": "(not (($atext - '${NO_CLOCK}') = $atext))"`);
    expect(hud).toContain('"mc_rounds_box@minecade_rounds.box"');
    const defs = JSON.parse(readFileSync(new URL("../resource_pack/ui/_ui_defs.json", import.meta.url), "utf8"));
    expect(defs.ui_defs).toContain("ui/minecade_rounds.json");
    const box = roundsHudFile();
    for (const code of ROUND_COLORS) expect(box).toContain(`textures/minecade/hud/round_${code}`);
  });

  it("has a picture for every circle color", () => {
    for (const name of ["open", ...ROUND_COLORS]) {
      expect(existsSync(new URL(`../resource_pack/textures/minecade/hud/round_${name}.png`, import.meta.url)), name).toBe(true);
    }
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
