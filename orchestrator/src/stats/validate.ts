// Checks a match_stats part before it's stored. Games are our own code, but a buggy game or a
// hand-made POST to the link route must not put nonsense in the database.
import type { MatchStats, StatsRow } from "@minecade/minigame-core/protocol";
import type { RegistryGame } from "../registry.ts";

const MAX_PARTS = 16;
const MAX_ROWS = 16;
/** Caps every counter, so one bad value can't swamp everyone's totals. */
const MAX_VALUE = 1_000_000;
const ID = /^[A-Za-z0-9._:-]{1,64}$/;
// Gamertags are up to 16 characters (32 leaves room); no control characters.
const NAME = /^[^\u0000-\u001f]{1,32}$/;
const MODES: ReadonlySet<string> = new Set<MatchStats["mode"]>(["solo", "team", "coop"]);

export type Checked = { ok: true; part: MatchStats } | { ok: false; reason: string };

/** Returns a clean copy of the part: numbers rounded and clamped, unknown extras dropped. */
export function checkMatchStats(event: MatchStats, game: RegistryGame): Checked {
  if (event.game !== game.id) return fail(`game "${event.game}" is not this session's game (${game.id})`);
  if (typeof event.sessionId !== "string" || typeof event.matchId !== "string" || !ID.test(event.matchId)) {
    return fail("bad matchId");
  }
  if (!event.matchId.startsWith(`${event.sessionId}.`)) return fail(`matchId ${event.matchId} is not from session ${event.sessionId}`);
  if (!Number.isInteger(event.parts) || event.parts < 1 || event.parts > MAX_PARTS) return fail("bad parts");
  if (!Number.isInteger(event.part) || event.part < 1 || event.part > event.parts) return fail("bad part");
  if (!MODES.has(event.mode)) return fail(`bad mode "${String(event.mode)}"`);
  if (!Array.isArray(event.rows) || event.rows.length === 0 || event.rows.length > MAX_ROWS) {
    return fail(`expected 1 to ${MAX_ROWS} rows`);
  }

  const allowedExtras = new Set((game.stats?.extras ?? []).map((extra) => extra.key));
  const seen = new Set<string>();
  const rows: StatsRow[] = [];
  for (const raw of event.rows as unknown[]) {
    if (typeof raw !== "object" || raw === null) return fail("a row is not an object");
    const row = raw as Partial<StatsRow>;
    if (typeof row.n !== "string" || !NAME.test(row.n)) return fail("a row has a bad player name");
    if (seen.has(row.n.toLowerCase())) return fail(`${row.n} appears twice`);
    seen.add(row.n.toLowerCase());
    if (row.r !== "w" && row.r !== "l" && row.r !== "d") return fail(`${row.n} has a bad result`);
    const numbers = [row.k, row.d, row.dd, row.dt, row.s, row.bs];
    if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value))) return fail(`${row.n} has a bad number`);
    const clean: StatsRow = {
      n: row.n,
      r: row.r,
      k: count(row.k!),
      d: count(row.d!),
      dd: amount(row.dd!),
      dt: amount(row.dt!),
      s: count(row.s!),
      bs: count(row.bs!),
    };
    if (typeof row.tm === "string" && ID.test(row.tm)) clean.tm = row.tm;
    if (row.q) clean.q = 1;
    if (typeof row.x === "object" && row.x !== null) {
      const extras: Record<string, number> = {};
      for (const [key, value] of Object.entries(row.x)) {
        if (allowedExtras.has(key) && typeof value === "number" && Number.isFinite(value)) extras[key] = amount(value);
      }
      if (Object.keys(extras).length > 0) clean.x = extras;
    }
    rows.push(clean);
  }

  const part: MatchStats = {
    t: "match_stats",
    sessionId: event.sessionId,
    matchId: event.matchId,
    part: event.part,
    parts: event.parts,
    game: game.id,
    map: typeof event.map === "string" && ID.test(event.map) ? event.map : "unknown",
    mode: event.mode,
    durationSec: typeof event.durationSec === "number" && Number.isFinite(event.durationSec) ? count(event.durationSec) : 0,
    rows,
  };
  if (typeof event.winner === "string" && NAME.test(event.winner)) part.winner = event.winner;
  return { ok: true, part };
}

function fail(reason: string): Checked {
  return { ok: false, reason };
}

const count = (value: number) => Math.min(MAX_VALUE, Math.max(0, Math.round(value)));
const amount = (value: number) => Math.min(MAX_VALUE, Math.max(0, Math.round(value * 10) / 10));
