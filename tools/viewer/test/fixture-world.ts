// Small Bedrock worlds for the map viewer's tests, written as LevelDB and BDS write them: sorted
// tables (*.ldb) of internal keys with shared prefixes, write-ahead logs (*.log) of batches in
// 32 KiB blocks, a MANIFEST naming the live tables, and sub-chunks with NBT palettes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, deflateSync } from "node:zlib";
import nbt from "prismarine-nbt";
import type { BlockState } from "../subchunk.ts";

/** A put (with a value) or a delete (without), and its sequence number. */
export interface Put {
  key: Buffer;
  seq: number;
  value?: Buffer;
}

export interface Batch {
  seq: number;
  entries: { key: Buffer; value?: Buffer }[];
}

export function subChunkKey(x: number, z: number, y: number, dimension = 0): Buffer {
  const key = Buffer.alloc(dimension === 0 ? 10 : 14);
  key.writeInt32LE(x, 0);
  key.writeInt32LE(z, 4);
  if (dimension !== 0) key.writeInt32LE(dimension, 8);
  key[dimension === 0 ? 8 : 12] = 47;
  key.writeInt8(y, dimension === 0 ? 9 : 13);
  return key;
}

const AIR: BlockState = { name: "minecraft:air", states: {} };

/** A block's palette entry: its name, states (numbers as ints, unless the name says byte) and version. */
export function paletteEntry(block: BlockState, byteStates: string[] = []): Buffer {
  const states = Object.fromEntries(
    Object.entries(block.states).map(([key, value]) => [key, typeof value === "string" ? { type: "string", value } : byteStates.includes(key) ? { type: "byte", value } : { type: "int", value }]),
  );
  return nbt.writeUncompressed({ type: "compound", name: "", value: { name: { type: "string", value: block.name }, states: { type: "compound", value: states }, version: { type: "int", value: 18100737 } } } as nbt.NBT, "little");
}

export interface LayerSpec {
  /** The block at a spot (0 to 15 each), air when undefined. */
  at: (x: number, y: number, z: number) => BlockState | undefined;
  /** Bits per block to write (else the fewest that fit); 0 writes a one-block layer with no indices. */
  bits?: number;
  /** Palette entries no block uses, as BDS keeps after blocks change. */
  unused?: BlockState[];
}

/** A sub-chunk: version 9 (with its y index) or 8, and its layers. */
export function subChunk(layers: LayerSpec[], options: { version?: 8 | 9; y?: number; byteStates?: string[] } = {}): Buffer {
  const version = options.version ?? 9;
  const parts: Buffer[] = [Buffer.from(version === 9 ? [9, layers.length, (options.y ?? 0) & 0xff] : [8, layers.length])];
  for (const layer of layers) {
    const palette: BlockState[] = [];
    const indexOf = new Map<string, number>();
    const indices = new Uint16Array(4096);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 16; y++) {
      const block = layer.at(x, y, z) ?? AIR;
      const text = JSON.stringify(block);
      let index = indexOf.get(text);
      if (index === undefined) {
        index = palette.length;
        palette.push(block);
        indexOf.set(text, index);
      }
      indices[(x << 8) | (z << 4) | y] = index;
    }
    palette.push(...(layer.unused ?? []));
    const bits = layer.bits ?? [1, 2, 3, 4, 5, 6, 8, 16].find((n) => 2 ** n >= palette.length)!;
    parts.push(Buffer.from([bits << 1]));
    if (bits > 0) {
      const perWord = Math.floor(32 / bits);
      const words = Buffer.alloc(4 * Math.ceil(4096 / perWord));
      for (let i = 0; i < 4096; i++) {
        const at = 4 * Math.floor(i / perWord);
        words.writeUInt32LE((words.readUInt32LE(at) | (indices[i] << ((i % perWord) * bits))) >>> 0, at);
      }
      parts.push(words);
    }
    const size = Buffer.alloc(4);
    size.writeInt32LE(palette.length);
    parts.push(size, ...palette.map((block) => paletteEntry(block, options.byteStates)));
  }
  return Buffer.concat(parts);
}

function varint(value: number): Buffer {
  const bytes: number[] = [];
  for (let rest = value; ; rest = Math.floor(rest / 128)) {
    if (rest < 128) {
      bytes.push(rest);
      return Buffer.from(bytes);
    }
    bytes.push((rest % 128) | 0x80);
  }
}

/** A key as a table keeps it: the user's key, then 8 bytes of (sequence << 8) | type (1 a value, 0 a delete). */
function internalKey(put: Put): Buffer {
  const trailer = Buffer.alloc(8);
  trailer.writeBigUInt64LE((BigInt(put.seq) << 8n) | (put.value === undefined ? 0n : 1n));
  return Buffer.concat([put.key, trailer]);
}

/** A table block: keys sharing their prefix with the one before, a restart point every `restartEvery`. */
function tableBlock(entries: { key: Buffer; value: Buffer }[], restartEvery = 4): Buffer {
  const parts: Buffer[] = [];
  const restarts: number[] = [];
  let size = 0;
  let previous: Buffer = Buffer.alloc(0);
  entries.forEach(({ key, value }, i) => {
    let shared = 0;
    if (i % restartEvery === 0) restarts.push(size);
    else while (shared < key.length && shared < previous.length && key[shared] === previous[shared]) shared++;
    const entry = Buffer.concat([varint(shared), varint(key.length - shared), varint(value.length), key.subarray(shared), value]);
    parts.push(entry);
    size += entry.length;
    previous = key;
  });
  const tail = Buffer.alloc(4 * restarts.length + 4);
  restarts.forEach((offset, i) => tail.writeUInt32LE(offset, 4 * i));
  tail.writeUInt32LE(restarts.length, 4 * restarts.length);
  return Buffer.concat([...parts, tail]);
}

