// The game registry the build produces: every game and its maps. The orchestrator reads it as
// registry.json; packs that need it (the lobby) import it as "#registry".
import type { StatsConfig, TeamsConfig } from "./config.ts";

export interface RegistryMap {
  id: string;
  name: string;
  /** Texture path in the lobby resource pack, when the map has an icon.png. */
  icon?: string;
}

export interface RegistryGame {
  id: string;
  name: string;
  description?: string;
  minPlayers: number;
  maxPlayers: number;
  maps: RegistryMap[];
  /** Texture path of the game's icon in the lobby resource pack. */
  icon?: string;
  /** The game's team setup, so the lobby can offer team settings and picks. */
  teams?: TeamsConfig;
  /** How the stats service records this game; absent for games without stats. */
  stats?: StatsConfig;
}

export interface Registry {
  games: RegistryGame[];
}
