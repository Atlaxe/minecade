// Each kit's picture for the kit form (packages/minigame-core/src/game/kit-form.ts): a hotbar of
// nine slots, the kit's items filling them from the left, each with its count in the corner the way
// the hotbar draws a stack, and the kit's armor in the last slot. The icons are Minecraft's own
// textures (vanilla-textures.ts), a block's as a cube, leather dyed, or for a shared pack's own items
// (the guns pack's) that pack's hotbar icon. The build draws them into the
// resource pack of every game whose players pick kits, for the game's kits and each map's own, one
// picture per team dye for a kit with items or leather armor in team colors.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARMOR_PIECES,
  isLeather,
  kitItemId,
  kitPicturePath,
  pictureDyes,
  leatherColor,
  parseDyedLeather,
  possibleTeams,
  teamArmorColor,
  teamColored,
  type GameConfig,
  type KitDef,
  type MapConfig,
} from "@minecade/minigame-core/config";
import { blankImage, decodePng, encodePng, type Image } from "../skins/png.ts";
import { VanillaTextures, type VanillaTexture } from "./vanilla-textures.ts";

/** Slots on the hotbar. The items fill them from the left; a kit with armor shows it in the last one. */
export const HOTBAR_SLOTS = 9;
/** A slot is 20 pixels square (its 1 pixel frame included), the icon 16 square inside it, as on the hotbar. */
const SLOT = 20;
const ICON = 16;
const ICON_OFFSET = 2;
/** Everything is drawn 4 times as large, so it stays sharp in the form. */
const SCALE = 4;
const FRAME = [139, 139, 139, 255];
const FILL = [0, 0, 0, 150];
const WHITE = [255, 255, 255, 255];
const SHADOW = [63, 63, 63, 255];
/** A cube's faces: the top as it is, the left and right darker, as Minecraft draws blocks in the hotbar. */
const SHADES = { top: 1, left: 0.8, right: 0.6 };
/** Leather's own brown, for leather that isn't in a team's color. */
const LEATHER_BROWN = { red: 160 / 255, green: 101 / 255, blue: 64 / 255 };
/**
 * Where armor goes in the last slot's icon square (picture pixels), by how many pieces there are:
 * one fills it, more share it at half size, head to feet.
 */
