// Per-player match stats: kills, deaths, damage, time played, streaks and game extras. Pure:
// the game feeds it events, and at the end it produces StatsRow lines split into parts that fit
// the message size limit.
import type { StatsConfig } from "../config.ts";
import { encodeMessage, type MatchStats, type StatsRow } from "../protocol/index.ts";
import type { Result } from "./results.ts";

interface Line {
  name: string;
  team?: string;
  kills: number;
  deaths: number;
  dealt: number;
  taken: number;
  streak: number;
  bestStreak: number;
  joinedTick: number;
  playedTicks: number;
  left: boolean;
  extras: Record<string, number>;
}

export class StatsRecorder {
  private readonly lines = new Map<string, Line>();
  private readonly config: StatsConfig | undefined;

  constructor(config: StatsConfig | undefined) {
    this.config = config;
  }

  /** A player joins the match (again, after leaving). */
  join(name: string, tick: number, team?: string): void {
    const line = this.line(name);
    line.team = team ?? line.team;
    line.joinedTick = tick;
    line.left = false;
  }

  leave(name: string, tick: number): void {
    const line = this.lines.get(name.toLowerCase());
    if (!line || line.left) return;
    line.playedTicks += tick - line.joinedTick;
    line.left = true;
  }

  kill(name: string): void {
    const line = this.line(name);
    line.kills++;
    line.streak++;
    line.bestStreak = Math.max(line.bestStreak, line.streak);
  }

  death(name: string): void {
    const line = this.line(name);
    line.deaths++;
    line.streak = 0;
  }

  /** `amount` is in health points, already capped at what the victim could lose. */
  damage(victim: string, amount: number, attacker?: string): void {
    if (amount <= 0) return;
    this.line(victim).taken += amount;
    if (attacker && attacker.toLowerCase() !== victim.toLowerCase()) this.line(attacker).dealt += amount;
  }

  /** Adds to a game extra, or keeps the maximum for extras declared with agg "max". */
  extra(name: string, key: string, value: number): void {
    const extras = this.line(name).extras;
    const agg = this.config?.extras?.find((extra) => extra.key === key)?.agg ?? "sum";
    extras[key] = agg === "max" ? Math.max(extras[key] ?? 0, value) : (extras[key] ?? 0) + value;
  }

  get(name: string): Readonly<Line> | undefined {
    return this.lines.get(name.toLowerCase());
  }

  /** One row per player who took part, with their result. */
  rows(result: Result, endTick: number): StatsRow[] {
    return [...this.lines.values()].map((line) => {
      const played = line.playedTicks + (line.left ? 0 : endTick - line.joinedTick);
      const row: StatsRow = {
        n: line.name,
        r: outcome(line, result),
        k: line.kills,
        d: line.deaths,
        dd: round1(line.dealt),
        dt: round1(line.taken),
        s: Math.round(played / 20),
        bs: line.bestStreak,
      };
      if (line.team) row.tm = line.team;
      if (line.left) row.q = 1;
      if (Object.keys(line.extras).length > 0) row.x = { ...line.extras };
      return row;
    });
  }

  private line(name: string): Line {
    const key = name.toLowerCase();
    let line = this.lines.get(key);
    if (!line) {
      line = { name, kills: 0, deaths: 0, dealt: 0, taken: 0, streak: 0, bestStreak: 0, joinedTick: 0, playedTicks: 0, left: false, extras: {} };
      this.lines.set(key, line);
    }
    return line;
  }
}

/** Win, loss or draw for one player. Leavers lose; a winning team's eliminated members still win. */
function outcome(line: Line, result: Result): "w" | "l" | "d" {
  if (line.left && result.kind !== "draw") return "l";
  switch (result.kind) {
    case "win":
      if (result.team !== undefined) return line.team === result.team ? "w" : "l";
      if (!result.players.some((name) => name.toLowerCase() === line.name.toLowerCase())) return "l";
      // Players sharing a win (a tie for first) draw.
      return result.players.length > 1 ? "d" : "w";
    case "coop":
      return result.won ? "w" : "l";
    default:
      return "d";
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Splits a match's rows into as many parts as needed to keep each message within the size
 * limit. Every part repeats the header, so each one can be stored on its own.
 */
export function packStatsParts(header: Omit<MatchStats, "t" | "part" | "parts" | "rows">, rows: StatsRow[]): MatchStats[] {
  const groups: StatsRow[][] = [];
  let current: StatsRow[] = [];
  const fits = (candidate: StatsRow[]) => {
    try {
      encodeMessage({ t: "match_stats", ...header, part: 99, parts: 99, rows: candidate });
      return true;
    } catch {
      return false;
    }
  };
  for (const row of rows) {
    if (fits([...current, row])) {
      current.push(row);
      continue;
    }
    if (current.length > 0) groups.push(current);
    // A single row too large for a message: drop its extras rather than lose the row.
    const { x: _extras, ...plain } = row;
    current = fits([row]) ? [row] : [plain];
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);
  return groups.map((group, i) => ({ t: "match_stats", ...header, part: i + 1, parts: groups.length, rows: group }));
}
