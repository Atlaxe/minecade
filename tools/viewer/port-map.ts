// Port to another game (after V.12, as the user asked): a map's blocks become a new map of another
// game, such as One in the Quiver's KGB for Gunfight. Only the world goes: nothing of its map.json
// (spawns, markers, boundaries, settings, its time, cameras, mannequins, where it was cut from) and
// not its picture. The new map is a draft with the old one's name, under its map id when the game
// can take it, kept as its first version in the map store; its markup is placed afresh.
//   GET  /api/viewer/port?target=<id>&map=<id>   the games it can go to: each with a map id it can
//                                                take and the ids it can't, each with why
//   POST /api/viewer/port {target, map, to, id, name}
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatMapConfig, type MapConfig } from "@minecade/minigame-core/config";
import { editorStatus } from "../editor/control.ts";
import { isMapId, type EditorStatus } from "../editor/editor-core.ts";
import { parseSelectFile } from "../editor/select-core.ts";
import { listTargets } from "../editor/targets.ts";
import { storeDir } from "../maps/paths.ts";
import { MapStore } from "../maps/store.ts";
import { MAX_NAME } from "./edit-check.ts";

/** A game (or the lobby) as porting sees it: its maps, and the games whose maps it plays too. */
export interface PortGame {
  id: string;
  name: string;
  maps: string[];
  borrow?: string[];
}

/** Where a map can go: a game, a map id it can take, and the ids it can't, each with why. */
export interface PortChoice {
  id: string;
  name: string;
  suggested: string;
  taken: Record<string, string>;
}

export type ChoicesAnswer = { status: 200; name: string; targetName: string; games: PortChoice[] } | { status: 400 | 404; error: string };
export type PortAnswer = { status: 200; target: string; targetName: string; map: string; name: string; message: string } | { status: 400 | 404 | 409 | 422 | 500; error: string };

const ID = /^[A-Za-z0-9_-]+$/;

/**
 * The map ids `to` can't give a new map, each with why: its own maps; the maps of the games it plays
 * too (map.borrow) and of every game that plays its maps, since a game's list holds its own maps and
 * its lenders' and the build refuses two of one id; and maps being cut out of a world for it.
 */
