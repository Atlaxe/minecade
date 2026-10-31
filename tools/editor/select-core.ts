// Select mode's host logic with no I/O, kept apart so it can be unit-tested: where an extracted map
// goes (the offset that puts its middle at x 0, z 0), the chunks Chunker keeps, a new map's draft
// map.json, and the list of maps boxed in a world (work/select/<world>.json).
import type { Box, MapConfig, Vec3 } from "@minecade/minigame-core/config";

/** Chunks, inclusive, the way Chunker's pruning file takes them. */
export interface ChunkRange {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** A map boxed in a world, as kept in work/select/<world>.json. */
export interface Selection {
  target: string;
  map: string;
  name: string;
  /** In the world's own coordinates. */
  box: Box;
  /** What moves the box to the middle. */
  offset: Vec3;
  /** Where the player stood when they saved it, in the world's coordinates: the first spawn. */
  spawn: Vec3;
  status: "queued" | "extracting" | "ready" | "failed" | "updating";
  error?: string;
}

/** A world's file: its name, where it was opened from, and its maps. */
export interface SelectFile {
  world: string;
  path: string;
  selections: Selection[];
}

/** The chunks a box touches. */
export function chunkRange(box: Box): ChunkRange {
  return {
    minX: Math.floor(box.min[0] / 16),
    minZ: Math.floor(box.min[2] / 16),
    maxX: Math.floor(box.max[0] / 16),
    maxZ: Math.floor(box.max[2] / 16),
  };
}

/** What to add to a box to put its middle at x 0, z 0, in whole blocks; heights stay. */
export function centerOffset(box: Box): Vec3 {
  // + 0 turns -0 into 0, so map.json never reads "-0".
  return [-Math.floor((box.min[0] + box.max[0] + 1) / 2) + 0, 0, -Math.floor((box.min[2] + box.max[2] + 1) / 2) + 0];
}

export function moveBox(box: Box, offset: Vec3): Box {
  return { min: add(box.min, offset), max: add(box.max, offset) };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** True when the block `at` is inside the box. */
export function insideBox(box: Box, at: Vec3): boolean {
  return at.every((value, axis) => value >= box.min[axis] && value <= box.max[axis]);
}

/** A new map's map.json: a draft, its first spawn where the player stood, the bounds around it, and where it came from. */
export function draftMap(selection: Pick<Selection, "name" | "box" | "offset" | "spawn">, world: string): MapConfig {
  return {
    name: selection.name,
    draft: true,
    spawns: [add(selection.spawn, selection.offset)],
    bounds: moveBox(selection.box, selection.offset),
    source: { world, box: selection.box, offset: selection.offset },
  };
}

/** A world's file name in work/select: its name, safe as a file name. */
export function worldSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "world";
}

/** A world's file, or undefined when the text isn't one. */
export function parseSelectFile(text: string): SelectFile | undefined {
  try {
    const value = JSON.parse(text) as Partial<SelectFile>;
    if (typeof value.world !== "string" || typeof value.path !== "string" || !Array.isArray(value.selections)) return undefined;
    return { world: value.world, path: value.path, selections: value.selections };
  } catch {
    return undefined;
  }
}

/** Why a map can't be saved under this id for this target, or undefined when it can. */
export function mapIdProblem(map: string, existing: string[], selections: Selection[], target: string): string | undefined {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(map)) return `"${map}" is not a map id: use lower case letters, digits, _ and -`;
  if (existing.includes(map)) return `there is a map "${map}" already`;
  if (selections.some((selection) => selection.target === target && selection.map === map)) return `"${map}" is in this world's list already`;
  return undefined;
}
