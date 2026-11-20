// The Colors tool's swatches, 16x16 pictures in the editor's resource pack, in a dark frame that
// keeps them apart from the button's gray: each biome's (BIOME_COLORS) at biomeSwatchTexture(id),
// its foliage over its grass over its water, for the Biome list; and each color a biome has, whole,
// at colorSwatchTexture(color), for the Water, Grass and Foliage lists.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BIOME_COLORS, COLOR_PARTS, biomeSwatchTexture, colorSwatchTexture, type BiomeColors } from "@minecade/minigame-core/config";
import { blankImage, encodePng, type Image } from "../skins/png.ts";

const SIZE = 16;
const FRAME = "#1E1E22";
/** A biome swatch's bands, by their last row (inside the frame): foliage to row 5, grass to row 10, water to row 14. */
const BANDS: { part: "foliage" | "grass" | "water"; to: number }[] = [
  { part: "foliage", to: 5 },
  { part: "grass", to: 10 },
  { part: "water", to: 14 },
];

/** A biome's swatch: its three colors in bands. */
export function biomeSwatch(biome: Pick<BiomeColors, "water" | "grass" | "foliage">): Image {
  return framed((y) => biome[BANDS.find((band) => y <= band.to)?.part ?? "water"]);
}

/** One color's swatch. */
export function colorSwatch(color: string): Image {
  return framed(() => color);
}

/** Writes every swatch into the resource pack at `pack`. */
export async function addBiomeSwatches(pack: string): Promise<void> {
  const write = async (texture: string, image: Image) => {
    const path = join(pack, `${texture}.png`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encodePng(image));
  };
  for (const biome of BIOME_COLORS) await write(biomeSwatchTexture(biome.id), biomeSwatch(biome));
  const colors = new Set(BIOME_COLORS.flatMap((biome) => COLOR_PARTS.map((part) => biome[part])));
  for (const color of colors) await write(colorSwatchTexture(color), colorSwatch(color));
}

/** A swatch: the frame, and inside it each row in `colorOf(row)`. */
function framed(colorOf: (row: number) => string): Image {
  const image = blankImage(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const edge = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
      image.data.set([...rgb(edge ? FRAME : colorOf(y)), 255], (y * SIZE + x) * 4);
    }
  }
  return image;
}

function rgb(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