/** A table of these puts and deletes, sorted as LevelDB sorts them, `perBlock` to a data block, compressed in turn raw, zlib and not at all. */
export function table(puts: Put[], perBlock = 5): Buffer {
  const sorted = [...puts].sort((a, b) => Buffer.compare(a.key, b.key) || b.seq - a.seq).map((put) => ({ key: internalKey(put), value: put.value ?? Buffer.alloc(0) }));
  const out: Buffer[] = [];
  const handles: { key: Buffer; value: Buffer }[] = [];
  let at = 0;
  for (let start = 0, n = 0; start < sorted.length; start += perBlock, n++) {
    const entries = sorted.slice(start, start + perBlock);
    const plain = tableBlock(entries);
    const kind = [4, 2, 0][n % 3];
    const body = kind === 4 ? deflateRawSync(plain) : kind === 2 ? deflateSync(plain) : plain;
    handles.push({ key: entries[entries.length - 1].key, value: Buffer.concat([varint(at), varint(body.length)]) });
    out.push(body, Buffer.from([kind, 0, 0, 0, 0]));
    at += body.length + 5;
  }
  const meta = tableBlock([]);
  const metaAt = at;
  out.push(meta, Buffer.from([0, 0, 0, 0, 0]));
  at += meta.length + 5;
  const index = tableBlock(handles, 1);
  out.push(index, Buffer.from([0, 0, 0, 0, 0]));
  const footer = Buffer.alloc(48);
  Buffer.concat([varint(metaAt), varint(meta.length), varint(at), varint(index.length)]).copy(footer);
  footer.writeBigUInt64LE(0xdb4775248b80fb57n, 40);
  return Buffer.concat([...out, footer]);
}

const LOG_BLOCK = 32768;

/** A log of records in 32 KiB blocks, a record split into first, middle and last parts where it crosses one. */
function logOf(records: Buffer[]): Buffer {
  const out: Buffer[] = [];
  let size = 0;
  const push = (bytes: Buffer) => {
    out.push(bytes);
    size += bytes.length;
  };
  for (const data of records) {
    let at = 0;
    let first = true;
    do {
      let left = LOG_BLOCK - (size % LOG_BLOCK);
      if (left < 7) {
        push(Buffer.alloc(left));
        left = LOG_BLOCK;
      }
      const length = Math.min(data.length - at, left - 7);
      const last = at + length === data.length;
      const header = Buffer.alloc(7);
      header.writeUInt16LE(length, 4);
      header[6] = first && last ? 1 : first ? 2 : last ? 4 : 3;
      push(header);
      push(data.subarray(at, at + length));
      at += length;
      first = false;
    } while (at < data.length);
  }
  return Buffer.concat(out);
}

/** A write-ahead log of these batches. */
export function log(batches: Batch[]): Buffer {
  return logOf(
    batches.map(({ seq, entries }) => {
      const head = Buffer.alloc(12);
      head.writeBigUInt64LE(BigInt(seq), 0);
      head.writeUInt32LE(entries.length, 8);
      return Buffer.concat([head, ...entries.flatMap(({ key, value }) => (value === undefined ? [Buffer.from([0]), varint(key.length), key] : [Buffer.from([1]), varint(key.length), key, varint(value.length), value]))]);
    }),
  );
}

/** A MANIFEST: a version edit adding tables (and dropping some), as a compaction writes them. */
export function manifest(edits: { added?: number[]; deleted?: number[] }[]): Buffer {
  const slice = (text: string) => Buffer.concat([varint(text.length), Buffer.from(text, "latin1")]);
  return logOf([
    Buffer.concat([varint(1), slice("leveldb.BytewiseComparator")]),
    ...edits.map(({ added = [], deleted = [] }) =>
      Buffer.concat([
        varint(2),
        varint(3),
        varint(3),
        varint(10),
        varint(4),
        varint(999),
        ...deleted.flatMap((file) => [varint(6), varint(0), varint(file)]),
        ...added.flatMap((file) => [varint(7), varint(0), varint(file), varint(100), slice("a"), slice("z")]),
      ]),
    ),
  ]);
}

export interface WorldSpec {
  tables?: Record<number, Put[]>;
  logs?: Record<number, Batch[]>;
  /** The MANIFEST's edits; none written when left out. */
  manifest?: { added?: number[]; deleted?: number[] }[];
}

/** Writes a world's db\ folder in `world`. */
export function writeWorld(world: string, spec: WorldSpec): string {
  const db = join(world, "db");
  mkdirSync(db, { recursive: true });
  const name = (n: number, ext: string) => `${String(n).padStart(6, "0")}.${ext}`;
  for (const [n, puts] of Object.entries(spec.tables ?? {})) writeFileSync(join(db, name(Number(n), "ldb")), table(puts));
  for (const [n, batches] of Object.entries(spec.logs ?? {})) writeFileSync(join(db, name(Number(n), "log")), log(batches));
  if (spec.manifest) {
    writeFileSync(join(db, "MANIFEST-000002"), manifest(spec.manifest));
    writeFileSync(join(db, "CURRENT"), "MANIFEST-000002\n");
  }
  return world;
}
