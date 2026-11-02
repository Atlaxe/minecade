import { describe, expect, it } from "vitest";
import { BestOf, bestOfDisplay, bestOfRounds } from "../src/game/best-of.ts";

describe("BestOf", () => {
  it("takes more than half the rounds to win: best of 5 is the first to 3", () => {
    const series = new BestOf({ rounds: 5 });
    expect([series.rounds, series.winsNeeded, series.round]).toEqual([5, 3, 1]);
    for (const side of ["red", "blue", "red", "red"]) {
      expect(series.outcome(["red", "blue"])).toEqual({ over: false });
      series.record(side);
    }
    expect(series.outcome(["red", "blue"])).toEqual({ over: true, winner: "red" });
    expect(series.history).toEqual(["red", "blue", "red", "red"]);
    expect([series.wins("red"), series.wins("blue"), series.round]).toEqual([3, 1, 5]);
  });

  it("has at least 3 rounds", () => {
    expect(new BestOf({ rounds: 1 }).rounds).toBe(3);
    expect(new BestOf({}).winsNeeded).toBe(2);
    expect(new BestOf({ rounds: 7 }).winsNeeded).toBe(4);
  });

  it("goes to the most wins once every round is played, and a tie is a draw", () => {
    const tied = new BestOf({ rounds: 3 });
    for (const side of ["red", undefined, "blue"]) tied.record(side);
    expect(tied.outcome(["red", "blue"])).toEqual({ over: true, winner: undefined });
    const fours = new BestOf({ rounds: 3 });
    for (const side of ["red", "blue", "green"]) fours.record(side);
    expect(fours.outcome(["red", "blue", "green", "yellow"])).toEqual({ over: true, winner: undefined });
    const ahead = new BestOf({ rounds: 3 });
    for (const side of ["red", undefined, undefined]) ahead.record(side);
    expect(ahead.outcome(["red", "blue"])).toEqual({ over: true, winner: "red" });
  });

  it("first-to series go on until a side gets there", () => {
    const series = new BestOf({ firstTo: 10 });
    expect([series.rounds, series.winsNeeded]).toEqual([undefined, 10]);
    for (let round = 0; round < 30; round++) series.record(round % 3 === 0 ? undefined : "blue");
    expect(series.outcome(["red", "blue"])).toEqual({ over: true, winner: "blue" });
    expect(new BestOf({ firstTo: 10 }).outcome(["red"])).toEqual({ over: false });
  });
});

describe("bestOfRounds", () => {
  it("takes the lobby option's value when the config names one, if it's a valid count", () => {
    const config = { rounds: 5, option: "bestOf" };
    expect(bestOfRounds(config, { bestOf: "7" })).toEqual({ rounds: 7 });
    expect(bestOfRounds(config, { bestOf: "2" })).toEqual({ rounds: 5 });
    expect(bestOfRounds(config, {})).toEqual({ rounds: 5 });
    expect(bestOfRounds({ firstTo: 10 }, {})).toEqual({ firstTo: 10 });
  });
});

describe("bestOfDisplay", () => {
  it("uses icons for two sides and up to 7 rounds, else the score", () => {
    expect(bestOfDisplay({}, new BestOf({ rounds: 5 }), 2)).toBe("icons");
    expect(bestOfDisplay({}, new BestOf({ rounds: 9 }), 2)).toBe("score");
    expect(bestOfDisplay({}, new BestOf({ rounds: 5 }), 4)).toBe("score");
    expect(bestOfDisplay({}, new BestOf({ firstTo: 10 }), 2)).toBe("score");
    expect(bestOfDisplay({ display: "icons" }, new BestOf({ rounds: 5 }), 3)).toBe("score"); // icons don't fit
    expect(bestOfDisplay({ display: "score" }, new BestOf({ rounds: 5 }), 2)).toBe("score");
  });
});
