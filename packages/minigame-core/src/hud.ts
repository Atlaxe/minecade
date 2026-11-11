// The HUD timer and countdown sounds, shared by games and the lobby.
//
// The HUD top right: Bedrock has no script API for placing text on the HUD, so everything there
// rides on the action bar. A line starting with HUD_MARK (formatting codes, which never render)
// shows top right instead of above the hotbar (the core resource pack's ui/hud_screen.json), each
// thing in a bubble of its own: the clock's, the own score's and the rounds' side by side, and the
// line's text ("Lives: 2", Build Swap's prompt) in one above them. A new thing there always gets
// its own bubble (docs/ui.md).
//
// JSON UI can't cut text out of the action bar, so only the text is visible; everything else rides
// at the end of the line as more formatting codes, and the pack shows the digit or picture whose
// code it finds in each place:
// - Clock: each place's digit (clockCodes), red in the last 30 seconds, after a clock icon.
// - Own score: a game whose scoring shows "own" shows each player their score with a skull
//   (countCodes).
// - Best-of rounds: a circle per round colored by its winner, or each side's round wins in its color
//   ("R | B") (bestOfCodes).
// - Scope: SCOPE_CODE anywhere in the line draws a gun's scope over the whole screen (a game adds it
//   while Guns.isScoped, through Minigame.hudCodes).
// - Flag: FLAG_CODE anywhere in the line shows a "Capture the flag!" bubble left of the others
//   (Gunfight, while its flag can be taken).
// The pack's controls for the clock and the rounds are generated from these codes
// (tools/assets/clock-hud.ts and rounds-hud.ts write ui/minecade_clock.json and minecade_rounds.json).
import type { Player } from "@minecraft/server";

/** Starts every action bar line shown top right. Must match the core pack's hud_screen.json. */
export const HUD_MARK = "§r§m§c§r";
/** After a line's text: the pack shows it in its own bubble, above the others. */
export const TEXT_MARK = "§k§c";
/** The clock's places (minutes' tens, minutes, seconds' tens, seconds), each before its digit as a code. Must match minecade_clock.json. */
export const CLOCK_PLACES = ["§k§g", "§k§n", "§k§p", "§k§a"] as const;
/** The clock in red: the last 30 seconds. */
export const CLOCK_URGENT = "§k§b";
/**
 * Draws a gun's scope over the screen (the core pack's hud_screen.json, mc_scope, and
 * textures/minecade/hud/scope.png from tools/assets/scope-hud.ts). Must match hud_screen.json.
 */
export const SCOPE_CODE = "§k§l";
/**
 * Shows the "Capture the flag!" bubble top right, left of the rounds, the score and the clock
 * (Gunfight's flag capture adds it through Minigame.hudCodes). Must match hud_screen.json.
 */
export const FLAG_CODE = "§k§e";

/**
 * Starts a title that shows in the map editor's mode box top center instead of as a title: the
 * editor's servers, and a game previewed from the editor, carry the override
 * (editor/resource_pack/ui/hud_screen.json, which must use the same mark).
 */
export const MODE_MARK = "§r§m§o§r";

/**
 * The title of a sidebar shown as notes top left instead of as the vanilla sidebar: each line in a
 * bubble of its own, above the paper doll and the chat (Notes, game/sidebar.ts). Must match the core
 * pack's ui/hud_screen.json (the notes, and the sidebar that hides for them).
 */
export const NOTES_MARK = "§r§m§n§r";

/**
 * The title of a sidebar shown as pictures on the right, where the vanilla sidebar sits, instead of
 * as the vanilla sidebar: each participant's name is a texture path in some pack the server loads
 * ("textures/chameleon/models/41"), drawn top to bottom in the sidebar's order, a bubble each.
 * Scores aren't shown. Probe's chameleon test shows its seeker's pictures this way. Must match the
 * core pack's ui/hud_screen.json (the pictures, and the sidebar that hides for them).
 */
export const PICTURES_MARK = "§r§m§p§r";

/** The mode box's line in a game previewed from the map editor: "Preview   Sumo: Arena". */
export function previewLine(label: string): string {
  return `${MODE_MARK}§dPreview${label ? `§7   ${label}` : ""}`;
}
const URGENT_SECONDS = 30;

/** Each place of the own score's number (hundreds, tens, units) as codes, before the digit's code. Must match hud_screen.json. */
export const COUNT_PLACES = ["§k§h", "§k§t", "§k§u"] as const;
/** The highest own score the HUD shows. */
export const MAX_COUNT = 999;

/** The most minutes the clock shows (99:59). */
const MAX_MINUTES = 99;

/**
 * The action bar text for the HUD top right: the line's text (`rest`, its own bubble), a stage
 * clock (red in the last 30 seconds), the player's own score when `count` is given, and best-of
 * rounds when `rounds` (bestOfCodes) is, each in its own bubble, then `codes` (SCOPE_CODE). Without
 * a clock, rounds or codes it's just the text, shown above the hotbar like the vanilla action bar.
 */
export function hudLine(secondsLeft: number | undefined, rest = "", count?: number, rounds = "", codes = ""): string {
  if (secondsLeft === undefined && !rounds && !codes) return rest;
  const text = rest ? `${rest}§r${TEXT_MARK}§r` : "";
  const clock = secondsLeft === undefined ? "" : clockCodes(secondsLeft);
  return `${HUD_MARK}${text}${clock}${count === undefined ? "" : countCodes(count)}${rounds}${codes}`;
}

/** Text alone top right, in its own bubble (the map editor's Replace mode). */
export function hudText(text: string): string {
  return `${HUD_MARK}${text}§r${TEXT_MARK}§r`;
}

/**
 * The clock as formatting codes that never render: each place's codes, then its digit as a code
 * ("§k§n§2§k§p§5§k§a§3§r" is 2:53), the minutes' tens only from 10, and CLOCK_URGENT first in the
 * last 30 seconds. Partial seconds round up; 99:59 at most.
 */
export function clockCodes(secondsLeft: number): string {
  const whole = Math.min(MAX_MINUTES * 60 + 59, Math.max(0, Math.ceil(secondsLeft)));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  const [minuteTens, minuteUnits, secondTens, secondUnits] = CLOCK_PLACES;
  const tens = minutes >= 10 ? `${minuteTens}§${Math.floor(minutes / 10)}` : "";
  return `${whole <= URGENT_SECONDS ? CLOCK_URGENT : ""}${tens}${minuteUnits}§${minutes % 10}${secondTens}§${Math.floor(seconds / 10)}${secondUnits}§${seconds % 10}§r`;
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
export const ROUND_COLORS = ["c", "9", "a", "e", "6", "d", "b", "2", "f", "7"] as const;
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
