// The codes Block Party's own HUD reads from the action bar (pure, so tools/assets/blockparty-hud-ui.ts
// generates the pack's JSON UI from the same lists): formatting codes, which never render, after the
// core's HUD mark (hudLine's codes). The pack's ui/blockparty_hud.json shows a control for every
// code, each left out unless its code is in the line.
//   - The hotbar: vanilla's is hidden (its empty slots can't be hidden, as the user's looks showed),
//     and the pack draws its own bottom right: a tile for each slot in use with its icon
//     (BAR_CODE, then the slot's digit and the icon's code), and the gold frame on the selected one
//     (SELECTED_CODE and the slot's digit). Vanilla's slots still pick: scrolling, number keys.
//   - The loading screen: Minecade's star field and logo over everything, at one of LOADING_LEVELS
//     strengths (LOADING_CODE and the level's digit), stepped up and down a tick at a time to fade.

export const BAR_CODE = "§k§f";
export const SELECTED_CODE = "§k§o";
export const LOADING_CODE = "§k§d";
export const LOADING_LEVELS = 8;
export const HOTBAR_SIZE = 9;

/** Each icon the bar draws (textures/blockparty/hud/icon_<id>.png), with its code: a formatting code that's never a slot's digit. */
export const BAR_ICONS = {
  items: "a",
  dice: "b",
  tests: "c",
  back: "e",
  die: "f",
  slow_die: "g",
  golden_die: "h",
  stone_totem: "i",
  lightning: "j",
  glove: "m",
} as const;
export type BarIcon = keyof typeof BAR_ICONS;

/** One slot's code: its tile and icon. */
export function slotCode(slot: number, icon: BarIcon): string {
  return `${BAR_CODE}§${slot}§${BAR_ICONS[icon]}`;
}

/** The bar's codes: each slot in use and its icon, and the selected slot. */
export function barCodes(slots: readonly { slot: number; icon: BarIcon }[], selected: number | undefined): string {
  return slots.map(({ slot, icon }) => slotCode(slot, icon)).join("") + (selected === undefined ? "" : `${SELECTED_CODE}§${selected}`);
}

/** The loading screen at `level` (1 to LOADING_LEVELS), or nothing at 0. */
export function loadingCode(level: number): string {
  return level <= 0 ? "" : `${LOADING_CODE}§${Math.min(level, LOADING_LEVELS)}`;
}
