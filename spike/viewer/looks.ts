// Map viewer spike, step 2: how blocks look, from the client installed on this PC and the shared
// blocks pack (packs\blocks). Nothing here goes into git: textures and the colors made from them
// stay in work\viewer\.
//
// Vanilla: the client layers its vanilla resource packs (vanilla, then vanilla_1.14 up to the
// newest), each adding to blocks.json (which texture each face uses) and terrain_texture.json
// (each texture's file), field by field, and packing its block textures in
// __brarchive\textures\blocks.brarchive. Custom blocks: minecraft:material_instances in the
// behavior pack, then the resource pack's terrain_texture.json.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readArchive } from "./brarchive.ts";
import { decodeImage, type Picture } from "./image.ts";

export const CLIENT_DATA = "C:\\XboxGames\\Minecraft for Windows\\Content\\data";

/** Blocks whose blocks.json entry still has an older name. */
const RENAMED: Record<string, string> = { grass_block: "grass", sea_lantern: "seaLantern", iron_chain: "chain" };

export type Face = "up" | "down" | "side";
export type Rgba = [number, number, number, number];

export interface Looks {
  /** Each block's texture for each face, by full name (minecraft:stone). */
  faces: Map<string, Record<Face, string>>;
  /** Textures by path (textures/blocks/stone), first frame only where animated. */
  pictures: Map<string, Picture>;
  /** The texture names with a tint, and the tint's color. */
  tints: Map<string, [number, number, number]>;
}

/** JSON with // and block comments, as Bedrock's pack files allow. */
export function readLooseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "").replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, text: string | undefined) => text ?? ""));
}

type TextureEntry = string | { path: string; overlay_color?: string; tint_color?: string } | (string | { path: string })[];
type BlockEntry = { textures?: string | Partial<Record<"up" | "down" | "side" | "north" | "south" | "east" | "west", string>> };