export function takenIds(to: string, games: readonly PortGame[], cutting: readonly string[] = []): Record<string, string> {
  const byId = new Map(games.map((game) => [game.id, game]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const taken: Record<string, string> = {};
  const take = (map: string, why: string) => (taken[map] ??= why);
  for (const map of byId.get(to)?.maps ?? []) take(map, `${nameOf(to)} has a map "${map}" already.`);
  for (const map of cutting) take(map, `A map "${map}" is being cut out of a world for ${nameOf(to)}.`);
  for (const game of games) {
    const lenders = game.borrow ?? [];
    if (game.id !== to && !lenders.includes(to)) continue;
    for (const owner of [game.id, ...lenders]) {
      if (owner === to) continue;
      for (const map of byId.get(owner)?.maps ?? []) {
        if (game.id === to) take(map, `${nameOf(to)} plays ${nameOf(owner)}'s maps too, and ${nameOf(owner)} has a map "${map}".`);
        else if (owner === game.id) take(map, `${game.name} plays ${nameOf(to)}'s maps, and has a map "${map}" of its own.`);
        else take(map, `${game.name} plays ${nameOf(to)}'s maps and ${nameOf(owner)}'s, which has a map "${map}".`);
      }
    }
  }
  return taken;
}

/** The map id a ported map gets: its own when the game can take it, else with -2, -3 and so on. */
export function suggestId(base: string, taken: Readonly<Record<string, string>>): string {
  if (isMapId(base) && !taken[base]) return base;
  for (let n = 2; ; n++) {
    const end = `-${n}`;
    const id = `${base.slice(0, 48 - end.length)}${end}`;
    if (isMapId(id) && !taken[id]) return id;
  }
}

/** Why a map can't be ported as `id` with `name`, or undefined. */
export function portProblem(id: string, name: string, taken: Readonly<Record<string, string>>): string | undefined {
  if (!isMapId(id)) return "A map id is lower case letters, digits, _ and -, starting with a letter or digit, up to 48 characters.";
  if (taken[id]) return taken[id];
  const trimmed = name.trim();
  if (!trimmed) return "The map needs a name.";
  if (trimmed.length > MAX_NAME || /[\u0000-\u001f§]/.test(trimmed)) return `A map's name is 1 to ${MAX_NAME} characters, without color codes.`;
  return undefined;
}

/** The map.json a ported map starts with: its name and nothing else, a draft until it's published. */
export function portedConfig(name: string): MapConfig {
  return { name: name.trim(), draft: true, spawns: [] };
}

/** The games a map can go to: every other game (the lobby last), each with the ids it can't take. */
export async function portChoices(root: string, target: string, map: string): Promise<ChoicesAnswer> {
  if (!ID.test(target) || !ID.test(map)) return { status: 400, error: "expected ?target=<id>&map=<id>" };
  const games = await portGames(root);
  const source = games.find((game) => game.id === target);
  if (!source || !source.maps.includes(map)) return { status: 404, error: `there's no map ${target}/${map} in the map store` };
  const config = readConfig(join(source.mapsDir, map, "map.json"));
  const cutting = cuttingFor(root);
  const others = [...games.filter((game) => game.id !== target && game.id !== "lobby"), ...games.filter((game) => game.id !== target && game.id === "lobby")];
  return {
    status: 200,
    name: config?.name || map,
    targetName: source.name,
    games: others.map((game) => {
      const taken = takenIds(game.id, games, cutting.get(game.id));
      return { id: game.id, name: game.name, suggested: suggestId(map, taken), taken };
    }),
  };
}

/**
 * Ports a map: its world, as last saved, is copied into a new map of the other game, whose map.json
 * holds only its name. Refused while game Edit has the map open with blocks it hasn't saved.
 */
export async function portMap(root: string, body: Record<string, unknown>, status: () => Promise<EditorStatus | undefined> = () => editorStatus(1000)): Promise<PortAnswer> {
  const target = typeof body.target === "string" ? body.target : "";
  const map = typeof body.map === "string" ? body.map : "";
  const to = typeof body.to === "string" ? body.to : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (![target, map, to].every((value) => ID.test(value))) return { status: 400, error: "expected {target, map, to, id, name}" };
  const games = await portGames(root);
  const source = games.find((game) => game.id === target);
  if (!source || !source.maps.includes(map)) return { status: 404, error: `there's no map ${target}/${map} in the map store` };
  const dest = games.find((game) => game.id === to);
  if (!dest) return { status: 404, error: `there's no game "${to}"` };
  if (to === target) return { status: 422, error: `${map} is ${source.name}'s already: port it to another game.` };
  const problem = portProblem(id, name, takenIds(to, games, cuttingFor(root).get(to)));
  if (problem) return { status: 422, error: problem };
  const world = join(source.mapsDir, map, "world");
  if (!existsSync(join(world, "level.dat"))) return { status: 409, error: `${map} has no world to port (or game Edit is swapping in a save: try again in a moment).` };
  const edit = (await status())?.edit;
  if (edit && edit.target === target && edit.map === map && (edit.unsaved || edit.saving || edit.publishing)) {
    return { status: 409, error: `${edit.mapName || map} is open in game Edit with blocks it hasn't saved yet: Save it first, then port it.` };
  }
  const folder = join(dest.mapsDir, id);
  // The world goes into a folder of its own first, then takes the map's place whole; map.json comes last, so no list shows it half made.
  const fresh = join(dest.mapsDir, `${id}.port`);
  try {
    await rm(fresh, { recursive: true, force: true });
    await mkdir(fresh, { recursive: true });
    await cp(world, join(fresh, "world"), { recursive: true });
    await rename(fresh, folder);
    await writeFile(join(folder, "map.json"), formatMapConfig(portedConfig(name)));
  } catch (error) {
    await rm(fresh, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    return { status: 500, error: `the world didn't copy: ${error instanceof Error ? error.message : String(error)}` };
  }
  const store = MapStore.open(storeDir(root));
  try {
    store.saveVersion(to, id, "save", `Port from ${target}/${map}`);
  } finally {
    store.close();
  }
  const sourceName = readConfig(join(source.mapsDir, map, "map.json"))?.name || map;
  return {
    status: 200,
    target: to,
    targetName: dest.name,
    map: id,
    name,
    message: `Ported ${source.name}'s ${sourceName} to ${dest.name} as ${name === sourceName ? id : `${name} (${id})`}: its blocks only, a draft with no spawns, markers or boundaries yet.`,
  };
}

/** Every game and the lobby, with their maps and map.borrow. */
async function portGames(root: string): Promise<(PortGame & { mapsDir: string })[]> {
  return (await listTargets(root)).map((target) => ({
    id: target.id,
    name: target.name,
    maps: target.maps,
    mapsDir: target.mapsDir,
    ...(target.rules.requires?.borrow ? { borrow: target.rules.requires.borrow } : {}),
  }));
}

/** Maps being cut out of worlds (Select's lists, in game and from above) that have no folder yet, by game. */
function cuttingFor(root: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const dir = join(root, "work", "select");
  if (!existsSync(dir)) return found;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    let text = "";
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const selection of parseSelectFile(text)?.selections ?? []) {
      if (selection.status === "ready" || selection.status === "failed") continue;
      (found.get(selection.target) ?? found.set(selection.target, []).get(selection.target)!).push(selection.map);
    }
  }
  return found;
}

function readConfig(path: string): MapConfig | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as MapConfig;
  } catch {
    return undefined;
  }
}
