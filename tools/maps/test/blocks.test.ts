import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { worldNames } from "../blocks.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

/** A table block: entries with whole keys, then one restart point. */
function tableBlock(entries: [string, Buffer][]): Buffer {
  const parts = entries.flatMap(([key, value]) => [varint(0), varint(key.length), varint(value.length), Buffer.from(key), value]);
  const restarts = Buffer.alloc(8);
  restarts.writeUInt32LE(0, 0);
  restarts.writeUInt32LE(1, 4);
  return Buffer.concat([...parts, restarts]);
}

/** A LevelDB table (.ldb) holding these values, its data blocks compressed as Bedrock and zlib do. */
function table(blocks: { values: Buffer[]; compress: "raw" | "zlib" | "none" }[]): Buffer {
  const out: Buffer[] = [];
  let at = 0;
  const handles: [string, Buffer][] = [];
  blocks.forEach(({ values, compress }, index) => {
    const plain = tableBlock(values.map((value, n) => [`key${index}-${n}`, value]));
    const body = compress === "raw" ? deflateRawSync(plain) : compress === "zlib" ? deflateSync(plain) : plain;
    const kind = compress === "raw" ? 4 : compress === "zlib" ? 2 : 0;
    handles.push([`key${index}`, Buffer.concat([varint(at), varint(body.length)])]);
    out.push(body, Buffer.from([kind, 0, 0, 0, 0]));
    at += body.length + 5;
  });
  const index = tableBlock(handles);
  out.push(index, Buffer.from([0, 0, 0, 0, 0]));
  const footer = Buffer.alloc(48);
  Buffer.concat([varint(0), varint(0), varint(at), varint(index.length)]).copy(footer);
  return Buffer.concat([...out, footer]);
}

describe("worldNames", () => {
  it("finds every minecade name in a world's tables and logs", () => {
    const world = mkdtempSync(join(tmpdir(), "minecade-world-"));
    dirs.push(world);
    mkdirSync(join(world, "db"));
    const palette = (name: string) => Buffer.concat([Buffer.from([10, 0, 0, 8, 4, 0]), Buffer.from(`name${name}`, "latin1"), Buffer.from([0, 0])]);
    writeFileSync(
      join(world, "db", "000005.ldb"),
      table([
        { values: [palette("minecade:oak_chair"), palette("minecraft:stone")], compress: "raw" },
        { values: [palette("minecade:red_lamp"), palette("minecade:oak_chair")], compress: "zlib" },
        { values: [palette("minecade:facing")], compress: "none" },
      ]),
    );
    writeFileSync(join(world, "db", "000006.log"), Buffer.concat([Buffer.from([1, 2, 3]), palette("minecade:red_lamp_connector")]));
    writeFileSync(join(world, "db", "MANIFEST-000004"), "minecade:not_a_world_value");
    expect(worldNames(world)).toEqual(["minecade:facing", "minecade:oak_chair", "minecade:red_lamp", "minecade:red_lamp_connector"]);
  });

  it("finds nothing in a world without a db folder", () => {
    const world = mkdtempSync(join(tmpdir(), "minecade-world-"));
    dirs.push(world);
    expect(worldNames(world)).toEqual([]);
  });
});
