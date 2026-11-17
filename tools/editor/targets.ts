// What the editor can open: the lobby or a game, with the rules its maps are checked against (the
// same ones the build uses), the numbers of its own marker models (marker-models.ts), and the items
// its mannequins can hold (its kits' items, then its mannequinItems). Its code is in the checkout (lobby/, games/<id>/); its maps and its
// picture are in the map store's working folder for it (tools/maps).
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { holdItems, possibleTeams, type EditorRules, type GameConfig, type LobbyConfig } from "@minecade/minigame-core/config";
import { storeDir, workingDir } from "../maps/paths.ts";
import { importConfig } from "./import-config.ts";
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
  /** Games that play this game's maps too (their map.borrow names it): a preview can play a map as one of them. */
  borrowers?: PlayAs[];
}

/** A game a map can be previewed as. */
export interface PlayAs {
  id: string;
  name: string;
  maxPlayers: number;
}

/** A lobby or game that's left out because its config didn't load, and why. */
export interface BrokenTarget {
  id: string;
  /** Its config, from the repo root. */
  file: string;
  error: string;
}

/** Loads the configs one call needs, each once (a game's borrowers read every other game's config). */
type ConfigLoader = (path: string) => Promise<unknown>;

function configLoader(): ConfigLoader {
  const loaded = new Map<string, Promise<unknown>>();
  return (path) => {
    let config = loaded.get(path);
    if (!config) loaded.set(path, (config = importConfig(path)));
    return config;
  };
}

export async function loadTarget(root: string, id: string, load: ConfigLoader = configLoader()): Promise<EditorTarget> {
  const models = markerStyles(await listMarkerModels(root), id);
  const markerModels = Object.keys(models).length > 0 ? { markerModels: models } : {};
  const mapsDir = mapsDirOf(root, id);
  const icon = join(mapsDir, "icon.png");
  if (id === "lobby") {
    const configPath = join(root, "lobby", "lobby.config.ts");
    const config = existsSync(configPath) ? ((await load(configPath)) as LobbyConfig) : {};
    return { id, name: "Lobby", dir: join(root, "lobby"), mapsDir, icon, rules: { kind: "lobby", requires: config.map, ...markerModels } };
  }
  const dir = join(root, "games", id);
  const configPath = join(dir, "game.config.ts");
  if (!/^[a-z0-9_-]+$/.test(id) || !existsSync(configPath)) throw new Error(`there is no game "${id}" (games/${id}/game.config.ts): use lobby or a game id`);
  const config = (await load(configPath)) as GameConfig;
  const teams = config.teams ? possibleTeams(config.teams).map(({ id: team, name, color }) => ({ id: team, name, color })) : undefined;
  const items = holdItems(config);
  const mapKits = config.kits?.mapKits === false ? { mapKits: false } : {};
  const borrowers = await borrowersOf(root, id, load);
  return {
    id,
    name: config.name,
    dir,
    mapsDir,
    icon,
    rules: { kind: "game", maxPlayers: config.maxPlayers, requires: config.map, ...(teams ? { teams } : {}), ...markerModels, ...(items.length > 0 ? { items } : {}), ...mapKits },
    ...(borrowers.length > 0 ? { borrowers } : {}),
  };
}

/** The games whose map.borrow names `id` (Gunfight, for Siege), by name. */
async function borrowersOf(root: string, id: string, load: ConfigLoader): Promise<PlayAs[]> {
  const found: PlayAs[] = [];
  for (const other of (await readdir(join(root, "games"))).sort()) {
    const path = join(root, "games", other, "game.config.ts");
    if (other === id || !existsSync(path)) continue;
    // A game whose config doesn't load borrows nothing (listTargets says why).
    const config = (await load(path).catch(() => undefined)) as GameConfig | undefined;
    if (config?.map?.borrow?.includes(id)) found.push({ id: other, name: config.name, maxPlayers: config.maxPlayers });
  }
  return found;
}

/**
 * The lobby and every game, with the map ids each has, for Select mode's save-as-map form. One whose
 * config doesn't load is left out, so the rest still list, and `broken` hears why.
 */
export async function listTargets(root: string, broken?: (target: BrokenTarget) => void): Promise<(EditorTarget & { maps: string[] })[]> {
  const ids = ["lobby", ...(await readdir(join(root, "games"))).filter((id) => existsSync(join(root, "games", id, "game.config.ts"))).sort()];
  const targets: (EditorTarget & { maps: string[] })[] = [];
  const load = configLoader();
  for (const id of ids) {
    let target: EditorTarget;
    try {
      target = await loadTarget(root, id, load);
    } catch (error) {
      broken?.({ id, file: id === "lobby" ? "lobby/lobby.config.ts" : `games/${id}/game.config.ts`, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
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
