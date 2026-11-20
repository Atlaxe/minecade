// Block Party's test board: the board the game lays when its map has no spaces of its own (Probe's
// Default map, out in the void beside the platform). 12 spaces in a loop, 8 blocks apart, every
// stretch between two of them with something to get over, so one lap shows every move the walk
// makes (walk-plan.ts; docs/plans/block-party.md, "Moving over the board"):
//   1 to 2   stairs up 2           7 to 8    a stair down, then a drop of 2
//   2 to 3   a ladder down 2       8 to 9    carpet, snow, a daylight detector, a slab
//   3 to 4   a block up (jumped)   9 to 10   a gap of 3 over water
//   4 to 5   a gap of 2 (void)     10 to 11  vines up 2
//   5 to 6   a slab down           11 to 12  stairs down 2
//   6 to 7   a ladder up 3         12 to 1   a hurdle (a block in the way, jumped over)
// The path is 3 blocks wide, each space on a floor of its own at its height (3 along by 7 across, so
// Chris and the Wandering Trader have room beside it; 5 by 5 at the corners), the plaza in the middle
// for the NPCs. Pure apart from layTestBoard, so the tests can check the layout and walk it.
import { BlockPermutation, BlockVolume, type Dimension } from "@minecraft/server";
import { describeError, log } from "@minecade/minigame-core";
import { STAND, TEST_OPENINGS, TEST_STARS, TEST_TYPES, type Space, type Vec3 } from "./board.ts";

/** Blocks between spaces, center to center. */
export const TEST_SPACING = 8;
/** Each space: blocks east and south of the board's middle, and its floor's height over the board's floor. */
export const TEST_SPACES: readonly (readonly [number, number, number])[] = [
  [-12, -12, 0],
  [-4, -12, 2],
  [4, -12, 0],
  [12, -12, 1],
  [12, -4, 1],
  [12, 4, 0],
  [12, 12, 3],
  [4, 12, 0],
  [-4, 12, 0],
  [-12, 12, 0],
  [-12, 4, 2],
  [-12, -4, 0],
];
/** The corners of the loop (a 5 by 5 floor). */
const CORNERS: ReadonlySet<number> = new Set([0, 3, 6, 9]);

export const PATH_BLOCK = "minecraft:smooth_stone";
const STAIRS = "minecraft:stone_brick_stairs";
const SLAB = "minecraft:smooth_stone_slab";
const BASIN = "minecraft:stone_bricks";

type States = Record<string, string | number | boolean>;
/** One of a stretch's 5 path blocks: its height over the board's floor (a column of path), what stands on it, or nothing (a gap) or water. */
interface PathCell {
  h?: number;
  /** A block on the column's top, and how many up (a ladder or vines). */
  top?: { block: string; states: States; stack?: number };
  gap?: true;
  water?: true;
}

/** The way a stretch goes, as stairs' weirdo_direction counts it (0 east, 1 west, 2 south, 3 north). */
type Way = 0 | 1 | 2 | 3;
const OPPOSITE: readonly Way[] = [1, 0, 3, 2];
/** A ladder's facing_direction facing each way (2 north, 3 south, 4 west, 5 east). */
const LADDER_FACING = [5, 4, 3, 2];
/** The vine_direction_bits for a vine on the side of its block each way (1 south, 2 west, 4 north, 8 east). */
const VINE_SIDE = [8, 2, 1, 4];

/** Stairs going up the way `way` (their high half that way). */
const stairs = (way: Way): PathCell["top"] => ({ block: STAIRS, states: { weirdo_direction: way, upside_down_bit: false } });
const slab: PathCell["top"] = { block: SLAB, states: { "minecraft:vertical_half": "bottom" } };
/** A ladder on the wall the way `wall` from it, `stack` high. */
const ladder = (wall: Way, stack: number): PathCell["top"] => ({ block: "minecraft:ladder", states: { facing_direction: LADDER_FACING[OPPOSITE[wall]] }, stack });
const vines = (wall: Way, stack: number): PathCell["top"] => ({ block: "minecraft:vine", states: { vine_direction_bits: VINE_SIDE[wall] }, stack });

/** Each stretch's 5 path blocks (from the space it leaves), going the way `way`. */
const STRETCHES: readonly ((way: Way) => PathCell[])[] = [
  // Stairs up 2.
  (way) => [{ h: 0 }, { h: 0, top: stairs(way) }, { h: 1, top: stairs(way) }, { h: 2 }, { h: 2 }],
  // A ladder down 2, on the wall behind.
  (way) => [{ h: 2 }, { h: 2 }, { h: 0, top: ladder(OPPOSITE[way], 2) }, { h: 0 }, { h: 0 }],
  // A block up, jumped.
  () => [{ h: 0 }, { h: 0 }, { h: 1 }, { h: 1 }, { h: 1 }],
  // A gap of 2 over the void.
  () => [{ h: 1 }, { gap: true }, { gap: true }, { h: 1 }, { h: 1 }],
  // A slab down.
  () => [{ h: 1 }, { h: 0, top: slab }, { h: 0 }, { h: 0 }, { h: 0 }],
  // A ladder up 3, on the wall ahead.
  (way) => [{ h: 0 }, { h: 0 }, { h: 0, top: ladder(way, 3) }, { h: 3 }, { h: 3 }],
  // A stair down, then a drop of 2.
  (way) => [{ h: 3 }, { h: 2, top: stairs(OPPOSITE[way]) }, { h: 2 }, { h: 0 }, { h: 0 }],
  // Partial blocks: carpet, snow 4 layers deep, a daylight detector, a slab, carpet.
  () => [
    { h: 0, top: { block: "minecraft:white_carpet", states: {} } },
    { h: 0, top: { block: "minecraft:snow_layer", states: { height: 3, covered_bit: false } } },
    { h: 0, top: { block: "minecraft:daylight_detector", states: {} } },
    { h: 0, top: slab },
    { h: 0, top: { block: "minecraft:white_carpet", states: {} } },
  ],
  // A gap of 3 over water.
  () => [{ h: 0 }, { water: true }, { water: true }, { water: true }, { h: 0 }],
  // Vines up 2, on the wall ahead.
  (way) => [{ h: 0 }, { h: 0 }, { h: 0, top: vines(way, 2) }, { h: 2 }, { h: 2 }],
  // Stairs down 2.
  (way) => [{ h: 2 }, { h: 1, top: stairs(OPPOSITE[way]) }, { h: 0, top: stairs(OPPOSITE[way]) }, { h: 0 }, { h: 0 }],
  // A hurdle: a block in the way, jumped over.
  () => [{ h: 0 }, { h: 0 }, { h: 1 }, { h: 0 }, { h: 0 }],
];

