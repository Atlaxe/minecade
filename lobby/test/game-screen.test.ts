import { describe, expect, it } from "vitest";
import { stripColors, type RegistryGame } from "@minecade/minigame-core";
import { ICONS, MAP_SLOTS, SETTING_SLOTS, START_SLOT, defaultSettings, gameAction, mapOptions, nextSetting, playerRange, settingsFor } from "../behavior_pack/scripts/game-screen.ts";
import { SELECTED, gameForm, gamesForm } from "../behavior_pack/scripts/menus.ts";

const sumo: RegistryGame = {
  id: "sumo",
  name: "Sumo",
  description: "Knock everyone off.",
  minPlayers: 2,
  maxPlayers: 6,
  icon: "textures/minecade/games/sumo",
  maps: [
    { id: "arena_1", name: "Arena" },
    { id: "pit", name: "Pit", icon: "textures/minecade/maps/sumo/pit" },
  ],
};
const teams: RegistryGame = { ...sumo, id: "paintball", name: "Paintball", teams: { count: [2, 4] } };
const roles: RegistryGame = { ...sumo, id: "hide", name: "Hide and Seek", teams: { count: 2, defs: [{ id: "seekers", name: "Seekers", color: "§c", size: 1 }, { id: "hiders", name: "Hiders", color: "§a", size: "rest" }] } };

describe("the game screen model", () => {
  it("offers Random first, then the game's maps with their icons", () => {
    expect(mapOptions(sumo)).toEqual([
      { id: "random", name: "Random", icon: ICONS.random },
      { id: "arena_1", name: "Arena", icon: ICONS.map },
      { id: "pit", name: "Pit", icon: "textures/minecade/maps/sumo/pit" },
    ]);
    const many = { ...sumo, maps: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, name: `Map ${i}` })) };
    expect(mapOptions(many)).toHaveLength(MAP_SLOTS);
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

  it("maps each button to its action: maps, then Start, then the settings", () => {
    expect(gameAction(sumo, 0)).toEqual({ kind: "map", map: "random" });
    expect(gameAction(sumo, 2)).toEqual({ kind: "map", map: "pit" });
    expect(gameAction(sumo, 5)).toBeUndefined(); // an empty map slot
    expect(gameAction(sumo, START_SLOT)).toEqual({ kind: "start" });
    expect(gameAction(sumo, START_SLOT + 1)).toBeUndefined();
    expect(gameAction(teams, START_SLOT + 1)).toEqual({ kind: "setting", id: "teams" });
  });

  it("writes player counts", () => {
    expect(playerRange(sumo)).toBe("2-6 players");
    expect(playerRange({ ...sumo, minPlayers: 4, maxPlayers: 4 })).toBe("4 players");
  });
});

describe("the Play forms", () => {
  it("shows a tile per game with its players, red when there aren't enough", () => {
    const form = gamesForm([
      { game: sumo, playable: true },
      { game: teams, playable: false, reason: "needs at least 2 players" },
    ]) as unknown as { buttons: string[]; titleText: string };
    expect(stripColors(form.titleText)).toBe("Play");
    expect(form.buttons).toEqual(["Sumo\n§72-6 players", "Paintball\n§cneeds at least 2 players"]);
  });

  it("lays out map tiles, then Start, then the settings, at fixed places", () => {
    const form = gameForm({ choice: { game: teams, playable: true }, map: "pit", settings: { teams: "random" } }) as unknown as {
      buttons: string[];
      titleText: string;
      bodyText: string;
    };
    expect(stripColors(form.titleText)).toBe("Paintball");
    expect(form.buttons).toHaveLength(MAP_SLOTS + 1 + SETTING_SLOTS);
    expect(form.buttons.slice(0, 4)).toEqual(["Random", "Arena", `${SELECTED}Pit`, ""]);
    expect(form.buttons[START_SLOT]).toBe("Start");
    expect(form.buttons.slice(START_SLOT + 1)).toEqual(["Teams: Random", ""]);
    expect(stripColors(form.bodyText)).toBe("Knock everyone off.\n\n2-6 players");
  });

  it("warns in the info and dims Start when there aren't enough players", () => {
    const form = gameForm({ choice: { game: sumo, playable: false, reason: "needs at least 2 players" }, map: "random", settings: {} }) as unknown as {
      buttons: string[];
      bodyText: string;
    };
    expect(stripColors(form.bodyText)).toContain("Sumo needs at least 2 players.");
    expect(form.buttons[START_SLOT]).toBe("§7Start");
  });
});
