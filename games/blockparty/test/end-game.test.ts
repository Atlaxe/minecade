// The end of the game (end-game.ts; docs/plans/block-party.md, "End-of-game bonus Stars" and
// "Tiebreaker"): what the game keeps on each seat, the bonus Star draw, the tiebreaker and the final
// places.
import { describe, expect, it } from "vitest";
import { AWARD_CATEGORIES, AWARDS, GameStats, bestFor, bonusStarCount, drawBonusStars, finalPlaces, newStats, tiebreakFormat, tiebreakPlaces, tiebreakPool, withWinner, type DrawSeat, type SeatEnd, type SeatStats } from "../behavior_pack/scripts/end-game.ts";
import { MINIGAMES } from "../behavior_pack/scripts/minigames/index.ts";
import dialogue from "../dialogue.json";

/** A seat for the draw: its stats as given, at `place` of 4 at the end. */
function seat(key: string, stats: Partial<SeatStats>, end: Partial<SeatEnd> = {}): DrawSeat {
  return { key, stats: { ...newStats(), ...stats }, end: { place: 1, last: false, held: 0, rounds: 10, ...end } };
}

/** A random that hands out these values in turn, then 0. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0;
}

describe("what the game keeps for the bonus Stars", () => {
  it("counts wins, streaks, second places and team wins from the round minigames", () => {
    const stats = new GameStats();
    stats.minigame([["a"], ["b"], ["c"]], { places: [["a"], ["b"], ["c"]] });
    stats.minigame([["a"], ["b"], ["c"]], { places: [["a"], ["b", "c"]] });
    stats.minigame([["a", "b"], ["c"]], { winner: 1 });
    stats.minigame([["a"], ["b"], ["c"]], { places: [["a", "b"], ["c"]] });
    expect(stats.of("a")).toMatchObject({ wins: 3, streak: 1, bestStreak: 2, seconds: 0, teamWins: 0 });
    // Tied for second once, second alone once; ties for first leave nobody second.
    expect(stats.of("b")).toMatchObject({ wins: 1, seconds: 2, teamWins: 0 });
    expect(stats.of("c")).toMatchObject({ wins: 1, seconds: 1, teamWins: 1, streak: 0, bestStreak: 1 });
    // A draw in a team minigame: no wins, streaks gone.
    stats.minigame([["a", "b"], ["c"]], { winner: undefined });
    expect(stats.of("a").streak).toBe(0);
  });

  it("keeps the biggest swing and best roll, adds luck, and counts duels outside the streaks", () => {
    const stats = new GameStats();
    stats.coins("a", 5);
    stats.coins("a", -12);
    stats.coins("a", 3);
    stats.rolled("a", 4);
    stats.rolled("a", 9);
    stats.rolled("a", 2);
    stats.lucky("a", 5);
    stats.lucky("a", 0);
    stats.lucky("a", 20);
    stats.duel("a");
    stats.duel(undefined);
    expect(stats.of("a")).toMatchObject({ swing: 12, bestRoll: 9, luck: 25, wins: 1, streak: 0 });
    stats.roundOver(1, new Map([["a", 3]]));
    stats.roundOver(2, new Map([["a", 1]]));
    expect([...stats.of("a").places]).toEqual([
      [1, 3],
      [2, 1],
    ]);
  });
});

describe("the bonus Stars", () => {
  it("brings 3 with 3 or 4 seats, 2 with 2, none for one alone", () => {
    expect([bonusStarCount(4), bonusStarCount(3), bonusStarCount(2), bonusStarCount(1)]).toEqual([3, 3, 2, 0]);
  });

  it("has awards in all four categories, each named in the dialogue file", () => {
    expect(new Set(AWARDS.map((award) => award.category))).toEqual(new Set(AWARD_CATEGORIES));
    const lines: Record<string, string[]> = dialogue.lines;
    expect(AWARDS.filter((award) => !lines[`bonus.${award.id}`]?.[0])).toEqual([]);
  });

  it("gives an award to whoever did the most of it, and never for nothing", () => {
    const wins = AWARDS.find((award) => award.id === "wins")!;
    expect(bestFor(wins, [seat("a", { wins: 2 }), seat("b", { wins: 5 }), seat("c", { wins: 5 })])).toEqual(["b", "c"]);
    expect(bestFor(wins, [seat("a", {}), seat("b", {})])).toEqual([]);
    // A streak needs 2 in a row; climbs count from where they stood.
    const streak = AWARDS.find((award) => award.id === "streak")!;
    expect(bestFor(streak, [seat("a", { bestStreak: 1 })])).toEqual([]);
    const comeback = AWARDS.find((award) => award.id === "comeback")!;
    expect(bestFor(comeback, [seat("a", { places: new Map([[1, 2], [4, 4]]) }, { place: 1 }), seat("b", { places: new Map([[1, 1]]) }, { place: 2 })])).toEqual(["a"]);
    const surge = AWARDS.find((award) => award.id === "surge")!;
    expect(bestFor(surge, [seat("a", { places: new Map([[5, 4]]) }, { place: 1, rounds: 10 })])).toEqual(["a"]);
    expect(bestFor(surge, [seat("a", { places: new Map([[5, 4]]) }, { place: 1, rounds: 5 })])).toEqual([]);
  });

  it("never draws two from one category, nor two for one seat, and passes over awards whose best already has one", () => {
    const seats = [
      seat("a", { hazards: 9, wins: 9, itemsUsed: 9, teamWins: 9 }),
      seat("b", { hazards: 1, wins: 1, itemsUsed: 1, teamWins: 1 }),
      seat("c", {}),
      seat("d", {}),
    ];
    for (let trial = 0; trial < 50; trial++) {
      let state = trial * 7919;
      const random = () => {
        state = (state * 48271) % 2147483647 || 1;
        return state / 2147483647;
      };
      const drawn = drawBonusStars(seats, 3, random);
      const categories = drawn.map((star) => AWARDS.find((award) => award.id === star.award)!.category);
      expect(new Set(categories).size).toBe(categories.length);
      expect(new Set(drawn.map((star) => star.key)).size).toBe(drawn.length);
      // Only "a" leads anything: one Star, never a runner-up's.
      expect(drawn).toHaveLength(1);
      expect(drawn[0].key).toBe("a");
    }
  });

  it("spreads Stars over the seats that lead something", () => {
    const seats = [seat("a", { hazards: 3 }), seat("b", { wins: 2 }), seat("c", { itemsUsed: 4 }), seat("d", { teamWins: 1 })];
    const drawn = drawBonusStars(seats, 3, sequence(0.1, 0.2, 0.3));
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn.map((star) => star.key)).size).toBe(3);
  });

  it("picks among a tie at random", () => {
    const seats = [seat("a", { wins: 2 }), seat("b", { wins: 2 })];
    // Skill first (the categories shuffled so), wins first in it, then the second of the two tied.
    const keys = new Set<string>();
    for (const last of [0, 0.99]) {
      const random = () => last;
      keys.add(drawBonusStars(seats, 1, random)[0]?.key ?? "");
    }
    expect(keys).toEqual(new Set(["a", "b"]));
  });
});

describe("the tiebreaker and the final places", () => {
  it("plays a duel for two and a free-for-all for more, from the short pool's minigames that are built", () => {
    expect(tiebreakFormat(2)).toBe("duel");
    expect(tiebreakFormat(3)).toBe("ffa");
    const pool = new Set(["hotfloor", "sumoduel", "cactus"]);
    expect(tiebreakPool(MINIGAMES).map((minigame) => minigame.id)).toEqual(MINIGAMES.filter((minigame) => pool.has(minigame.id)).map((minigame) => minigame.id));
    // With none of the pool built, any free-for-all minigame.
    const rest = MINIGAMES.filter((minigame) => !pool.has(minigame.id));
    expect(tiebreakPool(rest)).toEqual(rest.filter((minigame) => minigame.kind === "ffa"));
  });

  it("ranks by Stars, then coins, ties together, and lets the tiebreaker order the first place", () => {
    const seats = [
      { key: "a", stars: 3, coins: 10 },
      { key: "b", stars: 3, coins: 10 },
      { key: "c", stars: 2, coins: 40 },
      { key: "d", stars: 3, coins: 9 },
    ];
    expect(finalPlaces(seats)).toEqual([["a", "b"], ["d"], ["c"]]);
    expect(finalPlaces(seats, [["b"], ["a"]])).toEqual([["b"], ["a"], ["d"], ["c"]]);
    // A tiebreaker that leaves someone out puts them after the ones it placed.
    expect(finalPlaces(seats, [["b"]])).toEqual([["b"], ["a"], ["d"], ["c"]]);
  });

  it("reads the sudden death's places among the tied, and the Allay's pick on top", () => {
    expect(tiebreakPlaces(["a", "b"], { places: [["b"], ["a"]] })).toEqual([["b"], ["a"]]);
    expect(tiebreakPlaces(["a", "b", "c"], { places: [["a", "c"]] })).toEqual([["a", "c"], ["b"]]);
    expect(tiebreakPlaces(["a", "b"], { places: [] })).toEqual([["a", "b"]]);
    expect(tiebreakPlaces(["a", "b"], { winner: 0 })).toEqual([["a", "b"]]);
    expect(withWinner([["a", "c"], ["b"]], "c")).toEqual([["c"], ["a"], ["b"]]);
  });
});
