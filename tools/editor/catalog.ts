// What the editor lobby's form offers (the Catalog): every map of the lobby and each game, the
// client's worlds by the name the game shows (with how many maps came from each), and what was
// opened lately (work/editor/recent.json). A world travels by its folder's name, never its path.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Catalog, MapConfig, RecentEntry } from "@minecade/minigame-core/config";
import { addRecent, parseRecent } from "./editor-core.ts";
import { listTargets } from "./targets.ts";
import { clientWorlds, resolveWorld, type World } from "./worlds.ts";

export async function buildCatalog(root: string, appData?: string): Promise<Catalog> {
  const targets: Catalog["targets"] = [];
  /** How many maps came from each world, by its name. */
  const fromWorld = new Map<string, number>();
  for (const target of await listTargets(root)) {
    const maps: Catalog["targets"][number]["maps"] = [];
    for (const id of target.maps) {
      const config = await readMap(join(target.dir, "maps", id, "map.json"));
      maps.push({ id, name: config?.name || id, draft: config?.draft === true });
      const world = config?.source?.world;
      if (world) fromWorld.set(world, (fromWorld.get(world) ?? 0) + 1);
    }
    targets.push({ id: target.id, name: target.name, maps });
  }
  const worlds = (await clientWorlds(appData)).map((world) => ({ id: worldId(world), name: world.name, maps: fromWorld.get(world.name) ?? 0 }));
  return { targets, worlds, recent: await readRecent(root) };
}

/** A client world's id in the catalog: its folder's name. */
export function worldId(world: World): string {
  return basename(world.path);
}

/** The world a Select request means: a client world by its id, else a name, a folder or a .mcworld file. */
export async function requestedWorld(world: string, unzipTo: string, appData?: string): Promise<World> {
  const client = (await clientWorlds(appData)).find((candidate) => worldId(candidate) === world);
  return client ?? resolveWorld(world, unzipTo, appData);
}

/** "Sumo: Arena (arena_1)". */
export function mapLabel(targetName: string, mapName: string, map: string): string {
  return `${targetName}: ${mapName} (${map})`;
}

export async function readRecent(root: string): Promise<RecentEntry[]> {
  const path = recentPath(root);
  return existsSync(path) ? parseRecent(await readFile(path, "utf8")) : [];
}

/** Puts `entry` first in the recent list. */
export async function noteRecent(root: string, entry: RecentEntry): Promise<void> {
  const list = addRecent(await readRecent(root), entry);
  await mkdir(join(root, "work", "editor"), { recursive: true });
  await writeFile(recentPath(root), `${JSON.stringify(list, null, 2)}\n`);
}

function recentPath(root: string): string {
  return join(root, "work", "editor", "recent.json");
}

async function readMap(path: string): Promise<MapConfig | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as MapConfig;
  } catch {
    return undefined;
  }
}
