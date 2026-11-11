// What a click with Select picks besides a marker, as plain math: a box or a height whose outline
// passes near the pointer (on the canvas), a region the pointer's ray goes into before it reaches
// a block, or a box or height with nothing behind it. The bounds and the spectator bounds usually
// hold the whole map, so a click on a block inside them still picks nothing. Plain TypeScript, tested.
import type { Box } from "@minecade/minigame-core/config";

type V3 = readonly [number, number, number];

/** The cuts as the viewer keeps them (scene.ts's Cuts): the top layer kept, and the x and z cuts. */
export interface KeptCuts {
  top?: number;
  x?: { at: number; side: "below" | "above" };
  z?: { at: number; side: "below" | "above" };
}

/** The part of a box (whole blocks) the cuts keep, or undefined when they keep none of it. */
export function keptBox(box: Box, cuts: KeptCuts): Box | undefined {
  const min = [...box.min] as [number, number, number];
  const max = [...box.max] as [number, number, number];
  if (cuts.top !== undefined) max[1] = Math.min(max[1], cuts.top);
  for (const [axis, cut] of [[0, cuts.x], [2, cuts.z]] as const) {
    if (!cut) continue;
    if (cut.side === "below") max[axis] = Math.min(max[axis], cut.at);
    else min[axis] = Math.max(min[axis], cut.at);
  }
  return min.every((value, axis) => value <= max[axis]) ? { min, max } : undefined;
}

/**
 * Where a ray goes into and out of a box of whole blocks (from min to max + 1), as distances along
 * it (enter is below 0 when the ray starts inside), or undefined when it misses the box.
 */
export function rayBox(origin: V3, direction: V3, box: Box): { enter: number; exit: number } | undefined {
  let enter = -Infinity;
  let exit = Infinity;
  for (const axis of [0, 1, 2] as const) {
    const low = box.min[axis];
    const high = box.max[axis] + 1;
    const d = direction[axis];
    const o = origin[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < low || o > high) return undefined;
      continue;
    }
    const a = (low - o) / d;
    const b = (high - o) / d;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return enter <= exit && exit >= 0 ? { enter, exit } : undefined;
}

/** A box a click can pick: its key, the part of it the cuts keep, and whether it's a bounds box (may hold the whole map). */
export interface PickBox {
  key: string;
  box: Box;
  bounds?: boolean;
}

const volume = (box: Box) => (box.max[0] - box.min[0] + 1) * (box.max[1] - box.min[1] + 1) * (box.max[2] - box.min[2] + 1);

/**
 * The box a click picks by its inside, the ray's distance to the first block being `block`
 * (Infinity for none): the smallest of the regions the ray goes into before that block, and of the
 * bounds boxes it comes out of before it (nothing behind them). A box the camera is in is left out:
 * every way it looks is that box's inside.
 */
export function boxUnder(origin: V3, direction: V3, boxes: readonly PickBox[], block: number): string | undefined {
  let best: { key: string; size: number } | undefined;
  for (const candidate of boxes) {
    const hit = rayBox(origin, direction, candidate.box);
    if (!hit || hit.enter < 0) continue;
    if (candidate.bounds ? hit.exit > block : hit.enter > block) continue;
    const size = volume(candidate.box);
    if (!best || size < best.size) best = { key: candidate.key, size };
  }
  return best?.key;
}

/** The level rectangle a height's sheet spans (overlay.ts draws it one block past the blocks' box). */
export interface SheetRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** How far along a ray it crosses a height's sheet at y, inside its rectangle, or undefined when it doesn't. */
export function raySheet(origin: V3, direction: V3, y: number, rect: SheetRect): number | undefined {
  if (Math.abs(direction[1]) < 1e-12) return undefined;
  const t = (y - origin[1]) / direction[1];
  if (t < 0) return undefined;
  const x = origin[0] + direction[0] * t;
  const z = origin[2] + direction[2] * t;
  return x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1 ? t : undefined;
}

/** The height a click picks by its sheet: the nearest one the ray crosses, only when the ray meets no block at all. */
export function sheetUnder(origin: V3, direction: V3, sheets: readonly { key: string; y: number }[], rect: SheetRect, block: number): string | undefined {
  if (Number.isFinite(block)) return undefined;
  let best: { key: string; t: number } | undefined;
  for (const sheet of sheets) {
    const t = raySheet(origin, direction, sheet.y, rect);
    if (t !== undefined && (!best || t < best.t)) best = { key: sheet.key, t };
  }
  return best?.key;
}

/** How far a spot (x, y) is from a segment on the canvas, in pixels. */
export function segmentDistance(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = dx * dx + dy * dy;
  const s = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length));
  return Math.hypot(x - (x0 + s * dx), y - (y0 + s * dy));
}

/** A box's 12 edges, corner to corner, from min to max + 1. */
export function boxEdges(box: Box): [V3, V3][] {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = [box.max[0] + 1, box.max[1] + 1, box.max[2] + 1];
  const edges: [V3, V3][] = [];
  for (const y of [y0, y1]) {
    for (const z of [z0, z1]) edges.push([[x0, y, z], [x1, y, z]]);
    for (const x of [x0, x1]) edges.push([[x, y, z0], [x, y, z1]]);
  }
  for (const x of [x0, x1]) for (const z of [z0, z1]) edges.push([[x, y0, z], [x, y1, z]]);
  return edges;
}

/** A height sheet's 4 edges at y. */
export function sheetEdges(y: number, rect: SheetRect): [V3, V3][] {
  const corners: V3[] = [[rect.x0, y, rect.z0], [rect.x1, y, rect.z0], [rect.x1, y, rect.z1], [rect.x0, y, rect.z1]];
  return corners.map((corner, i) => [corner, corners[(i + 1) % 4]]);
}
