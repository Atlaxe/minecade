// A Bedrock world's LevelDB (db\), read without a server: every key's newest value. A world is
// sorted tables (*.ldb, blocks compressed with zlib or raw deflate) and write-ahead logs (*.log,
// write batches not yet in a table). Every entry has a sequence number: in a table, the 8 bytes
// after the user key ((seq << 8) | type, type 1 a value, 0 a delete); in a log, the batch's first
// number plus the entry's place in it. The highest number wins, so it doesn't matter whether a
// world was compacted. The MANIFEST names the tables still in use; ones it doesn't name are left
// over from a compaction and skipped.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";

export interface DbStats {
  tables: number;
  logs: number;
  skippedTables: number;
  entries: number;
  deletes: number;
}

/** Newest values by key (latin1), deletes left out. `want` skips keys a caller has no use for. */
export function readDb(db: string, want: (key: Buffer) => boolean = () => true): { values: Map<string, Buffer>; stats: DbStats } {
  const newest = new Map<string, { seq: number; value: Buffer | undefined }>();
  const stats: DbStats = { tables: 0, logs: 0, skippedTables: 0, entries: 0, deletes: 0 };
  const put = (key: Buffer, seq: number, value: Buffer | undefined) => {
    stats.entries++;
    if (!want(key)) return;
    const id = key.toString("latin1");
    const old = newest.get(id);
    if (!old || old.seq < seq) newest.set(id, { seq, value });
  };
  const live = liveTables(db);
  for (const name of readdirSync(db)) {
    const path = join(db, name);
    if (name.endsWith(".ldb")) {
      if (live && !live.has(parseInt(name, 10))) {
        stats.skippedTables++;
        continue;
      }
      stats.tables++;
      readTable(readFileSync(path), put);
    } else if (name.endsWith(".log")) {
      stats.logs++;
      for (const { seq, entries } of logBatchesWithSeq(readFileSync(path))) entries.forEach((entry, i) => put(entry.key, seq + i, entry.value));
    }
  }
  const values = new Map<string, Buffer>();
  for (const [key, { value }] of newest) {
    if (value) values.set(key, value);
    else stats.deletes++;
  }
  return { values, stats };
}

/** A table's entries, in order: keys rebuilt from their shared prefixes. */
function readTable(data: Buffer, put: (key: Buffer, seq: number, value: Buffer | undefined) => void): void {
  const footer = data.subarray(data.length - 48);
  let at = 0;
  [, at] = varint(footer, at);
  [, at] = varint(footer, at);
  const [indexOffset, afterOffset] = varint(footer, at);
  const [indexSize] = varint(footer, afterOffset);
  for (const { value: handle } of blockEntries(block(data, indexOffset, indexSize))) {
    const [offset, next] = varint(handle, 0);
    const [size] = varint(handle, next);
    for (const { key, value } of blockEntries(block(data, offset, size))) {
      const n = key.length - 8;
      const low = key.readUInt32LE(n);
      const high = key.readUInt32LE(n + 4);
      const seq = high * 2 ** 24 + (low >>> 8);
      put(Buffer.from(key.subarray(0, n)), seq, (low & 0xff) === 1 ? value : undefined);
    }
  }
}

function block(data: Buffer, offset: number, size: number): Buffer {
  const raw = data.subarray(offset, offset + size);
  const kind = data[offset + size];
  if (kind === 0) return raw;
  if (kind === 2) return inflateSync(raw);
  if (kind === 4) return inflateRawSync(raw);
  throw new Error(`a LevelDB table block compressed with type ${kind}`);
}

function blockEntries(contents: Buffer): { key: Buffer; value: Buffer }[] {
  const restarts = contents.readUInt32LE(contents.length - 4);
  const end = contents.length - 4 - 4 * restarts;
  const entries: { key: Buffer; value: Buffer }[] = [];
  let previous = Buffer.alloc(0);
  let at = 0;
  while (at < end) {
    let shared: number;
    let unshared: number;
    let size: number;
    [shared, at] = varint(contents, at);
    [unshared, at] = varint(contents, at);
    [size, at] = varint(contents, at);
    const key = shared === 0 ? contents.subarray(at, at + unshared) : Buffer.concat([previous.subarray(0, shared), contents.subarray(at, at + unshared)]);
    at += unshared;
    entries.push({ key, value: contents.subarray(at, at + size) });
    at += size;
    previous = key;
  }
  return entries;
}

