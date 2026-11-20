// A map's colors as a resource pack (colors-pack.ts): what it holds, its ids, and where it's written.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nbt from "prismarine-nbt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BIOME_COLORS, PLAINS, PLAINS_CLIENT_BIOME } from "@minecade/minigame-core/config";
import { encodeLevelDat } from "../../build/leveldat.ts";
import { COLORS_BIOME_FILE, COLORS_PACK, colorsPackFiles, writeColorsPack } from "../colors-pack.ts";
import { MapStore } from "../store.ts";

const swamp = BIOME_COLORS.find((biome) => biome.id === "swampland")!;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minecade-colors-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("a map's colors pack", () => {
  it("is nothing for a map without colors, or with plains' own", () => {
    expect(colorsPackFiles(undefined)).toBeUndefined();
    expect(colorsPackFiles({ water: PLAINS.water, grass: PLAINS.grass.toLowerCase() })).toBeUndefined();
  });

  it("gives plains its colors, keeping the rest of plains' client biome", () => {
    const files = colorsPackFiles({ water: swamp.water, foliage: swamp.foliage })!;
    expect(Object.keys(files).sort()).toEqual([COLORS_BIOME_FILE, "manifest.json"]);
    const biome = JSON.parse(files[COLORS_BIOME_FILE]);
    expect(biome.format_version).toBe(PLAINS_CLIENT_BIOME.formatVersion);
    expect(biome["minecraft:client_biome"].description.identifier).toBe("minecraft:plains");
    const components = biome["minecraft:client_biome"].components;
    expect(components["minecraft:water_appearance"]).toEqual({ surface_color: swamp.water });
    expect(components["minecraft:foliage_appearance"]).toEqual({ color: swamp.foliage });
    // Grass left as plains' own: the client's color map.
    expect(components["minecraft:grass_appearance"]).toBeUndefined();
    for (const key of Object.keys(PLAINS_CLIENT_BIOME.components)) expect(components[key]).toEqual((PLAINS_CLIENT_BIOME.components as Record<string, unknown>)[key]);
  });

  it("has ids made from its colors: the same colors, the same pack", () => {
    const manifest = (colors: object) => JSON.parse(colorsPackFiles(colors)!["manifest.json"]);
    const a = manifest({ water: "#617b64" });
    expect(a).toMatchObject({ format_version: 2, header: { name: "Minecade map colors", version: [1, 0, 0] }, modules: [{ type: "resources" }] });
    expect(a.header.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.header.uuid).not.toBe(a.modules[0].uuid);
    expect(manifest({ water: "#617B64" }).header.uuid).toBe(a.header.uuid);
    expect(manifest({ water: "#617B65" }).header.uuid).not.toBe(a.header.uuid);
  });

  it("is written beside a map's world, replaced when the colors change, and removed without them", () => {
    writeColorsPack(dir, { water: "#617B64" });
    const pack = join(dir, COLORS_PACK);
    expect(readdirSync(pack).sort()).toEqual(["biomes", "manifest.json"]);
    const uuid = JSON.parse(readFileSync(join(pack, "manifest.json"), "utf8")).header.uuid;
    writeFileSync(join(pack, "stray.txt"), "x");
    writeColorsPack(dir, { water: "#000000" });
    expect(JSON.parse(readFileSync(join(pack, "manifest.json"), "utf8")).header.uuid).not.toBe(uuid);
    expect(existsSync(join(pack, "stray.txt"))).toBe(false);
    writeColorsPack(dir, undefined);
    expect(existsSync(pack)).toBe(false);
  });

  it("goes with a published version that has colors", () => {
    const store = MapStore.open(join(dir, "store"), { now: () => Date.UTC(2026, 10, 20) });
    try {
      const folder = store.folder("sumo", "pit");
      mkdirSync(join(folder, "world", "db"), { recursive: true });
      writeFileSync(join(folder, "world", "level.dat"), encodeLevelDat({ storageVersion: 10, root: { ...nbt.comp({ LevelName: nbt.string("Test") }), name: "" } as nbt.NBT }));
      writeFileSync(join(folder, "world", "db", "000001.log"), "log 1");
      writeFileSync(join(folder, "map.json"), JSON.stringify({ name: "Pit", spawns: [[0, 64, 0]], colors: { water: swamp.water } }));
      store.publish("sumo", "pit");
      store.exportPublished();
      const version = join(store.dir, "published", "worlds", "sumo", "pit", "1");
      expect(JSON.parse(readFileSync(join(version, COLORS_PACK, COLORS_BIOME_FILE), "utf8"))["minecraft:client_biome"].components["minecraft:water_appearance"]).toEqual({ surface_color: swamp.water });
      // A version written before colors packs gets its pack at the next export.
      rmSync(join(version, COLORS_PACK), { recursive: true });
      store.exportPublished();
      expect(existsSync(join(version, COLORS_PACK, "manifest.json"))).toBe(true);
    } finally {
      store.close();
    }
  });
});
