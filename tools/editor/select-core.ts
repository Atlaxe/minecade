// Select mode's host logic with no I/O, kept apart so it can be unit-tested: where an extracted map
// goes (the offset that puts its middle at x 0, z 0), the chunks Chunker keeps, a new map's draft
// map.json and its spectator spawn, and the list of maps boxed in a world (work/select/<world>.json).
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
  /** Where the player stood when they saved it (lists from before spawns moved to Edit; unused). */
  spawn?: Vec3;
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

/**
 * A new map's map.json: a draft with no spawns yet (they're placed in Edit), the bounds around it,
 * and where it came from. withSpectatorSpawn adds its spectator spawn once it's moved.
 */
export function draftMap(selection: Pick<Selection, "name" | "box" | "offset">, world: string): MapConfig {
  return {
    name: selection.name,
    draft: true,
    spawns: [],
    bounds: moveBox(selection.box, selection.offset),
    source: { world, box: selection.box, offset: selection.offset },
  };
}

/** How far above a new map's highest block its spectator spawn goes. */
export const SPECTATOR_ABOVE = 10;
/** The world's highest block. */
const TOP_Y = 319;

/**
 * A new map with its spectator spawn over the middle of its bounds, SPECTATOR_ABOVE blocks above
 * its highest block (`top`; the bounds' top when the box held nothing), where everyone arrives in
 * Edit. The bounds reach up past it, since every spawn must be inside them.
 */
export function withSpectatorSpawn(config: MapConfig, top: number | undefined): MapConfig {
  const bounds = moveBox(config.source?.box ?? { min: [0, 0, 0], max: [0, 0, 0] }, config.source?.offset ?? [0, 0, 0]);
  const middle = (axis: 0 | 2) => Math.floor((bounds.min[axis] + bounds.max[axis] + 1) / 2) + 0;
  const y = Math.min((top ?? bounds.max[1]) + SPECTATOR_ABOVE, TOP_Y - 2);
  // Right after the spawns in map.json.
  const { name, draft, spawns, ...rest } = config;
  return {
    name,
    ...(draft !== undefined ? { draft } : {}),
    spawns,
    spectatorSpawn: [middle(0), y, middle(2)],
    ...rest,
    bounds: { min: bounds.min, max: [bounds.max[0], Math.max(bounds.max[1], y + 2), bounds.max[2]] },
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
