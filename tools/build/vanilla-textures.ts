// Minecraft's own item, block and armor textures, for pictures the build draws (the kit form's, in
// kit-pictures.ts) and the dyed leather armor pack (tools/assets/armor.ts). They're Mojang's, not ours to publish, so they never go in git: the build reads
// them from Minecraft's vanilla resource pack on this PC, which keeps them in two archives, and
// copies those into tools/assets/vanilla/ (git-ignored). The Docker build has no Minecraft install,
// but it gets that folder with the rest of the checkout, so the Panel fills it before a start.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, type Image } from "../skins/png.ts";

/** The copies of the archives (git-ignored). */
export const VANILLA_CACHE = fileURLToPath(new URL("../assets/vanilla/", import.meta.url));
/** Minecraft's vanilla resource pack (the Windows client's); MINECRAFT_VANILLA points elsewhere. */
export const VANILLA_PACK = process.env.MINECRAFT_VANILLA ?? "C:\\XboxGames\\Minecraft for Windows\\Content\\data\\resource_packs\\vanilla";
/** The archives, in the pack's __brarchive/textures folder: items/<name>.png and blocks/<name>.png (a few .tga). */
const ARCHIVES = ["items", "blocks"] as const;
/** Archives the pictures can do without: the armor models' textures (models/armor.brarchive: leather_1.tga). */
const OPTIONAL_ARCHIVES = { armor: "models/armor" } as const;
type Folder = (typeof ARCHIVES)[number] | keyof typeof OPTIONAL_ARCHIVES;

/**
 * Item ids whose texture has another name, without "minecraft:". Wooden and golden tools and armor
 * are wood_ and gold_ (wood_sword, gold_helmet); the rest are items/<id>, else blocks/<id>.
 */
const ITEM_TEXTURES: Record<string, string> = {
  bow: "bow_standby",
  crossbow: "crossbow_standby",
  golden_apple: "apple_golden",
  golden_carrot: "carrot_golden",
  fishing_rod: "fishing_rod_uncast",
  cooked_beef: "beef_cooked",
  cooked_chicken: "chicken_cooked",
  cooked_porkchop: "porkchop_cooked",
  baked_potato: "potato_baked",
  bucket: "bucket_empty",
  water_bucket: "bucket_water",
  lava_bucket: "bucket_lava",
  compass: "compass_item",
  clock: "clock_item",
  totem_of_undying: "totem",
  fire_charge: "fireball",
  heart_of_the_sea: "heartofthesea_closed",
  glistering_melon_slice: "melon_speckled",
  ink_sac: "dye_powder_black",
};
/** Block ids whose texture has another name. */
const BLOCK_TEXTURES: Record<string, string> = { oak_planks: "planks_oak", bricks: "brick" };
const TOOLS_AND_ARMOR = /^(wooden|golden)_(sword|axe|pickaxe|shovel|hoe|helmet|chestplate|leggings|boots)$/;
/** Dye names whose wool texture has another name. */
const WOOL_DYES: Record<string, string> = { light_gray: "silver" };

/** A texture to draw: an item's flat picture, or a block's face (drawn as a cube). */
export interface VanillaTexture {
  kind: "item" | "block";
  image: Image;
}

/**
 * Copies the archives from Minecraft into the cache when they're missing there or Minecraft's have
 * changed. Returns whether the cache has them (from now or from before).
 */
export function cacheVanillaTextures(pack = VANILLA_PACK, cache = VANILLA_CACHE): boolean {
  let ready = true;
  for (const [name, path] of [...ARCHIVES.map((name) => [name, name]), ...Object.entries(OPTIONAL_ARCHIVES)]) {
    const from = join(pack, "__brarchive", "textures", `${path}.brarchive`);
    const to = join(cache, `${name}.brarchive`);
    if (existsSync(from)) {
      const source = statSync(from);
      const copy = existsSync(to) ? statSync(to) : undefined;
      if (!copy || copy.size !== source.size || copy.mtimeMs < source.mtimeMs) {
        mkdirSync(cache, { recursive: true });
        copyFileSync(from, to);
      }
    } else if (!existsSync(to) && (ARCHIVES as readonly string[]).includes(name)) {
      ready = false;
    }
  }
  return ready;
}

/** The files in an archive (Minecraft's .brarchive), by name. */
export function readArchive(bytes: Uint8Array): Map<string, Uint8Array> {
  // 16 bytes (a magic number, the entry count, a version), then a 256-byte entry per file (the
  // name's length, the name padded to 247 bytes, the data's offset and size), then the data.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(8, true);
  const start = 16 + count * 256;
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index++) {
    const entry = 16 + index * 256;
    const name = new TextDecoder().decode(bytes.subarray(entry + 1, entry + 1 + bytes[entry]));
    const offset = view.getUint32(entry + 248, true);
    const size = view.getUint32(entry + 252, true);
    files.set(name, bytes.subarray(start + offset, start + offset + size));
  }
  return files;
}

