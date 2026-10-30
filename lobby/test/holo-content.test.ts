import { describe, expect, it } from "vitest";
import type { RegistryGame, StatsTotals } from "@minecade/minigame-core";
import { PREVIEWS } from "../behavior_pack/scripts/game-screen.ts";
import {
  HOLO_LAYOUT,
  MAX_ELEMENTS,
  countdownContent,
  gameBannerContent,
  gameContent,
  gamesContent,
  idleContent,
  mainContent,
  statsContent,
  fitScale,
  statsListContent,
  teamsContent,
  textHeight,
  textWidth,
  truncate,
  wrap,
  type HoloContent,
  type HoloElement,
} from "../behavior_pack/scripts/holo-content.ts";
import { GLOBAL_TAB, statColumns } from "../behavior_pack/scripts/stats-screens.ts";
import { PREVIEW_SCREENS, previewContent } from "../behavior_pack/scripts/holo-preview.ts";

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

/** Every element sits inside the frame, edges included (by the width estimate), and there are no more than the hologram draws. */
function onPanel(content: HoloContent): void {
  expect(content.elements.length).toBeLessThanOrEqual(MAX_ELEMENTS);
  const limit = HOLO_LAYOUT.edge + 0.05;
  for (const element of content.elements) {
    const half = textWidth(element.text.trim(), element.scale ?? 1) / 2;
    expect(Math.abs(element.x) + half, element.text).toBeLessThanOrEqual(limit);
    expect(Math.abs(element.y), element.text).toBeLessThanOrEqual(limit);
  }
}

/** Where an element's text starts (it's placed by its middle). */
const leftEdge = (element: HoloElement) => element.x - textWidth(element.text, element.scale ?? 1) / 2;

/** Where an element's text tops out and bottoms out (it's placed by its middle). */
const top = (element: HoloElement) => element.y + textHeight(element.scale ?? 1) / 2;
const bottom = (element: HoloElement) => element.y - textHeight(element.scale ?? 1) / 2;

