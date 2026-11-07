// Port to another game (after V.12, as the user asked): a map's blocks become a new map of another
// game, such as One in the Quiver's KGB for Gunfight. The world and the map's picture (preview.png)
// always go; of its markup, what the other game can use goes when it's picked (the user's ask,
// 2026-11-07): spawns, game markers, boundaries, the time of day, cameras, mannequins and game
// settings, each kept to what that game has (its teams, its markers and regions by name, its build
// limit and settings). Where it was cut from and its own kits never go. The new map is a draft with
// the old one's name, under its map id when the game can take it, kept as its first version in the
// map store.
//   GET  /api/viewer/port?target=<id>&map=<id>   the games it can go to: each with a map id it can
//                                                take and the ids it can't, each with why, and what
//                                                of the markup it can take and what stays behind
//   POST /api/viewer/port {target, map, to, id, name, carry}
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { copyFile, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILD_LIMIT_SIDES,
  formatMapConfig,
  KILL_REGION,
  boundsBoxes,
  mapRequirements,
  mapSettings,
  mapTimeTicks,
  settingFits,
  spectatorBoundsBoxes,
  usesPlainSpawns,
  type BuildLimit,
  type EditorRules,
  type MapConfig,
} from "@minecade/minigame-core/config";
import { timeText } from "../../editor/behavior_pack/scripts/time-of-day.ts";
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

/**
 * Where a map can go: a game, a map id it can take, and the ids it can't, each with why; what of
 * the map's markup it can take, and what of it stays behind ("11 spawns").
 */
export interface PortChoice {
  id: string;
  name: string;
  suggested: string;
  taken: Record<string, string>;
  carry: CarryOption[];
  left: string[];
}

/** The kinds of markup a port can bring along, in the dialog's order. */
export const CARRY_KINDS = ["spawns", "markers", "boundaries", "time", "cameras", "mannequins", "settings"] as const;
export type CarryKind = (typeof CARRY_KINDS)[number];

/** One kind of markup a game can take from the map: its name, and what of it would go ("11 spawns, queue spawn"). */
export interface CarryOption {
  id: CarryKind;
  label: string;
  detail: string;
}

/** What a map's markup comes to in another game: each kind it can take, with its map.json part, and what stays behind. */
export interface CarryPlan {
  options: CarryOption[];
  parts: Partial<Record<CarryKind, Partial<MapConfig>>>;
  left: string[];
}

const CARRY_LABELS: Record<CarryKind, string> = {
  spawns: "Spawns",
  markers: "Game markers",
  boundaries: "Boundaries",
  time: "Time of day",
  cameras: "Cameras",
  mannequins: "Mannequins",
  settings: "Game settings",
};

