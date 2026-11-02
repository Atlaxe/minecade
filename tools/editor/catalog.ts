// What the editor lobby's form offers (the Catalog): every map of the lobby and each game (whether
// its checklist is done, the world it came from, whether it has a picture, whether it has changes
// that weren't published: git status and unpushed commits in its folder), the client's worlds by
// the name the game shows (with how many maps came from each), and what was opened lately
// (work/editor/recent.json). A world travels by its folder's name, never its path.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { mapChecklist, type Catalog, type MapConfig, type RecentEntry } from "@minecade/minigame-core/config";
import { addRecent, parseRecent } from "./editor-core.ts";
import { gitIn, type Git } from "./publish.ts";
import { listTargets } from "./targets.ts";
import { clientWorlds, resolveWorld, type World } from "./worlds.ts";

/** git status and log are local, and quick. */
const GIT_MS = 30_000;

export async function buildCatalog(root: string, appData?: string, git: Git = gitIn(root)): Promise<Catalog> {
  const client = await clientWorlds(appData);
  const targets: Catalog["targets"] = [];
  /** Each map's folder (relative to the checkout, with "/"), for the unpublished check. */
  const folders = new Map<Catalog["targets"][number]["maps"][number], string>();
  /** How many maps came from each world, by its name. */
  const fromWorld = new Map<string, number>();
  for (const target of await listTargets(root)) {
    const maps: Catalog["targets"][number]["maps"] = [];
    for (const id of target.maps) {
      const folder = join(target.dir, "maps", id);
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
      });
      folders.set(maps[maps.length - 1], relative(root, folder).replaceAll("\\", "/"));
    }
    targets.push({ id: target.id, name: target.name, ...(target.rules.maxPlayers ? { maxPlayers: target.rules.maxPlayers } : {}), maps });
  }
  const unpublished = await unpublishedFolders(git, [...folders.values()]);
  for (const [map, folder] of folders) if (unpublished.has(folder)) map.unpublished = true;
  const worlds = client.map((world) => ({ id: worldId(world), name: world.name, maps: fromWorld.get(world.name) ?? 0 }));
  return { targets, worlds, recent: await readRecent(root) };
}

/**
 * Which of these folders (relative to the checkout, with "/") have changes that aren't on GitHub
 * yet: files changed or new since the last commit, or commits not pushed (a publish whose push
 * failed). None when git can't tell.
 */
export async function unpublishedFolders(git: Git, folders: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (folders.length === 0) return found;
  const paths: string[] = [];
  const status = await git(["status", "--porcelain=v1", "--untracked-files=all", "--", ...folders], GIT_MS);
  // "XY path" or "XY old -> new" (the output comes trimmed, so the first line can start at Y).
  if (status.code === 0) for (const line of status.out.split(/\r?\n/)) paths.push(...line.replace(/^.{1,2}\s+/, "").split(" -> "));
  const ahead = await git(["log", "--name-only", "--format=", "@{upstream}..HEAD", "--", ...folders], GIT_MS);
  if (ahead.code === 0) paths.push(...ahead.out.split(/\r?\n/));
  for (const folder of folders) if (paths.some((path) => path.replace(/^"|"$/g, "").startsWith(`${folder}/`))) found.add(folder);
  return found;
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
