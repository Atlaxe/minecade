import { describe, expect, it } from "vitest";
import { activeStars, addCoins, apartFrom, coinsFor, firstStars, leaders, nextStar, ranked, starDistance, starPrice, turnOrder, type RuleSpace } from "../behavior_pack/scripts/board-rules.ts";

/** A loop of `count` spaces, Start first; Star candidates where given, opening spots among them. */
function loop(count: number, stars: number[] = [], openings: number[] = []): RuleSpace[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    type: index === 0 ? "start" : "blue",
    next: [(index + 1) % count],
    ...(stars.includes(index) ? { star: true } : {}),
    ...(openings.includes(index) ? { opening: true } : {}),
  }));
}

/** Always the first choice. */
const first = () => 0;

describe("Block Party's board rules", () => {
  it("pays Blue 3 and takes 3 on Red, never below 0", () => {
    expect(coinsFor("blue")).toBe(3);
    expect(coinsFor("red")).toBe(-3);
    expect(coinsFor("chance")).toBe(0);
    expect(addCoins(2, -3)).toBe(0);
    expect(addCoins(10, 3)).toBe(13);
  });

  it("prices a Star by the game's length, with two out in a 10-turn game", () => {
    expect([10, 15, 20].map(starPrice)).toEqual([15, 20, 25]);
    expect([10, 15, 20].map(activeStars)).toEqual([2, 1, 1]);
  });

  it("starts the Stars on the opening spots, then other candidates, then any space but Start", () => {
    const board = loop(40, [5, 12, 20, 30], [12, 30]);
    expect(firstStars(board, 2, first).sort()).toEqual([12, 30]);
    expect(firstStars(board, 1, first)).toEqual([12]);
    expect(firstStars(board, 3, first)).toEqual([12, 30, 5]);
    expect(firstStars(loop(4), 1, first)).toEqual([1]);
  });

  it("moves a bought Star to a candidate far enough away, never onto another Star", () => {
    const board = loop(40, [5, 8, 20, 30], [5, 30]);
    expect(apartFrom(board, 0).get(20)).toBe(20);
    expect(apartFrom(board, 0).get(39)).toBe(1);
    // From 5, at least 12 away: 20 (15) or 30 (15 the other way round), not 8 (3).
    expect([20, 30]).toContain(nextStar(board, 5, [], 12, first));
    expect(nextStar(board, 5, [20], 12, first)).toBe(30);
    // None far enough: the furthest.
    expect(nextStar(board, 5, [20, 30], 12, first)).toBe(8);
    expect(starDistance(40)).toBe(12);
    expect(starDistance(12)).toBe(6);
    expect(starDistance(75)).toBe(23);
  });

  it("ranks by Stars, then coins, and finds who's tied at the top", () => {
    const players = [
      { name: "b", stars: 1, coins: 30 },
      { name: "a", stars: 2, coins: 5 },
      { name: "c", stars: 2, coins: 5 },
    ];
    expect(ranked(players).map((player) => player.name)).toEqual(["a", "c", "b"]);
    expect(leaders(players).map((player) => player.name)).toEqual(["a", "c"]);
    expect(leaders([])).toEqual([]);
  });

  it("orders turns by everyone's roll, highest first", () => {
    expect(turnOrder([{ name: "a", roll: 2 }, { name: "b", roll: 6 }, { name: "c", roll: 2 }])).toEqual(["b", "a", "c"]);
  });
});
