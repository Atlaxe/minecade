// The game registry the build produces: every game and its maps. The orchestrator reads it as
// registry.json; packs that need it (the lobby) import it as "#registry".

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
}

export interface Registry {
  games: RegistryGame[];
}
