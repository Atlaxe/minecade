// The codes Block Party's own HUD reads from the action bar (pure, so tools/assets/blockparty-hud-ui.ts
// generates the pack's JSON UI from the same lists): formatting codes, which never render, after the
// core's HUD mark (hudLine's codes). The pack's ui/blockparty_hud.json shows a control for every
// code, each left out unless its code is in the line.
//   - The loading screen: Minecade's star field and logo over everything, at one of LOADING_LEVELS
//     strengths (LOADING_CODE and the level's digit), stepped up and down a tick at a time to fade.
// The hotbar is vanilla's again, shown only in minigames (the user's call), so the bar has no codes
// now: its items (behavior_pack/items/bar_<icon>.json) are only in the hotbar's slots.

export const LOADING_CODE = "§k§d";
export const LOADING_LEVELS = 8;
export const HOTBAR_SIZE = 9;

/** The bar's items, each the pack's blockparty:bar_<icon> with a clear texture (nothing shows in the hand). */
export const BAR_ICONS = ["items", "dice", "tests", "back", "die", "slow_die", "golden_die", "stone_totem", "lightning", "glove"] as const;
export type BarIcon = (typeof BAR_ICONS)[number];

/** The loading screen at `level` (1 to LOADING_LEVELS), or nothing at 0. */
export function loadingCode(level: number): string {
  return level <= 0 ? "" : `${LOADING_CODE}§${Math.min(level, LOADING_LEVELS)}`;
}
