// What the hologram shows, as plain data: one of two frames (the user's art), a title, text
// lines, and on the game screen a 16:9 picture. The terminal builds this for each screen;
// hologram.ts draws it on all four sides. Highlights are text colors ("tones"), so no screen needs
// a picture of its own.
import { gamePicture, mapOptions, playerRange, settingLabel, settingsFor } from "./game-screen.ts";
import type { GameChoice } from "./lobby-controller.ts";
import type { GameView } from "./menus.ts";

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

/** Keeps the lines that fit; the last one says how many more there are. */
export function fit(lines: HoloLine[], max: number): HoloLine[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), line(`and ${lines.length - max + 1} more`, "dim")];
}
