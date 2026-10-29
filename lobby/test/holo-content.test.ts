import { describe, expect, it } from "vitest";
import type { RegistryGame } from "@minecade/minigame-core";
import { PREVIEWS } from "../behavior_pack/scripts/game-screen.ts";
import { MAX_LINES, MAX_LINES_WITH_PICTURE, fit, gameContent, gamesContent, idleContent, mainContent, teamsContent } from "../behavior_pack/scripts/holo-content.ts";

const sumo: RegistryGame = {
  id: "sumo",
  name: "Sumo",
  minPlayers: 2,
  maxPlayers: 6,
  icon: "textures/minecade/games/sumo",
  maps: [
    { id: "arena_1", name: "Arena" },
    { id: "pit", name: "Pit", preview: "textures/minecade/maps/sumo/pit" },
  ],
};
const paintball: RegistryGame = { ...sumo, id: "paintball", name: "Paintball", icon: undefined, teams: { count: 2 } };

describe("what the hologram shows", () => {
  it("shows the logo frame while idle and on the main menu, with the chosen item highlighted", () => {
    expect(idleContent()).toEqual({ frame: "logo", lines: [{ text: "Tap the terminal", tone: "normal" }] });
    expect(mainContent().lines.map((line) => line.tone)).toEqual(["normal", "normal"]);
    expect(mainContent("play").lines).toEqual([
      { text: "Play", tone: "highlight" },
      { text: "Stats", tone: "normal" },
    ]);
    expect(mainContent("stats").lines[1]).toEqual({ text: "Stats", tone: "highlight" });
  });

  it("lists the games, dimming those without enough players, and says how many more don't fit", () => {
    const content = gamesContent([
      { game: sumo, playable: true },
      { game: paintball, playable: false, reason: "needs at least 2 players" },
    ]);
    expect(content).toEqual({
      frame: "panel",
      title: "Choose a game",
      lines: [
        { text: "Sumo", tone: "normal" },
        { text: "Paintball", tone: "dim" },
      ],
    });
    const many = Array.from({ length: 9 }, (_, i) => ({ game: { ...sumo, name: `Game ${i}` }, playable: true }));
    const lines = gamesContent(many).lines;
    expect(lines).toHaveLength(MAX_LINES);
    expect(lines.at(-1)).toEqual({ text: "and 4 more", tone: "dim" });
  });

  it("shows the game's picture while the map is random, the map, the settings and the players it needs", () => {
    expect(gameContent({ choice: { game: paintball, playable: true }, random: true, map: "arena_1", settings: { teams: "random" } })).toEqual({
      frame: "panel",
      title: "Paintball",
      picture: PREVIEWS.game,
      lines: [
        { text: "Map: Random", tone: "highlight" },
        { text: "Teams: Random", tone: "normal" },
        { text: "2-6 players", tone: "dim" },
      ],
    });
    const short = gameContent({ choice: { game: sumo, playable: false, reason: "needs at least 2 players" }, random: true, map: "arena_1", settings: {} });
    expect(short.picture).toBe("textures/minecade/games/sumo");
    expect(short.lines).toEqual([
      { text: "Map: Random", tone: "highlight" },
      { text: "Needs 2 players", tone: "warn" },
    ]);
    expect(short.lines.length).toBeLessThanOrEqual(MAX_LINES_WITH_PICTURE);
  });

  it("shows the chosen map's preview, or the map placeholder", () => {
    const pit = gameContent({ choice: { game: sumo, playable: true }, random: false, map: "pit", settings: {} });
    expect(pit.picture).toBe("textures/minecade/maps/sumo/pit");
    expect(pit.lines[0]).toEqual({ text: "Map: Pit", tone: "highlight" });
    expect(gameContent({ choice: { game: sumo, playable: true }, random: false, map: "arena_1", settings: {} }).picture).toBe(PREVIEWS.none);
  });

  it("keeps lines that fit as they are", () => {
    const lines = [{ text: "a", tone: "normal" as const }];
    expect(fit(lines, 3)).toBe(lines);
  });
});

describe("the team picking view on the hologram", () => {
  const team = (id: string, name: string, color: string, members: string[]) => ({ id, name, color, members, cap: 2, full: members.length >= 2 });

  it("shows each team in its color, who is still random, and when teams lock", () => {
    const content = teamsContent({
      game: "Paint",
      status: "Teams lock in 4 s",
      teams: [team("red", "Red", "§c", ["Steve", "Alex"]), team("blue", "Blue", "§9", [])],
      unpicked: ["Bob"],
    });
    expect(content).toEqual({
      frame: "panel",
      title: "Paint",
      lines: [
        { text: "Red: Steve, Alex", tone: "normal", color: "§c" },
        { text: "Blue: -", tone: "normal", color: "§9" },
        { text: "Random: Bob", tone: "dim" },
        { text: "Teams lock in 4 s", tone: "highlight" },
      ],
    });
  });

  it("shortens long lists and always keeps the status line", () => {
    const content = teamsContent({
      game: "Paint",
      status: "Waiting for the server...",
      teams: ["a", "b", "c", "d"].map((id) => team(id, id.toUpperCase(), "§f", ["P1", "P2", "P3", "P4", "P5"])),
      unpicked: ["Q1", "Q2"],
    });
    expect(content.lines).toHaveLength(MAX_LINES);
    expect(content.lines[0].text).toBe("A: P1, P2, P3 +2");
    expect(content.lines.at(-1)).toEqual({ text: "Waiting for the server...", tone: "highlight" });
  });
});
