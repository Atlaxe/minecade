import { describe, expect, it } from "vitest";
import { meshSection, PADDED, paddedSection, type SectionMesh } from "../mesher.ts";

/** Section blocks with their border, from (x, y, z) to a look (0 to 15 inside, -1 and 16 the neighbors'). */
function blocksOf(at: (x: number, y: number, z: number) => number): Uint16Array {
  const blocks = new Uint16Array(PADDED ** 3);
  for (let x = -1; x <= 16; x++) for (let z = -1; z <= 16; z++) for (let y = -1; y <= 16; y++) blocks[((x + 1) * PADDED + (z + 1)) * PADDED + (y + 1)] = at(x, y, z);
  return blocks;
}

/** Look 1 red and look 2 blue on every face; look 0 is air. */
const DRAWN = new Uint8Array([0, 1, 1]);
const COLORS = new Uint8Array(3 * 24);
for (let face = 0; face < 6; face++) {
  COLORS.set([200, 0, 0, 255], 24 + face * 4);
  COLORS.set([0, 0, 200, 255], 48 + face * 4);
}

const mesh = (at: (x: number, y: number, z: number) => number, offset: [number, number, number] = [0, 0, 0]) => meshSection(blocksOf(at), DRAWN, COLORS, offset);

/** Each quad's four corners, as [x, y, z] lists. */
function quads(result: SectionMesh): number[][][] {
  const out: number[][][] = [];
  for (let q = 0; q < result.quads; q++) out.push([0, 1, 2, 3].map((corner) => Array.from(result.positions.subarray((q * 4 + corner) * 3, (q * 4 + corner) * 3 + 3))));
  return out;
}

describe("meshSection", () => {
  it("gives a lone block its six faces, shaded by side", () => {
    const result = mesh((x, y, z) => (x === 3 && y === 4 && z === 5 ? 1 : 0));
    expect(result.quads).toBe(6);
    expect(result.indices).toHaveLength(36);
    // Tops full, bottoms half: red 200 and 100.
    const reds = new Set(Array.from({ length: 24 }, (_, v) => result.tints[v * 4]));
    expect(reds).toEqual(new Set([200, 100, 160, 120]));
    for (const corners of quads(result)) for (const [x, y, z] of corners) expect([x - 3, y - 4, z - 5].every((d) => d === 0 || d === 1)).toBe(true);
  });

  it("leaves out faces between blocks and merges a row of one look into one face a side", () => {
    const row = mesh((x, y, z) => (y === 0 && z === 0 && x >= 2 && x <= 9 ? 1 : 0));
    expect(row.quads).toBe(6);
    const top = quads(row).find((corners) => corners.every(([, y]) => y === 1))!;
    expect(Math.max(...top.map(([x]) => x)) - Math.min(...top.map(([x]) => x))).toBe(8);
  });

  it("doesn't merge different looks", () => {
    const row = mesh((x, y, z) => (y === 0 && z === 0 && x >= 2 && x <= 3 ? x - 1 : 0));
    // Each block: top, bottom, north, south and its own end; the face between them is hidden.
    expect(row.quads).toBe(10);
  });

  it("draws no faces against the neighbors' blocks at the section's edge", () => {
    const edge = mesh((x, y, z) => (y === 0 && z === 0 && (x === 15 || x === 16) ? 1 : 0));
    expect(edge.quads).toBe(5);
  });

  it("darkens a floor's corners beside a wall, and only there", () => {
    // A floor at y 0, a wall along x 0 on top of it.
    const result = mesh((x, y, z) => (y === 0 || (x === 0 && y === 1) ? 1 : 0));
    const levels = new Set<number>();
    for (let q = 0; q < result.quads; q++) {
      const corners = [0, 1, 2, 3].map((c) => q * 4 + c);
      const onFloorTop = corners.every((v) => result.positions[v * 3 + 1] === 1) && corners.every((v) => result.positions[v * 3] >= 1);
      if (!onFloorTop) continue;
      for (const v of corners) levels.add(result.occlusion[v]);
      // At x 1 the wall is beside each corner and across from it too (it runs along z): level 1 of 3.
      for (const v of corners) expect(result.occlusion[v]).toBe(result.positions[v * 3] === 1 ? 85 : 255);
    }
    expect(levels).toEqual(new Set([85, 255]));
  });

  it("places the faces from the region offset", () => {
    const result = mesh((x, y, z) => (x === 0 && y === 0 && z === 0 ? 1 : 0), [16, 32, 48]);
    for (const corners of quads(result)) for (const [x, y, z] of corners) expect([x >= 16 && x <= 17, y >= 32 && y <= 33, z >= 48 && z <= 49]).toEqual([true, true, true]);
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
