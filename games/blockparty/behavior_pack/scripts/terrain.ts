// Block Party: the board's ground as the walk reads it (walk-plan.ts plans each leg from it), out of
// the world's blocks.
//   - The ground at a point is found by a ray straight down (getBlockFromRay, its faceLocation on the
//     top it meets: a slab's half, snow at its collision; a full block's top comes back as 0), from
//     LOOK_UP over the piece's feet, or from the first open block over a wall when that's inside
//     one. Plants, flowers, vines and carpet aren't ground (passable blocks: a ray goes through);
//     water and lava are no footing (a gap to jump), though a ray goes through them too
//     (docs/spike-results.md, "Walking the test board").
//   - Stairs are read from their states (stairTop): a ray meets a stair's whole block.
//   - Fences and walls stand 1.5 high (a ray meets their block's top, a piece their collision's).
//   - A space's marker is stood on (its invisible floor blocks, which rays don't meet), so the ground
//     on a marker's floor within its reach is the marker's top.
import type { Block, Dimension } from "@minecraft/server";
import { floorOf, type Space } from "./board.ts";
import { FLOOR_BLOCK, MARKER_REACH } from "./space-markers.ts";
import { CLIMBABLE, LOOK_UP, MAX_DROP, stairTop, type TerrainReader } from "./walk-plan.ts";

const DOWN = { x: 0, y: -1, z: 0 };
/** How many blocks up the top of a wall is looked for. */
const MAX_WALL = 12;
/** Blocks whose collision stands half a block over their block (fences, fence gates, walls). */
const TALL = /fence|_wall$/;

export class WorldTerrain implements TerrainReader {
  private readonly dimension: Dimension;
  private readonly spaces: () => readonly Space[];

  constructor(dimension: Dimension, spaces: () => readonly Space[]) {
    this.dimension = dimension;
    this.spaces = spaces;
  }

  ground(x: number, z: number, near: number): number | undefined {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    let from = near + LOOK_UP;
    try {
      // Inside something (a wall taller than the look, or a plant): look down from the first open block over it.
      let cell = this.dimension.getBlock({ x: bx, y: Math.floor(from), z: bz });
      for (let up = 0; cell && !cell.isAir && !cell.isLiquid && up < MAX_WALL; up++) {
        from = Math.floor(from) + 1.5;
        cell = this.dimension.getBlock({ x: bx, y: Math.floor(from), z: bz });
      }
      if (cell?.isLiquid) return undefined;
      const hit = this.dimension.getBlockFromRay({ x, y: from, z }, DOWN, { maxDistance: from - near + MAX_DROP, includeLiquidBlocks: true, includePassableBlocks: false });
      if (!hit || hit.block.isLiquid) return undefined;
      // The ray goes through water and lava (passable blocks, checked 2026-11-20): over the ground it
      // met, they're no footing.
      for (let y = hit.block.location.y + 1; y <= Math.floor(from); y++) {
        if (this.dimension.getBlock({ x: bx, y, z: bz })?.isLiquid) return undefined;
      }
      return onMarker(this.spaces(), x, z, surface(hit.block, hit.faceLocation.y, x, z));
    } catch {
      // unloaded, or out of the world
      return undefined;
    }
  }

  climbable(x: number, y: number, z: number): boolean {
    try {
      const block = this.dimension.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
      return block !== undefined && CLIMBABLE.has(block.typeId);
    } catch {
      return false;
    }
  }

}

/** The ground at (x, z) whose top is `top`, with the spaces' markers: on a marker's floor within its reach, the marker's top. */
export function onMarker(spaces: readonly Space[], x: number, z: number, top: number): number {
  for (const space of spaces) {
    if (Math.abs(x - space.at[0]) <= MARKER_REACH[0] && Math.abs(z - space.at[2]) <= MARKER_REACH[1] && Math.abs(top - floorOf(space)) < 0.3) return Math.max(top, space.at[1]);
  }
  return top;
}

/** The top of the block a ray met at height `faceY` inside it, where a piece stands on it at (x, z). */
function surface(block: Block, faceY: number, x: number, z: number): number {
  const id = block.typeId;
  const base = block.location.y;
  if (id === FLOOR_BLOCK) return base;
  if (id.endsWith("_stairs")) return base + stairTop(block.permutation.getAllStates(), x - Math.floor(x), z - Math.floor(z));
  if (TALL.test(id)) return base + 1.5;
  // A full block's top comes back as 0, not 1 (the server's raycast, checked 2026-11-20: a slab's is
  // 0.5), and nothing a ray down stops on has its top at its block's bottom.
  return base + (faceY < 0.001 ? 1 : faceY);
}
