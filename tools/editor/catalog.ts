// What the editor lobby's form offers (the Catalog): every map of the lobby and each game (whether
// its checklist is done, the world it came from, whether it has a picture, whether its folder isn't
// what's published: the map store says), the client's worlds by the name the game shows (with how
// many maps came from each), and what was opened lately (work/editor/recent.json). A world travels
// by its folder's name, never its path.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { mapChecklist, type Catalog, type MapConfig, type RecentEntry } from "@minecade/minigame-core/config";
import type { MapStore } from "../maps/store.ts";
import { addRecent, parseRecent } from "./editor-core.ts";
import { listTargets } from "./targets.ts";
import { clientWorlds, resolveWorld, type World } from "./worlds.ts";

export async function buildCatalog(root: string, store: MapStore, appData?: string): Promise<Catalog> {
  const client = await clientWorlds(appData);
  const targets: Catalog["targets"] = [];
  /** How many maps came from each world, by its name. */
  const fromWorld = new Map<string, number>();
  for (const target of await listTargets(root)) {
    const maps: Catalog["targets"][number]["maps"] = [];
    for (const id of target.maps) {
      const folder = join(target.mapsDir, id);
      const config = await readMap(join(folder, "map.json"));
      const world = config?.source?.world;
      if (world) fromWorld.set(world, (fromWorld.get(world) ?? 0) + 1);
      const from = world ? client.find((candidate) => candidate.name === world) : undefined;
      maps.push({
        id,
        name: config?.name || id,
        draft: config?.draft === true,
        ready: config !== undefined && mapChecklist(config, target.rules).ready,
        ...(from ? { world: worldId(from) } : {}),
        ...(existsSync(join(folder, "preview.png")) ? { picture: true } : {}),
        ...(store.isUnpublished(target.id, id) ? { unpublished: true } : {}),
      });
    }
    targets.push({ id: target.id, name: target.name, ...(target.rules.maxPlayers ? { maxPlayers: target.rules.maxPlayers } : {}), maps });
  }
  const worlds = client.map((world) => ({ id: worldId(world), name: world.name, maps: fromWorld.get(world.name) ?? 0 }));
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

/** Points the recent list's entries for a map at its new id (a map given another id in Edit). */
export async function renameRecent(root: string, target: string, from: string, to: string): Promise<void> {
  const list = await readRecent(root);
  let changed = false;
  const renamed = list.map((entry): RecentEntry => {
    if (entry.request.to === "select" || entry.request.target !== target || entry.request.map !== from) return entry;
    changed = true;
    return { ...entry, request: { ...entry.request, map: to }, label: entry.label.replace(`(${from})`, `(${to})`) };
  });
  if (changed) await writeFile(recentPath(root), `${JSON.stringify(renamed, null, 2)}\n`);
}

/** Takes entries off the recent list (a deleted map's). */
export async function forgetRecent(root: string, gone: (entry: RecentEntry) => boolean): Promise<void> {
  const list = await readRecent(root);
  const kept = list.filter((entry) => !gone(entry));
  if (kept.length !== list.length) await writeFile(recentPath(root), `${JSON.stringify(kept, null, 2)}\n`);
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
