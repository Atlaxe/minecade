// The stats screens' model, as plain data: the players list (the viewer first), one player's
// screen (a portrait, then a tab per view: Global and each game played), the text each tab shows,
// and the letter badges that stand in for player heads until skins can be shown (docs/skins.md).
// The forms (menus.ts) and the stats controller share it.
import { killDeathRatio, ordinal, winRate, type StatsTotals } from "@minecade/minigame-core";

const BADGE_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A player's badge in the lobby resource pack: their name's first letter or digit, or "other". */
export function badgeFor(name: string): string {
  const first = name.trim().charAt(0).toLowerCase();
  return `textures/minecade/badges/${first && BADGE_CHARACTERS.includes(first) ? first : "other"}`;
}

export interface PlayersView {
  viewer: string;
  /** The viewer first, then everyone with stats by name. */
  players: string[];
  /** Players left out to fit the orchestrator's reply. */
  more: number;
}

/** The viewer is always listed (even without stats yet), first. */
export function playersView(viewer: string, names: readonly string[], more = 0): PlayersView {
  const others = names.filter((name) => name.toLowerCase() !== viewer.toLowerCase());
  return { viewer, players: [viewer, ...others], more };
}

export interface StatsTab {
  /** "global", or a game id. */
  id: string;
  name: string;
}

export const GLOBAL_TAB: StatsTab = { id: "global", name: "Global" };

export interface StatsView {
  player: string;
  /** Global first, then the games played, most played first. */
  tabs: StatsTab[];
  /** The open tab's id. */
  tab: string;
  body: string;
}

/** The player's screen buttons, in form order: the portrait, then the tabs. */
export function statsButtons(view: StatsView): ({ kind: "portrait" } | { kind: "tab"; tab: StatsTab })[] {
  return [{ kind: "portrait" as const }, ...view.tabs.map((tab) => ({ kind: "tab" as const, tab }))];
}

/** The tab the button at `selection` opens, if it's a tab. */
export function statsTabAt(view: StatsView, selection: number): StatsTab | undefined {
  const button = statsButtons(view)[selection];
  return button?.kind === "tab" ? button.tab : undefined;
}

export interface Placement {
  rank: number;
  of: number;
}

/** A tab's text: the player's rank, then their totals, then any of the game's own counters. */
export function statsBody(totals: StatsTotals | undefined, placement?: Placement, extras: [key: string, label: string][] = []): string {
  if (!totals || totals.games === 0) return "No stats yet.\nMatches with at least 2 players count.";
  const rank = placement ? [`Rank: ${ordinal(placement.rank)} of ${placement.of}`, ""] : [];
  return [...rank, describe(totals, extras)].join("\n");
}

/** The totals as text, plus any of the game's own counters. */
export function describe(totals: StatsTotals, extras: [key: string, label: string][] = []): string {
  const lines = [
    `Games: ${totals.games}   Wins: ${totals.wins}   Losses: ${totals.losses}${totals.draws > 0 ? `   Draws: ${totals.draws}` : ""}`,
    `Win rate: ${winRate(totals.wins, totals.games)}%`,
    `Kills: ${totals.kills}   Deaths: ${totals.deaths}   K/D: ${killDeathRatio(totals.kills, totals.deaths)}`,
    `Damage dealt: ${totals.dealt}   Damage taken: ${totals.taken}`,
    `Best kill streak: ${totals.bestStreak}   Time played: ${formatDuration(totals.seconds)}`,
  ];
  if (totals.left > 0) lines.push(`Left early: ${totals.left}`);
  for (const [key, label] of extras) lines.push(`${label}: ${totals.extras?.[key] ?? 0}`);
  return lines.join("\n");
}

/** "45s", "12m" or "1h 05m". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
