import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { BlockState } from "../subchunk.ts";
import { buildView, cachedView, encodeView, lookOf, ViewError, worldStamp } from "../view-file.ts";
import { decodeView, lookAt, VIEW_FORMAT, type View } from "../view-format.ts";
import { subChunk, subChunkKey, writeWorld, type LayerSpec, type Put } from "./fixture-world.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const stone: BlockState = { name: "minecraft:stone", states: {} };
const log: BlockState = { name: "minecraft:oak_log", states: { pillar_axis: "z" } };
const leaves: BlockState = { name: "minecraft:spruce_leaves", states: { update_bit: 1, persistent_bit: 1 } };
const chair: BlockState = { name: "minecade:oak_chair", states: { "minecade:facing": 2, "minecade:waterlogged": 0 } };
const water: BlockState = { name: "minecraft:water", states: { liquid_depth: 0 } };

/** A world of these sub-chunks (chunk x, z and section y), in a table. */
function world(sections: { x: number; z: number; y: number; layers: LayerSpec[]; version?: 8 | 9 }[], extra: Put[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "minecade-viewer-"));
  dirs.push(dir);
  const puts: Put[] = sections.map(({ x, z, y, layers, version }, i) => ({ key: subChunkKey(x, z, y), seq: i + 1, value: subChunk(layers, { y, version }) }));
  return writeWorld(dir, { tables: { 5: [...puts, ...extra] } });
}

/** The block a decoded view has at a world spot. */
function nameAt(view: View, x: number, y: number, z: number): string {
  const section = view.list.find((s) => s.x === x >> 4 && s.y === y >> 4 && s.z === z >> 4);
  return view.looks[section ? lookAt(section.blocks, x & 15, y & 15, z & 15) : 0].name;
}

const roundTrip = (dir: string) => decodeView(new Uint8Array(encodeView(buildView(dir))));

describe("lookOf", () => {
  it("keeps only the states that change how a vanilla block is drawn", () => {
    expect(lookOf(log)).toEqual({ name: "minecraft:oak_log", states: { pillar_axis: "z" } });
    expect(lookOf(leaves)).toEqual({ name: "minecraft:spruce_leaves" });
    expect(lookOf({ name: "minecraft:oak_stairs", states: { upside_down_bit: 0, weirdo_direction: 2 } })).toEqual({ name: "minecraft:oak_stairs", states: { upside_down_bit: 0, weirdo_direction: 2 } });
  });

  it("keeps all of a custom block's states", () => {
    expect(lookOf(chair)).toEqual(chair);
  });
});

