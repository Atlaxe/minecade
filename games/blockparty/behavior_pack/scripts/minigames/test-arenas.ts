// The test arenas of the minigames not built yet (docs/plans/block-party-minigames.md, piece 4; the
// user, 2026-11-26): for each, a plain platform laid in code with the marks its arena map's checklist
// asks for (arenas.ts) and only the shapes its rules can't do without (a ladder wall, a water lane).
// Testing only: the Tests menu's Test arenas lays one to look at, and a minigame's code plays on its
// own while it has no arena map, in dev mode only. Never dressed up: the user builds the real arenas.
// A built minigame's test arena is its MinigameDef's own (size, build, testField).
//
// Everything here counts from the arena's lowest corner: x across, y up, z along, the floor at y 0
// and players standing at y 1. A spot is the block a player stands in, with its facing (yaw: 0 faces
// +z, 180 -z, -90 +x, 90 -x; then pitch); a region is a box of whole blocks, both corners in.
import { BlockPermutation, BlockVolume, type Dimension, type Vector3 } from "@minecraft/server";
import { STRUCTURE_REGION, type Box, type MapConfig, type MapPosition } from "@minecade/minigame-core/config";
import { MARKUP, TILED } from "./arenas.ts";
import { fill as fillBox, testField, type Field, type Spot, type Vec3, type WorldBox } from "./kit.ts";

/** A block, from the arena's lowest corner. */
export type Cell = readonly [number, number, number];
/** A spot: the block a player stands in, then its yaw and pitch. */
export type At = readonly [number, number, number, number?, number?];
/** A box of whole blocks, both corners in. */
export type Cells = readonly [Cell, Cell];
/** A block id, or one with its states (a ladder's facing, a crop grown). */
export type Block = string | { readonly id: string; readonly states: Readonly<Record<string, string | number | boolean>> };

interface Fill {
  from: Cell;
  to: Cell;
  block: Block;
}

export interface TestArena {
  /** Blocks across (x), up (y) and along (z): one copy's, for a tiled arena. */
  size: Vec3;
  /** Filled in order. */
  fills: Fill[];
  spawns?: At[];
  teamSpawns?: Record<string, At[]>;
  points?: Record<string, At[]>;
  regions?: Record<string, Cells[]>;
  /** Kill Y, from the arena's floor. */
  killY?: number;
}

const STONE = "minecraft:smooth_stone";
const GLASS = "minecraft:glass";
const GOLD = "minecraft:gold_block";
const WATER = "minecraft:water";
const FENCE = "minecraft:oak_fence";
const AIR = "minecraft:air";

const S = 0;
const N = 180;
const E = -90;
const W = 90;

function fill(from: Cell, to: Cell, block: Block = STONE): Fill {
  return { from, to, block };
}

function floor(w: number, d: number, block: Block = STONE, y = 0): Fill {
  return fill([0, y, 0], [w - 1, y, d - 1], block);
}

/** The four sides of a box, from y0 to y1. */
function walls(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, block: Block = GLASS): Fill[] {
  return [fill([x0, y0, z0], [x1, y1, z0], block), fill([x0, y0, z1], [x1, y1, z1], block), fill([x0, y0, z0], [x0, y1, z1], block), fill([x1, y0, z0], [x1, y1, z1], block)];
}

/** Four sides and a roof: a closed room. */
function room(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, block: Block = STONE): Fill[] {
  return [...walls(x0, z0, x1, z1, y0, y1, block), fill([x0, y1 + 1, z0], [x1, y1 + 1, z1], block)];
}

/** A fence around a box's edge at one height. */
function fence(x0: number, z0: number, x1: number, z1: number, y = 1): Fill[] {
  return walls(x0, z0, x1, z1, y, y, FENCE);
}

/** `count` spots from `first`, each `dx`, `dz` on. */
function row(count: number, first: At, dx: number, dz: number): At[] {
  const [x, y, z, ...facing] = first;
  return Array.from({ length: count }, (_, i): At => [x + dx * i, y, z + dz * i, ...facing]);
}

/** A round platform's rows, `r` from its middle. */
function disk(cx: number, cz: number, r: number, y: number, block: Block = STONE): Fill[] {
  const rows: Fill[] = [];
  for (let dz = -r; dz <= r; dz++) {
    const half = Math.floor(Math.sqrt(r * r + r - dz * dz));
    rows.push(fill([cx - half, y, cz + dz], [cx + half, y, cz + dz], block));
  }
  return rows;
}

