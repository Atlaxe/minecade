// What BDS wrote into a world last, read from its LevelDB write-ahead logs (db/*.log): enough to
// tell whether a held save's own write is in a copy yet. `save hold` doesn't wait for that write:
// `save query` can say the files are ready while the world is still being written, and a copy taken
// then has the world as BDS last wrote it on its own (the markers and planes the cleanup took out
// still in it). So before a save, Edit's pack puts a new token in a world property, and the copy
// counts only once a full save (the write with the level's scoreboard, mob events and biome data,
// which BDS's own writes every few seconds leave out) has the token.
//
// A log is 32 KiB blocks of records, each with a 7-byte header (checksum, length, type: whole,
// first, middle or last part of a write batch). A batch is its sequence number, a count, then each
// put (a key and a value) or delete (a key).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const BLOCK = 32768;
const HEADER = 7;
const FULL = 1;
const FIRST = 2;
const MIDDLE = 3;
const LAST = 4;
const PUT = 1;
/** Keys only a full save writes. */
const FULL_SAVE_KEYS = ["scoreboard", "mobevents", "BiomeData"];
/** The key the world's dynamic properties are under. */
const PROPERTIES_KEY = "DynamicProperties";

export interface LogEntry {
  key: Buffer;
  /** Absent for a delete. */
  value?: Buffer;
}

/** Every whole write batch in a log, in order (a batch cut off at the end, still being written, is left out). */
export function logBatches(data: Buffer): LogEntry[][] {
  const batches: LogEntry[][] = [];
  let pending: Buffer[] = [];
  let at = 0;
  while (at + HEADER <= data.length) {
    const left = BLOCK - (at % BLOCK);
    if (left < HEADER) {
      at += left;
      continue;
    }
    const length = data.readUInt16LE(at + 4);
    const type = data[at + 6];
    at += HEADER;
    if (type === 0 && length === 0) {
      // Zeros to the block's end.
      at += BLOCK - (at % BLOCK);
      continue;
    }
    if (at + length > data.length) break;
    const payload = data.subarray(at, at + length);
    at += length;
    if (type === FULL) pending = [payload];
    else if (type === FIRST) pending = [payload];
    else if (type === MIDDLE) pending.push(payload);
    if (type === FULL || type === LAST) {
      if (type === LAST) pending.push(payload);
      const batch = readBatch(Buffer.concat(pending));
      if (batch) batches.push(batch);
      pending = [];
    }
  }
  return batches;
}

function readBatch(record: Buffer): LogEntry[] | undefined {
  if (record.length < 12) return undefined;
  const count = record.readUInt32LE(8);
  const entries: LogEntry[] = [];
  let at = 12;
  try {
    for (let i = 0; i < count; i++) {
      const kind = record[at++];
      const key = slice();
      entries.push(kind === PUT ? { key, value: slice() } : { key });
    }
  } catch {
    return undefined;
  }
  return entries;

  function slice(): Buffer {
    let length = 0;
    for (let shift = 0; ; shift += 7) {
      if (at >= record.length) throw new RangeError("cut off");
      const byte = record[at++];
      length |= (byte & 0x7f) << shift;
      if (byte < 0x80) break;
    }
    if (at + length > record.length) throw new RangeError("cut off");
    const value = record.subarray(at, at + length);
    at += length;
    return value;
  }
}

/** Whether a full save with `token` among the world's properties is in these batches (oldest first). */
export function fullSaveWith(batches: LogEntry[][], token: string): boolean {
  const mark = Buffer.from(token);
  let seen = false;
  for (const batch of batches) {
    const keys = new Set(batch.map((entry) => entry.key.toString("latin1")));
    if (batch.some((entry) => entry.key.toString("latin1") === PROPERTIES_KEY && entry.value?.includes(mark))) seen = true;
    if (seen && FULL_SAVE_KEYS.some((key) => keys.has(key))) return true;
  }
  return false;
}

/** Whether a world's db folder has a full save with `token` in it (its logs read in the order they were written). */
export async function savedWith(db: string, token: string): Promise<boolean> {
  const logs = (await readdir(db)).filter((name) => /^\d+\.log$/.test(name)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const batches: LogEntry[][] = [];
  for (const name of logs) batches.push(...logBatches(await readFile(join(db, name))));
  return fullSaveWith(batches, token);
}
