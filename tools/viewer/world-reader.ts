// The map viewer's world reader: every key's newest value in a Bedrock world's LevelDB (db\),
// without a server, and without changing it. A world is sorted tables (*.ldb) and write-ahead logs
// (*.log) of writes not yet in a table. Every entry has a sequence number (a table's in the 8 bytes
// after its key, a log's from its batch), so the highest one wins and a delete removes the key,
// whether or not the world was compacted. The MANIFEST names the tables in use; a table it doesn't
// name is left over from a compaction and skipped. Tables are read by tools/maps/blocks.ts, logs
// and the MANIFEST by tools/editor/world-log.ts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logRecords, logWrites } from "../editor/world-log.ts";
import { tableEntries } from "../maps/blocks.ts";

export interface DbStats {
  tables: number;
  logs: number;
  /** Tables the MANIFEST doesn't name. */
  skippedTables: number;
  /** Entries read, before the newest of each key is taken. */
  entries: number;
}

/**
 * The newest value of each key (by its bytes as latin1), deletes left out. `want` skips keys the
 * caller has no use for before they're kept.
 */
export function readWorldDb(db: string, want: (key: Buffer) => boolean = () => true): { values: Map<string, Buffer>; stats: DbStats } {
  const newest = new Map<string, { seq: number; value: Buffer | undefined }>();
  const stats: DbStats = { tables: 0, logs: 0, skippedTables: 0, entries: 0 };
  const put = (key: Buffer, seq: number, value: Buffer | undefined) => {
    stats.entries++;
    if (!want(key)) return;
    const id = key.toString("latin1");
    const old = newest.get(id);
    if (!old || old.seq < seq) newest.set(id, { seq, value });
  };
  const live = liveTables(db);
  for (const name of readdirSync(db).sort()) {
    const path = join(db, name);
    if (name.endsWith(".ldb")) {
      if (live && !live.has(parseInt(name, 10))) {
        stats.skippedTables++;
        continue;
      }
      stats.tables++;
      for (const { key, value } of tableEntries(readFileSync(path))) {
        const n = key.length - 8;
        const low = key.readUInt32LE(n);
        put(key.subarray(0, n), key.readUInt32LE(n + 4) * 2 ** 24 + (low >>> 8), (low & 0xff) === 1 ? value : undefined);
      }
    } else if (name.endsWith(".log")) {
      stats.logs++;
      for (const { seq, entries } of logWrites(readFileSync(path))) entries.forEach((entry, i) => put(entry.key, seq + i, entry.value));
    }
  }
  const values = new Map<string, Buffer>();
  for (const [key, { value }] of newest) if (value) values.set(key, value);
  return { values, stats };
}

/** The table numbers the current MANIFEST says are in use, or undefined when it can't be read (then every table is). */
export function liveTables(db: string): Set<number> | undefined {
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
      if (tag === COMPARATOR) at = skipSlice(record, at);
      else if (tag === LOG_NUMBER || tag === NEXT_FILE || tag === LAST_SEQUENCE || tag === PREVIOUS_LOG) [, at] = varint(record, at);
      else if (tag === COMPACT_POINTER) {
        [, at] = varint(record, at);
        at = skipSlice(record, at);
      } else if (tag === DELETED_FILE) {
        let file: number;
        [, at] = varint(record, at);
        [file, at] = varint(record, at);
        live.delete(file);
      } else if (tag === NEW_FILE) {
        let file: number;
        [, at] = varint(record, at);
        [file, at] = varint(record, at);
        [, at] = varint(record, at);
        at = skipSlice(record, at);
        at = skipSlice(record, at);
        live.add(file);
      } else return undefined;
    }
  }
  return live;
}

// A MANIFEST version edit's tags (LevelDB's version_edit.cc).
const COMPARATOR = 1;
const LOG_NUMBER = 2;
const NEXT_FILE = 3;
const LAST_SEQUENCE = 4;
const COMPACT_POINTER = 5;
/** Level, file number. */
const DELETED_FILE = 6;
/** Level, file number, size, smallest key, largest key. */
const NEW_FILE = 7;
const PREVIOUS_LOG = 9;

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