const grown = (id: string): Block => ({ id, states: { growth: 7 } });

export const TEST_ARENAS: Readonly<Record<string, TestArena>> = {
  // ---- Quick reflexes ----------------------------------------------------------------------
  mobfreeze: {
    size: [20, 10, 50],
    fills: [floor(20, 50), fill([1, 0, 43], [18, 0, 44], GOLD)],
    spawns: row(4, [4, 1, 2, S], 4, 0),
    points: { [MARKUP.mob]: [[10, 1, 47, N]] },
    regions: { [MARKUP.finish]: [[[1, 0, 43], [18, 0, 44]]] },
  },
  simon: {
    size: [30, 10, 16],
    fills: [floor(30, 16)],
    spawns: row(4, [4, 1, 4, S], 7, 0),
    points: { [MARKUP.stations]: row(4, [4, 1, 7, N], 7, 0), [MARKUP.display]: [[15, 4, 14, N]] },
  },
  enderman: {
    size: [20, 10, 20],
    fills: [floor(20, 20)],
    spawns: row(4, [4, 1, 4, S], 4, 0),
    points: { [MARKUP.enderman]: [[10, 1, 16, N]] },
  },
  buttonmash: {
    size: [24, 20, 12],
    fills: [floor(24, 12)],
    spawns: row(4, [3, 1, 3, S], 6, 0),
    points: { [MARKUP.buttons]: row(4, [3, 1, 5, N], 6, 0) },
  },
  anvilrain: {
    size: [20, 20, 20],
    fills: [floor(20, 20)],
    spawns: row(4, [6, 1, 10, S], 3, 0),
    regions: { [MARKUP.floor]: [[[0, 0, 0], [19, 15, 19]]] },
  },
  tntrun: {
    size: [20, 20, 20],
    fills: [floor(20, 20, "minecraft:yellow_concrete", 2), floor(20, 20, "minecraft:orange_concrete", 8), floor(20, 20, "minecraft:red_concrete", 14)],
    spawns: row(4, [6, 15, 10, S], 3, 0),
    regions: { [MARKUP.floor]: [[[0, 2, 0], [19, 14, 19]]] },
    killY: 0,
  },
  eggdrop: {
    size: [20, 20, 20],
    fills: [floor(20, 20)],
    spawns: row(4, [6, 1, 10, S], 3, 0),
    regions: { [MARKUP.drop]: [[[0, 0, 0], [19, 16, 19]]] },
  },
  hottnt: {
    size: [16, 8, 16],
    fills: [floor(16, 16), ...walls(0, 0, 15, 15, 1, 3)],
    spawns: [
      [3, 1, 3, S],
      [12, 1, 3, S],
      [3, 1, 12, N],
      [12, 1, 12, N],
    ],
  },
  holeinwall: {
    size: [16, 10, 30],
    fills: [floor(16, 30), fill([0, 1, 0], [15, 2, 29], WATER), fill([2, 3, 18], [13, 3, 27])],
    spawns: row(4, [3, 4, 22, N], 3, 0),
    regions: { [MARKUP.platform]: [[[2, 3, 18], [13, 3, 27]]], [MARKUP.wallStart]: [[[2, 4, 4], [13, 7, 4]]] },
    killY: 3,
  },

  // ---- Races and courses -------------------------------------------------------------------
  minecarts: {
    size: [30, 8, 40],
    fills: [
      floor(30, 40),
      floor(30, 40, STONE, 1),
      fill([0, 1, 15], [29, 1, 21], WATER),
      ...[7, 9, 11, 26, 28, 30].map((z) => fill([0, 2, z], [29, 2, z], { id: "minecraft:rail", states: { rail_direction: 1 } })),
      fill([0, 1, 35], [29, 1, 39], GOLD),
    ],
    spawns: row(4, [6, 2, 2, S], 6, 0),
    regions: {
      [MARKUP.finish]: [[[0, 1, 35], [29, 1, 39]]],
      [MARKUP.tracks]: [7, 9, 11, 26, 28, 30].map((z): Cells => [[0, 2, z], [29, 2, z]]),
      [MARKUP.waterLanes]: [16, 18, 20].map((z): Cells => [[0, 1, z], [29, 1, z]]),
    },
  },
  risinglava: {
    size: [20, 44, 20],
    fills: [
      floor(20, 20),
      // Steps up one side, then along the next: a block higher each.
      ...Array.from({ length: 20 }, (_, x) => fill([x, x + 1, 1], [x, x + 1, 2])),
      ...Array.from({ length: 17 }, (_, i) => fill([18, 21 + i, 3 + i], [19, 21 + i, 3 + i])),
    ],
    spawns: row(4, [4, 1, 8, S], 3, 0),
    regions: { [MARKUP.rise]: [[[0, 1, 0], [19, 40, 19]]] },
  },
  legbreaker: {
    size: [20, 96, 20],
    fills: [
      floor(20, 20),
      fill([1, 1, 1], [18, 1, 18], WATER),
      ...walls(0, 0, 19, 19, 1, 95),
      // The ledge the players start on, around the open shaft.
      fill([1, 89, 1], [18, 89, 2]),
      fill([1, 89, 17], [18, 89, 18]),
      fill([1, 89, 3], [2, 89, 16]),
      fill([17, 89, 3], [18, 89, 16]),
    ],
    spawns: [
      [1, 90, 1, S],
      [18, 90, 1, S],
      [1, 90, 18, N],
      [18, 90, 18, N],
    ],
    regions: { [MARKUP.bottom]: [[[1, 0, 1], [18, 1, 18]]], [MARKUP.layers]: [[[1, 8, 1], [18, 85, 18]]] },
  },
  // One player's copy: 4 hallways, each ending in a wall of 3 doorways.
  montecarlo: {
    size: [10, 6, 60],
    fills: [
      floor(10, 60),
      fill([0, 1, 0], [0, 3, 59], GLASS),
      fill([9, 1, 0], [9, 3, 59], GLASS),
      ...[0, 14, 28, 42].flatMap((z) => [fill([1, 1, z + 12], [8, 3, z + 12]), ...[2, 4, 7].map((x) => fill([x, 1, z + 12], [x, 2, z + 12], AIR))]),
      fill([1, 0, 56], [8, 0, 59], GOLD),
    ],
    spawns: [[4, 1, 1, S]],
    points: { [MARKUP.hallwayStarts]: [0, 14, 28, 42].map((z): At => [4, 1, z + 1, S]) },
    regions: {
      [MARKUP.hallways]: [0, 14, 28, 42].map((z): Cells => [[1, 0, z], [8, 4, z + 13]]),
      [MARKUP.doors]: [0, 14, 28, 42].flatMap((z) => [2, 4, 7].map((x): Cells => [[x, 1, z + 13], [x, 2, z + 13]])),
      [MARKUP.finish]: [[[1, 0, 56], [8, 0, 59]]],
    },
  },
  ladder: {
    size: [20, 32, 10],
    fills: [
      floor(20, 10),
      fill([0, 1, 6], [19, 27, 6]),
      fill([0, 28, 6], [19, 28, 6], GOLD),
      ...[3, 8, 12, 17].map((x) => fill([x, 1, 5], [x, 27, 5], { id: "minecraft:ladder", states: { facing_direction: 2 } })),
    ],
    spawns: [3, 8, 12, 17].map((x): At => [x, 1, 3, S]),
    regions: { [MARKUP.top]: [[[0, 28, 6], [19, 28, 6]]] },
  },

  // ---- Points and collecting ---------------------------------------------------------------
  scramble: {
    size: [40, 10, 40],
    fills: [floor(40, 40)],
    spawns: [
      [8, 1, 8, S],
      [31, 1, 8, S],
      [8, 1, 31, N],
      [31, 1, 31, N],
    ],
  },
  snowball: {
    size: [30, 10, 50],
    fills: [floor(30, 50)],
    spawns: row(4, [6, 1, 3, S], 6, 0),
    regions: { [MARKUP.targets]: [15, 25, 35, 45].map((z): Cells => [[2, 1, z], [27, 2, z]]) },
  },
  chickens: {
    size: [20, 8, 20],
    fills: [floor(20, 20), ...fence(0, 0, 19, 19)],
    spawns: [
      [5, 1, 5, S],
      [14, 1, 5, S],
      [5, 1, 14, N],
      [14, 1, 14, N],
    ],
    regions: { [MARKUP.pen]: [[[1, 1, 1], [18, 3, 18]]] },
  },
  mining: {
    size: [40, 10, 20],
    fills: [floor(40, 20), ...[2, 12, 22, 32].map((x) => fill([x, 1, 8], [x + 5, 6, 13], "minecraft:stone"))],
    spawns: [2, 12, 22, 32].map((x): At => [x + 2, 1, 4, S]),
    regions: { [MARKUP.mines]: [2, 12, 22, 32].map((x): Cells => [[x, 1, 8], [x + 5, 6, 13]]) },
  },
  slither: {
    size: [30, 8, 30],
    fills: [floor(30, 30, "minecraft:white_concrete")],
    spawns: [
      [5, 1, 5, S],
      [24, 1, 5, S],
      [5, 1, 24, N],
      [24, 1, 24, N],
    ],
    regions: { [MARKUP.floor]: [[[0, 0, 0], [29, 0, 29]]] },
  },
  hookmob: {
    size: [30, 8, 30],
    fills: [
      floor(30, 30),
      ...fence(9, 9, 20, 20),
      fill([13, 0, 2], [16, 0, 5], "minecraft:red_concrete"),
      fill([13, 0, 24], [16, 0, 27], "minecraft:blue_concrete"),
      fill([2, 0, 13], [5, 0, 16], "minecraft:lime_concrete"),
      fill([24, 0, 13], [27, 0, 16], "minecraft:yellow_concrete"),
    ],
    spawns: [
      [14, 1, 6, S],
      [14, 1, 23, N],
      [6, 1, 14, E],
      [23, 1, 14, W],
    ],
    regions: {
      [MARKUP.pits]: [
        [
          [13, 0, 2],
          [16, 0, 5],
        ],
        [
          [13, 0, 24],
          [16, 0, 27],
        ],
        [
          [2, 0, 13],
          [5, 0, 16],
        ],
        [
          [24, 0, 13],
          [27, 0, 16],
        ],
      ],
      [MARKUP.pool]: [[[10, 1, 10], [19, 3, 19]]],
    },
  },
  // One player's (one team's) kitchen: a few crops that grow back, two animal spots, the pantry and
  // the custom blocks pack's kitchen (packs/blocks, Minecade: Kitchen).
  cook: {
    size: [10, 6, 30],
    fills: [
      floor(10, 30),
      fill([1, 0, 8], [8, 0, 12], { id: "minecraft:farmland", states: { moisturized_amount: 7 } }),
      fill([1, 0, 10], [8, 0, 10], WATER),
      fill([1, 1, 8], [8, 1, 8], grown("minecraft:wheat")),
      fill([1, 1, 9], [8, 1, 9], grown("minecraft:carrots")),
      fill([1, 1, 11], [8, 1, 11], grown("minecraft:potatoes")),
      fill([1, 1, 12], [8, 1, 12], grown("minecraft:beetroot")),
      fill([1, 1, 16], [1, 1, 16], "minecraft:crafting_table"),
      fill([3, 1, 16], [3, 1, 16], "minecade:stove"),
      fill([3, 2, 16], [3, 2, 16], "minecade:cooking_pot"),
      fill([5, 1, 16], [5, 1, 16], "minecade:stove"),
      fill([5, 2, 16], [5, 2, 16], "minecade:skillet"),
      fill([7, 1, 16], [7, 1, 16], "minecade:cutting_board"),
      fill([2, 1, 18], [2, 1, 18], "minecade:sink"),
      fill([4, 1, 18], [4, 1, 18], "minecade:trash_bin"),
    ],
    spawns: [
      [4, 1, 2, S],
      [6, 1, 2, S],
    ],
    points: {
      [MARKUP.villager]: [[5, 1, 27, N]],
      [MARKUP.pantry]: [
        [6, 1, 20, N],
        [8, 1, 20, N],
      ],
      [MARKUP.animals]: [
        [2, 1, 4, S],
        [7, 1, 4, S],
      ],
    },
  },

  // ---- Brains ------------------------------------------------------------------------------
  quiz: {
    size: [28, 10, 24],
    fills: [
      floor(28, 24),
      fill([1, 0, 14], [6, 0, 21], "minecraft:red_concrete"),
      fill([8, 0, 14], [13, 0, 21], "minecraft:blue_concrete"),
      fill([15, 0, 14], [20, 0, 21], "minecraft:yellow_concrete"),
      fill([22, 0, 14], [27, 0, 21], "minecraft:lime_concrete"),
    ],
    spawns: row(4, [8, 1, 4, S], 4, 0),
    regions: { [MARKUP.answers]: [1, 8, 15, 22].map((x): Cells => [[x, 0, 14], [x + 5, 0, 21]]) },
  },
  countmobs: {
    size: [30, 12, 30],
    fills: [floor(30, 30), ...fence(8, 10, 21, 21), fill([8, 1, 15], [8, 1, 15], AIR), fill([21, 1, 15], [21, 1, 15], AIR)],
    // Behind the camera, out of its sight.
    spawns: row(4, [3, 1, 0, S], 2, 0),
    points: {
      [MARKUP.penCamera]: [[14, 8, 2, S, 30]],
      [MARKUP.gates]: [
        [2, 1, 15, E],
        [27, 1, 15, W],
      ],
    },
    regions: { [MARKUP.pen]: [[[9, 1, 11], [20, 3, 20]]] },
  },

  // ---- Fights and knock-offs ---------------------------------------------------------------
  kitbrawl: {
    size: [20, 8, 20],
    fills: [floor(20, 20), ...walls(0, 0, 19, 19, 1, 3)],
    spawns: [
      [4, 1, 4, S],
      [15, 1, 4, S],
      [4, 1, 15, N],
      [15, 1, 15, N],
    ],
    killY: -2,
  },
  hill: {
    size: [24, 8, 24],
    fills: [floor(24, 24), fill([9, 1, 9], [14, 2, 14]), fill([9, 2, 9], [14, 2, 14], GOLD)],
    spawns: [
      [4, 1, 4, S],
      [19, 1, 4, S],
      [4, 1, 19, N],
      [19, 1, 19, N],
    ],
    regions: { [MARKUP.hill]: [[[9, 2, 9], [14, 2, 14]]] },
    killY: -2,
  },
  sumoduel: {
    size: [17, 8, 17],
    fills: disk(8, 8, 8, 0),
    spawns: [
      [8, 1, 3, S],
      [8, 1, 13, N],
      [3, 1, 8, E],
      [13, 1, 8, W],
    ],
    killY: -3,
  },
  // Cactus every other block around the edge (a cactus next to another breaks), on sand.
  cactus: {
    size: [20, 8, 20],
    fills: [
      floor(20, 20, "minecraft:sand"),
      ...Array.from({ length: 10 }, (_, i) => [fill([i * 2, 1, 0], [i * 2, 1, 0], "minecraft:cactus"), fill([i * 2, 1, 19], [i * 2, 1, 19], "minecraft:cactus")]).flat(),
      ...Array.from({ length: 8 }, (_, i) => [fill([0, 1, 2 + i * 2], [0, 1, 2 + i * 2], "minecraft:cactus"), fill([19, 1, 3 + i * 2], [19, 1, 3 + i * 2], "minecraft:cactus")]).flat(),
    ],
    spawns: [
      [5, 1, 5, S],
      [14, 1, 5, S],
      [5, 1, 14, N],
      [14, 1, 14, N],
    ],
    killY: -2,
  },
  towers: {
    size: [40, 24, 40],
    fills: [
      [5, 5],
      [34, 5],
      [5, 34],
      [34, 34],
    ].map(([x, z]) => fill([x, 0, z], [x, 20, z])),
    spawns: [
      [5, 21, 5, S],
      [34, 21, 5, S],
      [5, 21, 34, N],
      [34, 21, 34, N],
    ],
    killY: -2,
  },
  survival: {
    size: [30, 8, 30],
    fills: [floor(30, 30), fill([15, 0, 9], [15, 0, 9], GOLD), fill([15, 0, 21], [15, 0, 21], GOLD), fill([9, 0, 15], [9, 0, 15], GOLD), fill([21, 0, 15], [21, 0, 15], GOLD)],
    spawns: [
      [15, 1, 9, S],
      [15, 1, 21, N],
      [9, 1, 15, E],
      [21, 1, 15, W],
    ],
    points: {
      [`${MARKUP.chests}.middle`]: [
        [14, 1, 15],
        [16, 1, 15],
      ],
      [`${MARKUP.chests}.outer`]: [
        [3, 1, 3],
        [26, 1, 3],
        [3, 1, 26],
        [26, 1, 26],
      ],
    },
  },

  // ---- 2v2 ---------------------------------------------------------------------------------
  tugofwar: {
    size: [40, 10, 20],
    fills: [floor(40, 20), floor(40, 20, STONE, 1), fill([17, 1, 6], [22, 1, 14], WATER)],
    teamSpawns: {
      red: [
        [6, 2, 10, E],
        [9, 2, 10, E],
      ],
      blue: [
        [30, 2, 10, W],
        [33, 2, 10, W],
      ],
    },
    points: { [MARKUP.tugCamera]: [[20, 6, 0, S, 15]] },
    regions: { [MARKUP.rope]: [[[4, 2, 10], [35, 2, 10]]] },
  },
  wool: {
    size: [20, 8, 40],
    fills: [floor(20, 40), fill([6, 0, 1], [13, 0, 6], "minecraft:red_concrete"), fill([6, 0, 33], [13, 0, 38], "minecraft:blue_concrete")],
    teamSpawns: {
      red: [
        [7, 1, 8, S],
        [12, 1, 8, S],
      ],
      blue: [
        [7, 1, 31, N],
        [12, 1, 31, N],
      ],
    },
    points: { [`${MARKUP.wool}.red`]: [[9, 1, 3]], [`${MARKUP.wool}.blue`]: [[9, 1, 36]] },
    regions: { [`${MARKUP.base}.red`]: [[[6, 0, 1], [13, 0, 6]]], [`${MARKUP.base}.blue`]: [[[6, 0, 33], [13, 0, 38]]] },
  },
  spleef: {
    size: [24, 10, 24],
    fills: [fill([0, 4, 0], [23, 4, 23], "minecraft:snow")],
    spawns: [
      [5, 5, 5, S],
      [18, 5, 5, S],
      [5, 5, 18, N],
      [18, 5, 18, N],
    ],
    regions: { [MARKUP.floor]: [[[0, 4, 0], [23, 4, 23]]] },
    killY: 0,
  },
  // One team's course: pads over the void, every third a checkpoint.
  parkour: {
    size: [20, 8, 60],
    fills: [
      fill([7, 1, 0], [12, 1, 5]),
      ...[8, 12, 16, 26, 30, 40, 44, 54].map((z) => fill([8, 1, z], [11, 1, z + 1])),
      ...[20, 34, 48].map((z) => fill([8, 1, z], [11, 1, z + 3], GOLD)),
      fill([8, 1, 57], [11, 1, 59], GOLD),
    ],
    spawns: [
      [9, 2, 2, S],
      [10, 2, 2, S],
    ],
    regions: { [MARKUP.checkpoints]: [20, 34, 48].map((z): Cells => [[8, 1, z], [11, 1, z + 3]]), [MARKUP.finish]: [[[8, 1, 57], [11, 1, 59]]] },
    killY: -2,
  },
  // One team's maze, its walls too tall for the walker to see over.
  carryrace: {
    size: [20, 6, 40],
    fills: [
      floor(20, 40),
      fill([0, 1, 0], [0, 3, 39]),
      fill([19, 1, 0], [19, 3, 39]),
      fill([1, 1, 8], [14, 3, 8]),
      fill([5, 1, 16], [18, 3, 16]),
      fill([1, 1, 24], [14, 3, 24]),
      fill([5, 1, 32], [18, 3, 32]),
      fill([1, 0, 36], [18, 0, 39], GOLD),
    ],
    spawns: [
      [9, 1, 2, S],
      [10, 1, 2, S],
    ],
    regions: { [MARKUP.finish]: [[[1, 0, 36], [18, 0, 39]]] },
  },
  cannons: {
    size: [30, 10, 50],
    fills: [floor(30, 50)],
    teamSpawns: {
      red: [
        [12, 1, 3, S],
        [18, 1, 3, S],
      ],
      blue: [
        [12, 1, 46, N],
        [18, 1, 46, N],
      ],
    },
    points: {
      [`${MARKUP.cannon}.red`]: [[15, 1, 1, S]],
      [`${MARKUP.cannon}.blue`]: [[15, 1, 48, N]],
      [`${MARKUP.ammo}.red`]: [[4, 1, 2]],
      [`${MARKUP.ammo}.blue`]: [[25, 1, 47]],
    },
    // Each team's target is the box it shoots at, in front of the other team.
    regions: { [`${MARKUP.target}.red`]: [[[11, 1, 39], [18, 4, 41]]], [`${MARKUP.target}.blue`]: [[[11, 1, 8], [18, 4, 10]]] },
  },

  // ---- 1v3 ---------------------------------------------------------------------------------
  // The gauntlet with one trap of each kind, and the master's booth beside it.
  trapmaster: {
    size: [12, 10, 60],
    fills: [
      fill([3, 0, 0], [8, 0, 17]),
      fill([3, 0, 10], [8, 0, 13], "minecraft:orange_concrete"),
      ...[19, 21, 23, 25].map((z) => fill([3, 0, z], [8, 0, z], "minecraft:purple_concrete")),
      fill([3, 0, 27], [8, 0, 55]),
      fill([3, 0, 30], [8, 0, 34], "minecraft:red_concrete"),
      fill([3, 0, 38], [8, 0, 42], "minecraft:light_blue_concrete"),
      fill([3, 0, 56], [8, 0, 59], GOLD),
      fill([10, 0, 28], [11, 4, 31]),
    ],
    points: {
      [MARKUP.master]: [[10, 5, 30, W]],
      [MARKUP.runners]: [
        [4, 1, 1, S],
        [5, 1, 1, S],
        [7, 1, 1, S],
      ],
      [MARKUP.dropLevers]: [[11, 5, 28]],
      [MARKUP.vanishLevers]: [[11, 5, 29]],
      [MARKUP.tntLevers]: [[11, 5, 30]],
      [MARKUP.waterLevers]: [[11, 5, 31]],
    },
    regions: {
      [MARKUP.dropTraps]: [[[3, 0, 10], [8, 0, 13]]],
      [MARKUP.vanishTraps]: [[[3, 0, 18], [8, 0, 26]]],
      [MARKUP.tntTraps]: [[[3, 1, 30], [8, 3, 34]]],
      [MARKUP.waterTraps]: [[[3, 1, 38], [8, 3, 42]]],
      [MARKUP.finish]: [[[3, 0, 56], [8, 0, 59]]],
    },
    killY: -2,
  },
  core: {
    size: [30, 8, 30],
    fills: [floor(30, 30)],
    points: {
      [MARKUP.core]: [[15, 1, 15]],
      [MARKUP.raider]: [[15, 1, 2, S]],
      [MARKUP.defenders]: row(3, [12, 1, 24, N], 3, 0),
    },
  },
  // A fenced field for the herd, and the barn the farmer waits shut in.
  barnyard: {
    size: [30, 8, 30],
    fills: [floor(30, 30), ...fence(5, 5, 29, 29), ...room(0, 0, 4, 4, 1, 3)],
    points: { [MARKUP.farmer]: [[2, 1, 2, S]], [MARKUP.hiders]: row(3, [15, 1, 15, S], 2, 0) },
    regions: { [MARKUP.herd]: [[[6, 1, 6], [28, 3, 28]]] },
  },
  // The border only: the game builds the maze in the Maze box.
  labyrinth: {
    size: [31, 8, 31],
    fills: [floor(31, 31), ...walls(0, 0, 30, 30, 1, 2, STONE), fill([28, 0, 28], [29, 0, 29], GOLD)],
    points: {
      [MARKUP.hunter]: [[15, 1, 15, S]],
      [MARKUP.runners]: [
        [1, 1, 1, S],
        [2, 1, 1, S],
        [1, 1, 2, S],
      ],
    },
    regions: { [MARKUP.exit]: [[[28, 0, 28], [29, 0, 29]]], [MARKUP.maze]: [[[1, 1, 1], [29, 2, 29]]] },
  },
  bossfight: {
    size: [30, 24, 30],
    fills: [floor(30, 30), ...walls(0, 0, 29, 29, 1, 4)],
    points: { [MARKUP.boss]: [[15, 1, 22, N]], [MARKUP.trio]: row(3, [12, 1, 5, S], 3, 0) },
    killY: -2,
  },
  bomb: {
    size: [30, 8, 30],
    fills: [floor(30, 30), ...walls(0, 0, 29, 29, 1, 3), ...room(1, 1, 6, 6, 1, 3)],
    points: {
      [MARKUP.bomber]: [[15, 1, 15, S]],
      [MARKUP.squad]: [
        [3, 1, 3, S],
        [4, 1, 3, S],
        [3, 1, 4, S],
      ],
      [MARKUP.bombSites]: [
        [10, 1, 10],
        [20, 1, 10],
        [10, 1, 20],
        [20, 1, 20],
        [15, 1, 8],
        [15, 1, 22],
        [8, 1, 15],
        [22, 1, 15],
      ],
    },
    regions: { [MARKUP.squadRoom]: [[[2, 1, 2], [5, 3, 5]]] },
  },
};

