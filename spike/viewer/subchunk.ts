// Bedrock chunk data: keys, sub-chunks (16x16x16 blocks) and height maps.
//
// Keys: chunk x and z (32-bit little-endian), a dimension number for the Nether and the End only,
// a tag byte, and for a sub-chunk (tag 47) its y index (a signed byte). Tag 43 is Data3D: 256
// 16-bit heights, then biomes.
//
// A sub-chunk: a version byte (8 or 9; 1 is one layer with no count), the number of storage
// layers, in version 9 its y index, then each layer: a byte whose upper 7 bits are the bits per
// block, the palette indices packed into 32-bit words (low bits first, a word never splits an
// index; y changes fastest, then z, then x), the palette's size (32-bit) and each entry, a
// little-endian NBT compound (name, states, version). Layer 0 is the blocks, layer 1 mostly the
// water in waterlogged blocks.
import nbt from "prismarine-nbt";

export const SUBCHUNK = 47;
export const DATA3D = 43;
export const DATA2D = 45;

export interface ChunkKey {
  x: number;
  z: number;
  dimension: number;
  tag: number;
  /** A sub-chunk's y index. */
  y?: number;
}

export function chunkKey(key: Buffer): ChunkKey | undefined {
  if (key.length === 9 || key.length === 10) {
    return { x: key.readInt32LE(0), z: key.readInt32LE(4), dimension: 0, tag: key[8], ...(key.length === 10 ? { y: key.readInt8(9) } : {}) };
  }
  if (key.length === 13 || key.length === 14) {
    return { x: key.readInt32LE(0), z: key.readInt32LE(4), dimension: key.readInt32LE(8), tag: key[12], ...(key.length === 14 ? { y: key.readInt8(13) } : {}) };
  }
  return undefined;
}

export interface BlockState {
  name: string;
  states: Record<string, string | number>;
}

/** Every block state met so far, numbered from 0 (air). Entries are found by their raw NBT bytes first. */
export class Palette {
  readonly blocks: BlockState[] = [{ name: "minecraft:air", states: {} }];
  private readonly byText = new Map<string, number>([["minecraft:air{}", 0]]);
  private readonly byRaw = new Map<string, number>();
  parsed = 0;

  idOfRaw(raw: Buffer): number {
    const key = raw.toString("latin1");
    const known = this.byRaw.get(key);
    if (known !== undefined) return known;
    this.parsed++;
    const tag = nbt.protos.little.parsePacketBuffer("nbt", raw, 0).data;
    const value = nbt.simplify(tag) as { name: string; states?: Record<string, string | number> };
    const id = this.idOf({ name: value.name, states: value.states ?? {} });
    this.byRaw.set(key, id);
    return id;
  }

  idOf(block: BlockState): number {
    const text = `${block.name}${JSON.stringify(Object.fromEntries(Object.entries(block.states).sort(([a], [b]) => a.localeCompare(b))))}`;
    let id = this.byText.get(text);
    if (id === undefined) {
      id = this.blocks.length;
      this.blocks.push(block);
      this.byText.set(text, id);
    }
    return id;
  }
}

/** A sub-chunk's layers as palette ids, 4096 each, at (x << 8) | (z << 4) | y. */
export function decodeSubChunk(value: Buffer, palette: Palette): { y?: number; layers: Uint16Array[] } {
  const version = value[0];
  let at = 1;
  let count = 1;
  let y: number | undefined;
  if (version === 8 || version === 9) {
    count = value[at++];
    if (version === 9) y = value.readInt8(at++);
  } else if (version !== 1) {
    throw new Error(`a sub-chunk in format ${version}, which is older than this reads`);
  }
  const layers: Uint16Array[] = [];
  for (let layer = 0; layer < count; layer++) {
    const bits = value[at++] >> 1;
    const perWord = bits > 0 ? Math.floor(32 / bits) : 0;
    const wordCount = bits > 0 ? Math.ceil(4096 / perWord) : 0;
    const words = at;
    // The palette comes after the words; read it first so the words unpack straight to ids.
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
export function allAir(value: Buffer, palette: Palette): boolean {
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

/** Where a little-endian NBT root tag (type, name, payload) ends. */
function skipRoot(data: Buffer, at: number): number {
  const type = data[at];
  const nameLength = data.readUInt16LE(at + 1);
  return skip(data, at + 3 + nameLength, type);
}

function skip(data: Buffer, at: number, type: number): number {
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
      for (let i = 0; i < count; i++) next = skip(data, next, itemType);
      return next;
    }
    case 10: {
      let next = at;
      for (;;) {
        const child = data[next++];
        if (child === 0) return next;
        next += 2 + data.readUInt16LE(next);
        next = skip(data, next, child);
      }
    }
    case 11:
      return at + 4 + 4 * data.readInt32LE(at);
    case 12:
      return at + 4 + 8 * data.readInt32LE(at);
    default:
      throw new Error(`an NBT tag of type ${type}`);
  }
}
