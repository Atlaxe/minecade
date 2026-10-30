import { describe, expect, it } from "vitest";
import { stripColors, type StatsTotals } from "@minecade/minigame-core";
import { MARK } from "../behavior_pack/scripts/game-screen.ts";
import { LAYOUT, mainMenuForm, playersForm, statsForm } from "../behavior_pack/scripts/menus.ts";
import { GLOBAL_TAB, badgeFor, formatDuration, playersView, statColumns, statsBody, statsButtons, statsTabAt, type StatsView } from "../behavior_pack/scripts/stats-screens.ts";

const totals = (more: Partial<StatsTotals> = {}): StatsTotals => ({
  games: 4,
  wins: 3,
  losses: 1,
  draws: 0,
  kills: 7,
  deaths: 2,
  dealt: 140.5,
  taken: 60,
  seconds: 3900,
  bestStreak: 4,
  left: 0,
  ...more,
});

const view: StatsView = {
  player: "Alex",
  tabs: [GLOBAL_TAB, { id: "sumo", name: "Sumo" }],
  tab: "sumo",
  body: "Rank: 1st of 2",
  columns: [[{ label: "Wins", value: "3" }], [{ label: "Kills", value: "7" }], []],
};

describe("the stats screens", () => {
  it("picks a badge by the name's first letter or digit", () => {
    expect(badgeFor("Steve")).toBe("textures/minecade/badges/s");
    expect(badgeFor("7even")).toBe("textures/minecade/badges/7");
    expect(badgeFor("_x")).toBe("textures/minecade/badges/other");
    expect(badgeFor("")).toBe("textures/minecade/badges/other");
  });

  it("lists the viewer first, once", () => {
    expect(playersView("Steve", ["Alex", "STEVE", "Zed"], 2)).toEqual({ viewer: "Steve", players: ["Steve", "Alex", "Zed"], more: 2 });
  });

  it("orders the buttons portrait, tabs, then stat tiles, and maps only tabs to tabs", () => {
    expect(statsButtons(view).map((button) => button.kind)).toEqual(["portrait", "tab", "tab", "stat", "stat"]);
    expect(statsTabAt(view, 0)).toBeUndefined();
    expect(statsTabAt(view, 1)).toEqual(GLOBAL_TAB);
    expect(statsTabAt(view, 2)).toEqual({ id: "sumo", name: "Sumo" });
    expect(statsTabAt(view, 3)).toBeUndefined(); // a stat tile
  });

  it("heads a tab with the rank, or says there are no stats", () => {
    expect(statsBody(totals(), { rank: 3, of: 11 })).toBe("Rank: 3rd of 11");
    expect(statsBody(totals())).toBe("");
    expect(statsBody(undefined)).toBe("No stats yet.\nMatches with at least 2 players count.");
    expect(statsBody(totals({ games: 0 }))).toBe("No stats yet.\nMatches with at least 2 players count.");
  });

  it("splits the stats into Results, Combat and More, with draws, leavers and the game's own counters only when there are some", () => {
    const labels = (columns: { label: string }[][]) => columns.map((column) => column.map((stat) => stat.label));
    expect(labels(statColumns(totals()))).toEqual([
      ["Games", "Wins", "Losses", "Win rate"],
      ["Kills", "Deaths", "K/D", "Best streak"],
      ["Damage dealt", "Damage taken", "Time played"],
    ]);
    const all = statColumns(totals({ draws: 1, left: 2, extras: { plants: 2 } }), [["plants", "Bombs planted"], ["defuses", "Defuses"]]);
    expect(labels(all)[0]).toContain("Draws");
    expect(all[2].slice(-3)).toEqual([
      { label: "Left early", value: "2" },
      { label: "Bombs planted", value: "2" },
      { label: "Defuses", value: "0" },
    ]);
    expect(all[0].at(-1)).toEqual({ label: "Win rate", value: "75%" });
    expect(statColumns(undefined)).toEqual([]);
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(720)).toBe("12m");
    expect(formatDuration(3900)).toBe("1h 05m");
  });
});

describe("the stats forms", () => {
  it("marks each player row, gives it a badge, and marks the viewer with (me)", () => {
    const form = playersForm({ viewer: "Steve", players: ["Steve", "Alex"], more: 3 }) as unknown as { buttons: string[]; titleText: string; bodyText: string };
    expect(form.titleText.startsWith(LAYOUT.players)).toBe(true);
    expect(form.buttons).toEqual([`${MARK.player}Steve §7(me)`, `${MARK.player}Alex`]);
    expect(stripColors(form.bodyText)).toBe("And 3 more not listed.");
  });

  it("puts the portrait first, then the tabs with the open one outlined, then the stat tiles by column, and the rank as the body", () => {
    const form = statsForm(view) as unknown as { buttons: string[]; titleText: string; bodyText: string };
    expect(form.titleText).toBe(`${LAYOUT.stats}§rAlex`);
    expect(form.buttons).toEqual([
      `${MARK.portrait}Alex`,
      `${MARK.tab}Global`,
      `${MARK.tab}${MARK.selected}Sumo`,
      `${MARK.stats[0]}§f3\n§7Wins`,
      `${MARK.stats[1]}§f7\n§7Kills`,
    ]);
    expect(form.bodyText).toBe("Rank: 1st of 2");
  });
});

describe("the main menu", () => {
  it("adds a marked Preview button only with DEV_HOLO_PREVIEW", () => {
    expect((mainMenuForm() as unknown as { buttons: string[] }).buttons).toEqual(["Play", "Stats"]);
    expect((mainMenuForm(true) as unknown as { buttons: string[] }).buttons).toEqual(["Play", "Stats", `${MARK.preview}Preview`]);
  });
});
