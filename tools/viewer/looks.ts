// The map viewer's looks: each block face's Average color, and for Vanilla textures each face's
// texture as a layer of a texture array, worked out on this PC from the installed Minecraft client
// and the shared blocks pack (packs\blocks), and kept in work\viewer\looks\ (colors.json and
// textures.bin), which git ignores, like everything made from those textures.
//
// Vanilla blocks: the client layers its vanilla resource packs (vanilla, then vanilla_1.14 up to
// the newest), each adding to blocks.json (which texture each face uses) field by field and to
// terrain_texture.json (each texture's file), and packing its block textures in
// __brarchive\textures\blocks.brarchive, a folder in it as blocks\<folder>.brarchive. Custom
// blocks: minecraft:material_instances in the behavior pack, then the resource pack's
// terrain_texture.json. (docs/spike-results.md, "Map viewer".)
//
// A face's color is its texture's most common color: pixels at least half opaque, bucketed by the
// top 4 bits of red, green and blue, the fullest bucket's average (the brighter on a tie); alpha is
// how opaque the texture is in all. Ores mix that (their stone) half and half with their specks'
// most common color; a few blocks take the whole texture's average instead. Grass, leaves and water
// are tinted as in plains. work\viewer\looks\overrides.json sets any block's color by hand, for
// every face: { "minecraft:sea_lantern": "#b4d0c8", "minecraft:tinted_glass": "#2c2a2e80" }.
//
// A texture layer is the texture's first frame at 16x16 (nearest pixels), rows from the top,
// tinted as its color is: an overlay texture (a grass block's side) is tinted where its alpha is
// set and made opaque, and water is made as see-through as the viewer draws it. Layer 0 is the
// loud pink of a block with no texture.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readArchive, decodeTga, VANILLA_PACK } from "../build/vanilla-textures.ts";
import type { Image } from "../skins/png.ts";
import { decodeAnyPng } from "./png.ts";

export type Rgba = [number, number, number, number];
/** A block's colors: its top, its bottom and its sides. */
export type FaceColors = [up: Rgba, down: Rgba, side: Rgba];

export interface ColorTable {
  /** What the table was made from (and the method's version). */
  stamp: string;
  /** By full name (minecraft:stone, minecade:oak_chair). */
  blocks: Record<string, FaceColors>;
  /** Each block's texture layers (textures.bin): its top, its bottom and its sides. */
  textures?: Record<string, [up: number, down: number, side: number]>;
  /** How many texture layers there are. */
  layers?: number;
  /** Why some blocks have no colors, when that's so (the client isn't installed). */
  note?: string;
}

/** A texture layer's side, in pixels: every layer is this size. */
export const LAYER_SIZE = 16;
/** Bytes in a texture layer (RGBA). */
export const LAYER_BYTES = LAYER_SIZE * LAYER_SIZE * 4;
/** How see-through water's texture is made (0 to 255), as the viewer draws water. */
const WATER_ALPHA = 150;
/** Changed whenever the method changes, so tables made before are made again. */
const METHOD = 2;
/** Blocks whose blocks.json entry still has an older name. */
const RENAMED: Record<string, string> = { grass_block: "grass", sea_lantern: "seaLantern", iron_chain: "chain" };
/** Blocks whose most common color is wrong (glowstone's is the dark gaps): the whole texture's average instead. */
const WHOLE_AVERAGE = new Set(["minecraft:glowstone"]);
/** How far (in RGB) a color is from an ore's stone to count as its specks. */
const SPECK_DISTANCE = 60;
/** How far apart a color's channels are to count as colored (not gray). */
const SPECK_SATURATION = 40;

type Face = "up" | "down" | "side";
type TextureEntry = string | { path: string; overlay_color?: string } | (string | { path: string; overlay_color?: string })[];
/** A texture's file, and whether its alpha is a tint mask (terrain_texture.json gives it an overlay_color). */
type TextureFile = { path: string; overlay?: boolean };
type BlockEntry = { textures?: string | Partial<Record<"up" | "down" | "side" | "north" | "south" | "east" | "west", string>> };

