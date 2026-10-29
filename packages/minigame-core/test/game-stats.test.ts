import { describe, expect, it } from "vitest";
import type { StatsConfig } from "../src/config.ts";
import type { Result } from "../src/game/results.ts";
import { packStatsParts, StatsRecorder } from "../src/game/stats.ts";
import { MAX_MESSAGE_CHARS, type MatchStats, type StatsRow } from "../src/protocol/index.ts";
import { killDeathRatio, winRate } from "../src/stats-math.ts";

const config: StatsConfig = {
  mode: "solo",
  extras: [
    { key: "blocks", label: "Blocks", agg: "sum" },
    { key: "height", label: "Height", agg: "max" },
  ],
};

function byName(rows: StatsRow[]): Record<string, StatsRow> {
  return Object.fromEntries(rows.map((row) => [row.n, row]));
}

function outcomes(recorder: StatsRecorder, result: Result): Record<string, StatsRow["r"]> {
  return Object.fromEntries(recorder.rows(result, 100).map((row) => [row.n, row.r]));
}

describe("StatsRecorder", () => {
  it("counts kills, deaths and streaks, keeping the best streak through a death", () => {
    const stats = new StatsRecorder(undefined);
    stats.kill("Alex");
    stats.kill("alex");
    stats.kill("ALEX");
    stats.death("Alex");
    stats.kill("Alex");
    expect(stats.get("alex")).toMatchObject({ name: "Alex", kills: 4, deaths: 1, streak: 1, bestStreak: 3 });
    const [row] = stats.rows({ kind: "draw", reason: "time" }, 0);
    expect(row).toMatchObject({ n: "Alex", k: 4, d: 1, bs: 3 });
  });

  it("records damage dealt and taken, rounded to 1 decimal, and never self-damage as dealt", () => {
    const stats = new StatsRecorder(undefined);
    stats.damage("Vic", 3.33, "Att");
    stats.damage("Vic", 3.33, "Att");
    stats.damage("Att", 2, "ATT");
    stats.damage("Vic", 1.5);
    expect(stats.get("Att")).toMatchObject({ taken: 2 });
    expect(stats.get("Att")!.dealt).toBeCloseTo(6.66);
    const rows = byName(stats.rows({ kind: "draw", reason: "time" }, 0));
    expect(rows.Vic).toMatchObject({ dd: 0, dt: 8.2 });
    expect(rows.Att).toMatchObject({ dd: 6.7, dt: 2 });
  });

  it("ignores damage that is zero or less", () => {
    const stats = new StatsRecorder(undefined);
    stats.damage("Vic", 0, "Att");
    stats.damage("Vic", -3, "Att");
    expect(stats.get("Vic")).toBeUndefined();
    expect(stats.get("Att")).toBeUndefined();
    expect(stats.rows({ kind: "draw", reason: "time" }, 0)).toEqual([]);
  });

  it("sums extras by default and keeps the maximum for agg max", () => {
    const stats = new StatsRecorder(config);
    stats.extra("Alex", "blocks", 3);
    stats.extra("Alex", "blocks", 4);
    stats.extra("Alex", "height", 10);
    stats.extra("Alex", "height", 6);
    stats.extra("Alex", "coins", 2);
    stats.extra("Alex", "coins", 2);
    stats.kill("Kai");
    const rows = byName(stats.rows({ kind: "draw", reason: "time" }, 0));
    expect(rows.Alex.x).toEqual({ blocks: 7, height: 10, coins: 4 });
    expect(rows.Kai).not.toHaveProperty("x");

    const plain = new StatsRecorder(undefined);
    plain.extra("Alex", "height", 10);
    plain.extra("Alex", "height", 6);
    expect(plain.get("Alex")!.extras).toEqual({ height: 16 });
  });

  it("turns time in the match into seconds across leaving and rejoining", () => {
    const stats = new StatsRecorder(undefined);
    stats.join("Alex", 100, "red");
    stats.join("Kai", 0);
    stats.leave("Kai", 300);
    stats.join("kai", 500);
    stats.join("Sam", 0);
    stats.leave("Sam", 250);
    stats.leave("Sam", 900);
    stats.leave("Ghost", 50);
    const rows = stats.rows({ kind: "draw", reason: "time" }, 1300);
    expect(rows).toHaveLength(3);
    const lines = byName(rows);
    expect(lines.Alex).toMatchObject({ s: 60, tm: "red" });
    expect(lines.Alex).not.toHaveProperty("q");
    expect(lines.Kai.s).toBe(55);
    expect(lines.Kai).not.toHaveProperty("q");
    expect(lines.Sam).toMatchObject({ s: 13, q: 1 });
  });

  it("keeps a player's team when they rejoin without one", () => {
    const stats = new StatsRecorder(undefined);
    stats.join("Alex", 0, "red");
    stats.leave("Alex", 10);
    stats.join("Alex", 20);
    expect(stats.rows({ kind: "draw", reason: "time" }, 40)[0]).toMatchObject({ tm: "red", s: 2 });
  });

  it("builds a complete row with short keys", () => {
    const stats = new StatsRecorder(config);
    stats.join("Alex", 0, "red");
    stats.kill("Alex");
    stats.damage("Kai", 4, "Alex");
    stats.extra("Alex", "blocks", 2);
    stats.join("Kai", 0);
    const rows = byName(stats.rows({ kind: "win", players: ["Alex"], reason: "last standing" }, 200));
    expect(rows.Alex).toEqual({ n: "Alex", r: "w", tm: "red", k: 1, d: 0, dd: 4, dt: 0, s: 10, bs: 1, x: { blocks: 2 } });
    expect(rows.Kai).toEqual({ n: "Kai", r: "l", k: 0, d: 0, dd: 0, dt: 4, s: 10, bs: 0 });
  });

  describe("outcomes", () => {
    it("gives a solo winner w and everyone else l, matching names case-insensitively", () => {
      const stats = new StatsRecorder(undefined);
      for (const name of ["Alex", "Kai", "Sam"]) stats.join(name, 0);
      expect(outcomes(stats, { kind: "win", players: ["alex"], reason: "last standing" })).toEqual({ Alex: "w", Kai: "l", Sam: "l" });
    });

    it("gives players tied for first a draw", () => {
      const stats = new StatsRecorder(undefined);
      for (const name of ["Alex", "Kai", "Sam"]) stats.join(name, 0);
      expect(outcomes(stats, { kind: "win", players: ["Alex", "Kai"], reason: "tied" })).toEqual({ Alex: "d", Kai: "d", Sam: "l" });
    });

    it("gives the whole winning team w, eliminated members included, and leavers l", () => {
      const stats = new StatsRecorder(undefined);
      stats.join("A", 0, "red");
      stats.join("B", 0, "red");
      stats.join("C", 0, "blue");
      stats.join("D", 0, "blue");
      stats.join("E", 0, "red");
      stats.death("B");
      stats.leave("E", 50);
      expect(outcomes(stats, { kind: "win", players: ["A"], team: "red", reason: "last team" })).toEqual({
        A: "w",
        B: "w",
        C: "l",
        D: "l",
        E: "l",
      });
    });

    it("gives everyone the coop result, except leavers who lose", () => {
      const stats = new StatsRecorder(undefined);
      for (const name of ["A", "B", "C"]) stats.join(name, 0);
      stats.leave("C", 50);
      expect(outcomes(stats, { kind: "coop", won: true, reason: "boss down" })).toEqual({ A: "w", B: "w", C: "l" });
      expect(outcomes(stats, { kind: "coop", won: false, reason: "wiped" })).toEqual({ A: "l", B: "l", C: "l" });
    });

    it("gives everyone a draw, leavers included", () => {
      const stats = new StatsRecorder(undefined);
      for (const name of ["A", "B", "C"]) stats.join(name, 0);
      stats.leave("C", 50);
      expect(outcomes(stats, { kind: "draw", reason: "time" })).toEqual({ A: "d", B: "d", C: "d" });
    });

    it("gives a leaver l even when named in a solo win", () => {
      const stats = new StatsRecorder(undefined);
      stats.join("A", 0);
      stats.join("B", 0);
      stats.leave("A", 10);
      expect(outcomes(stats, { kind: "win", players: ["A"], reason: "score" })).toEqual({ A: "l", B: "l" });
    });
  });
});

