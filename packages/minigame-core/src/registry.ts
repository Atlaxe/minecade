// The game registry the build produces: every game and its maps. The orchestrator reads it as
// registry.json; packs that need it (the lobby) import it as "#registry".
import type { StatsConfig } from "./config.ts";

export interface RegistryMap {
  id: string;
  name: string;
}

export interface RegistryGame {
  id: string;
  name: string;
  description?: string;
  minPlayers: number;
  maxPlayers: number;
  maps: RegistryMap[];
  /** How the stats service records this game; absent for games without stats. */
  stats?: StatsConfig;
}

export interface Registry {
  games: RegistryGame[];
}
