// The stats screens' model, as plain data: the players list (the viewer first), one player's
// screen (a portrait, a tab per view: Global and each game played, the rank, and the stats in
// three columns), and the letter badges that stand in for player heads until skins can be shown
// (docs/skins.md). The forms (menus.ts), the hologram (holo-content.ts) and the stats controller
// share it.
import { killDeathRatio, ordinal, winRate, type StatsTotals } from "@minecade/minigame-core";

// Badges are shared with the hologram's portrait list (holoPortraits), so they live in minigame-core.
export { badgeFor } from "@minecade/minigame-core";

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

export interface StatTile {
  label: string;
  value: string;
}

/** The three stat columns' headings. */
export const STAT_COLUMNS = ["Results", "Combat", "More"] as const;

export interface StatsView {
  player: string;
  /** Global first, then the games played, most played first. */
  tabs: StatsTab[];
  /** The open tab's id. */
  tab: string;
  /** The rank line, or why there are no stats. */
  body: string;
  /** The open tab's stats in three columns (STAT_COLUMNS); empty without stats. */
  columns: StatTile[][];
  placement?: Placement;
}

export type StatsButton = { kind: "portrait" } | { kind: "tab"; tab: StatsTab } | { kind: "stat"; column: number; stat: StatTile };

/** The player's screen buttons, in form order: the portrait, the tabs, then the stat tiles (shown, not clicked). */
export function statsButtons(view: StatsView): StatsButton[] {
  return [
    { kind: "portrait" as const },
    ...view.tabs.map((tab) => ({ kind: "tab" as const, tab })),
    ...view.columns.flatMap((stats, column) => stats.map((stat) => ({ kind: "stat" as const, column, stat }))),
  ];
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

/** A tab's headline: the player's rank there, or why there are no stats. */
export function statsBody(totals: StatsTotals | undefined, placement?: Placement): string {
  if (!totals || totals.games === 0) return "No stats yet.\nMatches with at least 2 players count.";
  return placement ? `Rank: ${ordinal(placement.rank)} of ${placement.of}` : "";
}

/**
 * A tab's stats in three columns: Results (games, wins, losses, draws, win rate), Combat (kills,
 * deaths, K/D, best streak) and More (damage, time played, matches left, the game's own counters).
 * Draws and matches left only show when there are some. Empty without stats.
 */
export function statColumns(totals: StatsTotals | undefined, extras: [key: string, label: string][] = []): StatTile[][] {
  if (!totals || totals.games === 0) return [];
  const tile = (label: string, value: string | number): StatTile => ({ label, value: String(value) });
  return [
    [
      tile("Games", totals.games),
      tile("Wins", totals.wins),
      tile("Losses", totals.losses),
      ...(totals.draws > 0 ? [tile("Draws", totals.draws)] : []),
      tile("Win rate", `${winRate(totals.wins, totals.games)}%`),
    ],
    [tile("Kills", totals.kills), tile("Deaths", totals.deaths), tile("K/D", killDeathRatio(totals.kills, totals.deaths)), tile("Best streak", totals.bestStreak)],
    [
      tile("Damage dealt", totals.dealt),
      tile("Damage taken", totals.taken),
      tile("Time played", formatDuration(totals.seconds)),
      ...(totals.left > 0 ? [tile("Left early", totals.left)] : []),
      ...extras.map(([key, label]) => tile(label, totals.extras?.[key] ?? 0)),
    ],
  ];
}

/** "45s", "12m" or "1h 05m". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