describe("packStatsParts", () => {
  const header: Omit<MatchStats, "t" | "part" | "parts" | "rows"> = {
    sessionId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    matchId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    game: "capture-the-flag",
    map: "highlands-ruins",
    mode: "team",
    durationSec: 3600,
    winner: "yellow",
  };

  function worstRow(i: number): StatsRow {
    return {
      n: `Gamertag${String(i).padStart(8, "0")}`,
      r: "w",
      k: 99999,
      d: 99999,
      dd: 99999.9,
      dt: 99999.9,
      s: 99999,
      bs: 99999,
      tm: "yellow",
      q: 1,
      x: { blocksPlaced: 999999, blocksBroken: 999999, flagsCaptured: 999999, longestLifeSec: 999999, coinsEarned: 999999 },
    };
  }

  function hugeRow(name: string): StatsRow {
    const x: Record<string, number> = {};
    for (let i = 0; i < 150; i++) x[`extra_${String(i).padStart(3, "0")}`] = 999999;
    return { n: name, r: "l", k: 1, d: 2, dd: 3, dt: 4, s: 5, bs: 1, x };
  }

  function expectWellFormed(parts: MatchStats[]): void {
    parts.forEach((part, i) => {
      expect(JSON.stringify(part).length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
      expect(part).toMatchObject({ t: "match_stats", ...header, part: i + 1, parts: parts.length });
    });
  }

  it("puts a single row in a single part", () => {
    const row: StatsRow = { n: "Alex", r: "w", k: 3, d: 1, dd: 20, dt: 8.5, s: 120, bs: 2 };
    expect(packStatsParts(header, [row])).toEqual([{ t: "match_stats", ...header, part: 1, parts: 1, rows: [row] }]);
  });

  it("still sends one part when there are no rows", () => {
    expect(packStatsParts(header, [])).toEqual([{ t: "match_stats", ...header, part: 1, parts: 1, rows: [] }]);
  });

  it("splits 20 worst-case rows into parts that each fit, keeping every row once and in order", () => {
    const rows = Array.from({ length: 20 }, (_, i) => worstRow(i + 1));
    expect(rows[0].n).toHaveLength(16);
    const parts = packStatsParts(header, rows);
    expect(parts.length).toBeGreaterThan(1);
    expectWellFormed(parts);
    for (const part of parts) expect(part.rows.length).toBeGreaterThan(0);
    expect(parts.flatMap((part) => part.rows)).toEqual(rows);
  });

  it("keeps a row too large for any message, without its extras", () => {
    const huge = hugeRow("Alex");
    const { x: _x, ...plain } = huge;
    const parts = packStatsParts(header, [huge]);
    expectWellFormed(parts);
    expect(parts.flatMap((part) => part.rows)).toEqual([plain]);
  });

  it("drops the extras of an oversized row that comes after other rows", () => {
    const small: StatsRow = { n: "Kai", r: "w", k: 3, d: 1, dd: 20, dt: 8.5, s: 120, bs: 2 };
    const huge = hugeRow("Alex");
    const { x: _x, ...plain } = huge;
    const parts = packStatsParts(header, [small, huge]);
    expectWellFormed(parts);
    expect(parts.flatMap((part) => part.rows)).toEqual([small, plain]);
  });
});

describe("stats math", () => {
  it("gives kills per death to 2 decimals, the kill count with no deaths", () => {
    expect(killDeathRatio(5, 0)).toBe(5);
    expect(killDeathRatio(0, 0)).toBe(0);
    expect(killDeathRatio(0, 4)).toBe(0);
    expect(killDeathRatio(10, 3)).toBe(3.33);
    expect(killDeathRatio(2, 3)).toBe(0.67);
    expect(killDeathRatio(1, 8)).toBe(0.13);
    expect(killDeathRatio(6, 2)).toBe(3);
  });

  it("gives the win rate as a percentage to 1 decimal, 0 with no games", () => {
    expect(winRate(0, 0)).toBe(0);
    expect(winRate(0, 5)).toBe(0);
    expect(winRate(1, 3)).toBe(33.3);
    expect(winRate(2, 3)).toBe(66.7);
    expect(winRate(1, 8)).toBe(12.5);
    expect(winRate(4, 4)).toBe(100);
  });
});
