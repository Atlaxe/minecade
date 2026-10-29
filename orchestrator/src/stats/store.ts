// Player stats on disk, in node:sqlite under DATA_DIR (the minecade-data volume). Every new
// part is first appended to stats-events.jsonl, the raw record the database can be rebuilt
// from, then written in one transaction. Totals are computed when read, so changing a rule
// (what counts, how K/D works) needs no backfill.
//
// A player is their Xbox account (xuid) when the game's console showed it, otherwise their
// gamertag. Totals are grouped by current gamertag, so stats follow a gamertag change.
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { killDeathRatio, winRate, type Registry } from "@minecade/minigame-core/config";
import type { MatchStats, StatsTotals } from "@minecade/minigame-core/protocol";

const KEEP_BACKUPS = 14;
const RECENT_MATCHES = 20;
const BACKUP_FILE = /^stats-\d{8}-\d{6}\.db$/;

// Each entry upgrades the schema by one version (PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE players (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX players_by_name ON players (name COLLATE NOCASE);
  CREATE TABLE matches (
    match_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    game TEXT NOT NULL,
    map TEXT NOT NULL,
    mode TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    winner TEXT,
    parts INTEGER NOT NULL,
    ended_at INTEGER NOT NULL
  );
  CREATE TABLE match_parts (
    match_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (match_id, part)
  );
  CREATE TABLE match_players (
    match_id TEXT NOT NULL,
    player_key TEXT NOT NULL,
    name TEXT NOT NULL,
    result TEXT NOT NULL,
    team TEXT,
    kills INTEGER NOT NULL,
    deaths INTEGER NOT NULL,
    damage_dealt REAL NOT NULL,
    damage_taken REAL NOT NULL,
    seconds INTEGER NOT NULL,
    best_streak INTEGER NOT NULL,
    left_early INTEGER NOT NULL,
    PRIMARY KEY (match_id, player_key)
  );
  CREATE INDEX match_players_by_player ON match_players (player_key);
  CREATE TABLE match_extras (
    match_id TEXT NOT NULL,
    player_key TEXT NOT NULL,
    key TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (match_id, player_key, key)
  );
  CREATE VIEW counted_matches AS
    SELECT match_id FROM matches m
    WHERE m.mode = 'coop' OR (SELECT count(*) FROM match_players p WHERE p.match_id = m.match_id) >= 2;
  `,
];

/** Totals plus the derived ratios, as the API and panel show them. */
export interface StatsLine extends StatsTotals {
  kd: number;
  /** Percent, to 1 decimal. */
  winRate: number;
}

export interface PlayerSummary {
  name: string;
  lastSeen: number;
  /** Solo and team games only; co-op results show up per game. */
  overall: StatsLine;
  /** By game id, for every game with matches that count. */
  games: Record<string, StatsLine>;
}

export interface RecentMatch {
  matchId: string;
  game: string;
  map: string;
  mode: string;
  endedAt: number;
  durationSec: number;
  /** False for matches that don't count toward totals (solo test runs). */
  counted: boolean;
  result: "w" | "l" | "d";
  team?: string;
  kills: number;
  deaths: number;
  dealt: number;
  taken: number;
  seconds: number;
  left: boolean;
}

export interface PlayerDetail extends PlayerSummary {
  recent: RecentMatch[];
}

export interface StatsOverview {
  games: { id: string; name: string; mode?: string; extras: { key: string; label: string }[] }[];
  players: PlayerSummary[];
}

export interface StoreOptions {
  registry: Registry;
  /** Append-only raw log of every stored part. */
  eventsFile?: string;
  backupDir?: string;
  now?: () => number;
}

interface TotalsRow {
  who: string;
  game: string;
  mode: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  kills: number;
  deaths: number;
  dealt: number;
  taken: number;
  seconds: number;
  bestStreak: number;
  left: number;
}

const TOTALS_SQL = `
  SELECT lower(p.name) AS who, m.game AS game, m.mode AS mode,
    count(*) AS games,
    sum(mp.result = 'w') AS wins, sum(mp.result = 'l') AS losses, sum(mp.result = 'd') AS draws,
    sum(mp.kills) AS kills, sum(mp.deaths) AS deaths,
    sum(mp.damage_dealt) AS dealt, sum(mp.damage_taken) AS taken,
    sum(mp.seconds) AS seconds, max(mp.best_streak) AS bestStreak, sum(mp.left_early) AS left
  FROM match_players mp
  JOIN matches m ON m.match_id = mp.match_id
  JOIN players p ON p.key = mp.player_key
  WHERE mp.match_id IN (SELECT match_id FROM counted_matches) AND (:who IS NULL OR lower(p.name) = :who)
  GROUP BY who, m.game, m.mode`;

const EXTRAS_SQL = `
  SELECT lower(p.name) AS who, m.game AS game, e.key AS key, sum(e.value) AS total, max(e.value) AS best
  FROM match_extras e
  JOIN matches m ON m.match_id = e.match_id
  JOIN players p ON p.key = e.player_key
  WHERE e.match_id IN (SELECT match_id FROM counted_matches) AND (:who IS NULL OR lower(p.name) = :who)
  GROUP BY who, m.game, e.key`;

export class StatsStore {
  private readonly db: DatabaseSync;
  private readonly options: StoreOptions;
  private readonly now: () => number;

  /** Opens (or creates) stats.db in `dir`, with its raw log and backups beside it. */
  static open(dir: string, registry: Registry): StatsStore {
    mkdirSync(join(dir, "backups"), { recursive: true });
    const db = new DatabaseSync(join(dir, "stats.db"));
    try {
      db.exec("PRAGMA journal_mode = WAL");
      return new StatsStore(db, { registry, eventsFile: join(dir, "stats-events.jsonl"), backupDir: join(dir, "backups") });
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /** Brings the schema up to date. Throws for a database from a newer orchestrator. */
  constructor(db: DatabaseSync, options: StoreOptions) {
    this.db = db;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.migrate();
  }

  get schemaVersion(): number {
    return (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  }

  /** Stores one checked part. A part already stored (a retried send) changes nothing. */
  record(part: MatchStats, xuids: ReadonlyMap<string, string>): "stored" | "duplicate" {
    if (this.db.prepare("SELECT 1 FROM match_parts WHERE match_id = ? AND part = ?").get(part.matchId, part.part)) return "duplicate";
    const now = this.now();
    const keys = new Map(part.rows.map((row) => [row.n, playerKey(row.n, xuids)]));
    if (this.options.eventsFile) {
      appendFileSync(this.options.eventsFile, `${JSON.stringify({ at: new Date(now).toISOString(), keys: Object.fromEntries(keys), part })}\n`);
    }
    this.transaction(() => {
      this.db.prepare("INSERT INTO match_parts (match_id, part, received_at) VALUES (?, ?, ?)").run(part.matchId, part.part, now);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO matches (match_id, session_id, game, map, mode, duration_sec, winner, parts, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(part.matchId, part.sessionId, part.game, part.map, part.mode, part.durationSec, part.winner ?? null, part.parts, now);
      const player = this.db.prepare(
        `INSERT INTO players (key, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`,
      );
      const line = this.db.prepare(
        `INSERT OR IGNORE INTO match_players
           (match_id, player_key, name, result, team, kills, deaths, damage_dealt, damage_taken, seconds, best_streak, left_early)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const extra = this.db.prepare("INSERT OR IGNORE INTO match_extras (match_id, player_key, key, value) VALUES (?, ?, ?, ?)");
      for (const row of part.rows) {
        const key = keys.get(row.n)!;
        player.run(key, row.n, now, now);
        line.run(part.matchId, key, row.n, row.r, row.tm ?? null, row.k, row.d, row.dd, row.dt, row.s, row.bs, row.q ? 1 : 0);
        for (const [name, value] of Object.entries(row.x ?? {})) extra.run(part.matchId, key, name, value);
      }
    });
    return "stored";
  }

  /** Everyone's totals, overall and per game, sorted by name. */
  overview(): StatsOverview {
    const names = this.names();
    const summaries = this.summaries(null, names);
    const played = new Set(summaries.flatMap((summary) => Object.keys(summary.games)));
    const games = this.options.registry.games
      .filter((game) => game.stats || played.has(game.id))
      .map((game) => ({
        id: game.id,
        name: game.name,
        ...(game.stats ? { mode: game.stats.mode } : {}),
        extras: (game.stats?.extras ?? []).map(({ key, label }) => ({ key, label })),
      }));
    return { games, players: summaries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })) };
  }

  /** One player's totals by gamertag (any case), or undefined if they've never been recorded. */
  summary(name: string): PlayerSummary | undefined {
    const who = name.toLowerCase();
    const names = this.names(who);
    if (!names.has(who)) return undefined;
    return this.summaries(who, names)[0] ?? { ...names.get(who)!, overall: line(empty()), games: {} };
  }

  /** summary() plus the player's latest matches, including ones that don't count. */
  player(name: string): PlayerDetail | undefined {
    const summary = this.summary(name);
    if (!summary) return undefined;
    const rows = this.db
      .prepare(
        `SELECT m.match_id AS matchId, m.game AS game, m.map AS map, m.mode AS mode, m.ended_at AS endedAt,
           m.duration_sec AS durationSec, (m.match_id IN (SELECT match_id FROM counted_matches)) AS counted,
           mp.result AS result, mp.team AS team, mp.kills AS kills, mp.deaths AS deaths, mp.damage_dealt AS dealt,
           mp.damage_taken AS taken, mp.seconds AS seconds, mp.left_early AS left
         FROM match_players mp
         JOIN matches m ON m.match_id = mp.match_id
         JOIN players p ON p.key = mp.player_key
         WHERE lower(p.name) = ?
         ORDER BY m.ended_at DESC, m.match_id DESC
         LIMIT ${RECENT_MATCHES}`,
      )
      .all(name.toLowerCase()) as unknown as (Omit<RecentMatch, "counted" | "left" | "team"> & { counted: number; left: number; team: string | null })[];
    const recent = rows.map(({ team, counted, left, ...match }) => ({
      ...match,
      ...(team === null ? {} : { team }),
      counted: counted === 1,
      left: left === 1,
    }));
    return { ...summary, recent };
  }

  /** Copies the database to backups/stats-<date>-<time>.db and keeps the newest 14. */
  backup(): string | undefined {
    const dir = this.options.backupDir;
    if (!dir) return undefined;
    const stamp = new Date(this.now()).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const file = join(dir, `stats-${stamp}.db`);
    if (!existsSync(file)) this.db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    const backups = readdirSync(dir).filter((name) => BACKUP_FILE.test(name)).sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) rmSync(join(dir, old), { force: true });
    return file;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const version = this.schemaVersion;
    if (version > MIGRATIONS.length) {
      throw new Error(`stats.db has schema version ${version}, newer than this orchestrator knows (${MIGRATIONS.length})`);
    }
    for (let next = version; next < MIGRATIONS.length; next++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[next]);
        this.db.exec(`PRAGMA user_version = ${next + 1}`);
      });
    }
  }

  private transaction(body: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      body();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Lowercase gamertag to the latest spelling and when it was last seen. */
  private names(who: string | null = null): Map<string, { name: string; lastSeen: number }> {
    const rows = this.db
      .prepare("SELECT lower(name) AS who, name, last_seen AS lastSeen FROM players WHERE :who IS NULL OR lower(name) = :who ORDER BY last_seen")
      .all({ who }) as unknown as { who: string; name: string; lastSeen: number }[];
    return new Map(rows.map(({ who: key, name, lastSeen }) => [key, { name, lastSeen }]));
  }

  private summaries(who: string | null, names: Map<string, { name: string; lastSeen: number }>): PlayerSummary[] {
    const totals = this.db.prepare(TOTALS_SQL).all({ who }) as unknown as TotalsRow[];
    const extras = this.db.prepare(EXTRAS_SQL).all({ who }) as unknown as { who: string; game: string; key: string; total: number; best: number }[];
    const byPlayer = new Map<string, { overall: StatsTotals; games: Map<string, StatsTotals> }>();
    for (const row of totals) {
      let entry = byPlayer.get(row.who);
      if (!entry) byPlayer.set(row.who, (entry = { overall: empty(), games: new Map() }));
      let game = entry.games.get(row.game);
      if (!game) entry.games.set(row.game, (game = empty()));
      add(game, row);
      if (row.mode !== "coop") add(entry.overall, row);
    }
    for (const row of extras) {
      const declared = this.options.registry.games.find((game) => game.id === row.game)?.stats?.extras?.find((extra) => extra.key === row.key);
      const totalsForGame = byPlayer.get(row.who)?.games.get(row.game);
      if (!declared || !totalsForGame) continue;
      (totalsForGame.extras ??= {})[row.key] = round1(declared.agg === "max" ? row.best : row.total);
    }
    return [...byPlayer].map(([key, entry]) => ({
      name: names.get(key)?.name ?? key,
      lastSeen: names.get(key)?.lastSeen ?? 0,
      overall: line(entry.overall),
      games: Object.fromEntries([...entry.games].map(([game, totalsForGame]) => [game, line(totalsForGame)])),
    }));
  }
}

function playerKey(name: string, xuids: ReadonlyMap<string, string>): string {
  const xuid = xuids.get(name.toLowerCase());
  return xuid ? `xuid:${xuid}` : `name:${name.toLowerCase()}`;
}

function empty(): StatsTotals {
  return { games: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, dealt: 0, taken: 0, seconds: 0, bestStreak: 0, left: 0 };
}

function add(totals: StatsTotals, row: TotalsRow): void {
  totals.games += row.games;
  totals.wins += row.wins;
  totals.losses += row.losses;
  totals.draws += row.draws;
  totals.kills += row.kills;
  totals.deaths += row.deaths;
  totals.dealt = round1(totals.dealt + row.dealt);
  totals.taken = round1(totals.taken + row.taken);
  totals.seconds += row.seconds;
  totals.bestStreak = Math.max(totals.bestStreak, row.bestStreak);
  totals.left += row.left;
}

function line(totals: StatsTotals): StatsLine {
  return { ...totals, kd: killDeathRatio(totals.kills, totals.deaths), winRate: winRate(totals.wins, totals.games) };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