/** How many copies of an arena the Tests menu lays side by side: one, or for a tiled arena as many as fit 40 across (4 at most). */
export function testArenaCopies(id: string): number {
  const arena = TEST_ARENAS[id];
  if (!arena || !TILED[id]) return 1;
  return Math.max(1, Math.min(4, Math.floor(40 / arena.size[0])));
}

/** Lays a test arena from `min`, `copies` of it side by side east. Returns what couldn't be placed (a block this server doesn't know), once each. */
export function layTestArena(dimension: Dimension, arena: TestArena, min: Vector3, copies = 1): string[] {
  const failed = new Set<string>();
  for (let copy = 0; copy < copies; copy++) {
    const x0 = min.x + copy * arena.size[0];
    for (const { from, to, block } of arena.fills) {
      const a = { x: x0 + from[0], y: min.y + from[1], z: min.z + from[2] };
      const b = { x: x0 + to[0], y: min.y + to[1], z: min.z + to[2] };
      try {
        if (typeof block === "string") fillBox(dimension, a, b, block);
        else dimension.fillBlocks(new BlockVolume(a, b), BlockPermutation.resolve(block.id, block.states));
      } catch {
        failed.add(typeof block === "string" ? block : block.id);
      }
    }
  }
  return [...failed];
}

function spotAt(min: Vector3, at: At): Spot {
  const [x, y, z, yaw, pitch] = at;
  return { x: min.x + x + 0.5, y: min.y + y, z: min.z + z + 0.5, ...(yaw !== undefined ? { yaw } : {}), ...(pitch !== undefined ? { pitch } : {}) };
}