export function loadLooks(clientData = CLIENT_DATA, blocksPack?: string): Looks {
  const packsDir = join(clientData, "resource_packs");
  const packs = readdirSync(packsDir).filter((name) => name === "vanilla" || /^vanilla_[\d.]+$/.test(name)).sort(byVersion);
  const blocks: Record<string, BlockEntry> = {};
  const textures: Record<string, { textures: TextureEntry }> = {};
  const files = new Map<string, Buffer>();
  for (const pack of packs) {
    const dir = join(packsDir, pack);
    if (existsSync(join(dir, "blocks.json"))) {
      for (const [name, entry] of Object.entries(readLooseJson(join(dir, "blocks.json")) as Record<string, BlockEntry>)) {
        if (name !== "format_version") blocks[name] = { ...blocks[name], ...entry };
      }
    }
    const terrain = join(dir, "textures", "terrain_texture.json");
    if (existsSync(terrain)) Object.assign(textures, (readLooseJson(terrain) as { texture_data: typeof textures }).texture_data);
    // textures\blocks\ is blocks.brarchive; each folder in it (deepslate, candles) an archive of its own.
    const archive = join(dir, "__brarchive", "textures", "blocks.brarchive");
    if (existsSync(archive)) for (const entry of readArchive(readFileSync(archive))) files.set(`textures/blocks/${entry.name}`, entry.data);
    const folders = join(dir, "__brarchive", "textures", "blocks");
    if (existsSync(folders)) {
      for (const name of readdirSync(folders).filter((file) => file.endsWith(".brarchive"))) {
        for (const entry of readArchive(readFileSync(join(folders, name)))) files.set(`textures/blocks/${name.replace(".brarchive", "")}/${entry.name}`, entry.data);
      }
    }
  }
  // Blocks renamed since blocks.json named them.
  for (const [name, old] of Object.entries(RENAMED)) if (!blocks[name] && blocks[old]) blocks[name] = blocks[old];
  const looks: Looks = { faces: new Map(), pictures: new Map(), tints: new Map() };
  const pathOf = (texture: string): string | undefined => {
    const entry = textures[texture]?.textures;
    const first = Array.isArray(entry) ? entry[0] : entry;
    return typeof first === "string" ? first : first?.path;
  };
  const load = (path: string | undefined, source: (path: string) => Buffer | undefined): string | undefined => {
    if (!path) return undefined;
    if (looks.pictures.has(path)) return path;
    const data = source(path);
    if (!data) return undefined;
    try {
      looks.pictures.set(path, firstFrame(decodeImage(data, path)));
      return path;
    } catch {
      return undefined;
    }
  };
  const vanillaFile = (path: string) => files.get(`${path}.png`) ?? files.get(`${path}.tga`);
  for (const [name, entry] of Object.entries(blocks)) {
    const faces = faceTextures(entry.textures);
    if (!faces) continue;
    const up = load(pathOf(faces.up), vanillaFile);
    const down = load(pathOf(faces.down), vanillaFile);
    const side = load(pathOf(faces.side), vanillaFile);
    if (up && down && side) looks.faces.set(`minecraft:${name}`, { up, down, side });
  }
  // Biome tints, fixed to plains: grass and foliage from the client's colormaps, water a fixed blue.
  const colormaps = new Map(readArchive(readFileSync(join(packsDir, "vanilla", "__brarchive", "textures", "colormap.brarchive"))).map((entry) => [entry.name, decodeImage(entry.data, entry.name)]));
  const plains = (map: string): [number, number, number] => {
    const picture = colormaps.get(map)!;
    // Plains: temperature 0.8, downfall 0.4 (x = (1 - t) * 255, y = (1 - d * t) * 255 on a 256 map).
    const x = Math.min(picture.width - 1, Math.round((1 - 0.8) * (picture.width - 1)));
    const y = Math.min(picture.height - 1, Math.round((1 - 0.4 * 0.8) * (picture.height - 1)));
    const at = (y * picture.width + x) * 4;
    return [picture.data[at], picture.data[at + 1], picture.data[at + 2]];
  };
  const grass = plains("grass.png");
  const foliage = plains("foliage.png");
  for (const path of looks.pictures.keys()) {
    const name = path.split("/").pop()!;
    if (/^(grass_top|grass_side_carried|tallgrass|short_grass|fern|double_plant_grass|double_plant_fern|waterlily|grass_carried)/.test(name)) looks.tints.set(path, grass);
    else if (/^(leaves_|oak_leaves|jungle_leaves|acacia_leaves|dark_oak_leaves|mangrove_leaves|vine)/.test(name)) looks.tints.set(path, foliage);
    else if (/^(leaves_spruce|spruce_leaves)/.test(name)) looks.tints.set(path, [0x61, 0x99, 0x61]);
    else if (/^(leaves_birch|birch_leaves)/.test(name)) looks.tints.set(path, [0x80, 0xa7, 0x55]);
    else if (/^water_/.test(name)) looks.tints.set(path, [0x44, 0xaf, 0xf5]);
  }
  if (blocksPack) addCustom(looks, blocksPack, load);
  return looks;
}

/** The shared blocks pack's blocks: each one's material instance for every face (* when one covers all). */
function addCustom(looks: Looks, pack: string, load: (path: string | undefined, source: (path: string) => Buffer | undefined) => string | undefined): void {
  const terrain = (readLooseJson(join(pack, "resource_pack", "textures", "terrain_texture.json")) as { texture_data: Record<string, { textures: TextureEntry }> }).texture_data;
  const file = (path: string) => [".png", ".tga"].map((ext) => join(pack, "resource_pack", `${path}${ext}`)).find(existsSync);
  const source = (path: string) => {
    const found = file(path);
    return found ? readFileSync(found) : undefined;
  };
  for (const name of readdirSync(join(pack, "behavior_pack", "blocks"))) {
    const definition = readLooseJson(join(pack, "behavior_pack", "blocks", name)) as { "minecraft:block": { description: { identifier: string }; components?: Record<string, unknown> } };
    const block = definition["minecraft:block"];
    const instances = (block.components?.["minecraft:material_instances"] ?? {}) as Record<string, { texture?: string } | string>;
    const textureOf = (face: string): string | undefined => {
      let instance = instances[face] ?? instances["*"];
      // An instance can name another instance.
      for (let i = 0; i < 4 && typeof instance === "string"; i++) instance = instances[instance];
      const texture = typeof instance === "object" ? instance.texture : undefined;
      const entry = texture ? terrain[texture]?.textures : undefined;
      const first = Array.isArray(entry) ? entry[0] : entry;
      return typeof first === "string" ? first : first?.path;
    };
    const up = load(textureOf("up"), source);
    const down = load(textureOf("down"), source);
    const side = load(textureOf("north"), source);
    if (up && down && side) looks.faces.set(block.description.identifier, { up, down, side });
  }
}

