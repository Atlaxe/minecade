// The game registry the build produces: every game and its maps, and the lobby's maps. The
// orchestrator reads it as registry.json; packs that need it (the lobby, the map editor) import it
// as "#registry".
import type { GameOptionConfig, StatsConfig, TeamsConfig } from "./config.ts";
import type { MapRequirement } from "./map-requirements.ts";

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
  /** What the game's maps need (mapRequirements): the map editor's checklist. */
  mapRequirements?: MapRequirement[];
}

export interface RegistryLobby {
  maps: RegistryMap[];
  mapRequirements: MapRequirement[];
}

export interface Registry {
  games: RegistryGame[];
  lobby?: RegistryLobby;
}

/** Stand-in pictures in the lobby resource pack, for games and maps without their own. */
export const PLACEHOLDER_PICTURES = {
  none: "textures/minecade/holo/icon_none",
  game: "textures/minecade/ui/game_placeholder",
  map: "textures/minecade/ui/map_placeholder",
} as const;

/** Letter badges in the lobby resource pack (textures/minecade/badges/<character>.png), plus "other". */
export const BADGE_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A player's badge: their name's first letter or digit, or "other". Stands in for their head until skins can be shown. */
export function badgeFor(name: string): string {
  const first = name.trim().charAt(0).toLowerCase();
  return `textures/minecade/badges/${first && BADGE_CHARACTERS.includes(first) ? first : "other"}`;
}

/**
 * A player whose skin the lobby pack has renders of (the build makes them from what the skin
 * watcher saved; packs import the list as "#skins"). `key` names the renders: the player's xuid.
 */
export interface PlayerSkin {
  name: string;
  key: string;
}

/**
 * The renders of each player's skin, in the hologram's look (tools/skins/skin-set.ts): head and
 * shoulders (the hologram's portrait and the stats screen's), and the head alone (the stats list's rows).
 */
export type SkinRender = "holo" | "holo_head";

export function skinTexture(key: string, render: SkinRender): string {
  return `textures/minecade/skins/${key}_${render}`;
}

/**
 * The portraits the lobby hologram can show, in order: none first, then every badge, then each
 * player's skin (the build and the lobby share this list).
 */
export function holoPortraits(skins: PlayerSkin[] = []): string[] {
  return [
    PLACEHOLDER_PICTURES.none,
    ...[...BADGE_CHARACTERS, "other"].map((character) => `textures/minecade/badges/${character}`),
    ...skins.map((skin) => skinTexture(skin.key, "holo")),
  ];
}

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
