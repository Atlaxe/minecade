// What the editor can open: the lobby or a game, with the rules its maps are checked against (the
// same ones the build uses).
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
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

/** The lobby and every game, with the map ids each has, for Select mode's save-as-map form. */
export async function listTargets(root: string): Promise<(EditorTarget & { maps: string[] })[]> {
  const ids = ["lobby", ...(await readdir(join(root, "games"))).filter((id) => existsSync(join(root, "games", id, "game.config.ts"))).sort()];
  const targets: (EditorTarget & { maps: string[] })[] = [];
  for (const id of ids) {
    const target = await loadTarget(root, id);
    targets.push({ ...target, maps: await mapIds(target.dir) });
  }
  return targets;
}

/** The maps a target has: folders in maps/ with a map.json. */
export async function mapIds(dir: string): Promise<string[]> {
  const maps = join(dir, "maps");
  if (!existsSync(maps)) return [];
  return (await readdir(maps)).filter((id) => existsSync(join(maps, id, "map.json"))).sort();
}

/** A target's folder: lobby/, or games/<id>/. */
export function targetDir(root: string, target: string): string {
  return target === "lobby" ? join(root, "lobby") : join(root, "games", target);
}
