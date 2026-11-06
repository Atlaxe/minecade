import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { boxView, buildOverview, cachedOverview, encodeOverview, selectBoxProblem, worldSubChunks } from "../overview.ts";
import { decodeOverview, NO_TOP } from "../overview-format.ts";
import { parseBox } from "../select.ts";
import type { BlockState } from "../subchunk.ts";
import { ViewError } from "../view-file.ts";
import { decodeView, lookAt, type View } from "../view-format.ts";
import { subChunk, subChunkKey, writeWorld, type LayerSpec, type Put } from "./fixture-world.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const stone: BlockState = { name: "minecraft:stone", states: {} };
const grass: BlockState = { name: "minecraft:grass_block", states: {} };
const barrier: BlockState = { name: "minecraft:barrier", states: {} };

/** A world of these sub-chunks (chunk x, z and section y), in a table. */
function world(sections: { x: number; z: number; y: number; layers: LayerSpec[] }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "minecade-select-"));
  dirs.push(dir);
  const puts: Put[] = sections.map(({ x, z, y, layers }, i) => ({ key: subChunkKey(x, z, y), seq: i + 1, value: subChunk(layers, { y }) }));
  return writeWorld(dir, { tables: { 5: puts } });
}

/** Two chunks: a stone floor at y 0 under chunk (0, 0), grass on top at y 20 in one column, a barrier roof over another; one block in chunk (2, -1). */
function fixture(): string {
  return world([
    { x: 0, z: 0, y: 0, layers: [{ at: (_x, y) => (y === 0 ? stone : undefined) }] },
    { x: 0, z: 0, y: 1, layers: [{ at: (x, y, z) => (x === 3 && z === 4 && y === 4 ? grass : x === 5 && z === 5 && y === 15 ? barrier : undefined) }] },
    { x: 0, z: 0, y: 3, layers: [{ at: () => undefined, bits: 1 }] },
    { x: 2, z: -1, y: -4, layers: [{ at: (x, y, z) => (x === 1 && y === 2 && z === 15 ? stone : undefined) }] },
  ]);
}

const nameAt = (view: View, x: number, y: number, z: number) => {
  const section = view.list.find((s) => s.x === x >> 4 && s.y === y >> 4 && s.z === z >> 4);
  return view.looks[section ? lookAt(section.blocks, x & 15, y & 15, z & 15) : 0].name;
};

describe("the picture from above", () => {
  it("has every chunk's columns with their top block, looking through barriers, and nothing where there are no blocks", () => {
    const dir = fixture();
    const { values, stamp } = worldSubChunks(dir);
    const picture = decodeOverview(new Uint8Array(encodeOverview(buildOverview(values, stamp))));
    // Chunks x 0 to 2 and z -1 to 0: 48 by 32 columns from x 0, z -16.
    expect([picture.x, picture.z, picture.width, picture.depth]).toEqual([0, -16, 48, 32]);
    const at = (x: number, z: number) => (z - picture.z) * picture.width + (x - picture.x);
    const nameOf = (x: number, z: number) => picture.names[picture.blocks[at(x, z)]];
    expect([picture.tops[at(3, 4)], nameOf(3, 4)]).toEqual([20, "minecraft:grass_block"]);
    // Under the barrier roof: the stone floor.
    expect([picture.tops[at(5, 5)], nameOf(5, 5)]).toEqual([0, "minecraft:stone"]);
    expect([picture.tops[at(33, -1)], nameOf(33, -1)]).toEqual([-62, "minecraft:stone"]);
    expect(picture.tops[at(40, -10)]).toBe(NO_TOP);
    expect([picture.low, picture.high]).toEqual([-62, 20]);
  });

  it("is kept until the world changes", () => {
    const dir = fixture();
    const cache = join(dir, "cache");
    const first = cachedOverview(dir, cache);
    expect(first.built).toBe(true);
    const again = cachedOverview(dir, cache);
    expect(again.built).toBe(false);
    expect(decodeOverview(new Uint8Array(gunzipSync(again.gzipped))).width).toBe(48);
    expect(readdirSync(cache).filter((name) => name.endsWith(".overview.gz"))).toHaveLength(1);
    expect(existsSync(join(cache, `${first.stamp}.overview.gz`))).toBe(true);
  });
});

describe("a box's view", () => {
  it("has only the blocks in the box, its blocks' box (barriers too) being the height trim", () => {
    const dir = fixture();
    const view = decodeView(new Uint8Array(gunzipSync(boxView(dir, { min: [2, -64, 3], max: [6, 319, 6] }).gzipped)));
    expect(view.box).toEqual({ min: [2, 0, 3], max: [6, 31, 6] });
    expect(nameAt(view, 3, 20, 4)).toBe("minecraft:grass_block");
    expect(nameAt(view, 5, 31, 5)).toBe("minecraft:barrier");
    // Outside the box: air.
    expect(nameAt(view, 0, 0, 0)).toBe("minecraft:air");
    expect(nameAt(view, 7, 0, 3)).toBe("minecraft:air");
    // A floor and ceiling cut it down too.
    const cut = decodeView(new Uint8Array(gunzipSync(boxView(dir, { min: [0, 1, 0], max: [15, 25, 15] }).gzipped)));
    expect(cut.box).toEqual({ min: [3, 20, 4], max: [3, 20, 4] });
  });

  it("says when there's nothing in the box", () => {
    const dir = fixture();
    expect(() => boxView(dir, { min: [20, -64, 20], max: [30, 319, 30] })).toThrow(ViewError);
  });
});

describe("Select's boxes", () => {
  it("are whole blocks, at most 256 across, within the world's height", () => {
    expect(selectBoxProblem({ min: [0, -64, 0], max: [255, 319, 255] })).toBeUndefined();
    expect(selectBoxProblem({ min: [0, 0, 0], max: [256, 10, 3] })).toMatch(/at most 256/);
    expect(selectBoxProblem({ min: [0, -65, 0], max: [3, 10, 3] })).toMatch(/y -64 to 319/);
    expect(selectBoxProblem({ min: [0, 0, 0], max: [3.5, 10, 3] })).toMatch(/whole/);
    expect(selectBoxProblem({ min: [5, 0, 0], max: [3, 10, 3] })).toMatch(/past/);
    expect(parseBox("1,2,3,4,5,6")).toEqual({ min: [1, 2, 3], max: [4, 5, 6] });
    expect(parseBox({ min: [1, 2, 3], max: [4, 5, 6] })).toEqual({ min: [1, 2, 3], max: [4, 5, 6] });
    expect(() => parseBox("1,2,3")).toThrow(ViewError);
  });
});
