// Bedrock chunk data for the map viewer: keys, and sub-chunks of 16x16x16 blocks.
//
// A key is the chunk's x and z (32-bit little-endian), a dimension number for the Nether and the
// End only, a tag byte, and for a sub-chunk (tag 47) its y index (a signed byte).
//
// A sub-chunk is a version byte (8 or 9; 1 is a single layer with no count), the number of
// storage layers, in version 9 its y index, then each layer: a byte whose upper 7 bits are the bits
// per block, the palette indices packed into 32-bit words (low bits first, an index never split
// across words; y changes fastest, then z, then x), the palette's size (32-bit) and its entries,
// each a little-endian NBT compound (name, states, version). Layer 0 is the blocks; layer 1 is
// mostly the water in waterlogged blocks. Chunker stores every empty sub-chunk too, with 1 bit a
// block and a palette of air (docs/spike-results.md, "Map viewer").
import nbt from "prismarine-nbt";

export const SUBCHUNK_TAG = 47;

export interface ChunkKey {
  x: number;
  z: number;
  /** 0 the Overworld, 1 the Nether, 2 the End. */
  dimension: number;
  tag: number;
  /** A sub-chunk's y index (16 blocks each: -4 is y -64 to -49). */
  y?: number;
}

/**
 * A chunk's key, read; undefined for other keys. Named keys can be as long as a chunk key
 * ("BiomeData" is 9 bytes), so the tag has to be one of a chunk's (43 to 65, or 118) and only a
 * sub-chunk's key has the extra y byte.
 */
export function chunkKey(key: Buffer): ChunkKey | undefined {
  const isTag = (tag: number, sub: boolean) => (sub ? tag === SUBCHUNK_TAG : (tag >= 43 && tag <= 65) || tag === 118);
  if ((key.length === 9 || key.length === 10) && isTag(key[8], key.length === 10)) {
    return { x: key.readInt32LE(0), z: key.readInt32LE(4), dimension: 0, tag: key[8], ...(key.length === 10 ? { y: key.readInt8(9) } : {}) };
  }
  if ((key.length === 13 || key.length === 14) && isTag(key[12], key.length === 14)) {
    return { x: key.readInt32LE(0), z: key.readInt32LE(4), dimension: key.readInt32LE(8), tag: key[12], ...(key.length === 14 ? { y: key.readInt8(13) } : {}) };
  }
  return undefined;
}

/** Whether a key is an Overworld sub-chunk's. */
export function isOverworldSubChunk(key: Buffer): boolean {
  return key.length === 10 && key[8] === SUBCHUNK_TAG;
}

export interface BlockState {
  name: string;
  states: Record<string, string | number>;
}

export const AIR = "minecraft:air";

/** Every block state met so far, numbered from 0 (air). An entry is looked up by its raw NBT bytes first, so each is parsed once. */
export class BlockPalette {
  readonly blocks: BlockState[] = [{ name: AIR, states: {} }];
  private readonly byText = new Map<string, number>([[stateText({ name: AIR, states: {} }), 0]]);
  private readonly byRaw = new Map<string, number>();

  idOfRaw(raw: Buffer): number {
    const key = raw.toString("latin1");
    const known = this.byRaw.get(key);
    if (known !== undefined) return known;
    const value = nbt.simplify(nbt.parseUncompressed(raw, "little")) as { name?: string; states?: Record<string, string | number> };
    const id = this.idOf({ name: value.name ?? AIR, states: value.states ?? {} });
    this.byRaw.set(key, id);
    return id;
  }

  idOf(block: BlockState): number {
    const text = stateText(block);
    let id = this.byText.get(text);
    if (id === undefined) {
      id = this.blocks.length;
      this.blocks.push(block);
      this.byText.set(text, id);
    }
    return id;
  }
}

/** A block state as text, its states sorted, to tell states apart. */
export function stateText(block: BlockState): string {
  return `${block.name}${JSON.stringify(Object.fromEntries(Object.entries(block.states).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))}`;
}

