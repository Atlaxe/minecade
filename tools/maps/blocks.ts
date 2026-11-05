// The custom blocks a Bedrock world uses: every "minecade:<name>" in its LevelDB, the tables'
// values decompressed (zlib, or raw deflate) and the logs as they are. The network's build cuts
// the shared blocks pack down to the blocks the published maps use (tools/build/blocks-cut.ts).
// It reads every value, so nothing a world holds is missed; names that aren't blocks (states,
// entities) and blocks a log still names after they were replaced come along too, which only
// keeps a few more blocks. A port of the block-pack project's tools/map_blocks.py.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";

const NAME = /minecade:[a-z0-9_]+/g;

/** Every "minecade:" name in the world folder's db\, sorted. */
export function worldNames(world: string): string[] {
  const db = join(world, "db");
  const names = new Set<string>();
  if (!existsSync(db)) return [];
  for (const file of readdirSync(db)) {
    const path = join(db, file);
    if (file.endsWith(".ldb")) for (const value of tableValues(readFileSync(path))) addNames(names, value);
    else if (file.endsWith(".log")) addNames(names, readFileSync(path));
  }
  return [...names].sort();
}

function addNames(names: Set<string>, bytes: Buffer): void {
  for (const match of bytes.toString("latin1").matchAll(NAME)) names.add(match[0]);
}

/** Every value in a LevelDB table: the footer's index block names the data blocks. */
function tableValues(data: Buffer): Buffer[] {
  const footer = data.subarray(data.length - 48);
  let at = 0;
  // The metaindex block's handle comes first, then the index block's.
  [, at] = varint(footer, at);
  [, at] = varint(footer, at);
  const [indexOffset, afterOffset] = varint(footer, at);
  const [indexSize] = varint(footer, afterOffset);
  const values: Buffer[] = [];
  for (const handle of blockEntries(block(data, indexOffset, indexSize))) {
    const [offset, next] = varint(handle, 0);
    const [size] = varint(handle, next);
    values.push(...blockEntries(block(data, offset, size)));
  }
  return values;
}

/** A table block's contents, decompressed by the type byte after it: 0 none, 2 zlib, 4 raw deflate (Bedrock's). */
function block(data: Buffer, offset: number, size: number): Buffer {
  const raw = data.subarray(offset, offset + size);
  const kind = data[offset + size];
  if (kind === 0) return raw;
  if (kind === 2) return inflateSync(raw);
  if (kind === 4) return inflateRawSync(raw);
  throw new Error(`a LevelDB table block compressed with type ${kind}, which this can't read`);
}

/** A block's values: entries with prefix-compressed keys, then the restart points and their count. */
function blockEntries(contents: Buffer): Buffer[] {
  const restarts = contents.readUInt32LE(contents.length - 4);
  const end = contents.length - 4 - 4 * restarts;
  const values: Buffer[] = [];
  let at = 0;
  while (at < end) {
    [, at] = varint(contents, at);
    let unshared: number;
    let size: number;
    [unshared, at] = varint(contents, at);
    [size, at] = varint(contents, at);
    at += unshared;
    values.push(contents.subarray(at, at + size));
    at += size;
  }
  return values;
}

function varint(data: Buffer, start: number): [number, number] {
  let result = 0;
  let shift = 0;
  let at = start;
  for (;;) {
    const byte = data[at++];
    result += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [result, at];
    shift += 7;
  }
}
