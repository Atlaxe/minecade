// The codes Block Party's own HUD reads from the action bar (pure, so tools/assets/blockparty-hud-ui.ts
// generates the pack's JSON UI from the same lists): formatting codes, which never render, after the
// core's HUD mark (hudLine's codes). The pack's ui/blockparty_hud.json shows a control for every
// code, each left out unless its code is in the line.
//   - The loading screen: Minecade's star field and logo over everything, at one of LOADING_LEVELS
//     strengths (LOADING_CODE and the level's digit), stepped up and down a tick at a time to fade.
// The hotbar is vanilla's, shown only in minigames (the user's call); the board's controls are the
// board menu and the item panel (board-ui.ts), and nothing is in a player's hands on the board.

export const LOADING_CODE = "§k§d";
export const LOADING_LEVELS = 8;
export const HOTBAR_SIZE = 9;

/** The loading screen at `level` (1 to LOADING_LEVELS), or nothing at 0. */
export function loadingCode(level: number): string {
  return level <= 0 ? "" : `${LOADING_CODE}§${Math.min(level, LOADING_LEVELS)}`;
}
