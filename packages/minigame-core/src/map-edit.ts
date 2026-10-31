// Changes to a map.json as plain data, shared by the map editor's pack (which shows a change at
// once) and its host tool (which applies the same change and writes the file). Each edit returns a
// new config and never changes the old one; undo keeps the old configs. New keys go where a person
// would write them (spawns near the top, build last), and lists or names left empty are removed.
import { QUEUE_COUNTDOWN, queueSettings, type Box, type Facing, type MapConfig, type MapPosition, type QueueSettings, type Vec3 } from "./map-config.ts";

/** A list of positions in map.json. The spectator and queue spawns are lists of at most one. */
export type MapList =
  | { list: "spawns" }
  | { list: "spectatorSpawn" }
  | { list: "queueSpawn" }
  | { list: "teamSpawns"; team: string }
  | { list: "points"; name: string };

export type MapEdit =
  | { op: "add"; target: MapList; at: MapPosition }
  /** Moves an entry and keeps its facing. */
  | { op: "move"; target: MapList; index: number; at: Vec3 }
  /** Replaces an entry: its position and its facing. */
  | { op: "set"; target: MapList; index: number; at: MapPosition }
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
  | { op: "draft"; draft: boolean }
  /** Changes how players wait at the queue spawn (what's left out stays as it is). */
  | { op: "queue"; mode?: QueueSettings["mode"]; countdown?: number }
  /** Sets (or, with no value, removes) a game-specific key, such as Sumo's eliminationY. */
  | { op: "extra"; key: string; value?: string | number | boolean }
  /** Removes "build", so `npm run bake` no longer rebuilds the world (world edits are kept). */
  | { op: "dropBuild" }
  /** Several edits as one change (one undo step). */
  | { op: "batch"; edits: MapEdit[] };

export class MapEditError extends Error {}

/** True for the keys map.json defines; every other key is a game's own setting. */
export function isMapKey(key: string): boolean {
  return KEY_ORDER.includes(key);
}

/** Where new keys go, the order map.json files are written in. Unknown keys stay where they are. */
const KEY_ORDER: readonly string[] = ["name", "draft", "spawns", "spectatorSpawn", "queueSpawn", "queue", "bounds", "killY", "teamSpawns", "points", "regions", "time", "stars", "cameras", "source", "build"];

export function applyEdit(config: MapConfig, edit: MapEdit): MapConfig {
  switch (edit.op) {
    case "add":
      return setList(config, edit.target, [...listOf(config, edit.target), edit.at]);
    case "move":
      return updateEntry(config, edit.target, edit.index, (entry) => (entry.length === 5 ? [...edit.at, entry[3], entry[4]] : [...edit.at]));
    case "set":
      return updateEntry(config, edit.target, edit.index, () => [...edit.at]);
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
    case "queue": {
      if (config.queueSpawn === undefined) throw new MapEditError("place the queue spawn first");
      const { min, max } = QUEUE_COUNTDOWN;
      if (edit.countdown !== undefined && (!Number.isInteger(edit.countdown) || edit.countdown < min || edit.countdown > max)) {
        throw new MapEditError(`the queue countdown is whole seconds from ${min} to ${max}`);
      }
      const queue = { ...queueSettings(config), ...(edit.mode ? { mode: edit.mode } : {}), ...(edit.countdown !== undefined ? { countdown: edit.countdown } : {}) };
      return withKey(config, "queue", queue);
    }
    case "extra":
      if (isMapKey(edit.key) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(edit.key)) throw new MapEditError(`"${edit.key}" is not a game setting`);
      return withKey(config, edit.key, edit.value);
    case "dropBuild":
      return withKey(config, "build", undefined);
    case "batch":
      return edit.edits.reduce(applyEdit, config);
  }
}

/** A list's place in map.json: "spawns", "spectatorSpawn", "queueSpawn", "teamSpawns.red" or "points.bombA". */
export function listKey(target: MapList): string {
  switch (target.list) {
    case "spawns":
    case "spectatorSpawn":
    case "queueSpawn":
      return target.list;
    case "teamSpawns":
      return `teamSpawns.${target.team}`;
    case "points":
      return `points.${target.name}`;
  }
}

/** A short description of an edit, for logs and undo: "add spawns", "move points.bombA 2". */
export function describeEdit(edit: MapEdit): string {
  switch (edit.op) {
    case "add":
      return `add ${listKey(edit.target)}`;
    case "move":
    case "set":
    case "face":
    case "remove":
      return `${edit.op} ${listKey(edit.target)} ${edit.index + 1}`;
    case "renumber":
      return `renumber ${listKey(edit.target)} ${edit.from + 1} to ${edit.to + 1}`;
    case "addRegion":
      return `add regions.${edit.name}`;
    case "setRegion":
    case "removeRegion":
      return `${edit.op === "setRegion" ? "set" : "remove"} regions.${edit.name} ${edit.index + 1}`;
    case "bounds":
    case "killY":
      return `${edit.op === "bounds" ? (edit.box ? "set" : "clear") : edit.y === undefined ? "clear" : "set"} ${edit.op}`;
    case "name":
      return `rename to "${edit.name}"`;
    case "draft":
      return edit.draft ? "mark as draft" : "publish (no longer a draft)";
    case "queue":
      return ["queue:", edit.mode && (edit.mode === "lock" ? "lock in" : "free"), edit.countdown !== undefined && `${edit.countdown} s countdown`].filter(Boolean).join(" ");
    case "extra":
      return `set ${edit.key}`;
    case "dropBuild":
      return "drop build";
    case "batch":
      return edit.edits.map(describeEdit).join(", ");
  }
}

/** The entries of a list (a copy). */
export function listOf(config: MapConfig, target: MapList): MapPosition[] {
  switch (target.list) {
    case "spawns":
      return [...config.spawns];
    case "spectatorSpawn":
      return config.spectatorSpawn ? [config.spectatorSpawn] : [];
    case "queueSpawn":
      return config.queueSpawn ? [config.queueSpawn] : [];
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
    case "queueSpawn":
      if (list.length > 1) throw new MapEditError("a map has one queue spawn");
      // Without a queue spawn, its settings go too.
      return withKey(list[0] ? config : withKey(config, "queue", undefined), "queueSpawn", list[0]);
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

/**
 * Sets a top-level key in place, adds it in KEY_ORDER's place (a game's own keys go after the map
 * data, before the editor's), or removes it when `value` is undefined.
 */
function withKey(config: MapConfig, key: string, value: unknown): MapConfig {
  const entries = Object.entries(config).filter(([existing]) => existing !== key || value !== undefined);
  if (value === undefined) return Object.fromEntries(entries) as MapConfig;
  const at = entries.findIndex(([existing]) => existing === key);
  if (at >= 0) {
    entries[at] = [key, value];
  } else {
    const rank = KEY_ORDER.includes(key) ? KEY_ORDER.indexOf(key) : KEY_ORDER.indexOf("stars") + 0.5;
    const before = entries.findIndex(([existing]) => KEY_ORDER.includes(existing) && KEY_ORDER.indexOf(existing) > rank);
    entries.splice(before < 0 ? entries.length : before, 0, [key, value]);
  }
  return Object.fromEntries(entries) as MapConfig;
}
