// The Play screens' model, as plain data: which maps and settings a game offers, the buttons each
// form shows, and what each button does. The forms (menus.ts) and the terminal
// (terminal-controller.ts) share it.
//
// The themed layouts (lobby/resource_pack/ui/minecade_forms.json) sort buttons into columns by a
// marker at the start of the button's text: formatting codes that never render, each ending in §r.
// Each column lists every button but shows only those with its marker, so buttons can come in any
// order and the selection is simply the button's place in the form.
import type { RegistryGame } from "@minecade/minigame-core";

/** Column markers. Each must match minecade_forms.json (a test checks). */
export const MARK = {
  /** The game grid's three columns. */
  games: ["§q§1§r", "§q§2§r", "§q§3§r"],
  /** The game screen's two map columns. */
  maps: ["§m§1§r", "§m§2§r"],
  setting: "§c§t§r",
  start: "§s§t§r",
  /** Added to the chosen map's tile, so it's outlined. */
  selected: "§s§e§l§r",
} as const;

export const PREVIEWS = {
  random: "textures/minecade/ui/map_random",
  /** For maps without a preview.png. */
  none: "textures/minecade/ui/map_placeholder",
} as const;

export interface MapOption {
  id: string;
  name: string;
  preview: string;
}

export interface GameSetting {
  id: string;
  label: string;
  options: { value: string; label: string }[];
}

export type GameAction = { kind: "map"; map: string } | { kind: "start" } | { kind: "setting"; id: string };

/** A button on the game screen, in form order: the maps, then the settings, then Start. */
export interface GameButton {
  action: GameAction;
  mark: string;
}

/** Random first, then every map. */
export function mapOptions(game: RegistryGame): MapOption[] {
  const maps = game.maps.map((map) => ({ id: map.id, name: map.name, preview: map.preview ?? PREVIEWS.none }));
  return [{ id: "random", name: "Random", preview: PREVIEWS.random }, ...maps];
}

/** Team games where players pick their own team can switch to random teams instead. */
export function settingsFor(game: RegistryGame): GameSetting[] {
  const teams = game.teams;
  const roles = (teams?.defs ?? []).some((team) => team.size !== undefined);
  if (!teams || teams.pick === false || roles) return [];
  return [{ id: "teams", label: "Teams", options: [{ value: "pick", label: "Pick" }, { value: "random", label: "Random" }] }];
}

export function defaultSettings(game: RegistryGame): Record<string, string> {
  return Object.fromEntries(settingsFor(game).map((setting) => [setting.id, setting.options[0].value]));
}

/** The next option of a setting, wrapping around. */
export function nextSetting(setting: GameSetting, current: string | undefined): string {
  const index = setting.options.findIndex((option) => option.value === current);
  return setting.options[(index + 1) % setting.options.length].value;
}

export function settingLabel(setting: GameSetting, current: string | undefined): string {
  return setting.options.find((option) => option.value === current)?.label ?? setting.options[0].label;
}

/** The game screen's buttons, in form order. Maps alternate between the two map columns. */
export function gameButtons(game: RegistryGame): GameButton[] {
  return [
    ...mapOptions(game).map((map, index) => ({ action: { kind: "map" as const, map: map.id }, mark: MARK.maps[index % 2] })),
    ...settingsFor(game).map((setting) => ({ action: { kind: "setting" as const, id: setting.id }, mark: MARK.setting })),
    { action: { kind: "start" as const }, mark: MARK.start },
  ];
}

/** What the button at `selection` does on this game's screen. */
export function gameAction(game: RegistryGame, selection: number): GameAction | undefined {
  return gameButtons(game)[selection]?.action;
}

/** "2-6 players", or "4 players" when the count is fixed. */
export function playerRange(game: RegistryGame): string {
  return game.minPlayers === game.maxPlayers ? `${game.minPlayers} players` : `${game.minPlayers}-${game.maxPlayers} players`;
}
