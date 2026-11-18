// Block Party's item and dice icons, which the build writes into the game's resource pack from
// games/blockparty/items.json and dice.json: each one's texture (a path in Block Party's pack, else
// Minecraft's own, like textures/items/totem) copied to its icon's place, ICON_FOLDER/<letters>.png,
// where the board's screens show it by the letters in their fields (the workshop JSON UI builder's
// cards, with pictures from `text:textures/blockparty/icons/{{row.item1}}`, and the item panel's
// icon, which shows a die or an item). A die's icon is its body's picture: the whole square, or face
// 1 of a six-face picture. An empty item slot on a card reads EMPTY_ICON's picture, which is clear.
// Each icon is copied again to its slot of the transfers' token (tokens.ts: token_<slot>, items then
// dice), the picture that flies when it changes hands.
// Minecraft's textures are Mojang's, so they never go in git: the build reads them from the cache
// (tools/build/vanilla-textures.ts), as it does for kit pictures. Small pictures are drawn larger
// with hard pixels, so they stay sharp on screen.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DICE, DICE_PROBLEMS, type DieDef } from "../../games/blockparty/behavior_pack/scripts/dice.ts";
import { ITEMS, ITEM_PROBLEMS, iconPath, type ItemDef } from "../../games/blockparty/behavior_pack/scripts/items.ts";
import { EMPTY_ICON } from "../../games/blockparty/behavior_pack/scripts/screen-codes.ts";
import { TOKEN_SLOTS, slotLetters, slotPicture } from "../../games/blockparty/behavior_pack/scripts/tokens.ts";
import { blankImage, encodePng, type Image } from "../skins/png.ts";
import { decodeAnyPng } from "../viewer/png.ts";
import { VanillaTextures } from "../build/vanilla-textures.ts";

/** An icon smaller than this many pixels across is drawn larger, a whole number of times. */
export const ICON_MIN_SIZE = 64;
/** Letters that can name a file: a die's may be any two plain characters, an item's are capitals. */
const FILE_LETTERS = /^[A-Za-z0-9]{1,2}$/;

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

/** The part of `image` from (x, y), `width` by `height`. */
export function crop(image: Image, x: number, y: number, width: number, height: number): Image {
  const out = blankImage(width, height);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return out;
}

/** A texture's picture: the pack's own file at its path (any PNG Minecraft reads), else Minecraft's; a pack file no reader takes goes as its bytes. */
function pictureOf(texture: string, pack: string, vanilla: VanillaTextures | undefined): Image | Buffer | undefined {
  const own = join(pack, `${texture}.png`);
  if (existsSync(own)) {
    const file = readFileSync(own);
    try {
      return decodeAnyPng(file);
    } catch {
      return file;
    }
  }
  return vanilla?.picture(texture);
}

/** A picture as an icon's PNG, drawn larger when small. */
function iconOf(picture: Image | Buffer | undefined): Buffer | undefined {
  if (picture === undefined || Buffer.isBuffer(picture)) return picture;
  return encodePng(scaleUp(picture, Math.ceil(ICON_MIN_SIZE / Math.max(picture.width, picture.height))));
}

/** An item's icon as a PNG: the pack's own file at its texture's path, else Minecraft's, drawn larger when small. */
export function itemIcon(item: ItemDef, pack: string, vanilla: VanillaTextures | undefined): Buffer | undefined {
  return item.texture === undefined ? undefined : iconOf(pictureOf(item.texture, pack, vanilla));
}

/** A die's icon as a PNG: its body's picture, face 1 of a six-face one (24 x 16: faces 1 to 3 on the top row). */
export function dieIcon(die: DieDef, pack: string, vanilla: VanillaTextures | undefined): Buffer | undefined {
  if (die.texture === undefined) return undefined;
  const picture = pictureOf(die.texture, pack, vanilla);
  if (picture === undefined || Buffer.isBuffer(picture)) return picture;
  const six = picture.width * 2 === picture.height * 3;
  return iconOf(six ? crop(picture, 0, 0, picture.width / 3, picture.height / 2) : picture);
}

let vanilla: VanillaTextures | undefined | null = null;

