// An arena map's Arena box, cut out of its world as a structure when it's published (store.ts,
// writeArenaStructure), and the copy of a game's published arena maps a Preview brings
// (arena-maps.ts).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nbt from "prismarine-nbt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeLevelDat } from "../../build/leveldat.ts";
import { subChunk, subChunkKey, writeWorld } from "../../viewer/test/fixture-world.ts";
import { copyArenaMaps } from "../arena-maps.ts";
import { MapStore, STRUCTURE_FILE } from "../store.ts";

const LEVEL_DAT = encodeLevelDat({ storageVersion: 10, root: { ...nbt.comp({ LevelName: nbt.string("Test") }), name: "" } as nbt.NBT });
const STONE = { name: "minecraft:stone", states: {} };

let dir: string;
let store: MapStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minecade-arena-test-"));
  store = MapStore.open(join(dir, "store"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A map whose world has a 4 x 4 stone floor at y 0 from 0, 0, and the map.json given. */
function writeMap(target: string, map: string, config: object): void {
  const folder = store.folder(target, map);
  mkdirSync(join(folder, "world"), { recursive: true });
  writeFileSync(join(folder, "map.json"), JSON.stringify(config));
  writeFileSync(join(folder, "world", "level.dat"), LEVEL_DAT);
  const floor = subChunk([{ at: (x, y, z) => (y === 0 && x < 4 && z < 4 ? STONE : undefined) }], { y: 0 });
  writeWorld(join(folder, "world"), { tables: { 5: [{ key: subChunkKey(0, 0, 0), seq: 1, value: floor }] } });
}

const published = (...path: string[]) => join(store.dir, "published", ...path);

describe("an arena map's structure", () => {
  it("is its Arena box, written beside its published world", () => {
    writeMap("blockparty-hotfloor", "test", { name: "Test", regions: { structure: [{ min: [0, 0, 0], max: [3, 2, 3] }] } });
    store.publish("blockparty-hotfloor", "test");
    store.exportPublished();
    const file = published("worlds", "blockparty-hotfloor", "test", "1", STRUCTURE_FILE);
    expect(existsSync(file)).toBe(true);
    const root = nbt.simplify(nbt.parseUncompressed(readFileSync(file), "little")) as { size: number[]; structure: { palette: { default: { block_palette: { name: string }[] } } } };
    expect(root.size).toEqual([4, 3, 4]);
    expect(root.structure.palette.default.block_palette.map((entry) => entry.name).sort()).toEqual(["minecraft:air", "minecraft:stone"]);
  });

  it("is written for a version published before, and only for a map with an Arena box", () => {
    writeMap("sumo", "pit", { name: "Pit" });
    writeMap("blockparty-hunter", "field", { name: "Field", regions: { structure: [{ min: [0, 0, 0], max: [3, 0, 3] }] } });
    store.publish("sumo", "pit");
    store.publish("blockparty-hunter", "field");
    store.exportPublished();
    expect(existsSync(published("worlds", "sumo", "pit", "1", STRUCTURE_FILE))).toBe(false);
    const file = published("worlds", "blockparty-hunter", "field", "1", STRUCTURE_FILE);
    rmSync(file);
    store.exportPublished();
    expect(existsSync(file)).toBe(true);
  });
});

describe("a preview's copy of the arena maps", () => {
  it("has each published one's map.json and structure, and an index of them", async () => {
    writeMap("blockparty-hotfloor", "test", { name: "Test", regions: { structure: [{ min: [0, 0, 0], max: [3, 2, 3] }] } });
    writeMap("blockparty-painters", "nostructure", { name: "No box" });
    writeMap("sumo", "pit", { name: "Pit" });
    for (const [target, map] of [["blockparty-hotfloor", "test"], ["blockparty-painters", "nostructure"], ["sumo", "pit"]]) store.publish(target, map);
    store.exportPublished();
    const out = join(dir, "arena-maps");
    expect(await copyArenaMaps(published("worlds"), out, ["blockparty-hotfloor", "blockparty-painters", "blockparty-hunter"])).toBe(1);
    expect(JSON.parse(readFileSync(join(out, "index.json"), "utf8"))).toEqual({ "blockparty-hotfloor": { test: 1 } });
    expect(JSON.parse(readFileSync(join(out, "blockparty-hotfloor", "test", "1", "map.json"), "utf8"))).toMatchObject({ name: "Test" });
    expect(existsSync(join(out, "blockparty-hotfloor", "test", "1", STRUCTURE_FILE))).toBe(true);
    expect(existsSync(join(out, "blockparty-hotfloor", "test", "1", "world"))).toBe(false);
  });
});