/** The client's resource packs folder (the parent of its vanilla pack). */
export const CLIENT_PACKS = dirname(VANILLA_PACK);

/**
 * The color table, from work\viewer\looks\colors.json when nothing it was made from changed, with
 * the overrides applied; its texture layers are work\viewer\looks\textures.bin (textureLayers).
 */
export function colorTable(root: string, clientPacks = CLIENT_PACKS): ColorTable {
  const dir = join(root, "work", "viewer", "looks");
  const blocksPack = join(root, "packs", "blocks");
  const stamp = looksStamp(clientPacks, blocksPack);
  const cache = join(dir, "colors.json");
  let table: ColorTable | undefined;
  if (existsSync(cache) && existsSync(join(dir, "textures.bin"))) {
    const cached = JSON.parse(readFileSync(cache, "utf8")) as ColorTable;
    if (cached.stamp === stamp) table = cached;
  }
  if (!table) {
    const built = buildLooks(clientPacks, blocksPack, stamp);
    table = built.table;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "textures.bin"), built.layers);
    writeFileSync(cache, JSON.stringify(table));
  }
  return withOverrides(table, join(dir, "overrides.json"));
}

/** The texture layers (LAYER_BYTES each, in order), made with the color table when it's made. */
export function textureLayers(root: string, clientPacks = CLIENT_PACKS): Uint8Array {
  colorTable(root, clientPacks);
  return new Uint8Array(readFileSync(join(root, "work", "viewer", "looks", "textures.bin")));
}

/** A hash of every file the table is made from: the vanilla packs' block files and the blocks pack's. */
export function looksStamp(clientPacks: string, blocksPack: string): string {
  const hash = createHash("sha256").update(`method ${METHOD}\n`);
  const file = (path: string) => {
    if (!existsSync(path)) return;
    const info = statSync(path);
    hash.update(`${path} ${info.size} ${Math.floor(info.mtimeMs)}\n`);
  };
  for (const pack of vanillaPacks(clientPacks)) {
    const dir = join(clientPacks, pack);
    file(join(dir, "blocks.json"));
    file(join(dir, "textures", "terrain_texture.json"));
    file(join(dir, "__brarchive", "textures", "blocks.brarchive"));
    const folders = join(dir, "__brarchive", "textures", "blocks");
    if (existsSync(folders)) for (const name of readdirSync(folders).sort()) file(join(folders, name));
  }
  file(join(blocksPack, "behavior_pack", "manifest.json"));
  file(join(blocksPack, "resource_pack", "manifest.json"));
  file(join(blocksPack, "resource_pack", "textures", "terrain_texture.json"));
  const definitions = join(blocksPack, "behavior_pack", "blocks");
  if (existsSync(definitions)) hash.update(`${readdirSync(definitions).length} blocks\n`);
  return hash.digest("hex").slice(0, 16);
}

