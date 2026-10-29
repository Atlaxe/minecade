import { describe, expect, it } from "vitest";
import type { RegistryGame } from "@minecade/minigame-core";
import { MAX_LINES, MAX_LINES_WITH_ICON, fit, gameContent, gamesContent, idleContent, mainContent } from "../behavior_pack/scripts/holo-content.ts";

const sumo: RegistryGame = { id: "sumo", name: "Sumo", minPlayers: 2, maxPlayers: 6, maps: [{ id: "arena_1", name: "Arena" }] };
const paintball: RegistryGame = { ...sumo, id: "paintball", name: "Paintball", teams: { count: 2 } };

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

  it("shows a game's picture, the map, the settings and the players it needs", () => {
    expect(gameContent({ game: paintball, playable: true }, "Random", { teams: "random" })).toEqual({
      frame: "panel",
      title: "Paintball",
      icon: "paintball",
      lines: [
        { text: "Map: Random", tone: "highlight" },
        { text: "Teams: Random", tone: "normal" },
        { text: "2-6 players", tone: "dim" },
      ],
    });
    const short = gameContent({ game: sumo, playable: false, reason: "needs at least 2 players" }, "Arena", {});
    expect(short.lines).toEqual([
      { text: "Map: Arena", tone: "highlight" },
      { text: "Needs 2 players", tone: "warn" },
    ]);
    expect(short.lines.length).toBeLessThanOrEqual(MAX_LINES_WITH_ICON);
  });

  it("keeps lines that fit as they are", () => {
    const lines = [{ text: "a", tone: "normal" as const }];
    expect(fit(lines, 3)).toBe(lines);
  });
});
