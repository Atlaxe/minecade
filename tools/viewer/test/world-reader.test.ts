import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { liveTables, readWorldDb } from "../world-reader.ts";
import { writeWorld, type WorldSpec } from "./fixture-world.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const key = (text: string) => Buffer.from(text, "latin1");
const value = (text: string) => Buffer.from(text, "latin1");

function read(spec: WorldSpec, want?: (key: Buffer) => boolean) {
  const world = mkdtempSync(join(tmpdir(), "minecade-viewer-"));
  dirs.push(world);
  writeWorld(world, spec);
  const { values, stats } = readWorldDb(join(world, "db"), want);
  return { values: Object.fromEntries([...values].map(([k, v]) => [k, v.toString("latin1")])), stats };
}

describe("readWorldDb", () => {
  it("takes a log's newer value over a table's", () => {
    const { values } = read({
      tables: { 5: [{ key: key("a"), seq: 1, value: value("old") }, { key: key("b"), seq: 2, value: value("b") }] },
      logs: { 6: [{ seq: 10, entries: [{ key: key("a"), value: value("new") }] }] },
    });
    expect(values).toEqual({ a: "new", b: "b" });
  });

  it("keeps a table's value over an older log's (a log already compacted)", () => {
    const { values } = read({
      tables: { 7: [{ key: key("c"), seq: 20, value: value("table") }] },
      logs: { 3: [{ seq: 3, entries: [{ key: key("c"), value: value("log") }] }] },
    });
    expect(values).toEqual({ c: "table" });
  });

  it("counts each entry of a batch from its first sequence number", () => {
    // The table's d is seq 11: the batch's first put (seq 10) is older, its third (seq 12) newer.
    const { values } = read({
      tables: { 5: [{ key: key("d"), seq: 11, value: value("table") }] },
      logs: { 6: [{ seq: 10, entries: [{ key: key("d"), value: value("log") }, { key: key("x"), value: value("x") }, { key: key("e"), value: value("e") }] }] },
    });
    expect(values.d).toBe("table");
    const newer = read({
      tables: { 5: [{ key: key("d"), seq: 11, value: value("table") }] },
      logs: { 6: [{ seq: 10, entries: [{ key: key("x"), value: value("x") }, { key: key("x2"), value: value("x") }, { key: key("d"), value: value("log") }] }] },
    });
    expect(newer.values.d).toBe("log");
  });

  it("drops a key whose newest entry is a delete, in a log or a table", () => {
    const { values } = read({
      tables: {
        5: [{ key: key("a"), seq: 1, value: value("a") }, { key: key("b"), seq: 2, value: value("b") }],
        6: [{ key: key("b"), seq: 8 }],
      },
      logs: { 7: [{ seq: 9, entries: [{ key: key("a") }] }] },
    });
    expect(values).toEqual({});
  });

  it("rebuilds keys that share a prefix, across data blocks compressed every way", () => {
    const puts = Array.from({ length: 23 }, (_, i) => ({ key: key(`chunk-${String(i).padStart(3, "0")}`), seq: i + 1, value: value(`v${i}`) }));
    const { values, stats } = read({ tables: { 5: puts } });
    expect(Object.keys(values)).toHaveLength(23);
    expect(values["chunk-017"]).toBe("v17");
    expect(stats).toMatchObject({ tables: 1, entries: 23 });
  });

  it("reads a batch split across log blocks", () => {
    const big = Buffer.alloc(80_000, 7);
    const world = mkdtempSync(join(tmpdir(), "minecade-viewer-"));
    dirs.push(world);
    writeWorld(world, { logs: { 4: [{ seq: 1, entries: [{ key: key("small"), value: value("s") }] }, { seq: 2, entries: [{ key: key("big"), value: big }] }] } });
    const { values } = readWorldDb(join(world, "db"));
    expect(values.get("big")?.equals(big)).toBe(true);
    expect(values.get("small")?.toString()).toBe("s");
  });

  it("skips tables the MANIFEST doesn't name", () => {
    const { values, stats } = read({
      tables: { 5: [{ key: key("left"), seq: 50, value: value("over") }], 8: [{ key: key("live"), seq: 1, value: value("yes") }] },
      manifest: [{ added: [5] }, { added: [8], deleted: [5] }],
    });
    expect(values).toEqual({ live: "yes" });
    expect(stats).toMatchObject({ tables: 1, skippedTables: 1 });
  });

  it("reads every table when there's no MANIFEST", () => {
    const { values } = read({ tables: { 5: [{ key: key("a"), seq: 1, value: value("a") }], 8: [{ key: key("b"), seq: 2, value: value("b") }] } });
    expect(values).toEqual({ a: "a", b: "b" });
  });

  it("keeps only the keys asked for", () => {
    const { values, stats } = read({ tables: { 5: [{ key: key("keep-1"), seq: 1, value: value("1") }, { key: key("drop"), seq: 2, value: value("2") }] } }, (k) => k.toString().startsWith("keep"));
    expect(values).toEqual({ "keep-1": "1" });
    expect(stats.entries).toBe(2);
  });
});

describe("liveTables", () => {
  it("follows the MANIFEST's edits", () => {
    const world = mkdtempSync(join(tmpdir(), "minecade-viewer-"));
    dirs.push(world);
    writeWorld(world, { manifest: [{ added: [4, 5] }, { added: [9], deleted: [4] }] });
    expect([...liveTables(join(world, "db"))!].sort()).toEqual([5, 9]);
  });

  it("is undefined without a MANIFEST", () => {
    const world = mkdtempSync(join(tmpdir(), "minecade-viewer-"));
    dirs.push(world);
    writeWorld(world, {});
    expect(liveTables(join(world, "db"))).toBeUndefined();
  });
});
