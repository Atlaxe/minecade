import { describe, expect, it } from "vitest";
import { WHEEL_SIZE, battleBets, ffaCoins, firstDoubled, fits, forcedOutcome, formatFor, isDoubled, kindOf, pairingKey, pickMinigame, pickName, pickPairs, pickSolo, spinStart, splitPot, teamCoins, wheelOf } from "../behavior_pack/scripts/minigame-rules.ts";

/** Always the first choice. */
const first = () => 0;
/** Never a Battle. */
const high = () => 0.99;

describe("Block Party's minigame rules", () => {
  it("plays a team game every 3rd round, 2v2 and 1v3 in turn, FFA otherwise", () => {
    expect([1, 2, 3, 4, 5, 6, 9, 12].map((round) => formatFor(round, 4, high))).toEqual(["ffa", "ffa", "2v2", "ffa", "ffa", "1v3", "2v2", "1v3"]);
    expect(formatFor(3, 3, high)).toBe("1v3");
    expect(formatFor(3, 2, high)).toBe("ffa");
    expect(formatFor(1, 4, first)).toBe("battle");
    expect(formatFor(1, 1, first)).toBe("ffa");
    expect(kindOf("battle")).toBe("ffa");
    expect(kindOf("duel")).toBe("ffa");
    expect(kindOf("1v3")).toBe("1v3");
  });

  it("says which formats the players fit (the Tests menu checks before playing one)", () => {
    expect([1, 2, 3, 4].map((players) => fits("2v2", players))).toEqual([false, false, false, true]);
    expect([1, 2, 3, 4].map((players) => fits("1v3", players))).toEqual([false, false, true, true]);
    expect([1, 2].map((players) => fits("battle", players))).toEqual([false, true]);
    expect(fits("ffa", 1)).toBe(true);
    for (let round = 1; round <= 20; round++) for (const players of [1, 2, 3, 4]) expect(fits(formatFor(round, players, () => 0), players)).toBe(true);
  });

  it("rotates the solo and the pairs so everyone gets an equal share", () => {
    expect(pickSolo(["a", "b", "c"], new Map([["a", 1]]), first)).toBe("b");
    const used = new Map([[pairingKey([["a", "b"], ["c", "d"]]), 1]]);
    expect(pairingKey(pickPairs(["a", "b", "c", "d"], used, first))).toBe("a+c|b+d");
    expect(pairingKey([["d", "c"], ["b", "a"]])).toBe("a+b|c+d");
  });

  it("makes a minigame played already much less likely", () => {
    const pool = [{ id: "x" }, { id: "y" }];
    expect(pickMinigame(pool, new Map([["x", 1]]), () => 0.5)?.id).toBe("y");
    expect(pickMinigame(pool, new Map([["x", 1]]), () => 0.01)?.id).toBe("x");
    expect(pickMinigame([], new Map(), first)).toBeUndefined();
  });

  it("pays FFA places by how many play, a tie the average of its places", () => {
    expect(Object.fromEntries(ffaCoins([["a"], ["b"], ["c"], ["d"]]))).toEqual({ a: 10, b: 6, c: 3, d: 1 });
    expect(Object.fromEntries(ffaCoins([["a", "b"], ["c"], ["d"]]))).toEqual({ a: 8, b: 8, c: 3, d: 1 });
    expect(Object.fromEntries(ffaCoins([["a"], ["b"], ["c"]]))).toEqual({ a: 10, b: 5, c: 2 });
    expect(Object.fromEntries(ffaCoins([["a"], ["b"]]))).toEqual({ a: 10, b: 3 });
  });

  it("pays 2v2 7 and 2, 1v3 by who won", () => {
    expect(Object.fromEntries(teamCoins("2v2", [["a", "b"], ["c", "d"]], 1))).toEqual({ a: 2, b: 2, c: 7, d: 7 });
    expect(Object.fromEntries(teamCoins("1v3", [["s"], ["a", "b", "c"]], 0))).toEqual({ s: 10, a: 1, b: 1, c: 1 });
    expect(Object.fromEntries(teamCoins("1v3", [["s"], ["a", "b", "c"]], 1))).toEqual({ s: 2, a: 6, b: 6, c: 6 });
  });

  it("takes 5 from each for a Battle's pot and splits it among the winners", () => {
    expect(Object.fromEntries(battleBets(new Map([["a", 12], ["b", 3], ["c", 0]])))).toEqual({ a: 5, b: 3, c: 0 });
    expect(Object.fromEntries(splitPot(13, ["a", "b"]))).toEqual({ a: 6, b: 6 });
  });

  it("doubles the last 2 rounds, the last one only in a 10-turn game", () => {
    expect([13, 14, 15].map((round) => isDoubled(round, 15))).toEqual([false, true, true]);
    expect([9, 10].map((round) => isDoubled(round, 10))).toEqual([false, true]);
    expect([firstDoubled(10), firstDoubled(15), firstDoubled(20)]).toEqual([10, 14, 19]);
  });

  it("finds who /minigame win names: the name, else the only one it starts, else the only one it's in", () => {
    const names = ["big red fox", "Bot Alex", "Bot Sam", "Steve"];
    expect(pickName(names, "BIG RED FOX")).toBe("big red fox");
    expect(pickName(names, "big")).toBe("big red fox");
    expect(pickName(names, "bot s")).toBe("Bot Sam");
    expect(pickName(names, "fox")).toBe("big red fox");
    expect(pickName(names, "bot")).toBeUndefined();
    expect(pickName(names, "zed")).toBeUndefined();
    expect(pickName(names, " ")).toBeUndefined();
    // A full name wins over the longer ones it starts.
    expect(pickName(["Sam", "Samuel"], "sam")).toBe("Sam");
  });

  it("ends a minigame with /minigame win's pick first, or their side winning", () => {
    expect(forcedOutcome("ffa", [["a"], ["b"], ["c"]], "b")).toEqual({ places: [["b"], ["a", "c"]] });
    expect(forcedOutcome("ffa", [["a"]], "a")).toEqual({ places: [["a"]] });
    expect(forcedOutcome("2v2", [["a", "b"], ["c", "d"]], "d")).toEqual({ winner: 1 });
    expect(forcedOutcome("1v3", [["a"], ["b", "c", "d"]], "a")).toEqual({ winner: 0 });
    expect(forcedOutcome("ffa", [["a"], ["b"]], "z")).toBeUndefined();
  });
});

describe("the minigame announcement's wheel", () => {
  /** A steady stream of "random" numbers, for a repeatable shuffle. */
  const stream = (seed: number) => () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  it("holds the format's minigames, the pick always among them, at most 6", () => {
    const names = Array.from({ length: 9 }, (_, i) => `Game ${i}`);
    for (let seed = 1; seed < 40; seed++) {
      const wheel = wheelOf(names, "Game 7", stream(seed));
      expect(wheel).toHaveLength(WHEEL_SIZE);
      expect(wheel).toContain("Game 7");
      expect(new Set(wheel).size).toBe(WHEEL_SIZE);
    }
    expect(wheelOf(["Hot Floor"], "Hot Floor", stream(3))).toEqual(["Hot Floor"]);
    expect(wheelOf(["A", "B", "A"], "B", stream(5)).sort()).toEqual(["A", "B"]);
  });

  it("starts where its steps land on the pick", () => {
    for (const [size, pick, steps] of [
      [6, 2, 17],
      [3, 0, 17],
      [1, 0, 17],
      [5, 4, 3],
    ]) {
      const start = spinStart(size, pick, steps);
      expect((start + steps) % size).toBe(pick);
      expect(start).toBeGreaterThanOrEqual(0);
    }
  });
});
