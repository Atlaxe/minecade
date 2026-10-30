// The Play screens' model, as plain data: which maps and settings a game offers, the buttons each
// form shows, and what each button does. The forms (menus.ts) and the terminal
// (terminal-controller.ts) share it.
//
// The themed layouts (lobby/resource_pack/ui/minecade_forms.json) sort buttons into columns by a
// marker at the start of the button's text: formatting codes that never render, each ending in §r.
// Each column lists every button but shows only those with its marker, so buttons can come in any
// order and the selection is simply the button's place in the form.
import { PLACEHOLDER_PICTURES, type GameOptionConfig, type RegistryGame } from "@minecade/minigame-core";

/** Column and state markers. Each must match minecade_forms.json (a test checks), and none may contain another. */
export const MARK = {
  /** The game grid's three columns. */
  games: ["§q§1§r", "§q§2§r", "§q§3§r"],
  /** The game screen's two map columns. */
  maps: ["§m§1§r", "§m§2§r"],
  /** The Random map switch. */
  toggle: "§t§g§r",
  /** Added to the switch while it's on. */
  on: "§o§n§r",
  setting: "§c§t§r",
  start: "§s§t§r",
  /** Added to the chosen map's tile, so it's outlined. */
  selected: "§s§e§l§r",
  /** Added to every map tile while Random is on, so they're dimmed. */
  dim: "§d§m§r",
  /** The stats screens: a player in the list, the player's portrait (badge), a tab, and the three stat columns. */
  player: "§p§l§r",
  portrait: "§p§o§r",
  tab: "§t§a§r",
  stats: ["§u§1§r", "§u§2§r", "§u§3§r"],
  /** The main menu's Preview button (DEV_HOLO_PREVIEW), shown small in the corner instead of as a tile. */
  preview: "§p§v§r",
  /** The X in every themed menu's top right corner (always the menu's first button): leaves the terminal. */
  close: "§c§l§s§r",
} as const;

/** What a themed menu's X means: leave the terminal. The back arrow and Esc go back one step instead. */
export const CLOSE = "close";

/**
 * A themed menu's answer, from the form's selection: CLOSE for the X (the first button), otherwise
 * the pressed button's place among the rest, or undefined when the menu was closed (back).
 */
export function menuChoice(selection: number | undefined): number | typeof CLOSE | undefined {
  if (selection === undefined) return undefined;
  return selection === 0 ? CLOSE : selection - 1;
}

export const PREVIEWS = {
  /** For games without an icon.png (demo games). */
  game: PLACEHOLDER_PICTURES.game,
  /** For maps without a preview.png. */
  none: PLACEHOLDER_PICTURES.map,
} as const;

export interface MapOption {
  id: string;
  name: string;
  preview: string;
}

/** A setting on the game screen: Teams for team games, then the game's own options. */
export type GameSetting = GameOptionConfig;

export type GameAction = { kind: "random" } | { kind: "map"; map: string } | { kind: "setting"; id: string } | { kind: "start" };

/** A button on the game screen, in form order: the Random switch, the settings, the maps, then Start. */
export interface GameButton {
  action: GameAction;
  mark: string;
}

/** The game's picture, or the placeholder. */
export function gamePicture(game: RegistryGame): string {
  return game.icon ?? PREVIEWS.game;
}

/** Every map, with its preview or the placeholder. */
export function mapOptions(game: RegistryGame): MapOption[] {
  return game.maps.map((map) => ({ id: map.id, name: map.name, preview: map.preview ?? PREVIEWS.none }));
}

const TEAMS: GameSetting = { id: "teams", label: "Teams", values: [{ value: "pick", label: "Pick" }, { value: "random", label: "Random" }] };

/** Team games where players pick their own team can switch to random teams; then the game's own options. */
export function settingsFor(game: RegistryGame): GameSetting[] {
  const teams = game.teams;
  const roles = (teams?.defs ?? []).some((team) => team.size !== undefined);
  const pickable = teams !== undefined && teams.pick !== false && !roles;
  return [...(pickable ? [TEAMS] : []), ...(game.options ?? [])];
}

export function defaultSettings(game: RegistryGame): Record<string, string> {
  return Object.fromEntries(settingsFor(game).map((setting) => [setting.id, setting.values[0].value]));
}

/** The next value of a setting, wrapping around. */
export function nextSetting(setting: GameSetting, current: string | undefined): string {
  const index = setting.values.findIndex((option) => option.value === current);
  return setting.values[(index + 1) % setting.values.length].value;
}

export function settingLabel(setting: GameSetting, current: string | undefined): string {
  return setting.values.find((option) => option.value === current)?.label ?? setting.values[0].label;
}

/** The game screen's buttons, in form order. Maps alternate between the two map columns. */
export function gameButtons(game: RegistryGame): GameButton[] {
  return [
    { action: { kind: "random" as const }, mark: MARK.toggle },
    ...settingsFor(game).map((setting) => ({ action: { kind: "setting" as const, id: setting.id }, mark: MARK.setting })),
    ...mapOptions(game).map((map, index) => ({ action: { kind: "map" as const, map: map.id }, mark: MARK.maps[index % 2] })),
    { action: { kind: "start" as const }, mark: MARK.start },
  ];
}

/** What the button at `selection` does on this game's screen. */
export function gameAction(game: RegistryGame, selection: number): GameAction | undefined {
  return gameButtons(game)[selection]?.action;
}

/** "2-6 players", or "4 players" when the count is fixed. */
export function playerRange(game: RegistryGame): string {
  return `${playerCount(game)} players`;
}

/** "2-6", or "4" when the count is fixed. */
export function playerCount(game: RegistryGame): string {
  return game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers}-${game.maxPlayers}`;
}
