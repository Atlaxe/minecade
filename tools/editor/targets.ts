// What the editor can open: the lobby or a game, with the rules its maps are checked against (the
// same ones the build uses).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { possibleTeams, type EditorRules, type GameConfig, type LobbyConfig } from "@minecade/minigame-core/config";

export interface EditorTarget {
  /** "lobby", or a game id. */
  id: string;
  /** "Lobby", or the game's name. */
  name: string;
  dir: string;
  rules: EditorRules;
}

export async function loadTarget(root: string, id: string): Promise<EditorTarget> {
  if (id === "lobby") {
    const configPath = join(root, "lobby", "lobby.config.ts");
    const config: LobbyConfig = existsSync(configPath) ? (await import(pathToFileURL(configPath).href)).default : {};
    return { id, name: "Lobby", dir: join(root, "lobby"), rules: { kind: "lobby", requires: config.map } };
  }
  const dir = join(root, "games", id);
  const configPath = join(dir, "game.config.ts");
  if (!/^[a-z0-9_-]+$/.test(id) || !existsSync(configPath)) throw new Error(`there is no game "${id}" (games/${id}/game.config.ts): use lobby or a game id`);
  const config = (await import(pathToFileURL(configPath).href)).default as GameConfig;
  const teams = config.teams ? possibleTeams(config.teams).map(({ id: team, name, color }) => ({ id: team, name, color })) : undefined;
  return { id, name: config.name, dir, rules: { kind: "game", maxPlayers: config.maxPlayers, requires: config.map, ...(teams ? { teams } : {}) } };
}
