import { describe, expect, it } from "vitest";
import type { RegistryGame, StatsTotals } from "@minecade/minigame-core";
import { PREVIEWS } from "../behavior_pack/scripts/game-screen.ts";
import {
  MAX_ELEMENTS,
  gameContent,
  gamesContent,
  idleContent,
  mainContent,
  statsContent,
  statsListContent,
  teamsContent,
  type HoloContent,
  type HoloElement,
} from "../behavior_pack/scripts/holo-content.ts";
import { GLOBAL_TAB, statColumns } from "../behavior_pack/scripts/stats-screens.ts";

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
const probe: RegistryGame = {
  ...sumo,
  id: "probe",
  name: "Probe",
  icon: undefined,
  options: [{ id: "round", label: "Round", values: [{ value: "15", label: "15 s" }, { value: "30", label: "30 s" }] }],
};
const totals: StatsTotals = { games: 4, wins: 3, losses: 1, draws: 0, kills: 7, deaths: 2, dealt: 10, taken: 5, seconds: 600, bestStreak: 2, left: 0 };

/** The element showing `text` (trimmed), so tests don't depend on padding. */
function find(content: HoloContent, text: string): HoloElement {
  const element = content.elements.find((candidate) => candidate.text.trim() === text);
  if (!element) throw new Error(`no "${text}" in ${content.elements.map((candidate) => candidate.text.trim()).join(" | ")}`);
  return element;
}

/** Every element sits on the panel, and there are no more than the hologram draws. */
function onPanel(content: HoloContent): void {
  expect(content.elements.length).toBeLessThanOrEqual(MAX_ELEMENTS);
  for (const element of content.elements) {
    expect(Math.abs(element.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(element.y)).toBeLessThanOrEqual(1.5);
  }
}

describe("the hologram layouts", () => {
  it("shows a Tap the terminal button, then Play and Stats side by side, the chosen one selected", () => {
    expect(idleContent()).toMatchObject({ frame: "logo" });
    expect(find(idleContent(), "Tap the terminal").box).toBe("button");
    const main = mainContent("stats");
    const play = find(main, "Play");
    const stats = find(main, "Stats");
    expect(play.y).toBe(stats.y);
    expect(play.x).toBeLessThan(stats.x);
    expect([play.box, stats.box]).toEqual(["button", "selected"]);
  });

  it("lays the game grid out in three columns of cards, dim without enough players, with +N more past 15", () => {
    const content = gamesContent([
      { game: sumo, playable: true },
      { game: probe, playable: false, reason: "needs at least 2 players" },
    ]);
    onPanel(content);
    expect(find(content, "Choose a game").tone).toBe("title");
    expect(find(content, "Sumo")).toMatchObject({ box: "button", tone: "normal" });
    expect(find(content, "Probe").tone).toBe("dim");
    expect(find(content, "Probe").x).toBeGreaterThan(find(content, "Sumo").x);
    const many = Array.from({ length: 20 }, (_, i) => ({ game: { ...sumo, name: `Game ${i}` }, playable: true }));
    const full = gamesContent(many);
    onPanel(full);
    expect(find(full, "+6 more").tone).toBe("dim");
  });

  it("mirrors the game screen: info and buttons on the left, the picture and maps on the right", () => {
    const random = gameContent({ choice: { game: probe, playable: true }, random: true, map: "arena_1", settings: { round: "30" } });
    onPanel(random);
    expect(random.picture).toBe(PREVIEWS.game);
    expect(find(random, "Random map: On").box).toBe("selected");
    expect(find(random, "Round: 30 s").box).toBe("button");
    expect(find(random, "Start").x).toBeLessThan(0);
    expect(find(random, "Arena")).toMatchObject({ tone: "dim", box: "button" });
    expect(find(random, "Arena").x).toBeGreaterThan(0);

    const pit = gameContent({ choice: { game: sumo, playable: false, reason: "needs at least 2 players" }, random: false, map: "pit", settings: {} });
    expect(pit.picture).toBe("textures/minecade/maps/sumo/pit");
    expect(find(pit, "Random map: Off").box).toBe("button");
    expect(find(pit, "Pit")).toMatchObject({ box: "selected", tone: "normal" });
    expect(find(pit, "Needs 2 players").tone).toBe("warn");
    expect(find(pit, "Start").tone).toBe("dim");
  });

  it("shows team picking as a column per team in the team's color", () => {
    const content = teamsContent({
      game: "Probe",
      status: "Teams lock in 4 s",
      teams: [
        { id: "red", name: "Red", color: "§c", members: ["Steve"], cap: 1, full: true },
        { id: "blue", name: "Blue", color: "§9", members: [], cap: 1, full: false },
      ],
      unpicked: ["Alex"],
    });
    onPanel(content);
    expect(find(content, "Red 1/1")).toMatchObject({ color: "§c", box: "tile" });
    expect(find(content, "Steve").x).toBe(find(content, "Red 1/1").x);
    expect(find(content, "Blue 0/1").x).toBeGreaterThan(find(content, "Red 1/1").x);
    expect(find(content, "Random: Alex").tone).toBe("dim");
    expect(find(content, "Teams lock in 4 s").tone).toBe("highlight");
  });

  it("lists players like the stats list, the viewer first with (me)", () => {
    const content = statsListContent({ viewer: "Steve", players: ["Steve", "Alex"], more: 0 });
    onPanel(content);
    expect(find(content, "Steve (me)").box).toBe("button");
    expect(find(content, "Steve (me)").y).toBeGreaterThan(find(content, "Alex").y);
    const crowd = statsListContent({ viewer: "Steve", players: Array.from({ length: 10 }, (_, i) => `P${i}`), more: 5 });
    onPanel(crowd);
    expect(find(crowd, "+9 more").tone).toBe("dim");
  });

  it("mirrors a player's stats: portrait and tabs on the left, the rank and stat columns on the right", () => {
    const view = { player: "Alex", tabs: [GLOBAL_TAB, { id: "sumo", name: "Sumo" }], tab: "sumo", body: "", columns: statColumns(totals), placement: { rank: 2, of: 9 } };
    const content = statsContent(view);
    onPanel(content);
    expect(content.portrait).toBe("textures/minecade/badges/a");
    expect(find(content, "Sumo").box).toBe("selected");
    expect(find(content, "Global").box).toBe("button");
    expect(find(content, "Global").x).toBeLessThan(0);
    expect(find(content, "Rank 2nd of 9").tone).toBe("highlight");
    expect(find(content, "Results").x).toBeLessThan(find(content, "Combat").x);
    expect(find(content, "75%").box).toBe("tile");
    expect(find(content, "Win rate").y).toBeLessThan(find(content, "75%").y);

    const none = statsContent({ ...view, tab: "global", columns: [], placement: undefined });
    expect(find(none, "No stats yet").tone).toBe("dim");
  });
});
