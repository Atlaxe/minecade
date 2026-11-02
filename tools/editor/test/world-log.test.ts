import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fullSaveWith, logBatches, savedWith } from "../world-log.ts";

const BLOCK = 32768;

/** A batch as LevelDB writes it: sequence, count, then puts (key, value) and deletes (key). */
function batch(sequence: number, entries: [string, string | Buffer | undefined][]): Buffer {
  const head = Buffer.alloc(12);
  head.writeBigUInt64LE(BigInt(sequence), 0);
  head.writeUInt32LE(entries.length, 8);
  const parts: Buffer[] = [head];
  for (const [key, value] of entries) {
    parts.push(Buffer.from([value === undefined ? 0 : 1]), varint(key.length), Buffer.from(key, "latin1"));
    if (value !== undefined) {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1");
      parts.push(varint(bytes.length), bytes);
    }
  }
  return Buffer.concat(parts);
}

function varint(value: number): Buffer {
  const bytes: number[] = [];
  do {
    bytes.push((value & 0x7f) | (value > 0x7f ? 0x80 : 0));
    value >>>= 7;
  } while (value > 0);
  return Buffer.from(bytes);
}

/** A log of these batches: records in 32 KiB blocks, a batch split into first, middle and last parts where it crosses one. */
function log(batches: Buffer[]): Buffer {
  const out: Buffer[] = [];
  let size = 0;
  const push = (bytes: Buffer) => {
    out.push(bytes);
    size += bytes.length;
  };
  for (const data of batches) {
    let at = 0;
    let first = true;
    do {
      let left = BLOCK - (size % BLOCK);
      if (left < 7) {
        push(Buffer.alloc(left));
        left = BLOCK;
      }
      const length = Math.min(data.length - at, left - 7);
      const last = at + length === data.length;
      const type = first && last ? 1 : first ? 2 : last ? 4 : 3;
      const header = Buffer.alloc(7);
      header.writeUInt16LE(length, 4);
      header[6] = type;
      push(header);
      push(data.subarray(at, at + length));
      at += length;
      first = false;
    } while (at < data.length);
  }
  return Buffer.concat(out);
}

const props = (text: string) => Buffer.from(`\x08\x14\x00minecade:saveToken${text}`, "latin1");

describe("reading what BDS wrote into a world (world-log.ts)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "minecade-world-log-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads batches whole, also ones split across blocks, and leaves out one cut off at the end", () => {
    const big = Buffer.alloc(70_000, 7);
    const data = log([batch(1, [["chunk", big]]), batch(2, [["a", "1"], ["b", undefined]])]);
    const batches = logBatches(data);
    expect(batches).toHaveLength(2);
    expect(batches[0][0].value?.equals(big)).toBe(true);
    expect(batches[1].map((entry) => [entry.key.toString(), entry.value?.toString()])).toEqual([
      ["a", "1"],
      ["b", undefined],
    ]);
    const cut = log([batch(1, [["a", "1"]]), batch(2, [["chunk", big]])]);
    expect(logBatches(cut.subarray(0, cut.length - 100))).toHaveLength(1);
  });

  it("finds a full save only once one has the token, not BDS's own writes in between", () => {
    const own = batch(1, [["DynamicProperties", props("abc")], ["WorldClocks", "x"]]);
    const fullBefore = batch(2, [["DynamicProperties", props("old")], ["scoreboard", "x"], ["mobevents", "x"]]);
    const fullAfter = batch(3, [["DynamicProperties", props("abc")], ["scoreboard", "x"], ["BiomeData", "x"]]);
    expect(fullSaveWith(logBatches(log([fullBefore, own])), "abc")).toBe(false);
    expect(fullSaveWith(logBatches(log([fullBefore, own, fullAfter])), "abc")).toBe(true);
    // The token in one write, the full save's level data in the next.
    expect(fullSaveWith(logBatches(log([own, batch(4, [["mobevents", "x"]])])), "abc")).toBe(true);
  });

  it("reads every log in a db folder, oldest first", async () => {
    const db = join(dir, "db");
    await mkdir(db);
    await writeFile(join(db, "000012.log"), log([batch(9, [["mobevents", "x"]])]));
    await writeFile(join(db, "000009.log"), log([batch(1, [["DynamicProperties", props("tok")]])]));
    await writeFile(join(db, "000010.ldb"), "not a log");
    expect(await savedWith(db, "tok")).toBe(true);
    expect(await savedWith(db, "other")).toBe(false);
  });
});