const ARMOR_LAYOUTS: { x: number; y: number; size: number }[][] = [
  [],
  [{ x: 0, y: 0, size: 16 }],
  [{ x: 0, y: 4, size: 8 }, { x: 8, y: 4, size: 8 }],
  [{ x: 0, y: 0, size: 8 }, { x: 8, y: 0, size: 8 }, { x: 4, y: 8, size: 8 }],
  [{ x: 0, y: 0, size: 8 }, { x: 8, y: 0, size: 8 }, { x: 0, y: 8, size: 8 }, { x: 8, y: 8, size: 8 }],
];
/** Digits in Minecraft's font: 5x7 pixels, a space after each. */
const DIGITS = [
  [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "#####"],
  [".###.", "#...#", "....#", "..##.", ".#...", "#...#", "#####"],
  [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  ["...##", "..#.#", ".#..#", "#...#", "#####", "....#", "....#"],
  ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  ["#####", "#...#", "....#", "...#.", "..#..", "..#..", "..#.."],
  [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
];
const DIGIT_WIDTH = 5;

/** One item of a kit for its picture: the item id (team colors resolved) and how many. */
export interface PictureItem {
  item: string;
  count: number;
}

/** A kit's items for a player of this team dye, in the kit's order, then what it puts in the off hand. */
export function pictureItems(kit: KitDef, teamColor: string | undefined): PictureItem[] {
  const items = kit.items.map((item) => ({ item: kitItemId(item, teamColor), count: item.count ?? 1 }));
  const offhand = kit.armor?.offhand;
  return offhand === undefined ? items : [...items, { item: offhand, count: 1 }];
}

/** A kit's armor, head to feet. */
export function pictureArmor(kit: KitDef): string[] {
  return ARMOR_PIECES.map((piece) => kit.armor?.[piece]).filter((item): item is string => item !== undefined);
}

/** An icon to draw: an item's picture, or a block's face (drawn as a cube). */
export interface PictureIcon {
  kind: VanillaTexture["kind"];
  image: Image;
  count: number;
}

/**
 * Draws a kit's picture: the nine hotbar slots, its items in them from the left with counts over 1
 * in the corner, and its armor (if any) in the last slot. Items past the slots are left out.
 */
export function drawKitPicture(items: PictureIcon[], armor: PictureIcon[] = []): Image {
  const picture = blankImage(HOTBAR_SLOTS * SLOT * SCALE, SLOT * SCALE);
  for (let slot = 0; slot < HOTBAR_SLOTS; slot++) drawSlot(picture, slot * SLOT, 0);
  items.slice(0, armor.length > 0 ? HOTBAR_SLOTS - 1 : HOTBAR_SLOTS).forEach((item, index) => {
    const left = index * SLOT;
    drawIcon(picture, iconImage(item), left + ICON_OFFSET, ICON_OFFSET, ICON);
    if (item.count > 1) drawCount(picture, String(item.count), left + SLOT - 2, SLOT - 3);
  });
  const pieces = armor.slice(0, ARMOR_LAYOUTS.length - 1);
  const last = (HOTBAR_SLOTS - 1) * SLOT + ICON_OFFSET;
  pieces.forEach((piece, index) => {
    const spot = ARMOR_LAYOUTS[pieces.length][index];
    drawIcon(picture, iconImage(piece), last + spot.x, ICON_OFFSET + spot.y, spot.size);
  });
  return picture;
}

/**
 * Leather in a dye. Minecraft's leather textures are gray, tinted in the game; the pixels a texture
 * marks as keeping their own color (nearly see-through in it) are drawn as they are, solid.
 */
export function dyeLeather(image: Image, color: { red: number; green: number; blue: number }): Image {
  const dyed = { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  for (let at = 0; at < dyed.data.length; at += 4) {
    const alpha = dyed.data[at + 3];
    if (alpha === 0) continue;
    if (alpha === 255) {
      dyed.data[at] = Math.round(dyed.data[at] * color.red);
      dyed.data[at + 1] = Math.round(dyed.data[at + 1] * color.green);
      dyed.data[at + 2] = Math.round(dyed.data[at + 2] * color.blue);
    }
    dyed.data[at + 3] = 255;
  }
  return dyed;
}

let vanilla: VanillaTextures | undefined | null = null;

/** Minecraft's textures, read once; undefined when this PC (or checkout) has none. */
function vanillaTextures(): VanillaTextures | undefined {
  if (vanilla === null) {
    vanilla = VanillaTextures.load();
    if (!vanilla) console.warn("kit pictures: Minecraft's textures aren't here (see tools/build/vanilla-textures.ts), so kit forms list items as text");
  }
  return vanilla;
}

/**
 * Writes the kit form's pictures into a game's built resource pack at `out`, for a game whose
 * players pick kits: the game's kits, then each of these maps' own. Returns how many it wrote.
 */
export async function addGameKitPictures(out: string, game: GameConfig, maps: { id: string; config: MapConfig }[], textures = vanillaTextures()): Promise<number> {
  if (!game.kits?.select || !textures) return 0;
  const kits: { kit: KitDef; map?: string }[] = game.kits.list.map((kit) => ({ kit }));
  for (const map of maps) for (const kit of map.config.kits?.list ?? []) kits.push({ kit, map: map.id });
  return addKitPictures(out, kits, game.teams ? possibleTeams(game.teams).map((team) => team.color) : [], textures);
}

/** Writes these kits' pictures into a built resource pack at `out`, one per team dye for a kit in team colors. */
export async function addKitPictures(out: string, kits: { kit: KitDef; map?: string }[], teamColors: string[], textures: VanillaTextures): Promise<number> {
  let written = 0;
  for (const { kit, map } of kits) {
    const colored = teamColored(kit);
    const colors: (string | undefined)[] = colored && teamColors.length > 0 ? dyeColors(teamColors) : [undefined];
    for (const teamColor of colors) {
      const armorDye = kit.teamArmor && teamColor !== undefined ? teamArmorColor(teamColor) : LEATHER_BROWN;
      const items = pictureItems(kit, teamColor).flatMap(({ item, count }) => pictureIcon(textures, item, count, LEATHER_BROWN));
      const armor = pictureArmor(kit).flatMap((item) => pictureIcon(textures, item, 1, armorDye));
      if (items.length === 0 && armor.length === 0) continue;
      const path = join(out, `${kitPicturePath(kit.id, { map, teamColor, colored })}.png`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, encodePng(drawKitPicture(items, armor)));
      written++;
    }
  }
  return written;
}

/**
 * An item's icon, leather in `dye` (the armor pack's dyed leather in its own); none when neither
 * Minecraft nor a shared pack has a texture for it (it's left out).
 */
function pictureIcon(textures: VanillaTextures, item: string, count: number, dye: { red: number; green: number; blue: number }): PictureIcon[] {
  const dyed = parseDyedLeather(item);
  if (dyed) return pictureIcon(textures, `minecraft:leather_${dyed.piece}`, count, leatherColor(dyed.dye));
  const texture = textures.item(item) ?? sharedPackIcons().get(item);
  if (!texture) return [];
  return [{ kind: texture.kind, image: isLeather(item) ? dyeLeather(texture.image, dye) : texture.image, count }];
}

/** The shared packs whose own items a kit can give (packs/<name>, committed: their icons are ours). */
const ICON_PACKS = ["guns"];
let sharedIcons: Map<string, VanillaTexture> | undefined;

/**
 * The hotbar icons of the shared packs' items, by item id: each item's icon key, through the pack's
 * item_texture.json; an item drawn as its block's model (no icon key) has a picture in the pack's
 * icons folder, named after it.
 */
function sharedPackIcons(): Map<string, VanillaTexture> {
  if (sharedIcons) return sharedIcons;
  sharedIcons = new Map();
  for (const name of ICON_PACKS) {
    const packs = fileURLToPath(new URL(`../../packs/${name}/`, import.meta.url));
    const items = join(packs, "behavior_pack", "items");
    const atlas = join(packs, "resource_pack", "textures", "item_texture.json");
    if (!existsSync(items) || !existsSync(atlas)) continue;
    const paths = (JSON.parse(readFileSync(atlas, "utf8")) as { texture_data: Record<string, { textures: string }> }).texture_data;
    for (const file of readdirSync(items).filter((entry) => entry.endsWith(".json"))) {
      const definition = JSON.parse(readFileSync(join(items, file), "utf8"))["minecraft:item"];
      const path = paths[definition?.components?.["minecraft:icon"]?.textures?.default]?.textures;
      const png = path ? join(packs, "resource_pack", `${path}.png`) : join(packs, "icons", file.replace(/\.json$/, ".png"));
      if (png && existsSync(png)) sharedIcons.set(definition.description.identifier, { kind: "item", image: decodePng(readFileSync(png)) });
    }
  }
  return sharedIcons;
}

/** One team color per dye (two colors can share a dye, such as §c and §4). */
function dyeColors(teamColors: string[]): string[] {
  const dyes = pictureDyes(teamColors);
  return dyes.map((dye) => teamColors.find((color) => pictureDyes([color])[0] === dye)!);
}

/** A slot at (left, top) in picture pixels: a dark see-through square in a gray frame. */
function drawSlot(picture: Image, left: number, top: number): void {
  for (let y = 0; y < SLOT; y++) {
    for (let x = 0; x < SLOT; x++) {
      const edge = x === 0 || y === 0 || x === SLOT - 1 || y === SLOT - 1;
      fill(picture, left + x, top + y, edge ? FRAME : FILL);
    }
  }
}

/** The image an icon draws: an item's as it is, a block's as a cube. */
function iconImage(icon: PictureIcon): Image {
  return icon.kind === "block" ? blockIcon(icon.image) : icon.image;
}

/** An icon stretched over `size` picture pixels square at (left, top), its see-through pixels left alone. */
function drawIcon(picture: Image, icon: Image, left: number, top: number, size: number): void {
  const pixels = size * SCALE;
  for (let y = 0; y < pixels; y++) {
    for (let x = 0; x < pixels; x++) {
      const from = (Math.floor((y * icon.height) / pixels) * icon.width + Math.floor((x * icon.width) / pixels)) * 4;
      if (icon.data[from + 3] > 0) put(picture, left * SCALE + x, top * SCALE + y, icon.data.subarray(from, from + 4), 1);
    }
  }
}

/**
 * A block's icon from one face's texture: a cube seen from above and the front corner, the way the
 * hotbar shows blocks, drawn at SCALE so its edges are finer steps than the texture's pixels.
 */
export function blockIcon(face: Image): Image {
  const size = ICON * SCALE;
  const icon = blankImage(size, size);
  const tilt = Math.PI / 6;
  const [cos, sin, root2] = [Math.cos(tilt), Math.sin(tilt), Math.SQRT2];
  // A unit cube turned 45 degrees and seen from 30 degrees up, sized so it's 16 pixels tall.
  const scale = ICON / (2 * (0.5 * cos + sin / root2));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sx = ((px + 0.5) / SCALE - ICON / 2) / scale;
      const sy = ((py + 0.5) / SCALE - ICON / 2) / scale;
      const hit = cubeFace(sx, sy, cos, sin, root2);
      if (!hit) continue;
      const tx = Math.min(face.width - 1, Math.floor(hit.u * face.width));
      const ty = Math.min(face.height - 1, Math.floor(hit.v * face.height));
      const from = (ty * face.width + tx) * 4;
      if (face.data[from + 3] === 0) continue;
      const shade = SHADES[hit.face];
      const color = [face.data[from] * shade, face.data[from + 1] * shade, face.data[from + 2] * shade, face.data[from + 3]].map(Math.round);
      icon.data.set(color, (py * size + px) * 4);
    }
  }
  return icon;
}

/** Which face of the cube a point on screen falls on, and where on it (u, v from 0 to 1). */
function cubeFace(sx: number, sy: number, cos: number, sin: number, root2: number): { face: keyof typeof SHADES; u: number; v: number } | undefined {
  const inside = (u: number, v: number) => u >= 0 && u < 1 && v >= 0 && v < 1;
  // Top (y = 0.5): a point (u, v) on it shows at sx = (u - v) / root2, sy = -cos / 2 + (u + v - 1) sin / root2.
  const a = sx * root2;
  const b = ((sy + cos / 2) * root2) / sin + 1;
  if (inside((a + b) / 2, (b - a) / 2)) return { face: "top", u: (a + b) / 2, v: (b - a) / 2 };
  // Left (z = 0.5): sx = (u - 1) / root2, sy = -(0.5 - v) cos + u sin / root2.
  const leftU = sx * root2 + 1;
  const leftV = (sy - (leftU * sin) / root2) / cos + 0.5;
  if (inside(leftU, leftV)) return { face: "left", u: leftU, v: leftV };
  // Right (x = 0.5): sx = u / root2, sy = -(0.5 - v) cos + (1 - u) sin / root2.
  const rightU = sx * root2;
  const rightV = (sy - ((1 - rightU) * sin) / root2) / cos + 0.5;
  if (inside(rightU, rightV)) return { face: "right", u: rightU, v: rightV };
  return undefined;
}

/** A count with its right edge at `right` and its bottom row at `bottom` (picture pixels), with its shadow. */
function drawCount(picture: Image, text: string, right: number, bottom: number): void {
  const step = DIGIT_WIDTH + 1;
  const left = right - text.length * step + 2;
  const top = bottom - DIGITS[0].length + 1;
  for (const [shade, offset] of [[SHADOW, 1], [WHITE, 0]] as const) {
    [...text].forEach((char, index) => {
      DIGITS[Number(char)].forEach((row, y) => {
        [...row].forEach((cell, x) => {
          if (cell === "#") fill(picture, left + index * step + x + offset, top + y + offset, shade);
        });
      });
    });
  }
}

/** One picture pixel: SCALE x SCALE in the image. */
function fill(picture: Image, x: number, y: number, color: ArrayLike<number>): void {
  for (let dy = 0; dy < SCALE; dy++) put(picture, x * SCALE, y * SCALE + dy, color, SCALE);
}

function put(picture: Image, x: number, y: number, color: ArrayLike<number>, width: number): void {
  if (y < 0 || y >= picture.height) return;
  for (let dx = 0; dx < width; dx++) {
    const px = x + dx;
    if (px < 0 || px >= picture.width) continue;
    picture.data.set([color[0], color[1], color[2], color[3]], (y * picture.width + px) * 4);
  }
}