function vanillaTextures(textures: VanillaTextures | undefined): VanillaTextures | undefined {
  if (textures !== undefined) return textures;
  if (vanilla === null) vanilla = VanillaTextures.load();
  return vanilla ?? undefined;
}

async function writeIcon(out: string, letters: string, icon: Buffer): Promise<void> {
  const path = join(out, `${iconPath({ letters })}.png`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, icon);
}

function warnMissing(missing: readonly string[], from: VanillaTextures | undefined): void {
  if (missing.length === 0) return;
  console.warn(
    `blockparty: no picture for ${missing.join(", ")}: not in Block Party's pack${from ? " or Minecraft's" : ", and Minecraft's textures aren't cached on this PC (the Panel caches them at Start)"}`,
  );
}

/**
 * Writes each item's icon into Block Party's built resource pack at `out` (its own files already
 * there). Returns the items whose picture it couldn't find, by name.
 */
export async function addItemIcons(out: string, items: readonly ItemDef[] = Object.values(ITEMS), textures?: VanillaTextures): Promise<string[]> {
  if (ITEM_PROBLEMS.length > 0) console.warn(`games/blockparty/items.json has problems:\n- ${ITEM_PROBLEMS.join("\n- ")}`);
  const from = vanillaTextures(textures);
  const missing: string[] = [];
  for (const item of items) {
    if (item.texture === undefined) continue;
    const icon = itemIcon(item, out, from);
    if (icon) await writeIcon(out, item.letters, icon);
    else missing.push(`${item.name} (${item.texture})`);
  }
  warnMissing(missing, from);
  return missing;
}

/**
 * Writes each die's icon (the item panel shows a die by its letters, as it does an item) into the
 * built pack at `out`. Returns the dice whose picture it couldn't find, by name.
 */
export async function addDiceIcons(out: string, dice: readonly DieDef[] = Object.values(DICE), textures?: VanillaTextures): Promise<string[]> {
  if (DICE_PROBLEMS.length > 0) console.warn(`games/blockparty/dice.json has problems:\n- ${DICE_PROBLEMS.join("\n- ")}`);
  const from = vanillaTextures(textures);
  const missing: string[] = [];
  for (const die of dice) {
    if (die.texture === undefined) continue;
    if (!FILE_LETTERS.test(die.letters)) {
      console.warn(`blockparty: the ${die.name}'s letters "${die.letters}" can't name its icon's file, so the item panel has no picture for it (letters and digits only)`);
      continue;
    }
    const icon = dieIcon(die, out, from);
    if (icon) await writeIcon(out, die.letters, icon);
    else missing.push(`${die.name} (${die.texture})`);
  }
  warnMissing(missing, from);
  return missing;
}

/**
 * The transfers' token pictures (tokens.ts): each item's and die's icon, already written at `out`,
 * copied to its slot's picture, items first in the game's order, then the dice in the dice file's;
 * a slot with no icon, and every slot past the last, gets a clear one (the token's client entity
 * names all of them). Returns how many slots have a picture.
 */
export async function addTokenSlots(out: string, letters: readonly string[] = slotLetters()): Promise<number> {
  const clear = encodePng(blankImage(16, 16));
  let filled = 0;
  for (let slot = 0; slot < TOKEN_SLOTS; slot++) {
    const icon = letters[slot] === undefined ? undefined : join(out, `${iconPath({ letters: letters[slot] })}.png`);
    const picture = icon && existsSync(icon) ? readFileSync(icon) : undefined;
    if (picture) filled++;
    const path = join(out, `${slotPicture(slot)}.png`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, picture ?? clear);
  }
  if (letters.length > TOKEN_SLOTS) console.warn(`blockparty: ${letters.length} items and dice, but the transfers' token has ${TOKEN_SLOTS} pictures: the rest fly as nothing`);
  return filled;
}

/** Every icon the board's screens read: the items', the dice's, and the clear one an empty item slot reads; then the transfers' token pictures. */
export async function addBoardIcons(out: string): Promise<void> {
  await addItemIcons(out);
  await addDiceIcons(out);
  await writeIcon(out, EMPTY_ICON, encodePng(blankImage(16, 16)));
  await addTokenSlots(out);
}
