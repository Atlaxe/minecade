// What the hologram shows, as plain data: one of two frames (the user's art), a title, text
// lines, and on the game screen a 16:9 picture. The terminal builds this for each screen;
// hologram.ts draws it on all four sides. Highlights are text colors ("tones"), so no screen needs
// a picture of its own.
import { killDeathRatio, ordinal, winRate, type StatsTotals } from "@minecade/minigame-core";
import { gamePicture, mapOptions, playerRange, settingLabel, settingsFor } from "./game-screen.ts";
import type { GameChoice } from "./lobby-controller.ts";
import type { GameView } from "./menus.ts";
import type { TeamPickView } from "./team-pick-controller.ts";

/** "logo": the logo up top, room below (idle and main). "panel": everything else. */
export type Frame = "logo" | "panel";
export type Tone = "title" | "normal" | "highlight" | "dim" | "warn";

export interface HoloLine {
  text: string;
  tone: Tone;
  /** A § color code (a team's color) instead of the tone's color. */
  color?: string;
}

export interface HoloContent {
  frame: Frame;
  title?: string;
  lines: HoloLine[];
  /** A texture path (a game's picture or a map's preview), shown under the title. */
  picture?: string;
}

/** Lines that fit under the title (fewer under a picture). */
export const MAX_LINES = 6;
export const MAX_LINES_WITH_PICTURE = 4;

const line = (text: string, tone: Tone = "normal"): HoloLine => ({ text, tone });

export function idleContent(): HoloContent {
  return { frame: "logo", lines: [line("Tap the terminal")] };
}

/** Play and Stats, the chosen one highlighted. */
export function mainContent(chosen?: "play" | "stats"): HoloContent {
  return {
    frame: "logo",
    lines: [line("Play", chosen === "play" ? "highlight" : "normal"), line("Stats", chosen === "stats" ? "highlight" : "normal")],
  };
}

/** The games, dimmed when there aren't enough players for them. */
export function gamesContent(choices: GameChoice[]): HoloContent {
  return { frame: "panel", title: "Choose a game", lines: fit(choices.map(({ game, playable }) => line(game.name, playable ? "normal" : "dim")), MAX_LINES) };
}

/**
 * One game: the chosen map's preview (the game's picture while the map is random), the map, its
 * settings, and the players it needs.
 */
export function gameContent(view: GameView): HoloContent {
  const { game, playable, reason } = view.choice;
  const map = view.random ? undefined : mapOptions(game).find((option) => option.id === view.map);
  const lines = [
    line(`Map: ${map?.name ?? "Random"}`, "highlight"),
    ...settingsFor(game).map((setting) => line(`${setting.label}: ${settingLabel(setting, view.settings[setting.id])}`)),
    playable ? line(playerRange(game), "dim") : line(`Needs ${reason?.replace(/^needs at least /, "") ?? "more players"}`, "warn"),
  ];
  return { frame: "panel", title: game.name, picture: map?.preview ?? gamePicture(game), lines: fit(lines, MAX_LINES_WITH_PICTURE) };
}

/** Team picking: each team and its players in the team's color, who's still random, and when teams lock. */
export function teamsContent(view: TeamPickView): HoloContent {
  const teams = view.teams.map((team): HoloLine => ({ text: `${team.name}: ${names(team.members)}`, tone: "normal", color: team.color }));
  if (view.unpicked.length > 0) teams.push(line(`Random: ${names(view.unpicked)}`, "dim"));
  return { frame: "panel", title: view.game, lines: [...fit(teams, MAX_LINES - 1), line(view.status, "highlight")] };
}

/** The stats list is open. */
export function statsListContent(players: number): HoloContent {
  return { frame: "panel", title: "Stats", lines: [line("Pick a player"), line(`${players} ${players === 1 ? "player" : "players"}`, "dim")] };
}

/** A player's stats as someone browses them: the open tab, their rank and the key numbers. */
export function statsContent(player: string, tab: string, totals: StatsTotals | undefined, placement?: { rank: number; of: number }): HoloContent {
  if (!totals || totals.games === 0) return { frame: "panel", title: player, lines: [line(tab, "highlight"), line("No stats yet", "dim")] };
  return {
    frame: "panel",
    title: player,
    lines: [
      line(tab, "highlight"),
      ...(placement ? [line(`Rank ${ordinal(placement.rank)} of ${placement.of}`)] : []),
      line(`Wins ${totals.wins} of ${totals.games} ${totals.games === 1 ? "game" : "games"}`),
      line(`Win rate ${winRate(totals.wins, totals.games)}%`),
      line(`K/D ${killDeathRatio(totals.kills, totals.deaths)}`),
    ],
  };
}

/** Up to three names, then how many more: "Steve, Alex, Bob +2". */
function names(list: string[]): string {
  if (list.length === 0) return "-";
  return list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} +${list.length - 3}`;
}

/** Keeps the lines that fit; the last one says how many more there are. */
export function fit(lines: HoloLine[], max: number): HoloLine[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), line(`and ${lines.length - max + 1} more`, "dim")];
}
