// Block Party's item icons, which the build writes into the game's resource pack from
// games/blockparty/items.json: each item's texture (a path in Block Party's pack, else Minecraft's
// own, like textures/items/totem) copied to its icon's place, ICON_FOLDER/<letters>.png, where the
// board's screens show it by the letters in their item fields (the workshop JSON UI builder's cards
// and item panel, with pictures from `text:textures/blockparty/icons/{{row.item1}}`). Minecraft's
// textures are Mojang's, so they never go in git: the build reads them from the cache
// (tools/build/vanilla-textures.ts), as it does for kit pictures. Small pictures are drawn larger
// with hard pixels, so they stay sharp on screen.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ITEMS, ITEM_PROBLEMS, iconPath, type ItemDef } from "../../games/blockparty/behavior_pack/scripts/items.ts";
import { blankImage, decodePng, encodePng, type Image } from "../skins/png.ts";
import { VanillaTextures } from "../build/vanilla-textures.ts";

/** An icon smaller than this many pixels across is drawn larger, a whole number of times. */
export const ICON_MIN_SIZE = 64;

/** `image` drawn `times` as large, each pixel a square. */
export function scaleUp(image: Image, times: number): Image {
  if (times <= 1) return image;
  const out = blankImage(image.width * times, image.height * times);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const from = (Math.floor(y / times) * image.width + Math.floor(x / times)) * 4;
      out.data.set(image.data.subarray(from, from + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

/**
 * An item's icon as a PNG: the pack's own file at its texture's path, else Minecraft's, drawn larger
 * when small. A pack file the PNG reader can't read (a palette PNG) goes as it is.
 */
export function itemIcon(item: ItemDef, pack: string, vanilla: VanillaTextures | undefined): Buffer | undefined {
  if (item.texture === undefined) return undefined;
  const own = join(pack, `${item.texture}.png`);
  let picture: Image | undefined;
  if (existsSync(own)) {
    const file = readFileSync(own);
    try {
      picture = decodePng(file);
    } catch {
      return file;
    }
  } else picture = vanilla?.picture(item.texture);
  return picture ? encodePng(scaleUp(picture, Math.ceil(ICON_MIN_SIZE / Math.max(picture.width, picture.height)))) : undefined;
}

let vanilla: VanillaTextures | undefined | null = null;

/**
 * Writes each item's icon into Block Party's built resource pack at `out` (its own files already
 * there). Returns the items whose picture it couldn't find, by name.
 */
export async function addItemIcons(out: string, items: readonly ItemDef[] = Object.values(ITEMS), textures?: VanillaTextures): Promise<string[]> {
  if (ITEM_PROBLEMS.length > 0) console.warn(`games/blockparty/items.json has problems:\n- ${ITEM_PROBLEMS.join("\n- ")}`);
  if (textures === undefined && vanilla === null) vanilla = VanillaTextures.load();
  const from = textures ?? vanilla ?? undefined;
  const missing: string[] = [];
  for (const item of items) {
    if (item.texture === undefined) continue;
    const icon = itemIcon(item, out, from);
    if (!icon) {
      missing.push(`${item.name} (${item.texture})`);
      continue;
    }
    const path = join(out, `${iconPath(item)}.png`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, icon);
  }
  if (missing.length > 0) {
    console.warn(
      `blockparty: no picture for ${missing.join(", ")}: not in Block Party's pack${from ? " or Minecraft's" : ", and Minecraft's textures aren't cached on this PC (the Panel caches them at Start)"}`,
    );
  }
  return missing;
}
