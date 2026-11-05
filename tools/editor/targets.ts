// What the editor can open: the lobby or a game, with the rules its maps are checked against (the
// same ones the build uses), the numbers of its own marker models (marker-models.ts), and the items
// its mannequins can hold. Its code is in the checkout (lobby/, games/<id>/); its maps and its
// picture are in the map store's working folder for it (tools/maps).
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { kitItems, possibleTeams, type EditorRules, type GameConfig, type LobbyConfig } from "@minecade/minigame-core/config";
import { storeDir, workingDir } from "../maps/paths.ts";
import { listMarkerModels, markerStyles } from "./marker-models.ts";

export interface EditorTarget {
  /** "lobby", or a game id. */
  id: string;
  /** "Lobby", or the game's name. */
  name: string;
  /** Its code: lobby/, or games/<id>/. */
  dir: string;
  /** Where its maps are, a folder each (the map store's working\<id>\). */
  mapsDir: string;
  /** The game's picture, icon.png beside its maps (the lobby has none). */
  icon: string;
  rules: EditorRules;
}

export async function loadTarget(root: string, id: string): Promise<EditorTarget> {
  const models = markerStyles(await listMarkerModels(root), id);
  const markerModels = Object.keys(models).length > 0 ? { markerModels: models } : {};
  const mapsDir = mapsDirOf(root, id);
  const icon = join(mapsDir, "icon.png");
  if (id === "lobby") {
    const configPath = join(root, "lobby", "lobby.config.ts");
    const config: LobbyConfig = existsSync(configPath) ? await importConfig(configPath) : {};
    return { id, name: "Lobby", dir: join(root, "lobby"), mapsDir, icon, rules: { kind: "lobby", requires: config.map, ...markerModels } };
  }
  const dir = join(root, "games", id);
  const configPath = join(dir, "game.config.ts");
  if (!/^[a-z0-9_-]+$/.test(id) || !existsSync(configPath)) throw new Error(`there is no game "${id}" (games/${id}/game.config.ts): use lobby or a game id`);
  const config = await importConfig<GameConfig>(configPath);
  const teams = config.teams ? possibleTeams(config.teams).map(({ id: team, name, color }) => ({ id: team, name, color })) : undefined;
  const items = kitItems(config.kits);
  const mapKits = config.kits?.mapKits === false ? { mapKits: false } : {};
  return { id, name: config.name, dir, mapsDir, icon, rules: { kind: "game", maxPlayers: config.maxPlayers, requires: config.map, ...(teams ? { teams } : {}), ...markerModels, ...(items.length > 0 ? { items } : {}), ...mapKits } };
}

/**
 * A config file's default export, as the file is now. The editor runs for days, and Node keeps a
 * module it imported for the life of the process, so a config changed since (a new map setting, say)
 * is imported again under its modified time. Files the config imports itself stay as first read.
 */
async function importConfig<T>(path: string): Promise<T> {
  const { mtimeMs } = await stat(path);
  return (await import(`${pathToFileURL(path).href}?mtime=${Math.floor(mtimeMs)}`)).default as T;
}

/** The lobby and every game, with the map ids each has, for Select mode's save-as-map form. */
export async function listTargets(root: string): Promise<(EditorTarget & { maps: string[] })[]> {
  const ids = ["lobby", ...(await readdir(join(root, "games"))).filter((id) => existsSync(join(root, "games", id, "game.config.ts"))).sort()];
  const targets: (EditorTarget & { maps: string[] })[] = [];
  for (const id of ids) {
    const target = await loadTarget(root, id);
    targets.push({ ...target, maps: await mapIds(target.mapsDir) });
  }
  return targets;
}

/** The maps in a target's maps folder: its folders with a map.json. */
export async function mapIds(mapsDir: string): Promise<string[]> {
  if (!existsSync(mapsDir)) return [];
  return (await readdir(mapsDir)).filter((id) => existsSync(join(mapsDir, id, "map.json"))).sort();
}

/** Where a target's maps are, a folder each: the map store's working folder for it. */
export function mapsDirOf(root: string, target: string): string {
  return workingDir(target, storeDir(root));
}