/** The index of a block in a sub-chunk's layer. */
export function blockIndex(x: number, y: number, z: number): number {
  return (x << 8) | (z << 4) | y;
}

/** A sub-chunk's layers as palette ids, 4096 each, at blockIndex(x, y, z). */
export function decodeSubChunk(value: Buffer, palette: BlockPalette): { y?: number; layers: Uint16Array[] } {
  const version = value[0];
  let at = 1;
  let count = 1;
  let y: number | undefined;
  if (version === 8 || version === 9) {
    count = value[at++];
    if (version === 9) y = value.readInt8(at++);
  } else if (version !== 1) {
    throw new Error(`a sub-chunk in format ${version}, older than the map viewer reads: open the world in Minecraft or BDS once to bring it up to date`);
  }
  const layers: Uint16Array[] = [];
  for (let layer = 0; layer < count; layer++) {
    const bits = value[at++] >> 1;
    const perWord = bits > 0 ? Math.floor(32 / bits) : 0;
    const wordCount = bits > 0 ? Math.ceil(4096 / perWord) : 0;
    const words = at;
    // The palette comes after the words: read it first, so the words unpack straight into ids.
    at += 4 * wordCount;
    const size = value.readInt32LE(at);
    at += 4;
    const map = new Uint16Array(Math.max(size, 1));
    for (let i = 0; i < size; i++) {
      const end = skipRoot(value, at);
      map[i] = palette.idOfRaw(value.subarray(at, end));
      at = end;
    }
    const ids = new Uint16Array(4096);
    if (bits === 0 || map.every((id) => id === map[0])) ids.fill(map[0]);
    else {
      const mask = (1 << bits) - 1;
      let i = 0;
      for (let w = 0; w < wordCount; w++) {
        let word = value.readUInt32LE(words + 4 * w);
        for (let k = 0; k < perWord && i < 4096; k++) {
          ids[i++] = map[word & mask] ?? 0;
          word >>>= bits;
        }
      }
    }
    layers.push(ids);
  }
  return { ...(y !== undefined ? { y } : {}), layers };
}

/** Whether a sub-chunk's blocks (layer 0) are all air, from its palette alone. */
export function allAir(value: Buffer, palette: BlockPalette): boolean {
  const version = value[0];
  let at = version === 9 ? 3 : version === 8 ? 2 : 1;
  const bits = value[at++] >> 1;
  if (bits > 0) at += 4 * Math.ceil(4096 / Math.floor(32 / bits));
  const size = value.readInt32LE(at);
  at += 4;
  for (let i = 0; i < size; i++) {
    const end = skipRoot(value, at);
    if (palette.idOfRaw(value.subarray(at, end)) !== 0) return false;
    at = end;
  }
  return true;
}

/** Where a little-endian NBT root tag (its type, name and payload) ends. */
function skipRoot(data: Buffer, at: number): number {
  return skipTag(data, at + 3 + data.readUInt16LE(at + 1), data[at]);
}

function skipTag(data: Buffer, at: number, type: number): number {
  switch (type) {
    case 1:
      return at + 1;
    case 2:
      return at + 2;
    case 3:
    case 5:
      return at + 4;
    case 4:
    case 6:
      return at + 8;
    case 7:
      return at + 4 + data.readInt32LE(at);
    case 8:
      return at + 2 + data.readUInt16LE(at);
    case 9: {
      const itemType = data[at];
      const count = data.readInt32LE(at + 1);
      let next = at + 5;
      for (let i = 0; i < count; i++) next = skipTag(data, next, itemType);
      return next;
    }
    case 10: {
      let next = at;
      for (;;) {
        const child = data[next++];
        if (child === 0) return next;
        next = skipTag(data, next + 2 + data.readUInt16LE(next), child);
      }
    }
    case 11:
      return at + 4 + 4 * data.readInt32LE(at);
    case 12:
      return at + 4 + 8 * data.readInt32LE(at);
    default:
      throw new Error(`an NBT tag of type ${type} in a sub-chunk's palette`);
  }
}
