import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { CLOCK_HUD_FILE, clockHudFile } from "../../../tools/assets/clock-hud.ts";
import { ROUNDS_HUD_FILE, roundsHudFile } from "../../../tools/assets/rounds-hud.ts";
import {
  CHIMES,
  CLOCK_PLACES,
  CLOCK_URGENT,
  COUNT_PLACES,
  HUD_MARK,
  ROUND_COLORS,
  TEXT_MARK,
  bestOfCodes,
  clockCodes,
  countCodes,
  countdownChime,
  hudLine,
  hudText,
  playChime,
} from "../src/hud.ts";
import { stripColors } from "../src/text.ts";
import { world } from "./fake-mc-server.ts";

describe("hudLine", () => {
  it("starts with the invisible mark, then the text and its code, then the clock as codes", () => {
    expect(hudLine(299)).toBe(`${HUD_MARK}${clockCodes(299)}`);
    expect(hudLine(65, "Lives: 2")).toBe(`${HUD_MARK}Lives: 2§r${TEXT_MARK}§r${clockCodes(65)}`);
    // Only the text shows: the clock is drawn from its codes, in a bubble of its own.
    expect(stripColors(hudLine(600, "§7Build: §fa boat"))).toBe("Build: a boat");
    expect(stripColors(hudLine(600))).toBe("");
  });

  it("names each digit of the clock by its place, the minutes' tens only from 10, partial seconds rounded up", () => {
    expect(clockCodes(173)).toBe("§k§n§2§k§p§5§k§a§3§r"); // 2:53
    expect(clockCodes(600)).toBe("§k§g§1§k§n§0§k§p§0§k§a§0§r"); // 10:00
    expect(clockCodes(4.2)).toBe(`${CLOCK_URGENT}§k§n§0§k§p§0§k§a§5§r`);
    expect(clockCodes(-3)).toBe(clockCodes(0));
    expect(clockCodes(10_000)).toBe(clockCodes(99 * 60 + 59));
  });

  it("turns the clock red in the last 30 seconds", () => {
    expect(clockCodes(31).startsWith(CLOCK_URGENT)).toBe(false);
    expect(clockCodes(30).startsWith(CLOCK_URGENT)).toBe(true);
  });

  it("uses the same marks as the core resource pack", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud.split(`'${HUD_MARK}'`).length - 1).toBe(2);
    expect(stripColors(HUD_MARK)).toBe("");
    // The text's bubble and its gap are there only with the text code; the clock's only with a seconds digit.
    expect(hud.split(`"ignored": "(($atext - '${TEXT_MARK}') = $atext)"`).length - 1).toBe(2);
    expect(hud).toContain(`"ignored": "(($atext - '${CLOCK_PLACES[3]}') = $atext)"`);
    expect(hud).toContain('"mc_clock_digits@minecade_clock.digits"');
  });

  it("is just the line without a clock, above the hotbar", () => {
    expect(hudLine(undefined, "Respawning in 3")).toBe("Respawning in 3");
    expect(hudLine(undefined)).toBe("");
  });

  it("puts text alone top right, in its own bubble", () => {
    expect(hudText("§eReplace mode")).toBe(`${HUD_MARK}§eReplace mode§r${TEXT_MARK}§r`);
    expect(stripColors(hudText("§eReplace mode"))).toBe("Replace mode");
  });

  it("ends with the player's own score as codes, which never show", () => {
    expect(hudLine(65, "+1 arrow", 15)).toBe(`${HUD_MARK}+1 arrow§r${TEXT_MARK}§r${clockCodes(65)}§k§t§1§k§u§5§r`);
    expect(stripColors(hudLine(65, "", 7))).toBe("");
  });
});

describe("the clock in the core pack", () => {
  it("matches the generated file: a white and a red label for every digit in every place", () => {
    expect(readFileSync(CLOCK_HUD_FILE, "utf8").replaceAll("\r\n", "\n")).toBe(clockHudFile());
    const defs = JSON.parse(readFileSync(new URL("../resource_pack/ui/_ui_defs.json", import.meta.url), "utf8"));
    expect(defs.ui_defs).toContain("ui/minecade_clock.json");
    const file = clockHudFile();
    CLOCK_PLACES.forEach((place, index) => {
      for (let digit = index === 0 ? 1 : 0; digit <= (index === 2 ? 5 : 9); digit++) {
        expect(file.split(`"ignored":"(($atext - '${place}§${digit}') = $atext)"`).length - 1).toBe(2);
      }
    });
    expect(file).toContain(`"ignored": "(not (($atext - '${CLOCK_URGENT}') = $atext))"`);
    expect(file).toContain(`"ignored": "(($atext - '${CLOCK_URGENT}') = $atext)"`);
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

  it("rides on the HUD line after the clock and the own score, and marks a line with no clock", () => {
    const rounds = bestOfCodes({ display: "icons", rounds: 5, winners: [] });
    expect(hudLine(65, "", 3, rounds)).toBe(`${HUD_MARK}${clockCodes(65)}§k§u§3§r${rounds}`);
    expect(hudLine(undefined, "", undefined, rounds)).toBe(`${HUD_MARK}${rounds}`);
    expect(hudLine(undefined, "Lives: 2", undefined, rounds)).toBe(`${HUD_MARK}Lives: 2§r${TEXT_MARK}§r${rounds}`);
    expect(stripColors(hudLine(undefined, "Lives: 2", undefined, rounds))).toBe("Lives: 2");
  });

  it("matches the core pack: the generated box is current", () => {
    expect(readFileSync(ROUNDS_HUD_FILE, "utf8").replaceAll("\r\n", "\n")).toBe(roundsHudFile());
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
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