/** The client's vanilla packs, oldest first: vanilla, then vanilla_<version> by version. */
function vanillaPacks(clientPacks: string): string[] {
  if (!existsSync(clientPacks)) return [];
  const version = (name: string) => (name === "vanilla" ? [0] : name.slice("vanilla_".length).split(".").map(Number));
  return readdirSync(clientPacks)
    .filter((name) => name === "vanilla" || /^vanilla_[\d.]+$/.test(name))
    .sort((a, b) => {
      const [x, y] = [version(a), version(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    });
}

export function buildColorTable(clientPacks: string, blocksPack: string, stamp = looksStamp(clientPacks, blocksPack)): ColorTable {
  return buildLooks(clientPacks, blocksPack, stamp).table;
}

/** The color table and its texture layers. */
export function buildLooks(clientPacks: string, blocksPack: string, stamp = looksStamp(clientPacks, blocksPack)): { table: ColorTable; layers: Uint8Array } {
  const table: ColorTable = { stamp, blocks: {}, textures: {} };
  const tints = loadTints(clientPacks);
  const colors = new Map<string, Rgba>();
  // Layer 0: no texture.
  const layers: Uint8Array[] = [new Uint8Array(LAYER_BYTES).map((_, i) => [255, 0, 255, 255][i % 4])];
  const layerIds = new Map<string, number>();
  const pictures = new Map<string, Image | undefined>();
  const pictureOf = (path: string, read: (path: string) => Uint8Array | undefined): Image | undefined => {
    if (pictures.has(path)) return pictures.get(path);
    const data = read(path);
    let picture: Image | undefined;
    try {
      picture = data ? firstFrame(data[0] === 0x89 ? decodeAnyPng(data) : decodeTga(data)) : undefined;
    } catch {
      // A texture that doesn't decode leaves the block without a color or a texture, like a missing one.
    }
    pictures.set(path, picture);
    return picture;
  };
  const colorOf = (texture: TextureFile | undefined, read: (path: string) => Uint8Array | undefined, name: string): Rgba | undefined => {
    if (!texture) return undefined;
    const { path, overlay } = texture;
    const key = `${name}|${path}`;
    if (colors.has(key)) return colors.get(key);
    let picture = pictureOf(path, read);
    let color: Rgba | undefined;
    // An overlay texture's alpha says where the biome's tint goes (a grass block's side), not
    // what's see-through: without the tint it's the dirt it shows.
    if (picture && overlay) picture = { ...picture, data: picture.data.map((value, i) => (i % 4 === 3 ? 255 : value)) };
    if (picture) color = tinted(WHOLE_AVERAGE.has(name) ? wholeAverage(picture) : /_ore$/.test(name) ? oreColor(picture) : commonColor(picture), overlay ? undefined : tintOf(path, tints));
    colors.set(key, color!);
    return color;
  };
  const layerOf = (texture: TextureFile | undefined, read: (path: string) => Uint8Array | undefined): number => {
    if (!texture) return 0;
    const key = `${texture.path}|${texture.overlay ? 1 : 0}`;
    const known = layerIds.get(key);
    if (known !== undefined) return known;
    const picture = pictureOf(texture.path, read);
    const id = picture ? layers.length : 0;
    if (picture) layers.push(textureLayer(picture, texture.overlay ? (tints.grass ?? [124, 189, 107]) : tintOf(texture.path, tints), texture.overlay === true, /^water_/.test(texture.path.split("/").pop()!)));
    layerIds.set(key, id);
    return id;
  };

  const packs = vanillaPacks(clientPacks);
  if (packs.length === 0) table.note = `Minecraft isn't installed on this PC (no ${clientPacks}): vanilla blocks have no colors`;
  const blocks: Record<string, BlockEntry> = {};
  const textures: Record<string, { textures: TextureEntry }> = {};
  const files = new Map<string, Uint8Array>();
  for (const pack of packs) {
    const dir = join(clientPacks, pack);
    if (existsSync(join(dir, "blocks.json"))) {
      for (const [name, entry] of Object.entries(readPackJson(join(dir, "blocks.json")) as Record<string, BlockEntry>)) {
        if (name !== "format_version") blocks[name] = { ...blocks[name], ...entry };
      }
    }
    const terrain = join(dir, "textures", "terrain_texture.json");
    if (existsSync(terrain)) Object.assign(textures, (readPackJson(terrain) as { texture_data: typeof textures }).texture_data);
    const archive = join(dir, "__brarchive", "textures", "blocks.brarchive");
    if (existsSync(archive)) for (const [name, data] of readArchive(new Uint8Array(readFileSync(archive)))) files.set(`textures/blocks/${name}`, data);
    const folders = join(dir, "__brarchive", "textures", "blocks");
    if (existsSync(folders)) {
      for (const name of readdirSync(folders).filter((file) => file.endsWith(".brarchive"))) {
        for (const [file, data] of readArchive(new Uint8Array(readFileSync(join(folders, name))))) files.set(`textures/blocks/${name.slice(0, -".brarchive".length)}/${file}`, data);
      }
    }
  }
  for (const [name, old] of Object.entries(RENAMED)) if (!blocks[name] && blocks[old]) blocks[name] = blocks[old];
  const pathOf = (entries: Record<string, { textures: TextureEntry }>, texture: string | undefined): TextureFile | undefined => {
    const entry = texture ? entries[texture]?.textures : undefined;
    const first = Array.isArray(entry) ? entry[0] : entry;
    if (typeof first === "string") return { path: first };
    return first ? { path: first.path, ...(first.overlay_color ? { overlay: true } : {}) } : undefined;
  };
  const vanillaFile = (path: string) => files.get(`${path}.png`) ?? files.get(`${path}.tga`);
  for (const [short, entry] of Object.entries(blocks)) {
    const faces = faceTextures(entry.textures);
    if (!faces) continue;
    const name = `minecraft:${short}`;
    const [up, down, side] = (["up", "down", "side"] as Face[]).map((face) => colorOf(pathOf(textures, faces[face]), vanillaFile, name));
    if (up && down && side) {
      table.blocks[name] = [up, down, side];
      table.textures![name] = (["up", "down", "side"] as Face[]).map((face) => layerOf(pathOf(textures, faces[face]), vanillaFile)) as [number, number, number];
    }
  }

  // The blocks pack: each block's material instance for its top, bottom and north side (* when one covers all).
  const definitions = join(blocksPack, "behavior_pack", "blocks");
  const customTerrain = join(blocksPack, "resource_pack", "textures", "terrain_texture.json");
  if (existsSync(definitions) && existsSync(customTerrain)) {
    const terrain = (readPackJson(customTerrain) as { texture_data: Record<string, { textures: TextureEntry }> }).texture_data;
    const customFile = (path: string) => {
      const found = [".png", ".tga"].map((ext) => join(blocksPack, "resource_pack", `${path}${ext}`)).find(existsSync);
      return found ? new Uint8Array(readFileSync(found)) : undefined;
    };
    for (const file of readdirSync(definitions).filter((name) => name.endsWith(".json"))) {
      const block = (readPackJson(join(definitions, file)) as { "minecraft:block"?: { description?: { identifier?: string }; components?: Record<string, unknown> } })["minecraft:block"];
      const name = block?.description?.identifier;
      if (!name) continue;
      const instances = (block.components?.["minecraft:material_instances"] ?? {}) as Record<string, { texture?: string } | string>;
      const textureOf = (face: string) => {
        let instance = instances[face] ?? instances["*"];
        // An instance can name another one.
        for (let i = 0; i < 4 && typeof instance === "string"; i++) instance = instances[instance];
        return pathOf(terrain, typeof instance === "object" ? instance.texture : undefined);
      };
      const [up, down, side] = ["up", "down", "north"].map((face) => colorOf(textureOf(face), customFile, name));
      if (up && down && side) {
        table.blocks[name] = [up, down, side];
        table.textures![name] = ["up", "down", "north"].map((face) => layerOf(textureOf(face), customFile)) as [number, number, number];
      }
    }
  }
  table.layers = layers.length;
  const out = new Uint8Array(layers.length * LAYER_BYTES);
  layers.forEach((layer, i) => out.set(layer, i * LAYER_BYTES));
  return { table, layers: out };
}

/**
 * A texture as a layer: LAYER_SIZE square (nearest pixels), tinted. An overlay texture is tinted
 * where its alpha is set and opaque everywhere; water is made WATER_ALPHA see-through.
 */
export function textureLayer(picture: Image, tint: Rgb | undefined, overlay = false, water = false): Uint8Array {
  const out = new Uint8Array(LAYER_BYTES);
  for (let y = 0; y < LAYER_SIZE; y++) {
    for (let x = 0; x < LAYER_SIZE; x++) {
      const from = (Math.floor((y * picture.height) / LAYER_SIZE) * picture.width + Math.floor((x * picture.width) / LAYER_SIZE)) * 4;
      const to = (y * LAYER_SIZE + x) * 4;
      const [r, g, b, a] = picture.data.subarray(from, from + 4);
      const tinting = tint && (!overlay || a > 0);
      out[to] = tinting ? Math.round((r * tint[0]) / 255) : r;
      out[to + 1] = tinting ? Math.round((g * tint[1]) / 255) : g;
      out[to + 2] = tinting ? Math.round((b * tint[2]) / 255) : b;
      out[to + 3] = overlay ? 255 : water ? Math.min(a, WATER_ALPHA) : a;
    }
  }
  return out;
}

/** The table with work\viewer\looks\overrides.json applied: "#rrggbb" (or "#rrggbbaa") for every face of a block. */
function withOverrides(table: ColorTable, file: string): ColorTable {
  if (!existsSync(file)) return table;
  let overrides: Record<string, unknown>;
  try {
    overrides = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return { ...table, note: [table.note, `${file} isn't valid JSON, so it was left out`].filter(Boolean).join("; ") };
  }
  const blocks = { ...table.blocks };
  for (const [name, value] of Object.entries(overrides)) {
    const hex = typeof value === "string" ? /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value) : null;
    if (!hex) continue;
    const rgb = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
    const color: Rgba = [rgb[0], rgb[1], rgb[2], hex[2] ? parseInt(hex[2], 16) : 255];
    blocks[name.includes(":") ? name : `minecraft:${name}`] = [color, color, color];
  }
  return { ...table, blocks };
}

/** Text without the byte order mark (U+FEFF) some pack files start with. */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Pack JSON as the game reads it: with // and block comments. */
export function readPackJson(path: string): unknown {
  return JSON.parse(withoutBom(readFileSync(path, "utf8")).replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, text: string | undefined) => text ?? ""));
}