/** "1 spawn", "11 spawns". */
function counted(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The entries of a keyed list (team spawns, points, regions) with any. */
function filled<T>(record: Record<string, T[]> | undefined): [string, T[]][] {
  return Object.entries(record ?? {}).filter(([, list]) => Array.isArray(list) && list.length > 0);
}

/**
 * What of a map's markup a game (`to`, its rules) can take: spawns (plain ones when it uses them,
 * team spawns of its teams, the spectator and queue spawns with the queue's settings for a game),
 * game markers it names, boundaries (bounds, spectator bounds, kill Y, kill regions and the regions
 * it names, the sides of a build limit it asks for), the time of day, cameras, mannequins, and its
 * settings the map has a value for that fits (the star box for the lobby). `from` is the map's own
 * game's rules, to name its settings that stay behind.
 */
export function carryPlan(config: MapConfig, to: EditorRules, from?: EditorRules): CarryPlan {
  const options: CarryOption[] = [];
  const parts: CarryPlan["parts"] = {};
  const left: string[] = [];
  const add = (id: CarryKind, part: Partial<MapConfig>, detail: string[]) => {
    if (detail.length === 0) return;
    parts[id] = part;
    options.push({ id, label: CARRY_LABELS[id], detail: detail.join(", ") });
  };
  const game = to.kind === "game";
  const teams = to.teams ?? [];
  const named = mapRequirements(to.requires, { kind: to.kind, maxPlayers: to.maxPlayers, teams });
  const namedPoints = new Set(named.flatMap((need) => (need.field === "points" && need.name ? [need.name] : [])));
  const namedRegions = new Set([KILL_REGION, ...named.flatMap((need) => (need.field === "regions" && need.name ? [need.name] : []))]);

  // Spawns.
  {
    const part: Partial<MapConfig> = {};
    const detail: string[] = [];
    const plain = config.spawns ?? [];
    if (plain.length > 0) {
      if (usesPlainSpawns(to.requires, to.kind)) {
        part.spawns = plain;
        detail.push(counted(plain.length, "spawn"));
      } else left.push(counted(plain.length, "spawn"));
    }
    const teamIds = new Set(to.requires?.teamSpawns ? teams.map((team) => team.id) : []);
    const teamSpawns: Record<string, MapConfig["spawns"]> = {};
    for (const [team, list] of filled(config.teamSpawns)) {
      if (teamIds.has(team)) teamSpawns[team] = list;
      else left.push(counted(list.length, `${team} spawn`));
    }
    const carried = Object.values(teamSpawns).reduce((sum, list) => sum + list.length, 0);
    if (carried > 0) {
      part.teamSpawns = teamSpawns;
      detail.push(counted(carried, "team spawn"));
    }
    for (const [key, label] of [["spectatorSpawn", "spectator spawn"], ["queueSpawn", "queue spawn"]] as const) {
      if (!config[key]) continue;
      if (!game) {
        left.push(`the ${label}`);
        continue;
      }
      part[key] = config[key];
      if (key === "queueSpawn" && config.queue) part.queue = config.queue;
      detail.push(label);
    }
    add("spawns", part, detail);
  }

  // Game markers.
  {
    const points: Record<string, MapConfig["spawns"]> = {};
    let carried = 0;
    for (const [name, list] of filled(config.points)) {
      if (namedPoints.has(name)) {
        points[name] = list;
        carried += list.length;
      } else left.push(counted(list.length, `${name} marker`));
    }
    add("markers", { points }, carried > 0 ? [counted(carried, "marker")] : []);
  }

  // Boundaries.
  {
    const part: Partial<MapConfig> = {};
    const detail: string[] = [];
    if (boundsBoxes(config).length > 0) {
      part.bounds = config.bounds;
      detail.push("bounds");
    }
    if (spectatorBoundsBoxes(config).length > 0) {
      part.spectatorBounds = config.spectatorBounds;
      detail.push("spectator bounds");
    }
    if (typeof config.killY === "number") {
      part.killY = config.killY;
      detail.push("kill Y");
    }
    const regions: Record<string, NonNullable<MapConfig["regions"]>[string]> = {};
    let boxes = 0;
    for (const [name, list] of filled(config.regions)) {
      if (namedRegions.has(name)) {
        regions[name] = list;
        boxes += list.length;
      } else left.push(counted(list.length, `${name} region`));
    }
    if (boxes > 0) {
      part.regions = regions;
      detail.push(counted(boxes, "region"));
    }
    const asked = to.requires?.buildLimit;
    const limit: BuildLimit = {};
    for (const side of BUILD_LIMIT_SIDES) {
      const height = config.buildLimit?.[side];
      if (typeof height !== "number") continue;
      if (asked === true || (asked && asked[side])) limit[side] = height;
      else left.push(`the build limit ${side}`);
    }
    if (Object.keys(limit).length > 0) {
      part.buildLimit = limit;
      detail.push("build limit");
    }
    add("boundaries", part, detail);
  }

  if (mapTimeTicks(config.time) !== undefined) add("time", { time: config.time }, [timeText(config.time)]);

  const cameras = Object.keys(config.cameras ?? {}).length;
  if (cameras > 0) add("cameras", { cameras: config.cameras }, [counted(cameras, "camera")]);

  const mannequins = Object.keys(config.mannequins ?? {}).length;
  if (mannequins > 0) add("mannequins", { mannequins: config.mannequins, ...(config.mannequinsInPreview ? { mannequinsInPreview: true } : {}) }, [counted(mannequins, "mannequin")]);

  // Game settings: the other game's, by key, where the map's value fits; the lobby's star box.
  {
    const part: Partial<MapConfig> = {};
    const detail: string[] = [];
    for (const setting of mapSettings(to.requires)) {
      if (!settingFits(setting, config[setting.key])) continue;
      part[setting.key] = config[setting.key];
      detail.push(setting.label);
    }
    if (config.stars === true) {
      if (to.kind === "lobby") {
        part.stars = true;
        detail.push("star box");
      } else left.push("the star box");
    }
    for (const setting of mapSettings(from?.requires)) {
      if (config[setting.key] !== undefined && !(setting.key in part)) left.push(setting.label);
    }
    add("settings", part, detail);
  }

  if (config.kits !== undefined) left.push("its kits");
  return { options, parts, left };
}

/** The kinds of markup a POST asks to carry: the known ones, each once. */
function carryKinds(value: unknown): CarryKind[] {
  if (!Array.isArray(value)) return [];
  return CARRY_KINDS.filter((kind) => value.includes(kind));
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

/**
 * The map.json a ported map starts with: its name, a draft until it's published, and the markup
 * carried (carryPlan's parts), its keys in `order` (the old map's) first.
 */
export function portedConfig(name: string, carried: readonly Partial<MapConfig>[] = [], order: readonly string[] = []): MapConfig {
  const merged: Partial<MapConfig> = Object.assign({}, ...carried);
  const config: MapConfig = { name: name.trim(), draft: true, spawns: merged.spawns ?? [] };
  for (const key of [...order, ...Object.keys(merged)]) {
    if (!(key in config) && key in merged) config[key] = merged[key];
  }
  return config;
}

/**
 * The games a map can go to: every other game (the lobby last), each with the ids it can't take and
 * what of the map's markup it can take.
 */
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
      const plan = config ? carryPlan(config, game.rules, source.rules) : { options: [], left: [] };
      return { id: game.id, name: game.name, suggested: suggestId(map, taken), taken, carry: plan.options, left: plan.left };
    }),
  };
}

