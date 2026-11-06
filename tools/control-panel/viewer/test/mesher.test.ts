import { describe, expect, it } from "vitest";
import type { ViewLook } from "../../../viewer/view-format.ts";
import { meshSection, PADDED, paddedSection, paddedWater, prepareLooks, type MeshPart } from "../mesher.ts";
import { buildShapeTable } from "../shapes.ts";

/** Section blocks with their border, from (x, y, z) to a look (0 to 15 inside, -1 and 16 the neighbors'). */
function blocksOf(at: (x: number, y: number, z: number) => number): Uint16Array {
  const blocks = new Uint16Array(PADDED ** 3);
  for (let x = -1; x <= 16; x++) for (let z = -1; z <= 16; z++) for (let y = -1; y <= 16; y++) blocks[((x + 1) * PADDED + (z + 1)) * PADDED + (y + 1)] = at(x, y, z);
  return blocks;
}

const LOOKS: ViewLook[] = [
  { name: "minecraft:air" },
  { name: "minecraft:red_wool" },
  { name: "minecraft:blue_wool" },
  { name: "minecraft:oak_slab", states: { "minecraft:vertical_half": "bottom" } },
  { name: "minecraft:oak_slab", states: { "minecraft:vertical_half": "top" } },
  { name: "minecraft:glass" },
  { name: "minecraft:water", states: { liquid_depth: 0 } },
  { name: "minecraft:poppy" },
  { name: "minecraft:oak_stairs", states: { weirdo_direction: 3, upside_down_bit: 0, "minecraft:corner": "none" } },
];
const [RED, BLUE, SLAB, TOP_SLAB, GLASS, WATER, POPPY, STAIRS] = [1, 2, 3, 4, 5, 6, 7, 8];
const DRAWN = new Uint8Array(LOOKS.map((_, id) => (id === 0 ? 0 : 1)));
const COLORS = new Uint8Array(LOOKS.length * 24);
for (let look = 1; look < LOOKS.length; look++) for (let face = 0; face < 6; face++) COLORS.set(look === BLUE ? [0, 0, 200, 255] : look === GLASS ? [180, 220, 230, 120] : [200, 0, 0, 255], look * 24 + face * 4);
const PREPARED = prepareLooks({ drawn: DRAWN, colors: COLORS, table: buildShapeTable(LOOKS, DRAWN, {}) });

const mesh = (at: (x: number, y: number, z: number) => number, offset: [number, number, number] = [0, 0, 0], water?: (x: number, y: number, z: number) => number) =>
  meshSection(blocksOf(at), water ? blocksOf(water) : undefined, PREPARED, offset);
const only = (x0: number, y0: number, z0: number, look: number) => (x: number, y: number, z: number) => (x === x0 && y === y0 && z === z0 ? look : 0);

/** Each quad's four corners, as [x, y, z] lists in sixteenths. */
function quads(part: MeshPart): number[][][] {
  const out: number[][][] = [];
  for (let q = 0; q < part.indices.length / 6; q++) out.push([0, 1, 2, 3].map((corner) => Array.from(part.positions.subarray((q * 4 + corner) * 3, (q * 4 + corner) * 3 + 3))));
  return out;
}
const count = (part: MeshPart) => part.indices.length / 6;
/** The heights of a part's level faces (each quad whose corners share y), in sixteenths. */
const levels = (part: MeshPart) => new Set(quads(part).filter((c) => c.every(([, y]) => y === c[0][1])).map((c) => c[0][1]));

describe("meshSection: cubes", () => {
  it("gives a lone block its six faces, shaded by side", () => {
    const result = mesh(only(3, 4, 5, RED));
    expect(result.quads).toBe(6);
    expect(count(result.glass)).toBe(0);
    // Tops full, bottoms half: red 200 and 100.
    const reds = new Set(Array.from({ length: 24 }, (_, v) => result.solid.tints[v * 4]));
    expect(reds).toEqual(new Set([200, 100, 160, 120]));
    for (const corners of quads(result.solid)) for (const [x, y, z] of corners) expect([x / 16 - 3, y / 16 - 4, z / 16 - 5].every((d) => d === 0 || d === 1)).toBe(true);
  });

  it("leaves out faces between blocks and merges a row of one look into one face a side", () => {
    const row = mesh((x, y, z) => (y === 0 && z === 0 && x >= 2 && x <= 9 ? RED : 0));
    expect(row.quads).toBe(6);
    const top = quads(row.solid).find((corners) => corners.every(([, y]) => y === 16))!;
    expect(Math.max(...top.map(([x]) => x)) - Math.min(...top.map(([x]) => x))).toBe(8 * 16);
  });

  it("doesn't merge different looks", () => {
    const row = mesh((x, y, z) => (y === 0 && z === 0 && x >= 2 && x <= 3 ? x - 1 : 0));
    // Each block: top, bottom, north, south and its own end; the face between them is hidden.
    expect(row.quads).toBe(10);
  });

  it("draws no faces against the neighbors' blocks at the section's edge", () => {
    expect(mesh((x, y, z) => (y === 0 && z === 0 && (x === 15 || x === 16) ? RED : 0)).quads).toBe(5);
  });

  it("darkens a floor's corners beside a wall, and only there", () => {
    // A floor at y 0, a wall along x 0 on top of it.
    const { solid } = mesh((x, y) => (y === 0 || (x === 0 && y === 1) ? RED : 0));
    const seen = new Set<number>();
    for (let q = 0; q < count(solid); q++) {
      const corners = [0, 1, 2, 3].map((c) => q * 4 + c);
      const onFloorTop = corners.every((v) => solid.positions[v * 3 + 1] === 16) && corners.every((v) => solid.positions[v * 3] >= 16);
      if (!onFloorTop) continue;
      for (const v of corners) seen.add(solid.occlusion[v]);
      // At x 1 the wall is beside each corner and across from it too (it runs along z): level 1 of 3.
      for (const v of corners) expect(solid.occlusion[v]).toBe(solid.positions[v * 3] === 16 ? 85 : 255);
    }
    expect(seen).toEqual(new Set([85, 255]));
  });

  it("places the faces from the region offset", () => {
    const result = mesh(only(0, 0, 0, RED), [16, 32, 48]);
    for (const corners of quads(result.solid)) for (const [x, y, z] of corners) expect([x >= 256 && x <= 272, y >= 512 && y <= 528, z >= 768 && z <= 784]).toEqual([true, true, true]);
  });
});

