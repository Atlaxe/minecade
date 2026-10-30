import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripColors, type RegistryGame } from "@minecade/minigame-core";
import { CLOSE, MARK, PREVIEWS, defaultSettings, menuChoice, gameAction, gameButtons, gamePicture, mapOptions, nextSetting, playerCount, playerRange, settingsFor } from "../behavior_pack/scripts/game-screen.ts";
import { CLOSE_BUTTON, GLYPH, gameForm, gamesForm, settingBars } from "../behavior_pack/scripts/menus.ts";

const sumo: RegistryGame = {
  id: "sumo",
  name: "Sumo",
  description: "Knock everyone off.",
  minPlayers: 2,
  maxPlayers: 6,
  icon: "textures/minecade/games/sumo",
  maps: [
    { id: "arena_1", name: "Arena" },
    { id: "pit", name: "Pit", preview: "textures/minecade/maps/sumo/pit" },
  ],
};
const teams: RegistryGame = { ...sumo, id: "paintball", name: "Paintball", teams: { count: [2, 4] } };
const roles: RegistryGame = { ...sumo, id: "hide", name: "Hide and Seek", teams: { count: 2, defs: [{ id: "seekers", name: "Seekers", color: "§c", size: 1 }, { id: "hiders", name: "Hiders", color: "§a", size: "rest" }] } };
const round = { id: "round", label: "Round", values: [{ value: "15", label: "15 s" }, { value: "30", label: "30 s" }] };
const round3 = { ...round, values: [...round.values, { value: "60", label: "60 s" }] };
const probe: RegistryGame = { ...sumo, id: "probe", name: "Probe", icon: undefined, options: [round] };

describe("the game screen model", () => {
  it("offers every map with its preview, and pictures with placeholders", () => {
    expect(mapOptions(sumo)).toEqual([
      { id: "arena_1", name: "Arena", preview: PREVIEWS.none },
      { id: "pit", name: "Pit", preview: "textures/minecade/maps/sumo/pit" },
    ]);
    expect(gamePicture(sumo)).toBe("textures/minecade/games/sumo");
    expect(gamePicture(probe)).toBe(PREVIEWS.game);
  });

  it("offers Pick or Random teams for games where players pick their team, then the game's own options", () => {
    expect(settingsFor(sumo)).toEqual([]);
    expect(settingsFor(roles)).toEqual([]);
    expect(settingsFor({ ...teams, teams: { count: 2, pick: false } })).toEqual([]);
    const [setting] = settingsFor(teams);
    expect(setting.id).toBe("teams");
    expect(defaultSettings(teams)).toEqual({ teams: "pick" });
    expect(nextSetting(setting, "pick")).toBe("random");
    expect(nextSetting(setting, "random")).toBe("pick");
    expect(settingsFor({ ...teams, options: [round] }).map((entry) => entry.id)).toEqual(["teams", "round"]);
    expect(defaultSettings(probe)).toEqual({ round: "15" });
  });

  it("orders the buttons Random switch, settings, maps, then Start, and marks each for its column", () => {
    expect(gameButtons(teams)).toEqual([
      { action: { kind: "random" }, mark: MARK.toggle },
      { action: { kind: "setting", id: "teams" }, mark: MARK.setting },
      { action: { kind: "map", map: "arena_1" }, mark: MARK.maps[0] },
      { action: { kind: "map", map: "pit" }, mark: MARK.maps[1] },
      { action: { kind: "start" }, mark: MARK.start },
    ]);
    expect(gameAction(sumo, 0)).toEqual({ kind: "random" });
    expect(gameAction(sumo, 2)).toEqual({ kind: "map", map: "pit" });
    expect(gameAction(sumo, 3)).toEqual({ kind: "start" });
    expect(gameAction(sumo, 4)).toBeUndefined();
  });

  it("writes player counts", () => {
    expect(playerRange(sumo)).toBe("2-6 players");
    expect(playerCount(sumo)).toBe("2-6");
    expect(playerCount({ ...sumo, minPlayers: 4, maxPlayers: 4 })).toBe("4");
  });

  it("uses marks that never render, don't contain each other, and that the layouts know", () => {
    const layouts = readFileSync(new URL("../resource_pack/ui/minecade_forms.json", import.meta.url), "utf8");
    const marks = [...MARK.games, ...MARK.maps, MARK.toggle, MARK.on, MARK.setting, MARK.start, MARK.selected, MARK.dim, MARK.player, MARK.portrait, MARK.tab, ...MARK.stats, MARK.preview, MARK.close];
    for (const mark of marks) {
      expect(stripColors(mark)).toBe("");
      expect(mark.endsWith("§r")).toBe(true);
      expect(layouts).toContain(mark);
      for (const other of marks) if (other !== mark) expect(mark).not.toContain(other);
      for (const glyph of Object.values(GLYPH)) expect(glyph).not.toContain(mark);
    }
  });

  it("turns a themed menu's answer into the X (its first button), a place among the other buttons, or back", () => {
    expect(menuChoice(undefined)).toBeUndefined();
    expect(menuChoice(0)).toBe(CLOSE);
    expect(menuChoice(1)).toBe(0);
    expect(menuChoice(4)).toBe(3);
    expect(stripColors(CLOSE_BUTTON)).toBe("Close");
  });

  it("shows a bar per setting value, the chosen one bright", () => {
    expect(settingBars(round3, "30")).toBe(`${GLYPH.barOff}${GLYPH.barOn}${GLYPH.barOff}`);
    expect(settingBars(round3, "15")).toBe(`${GLYPH.barOn}${GLYPH.barOff}${GLYPH.barOff}`);
    expect(settingBars(round3, "nope")).toBe(`${GLYPH.barOn}${GLYPH.barOff}${GLYPH.barOff}`);
    expect(settingBars(round3, undefined)).toBe(`${GLYPH.barOn}${GLYPH.barOff}${GLYPH.barOff}`);
  });
});