const has = (content: HoloContent, text: string) => content.elements.some((element) => element.text.trim() === text);

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

  it("fits text: measures by the font's character widths, shrinks to a width, truncates what still doesn't fit, wraps by words", () => {
    expect(textWidth("ii")).toBeLessThan(textWidth("MM"));
    expect(textWidth("a b")).toBeLessThan(textWidth("abc"));
    expect(textWidth("Choose a game", 1.15)).toBeCloseTo(2.0, 1);
    expect(fitScale("Short", 1, 10)).toBe(1);
    expect(fitScale("A much longer name", 1, 1, 0.4)).toBeCloseTo(1 / textWidth("A much longer name"));
    expect(fitScale("A much longer name than that", 1, 0.5, 0.4)).toBe(0.4);
    expect(truncate("Short", 1, 10)).toBe("Short");
    expect(truncate("Warehouse", fitScale("Warehouse", 1, 0.71, 0.4), 0.71)).toBe("Warehouse");
    const cut = truncate("Capture the Wool", 0.6, 0.9);
    expect(cut.endsWith("..")).toBe(true);
    expect(textWidth(cut, 0.6)).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(wrap("Hide and Seek", 0.6, 0.92, 2)).toEqual(["Hide and", "Seek"]);
    expect(wrap("Sumo", 0.6, 0.92, 2)).toEqual(["Sumo"]);
    const long = wrap("The Very Long Game Name Goes On", 0.6, 0.92, 2);
    expect(long).toHaveLength(2);
    expect(long[1].endsWith("..")).toBe(true);
  });

  it("lays the game grid out in three columns of cards, long names on two lines, dim without enough players, with +N more past 15", () => {
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
    const wrapped = gamesContent([{ game: { ...sumo, name: "Capture the Wool" }, playable: true }]);
    onPanel(wrapped);
    expect(find(wrapped, "Capture").x).toBe(find(wrapped, "the Wool").x);
    expect(find(wrapped, "the Wool").y).toBeLessThan(find(wrapped, "Capture").y);
    expect(find(wrapped, "2-6").y).toBeLessThan(find(wrapped, "the Wool").y);
  });

  it("mirrors the game screen's left column: the name, players, then the map and settings as labels with yellow answers, all left-aligned", () => {
    const random = gameContent({ choice: { game: probe, playable: true }, random: true, map: "arena_1", settings: { round: "30" } });
    onPanel(random);
    expect(random.picture).toBe(PREVIEWS.game);
    const map = find(random, "Map:");
    const round = find(random, "Round:");
    expect(map.box).toBeUndefined();
    expect(find(random, "Random")).toMatchObject({ box: "selected", y: map.y });
    expect(find(random, "30 s")).toMatchObject({ box: "selected", y: round.y });
    expect(round.y).toBeLessThan(map.y);
    for (const element of [find(random, "Probe"), find(random, "2-6 players"), round]) expect(leftEdge(element)).toBeCloseTo(leftEdge(map));
    expect(leftEdge(find(random, "30 s"))).toBeCloseTo(leftEdge(find(random, "Random")));
    expect(leftEdge(find(random, "Random"))).toBeGreaterThan(leftEdge(map) + textWidth("Round:", round.scale));
    for (const gone of ["Random map: On", "Maps", "Arena", "Pit", "Start"]) expect(has(random, gone), gone).toBe(false);

    const pit = gameContent({ choice: { game: sumo, playable: false, reason: "needs at least 2 players" }, random: false, map: "pit", settings: {} });
    expect(pit.picture).toBe("textures/minecade/maps/sumo/pit");
    expect(find(pit, "Pit").box).toBe("selected");
    expect(find(pit, "Needs 2 players").tone).toBe("warn");
    // The table is below the picture, so a long map name keeps its room.
    const long = gameContent({ choice: { game: { ...sumo, maps: [{ id: "w", name: "Warehouse District" }] }, playable: true }, random: false, map: "w", settings: {} });
    onPanel(long);
    expect(find(long, "Warehouse District").box).toBe("selected");
    // A map without its own preview shows the placeholder, not the game's picture.
    expect(gameContent({ choice: { game: sumo, playable: true }, random: false, map: "arena_1", settings: {} }).picture).toBe(PREVIEWS.none);
    onPanel(gameContent({ choice: { game: { ...sumo, name: "Capture the Wool on a Long Name" }, playable: true }, random: true, map: "pit", settings: {} }));
  });

  it("lays the game screen out with the picture across the top (layout 2), then the name and players beside the settings table, both starting at one height", () => {
    const view = { choice: { game: probe, playable: true }, random: true, map: "arena_1", settings: { round: "30" } };
    const content = gameBannerContent(view);
    onPanel(content);
    expect(content).toMatchObject({ picture: PREVIEWS.game, pictureSpot: "banner" });
    expect(gameContent(view).pictureSpot).toBeUndefined();
    const [name, players, map, random, round, thirty] = ["Probe", "2-6 players", "Map:", "Random", "Round:", "30 s"].map((text) => find(content, text));
    expect(name.tone).toBe("title");
    // Both columns start at the same height, below the banner (it ends at y -0.02).
    expect(top(name)).toBeCloseTo(top(map));
    expect(top(name)).toBeLessThan(-0.02);
    expect(top(players)).toBeLessThan(bottom(name));
    // Each column is left-aligned: the name over the players, the labels over each other, the answers over each other.
    expect(leftEdge(players)).toBeCloseTo(leftEdge(name));
    expect(leftEdge(round)).toBeCloseTo(leftEdge(map));
    expect(leftEdge(thirty)).toBeCloseTo(leftEdge(random));
    expect(leftEdge(map)).toBeGreaterThan(name.x + textWidth(name.text, name.scale) / 2);
    expect([random.box, thirty.box]).toEqual(["selected", "selected"]);
    expect(find(gameBannerContent({ ...view, random: false, map: "pit" }), "Pit").box).toBe("selected");
    // Lots of settings still fit above the bottom edge.
    const options = Array.from({ length: 6 }, (_, i) => ({ id: `option${i}`, label: `Option ${i}`, values: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }));
    onPanel(gameBannerContent({ ...view, choice: { game: { ...probe, name: "Capture the Wool on a Long Name", options }, playable: false, reason: "needs at least 4 players" } }));
  });

  it("shows a starting game centered both ways: the server booting, then the seconds left in yellow", () => {
    const boot = countdownContent({ game: "Sumo", map: "Arena" });
    const count = countdownContent({ game: "Sumo", map: "a random map", left: 3 });
    for (const content of [boot, count]) {
      onPanel(content);
      for (const element of content.elements) expect(element.x).toBe(0);
      const middle = (top(content.elements[0]) + bottom(content.elements.at(-1)!)) / 2;
      expect(middle).toBeCloseTo(0);
      // Top to bottom, without overlapping.
      content.elements.slice(1).forEach((element, index) => expect(top(element)).toBeLessThan(bottom(content.elements[index])));
    }
    expect(boot.elements.map((element) => element.text)).toEqual(["Starting Sumo", "on Arena", "Getting the server ready"]);
    expect(count.elements.map((element) => element.text)).toEqual(["Starting Sumo in", "3", "on a random map"]);
    expect(find(count, "3")).toMatchObject({ tone: "highlight", scale: HOLO_LAYOUT.countdown.numberScale });
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
    const long = teamsContent({
      game: "Probe",
      status: "",
      teams: [1, 2, 3, 4].map((n) => ({ id: `t${n}`, name: `T${n}`, color: "§f", members: ["AVeryLongGamertagX"], cap: 2, full: false })),
      unpicked: [],
    });
    onPanel(long);
    expect(long.elements.find((element) => element.text.startsWith("AVery"))!.scale!).toBeLessThan(0.75);
  });

  it("lists players like the stats list, the viewer first, without the form's (me)", () => {
    const content = statsListContent({ viewer: "Steve", players: ["Steve", "Alex"], more: 0 });
    onPanel(content);
    expect(find(content, "Steve").box).toBe("button");
    expect(find(content, "Steve").y).toBeGreaterThan(find(content, "Alex").y);
    expect(content.elements.some((element) => element.text.includes("(me)"))).toBe(false);
    const crowd = statsListContent({ viewer: "Steve", players: Array.from({ length: 10 }, (_, i) => `P${i}`), more: 5 });
    onPanel(crowd);
    expect(find(crowd, "+9 more").tone).toBe("dim");
  });

  it("lays a player's stats out as a grid: the open tab, name and rank beside the portrait, then the stat table across the panel", () => {
    const view = { player: "Alex", tabs: [GLOBAL_TAB, { id: "sumo", name: "Sumo" }], tab: "sumo", body: "", columns: statColumns(totals), placement: { rank: 2, of: 9 } };
    const content = statsContent(view);
    onPanel(content);
    expect(content.portrait).toBe("textures/minecade/badges/a");
    const [tab, name, rank] = content.elements;
    expect([tab.text, name.text, rank.text]).toEqual(["Sumo", "Alex", "Rank 2nd of 9"]);
    expect([tab.box, name.tone, rank.tone]).toEqual(["selected", "title", "highlight"]);
    expect(tab.y).toBeGreaterThan(name.y);
    expect(name.y).toBeGreaterThan(rank.y);
    for (const element of [name, rank]) expect(leftEdge(element)).toBeCloseTo(leftEdge(tab));
    // Right of the portrait, which ends at x -0.5.
    expect(leftEdge(tab)).toBeGreaterThan(-0.5);
    expect(has(content, "Global")).toBe(false);
    const [results, combat, more] = ["Results", "Combat", "More"].map((heading) => find(content, heading));
    expect(results.y).toBeLessThan(rank.y);
    expect(results.x).toBeLessThan(combat.x);
    expect(combat.x).toBeLessThan(more.x);
    expect(results.x).toBeLessThan(leftEdge(tab));
    expect(find(content, "75%").box).toBe("tile");
    expect(find(content, "Win rate").y).toBeLessThan(find(content, "75%").y);

    const none = statsContent({ ...view, tab: "global", columns: [], placement: undefined });
    expect(none.elements.map((element) => element.text)).toEqual(["Global", "Alex", "No stats yet"]);
    expect(find(none, "No stats yet").tone).toBe("dim");
    onPanel(statsContent({ ...view, player: "A Really Long Gamertag" }));
    const extras = Array.from({ length: 6 }, (_, i): [string, string] => [`extra${i}`, `Counter number ${i}`]);
    const crowded = statsContent({ ...view, columns: statColumns(totals, extras) });
    onPanel(crowded);
    expect(find(crowded, "+4 more").tone).toBe("dim");
  });
});

describe("hologram previews", () => {
  it("has sample content for every screen, on the panel", () => {
    const choices = [
      { game: sumo, playable: true },
      { game: probe, playable: true },
    ];
    for (const { id } of PREVIEW_SCREENS) onPanel(previewContent(id, choices, "Steve"));
    // The game screen previews a game with settings.
    const game = previewContent("game", choices, "Steve");
    expect(find(game, "15 s").y).toBe(find(game, "Round:").y);
    expect(previewContent("stats", choices, "Steve").portrait).toBe("textures/minecade/badges/s");
    expect(previewContent("game", [], "Steve").elements[0].text).toBe("Choose a game");
  });
});
