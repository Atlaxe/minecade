// Block Party's minigames, every one of the plan's built for testing (2026-11-27): each arena has
// its minigame, the places they hand back are ranked as the results expect, and the files they read
// (games/blockparty/minigames/*.json, the user's to fill) hold what their minigames need.
import { describe, expect, it } from "vitest";
import { ARENAS } from "../behavior_pack/scripts/minigames/arenas.ts";
import { placesBy, placesByOut, winnerBy } from "../behavior_pack/scripts/minigames/common.ts";
import { DISHES } from "../behavior_pack/scripts/minigames/cook.ts";
import { MINIGAMES } from "../behavior_pack/scripts/minigames/index.ts";
import { KITS } from "../behavior_pack/scripts/minigames/kit-brawl.ts";
import { ORES } from "../behavior_pack/scripts/minigames/mining.ts";
import { QUESTIONS } from "../behavior_pack/scripts/minigames/quiz.ts";
import { TOWER_ITEMS } from "../behavior_pack/scripts/minigames/towers.ts";
import cook from "../minigames/cook.json";
import scramble from "../minigames/scramble.json";
import survival from "../minigames/survival.json";

const ID = /^[a-z_]+:[a-z0-9_]+$/;

describe("Block Party's minigames", () => {
  it("are every arena's, once each, in the arenas' order", () => {
    expect(MINIGAMES.map((def) => def.id).sort()).toEqual(ARENAS.map((arena) => arena.id).sort());
    expect(new Set(MINIGAMES.map((def) => def.id)).size).toBe(MINIGAMES.length);
  });

  it("rank by score, ties together, higher first unless lower is better", () => {
    const score: Record<string, number> = { a: 3, b: 5, c: 3, d: 1 };
    expect(placesBy(["a", "b", "c", "d"], (key) => score[key])).toEqual([["b"], ["a", "c"], ["d"]]);
    expect(placesBy(["a", "b", "c", "d"], (key) => score[key], true)).toEqual([["d"], ["a", "c"], ["b"]]);
  });

  it("rank by who went out when: still in first, then the later out, out together tied", () => {
    const outAt = new Map([
      ["b", 10],
      ["c", 40],
      ["d", 40],
    ]);
    expect(placesByOut(["a", "b", "c", "d"], outAt)).toEqual([["a"], ["c", "d"], ["b"]]);
    // Those still in by a score of their own (hearts left).
    expect(placesByOut(["a", "e", "b"], new Map([["b", 5]]), (key) => (key === "e" ? 9 : 4))).toEqual([["e"], ["a"], ["b"]]);
  });

  it("call a team game for the higher score, or a draw", () => {
    expect(winnerBy([3, 1])).toBe(0);
    expect(winnerBy([1, 4])).toBe(1);
    expect(winnerBy([2, 2])).toBeUndefined();
  });
});

describe("the minigames' files", () => {
  it("Kit Brawl: kits with items and weights", () => {
    expect(KITS.length).toBeGreaterThan(0);
    for (const kit of KITS) {
      expect(kit.items.length, kit.name).toBeGreaterThan(0);
      for (const each of kit.items) expect(each.id, kit.name).toMatch(ID);
      for (const id of Object.values(kit.armor ?? {})) expect(id, kit.name).toMatch(ID);
      expect(kit.weight ?? 1, kit.name).toBeGreaterThan(0);
    }
  });

  it("Mining Race: ores with points and weights", () => {
    expect(ORES.length).toBeGreaterThan(0);
    for (const ore of ORES) {
      expect(ore.id).toMatch(ID);
      expect(ore.points).toBeGreaterThan(0);
      expect(ore.weight).toBeGreaterThan(0);
    }
  });

  it("Quiz Floor: 4 answers to each question, one right", () => {
    expect(QUESTIONS.length).toBeGreaterThan(0);
    for (const q of QUESTIONS) {
      expect(q.answers, q.question).toHaveLength(4);
      expect(q.right, q.question).toBeGreaterThanOrEqual(0);
      expect(q.right, q.question).toBeLessThan(4);
    }
  });

  it("Item Scramble, Towers of Fortune and Mini Survival Games: item ids to hand out", () => {
    expect(scramble.calls.length).toBeGreaterThan(0);
    expect(scramble.fill.length).toBeGreaterThan(0);
    for (const id of [...scramble.calls, ...scramble.fill]) expect(id).toMatch(ID);
    for (const each of [...TOWER_ITEMS, ...survival.middle, ...survival.outer]) expect(each.id).toMatch(ID);
    expect(survival.perChest).toBeGreaterThan(0);
  });

  it("Cook's Request: each dish made somewhere, a pot's from what the kitchen can give", () => {
    expect(DISHES.length).toBeGreaterThan(0);
    const choppable = new Set(cook.chop);
    for (const dish of DISHES) {
      expect(dish.id, dish.name).toMatch(ID);
      expect(["pot", "crafting"], dish.name).toContain(dish.in);
      if (dish.in !== "pot") continue;
      expect(dish.from.length, dish.name).toBeGreaterThan(0);
      expect(dish.from.length, dish.name).toBeLessThanOrEqual(6);
      for (const one of dish.from) {
        expect(one.id, dish.name).toMatch(ID);
        if (one.chopped) expect(choppable.has(one.id), `${dish.name}: chopped ${one.id}`).toBe(true);
      }
    }
    for (const [raw, cooked] of Object.entries(cook.skillet)) {
      expect(raw).toMatch(ID);
      expect(cooked).toMatch(ID);
    }
  });
});
