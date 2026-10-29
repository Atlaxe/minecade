import { describe, expect, it } from "vitest";
import { validateGameConfig } from "../../tools/build/validate.ts";
import { demoGames, isDemoGame } from "../behavior_pack/scripts/demo-games.ts";

describe("demo games", () => {
  it("makes up to 12 games with unique demo ids", () => {
    expect(demoGames(0)).toEqual([]);
    expect(demoGames(3).map((game) => game.name)).toEqual(["Paintball", "Block Drop", "Hide and Seek"]);
    const all = demoGames(50);
    expect(all).toHaveLength(12);
    const ids = all.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isDemoGame)).toBe(true);
    expect(isDemoGame("sumo")).toBe(false);
  });

  it("are valid game configs with valid maps, one of them with enough maps to scroll", () => {
    for (const game of demoGames(12)) {
      expect(validateGameConfig(game, game.id)).toEqual([]);
      expect(game.maps.length).toBeGreaterThan(0);
      const mapIds = game.maps.map((map) => map.id);
      expect(new Set(mapIds).size).toBe(mapIds.length);
    }
    expect(Math.max(...demoGames(12).map((game) => game.maps.length))).toBeGreaterThanOrEqual(8);
  });
});
