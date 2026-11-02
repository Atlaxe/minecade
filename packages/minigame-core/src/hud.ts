// The HUD timer and countdown sounds, shared by games and the lobby.
//
// Timer: Bedrock has no script API for placing text on the HUD, so the clock rides on the action
// bar. A game sends HUD_MARK plus the clock and anything else ("Lives: 2"), and the core resource
// pack (packages/minigame-core/resource_pack/ui/hud_screen.json) shows marked lines in a box top
// right with a clock icon. The mark is formatting codes, which never render, so the box shows the
// line as is, and without the pack the action bar simply reads "2:53   Lives: 2".
//
// Own score: a game whose scoring shows "own" also shows each player their score in a box of its
// own left of the clock, with a skull. JSON UI can't cut text out of the action bar, so the number
// rides at the end of the line as formatting codes too (countCodes), and the pack shows the digit
// whose code it finds in each place.
//
// Best-of rounds: a game played in best-of rounds shows them in a box of their own, left of the
// others, the same way (bestOfCodes): a circle per round colored by its winner, or each side's round
// wins in its color ("R | B"). The pack's controls for them are generated from these codes
// (tools/assets/rounds-hud.ts writes ui/minecade_rounds.json).
import type { Player } from "@minecraft/server";

/** Starts every action bar line that carries the clock. Must match the core pack's hud_screen.json. */
export const HUD_MARK = "§r§m§c§r";

/**
 * Starts a title that shows in the map editor's mode box top center instead of as a title: the
 * editor's servers, and a game previewed from the editor, carry the override
 * (editor/resource_pack/ui/hud_screen.json, which must use the same mark).
 */
export const MODE_MARK = "§r§m§o§r";

/** The mode box's line in a game previewed from the map editor: "Preview   Sumo: Arena". */
export function previewLine(label: string): string {
  return `${MODE_MARK}§dPreview${label ? `§7   ${label}` : ""}`;
}
const URGENT_SECONDS = 30;

/** Each place of the own score's number (hundreds, tens, units) as codes, before the digit's code. Must match hud_screen.json. */
export const COUNT_PLACES = ["§k§h", "§k§t", "§k§u"] as const;
/** The highest own score the HUD shows. */
export const MAX_COUNT = 999;

/** With no clock, the clock's box drops its icon (and shows the rest of the line) or, with nothing to show, goes. Must match hud_screen.json. */
export const NO_CLOCK = "§k§o";
export const EMPTY_CLOCK_BOX = "§k§v";

/**
 * The action bar text for a stage clock (white, red in the last 30 seconds) plus the usual line,
 * the player's own score when `count` is given, and best-of rounds when `rounds` (bestOfCodes) is
 * (the pack shows each in its own box). Without a clock, it's just the line, unless there are
 * rounds to show.
 */
export function hudLine(secondsLeft: number | undefined, rest = "", count?: number, rounds = ""): string {
  const codes = `${count === undefined ? "" : countCodes(count)}${rounds}`;
  if (secondsLeft === undefined) {
    if (!rounds) return rest;
    return `${HUD_MARK}${rest ? `§f${rest}${NO_CLOCK}` : EMPTY_CLOCK_BOX}${codes}`;
  }
  const whole = Math.max(0, Math.ceil(secondsLeft));
  const clock = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  return `${HUD_MARK}${whole <= URGENT_SECONDS ? "§c" : "§f"}${clock}${rest ? `§7   ${rest}` : ""}${codes}`;
}

/** Icons display: the number of circles (3 to 7), then each won circle's place (1 to 7) and its winner's color. */
export const ROUND_COUNT = "§k§i";
export const ROUND_WON = "§k§j";
/** Score display: each side's place (1 to 4) and its color, then the tens (from 10) and units of its round wins. */
export const SIDE_COLOR = "§k§q";
export const SIDE_TENS = "§k§m";
export const SIDE_UNITS = "§k§s";
/**
 * The colors the rounds display can draw (the codes after "§"): the team colors, white, and gray for
 * a drawn round. Any other team color shows white. Must match the pack.
 */
export const ROUND_COLORS = ["c", "9", "a", "e", "6", "d", "b", "f", "7"] as const;
const DRAWN_ROUND = "7";

/** What the rounds box shows, with colors as § codes ("§c"). */
export type BestOfHud =
  | { display: "icons"; rounds: number; winners: readonly (string | undefined)[] }
  | { display: "score"; sides: readonly { color: string; wins: number }[] };

/** Best-of rounds as formatting codes for the end of the HUD line (see the file header), ending with §r. */
export function bestOfCodes(hud: BestOfHud): string {
  if (hud.display === "icons") {
    const rounds = Math.min(7, Math.max(3, Math.round(hud.rounds)));
    const won = hud.winners.slice(0, rounds).map((color, index) => `${ROUND_WON}§${index + 1}§${color === undefined ? DRAWN_ROUND : roundColor(color)}`);
    return `${ROUND_COUNT}§${rounds}${won.join("")}§r`;
  }
  const sides = hud.sides.slice(0, 4).map((side, index) => {
    const place = index + 1;
    const wins = Math.min(99, Math.max(0, Math.round(side.wins)));
    const tens = wins >= 10 ? `${SIDE_TENS}§${place}§${Math.floor(wins / 10)}` : "";
    return `${SIDE_COLOR}§${place}§${roundColor(side.color)}${tens}${SIDE_UNITS}§${place}§${wins % 10}`;
  });
  return `${sides.join("")}§r`;
}

/** A team's § color as one of ROUND_COLORS, white when it isn't one. */
function roundColor(color: string): string {
  const code = color.replace("§", "");
  return (ROUND_COLORS as readonly string[]).includes(code) ? code : "f";
}

/**
 * A score (0 to 999) as formatting codes that never render: each place's codes, then its digit as
 * a code ("§k§t§1§k§u§5§r" is 15). Leading zeros are left out, so the pack shows only the digits there are.
 */
export function countCodes(count: number): string {
  const digits = String(Math.min(MAX_COUNT, Math.max(0, Math.round(count))));
  const places = COUNT_PLACES.slice(COUNT_PLACES.length - digits.length);
  return `${places.map((place, index) => `${place}§${digits[index]}`).join("")}§r`;
}

export type Chime = "tick" | "bell" | "go";

/** Countdown sounds: a tick for each second, a bell for the last three, and a flourish for "Go!". */
export const CHIMES: Readonly<Record<Chime, { id: string; pitch: number; volume: number }>> = {
  tick: { id: "note.hat", pitch: 1.0, volume: 0.7 },
  bell: { id: "note.bell", pitch: 1.0, volume: 1.0 },
  go: { id: "random.levelup", pitch: 1.2, volume: 0.8 },
};

/** The chime for a countdown number: 3, 2 and 1 ring a bell, anything higher ticks, 0 is "Go!". */
export function countdownChime(secondsLeft: number): Chime {
  if (secondsLeft <= 0) return "go";
  return secondsLeft <= 3 ? "bell" : "tick";
}

/** Plays a chime to one player. Never throws: a player who just left is skipped. */
export function playChime(player: Player, chime: Chime): void {
  const { id, pitch, volume } = CHIMES[chime];
  try {
    if (player.isValid) player.playSound(id, { pitch, volume });
  } catch {
    // left between the check and the call
  }
}
