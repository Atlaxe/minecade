import { describe, expect, it } from "vitest";
import { stripColors, type StatsTotals } from "@minecade/minigame-core";
import { MARK } from "../behavior_pack/scripts/game-screen.ts";
import { LAYOUT, playersForm, statsForm } from "../behavior_pack/scripts/menus.ts";
import { GLOBAL_TAB, badgeFor, describe as describeTotals, formatDuration, playersView, statsBody, statsTabAt, type StatsView } from "../behavior_pack/scripts/stats-screens.ts";

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

const view: StatsView = { player: "Alex", tabs: [GLOBAL_TAB, { id: "sumo", name: "Sumo" }], tab: "sumo", body: "Rank: 1st of 2" };

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

  it("maps buttons to tabs: the portrait first, then each tab", () => {
    expect(statsTabAt(view, 0)).toBeUndefined();
    expect(statsTabAt(view, 1)).toEqual(GLOBAL_TAB);
    expect(statsTabAt(view, 2)).toEqual({ id: "sumo", name: "Sumo" });
    expect(statsTabAt(view, 3)).toBeUndefined();
  });

  it("writes the rank, the totals and the game's own counters", () => {
    expect(statsBody(totals(), { rank: 3, of: 11 }).split("\n").slice(0, 3)).toEqual(["Rank: 3rd of 11", "", "Games: 4   Wins: 3   Losses: 1"]);
    expect(statsBody(totals({ extras: { plants: 2 } }), undefined, [["plants", "Bombs planted"], ["defuses", "Defuses"]])).toContain("Bombs planted: 2\nDefuses: 0");
    expect(statsBody(undefined)).toBe("No stats yet.\nMatches with at least 2 players count.");
    expect(statsBody(totals({ games: 0 }))).toBe("No stats yet.\nMatches with at least 2 players count.");
  });

  it("formats totals and durations", () => {
    expect(describeTotals(totals({ draws: 1, left: 2 }))).toBe(
      [
        "Games: 4   Wins: 3   Losses: 1   Draws: 1",
        "Win rate: 75%",
        "Kills: 7   Deaths: 2   K/D: 3.5",
        "Damage dealt: 140.5   Damage taken: 60",
        "Best kill streak: 4   Time played: 1h 05m",
        "Left early: 2",
      ].join("\n"),
    );
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

  it("puts the portrait first, then the tabs with the open one outlined, and the stats as the body", () => {
    const form = statsForm(view) as unknown as { buttons: string[]; titleText: string; bodyText: string };
    expect(form.titleText).toBe(`${LAYOUT.stats}§rAlex`);
    expect(form.buttons).toEqual([`${MARK.portrait}Alex`, `${MARK.tab}Global`, `${MARK.tab}${MARK.selected}Sumo`]);
    expect(form.bodyText).toBe("Rank: 1st of 2");
  });
});