function faceTextures(textures: BlockEntry["textures"]): Record<Face, string> | undefined {
  if (!textures) return undefined;
  if (typeof textures === "string") return { up: textures, down: textures, side: textures };
  const side = textures.side ?? textures.north ?? textures.south ?? textures.east ?? textures.west;
  if (!textures.up || !textures.down || !side) return undefined;
  return { up: textures.up, down: textures.down, side };
}

/** An animated texture's first frame: the top square of its strip. */
function firstFrame(picture: Image | undefined): Image | undefined {
  if (!picture || picture.height <= picture.width) return picture;
  return { width: picture.width, height: picture.width, data: picture.data.subarray(0, picture.width * picture.width * 4) };
}

/** Buckets of pixels at least half opaque, by the top 4 bits of red, green and blue: [count, red, green, blue] summed. */
function buckets(picture: Image): Map<number, [number, number, number, number]> {
  const out = new Map<number, [number, number, number, number]>();
  for (let p = 0; p < picture.width * picture.height; p++) {
    const [r, g, b, a] = picture.data.subarray(p * 4, p * 4 + 4);
    if (a < 128) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = out.get(key) ?? [0, 0, 0, 0];
    bucket[0]++;
    bucket[1] += r;
    bucket[2] += g;
    bucket[3] += b;
    out.set(key, bucket);
  }
  return out;
}

