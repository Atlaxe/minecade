// The stats store against real node:sqlite databases (in memory, or in a temp folder for the
// file, backup and migration cases), plus part validation and the lobby's stats replies.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatchStats, StatsRow } from "@minecade/minigame-core/protocol";
import type { Registry } from "../src/registry.ts";
import { answerStatsQuery } from "../src/stats/reply.ts";
import { StatsStore, type PlayerSummary } from "../src/stats/store.ts";
import { checkMatchStats } from "../src/stats/validate.ts";

const registry: Registry = {
  games: [
    { id: "sumo", name: "Sumo", minPlayers: 2, maxPlayers: 6, maps: [{ id: "arena_1", name: "Arena" }], stats: { mode: "solo", pvp: true } },
    {
      id: "snd",
      name: "Search and Destroy",
      minPlayers: 2,
      maxPlayers: 10,
      maps: [{ id: "dust", name: "Dust" }],
      stats: {
        mode: "team",
        pvp: true,
        extras: [
          { key: "plants", label: "Bombs planted", agg: "sum" },
          { key: "bestRound", label: "Best round", agg: "max" },
        ],
      },
    },
    {
      id: "zombies",
      name: "Zombies",
      minPlayers: 1,
      maxPlayers: 4,
      maps: [{ id: "town", name: "Town" }],
      stats: { mode: "coop", extras: [{ key: "bestWave", label: "Best wave", agg: "max" }] },
    },
    { id: "probe", name: "Probe", minPlayers: 1, maxPlayers: 8, maps: [{ id: "default", name: "Default" }] },
  ],
};

const row = (n: string, r: StatsRow["r"], more: Partial<StatsRow> = {}): StatsRow => ({ n, r, k: 0, d: 0, dd: 0, dt: 0, s: 60, bs: 0, ...more });

let matches = 0;
function match(game: string, rows: StatsRow[], more: Partial<MatchStats> = {}): MatchStats {
  const session = `s${++matches}`;
  const mode = registry.games.find((candidate) => candidate.id === game)?.stats?.mode ?? "solo";
  return { t: "match_stats", sessionId: session, matchId: `${session}.1`, part: 1, parts: 1, game, map: "m", mode, durationSec: 60, rows, ...more };
}

const noXuids = new Map<string, string>();
const dirs: string[] = [];
// Open databases lock their files on Windows, so every store is closed before cleanup.
const stores: StatsStore[] = [];
const track = (store: StatsStore) => (stores.push(store), store);
let clock = Date.UTC(2026, 9, 29, 12, 0, 0);