describe("meshSection: shapes", () => {
  it("draws a bottom slab half high, and the block under a top slab without its top", () => {
    expect(levels(mesh(only(2, 2, 2, SLAB)).solid)).toEqual(new Set([32, 40]));
    // A cube under a bottom slab: its top and the slab's underside are hidden; under a top slab,
    // both are seen through the gap.
    expect(mesh((x, y, z) => (x === 2 && z === 2 ? (y === 1 ? RED : y === 2 ? SLAB : 0) : 0)).quads).toBe(5 + 5);
    expect(mesh((x, y, z) => (x === 2 && z === 2 ? (y === 1 ? RED : y === 2 ? TOP_SLAB : 0) : 0)).quads).toBe(6 + 6);
  });

  it("hides the faces where two slabs meet", () => {
    expect(mesh((x, y, z) => (y === 0 && z === 0 && (x === 2 || x === 3) ? SLAB : 0)).quads).toBe(10);
  });

  it("draws stairs as a slab and a step, the step's underside left out", () => {
    const stairs = mesh(only(2, 2, 2, STAIRS)).solid;
    // The slab's 6 faces and the step's 5.
    expect(count(stairs)).toBe(11);
    expect(levels(stairs)).toEqual(new Set([32, 40, 48]));
  });

  it("draws a plant as two crossed faces seen from both sides, and leaves the block under it whole", () => {
    const result = mesh((x, y, z) => (x === 2 && z === 2 ? (y === 1 ? RED : y === 2 ? POPPY : 0) : 0));
    expect(result.quads).toBe(6 + 4);
  });
});

describe("meshSection: see-through blocks and liquids", () => {
  it("puts glass in the blended mesh, hides glass against glass, and leaves a solid block's face behind it", () => {
    const result = mesh((x, y, z) => (y === 0 && z === 0 ? (x === 2 || x === 3 ? GLASS : x === 4 ? RED : 0) : 0));
    // The glass pair, merged: top, bottom, north, south and the west end (the east one is against
    // the red block); the red block all 6, its face toward the glass too.
    expect(count(result.glass)).toBe(5);
    expect(count(result.solid)).toBe(6);
    expect(result.glass.tints[3]).toBe(120);
  });

  it("puts water's top 14/16 up, full under more water, and hides the faces between water", () => {
    const pool = mesh((x, y, z) => (x === 2 && z === 2 && (y === 0 || y === 1) ? WATER : 0));
    expect(count(pool.glass)).toBe(4 * 2 + 1 + 1);
    expect(levels(pool.glass)).toEqual(new Set([0, 16 + 14]));
  });

  it("puts the water of a waterlogged block (layer 1) around it", () => {
    const result = mesh(only(2, 2, 2, STAIRS), [0, 0, 0], only(2, 2, 2, WATER));
    expect(count(result.glass)).toBe(6);
    expect(count(result.solid)).toBe(11);
  });
});

describe("paddedSection", () => {
  it("cuts a section and its border from the grid, and is undefined for an empty section", () => {
    const size: [number, number, number] = [32, 16, 16];
    const grid = new Uint16Array(32 * 16 * 16);
    grid[(16 * 16 + 3) * 16 + 2] = 1; // x 16, z 3, y 2
    expect(paddedSection(grid, size, DRAWN, 0, 0, 0)).toBeUndefined();
    const second = paddedSection(grid, size, DRAWN, 1, 0, 0)!;
    expect(second[((0 + 1) * PADDED + 4) * PADDED + 3]).toBe(1);
  });
});

describe("paddedWater", () => {
  it("cuts layer 1 with its border from the sections that have it", () => {
    const layer = new Uint16Array(4096);
    layer[(0 * 16 + 3) * 16 + 2] = WATER; // x 0, z 3, y 2 of section (1, 0, 0)
    const water = new Map([[(1 * 1 + 0) * 1 + 0, layer]]);
    // Section 0 sees it in its east border; a section far away sees none.
    expect(paddedWater(water, [2, 1, 1], 0, 0, 0)![(17 * PADDED + 4) * PADDED + 3]).toBe(WATER);
    expect(paddedWater(new Map(), [2, 1, 1], 0, 0, 0)).toBeUndefined();
  });
});
