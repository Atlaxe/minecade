// Each kit's picture for the kit form (packages/minigame-core/src/game/kit-form.ts): its items'
// icons in a row, each with its count in the corner the way Minecraft draws a stack. The build
// draws them into the resource pack of every game whose players pick kits, for the game's kits and
// each map's own, one picture per team dye for a kit with items in team colors. Icons are
// tools/assets/items/<item>.png (drawn by make-assets.py), named by the item id without
// "minecraft:"; an item without one is left out of the picture.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kitItemId, kitPicturePath, pictureDyes, possibleTeams, teamColored, type GameConfig, type KitDef, type MapConfig } from "@minecade/minigame-core/config";
import { blankImage, decodePng, encodePng, type Image } from "../skins/png.ts";

const ICONS = fileURLToPath(new URL("../assets/items/", import.meta.url));
/** Icons are 16x16, drawn 4 times as large so they stay sharp in the form. */
const SCALE = 4;
const ICON = 16 * SCALE;
const GAP = 2 * SCALE;
/** The count's digits: 3x5 pixels each, drawn at SCALE, with a shadow one pixel down and right. */
const DIGITS = [
  "111101101101111",
  "010110010010111",
  "111001111100111",
  "111001111001111",
  "101101111001001",
  "111100111001111",
  "111100111101111",
  "111001001001001",
  "111101111101111",
  "111101111001111",
];
const DIGIT_WIDTH = 3;
const DIGIT_HEIGHT = 5;
const WHITE = [255, 255, 255, 255];
const SHADOW = [62, 62, 62, 255];

/** One kit's items for a picture: each item's icon file and its count. */
export interface PictureItem {
  icon: string;
  count: number;
}

/** The items of a kit that have an icon, for a player of this team dye (resolved like the kit's item ids). */
export function pictureItems(kit: KitDef, teamColor: string | undefined, hasIcon: (name: string) => boolean): PictureItem[] {
  return kit.items
    .map((item) => ({ icon: kitItemId(item, teamColor).replace(/^minecraft:/, ""), count: item.count ?? 1 }))
    .filter((item) => hasIcon(item.icon));
}

/** Draws a kit's picture: the icons in a row, counts over 1 in each one's bottom right corner. */
export function drawKitPicture(items: { icon: Image; count: number }[]): Image {
  const width = Math.max(1, items.length * (ICON + GAP) - GAP + SCALE);
  const picture = blankImage(width, ICON + SCALE);
  items.forEach(({ icon, count }, index) => {
    const left = index * (ICON + GAP);
    for (let y = 0; y < ICON; y++) {
      for (let x = 0; x < ICON; x++) {
        const from = (Math.floor(y / SCALE) * icon.width + Math.floor(x / SCALE)) * 4;
        if (icon.data[from + 3] > 0) put(picture, left + x, y, icon.data.subarray(from, from + 4));
      }
    }
    if (count > 1) drawCount(picture, String(count), left + ICON, ICON);
  });
  return picture;
}

/**
 * Writes the kit form's pictures into a game's built resource pack at `out`, for a game whose
 * players pick kits: the game's kits, then each of these maps' own. Returns how many it wrote.
 */
export async function addGameKitPictures(out: string, game: GameConfig, maps: { id: string; config: MapConfig }[]): Promise<number> {
  if (!game.kits?.select) return 0;
  const kits: { kit: KitDef; map?: string }[] = [];
  for (const kit of [game.kits.base, ...game.kits.list]) if (kit) kits.push({ kit });
  for (const map of maps) {
    const own = map.config.kits;
    for (const kit of [own?.base, ...(own?.list ?? [])]) if (kit) kits.push({ kit, map: map.id });
  }
  return addKitPictures(out, kits, game.teams ? possibleTeams(game.teams).map((team) => team.color) : []);
}

/** Writes these kits' pictures into a built resource pack at `out`, one per team dye for a kit in team colors. */
export async function addKitPictures(out: string, kits: { kit: KitDef; map?: string }[], teamColors: string[]): Promise<number> {
  const icons = new Map<string, Image>();
  const hasIcon = (name: string) => existsSync(join(ICONS, `${name}.png`));
  const iconOf = async (name: string) => {
    if (!icons.has(name)) icons.set(name, decodePng(await readFile(join(ICONS, `${name}.png`))));
    return icons.get(name)!;
  };
  let written = 0;
  for (const { kit, map } of kits) {
    const colored = teamColored(kit);
    const colors: (string | undefined)[] = colored ? (teamColors.length > 0 ? dyeColors(teamColors) : [undefined]) : [undefined];
    for (const teamColor of colors) {
      const items = await Promise.all(pictureItems(kit, teamColor, hasIcon).map(async (item) => ({ icon: await iconOf(item.icon), count: item.count })));
      if (items.length === 0) continue;
      const path = join(out, `${kitPicturePath(kit.id, { map, teamColor, colored })}.png`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, encodePng(drawKitPicture(items)));
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

function drawCount(picture: Image, text: string, right: number, bottom: number): void {
  const step = (DIGIT_WIDTH + 1) * SCALE;
  const left = right - text.length * step + SCALE;
  for (const [shade, offset] of [[SHADOW, SCALE], [WHITE, 0]] as const) {
    [...text].forEach((char, index) => {
      const glyph = DIGITS[Number(char)];
      for (let row = 0; row < DIGIT_HEIGHT; row++) {
        for (let column = 0; column < DIGIT_WIDTH; column++) {
          if (glyph[row * DIGIT_WIDTH + column] !== "1") continue;
          const x0 = left + index * step + column * SCALE + offset;
          const y0 = bottom - DIGIT_HEIGHT * SCALE + row * SCALE + offset;
          for (let y = 0; y < SCALE; y++) for (let x = 0; x < SCALE; x++) put(picture, x0 + x, y0 + y, shade);
        }
      }
    });
  }
}

function put(picture: Image, x: number, y: number, color: ArrayLike<number>): void {
  if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) return;
  picture.data.set([color[0], color[1], color[2], color[3]], (y * picture.width + x) * 4);
}
