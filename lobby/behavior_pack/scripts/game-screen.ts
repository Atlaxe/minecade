// The game screen's model, as plain data: which maps and settings a game offers, and what each
// button does. The form (menus.ts) and the terminal (terminal-controller.ts) share it.
//
// The form's buttons sit at fixed places so the themed layout can put them in two columns: map
// tiles first (MAP_SLOTS, padded with empty buttons), then Start, then the settings.
import type { RegistryGame } from "@minecade/minigame-core";

/** Map tiles on the game screen: Random plus up to 7 maps. */
export const MAP_SLOTS = 8;
/** Setting buttons after Start. */
export const SETTING_SLOTS = 2;
export const START_SLOT = MAP_SLOTS;

export const ICONS = {
  random: "textures/minecade/ui/icon_random",
  map: "textures/minecade/ui/icon_map",
} as const;

export interface MapOption {
  id: string;
  name: string;
  icon: string;
}

export interface GameSetting {
  id: string;
  label: string;
  options: { value: string; label: string }[];
}

export type GameAction = { kind: "map"; map: string } | { kind: "start" } | { kind: "setting"; id: string };

/** Random first, then the game's maps (as many as fit). */
export function mapOptions(game: RegistryGame): MapOption[] {
  const maps = game.maps.slice(0, MAP_SLOTS - 1).map((map) => ({ id: map.id, name: map.name, icon: map.icon ?? ICONS.map }));
  return [{ id: "random", name: "Random", icon: ICONS.random }, ...maps];
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

/** What the button at `selection` does on this game's screen. */
export function gameAction(game: RegistryGame, selection: number): GameAction | undefined {
  if (selection < MAP_SLOTS) {
    const map = mapOptions(game)[selection];
    return map ? { kind: "map", map: map.id } : undefined;
  }
  if (selection === START_SLOT) return { kind: "start" };
  const setting = settingsFor(game)[selection - START_SLOT - 1];
  return setting ? { kind: "setting", id: setting.id } : undefined;
}

/** "2-6 players", or "4 players" when the count is fixed. */
export function playerRange(game: RegistryGame): string {
  return game.minPlayers === game.maxPlayers ? `${game.minPlayers} players` : `${game.minPlayers}-${game.maxPlayers} players`;
}
