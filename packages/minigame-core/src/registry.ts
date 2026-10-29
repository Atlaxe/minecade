// The game registry the build produces: every game and its maps. The orchestrator reads it as
// registry.json; packs that need it (the lobby) import it as "#registry".
import type { GameOptionConfig, StatsConfig, TeamsConfig } from "./config.ts";

export interface RegistryMap {
  id: string;
  name: string;
  /** Texture path of the map's 16:9 screenshot in the lobby resource pack, when it has a preview.png. */
  preview?: string;
}

export interface RegistryGame {
  id: string;
  name: string;
  description?: string;
  minPlayers: number;
  maxPlayers: number;
  maps: RegistryMap[];
  /** Texture path of the game's 16:9 picture in the lobby resource pack. */
  icon?: string;
  /** The game's team setup, so the lobby can offer team settings and picks. */
  teams?: TeamsConfig;
  /** Choices the lobby's game screen offers for this game. */
  options?: GameOptionConfig[];
  /** How the stats service records this game; absent for games without stats. */
  stats?: StatsConfig;
}

export interface Registry {
  games: RegistryGame[];
}

/** Stand-in pictures in the lobby resource pack, for games and maps without their own. */
export const PLACEHOLDER_PICTURES = {
  none: "textures/minecade/holo/icon_none",
  game: "textures/minecade/ui/game_placeholder",
  map: "textures/minecade/ui/map_placeholder",
} as const;

/**
 * The pictures the lobby hologram can show, in order: none first, then the placeholders, then
 * every game's picture and map preview. The build writes this list into the hologram's render
 * controller and the lobby picks from it by index, so both use this one function.
 */
export function holoPictures(registry: Registry): string[] {
  const pictures = [
    PLACEHOLDER_PICTURES.none,
    PLACEHOLDER_PICTURES.game,
    PLACEHOLDER_PICTURES.map,
    ...registry.games.flatMap((game) => [game.icon, ...game.maps.map((map) => map.preview)]),
  ];
  return [...new Set(pictures.filter((picture): picture is string => picture !== undefined))];
}
