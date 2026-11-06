import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildColorTable, buildLooks, colorTable, LAYER_BYTES, textureLayer, textureLayers, type Rgba } from "../looks.ts";

type Color = [number, number, number, number];

/** An 8-bit RGBA PNG, 16x16 unless said. */
function png(at: (x: number, y: number) => Color, width = 16, height = 16): Buffer {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(at(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** A .brarchive of these files, as the client packs them. */
function archive(files: Record<string, Buffer>): Buffer {
  const names = Object.keys(files);
  const head = Buffer.alloc(16);
  head.write("fixture!", 0, "latin1");
  head.writeUInt32LE(names.length, 8);
  head.writeUInt32LE(1, 12);
  const entries = Buffer.alloc(256 * names.length);
  let offset = 0;
  names.forEach((name, i) => {
    entries[i * 256] = name.length;
    entries.write(name, i * 256 + 1, "latin1");
    entries.writeUInt32LE(offset, i * 256 + 248);
    entries.writeUInt32LE(files[name].length, i * 256 + 252);
    offset += files[name].length;
  });
  return Buffer.concat([head, entries, ...names.map((name) => files[name])]);
}

const solid = (color: Color) => png(() => color);
const STONE: Color = [120, 120, 120, 255];
const DIRT: Color = [121, 85, 58, 255];
const GRASS_TINT: Color = [100, 200, 50, 255];

let root: string;
let packs: string;
let blocksPack: string;
function write(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "minecade-looks-"));
  packs = join(root, "client", "resource_packs");
  blocksPack = join(root, "packs", "blocks");
  const vanilla = join(packs, "vanilla");
  write(
    join(vanilla, "blocks.json"),
    `{
  "format_version": [1, 1, 0],
  "stone": { "textures": "stone" }, // a comment after code
  "grass": { "textures": { "up": "grass_top", "down": "dirt", "side": "grass_side" } },
  "iron_ore": { "textures": "iron_ore" },
  "glowstone": { "textures": "glowstone" },
  "oak_log": { "textures": { "up": "log_top", "down": "log_top", "side": "log_side" } }
}`,
  );
  write(
    join(vanilla, "textures", "terrain_texture.json"),
    JSON.stringify({
      texture_data: {
        stone: { textures: "textures/blocks/stone" },
        grass_top: { textures: ["textures/blocks/grass_top", "textures/blocks/unused"] },
        grass_side: { textures: [{ path: "textures/blocks/grass_side", overlay_color: "#79c05a" }] },
        dirt: { textures: "textures/blocks/dirt" },
        iron_ore: { textures: "textures/blocks/iron_ore" },
        glowstone: { textures: "textures/blocks/glowstone" },
        log_top: { textures: "textures/blocks/log_top" },
        log_side: { textures: "textures/blocks/log_side" },
      },
    }),
  );
  write(
    join(vanilla, "__brarchive", "textures", "blocks.brarchive"),
    archive({
      "stone.png": solid(STONE),
      // Gray: the client tints it.
      "grass_top.png": solid([200, 200, 200, 255]),
      // Dirt, with the top rows marked (alpha) for the tint.
      "grass_side.png": png((x, y) => (y < 3 ? [150, 150, 150, 255] : [...DIRT.slice(0, 3), 0] as Color)),
      "dirt.png": solid(DIRT),
      // Mostly stone, with a few tan specks.
      "iron_ore.png": png((x, y) => (x % 4 === 0 && y % 4 === 0 ? [216, 175, 147, 255] : STONE)),
      // Mostly dark gaps, with bright bits: its most common color would be the gaps.
      "glowstone.png": png((x, y) => ((x + y) % 3 === 0 ? [60, 40, 20, 255] : x % 2 ? [250, 210, 120, 255] : [240, 190, 100, 255])),
      "log_top.png": solid([180, 150, 90, 255]),
      // An animated strip: two frames, only the first counts.
      "log_side.png": png((x, y) => (y < 16 ? [110, 85, 50, 255] : [0, 0, 255, 255]), 16, 32),
    }),
  );
  write(join(vanilla, "__brarchive", "textures", "colormap.brarchive"), archive({ "grass.png": solid(GRASS_TINT), "foliage.png": solid([50, 150, 50, 255]) }));
  // Packs layer by version: 1.9.0 before 1.20.0, so 1.20.0's deepslate wins; 1.20.0 adds only a sound to stone.
  write(join(packs, "vanilla_1.9.0", "blocks.json"), JSON.stringify({ deepslate: { textures: "stone" } }));
  write(join(packs, "vanilla_1.20.0", "blocks.json"), JSON.stringify({ stone: { sound: "stone" }, deepslate: { textures: "deepslate" } }));
  write(join(packs, "vanilla_1.20.0", "textures", "terrain_texture.json"), JSON.stringify({ texture_data: { deepslate: { textures: "textures/blocks/deepslate/deepslate" } } }));
  write(join(packs, "vanilla_1.20.0", "__brarchive", "textures", "blocks", "deepslate.brarchive"), archive({ "deepslate.png": solid([70, 70, 75, 255]) }));
  // A custom block: its top is an instance that names another.
  write(
    join(blocksPack, "behavior_pack", "blocks", "chair.json"),
    JSON.stringify({ "minecraft:block": { description: { identifier: "minecade:chair" }, components: { "minecraft:material_instances": { "*": { texture: "chair" }, up: "seat", seat: { texture: "chair_seat" } } } } }),
  );
  write(join(blocksPack, "resource_pack", "textures", "terrain_texture.json"), JSON.stringify({ texture_data: { chair: { textures: "textures/minecade/chair" }, chair_seat: { textures: "textures/minecade/chair_seat" } } }));
  write(join(blocksPack, "resource_pack", "textures", "minecade", "chair.png"), solid([150, 100, 60, 255]));
  write(join(blocksPack, "resource_pack", "textures", "minecade", "chair_seat.png"), solid([200, 30, 30, 255]));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const rgb = (color: Rgba | undefined) => color?.slice(0, 3);

describe("buildColorTable", () => {
  it("takes each face's most common color from the layered packs", () => {
    const { blocks, note } = buildColorTable(packs, blocksPack);
    expect(note).toBeUndefined();
    // stone keeps its textures though a later pack gives it only a sound.
    expect(blocks["minecraft:stone"]).toEqual([STONE, STONE, STONE]);
    expect(rgb(blocks["minecraft:deepslate"]?.[0])).toEqual([70, 70, 75]);
    expect(rgb(blocks["minecraft:oak_log"]?.[0])).toEqual([180, 150, 90]);
    expect(rgb(blocks["minecraft:oak_log"]?.[2])).toEqual([110, 85, 50]);
  });

  it("tints grass from the colormap, and reads an overlay texture's side as the dirt it shows", () => {
    const grass = buildColorTable(packs, blocksPack).blocks["minecraft:grass_block"];
    expect(rgb(grass?.[0])).toEqual([Math.round((200 * 100) / 255), Math.round((200 * 200) / 255), Math.round((200 * 50) / 255)]);
    expect(grass?.[1]).toEqual(DIRT);
    expect(grass?.[2]).toEqual(DIRT);
  });

  it("mixes an ore's stone with its specks, and takes glowstone's whole average", () => {
    const { blocks } = buildColorTable(packs, blocksPack);
    expect(rgb(blocks["minecraft:iron_ore"]?.[0])).toEqual([168, 148, 134]);
    const glow = blocks["minecraft:glowstone"]![0];
    expect(glow[0]).toBeGreaterThan(150);
  });

  it("reads custom blocks' material instances, an instance naming another", () => {
    const chair = buildColorTable(packs, blocksPack).blocks["minecade:chair"];
    expect(rgb(chair?.[0])).toEqual([200, 30, 30]);
    expect(rgb(chair?.[2])).toEqual([150, 100, 60]);
  });

  it("says why there are no vanilla colors when the client isn't there", () => {
    const table = buildColorTable(join(root, "nowhere"), blocksPack);
    expect(table.note).toMatch(/isn't installed/);
    expect(Object.keys(table.blocks)).toEqual(["minecade:chair"]);
  });
});

describe("texture layers", () => {
  /** A layer's pixel at (x, y): RGBA. */
  const pixel = (layers: Uint8Array, layer: number, x: number, y: number) => Array.from(layers.subarray(layer * LAYER_BYTES + (y * 16 + x) * 4, layer * LAYER_BYTES + (y * 16 + x) * 4 + 4));

  it("gives every block's faces a layer, layer 0 pink for none, tinted as the colors are", () => {
    const { table, layers } = buildLooks(packs, blocksPack);
    expect(layers.length).toBe(table.layers! * LAYER_BYTES);
    expect(pixel(layers, 0, 0, 0)).toEqual([255, 0, 255, 255]);
    const [up, down, side] = table.textures!["minecraft:grass_block"];
    expect(pixel(layers, up, 5, 5)).toEqual([Math.round((200 * 100) / 255), Math.round((200 * 200) / 255), Math.round((200 * 50) / 255), 255]);
    expect(pixel(layers, down, 5, 5)).toEqual(DIRT);
    // The side: its marked top rows tinted, the dirt below made opaque.
    expect(pixel(layers, side, 0, 0)).toEqual([Math.round((150 * 100) / 255), Math.round((150 * 200) / 255), Math.round((150 * 50) / 255), 255]);
    expect(pixel(layers, side, 0, 10)).toEqual(DIRT);
    // Faces with one texture share its layer; an animated strip is its first frame.
    expect(table.textures!["minecraft:stone"]).toEqual([1, 1, 1].map(() => table.textures!["minecraft:stone"][0]));
    expect(pixel(layers, table.textures!["minecraft:oak_log"][2], 3, 15)).toEqual([110, 85, 50, 255]);
    expect(table.textures!["minecade:chair"]).toHaveLength(3);
  });

  it("scales a texture to 16 pixels and makes water see-through", () => {
    const big = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4).map((_, i) => (i % 4 === 3 ? 255 : Math.floor(i / 4) % 32 < 16 ? 10 : 200)) };
    const layer = textureLayer(big, undefined);
    expect([layer[0], layer[15 * 4]]).toEqual([10, 200]);
    const water = textureLayer({ width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(240) }, [68, 175, 245], false, true);
    expect(Array.from(water.subarray(0, 4))).toEqual([Math.round((240 * 68) / 255), Math.round((240 * 175) / 255), Math.round((240 * 245) / 255), 150]);
  });

  it("keeps the layers beside the colors in work\viewer\looks", () => {
    const table = colorTable(root, packs);
    expect(textureLayers(root, packs).length).toBe(table.layers! * LAYER_BYTES);
  });
});

describe("colorTable", () => {
  it("keeps the table in work\\viewer\\looks until a pack file changes", () => {
    const first = colorTable(root, packs);
    const cache = join(root, "work", "viewer", "looks", "colors.json");
    const written = statSync(cache).mtimeMs;
    expect(colorTable(root, packs).stamp).toBe(first.stamp);
    expect(statSync(cache).mtimeMs).toBe(written);
    utimesSync(join(packs, "vanilla", "blocks.json"), new Date(2030, 0, 1), new Date(2030, 0, 1));
    const changed = colorTable(root, packs);
    expect(changed.stamp).not.toBe(first.stamp);
    expect((JSON.parse(readFileSync(cache, "utf8")) as { stamp: string }).stamp).toBe(changed.stamp);
  });

  it("applies the overrides file, and says when it isn't JSON", () => {
    write(join(root, "work", "viewer", "looks", "overrides.json"), JSON.stringify({ stone: "#102030", "minecade:chair": "#ffffff80", "minecraft:dirt": "not a color" }));
    const { blocks } = colorTable(root, packs);
    expect(blocks["minecraft:stone"]).toEqual([[16, 32, 48, 255], [16, 32, 48, 255], [16, 32, 48, 255]]);
    expect(blocks["minecade:chair"]?.[0]).toEqual([255, 255, 255, 128]);
    write(join(root, "work", "viewer", "looks", "overrides.json"), "{ nope");
    expect(colorTable(root, packs).note).toMatch(/isn't valid JSON/);
  });
});