/** A log's write batches: each one's first sequence number, then its puts and deletes. A batch cut off at the end is left out. */
function logBatchesWithSeq(data: Buffer): { seq: number; entries: { key: Buffer; value?: Buffer }[] }[] {
  const batches: { seq: number; entries: { key: Buffer; value?: Buffer }[] }[] = [];
  for (const record of logRecords(data)) {
    if (record.length < 12) continue;
    const seq = record.readUInt32LE(4) * 2 ** 32 + record.readUInt32LE(0);
    const count = record.readUInt32LE(8);
    const entries: { key: Buffer; value?: Buffer }[] = [];
    let at = 12;
    try {
      for (let i = 0; i < count; i++) {
        const kind = record[at++];
        let key: Buffer;
        [key, at] = slice(record, at);
        if (kind === 1) {
          let value: Buffer;
          [value, at] = slice(record, at);
          entries.push({ key, value });
        } else entries.push({ key });
      }
    } catch {
      continue;
    }
    batches.push({ seq, entries });
  }
  return batches;
}

function slice(data: Buffer, at: number): [Buffer, number] {
  const [length, next] = varint(data, at);
  if (next + length > data.length) throw new RangeError("cut off");
  return [data.subarray(next, next + length), next + length];
}

/** The table numbers the newest MANIFEST says are in use, or undefined when there's none to read. */
function liveTables(db: string): Set<number> | undefined {
  const current = join(db, "CURRENT");
  if (!existsSync(current)) return undefined;
  const manifest = join(db, readFileSync(current, "utf8").trim());
  if (!existsSync(manifest)) return undefined;
  const live = new Set<number>();
  for (const record of logRecords(readFileSync(manifest))) {
    let at = 0;
    while (at < record.length) {
      let tag: number;
      [tag, at] = varint(record, at);
      if (tag === 1) at = skipSlice(record, at); // comparator
      else if (tag === 2 || tag === 3 || tag === 4 || tag === 9) [, at] = varint(record, at); // log, next file, last sequence, previous log
      else if (tag === 5) {
        [, at] = varint(record, at); // compact pointer: level, key
        at = skipSlice(record, at);
      } else if (tag === 6) {
        let file: number;
        [, at] = varint(record, at);
        [file, at] = varint(record, at);
        live.delete(file);
      } else if (tag === 7) {
        let file: number;
        [, at] = varint(record, at);
        [file, at] = varint(record, at);
        [, at] = varint(record, at); // size
        at = skipSlice(record, at); // smallest key
        at = skipSlice(record, at); // largest key
        live.add(file);
      } else return undefined; // a tag this doesn't know: read every table instead

    }
  }
  return live;
}

/** A log's whole records (the MANIFEST is a log of version edits). */
function logRecords(data: Buffer): Buffer[] {
  const BLOCK = 32768;
  const records: Buffer[] = [];
  let pending: Buffer[] = [];
  let at = 0;
  while (at + 7 <= data.length) {
    const left = BLOCK - (at % BLOCK);
    if (left < 7) {
      at += left;
      continue;
    }
    const length = data.readUInt16LE(at + 4);
    const type = data[at + 6];
    at += 7;
    if (type === 0 && length === 0) {
      at += BLOCK - (at % BLOCK);
      continue;
    }
    if (at + length > data.length) break;
    const payload = data.subarray(at, at + length);
    at += length;
    if (type === 1) records.push(payload);
    else if (type === 2) pending = [payload];
    else if (type === 3) pending.push(payload);
    else if (type === 4) {
      pending.push(payload);
      records.push(Buffer.concat(pending));
      pending = [];
    }
  }
  return records;
}

function skipSlice(data: Buffer, at: number): number {
  const [length, next] = varint(data, at);
  return next + length;
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