function boxAt(min: Vector3, [a, b]: Cells): WorldBox {
  return { min: { x: min.x + a[0], y: min.y + a[1], z: min.z + a[2] }, max: { x: min.x + b[0], y: min.y + b[1], z: min.z + b[2] } };
}

function mapRecord<T, U>(record: Record<string, T[]> | undefined, each: (value: T) => U): Record<string, U[]> {
  return Object.fromEntries(Object.entries(record ?? {}).map(([key, values]) => [key, values.map(each)]));
}

/** A test arena's markup with its lowest corner at `min`, as the minigames read it (the first copy's, for a tiled one). */
export function testArenaField(arena: TestArena, min: Vector3): Field {
  return testField(min, arena.size, {
    spawns: (arena.spawns ?? []).map((at) => spotAt(min, at)),
    teamSpawns: mapRecord(arena.teamSpawns, (at) => spotAt(min, at)),
    points: mapRecord(arena.points, (at) => spotAt(min, at)),
    regions: mapRecord(arena.regions, (cells) => boxAt(min, cells)),
  });
}

function position([x, y, z, yaw, pitch]: At): MapPosition {
  return yaw === undefined ? [x, y, z] : [x, y, z, yaw, pitch ?? 0];
}

/**
 * A test arena as an arena map would have it (its lowest corner at the map's 0, 0, 0): the Arena box
 * around it, a spectator spawn over it, and its marks. What the tests check against its checklist;
 * the podium is left to the caller (a test arena's results play on the game's stand-in podium).
 */
export function testArenaMap(arena: TestArena, name: string): MapConfig {
  const [w, h, d] = arena.size;
  const box: Box = { min: [0, 0, 0], max: [w - 1, h - 1, d - 1] };
  return {
    name,
    spawns: (arena.spawns ?? []).map(position),
    ...(arena.teamSpawns ? { teamSpawns: mapRecord(arena.teamSpawns, position) } : {}),
    spectatorSpawn: [Math.floor(w / 2), h - 1, Math.floor(d / 2)],
    ...(arena.killY !== undefined ? { killY: arena.killY } : {}),
    points: mapRecord(arena.points, position),
    regions: { [STRUCTURE_REGION]: [box], ...mapRecord(arena.regions, ([a, b]): Box => ({ min: [...a], max: [...b] })) },
  };
}
