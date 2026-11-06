// A world's overworld blocks, decoded from its db\ (leveldb.ts, subchunk.ts).
import { join } from "node:path";
import { readDb, type DbStats } from "./leveldb.ts";
import { allAir, chunkKey, DATA2D, DATA3D, decodeSubChunk, Palette, SUBCHUNK } from "./subchunk.ts";

export interface DecodedWorld {
  palette: Palette;
  /** Sub-chunks by "cx,cz,sy": layer 0 (blocks) and any more. */
  sections: Map<string, Uint16Array[]>;
  /** Height maps by "cx,cz": 256 16-bit heights. */
  heights: Map<string, Int16Array>;
  db: DbStats;
  ms: { read: number; decode: number };
}

export function decodeWorld(world: string, options: { heightsOnly?: boolean } = {}): DecodedWorld {
  const started = performance.now();
  const { values, stats } = readDb(join(world, "db"), (key) => {
    const parsed = chunkKey(key);
    if (!parsed || parsed.dimension !== 0) return false;
    if (parsed.tag === DATA3D || parsed.tag === DATA2D) return true;
    return !options.heightsOnly && parsed.tag === SUBCHUNK && parsed.y !== undefined;
  });
  const read = performance.now() - started;
  const palette = new Palette();
  const sections = new Map<string, Uint16Array[]>();
  const heights = new Map<string, Int16Array>();
  for (const [text, value] of values) {
    const key = chunkKey(Buffer.from(text, "latin1"))!;
    if (key.tag === SUBCHUNK) {
      // All-air sub-chunks (Chunker writes one for every empty section) aren't kept.
      if (allAir(value, palette)) continue;
      const { y, layers } = decodeSubChunk(value, palette);
      sections.set(`${key.x},${key.z},${y ?? key.y}`, layers);
    } else {
      const map = new Int16Array(256);
      for (let i = 0; i < 256; i++) map[i] = value.readInt16LE(2 * i);
      heights.set(`${key.x},${key.z}`, map);
    }
  }
  return { palette, sections, heights, db: stats, ms: { read, decode: performance.now() - started - read } };
}

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/** The box layer 0's non-air blocks fill, or undefined for an empty world. */
export function blockBox(world: DecodedWorld): Box | undefined {
  let box: Box | undefined;
  for (const [key, layers] of world.sections) {
    const [cx, cz, sy] = key.split(",").map(Number);
    const blocks = layers[0];
    for (let i = 0; i < 4096; i++) {
      if (blocks[i] === 0) continue;
      const x = cx * 16 + (i >> 8);
      const z = cz * 16 + ((i >> 4) & 15);
      const y = sy * 16 + (i & 15);
      if (!box) box = { min: [x, y, z], max: [x, y, z] };
      else {
        box.min = [Math.min(box.min[0], x), Math.min(box.min[1], y), Math.min(box.min[2], z)];
        box.max = [Math.max(box.max[0], x), Math.max(box.max[1], y), Math.max(box.max[2], z)];
      }
    }
  }
  return box;
}

/** The block at a spot (layer 0), 0 (air) where nothing's stored. */
export function blockAt(world: DecodedWorld, x: number, y: number, z: number): number {
  const layers = world.sections.get(`${x >> 4},${z >> 4},${y >> 4}`);
  return layers ? layers[0][((x & 15) << 8) | ((z & 15) << 4) | (y & 15)] : 0;
}

/** The highest non-air block in a column (layer 0), from y 319 down to -64. */
export function topBlock(world: DecodedWorld, x: number, z: number): { y: number; id: number } | undefined {
  for (let sy = 19; sy >= -4; sy--) {
    const layers = world.sections.get(`${x >> 4},${z >> 4},${sy}`);
    if (!layers) continue;
    const base = ((x & 15) << 8) | ((z & 15) << 4);
    for (let ly = 15; ly >= 0; ly--) {
      const id = layers[0][base | ly];
      if (id !== 0) return { y: sy * 16 + ly, id };
    }
  }
  return undefined;
}
