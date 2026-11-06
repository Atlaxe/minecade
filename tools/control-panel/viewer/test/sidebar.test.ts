import type { EditorRules, MapConfig } from "@minecade/minigame-core/config";
import { describe, expect, it } from "vitest";
import { buildMarkup } from "../markup.ts";
import { matchesSearch, overviewLists } from "../sidebar.ts";

const RULES: EditorRules = {
  kind: "game",
  maxPlayers: 4,
  requires: {
    teamSpawns: true,
    bounds: true,
    buildLimit: { above: true },
    points: { hole: { label: "Hole", perTeam: true }, flag: { label: "Flag" } },
  },
  teams: [
    { id: "red", name: "Red", color: "§c" },
    { id: "blue", name: "Blue", color: "§9" },
  ],
};

describe("the overview", () => {
  it("has only the lists with entries, and no section without one", () => {
    const empty = buildMarkup({ name: "Empty", spawns: [] }, RULES);
    expect(overviewLists(empty, "")).toEqual([]);
    const config: MapConfig = { name: "Some", spawns: [], teamSpawns: { red: [[3, 64, 3]] }, killY: 50 };
    const shown = overviewLists(buildMarkup(config, RULES), "");
    expect(shown.map((section) => [section.title, section.lists.map((list) => list.list.key)])).toEqual([
      ["Spawns", ["teamSpawns.red"]],
      ["Boundaries", ["killY"]],
    ]);
  });

  it("is searched by entry, list or section, a list's or section's name keeping all of its entries", () => {
    const config: MapConfig = { name: "Some", spawns: [[0, 64, 0], [5, 70, 5]], points: { flag: [[1, 65, 1]] }, killY: 50 };
    const markup = buildMarkup(config, RULES);
    const keys = (query: string) => overviewLists(markup, query).flatMap((section) => section.lists.flatMap((list) => list.entries.map((entry) => entry.key)));
    expect(keys("spawn 2")).toEqual(["spawns#1"]);
    expect(keys("70")).toEqual(["spawns#1"]);
    expect(keys("game markers")).toEqual(["points.flag#0"]);
    expect(keys("kill")).toEqual(["killY"]);
    expect(keys("nothing like it")).toEqual([]);
  });

  it("matches every word, in any case", () => {
    expect(matchesSearch("", "anything")).toBe(true);
    expect(matchesSearch("RED  spawn", "Red spawn 1")).toBe(true);
    expect(matchesSearch("red blue", "Red spawn 1")).toBe(false);
  });
});
