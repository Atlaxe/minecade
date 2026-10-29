// What the hologram shows, as plain data: one of two frames (the user's art), a title, text
// lines, and on the game screen the game's picture. The terminal builds this for each screen;
// hologram.ts draws it on all four sides. Highlights are text colors ("tones"), so no screen needs
// a picture of its own.
import { playerRange, settingLabel, settingsFor } from "./game-screen.ts";
import type { GameChoice } from "./lobby-controller.ts";

/** "logo": the logo up top, room below (idle and main). "panel": everything else. */
export type Frame = "logo" | "panel";
export type Tone = "title" | "normal" | "highlight" | "dim" | "warn";

export interface HoloLine {
  text: string;
  tone: Tone;
}

export interface HoloContent {
  frame: Frame;
  title?: string;
  lines: HoloLine[];
  /** A game id: its 16:9 picture shows under the title. */
  icon?: string;
}

/** Lines that fit under the title (fewer under a game's picture). */
export const MAX_LINES = 6;
export const MAX_LINES_WITH_ICON = 3;

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

/** One game: its picture, the chosen map, its settings, and the players it needs. */
export function gameContent(choice: GameChoice, mapName: string, settings: Record<string, string>): HoloContent {
  const { game, playable, reason } = choice;
  const lines = [
    line(`Map: ${mapName}`, "highlight"),
    ...settingsFor(game).map((setting) => line(`${setting.label}: ${settingLabel(setting, settings[setting.id])}`)),
    playable ? line(playerRange(game), "dim") : line(`Needs ${reason?.replace(/^needs at least /, "") ?? "more players"}`, "warn"),
  ];
  return { frame: "panel", title: game.name, icon: game.id, lines: fit(lines, MAX_LINES_WITH_ICON) };
}

/** Keeps the lines that fit; the last one says how many more there are. */
export function fit(lines: HoloLine[], max: number): HoloLine[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), line(`and ${lines.length - max + 1} more`, "dim")];
}
