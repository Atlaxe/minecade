import { describe, expect, it } from "vitest";
import { stripColors, type RegistryGame } from "@minecade/minigame-core";
import { MARK, PREVIEWS, defaultSettings, gameAction, gameButtons, mapOptions, nextSetting, playerRange, settingsFor } from "../behavior_pack/scripts/game-screen.ts";
import { gameForm, gamesForm } from "../behavior_pack/scripts/menus.ts";

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

describe("the game screen model", () => {
  it("offers Random first, then every map with its preview", () => {
    expect(mapOptions(sumo)).toEqual([
      { id: "random", name: "Random", preview: PREVIEWS.random },
      { id: "arena_1", name: "Arena", preview: PREVIEWS.none },
      { id: "pit", name: "Pit", preview: "textures/minecade/maps/sumo/pit" },
    ]);
    const many = { ...sumo, maps: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, name: `Map ${i}` })) };
    expect(mapOptions(many)).toHaveLength(11);
  });

  it("offers Pick or Random teams only for games where players pick their team", () => {
    expect(settingsFor(sumo)).toEqual([]);
    expect(settingsFor(roles)).toEqual([]);
    expect(settingsFor({ ...teams, teams: { count: 2, pick: false } })).toEqual([]);
    const [setting] = settingsFor(teams);
    expect(setting.id).toBe("teams");
    expect(defaultSettings(teams)).toEqual({ teams: "pick" });
    expect(nextSetting(setting, "pick")).toBe("random");
    expect(nextSetting(setting, "random")).toBe("pick");
  });

  it("orders the buttons maps, then settings, then Start, and marks each for its column", () => {
    expect(gameButtons(teams)).toEqual([
      { action: { kind: "map", map: "random" }, mark: MARK.maps[0] },
      { action: { kind: "map", map: "arena_1" }, mark: MARK.maps[1] },
      { action: { kind: "map", map: "pit" }, mark: MARK.maps[0] },
      { action: { kind: "setting", id: "teams" }, mark: MARK.setting },
      { action: { kind: "start" }, mark: MARK.start },
    ]);
    expect(gameAction(sumo, 2)).toEqual({ kind: "map", map: "pit" });
    expect(gameAction(sumo, 3)).toEqual({ kind: "start" });
    expect(gameAction(sumo, 4)).toBeUndefined();
  });

  it("writes player counts", () => {
    expect(playerRange(sumo)).toBe("2-6 players");
    expect(playerRange({ ...sumo, minPlayers: 4, maxPlayers: 4 })).toBe("4 players");
  });
});

describe("the Play forms", () => {
  it("shows a card per game with its players, red when there aren't enough, across three columns", () => {
    const form = gamesForm([
      { game: sumo, playable: true },
      { game: teams, playable: false, reason: "needs at least 2 players" },
      { game: roles, playable: true },
      { game: sumo, playable: true },
    ]) as unknown as { buttons: string[]; titleText: string };
    expect(stripColors(form.titleText)).toBe("Play");
    expect(form.buttons).toEqual([
      `${MARK.games[0]}Sumo\n§72-6 players`,
      `${MARK.games[1]}Paintball\n§cneeds at least 2 players`,
      `${MARK.games[2]}Hide and Seek\n§72-6 players`,
      `${MARK.games[0]}Sumo\n§72-6 players`,
    ]);
  });

  it("marks the map tiles, the chosen map, the settings and Start for their columns", () => {
    const form = gameForm({ choice: { game: teams, playable: true }, map: "pit", settings: { teams: "random" } }) as unknown as {
      buttons: string[];
      titleText: string;
      bodyText: string;
    };
    expect(stripColors(form.titleText)).toBe("Paintball");
    expect(form.buttons).toEqual([
      `${MARK.maps[0]}Random`,
      `${MARK.maps[1]}Arena`,
      `${MARK.maps[0]}${MARK.selected}Pit`,
      `${MARK.setting}Teams: Random`,
      `${MARK.start}Start`,
    ]);
    expect(form.buttons.map(stripColors)).toEqual(["Random", "Arena", "Pit", "Teams: Random", "Start"]);
    expect(stripColors(form.bodyText)).toBe("Knock everyone off.\n\n2-6 players");
  });

  it("warns in the info and dims Start when there aren't enough players", () => {
    const form = gameForm({ choice: { game: sumo, playable: false, reason: "needs at least 2 players" }, map: "random", settings: {} }) as unknown as {
      buttons: string[];
      bodyText: string;
    };
    expect(stripColors(form.bodyText)).toContain("Sumo needs at least 2 players.");
    expect(form.buttons.at(-1)).toBe(`${MARK.start}§7Start`);
  });
});