/** How opaque a texture is in all, 0 to 255 (glass keeps its see-through). */
function opacity(picture: Image): number {
  let alpha = 0;
  for (let p = 0; p < picture.width * picture.height; p++) alpha += picture.data[p * 4 + 3];
  return Math.round(alpha / (picture.width * picture.height));
}

/** The fullest bucket (the brighter on a tie), among those `keep` allows. */
function fullest(all: Map<number, [number, number, number, number]>, keep: (color: [number, number, number]) => boolean = () => true): [number, number, number] | undefined {
  let best: [number, number, number, number] | undefined;
  for (const bucket of all.values()) {
    const color: [number, number, number] = [bucket[1] / bucket[0], bucket[2] / bucket[0], bucket[3] / bucket[0]];
    if (!keep(color)) continue;
    if (!best || bucket[0] > best[0] || (bucket[0] === best[0] && bucket[1] + bucket[2] + bucket[3] > best[1] + best[2] + best[3])) best = bucket;
  }
  return best ? [Math.round(best[1] / best[0]), Math.round(best[2] / best[0]), Math.round(best[3] / best[0])] : undefined;
}

export function commonColor(picture: Image): Rgba {
  const color = fullest(buckets(picture));
  return color ? [...color, opacity(picture)] : [0, 0, 0, 0];
}

