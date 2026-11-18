// The codes Block Party's own HUD reads from the action bar (pure, so tools/assets/blockparty-hud-ui.ts
// generates the pack's JSON UI from the same lists): formatting codes, which never render, after the
// core's HUD mark (hudLine's codes). The pack's ui/blockparty_hud.json shows a control for every
// code, each left out unless its code is in the line.
//   - The loading screen: Minecade's star field and logo over everything, at one of LOADING_LEVELS
//     strengths (LOADING_CODE and the level's digit), stepped up and down a tick at a time to fade.
//   - A player's own results screen (STANDINGS_CODE): the standings, shown to them alone after a
//     drop (ui/hud_screen.json's bp_standings).
// The line is never empty, even with nothing to show (KEEP_UP): every Block Party screen rides the
// action bar's panel, which goes when the line does. The board sends no text of its own (the user
// took the round and totals line away, 2026-11-18); a minigame's status line still shows.
// The hotbar is vanilla's, shown only in minigames (the user's call); the board's controls are the
// board menu and the item panel (board-ui.ts), and nothing is in a player's hands on the board.

export const LOADING_CODE = "§k§d";
export const STANDINGS_CODE = "§k§f";
/** A code alone, so a line with nothing else in it is still marked and keeps the panel up. */
export const KEEP_UP = "§r";
export const LOADING_LEVELS = 8;
export const HOTBAR_SIZE = 9;

/** The loading screen at `level` (1 to LOADING_LEVELS), or nothing at 0. */
export function loadingCode(level: number): string {
  return level <= 0 ? "" : `${LOADING_CODE}§${Math.min(level, LOADING_LEVELS)}`;
}
