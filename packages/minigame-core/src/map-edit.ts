// Changes to a map.json as plain data, shared by the map editor's pack (which shows a change at
// once) and its host tool (which applies the same change and writes the file). Each edit returns a
// new config and never changes the old one; undo keeps the old configs. New keys go where a person
// would write them (spawns near the top, build last), and lists or names left empty are removed.
import type { Box, Facing, MapConfig, MapPosition, Vec3 } from "./map-config.ts";

/** A list of positions in map.json. The spectator spawn is a list of at most one. */
export type MapList =
  | { list: "spawns" }
  | { list: "spectatorSpawn" }
  | { list: "teamSpawns"; team: string }
  | { list: "points"; name: string };

export type MapEdit =
  | { op: "add"; target: MapList; at: MapPosition }
  /** Moves an entry and keeps its facing. */
  | { op: "move"; target: MapList; index: number; at: Vec3 }
  /** Sets a fixed facing, or clears it (the entry faces the map's middle again). */
  | { op: "face"; target: MapList; index: number; facing?: Facing }
  | { op: "remove"; target: MapList; index: number }
  /** Moves entry `from` to place `to`; the others shift. */
  | { op: "renumber"; target: MapList; from: number; to: number }
  | { op: "bounds"; box?: Box }
  | { op: "killY"; y?: number }
  | { op: "addRegion"; name: string; box: Box }
  | { op: "setRegion"; name: string; index: number; box: Box }
  | { op: "removeRegion"; name: string; index: number }
  | { op: "name"; name: string }
  | { op: "draft"; draft: boolean };

export class MapEditError extends Error {}

/** Where new keys go, the order map.json files are written in. Unknown keys stay where they are. */
const KEY_ORDER = ["name", "draft", "spawns", "spectatorSpawn", "bounds", "killY", "teamSpawns", "points", "regions", "time", "stars", "cameras", "source", "build"];

export function applyEdit(config: MapConfig, edit: MapEdit): MapConfig {
  switch (edit.op) {
    case "add":
      return setList(config, edit.target, [...listOf(config, edit.target), edit.at]);
    case "move":
      return updateEntry(config, edit.target, edit.index, (entry) => (entry.length === 5 ? [...edit.at, entry[3], entry[4]] : [...edit.at]));
    case "face":
      return updateEntry(config, edit.target, edit.index, (entry) => (edit.facing ? [entry[0], entry[1], entry[2], edit.facing.yaw, edit.facing.pitch] : [entry[0], entry[1], entry[2]]));
    case "remove": {
      const list = listOf(config, edit.target);
      checkIndex(list, edit.index);
      return setList(config, edit.target, list.filter((_, i) => i !== edit.index));
    }
    case "renumber": {
      const list = [...listOf(config, edit.target)];
      checkIndex(list, edit.from);
      checkIndex(list, edit.to);
      const [entry] = list.splice(edit.from, 1);
      list.splice(edit.to, 0, entry);
      return setList(config, edit.target, list);
    }
    case "bounds":
      return withKey(config, "bounds", edit.box);
    case "killY":
      return withKey(config, "killY", edit.y);
    case "addRegion":
      return setRegion(config, edit.name, [...(config.regions?.[edit.name] ?? []), edit.box]);
    case "setRegion": {
      const boxes = config.regions?.[edit.name] ?? [];
      checkIndex(boxes, edit.index);
      return setRegion(config, edit.name, boxes.map((box, i) => (i === edit.index ? edit.box : box)));
    }
    case "removeRegion": {
      const boxes = config.regions?.[edit.name] ?? [];
      checkIndex(boxes, edit.index);
      return setRegion(config, edit.name, boxes.filter((_, i) => i !== edit.index));
    }
    case "name":
      if (!edit.name) throw new MapEditError("a map needs a name");
      return withKey(config, "name", edit.name);
    case "draft":
      return withKey(config, "draft", edit.draft ? true : undefined);
  }
}

/** The entries of a list (a copy). */
export function listOf(config: MapConfig, target: MapList): MapPosition[] {
  switch (target.list) {
    case "spawns":
      return [...config.spawns];
    case "spectatorSpawn":
      return config.spectatorSpawn ? [config.spectatorSpawn] : [];
    case "teamSpawns":
      return [...(config.teamSpawns?.[target.team] ?? [])];
    case "points":
      return [...(config.points?.[target.name] ?? [])];
  }
}

function setList(config: MapConfig, target: MapList, list: MapPosition[]): MapConfig {
  switch (target.list) {
    case "spawns":
      return withKey(config, "spawns", list);
    case "spectatorSpawn":
      if (list.length > 1) throw new MapEditError("a map has one spectator spawn");
      return withKey(config, "spectatorSpawn", list[0]);
    case "teamSpawns":
      return withKey(config, "teamSpawns", withEntry(config.teamSpawns, target.team, list));
    case "points":
      return withKey(config, "points", withEntry(config.points, target.name, list));
  }
}

function setRegion(config: MapConfig, name: string, boxes: Box[]): MapConfig {
  return withKey(config, "regions", withEntry(config.regions, name, boxes));
}

function updateEntry(config: MapConfig, target: MapList, index: number, change: (entry: MapPosition) => number[]): MapConfig {
  const list = listOf(config, target);
  checkIndex(list, index);
  return setList(config, target, list.map((entry, i) => (i === index ? (change(entry) as MapPosition) : entry)));
}

function checkIndex(list: unknown[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new MapEditError(`there is no entry ${index + 1} (the list has ${list.length})`);
}

/** A record with `name` set to `list`, or without it when the list is empty; undefined when nothing is left. */
function withEntry<T>(record: Record<string, T[]> | undefined, name: string, list: T[]): Record<string, T[]> | undefined {
  const next: Record<string, T[]> = { ...record };
  if (list.length > 0) next[name] = list;
  else delete next[name];
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Sets a top-level key in place, adds it in KEY_ORDER's place, or removes it when `value` is undefined. */
function withKey(config: MapConfig, key: string, value: unknown): MapConfig {
  const entries = Object.entries(config).filter(([existing]) => existing !== key || value !== undefined);
  if (value === undefined) return Object.fromEntries(entries) as MapConfig;
  const at = entries.findIndex(([existing]) => existing === key);
  if (at >= 0) {
    entries[at] = [key, value];
  } else {
    const rank = KEY_ORDER.indexOf(key);
    const before = entries.findIndex(([existing]) => KEY_ORDER.includes(existing) && KEY_ORDER.indexOf(existing) > rank);
    entries.splice(before < 0 ? entries.length : before, 0, [key, value]);
  }
  return Object.fromEntries(entries) as MapConfig;
}
