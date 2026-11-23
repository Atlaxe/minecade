// Golem Gardens' golems (golem-rules.ts; the user's design, 2026-11-22) and a path's bends as the
// game walks them (board.ts mapSpaces and bendsBetween), and the pan over the board (board-view.ts).
import { describe, expect, it } from "vitest";
import type { BoardSpace } from "@minecade/minigame-core/config";
import { bendsBetween, mapSpaces, STAND } from "../behavior_pack/scripts/board.ts";
import { boardPan } from "../behavior_pack/scripts/board-view.ts";
import { GOLEM_TOLL, asidePath, botPays, golemBetween, golemOn, mapGolems, pickSwap, startingActive, walkTicks, walkTo } from "../behavior_pack/scripts/golem-rules.ts";

/** Start (1) to 2 to 3 and back to Start, 2 also leading to 4, which comes back to Start; 1 to 2 bends twice. */
const BOARD: BoardSpace[] = [
  { id: 1, at: [0, 64, 0], type: "start", next: [2], bends: { "2": [[3, 64, 2], [6, 64, 2]] } },
  { id: 2, at: [10, 64, 0], type: "blue", next: [3, 4] },
  { id: 3, at: [10, 64, 10], type: "blue", next: [1] },
  { id: 4, at: [20, 64, 0], type: "red", next: [1] },
];

const golem = (before: number, after: number, x: number) => ({ post: [x, 64, 1, 90, 0], rest: [x, 64, 5, 0, 0], before, after, bends: [[x + 1, 64, 3]] });

describe("a path's bends in the game", () => {
  it("are block middles at the floor, by the index of the space they lead to", () => {
    const spaces = mapSpaces(BOARD);
    expect(spaces[0].bends).toEqual({ 1: [[3.5, 64, 2.5], [6.5, 64, 2.5]] });
    expect(spaces[0].at).toEqual([0.5, 64 + STAND, 0.5]);
  });

  it("are walked forward, and backward on a walk back, and a straight path has none", () => {
    const spaces = mapSpaces(BOARD);
    expect(bendsBetween(spaces, 0, 1)).toEqual([[3.5, 64, 2.5], [6.5, 64, 2.5]]);
    expect(bendsBetween(spaces, 1, 0)).toEqual([[6.5, 64, 2.5], [3.5, 64, 2.5]]);
    expect(bendsBetween(spaces, 1, 2)).toEqual([]);
  });
});

describe("a space's NPC spot and a Shop's Villager in the game", () => {
  it("are the spot's block middle at its floor with its facing, and the Villager's properties", () => {
    const [, shop, plain] = mapSpaces([BOARD[0], { ...BOARD[1], type: "shop", npc: [11, 64, 2, 270, 0], villager: { biome: "taiga", level: "iron" } }, BOARD[2]]);
    expect(shop.npc).toEqual({ at: [11.5, 64, 2.5], yaw: 270 });
    expect(shop.villager).toEqual({ biome: 6, profession: 0, level: 1 });
    expect(plain.npc).toBeUndefined();
    expect(mapSpaces([{ ...BOARD[0], npc: [1, 64, 1] }])[0].npc).toEqual({ at: [1.5, 64, 1.5] });
  });
});

describe("golems", () => {
  const spaces = mapSpaces(BOARD);
  const config = { golems: [golem(2, 3, 12), golem(2, 4, 15), golem(3, 1, 8), golem(4, 1, 18)] };

  it("are played only with every part set on a path that's on the board", () => {
    const golems = mapGolems(config, spaces);
    expect(golems.map((one) => [one.number, one.before, one.after])).toEqual([
      [1, 1, 2],
      [2, 1, 3],
      [3, 2, 0],
      [4, 3, 0],
    ]);
    expect(golems[0].post).toEqual({ at: [12.5, 64, 1.5], yaw: 90 });
    expect(golems[0].walk).toEqual([[12.5, 64, 1.5], [13.5, 64, 3.5], [12.5, 64, 5.5]]);
    // Space 3 doesn't lead to space 4; a golem without its rest spot isn't played.
    expect(mapGolems({ golems: [golem(3, 4, 0), { ...golem(2, 3, 0), rest: undefined }] }, spaces)).toEqual([]);
  });

  it("start with golems 1 and 2 on their posts, each blocking its own path one way", () => {
    const golems = mapGolems(config, spaces);
    const active = startingActive(golems);
    expect([...active]).toEqual([1, 2]);
    expect(golemOn(golems, active, 1, 2)?.number).toBe(1);
    expect(golemOn(golems, active, 2, 1)).toBeUndefined();
    expect(golemOn(golems, active, 2, 0)).toBeUndefined();
    expect(golemBetween(golems, active, 2, 1)?.number).toBe(1);
  });

  it("trade places a Star at a time: one active and one resting, picked at random", () => {
    const golems = mapGolems(config, spaces);
    const active = startingActive(golems);
    const first = pickSwap(golems, active, () => 0);
    expect([first?.leaving.number, first?.coming.number]).toEqual([1, 3]);
    const last = pickSwap(golems, active, () => 0.99);
    expect([last?.leaving.number, last?.coming.number]).toEqual([2, 4]);
    expect(pickSwap(golems, new Set([1, 2, 3, 4]), () => 0)).toBeUndefined();
  });

  it("walk their bends to their rest spot and back, and step aside along the first blocks of it", () => {
    const [one] = mapGolems(config, spaces);
    expect(walkTo(one, true)).toEqual([[12.5, 64, 5.5], [13.5, 64, 3.5], [12.5, 64, 1.5]]);
    expect(walkTicks(walkTo(one, false), 0.1)).toBe(Math.ceil((Math.hypot(1, 2) * 2) / 0.1));
    const aside = asidePath(one, 1);
    expect(aside).toHaveLength(2);
    expect(Math.hypot(aside[1][0] - 12.5, aside[1][2] - 1.5)).toBeCloseTo(1);
    expect(asidePath(one, 50)).toEqual(one.walk);
  });

  it("take a bot's toll when it has the coins, at a fork only on the way to the Star", () => {
    expect(GOLEM_TOLL).toBe(5);
    expect(botPays(5, false, false)).toBe(true);
    expect(botPays(4, false, true)).toBe(false);
    expect(botPays(9, true, false)).toBe(false);
    expect(botPays(9, true, true)).toBe(true);
  });
});

describe("the pan over the board", () => {
  it("swings round the board's middle, the same height and distance both ends", () => {
    const pan = boardPan([[0, 64, 0], [40, 64, 0], [40, 64, 20], [0, 64, 20]], 60);
    expect(pan).toHaveLength(2);
    const [from, to] = pan as [NonNullable<(typeof pan)[0]>, NonNullable<(typeof pan)[0]>];
    expect(from.facing).toEqual(to.facing);
    const middle = from.facing!;
    const away = (shot: typeof from) => Math.hypot(shot.location[0] - middle[0], shot.location[2] - middle[2]);
    expect(away(from)).toBeCloseTo(away(to));
    expect(from.location[1]).toBe(to.location[1]);
    expect(from.location[0]).not.toBeCloseTo(to.location[0]);
    expect(boardPan([], 60)).toEqual([]);
  });
});