/**
 * An ore: its stone (the most common color) half and half with its specks: the most common color
 * well away from the stone, a colored one if there's any (gold's yellow, not its pale shine).
 */
export function oreColor(picture: Image): Rgba {
  const all = buckets(picture);
  const stone = fullest(all);
  if (!stone) return [0, 0, 0, 0];
  const far = (color: [number, number, number]) => Math.hypot(color[0] - stone[0], color[1] - stone[1], color[2] - stone[2]) > SPECK_DISTANCE;
  const colored = (color: [number, number, number]) => Math.max(...color) - Math.min(...color) > SPECK_SATURATION;
  const specks = fullest(all, (color) => far(color) && colored(color)) ?? fullest(all, far) ?? stone;
  return [Math.round((stone[0] + specks[0]) / 2), Math.round((stone[1] + specks[1]) / 2), Math.round((stone[2] + specks[2]) / 2), opacity(picture)];
}

/** The whole texture's average (pixels at least half opaque). */
export function wholeAverage(picture: Image): Rgba {
  let [n, r, g, b] = [0, 0, 0, 0];
  for (let p = 0; p < picture.width * picture.height; p++) {
    if (picture.data[p * 4 + 3] < 128) continue;
    n++;
    r += picture.data[p * 4];
    g += picture.data[p * 4 + 1];
    b += picture.data[p * 4 + 2];
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n), opacity(picture)] : [0, 0, 0, 0];
}

type Rgb = [number, number, number];
/** Water's color in plains, which the client sets in code. */
const WATER: Rgb = [0x44, 0xaf, 0xf5];

/**
 * The tints the client gives gray textures by biome, fixed to plains (temperature 0.8, downfall
 * 0.4): grass and foliage where its colormaps (colormap.brarchive) have plains, spruce and birch
 * leaves their own maps' color, water a fixed blue.
 */
interface Tints {
  grass?: Rgb;
  foliage?: Rgb;
  evergreen?: Rgb;
  birch?: Rgb;
}

function loadTints(clientPacks: string): Tints {
  const archive = join(clientPacks, "vanilla", "__brarchive", "textures", "colormap.brarchive");
  if (!existsSync(archive)) return {};
  const maps = readArchive(new Uint8Array(readFileSync(archive)));
  const plains = (name: string): Rgb | undefined => {
    const data = maps.get(name);
    if (!data) return undefined;
    try {
      const picture = decodeAnyPng(data);
      const x = Math.round((1 - 0.8) * (picture.width - 1));
      const y = Math.round((1 - 0.4 * 0.8) * (picture.height - 1));
      const at = (y * picture.width + x) * 4;
      return [picture.data[at], picture.data[at + 1], picture.data[at + 2]];
    } catch {
      return undefined;
    }
  };
  return { grass: plains("grass.png"), foliage: plains("foliage.png"), evergreen: plains("evergreen.png"), birch: plains("birch.png") };
}

/** A texture's tint, if the client tints it. */
function tintOf(path: string, tints: Tints): Rgb | undefined {
  const name = path.split("/").pop()!;
  if (/^(leaves_spruce|spruce_leaves)/.test(name)) return tints.evergreen ?? tints.foliage;
  if (/^(leaves_birch|birch_leaves)/.test(name)) return tints.birch ?? tints.foliage;
  if (/^(grass_top|grass_carried|tallgrass|short_grass|tall_grass|fern|double_plant_grass|double_plant_fern|waterlily)/.test(name)) return tints.grass;
  if (/^(leaves_|oak_leaves|jungle_leaves|acacia_leaves|dark_oak_leaves|mangrove_leaves|vine)/.test(name)) return tints.foliage;
  if (/^water_/.test(name)) return WATER;
  return undefined;
}

function tinted(color: Rgba, tint: Rgb | undefined): Rgba {
  if (!tint) return color;
  return [Math.round((color[0] * tint[0]) / 255), Math.round((color[1] * tint[1]) / 255), Math.round((color[2] * tint[2]) / 255), color[3]];
}