/**
 * Ports a map: its world as last saved and its picture are copied into a new map of the other game,
 * whose map.json holds its name and the markup `carry` asks for (carryPlan's kinds). Refused while
 * game Edit has the map open with blocks it hasn't saved.
 */
export async function portMap(root: string, body: Record<string, unknown>, status: () => Promise<EditorStatus | undefined> = () => editorStatus(1000)): Promise<PortAnswer> {
  const target = typeof body.target === "string" ? body.target : "";
  const map = typeof body.map === "string" ? body.map : "";
  const to = typeof body.to === "string" ? body.to : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const carry = carryKinds(body.carry);
  if (![target, map, to].every((value) => ID.test(value))) return { status: 400, error: "expected {target, map, to, id, name, carry}" };
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
  const config = readConfig(join(source.mapsDir, map, "map.json"));
  const plan = config ? carryPlan(config, dest.rules, source.rules) : undefined;
  const carried = plan ? carry.filter((kind) => plan.parts[kind]) : [];
  const ported = portedConfig(
    name,
    carried.map((kind) => plan!.parts[kind]!),
    Object.keys(config ?? {}),
  );
  const picture = join(source.mapsDir, map, "preview.png");
  const pictured = existsSync(picture);
  const folder = join(dest.mapsDir, id);
  // The world and picture go into a folder of their own first, then take the map's place whole; map.json comes last, so no list shows it half made.
  const fresh = join(dest.mapsDir, `${id}.port`);
  try {
    await rm(fresh, { recursive: true, force: true });
    await mkdir(fresh, { recursive: true });
    await cp(world, join(fresh, "world"), { recursive: true });
    if (pictured) await copyFile(picture, join(fresh, "preview.png"));
    await rename(fresh, folder);
    await writeFile(join(folder, "map.json"), formatMapConfig(ported));
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
  const sourceName = config?.name || map;
  return {
    status: 200,
    target: to,
    targetName: dest.name,
    map: id,
    name,
    message: `Ported ${source.name}'s ${sourceName} to ${dest.name} as ${name === sourceName ? id : `${name} (${id})`}: ${portedText(pictured, carried)}. It's a draft.`,
  };
}

/** What a port took: "its blocks, picture, spawns and boundaries". */
export function portedText(pictured: boolean, carried: readonly CarryKind[]): string {
  const parts = ["blocks", ...(pictured ? ["picture"] : []), ...carried.map((kind) => CARRY_LABELS[kind].toLowerCase())];
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `its ${list}${carried.length === 0 ? ", with no markup yet" : ""}`;
}

/** Every game and the lobby, with their maps, map.borrow and the rules their maps are checked against. */
async function portGames(root: string): Promise<(PortGame & { mapsDir: string; rules: EditorRules })[]> {
  return (await listTargets(root)).map((target) => ({
    id: target.id,
    name: target.name,
    maps: target.maps,
    mapsDir: target.mapsDir,
    rules: target.rules,
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
