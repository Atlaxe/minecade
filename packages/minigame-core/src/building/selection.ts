// The building games' selection tools (Build Swap, Guess the Build), a small WorldEdit inside a
// builder's own area: the wand (a wooden axe, from /wand) picks two corners, left click the first
// and right click the second, and the box between them shows in particle dots to its builder alone;
// /set fills it with a block, /replace swaps one block for another in it, and /fix, standing in
// water or lava, levels the pool around you into still liquid. Everything stays inside the area
// being built. Bedrock reads "//wand" as a command named "/wand" and stops at the second slash
// (docs/spike-results.md, "Custom command names"), so the commands take one slash. Pure geometry
// here; the world side is in building-game.ts.
import type { Box, Vec3 } from "../map-config.ts";

/** The selection wand: any wooden axe, as WorldEdit's. */
export const WAND = "minecraft:wooden_axe";
export const WAND_NAME = "Selection Wand";
/** /fix reaches this far from where the player stands (WorldEdit's fixwater radius, the user's 7). */
export const FIX_RADIUS = 7;
/** The most blocks one fillBlocks call takes. */
export const FILL_LIMIT = 32768;
/** The selection's dots: yellow, as the map editor's Select. */
export const SELECTION_HEX = 0xffff55;

export interface Corners {
  first?: Vec3;
  second?: Vec3;
}

/** The box two corners span (one corner alone is a single block). */
export function cornersBox(corners: Corners): Box | undefined {
  const a = corners.first ?? corners.second;
  const b = corners.second ?? corners.first;
  if (!a || !b) return undefined;
  return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
}

/** How many blocks a box holds. */
export function boxVolume(box: Box): number {
  return (box.max[0] - box.min[0] + 1) * (box.max[1] - box.min[1] + 1) * (box.max[2] - box.min[2] + 1);
}

/** The part of `box` inside `within`, or undefined when they don't meet. */
export function clipBox(box: Box, within: Box): Box | undefined {
  const min = [0, 1, 2].map((axis) => Math.max(box.min[axis], within.min[axis])) as Vec3;
  const max = [0, 1, 2].map((axis) => Math.min(box.max[axis], within.max[axis])) as Vec3;
  return min.every((value, axis) => value <= max[axis]) ? { min, max } : undefined;
}

/** "5 x 3 x 2 (30 blocks)". */
export function sizeText(box: Box): string {
  const [w, h, d] = [0, 1, 2].map((axis) => box.max[axis] - box.min[axis] + 1);
  const count = w * h * d;
  return `${w} x ${h} x ${d} (${count === 1 ? "1 block" : `${count} blocks`})`;
}

/** A box cut into pieces of at most `limit` blocks each (whole layers of it, or columns of a wide one), for fillBlocks. */
export function fillPieces(box: Box, limit = FILL_LIMIT): Box[] {
  const [w, , d] = [0, 1, 2].map((axis) => box.max[axis] - box.min[axis] + 1);
  if (w * d > limit) {
    // Wider than a fill takes in one layer: by rows of x first.
    const rows = Math.max(1, Math.floor(limit / d));
    const pieces: Box[] = [];
    for (let x = box.min[0]; x <= box.max[0]; x += rows) pieces.push(...fillPieces({ min: [x, box.min[1], box.min[2]], max: [Math.min(x + rows - 1, box.max[0]), box.max[1], box.max[2]] }, limit));
    return pieces;
  }
  const layers = Math.max(1, Math.floor(limit / (w * d)));
  const pieces: Box[] = [];
  for (let y = box.min[1]; y <= box.max[1]; y += layers) pieces.push({ min: [box.min[0], y, box.min[2]], max: [box.max[0], Math.min(y + layers - 1, box.max[1]), box.max[2]] });
  return pieces;
}

/** What /fix finds at a block: the pool's liquid, air it fills, or anything else (a wall). */
export type FixCell = "liquid" | "air" | "other";

/**
 * The blocks /fix turns to still liquid, from `start` (the block the player stands in): every block
 * of the pool's liquid or air joined to it, never higher than `start`, within `radius` of it and
 * inside `box` (WorldEdit's fixwater: a pool levelled to where you stand, its gaps filled).
 */
export function fixCells(start: Vec3, kindAt: (at: Vec3) => FixCell, box: Box, radius = FIX_RADIUS): Vec3[] {
  const key = (at: Vec3) => at.join(",");
  const inBox = (at: Vec3) => at.every((value, axis) => value >= box.min[axis] && value <= box.max[axis]);
  const seen = new Set<string>([key(start)]);
  const found: Vec3[] = [];
  const queue: Vec3[] = [start];
  while (queue.length > 0) {
    const at = queue.shift()!;
    found.push(at);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]] as const) {
      const next: Vec3 = [at[0] + dx, at[1] + dy, at[2] + dz];
      if (seen.has(key(next))) continue;
      seen.add(key(next));
      if (next[1] > start[1] || !inBox(next)) continue;
      if (Math.hypot(next[0] - start[0], next[1] - start[1], next[2] - start[2]) > radius) continue;
      if (kindAt(next) === "other") continue;
      queue.push(next);
    }
  }
  return found;
}