function faceTextures(textures: BlockEntry["textures"]): Record<Face, string> | undefined {
  if (!textures) return undefined;
  if (typeof textures === "string") return { up: textures, down: textures, side: textures };
  const side = textures.side ?? textures.north ?? textures.south ?? textures.east ?? textures.west;
  if (!textures.up || !textures.down || !side) return undefined;
  return { up: textures.up, down: textures.down, side };
}

/** An animated texture's first frame: the top square of its strip. */
function firstFrame(picture: Picture): Picture {
  if (picture.height <= picture.width) return picture;
  return { width: picture.width, height: picture.width, data: picture.data.subarray(0, picture.width * picture.width * 4) };
}

function byVersion(a: string, b: string): number {
  const version = (name: string) => (name === "vanilla" ? [0] : name.slice(8).split(".").map(Number));
  const [x, y] = [version(a), version(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The plan's color: leave out pixels under half opaque, bucket the rest by the top 4 bits of red,
 * green and blue, take the fullest bucket (the brighter on a tie), and average its pixels. Alpha
 * is how opaque the texture is in all (glass keeps its see-through).
 */
export function commonColor(picture: Picture): Rgba {
  const buckets = new Map<number, [number, number, number, number]>();
  let alpha = 0;
  const pixels = picture.width * picture.height;
  for (let p = 0; p < pixels; p++) {
    const [r, g, b, a] = picture.data.subarray(p * 4, p * 4 + 4);
    alpha += a;
    if (a < 128) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? [0, 0, 0, 0];
    bucket[0]++;
    bucket[1] += r;
    bucket[2] += g;
    bucket[3] += b;
    buckets.set(key, bucket);
  }
  let best: [number, number, number, number] | undefined;
  for (const bucket of buckets.values()) {
    if (!best || bucket[0] > best[0] || (bucket[0] === best[0] && bucket[1] + bucket[2] + bucket[3] > best[1] + best[2] + best[3])) best = bucket;
  }
  if (!best) return [0, 0, 0, 0];
  return [Math.round(best[1] / best[0]), Math.round(best[2] / best[0]), Math.round(best[3] / best[0]), Math.round(alpha / pixels)];
}

/** The whole texture's average (opaque pixels), for comparison. */
export function wholeAverage(picture: Picture): Rgba {
  let [n, r, g, b, alpha] = [0, 0, 0, 0, 0];
  const pixels = picture.width * picture.height;
  for (let p = 0; p < pixels; p++) {
    const a = picture.data[p * 4 + 3];
    alpha += a;
    if (a < 128) continue;
    n++;
    r += picture.data[p * 4];
    g += picture.data[p * 4 + 1];
    b += picture.data[p * 4 + 2];
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(alpha / pixels)] : [0, 0, 0, 0];
}

/** A color times a tint (the client multiplies a gray texture by the biome's color). */
export function tinted(color: Rgba, tint: [number, number, number] | undefined): Rgba {
  if (!tint) return color;
  return [Math.round((color[0] * tint[0]) / 255), Math.round((color[1] * tint[1]) / 255), Math.round((color[2] * tint[2]) / 255), color[3]];
}
