// Each kit's picture for the kit form (packages/minigame-core/src/game/kit-form.ts): its items in a
// row of hotbar slots, left to right, nine to a row, each with its count in the corner the way the
// hotbar draws a stack. The icons are Minecraft's own textures (vanilla-textures.ts), a block's as a
// cube. The build draws them into the resource pack of every game whose players pick kits, for the
// game's kits and each map's own, one picture per team dye for a kit with items in team colors.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { kitItemId, kitPicturePath, pictureDyes, possibleTeams, teamColored, type GameConfig, type KitDef, type MapConfig } from "@minecade/minigame-core/config";
import { blankImage, decodePng, encodePng, type Image } from "../skins/png.ts";
import { VanillaTextures, type VanillaTexture } from "./vanilla-textures.ts";

/** Slots in a row, as on the hotbar. A picture is always a full row wide, so its items start at the left. */
export const ROW_SLOTS = 9;
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

/** A kit's items for a player of this team dye, in the kit's order. */
export function pictureItems(kit: KitDef, teamColor: string | undefined): PictureItem[] {
  return kit.items.map((item) => ({ item: kitItemId(item, teamColor), count: item.count ?? 1 }));
}

/** An icon to draw: an item's picture, or a block's face (drawn as a cube). */
export interface PictureIcon {
  kind: VanillaTexture["kind"];
  image: Image;
  count: number;
}

/** Draws a kit's picture: a slot per item, left to right in rows of nine, counts over 1 in the corner. */
export function drawKitPicture(items: PictureIcon[]): Image {
  const rows = Math.max(1, Math.ceil(items.length / ROW_SLOTS));
  const picture = blankImage(ROW_SLOTS * SLOT * SCALE, rows * SLOT * SCALE);
  items.forEach((item, index) => {
    const left = (index % ROW_SLOTS) * SLOT;
    const top = Math.floor(index / ROW_SLOTS) * SLOT;
    drawSlot(picture, left, top);
    const icon = item.kind === "block" ? blockIcon(item.image) : item.image;
    drawIcon(picture, icon, left + ICON_OFFSET, top + ICON_OFFSET);
    if (item.count > 1) drawCount(picture, String(item.count), left + SLOT - 2, top + SLOT - 3);
  });
  return picture;
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
      const icons: PictureIcon[] = [];
      for (const { item, count } of pictureItems(kit, teamColor)) {
        const texture = textures.item(item);
        if (texture) icons.push({ kind: texture.kind, image: decodePng(texture.png), count });
      }
      if (icons.length === 0) continue;
      const path = join(out, `${kitPicturePath(kit.id, { map, teamColor, colored })}.png`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, encodePng(drawKitPicture(icons)));
      written++;
    }
  }
  return written;
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

/** An icon (16x16, or a block's already drawn at SCALE) stretched over 16 picture pixels at (left, top), its see-through pixels left alone. */
function drawIcon(picture: Image, icon: Image, left: number, top: number): void {
  const size = ICON * SCALE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (Math.floor((y * icon.height) / size) * icon.width + Math.floor((x * icon.width) / size)) * 4;
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
