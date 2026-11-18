// The codes Block Party's own HUD reads from the action bar (pure, so tools/assets/blockparty-hud-ui.ts
// generates the pack's JSON UI from the same lists): formatting codes, which never render, after the
// core's HUD mark (hudLine's codes). The pack's ui/blockparty_hud.json shows a control for every
// code, each left out unless its code is in the line.
//   - The star field (stars.ts): the minigame announcement's moving stars over everything but the
//     dialogue box, at one of STAR_LEVELS strengths (STARS_CODE and the level's digit), stepped up and
//     down to fade, and where its layers are (STARS_DOWN_CODE or STARS_UP_CODE, the way they slide,
//     and the phase in two hex digits).
//   - A player's own results screen (STANDINGS_CODE): the standings, shown to them alone after a
//     drop (ui/hud_screen.json's bp_standings).
//   - The minigame tutorial's per-player parts (the blockparty_tutorial component reads them): the
//     second side's objective and controls for a player on it (SIDE_TWO_CODE), and "Ready!" for a
//     player who has jumped (READY_CODE).
// The core's own action bar codes (minigame-core hud.ts) use §k with a, b, c, e, g, h, i, j, l, m,
// n, p, q, s, t and u, but its clock and count show only with their last places' (§k§a, §k§u).
// The line is never empty, even with nothing to show (KEEP_UP): every Block Party screen rides the
// action bar's panel, which goes when the line does. The board sends no text of its own (the user
// took the round and totals line away, 2026-11-18); a minigame's status line still shows.
// The hotbar is vanilla's, shown only in minigames (the user's call); the board's controls are the
// board menu and the item panel (board-ui.ts), and nothing is in a player's hands on the board.

export const STARS_CODE = "§k§d";
/** The star field's layers sliding down the screen (the camera rising), and up (coming down). */
export const STARS_DOWN_CODE = "§k§g";
export const STARS_UP_CODE = "§k§h";
export const STANDINGS_CODE = "§k§f";
/**
 * The player holds use toward a skip vote (dialogue.ts, holdStep): their dialogue box's skip strip
 * says "Skipping..." in place of everyone's words, its dots lit as far as the step's digit after it
 * (holdingCode; the user, 2026-11-18). The sidebar is everyone's, so this per-player difference rides
 * the action bar. It was §k§e, the core's "Capture the flag!" bubble (minigame-core hud.ts, FLAG_CODE),
 * which showed whenever a player held sneak to skip. The core's codes are §k with a, b, c, e, g, h,
 * i, j, l, m, n, p, q, s, t and u.
 */
export const HOLDING_CODE = "§k§v";
/** The minigame tutorial's second side is this player's (a 1v3's trio, a 2v2's Blue). */
export const SIDE_TWO_CODE = "§k§y";
/** This player has said they're ready for the minigame (a punch, since the user's evening look). */
export const READY_CODE = "§k§z";
/** A code alone, so a line with nothing else in it is still marked and keeps the panel up. */
export const KEEP_UP = "§r";
export const STAR_LEVELS = 8;
/** Where the star field's layers can be, a phase each: two hex digits' worth. */
export const STAR_PHASES = 256;
export const HOTBAR_SIZE = 9;

/** A player holding use toward a skip vote, `step` of the way (0 to 3), or nothing when they aren't (undefined). */
export function holdingCode(step: number | undefined): string {
  return step === undefined ? "" : `${HOLDING_CODE}§${Math.max(0, Math.min(3, Math.floor(step)))}`;
}

export type StarDirection = "down" | "up";

const HEX = "0123456789abcdef";

/** The star field's phase code: which way it slides, and where its layers are (0 to STAR_PHASES - 1). */
export function phaseCode(direction: StarDirection, phase: number): string {
  const at = ((Math.round(phase) % STAR_PHASES) + STAR_PHASES) % STAR_PHASES;
  return `${direction === "down" ? STARS_DOWN_CODE : STARS_UP_CODE}§${HEX[at >> 4]}§${HEX[at & 15]}`;
}

/**
 * The star field at `level` (1 to STAR_LEVELS), or nothing at 0; with the way it slides, and its
 * phase when given (without one, the codes that say what changed: the phase moves all the time).
 */
export function starsCode(level: number, direction?: StarDirection, phase?: number): string {
  if (level <= 0) return "";
  const strength = `${STARS_CODE}§${Math.min(level, STAR_LEVELS)}`;
  if (!direction) return strength;
  return strength + (phase === undefined ? (direction === "down" ? STARS_DOWN_CODE : STARS_UP_CODE) : phaseCode(direction, phase));
}
