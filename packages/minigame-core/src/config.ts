// A game's definition, exported from games/<id>/game.config.ts. The build reads it to fill the
// registry the orchestrator and lobby use. Milestone 6 adds the gameplay settings.
export interface GameConfig {
  /** Must match the game's folder name under games/. */
  id: string;
  name: string;
  description?: string;
  minPlayers: number;
  maxPlayers: number;
}

/** Identity helper that type-checks a game.config.ts default export. */
export function defineGame<C extends GameConfig>(config: C): C {
  return config;
}
