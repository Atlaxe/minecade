import { describe, expect, it } from "vitest";
import { allAir, BlockPalette, blockIndex, chunkKey, decodeSubChunk, isOverworldSubChunk, type BlockState } from "../subchunk.ts";
import { paletteEntry, subChunk, subChunkKey } from "./fixture-world.ts";

const stone: BlockState = { name: "minecraft:stone", states: {} };
const air: BlockState = { name: "minecraft:air", states: {} };

/** `count` kinds of block, one per spot along the section, the rest air. */
function kinds(count: number): (x: number, y: number, z: number) => BlockState | undefined {
  return (x, y, z) => {
    const n = (x * 256 + z * 16 + y) % (count + 1);
    return n === 0 ? undefined : { name: `minecraft:block_${n}`, states: { n } };
  };
}

function namesOf(layer: Uint16Array, palette: BlockPalette): string[] {
  return Array.from(layer, (id) => palette.blocks[id].name);
}

describe("decodeSubChunk", () => {
  it("reads blocks back at their spots for every bit width", () => {
    // 2 kinds fit 2 bits; 4 kinds (and air) 3; 16 then 5, which leaves 2 bits of each word unused; 40 6; 200 8.
    for (const count of [1, 3, 4, 16, 40, 200]) {
      const at = kinds(count);
      const palette = new BlockPalette();
      const { y, layers } = decodeSubChunk(subChunk([{ at }], { y: -3 }), palette);
      expect(y).toBe(-3);
      for (const [x, by, z] of [[0, 0, 0], [3, 7, 11], [15, 15, 15], [8, 1, 2], [12, 9, 4]]) {
        expect(palette.blocks[layers[0][blockIndex(x, by, z)]].name).toBe((at(x, by, z) ?? air).name);
      }
    }
  });

  it("reads a block's states", () => {
    const palette = new BlockPalette();
    const log: BlockState = { name: "minecraft:oak_log", states: { pillar_axis: "x" } };
    const leaves: BlockState = { name: "minecraft:oak_leaves", states: { persistent_bit: 1, update_bit: 0 } };
    const { layers } = decodeSubChunk(subChunk([{ at: (x) => (x < 8 ? log : leaves) }], { byteStates: ["persistent_bit", "update_bit"] }), palette);
    expect(palette.blocks[layers[0][blockIndex(2, 0, 0)]]).toEqual(log);
    expect(palette.blocks[layers[0][blockIndex(9, 0, 0)]]).toEqual(leaves);
  });

  it("reads version 8 (no y index), a one-block layer and layer 1", () => {
    const palette = new BlockPalette();
    const water: BlockState = { name: "minecraft:water", states: { liquid_depth: 0 } };
    const { y, layers } = decodeSubChunk(subChunk([{ at: () => stone, bits: 0 }, { at: (x, by) => (x === 1 && by === 2 ? water : undefined) }], { version: 8 }), palette);
    expect(y).toBeUndefined();
    expect(new Set(namesOf(layers[0], palette))).toEqual(new Set(["minecraft:stone"]));
    expect(palette.blocks[layers[1][blockIndex(1, 2, 5)]]).toEqual(water);
    expect(palette.blocks[layers[1][blockIndex(1, 3, 5)]].name).toBe("minecraft:air");
  });

  it("parses each palette entry once, and numbers a state the same whatever the order of its states", () => {
    const palette = new BlockPalette();
    const a = decodeSubChunk(subChunk([{ at: () => ({ name: "minecraft:x", states: { a: 1, b: 2 } }), bits: 0 }]), palette).layers[0][0];
    const b = decodeSubChunk(subChunk([{ at: () => ({ name: "minecraft:x", states: { b: 2, a: 1 } }), bits: 0 }]), palette).layers[0][0];
    expect(a).toBe(b);
    expect(palette.blocks).toHaveLength(2);
    expect(palette.idOfRaw(paletteEntry({ name: "minecraft:x", states: { a: 1, b: 2 } }))).toBe(a);
  });

  it("refuses formats older than version 8 with a message", () => {
    expect(() => decodeSubChunk(Buffer.from([7, 0]), new BlockPalette())).toThrow(/format 7/);
  });
});

describe("allAir", () => {
  it("is true for a palette of only air, however many bits (Chunker writes empty sections with 1)", () => {
    const palette = new BlockPalette();
    expect(allAir(subChunk([{ at: () => undefined, bits: 1 }]), palette)).toBe(true);
    expect(allAir(subChunk([{ at: () => undefined, bits: 0 }]), palette)).toBe(true);
  });

  it("is false when the palette has a block", () => {
    const palette = new BlockPalette();
    expect(allAir(subChunk([{ at: (x, y, z) => (x + y + z === 0 ? stone : undefined) }]), palette)).toBe(false);
    // An unused entry counts too: it's read from the palette alone.
    expect(allAir(subChunk([{ at: () => undefined, unused: [stone] }]), palette)).toBe(false);
  });
});

describe("chunk keys", () => {
  it("reads an Overworld sub-chunk's key", () => {
    const key = subChunkKey(-3, 7, -4);
    expect(chunkKey(key)).toEqual({ x: -3, z: 7, dimension: 0, tag: 47, y: -4 });
    expect(isOverworldSubChunk(key)).toBe(true);
  });

  it("reads the Nether's, which isn't the Overworld's", () => {
    const key = subChunkKey(1, 2, 3, 1);
    expect(chunkKey(key)).toEqual({ x: 1, z: 2, dimension: 1, tag: 47, y: 3 });
    expect(isOverworldSubChunk(key)).toBe(false);
  });

  it("isn't a chunk key for other keys", () => {
    expect(chunkKey(Buffer.from("BiomeData"))).toBeUndefined();
  });
});
