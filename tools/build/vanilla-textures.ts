// Minecraft's own item and block textures, for pictures the build draws (the kit form's, in
// kit-pictures.ts). They're Mojang's, not ours to publish, so they never go in git: the build reads
// them from Minecraft's vanilla resource pack on this PC, which keeps them in two archives, and
// copies those into tools/assets/vanilla/ (git-ignored). The Docker build has no Minecraft install,
// but it gets that folder with the rest of the checkout, so the Panel fills it before a start.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The copies of the archives (git-ignored). */
export const VANILLA_CACHE = fileURLToPath(new URL("../assets/vanilla/", import.meta.url));
/** Minecraft's vanilla resource pack (the Windows client's); MINECRAFT_VANILLA points elsewhere. */
export const VANILLA_PACK = process.env.MINECRAFT_VANILLA ?? "C:\\XboxGames\\Minecraft for Windows\\Content\\data\\resource_packs\\vanilla";
/** The archives, in the pack's __brarchive/textures folder: items/<name>.png and blocks/<name>.png. */
const ARCHIVES = ["items", "blocks"] as const;
type Folder = (typeof ARCHIVES)[number];

/** Item ids whose texture has another name, without "minecraft:". The rest are items/<id>. */
const ITEM_TEXTURES: Record<string, string> = {
  wooden_sword: "wood_sword",
  golden_sword: "gold_sword",
  wooden_axe: "wood_axe",
  golden_axe: "gold_axe",
  wooden_pickaxe: "wood_pickaxe",
  golden_pickaxe: "gold_pickaxe",
  wooden_shovel: "wood_shovel",
  golden_shovel: "gold_shovel",
  bow: "bow_standby",
  crossbow: "crossbow_standby",
  golden_apple: "apple_golden",
  fishing_rod: "fishing_rod_uncast",
};
/** Dye names whose wool texture has another name. */
const WOOL_DYES: Record<string, string> = { light_gray: "silver" };

/** A texture to draw: an item's flat picture, or a block's face (drawn as a cube). */
export interface VanillaTexture {
  kind: "item" | "block";
  png: Uint8Array;
}

/**
 * Copies the archives from Minecraft into the cache when they're missing there or Minecraft's have
 * changed. Returns whether the cache has them (from now or from before).
 */
export function cacheVanillaTextures(pack = VANILLA_PACK, cache = VANILLA_CACHE): boolean {
  let ready = true;
  for (const name of ARCHIVES) {
    const from = join(pack, "__brarchive", "textures", `${name}.brarchive`);
    const to = join(cache, `${name}.brarchive`);
    if (existsSync(from)) {
      const source = statSync(from);
      const copy = existsSync(to) ? statSync(to) : undefined;
      if (!copy || copy.size !== source.size || copy.mtimeMs < source.mtimeMs) {
        mkdirSync(cache, { recursive: true });
        copyFileSync(from, to);
      }
    } else if (!existsSync(to)) {
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

  constructor(folders: Record<Folder, Map<string, Uint8Array>>) {
    this.folders = folders;
  }

  /** Minecraft's textures, cached first if Minecraft is here; undefined when there are none to read. */
  static load(pack = VANILLA_PACK, cache = VANILLA_CACHE): VanillaTextures | undefined {
    if (!cacheVanillaTextures(pack, cache)) return undefined;
    const read = (name: Folder) => readArchive(new Uint8Array(readFileSync(join(cache, `${name}.brarchive`))));
    return new VanillaTextures({ items: read("items"), blocks: read("blocks") });
  }

  /** The picture of an item id ("minecraft:snowball", "minecraft:red_wool"), if Minecraft has one. */
  item(itemId: string): VanillaTexture | undefined {
    const name = itemId.replace(/^minecraft:/, "");
    const wool = /^(\w+)_wool$/.exec(name);
    if (wool) return this.png("blocks", `wool_colored_${WOOL_DYES[wool[1]] ?? wool[1]}`, "block");
    return this.png("items", ITEM_TEXTURES[name] ?? name, "item") ?? this.png("blocks", name, "block");
  }

  private png(folder: Folder, name: string, kind: VanillaTexture["kind"]): VanillaTexture | undefined {
    const png = this.folders[folder].get(`${name}.png`);
    return png && png[0] === 0x89 ? { kind, png } : undefined;
  }
}