describe("the Play forms", () => {
  it("shows a card per game with a player icon and count, red when there aren't enough, across three columns", () => {
    const form = gamesForm([
      { game: sumo, playable: true },
      { game: teams, playable: false, reason: "needs at least 2 players" },
      { game: roles, playable: true },
      { game: probe, playable: true },
    ]) as unknown as { buttons: string[]; titleText: string };
    expect(stripColors(form.titleText)).toBe("Play");
    expect(form.buttons).toEqual([
      CLOSE_BUTTON,
      `${MARK.games[0]}Sumo\n§7${GLYPH.player} 2-6`,
      `${MARK.games[1]}Paintball\n§c${GLYPH.player} 2-6`,
      `${MARK.games[2]}Hide and Seek\n§7${GLYPH.player} 2-6`,
      `${MARK.games[0]}Probe\n§7${GLYPH.player} 2-6`,
    ]);
  });

  it("marks the switch, the settings, the map tiles and Start; the chosen map is outlined", () => {
    const form = gameForm({ choice: { game: teams, playable: true }, random: false, map: "pit", settings: { teams: "random" } }) as unknown as {
      buttons: string[];
      titleText: string;
      bodyText: string;
    };
    expect(stripColors(form.titleText)).toBe("Paintball");
    expect(form.buttons).toEqual([
      CLOSE_BUTTON,
      `${MARK.toggle}Random map`,
      `${MARK.setting}Teams: Random\n${GLYPH.barOff}${GLYPH.barOn}`,
      `${MARK.maps[0]}Arena`,
      `${MARK.maps[1]}${MARK.selected}Pit`,
      `${MARK.start}Start`,
    ]);
    expect(form.buttons.map(stripColors)).toEqual(["Close", "Random map", `Teams: Random\n${GLYPH.barOff}${GLYPH.barOn}`, "Arena", "Pit", "Start"]);
    expect(stripColors(form.bodyText)).toBe("Knock everyone off.\n\n2-6 players");
  });

  it("turns the switch on and dims every map tile while the map is random", () => {
    const form = gameForm({ choice: { game: sumo, playable: true }, random: true, map: "pit", settings: {} }) as unknown as { buttons: string[] };
    expect(form.buttons).toEqual([CLOSE_BUTTON, `${MARK.toggle}${MARK.on}Random map`, `${MARK.maps[0]}${MARK.dim}Arena`, `${MARK.maps[1]}${MARK.dim}Pit`, `${MARK.start}Start`]);
  });

  it("warns in the info and dims Start when there aren't enough players", () => {
    const form = gameForm({ choice: { game: sumo, playable: false, reason: "needs at least 2 players" }, random: true, map: "arena_1", settings: {} }) as unknown as {
      buttons: string[];
      bodyText: string;
    };
    expect(stripColors(form.bodyText)).toContain("Sumo needs at least 2 players.");
    expect(form.buttons.at(-1)).toBe(`${MARK.start}§7Start`);
  });
});