export class VanillaTextures {
  private readonly folders: Record<Folder, Map<string, Uint8Array>>;

  constructor(folders: Record<(typeof ARCHIVES)[number], Map<string, Uint8Array>> & Partial<Record<Folder, Map<string, Uint8Array>>>) {
    this.folders = { armor: new Map(), ...folders };
  }

  /** Minecraft's textures, cached first if Minecraft is here; undefined when there are none to read. */
  static load(pack = VANILLA_PACK, cache = VANILLA_CACHE): VanillaTextures | undefined {
    if (!cacheVanillaTextures(pack, cache)) return undefined;
    const read = (name: Folder) => {
      const path = join(cache, `${name}.brarchive`);
      return existsSync(path) ? readArchive(new Uint8Array(readFileSync(path))) : new Map<string, Uint8Array>();
    };
    return new VanillaTextures({ items: read("items"), blocks: read("blocks"), armor: read("armor") });
  }

  /** An armor model's texture ("leather_1"), if Minecraft has it. */
  armor(name: string): Image | undefined {
    return this.texture("armor", name, "item")?.image;
  }

  /** The picture of an item id ("minecraft:snowball", "minecraft:red_wool"), if Minecraft has one. */
  item(itemId: string): VanillaTexture | undefined {
    const name = itemId.replace(/^minecraft:/, "");
    const wool = /^(\w+)_wool$/.exec(name);
    if (wool) return this.texture("blocks", `wool_colored_${WOOL_DYES[wool[1]] ?? wool[1]}`, "block");
    const tool = TOOLS_AND_ARMOR.exec(name);
    const itemName = ITEM_TEXTURES[name] ?? (tool ? `${tool[1] === "wooden" ? "wood" : "gold"}_${tool[2]}` : name);
    return this.texture("items", itemName, "item") ?? this.texture("blocks", BLOCK_TEXTURES[name] ?? name, "block");
  }

  /** A texture as a PNG, else a TGA (leather armor's are). */
  private texture(folder: Folder, name: string, kind: VanillaTexture["kind"]): VanillaTexture | undefined {
    const png = this.folders[folder].get(`${name}.png`);
    const tga = this.folders[folder].get(`${name}.tga`);
    try {
      const image = png && png[0] === 0x89 ? decodePng(png) : tga ? decodeTga(tga) : undefined;
      return image ? { kind, image } : undefined;
    } catch {
      return undefined; // a kind of PNG the decoder doesn't read: left out like a missing one
    }
  }
}

/**
 * A TGA image: true color (24 or 32 bits a pixel), plain or run-length encoded, as Minecraft keeps
 * a few textures. Undefined for any other kind.
 */
export function decodeTga(bytes: Uint8Array): Image | undefined {
  // An 18-byte head: the id's length, a color map flag, the image type (2 plain, 10 run-length),
  // the color map's spec, the origin, the width and height, the bits a pixel and a descriptor (bit
  // 5 set when the first row is the top). Then the id, then the pixels in BGR(A).
  if (bytes.length < 18 || bytes[1] !== 0 || (bytes[2] !== 2 && bytes[2] !== 10)) return undefined;
  const width = bytes[12] | (bytes[13] << 8);
  const height = bytes[14] | (bytes[15] << 8);
  const size = bytes[16] / 8;
  if ((size !== 3 && size !== 4) || width === 0 || height === 0) return undefined;
  const topFirst = (bytes[17] & 0x20) !== 0;
  const data = new Uint8Array(width * height * 4);
  let at = 18 + bytes[0];
  const pixel = (index: number, from: number) => {
    const row = Math.floor(index / width);
    const to = ((topFirst ? row : height - 1 - row) * width + (index % width)) * 4;
    data.set([bytes[from + 2], bytes[from + 1], bytes[from], size === 4 ? bytes[from + 3] : 255], to);
  };
  for (let index = 0; index < width * height; ) {
    if (bytes[2] === 2) {
      if (at + size > bytes.length) return undefined;
      pixel(index++, at);
      at += size;
      continue;
    }
    const head = bytes[at++];
    const count = (head & 0x7f) + 1;
    if (head & 0x80) {
      if (at + size > bytes.length) return undefined;
      for (let step = 0; step < count && index < width * height; step++) pixel(index++, at);
      at += size;
    } else {
      if (at + count * size > bytes.length) return undefined;
      for (let step = 0; step < count && index < width * height; step++, at += size) pixel(index++, at);
    }
  }
  return { width, height, data };
}