describe("buildView", () => {
  it("has the blocks at their spots, in the box they fill", () => {
    const dir = world([
      { x: 0, z: 0, y: 4, layers: [{ at: (x, y, z) => (x === 2 && y === 3 && z === 5 ? stone : x === 9 && y === 0 && z === 1 ? log : undefined) }] },
      { x: -1, z: 2, y: -4, layers: [{ at: (x, y, z) => (x === 15 && y === 0 && z === 0 ? chair : undefined) }] },
    ]);
    const view = roundTrip(dir);
    expect(view.format).toBe(VIEW_FORMAT);
    expect(view.box).toEqual({ min: [-1, -64, 1], max: [9, 67, 32] });
    expect(nameAt(view, 2, 67, 5)).toBe("minecraft:stone");
    expect(nameAt(view, 9, 64, 1)).toBe("minecraft:oak_log");
    expect(nameAt(view, -1, -64, 32)).toBe("minecade:oak_chair");
    expect(nameAt(view, 3, 67, 5)).toBe("minecraft:air");
    expect(view.looks.find((look) => look.name === "minecraft:oak_log")?.states).toEqual({ pillar_axis: "z" });
  });

  it("merges block states that look the same into one look", () => {
    const dir = world([{ x: 0, z: 0, y: 0, layers: [{ at: (x) => (x === 0 ? leaves : x === 1 ? { ...leaves, states: { update_bit: 0, persistent_bit: 1 } } : undefined) }] }]);
    expect(roundTrip(dir).looks.filter((look) => look.name === "minecraft:spruce_leaves")).toHaveLength(1);
  });

  it("leaves out palette entries no block uses, and all-air sub-chunks", () => {
    const plane: BlockState = { name: "minecade:plane", states: { "minecade:axis": 1 } };
    const dir = world([
      { x: 0, z: 0, y: 0, layers: [{ at: (x, y, z) => (x + y + z === 0 ? stone : undefined), unused: [plane] }] },
      { x: 3, z: 3, y: 2, layers: [{ at: () => undefined, bits: 1 }] },
    ]);
    const view = roundTrip(dir);
    expect(view.looks.map((look) => look.name)).toEqual(["minecraft:air", "minecraft:stone"]);
    expect(view.list).toHaveLength(1);
    expect(view.box).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });

  it("sends a section of one block as one look, and keeps layer 1's water", () => {
    const dir = world([
      { x: 0, z: 0, y: 0, layers: [{ at: () => stone, bits: 0 }] },
      { x: 0, z: 0, y: 1, layers: [{ at: (x, y) => (y === 0 ? log : undefined) }, { at: (x, y) => (y === 0 && x < 4 ? water : undefined) }] },
    ]);
    const view = roundTrip(dir);
    const solid = view.list.find((s) => s.y === 0)!;
    expect(typeof solid.blocks).toBe("number");
    expect(view.looks[solid.blocks as number].name).toBe("minecraft:stone");
    expect(solid.water).toBeUndefined();
    const wet = view.list.find((s) => s.y === 1)!;
    expect(view.looks[lookAt(wet.water!, 2, 0, 7)]).toEqual({ name: "minecraft:water", states: { liquid_depth: 0 } });
    expect(lookAt(wet.water!, 6, 0, 7)).toBe(0);
  });

  it("reads only the Overworld, and sub-chunks in version 8", () => {
    const dir = world(
      [{ x: 1, z: 1, y: 0, version: 8, layers: [{ at: (x, y, z) => (x + y + z === 0 ? stone : undefined) }] }],
      [{ key: subChunkKey(0, 0, 0, 1), seq: 99, value: subChunk([{ at: () => log, bits: 0 }]) }],
    );
    const view = roundTrip(dir);
    expect(view.box).toEqual({ min: [16, 0, 16], max: [16, 0, 16] });
    expect(view.looks.map((look) => look.name)).not.toContain("minecraft:oak_log");
  });

  it("refuses a world wider than 256 blocks, one without blocks, and a missing one", () => {
    const wide = world([
      { x: 0, z: 0, y: 0, layers: [{ at: (x, y, z) => (x + y + z === 0 ? stone : undefined) }] },
      { x: 16, z: 0, y: 0, layers: [{ at: (x, y, z) => (x + y + z === 0 ? stone : undefined) }] },
    ]);
    expect(() => buildView(wide)).toThrow(ViewError);
    expect(() => buildView(wide)).toThrow(/257 by 1 blocks across .*up to 256 by 256/);
    expect(() => buildView(world([{ x: 0, z: 0, y: 0, layers: [{ at: () => undefined, bits: 1 }] }]))).toThrow(/no blocks/);
    expect(() => buildView(join(tmpdir(), "minecade-viewer-no-such-world"))).toThrow(/there's no world/);
  });

  it("fits exactly 256 blocks across", () => {
    const dir = world([
      { x: 0, z: 0, y: 0, layers: [{ at: (x, y, z) => (x + y + z === 0 ? stone : undefined) }] },
      { x: 15, z: 0, y: 0, layers: [{ at: (x, y, z) => (x === 15 && y + z === 0 ? stone : undefined) }] },
    ]);
    expect(roundTrip(dir).box.max[0]).toBe(255);
  });
});

describe("decodeView", () => {
  it("reads a file that starts on an odd offset", () => {
    const dir = world([{ x: 0, z: 0, y: 0, layers: [{ at: (x) => (x === 4 ? stone : undefined) }] }]);
    const bytes = encodeView(buildView(dir));
    const odd = new Uint8Array(bytes.length + 1);
    odd.set(bytes, 1);
    expect(nameAt(decodeView(odd.subarray(1)), 4, 0, 0)).toBe("minecraft:stone");
  });

  it("refuses a file that isn't a view, or of another format", () => {
    expect(() => decodeView(new TextEncoder().encode("not a view"))).toThrow(/not a map viewer view file/);
    const dir = world([{ x: 0, z: 0, y: 0, layers: [{ at: () => stone, bits: 0 }] }]);
    const built = buildView(dir);
    expect(() => decodeView(new Uint8Array(encodeView({ ...built, header: { ...built.header, format: VIEW_FORMAT + 1 } })))).toThrow(/format 2/);
  });
});

describe("cachedView", () => {
  it("makes a view once, then reads it until the world changes, and keeps only the newest", () => {
    const dir = world([{ x: 0, z: 0, y: 0, layers: [{ at: () => stone, bits: 0 }] }]);
    const cache = mkdtempSync(join(tmpdir(), "minecade-viewer-cache-"));
    dirs.push(cache);
    const first = cachedView(dir, cache);
    expect(first.built).toBe(true);
    expect(decodeView(new Uint8Array(gunzipSync(first.gzipped))).stamp).toBe(first.stamp);
    const again = cachedView(dir, cache);
    expect(again).toMatchObject({ built: false, stamp: first.stamp });
    expect(again.gzipped.equals(first.gzipped)).toBe(true);

    // The world changes: a log appears, and the table's time moves.
    writeFileSync(join(dir, "db", "000009.log"), Buffer.alloc(0));
    utimesSync(join(dir, "db", "000005.ldb"), new Date(2030, 0, 1), new Date(2030, 0, 1));
    expect(worldStamp(dir)).not.toBe(first.stamp);
    const changed = cachedView(dir, cache);
    expect(changed.built).toBe(true);
    expect(readdirSync(cache)).toEqual([`${changed.stamp}.bin.gz`]);
    expect(existsSync(join(cache, `${first.stamp}.bin.gz`))).toBe(false);
  });
});