function memoryStore(): StatsStore {
  return track(new StatsStore(new DatabaseSync(":memory:"), { registry, now: () => clock }));
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "minecade-stats-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // already closed by the test
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("StatsStore: totals", () => {
  it("adds up wins, kills, damage and time, with K/D and win rate", () => {
    const store = memoryStore();
    store.record(match("sumo", [row("Alex", "w", { k: 3, d: 1, dd: 40.5, dt: 10, bs: 3 }), row("Kai", "l", { k: 1, d: 3, dd: 10, dt: 40.5 })]), noXuids);
    store.record(match("sumo", [row("Alex", "l", { k: 1, d: 1, dd: 20, dt: 20, bs: 1 }), row("Kai", "w", { k: 1, d: 1, dd: 20, dt: 20 })]), noXuids);
    store.record(match("sumo", [row("Alex", "d"), row("Kai", "d")]), noXuids);
    const alex = store.summary("ALEX")!;
    expect(alex.name).toBe("Alex");
    expect(alex.overall).toEqual({
      games: 3,
      wins: 1,
      losses: 1,
      draws: 1,
      kills: 4,
      deaths: 2,
      dealt: 60.5,
      taken: 30,
      seconds: 180,
      bestStreak: 3,
      left: 0,
      kd: 2,
      winRate: 33.3,
    });
    expect(alex.games.sumo).toEqual(alex.overall);
  });

  it("leaves co-op out of overall, and sums or maxes each game's extras as declared", () => {
    const store = memoryStore();
    store.record(match("snd", [row("Alex", "w", { tm: "red", x: { plants: 2, bestRound: 3 } }), row("Kai", "l", { tm: "blue" })]), noXuids);
    store.record(match("snd", [row("Alex", "w", { tm: "red", x: { plants: 1, bestRound: 5 } }), row("Kai", "l", { tm: "blue" })]), noXuids);
    store.record(match("zombies", [row("Alex", "w", { x: { bestWave: 7 } })]), noXuids); // co-op alone still counts
    store.record(match("zombies", [row("Alex", "l", { x: { bestWave: 4 } })]), noXuids);
    const alex = store.summary("alex")!;
    expect(alex.overall).toMatchObject({ games: 2, wins: 2 });
    expect(alex.games.snd).toMatchObject({ games: 2, extras: { plants: 3, bestRound: 5 } });
    expect(alex.games.zombies).toMatchObject({ games: 2, wins: 1, losses: 1, winRate: 50, extras: { bestWave: 7 } });
  });

  it("doesn't count a competitive match with one player, but still lists it as recent", () => {
    const store = memoryStore();
    store.record(match("sumo", [row("Alex", "w", { k: 0 })]), noXuids);
    const alex = store.player("Alex")!;
    expect(alex.overall.games).toBe(0);
    expect(alex.games).toEqual({});
    expect(alex.recent).toEqual([expect.objectContaining({ game: "sumo", counted: false, result: "w", left: false })]);
    expect(store.summary("nobody")).toBeUndefined();
  });

  it("lists everyone in the overview, with the games that declare stats or were played", () => {
    const store = memoryStore();
    store.record(match("probe", [row("kai", "w"), row("Alex", "l", { q: 1 })]), noXuids);
    const overview = store.overview();
    expect(overview.games.map((game) => game.id)).toEqual(["sumo", "snd", "zombies", "probe"]);
    expect(overview.games[1].extras).toEqual([
      { key: "plants", label: "Bombs planted" },
      { key: "bestRound", label: "Best round" },
    ]);
    expect(overview.players.map((player) => [player.name, player.overall.games, player.overall.left])).toEqual([
      ["Alex", 1, 1],
      ["kai", 1, 0],
    ]);
  });

  it("follows a player's xuid across a gamertag change, and falls back to the gamertag without one", () => {
    const store = memoryStore();
    store.record(match("sumo", [row("Alex", "w"), row("Kai", "l")]), new Map([["alex", "111"]]));
    clock += 1000;
    store.record(match("sumo", [row("Alexander", "w"), row("kai", "l")]), new Map([["alexander", "111"]]));
    expect(store.summary("Alex")).toBeUndefined();
    expect(store.summary("alexander")).toMatchObject({ name: "Alexander", overall: { games: 2, wins: 2 } });
    expect(store.summary("KAI")).toMatchObject({ name: "kai", overall: { games: 2, losses: 2 } });
  });
});

describe("StatsStore: storing parts", () => {
  it("stores a part once, however often it's sent, and logs it raw once", () => {
    const dir = tempDir();
    const store = track(StatsStore.open(dir, registry));
    const part = match("sumo", [row("Alex", "w", { k: 1 }), row("Kai", "l")]);
    expect(store.record(part, noXuids)).toBe("stored");
    expect(store.record(part, noXuids)).toBe("duplicate");
    expect(store.summary("Alex")?.overall).toMatchObject({ games: 1, kills: 1 });
    const lines = readFileSync(join(dir, "stats-events.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ keys: { Alex: "name:alex", Kai: "name:kai" }, part });
    store.close();
  });

  it("puts a match sent in several parts together", () => {
    const store = memoryStore();
    const header = { sessionId: "big", matchId: "big.1", parts: 2 };
    expect(store.record(match("sumo", [row("A", "w"), row("B", "l")], { ...header, part: 1 }), noXuids)).toBe("stored");
    expect(store.record(match("sumo", [row("C", "l")], { ...header, part: 2 }), noXuids)).toBe("stored");
    expect(store.record(match("sumo", [row("C", "l")], { ...header, part: 2 }), noXuids)).toBe("duplicate");
    expect(store.player("C")?.recent).toEqual([expect.objectContaining({ matchId: "big.1", counted: true })]);
    expect(store.overview().players).toHaveLength(3);
  });

  it("keeps everything across a reopen, and refuses a database from a newer orchestrator", () => {
    const dir = tempDir();
    const first = track(StatsStore.open(dir, registry));
    expect(first.schemaVersion).toBe(1);
    first.record(match("sumo", [row("Alex", "w"), row("Kai", "l")]), noXuids);
    first.close();
    const again = track(StatsStore.open(dir, registry));
    expect(again.schemaVersion).toBe(1);
    expect(again.summary("alex")?.overall.games).toBe(1);
    again.close();

    const raw = new DatabaseSync(join(dir, "stats.db"));
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    expect(() => StatsStore.open(dir, registry)).toThrow(/schema version 99, newer/);
  });

  it("backs up to a dated copy and keeps the newest 14", () => {
    const dir = tempDir();
    let now = Date.UTC(2026, 0, 1, 3, 4, 5);
    const store = track(new StatsStore(new DatabaseSync(join(dir, "stats.db")), { registry, backupDir: dir, now: () => now }));
    store.record(match("sumo", [row("Alex", "w"), row("Kai", "l")]), noXuids);
    expect(store.backup()).toBe(join(dir, "stats-20260101-030405.db"));
    expect(store.backup()).toBe(join(dir, "stats-20260101-030405.db")); // same second: kept, not redone
    for (let day = 1; day <= 15; day++) {
      now += 24 * 60 * 60_000;
      store.backup();
    }
    const backups = readdirSync(dir).filter((name) => name.startsWith("stats-")).sort();
    expect(backups).toHaveLength(14);
    expect(backups[0]).toBe("stats-20260103-030405.db");
    const copy = track(new StatsStore(new DatabaseSync(join(dir, backups[0])), { registry }));
    expect(copy.summary("alex")?.overall.games).toBe(1);
    copy.close();
    store.close();
  });
});

describe("checkMatchStats", () => {
  const sumo = registry.games[0];
  const snd = registry.games[1];

  it("rounds and clamps numbers, keeps declared extras only, and tidies the header", () => {
    const part = match("snd", [row("Alex", "w", { k: 2.4, d: -3, dd: 12.345, dt: 1e12, x: { plants: 2, sneaky: 9, bestRound: Number.NaN } })], {
      map: "bad map!",
      winner: "red",
    });
    const checked = checkMatchStats(part, snd);
    expect(checked).toEqual({
      ok: true,
      part: { ...part, map: "unknown", rows: [{ n: "Alex", r: "w", k: 2, d: 0, dd: 12.3, dt: 1_000_000, s: 60, bs: 0, x: { plants: 2 } }] },
    });
  });

  it.each([
    ["another game", match("snd", [row("A", "w")]), /not this session's game/],
    ["a match id from another session", match("sumo", [row("A", "w")], { matchId: "other.1" }), /is not from session/],
    ["a part past the count", match("sumo", [row("A", "w")], { part: 3, parts: 2 }), /bad part/],
    ["an unknown mode", match("sumo", [row("A", "w")], { mode: "ffa" as never }), /bad mode/],
    ["no rows", match("sumo", []), /expected 1 to 16 rows/],
    ["17 rows", match("sumo", Array.from({ length: 17 }, (_, i) => row(`P${i}`, "l"))), /expected 1 to 16 rows/],
    ["a player twice", match("sumo", [row("Alex", "w"), row("ALEX", "l")]), /appears twice/],
    ["a bad result", match("sumo", [row("A", "x" as never)]), /bad result/],
    ["a missing number", match("sumo", [{ ...row("A", "w"), k: undefined as never }]), /bad number/],
    ["an infinite number", match("sumo", [row("A", "w", { dd: Number.POSITIVE_INFINITY })]), /bad number/],
    ["a control character in a name", match("sumo", [row("A\u0007", "w")]), /bad player name/],
  ])("rejects %s", (_name, part, reason) => {
    const checked = checkMatchStats(part, sumo);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.reason).toMatch(reason);
  });
});

describe("answerStatsQuery", () => {
  const query = { t: "stats_query" as const, requestId: "q1", player: "alex" };

  it("answers unavailable without storage, and none for an unknown player or game", () => {
    expect(answerStatsQuery(undefined, query)).toEqual({ t: "stats_reply", requestId: "q1", player: "alex", status: "unavailable" });
    const store = memoryStore();
    expect(answerStatsQuery(store, query).status).toBe("none");
    store.record(match("sumo", [row("Alex", "w"), row("Kai", "l")]), noXuids);
    expect(answerStatsQuery(store, { ...query, game: "snd" }).status).toBe("none");
  });

  it("gives overall totals and the games played, most played first, then one game with its extras", () => {
    const store = memoryStore();
    store.record(match("snd", [row("Alex", "w", { x: { plants: 1 } }), row("Kai", "l")]), noXuids);
    store.record(match("sumo", [row("Alex", "w", { k: 2 }), row("Kai", "l")]), noXuids);
    store.record(match("sumo", [row("Alex", "l"), row("Kai", "w")]), noXuids);
    const overall = answerStatsQuery(store, query);
    expect(overall).toMatchObject({ status: "ok", games: [{ id: "sumo", games: 2 }, { id: "snd", games: 1 }] });
    expect(overall.totals).toMatchObject({ games: 3, wins: 2, kills: 2 });
    expect(overall.totals).not.toHaveProperty("kd");
    expect(answerStatsQuery(store, { ...query, game: "snd" }).totals).toMatchObject({ games: 1, extras: { plants: 1 } });
  });

  it("fits 11 games easily, and trims the least played when there are far too many", () => {
    const line = { games: 1, wins: 1, losses: 0, draws: 0, kills: 9, deaths: 9, dealt: 999.9, taken: 999.9, seconds: 9999, bestStreak: 9, left: 0, kd: 1, winRate: 100 };
    const summaryWith = (count: number): PlayerSummary => ({
      name: "Alex",
      lastSeen: 0,
      overall: line,
      games: Object.fromEntries(Array.from({ length: count }, (_, i) => [`game_with_a_long_identifier_${String(i).padStart(3, "0")}`, { ...line, games: count - i }])),
    });
    const stub = (count: number) => ({ summary: () => summaryWith(count) }) as unknown as StatsStore;
    expect(answerStatsQuery(stub(11), query).games).toHaveLength(11);
    const trimmed = answerStatsQuery(stub(100), query);
    expect(trimmed.games!.length).toBeLessThan(100);
    expect(trimmed.games![0]).toEqual({ id: "game_with_a_long_identifier_000", games: 100 });
    expect(JSON.stringify(trimmed).length).toBeLessThanOrEqual(1800);
  });

  it("answers unavailable when the database fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { summary: () => { throw new Error("disk I/O error"); } } as unknown as StatsStore;
    expect(answerStatsQuery(broken, query).status).toBe("unavailable");
    vi.restoreAllMocks();
  });
});