/** The test board's spaces, `middle` the board's middle (y its floor, the top of its path). */
export function testBoardSpaces(middle: Vec3): Space[] {
  const [mx, y, mz] = middle;
  return TEST_SPACES.map(([dx, dz, h], index) => ({
    index,
    type: TEST_TYPES[index % TEST_TYPES.length],
    at: [Math.floor(mx) + dx + 0.5, y + h + STAND, Math.floor(mz) + dz + 0.5],
    floor: y + h,
    next: [(index + 1) % TEST_SPACES.length],
    ...(TEST_STARS.includes(index) ? { star: true } : {}),
    ...(TEST_OPENINGS.includes(index) ? { opening: true } : {}),
  }));
}

/** What laying the board does, in order: boxes filled with a block, then single blocks. */
export interface BoardBlocks {
  fills: { from: Vec3; to: Vec3; block: string }[];
  blocks: { at: Vec3; block: string; states: States }[];
}

/** Every block of the test board around `middle` (y its floor): floors and path columns first, then what stands on them, the water last. */
export function testBoardBlocks(middle: Vec3): BoardBlocks {
  const cx = Math.floor(middle[0]);
  const cz = Math.floor(middle[2]);
  // The top block of the path at the board's floor height.
  const base = middle[1] - 1;
  const fills: BoardBlocks["fills"] = [];
  const blocks: BoardBlocks["blocks"] = [];
  const water: BoardBlocks["blocks"] = [];
  const column = (x: number, z: number, h: number): void => void fills.push({ from: [x, base, z], to: [x, base + h, z], block: PATH_BLOCK });
  // The plaza in the middle, for the NPCs.
  fills.push({ from: [cx - 6, base, cz - 6], to: [cx + 6, base, cz + 6], block: PATH_BLOCK });
  TEST_SPACES.forEach(([dx, dz, h], index) => {
    const [nx, nz] = TEST_SPACES[(index + 1) % TEST_SPACES.length];
    const [sx, sz] = [cx + dx, cz + dz];
    // The space's floor: 5 by 5 at a corner, else 3 along the path by 7 across it.
    const along = Math.sign(nx - dx) !== 0 ? "x" : "z";
    const [reachX, reachZ] = CORNERS.has(index) ? [2, 2] : along === "x" ? [1, 3] : [3, 1];
    fills.push({ from: [sx - reachX, base, sz - reachZ], to: [sx + reachX, base + h, sz + reachZ], block: PATH_BLOCK });
    // The stretch to the next space: 5 path blocks, 3 wide.
    const [ux, uz] = [Math.sign(nx - dx), Math.sign(nz - dz)];
    const way: Way = ux > 0 ? 0 : ux < 0 ? 1 : uz > 0 ? 2 : 3;
    STRETCHES[index](way).forEach((cell, i) => {
      for (const side of [-1, 0, 1]) {
        const x = sx + ux * (i + 2) - uz * side;
        const z = sz + uz * (i + 2) + ux * side;
        if (cell.gap) continue;
        if (cell.water) {
          water.push({ at: [x, base, z], block: "minecraft:water", states: {} });
          fills.push({ from: [x, base - 1, z], to: [x, base - 1, z], block: BASIN });
          // The basin's sides, beside the path.
          if (side !== 0) fills.push({ from: [x - uz * side, base, z + ux * side], to: [x - uz * side, base, z + ux * side], block: BASIN });
          continue;
        }
        const h = cell.h ?? 0;
        column(x, z, h);
        if (cell.top) for (let up = 1; up <= (cell.top.stack ?? 1); up++) blocks.push({ at: [x, base + h + up, z], block: cell.top.block, states: cell.top.states });
      }
    });
  });
  return { fills, blocks: [...blocks, ...water] };
}

/** Lays the test board around `middle` in the world (any block that won't go is reported and left out). */
export function layTestBoard(dimension: Dimension, middle: Vec3): void {
  const { fills, blocks } = testBoardBlocks(middle);
  for (const { from, to, block } of fills) {
    try {
      dimension.fillBlocks(new BlockVolume({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] }), block);
    } catch (error) {
      log.warn(`blockparty: the test board's ${block} at ${from.join(" ")} failed: ${describeError(error)}`);
    }
  }
  for (const { at, block, states } of blocks) {
    try {
      dimension.getBlock({ x: at[0], y: at[1], z: at[2] })?.setPermutation(BlockPermutation.resolve(block, states));
    } catch (error) {
      log.warn(`blockparty: the test board's ${block} at ${at.join(" ")} failed: ${describeError(error)}`);
    }
  }
}
