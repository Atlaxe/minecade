// The game's Minecraft Ten font as pixels, for the numbers on Block Party's die model
// (tools/blockparty/dice-model.ts). Minecraft Ten is a pixel font drawn on a grid: every outline
// point of a letter or digit sits on a 70-unit step, starting 50 units in from the left, so a digit
// is 7 pixels wide and 10 high (hence "Ten"). This reads the TrueType file's outlines (glyf, loca
// and cmap tables) and fills each grid square whose middle is inside them. The font is Mojang's, so
// it is never copied into the repo: the dice tool reads it from Minecraft on this PC
// (resource_packs/vanilla/font/minecraft-ten.ttf), or from MINECRAFT_TEN.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VANILLA_PACK } from "../build/vanilla-textures.ts";

/** Where the font is: MINECRAFT_TEN, else the Windows client's vanilla pack. */
export const TEN_FONT = process.env.MINECRAFT_TEN ?? join(VANILLA_PACK, "font", "minecraft-ten.ttf");
/** One pixel of the font, in its units. */
const GRID = 70;
/** Where the pixel columns start (the left edge every glyph is drawn from). */
const LEFT = 50;
/** The rows read, in pixels from the baseline: 4 under it (descenders) to 14 over it (accents). */
const LOWEST_ROW = -4;
const HIGHEST_ROW = 14;
/** The pixel gap between two characters, and a space's width. */
const GAP = 1;
const SPACE = 3;

/** A glyph's pixels: `columns` wide, and the rows (pixels over the baseline, 0 the first) each filled column is in. */
export interface GlyphPixels {
  columns: number;
  /** Filled pixels as [column, row], row 0 the one sitting on the baseline, up positive. */
  filled: [number, number][];
}

/** Text as pixels: `width` x `height`, filled[row * width + column], rows top to bottom. */
export interface TextPixels {
  width: number;
  height: number;
  filled: boolean[];
}

type Point = [number, number];

export interface TenFont {
  glyph(char: string): GlyphPixels | undefined;
  text(text: string): TextPixels;
}

/** Reads the font file at `path` (TEN_FONT if left out). */
export function loadTenFont(path: string = TEN_FONT): TenFont {
  if (!existsSync(path)) throw new Error(`The Minecraft Ten font isn't at ${path}. Point MINECRAFT_TEN at minecraft-ten.ttf (Minecraft's resource_packs/vanilla/font folder).`);
  return readTenFont(readFileSync(path));
}

export function readTenFont(file: Uint8Array): TenFont {
  const data = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  const tables = new Map<string, number>();
  const count = data.readUInt16BE(4);
  for (let i = 0; i < count; i++) tables.set(data.toString("ascii", 12 + 16 * i, 16 + 16 * i), data.readUInt32BE(20 + 16 * i));
  const table = (tag: string): number => {
    const at = tables.get(tag);
    if (at === undefined) throw new Error(`the font has no ${tag} table`);
    return at;
  };
  const head = table("head");
  const longOffsets = data.readInt16BE(head + 50) === 1;
  const loca = table("loca");
  const glyf = table("glyf");
  const offsetOf = (glyph: number) => (longOffsets ? data.readUInt32BE(loca + 4 * glyph) : data.readUInt16BE(loca + 2 * glyph) * 2);
  const cmap = readCmap(data, table("cmap"));

  const outlines = (glyph: number): Point[][] => {
    const start = offsetOf(glyph);
    const end = offsetOf(glyph + 1);
    if (start === end) return [];
    let at = glyf + start;
    const contours = data.readInt16BE(at);
    if (contours < 0) throw new Error(`glyph ${glyph} is made of other glyphs, which this reader doesn't do`);
    at += 10;
    const ends: number[] = [];
    for (let i = 0; i < contours; i++) ends.push(data.readUInt16BE(at + 2 * i));
    at += 2 * contours;
    at += 2 + data.readUInt16BE(at);
    const points = ends.length ? ends[ends.length - 1] + 1 : 0;
    const flags: number[] = [];
    while (flags.length < points) {
      const flag = data[at++];
      flags.push(flag);
      if (flag & 8) for (let repeat = data[at++]; repeat > 0; repeat--) flags.push(flag);
    }
    const read = (short: number, same: number): number[] => {
      const values: number[] = [];
      let value = 0;
      for (const flag of flags) {
        if (flag & short) {
          const step = data[at++];
          value += flag & same ? step : -step;
        } else if (!(flag & same)) {
          value += data.readInt16BE(at);
          at += 2;
        }
        values.push(value);
      }
      return values;
    };
    const xs = read(2, 16);
    const ys = read(4, 32);
    const result: Point[][] = [];
    let first = 0;
    for (const last of ends) {
      const on: boolean[] = [];
      const contour: Point[] = [];
      for (let i = first; i <= last; i++) {
        contour.push([xs[i], ys[i]]);
        on.push((flags[i] & 1) === 1);
      }
      result.push(flatten(contour, on));
      first = last + 1;
    }
    return result;
  };

  const glyphs = new Map<string, GlyphPixels | undefined>();
  const glyph = (char: string): GlyphPixels | undefined => {
    if (glyphs.has(char)) return glyphs.get(char);
    const id = cmap.get(char.codePointAt(0) ?? 0);
    let pixels: GlyphPixels | undefined;
    if (id !== undefined && id !== 0) {
      const shape = outlines(id);
      const right = Math.max(LEFT, ...shape.flat().map(([x]) => x));
      const columns = Math.max(0, Math.round((right - LEFT) / GRID));
      const filled: [number, number][] = [];
      for (let column = 0; column < columns; column++) {
        for (let row = LOWEST_ROW; row < HIGHEST_ROW; row++) {
          if (inside(shape, LEFT + GRID * column + GRID / 2, GRID * row + GRID / 2)) filled.push([column, row]);
        }
      }
      pixels = { columns, filled };
    }
    glyphs.set(char, pixels);
    return pixels;
  };

  return fontOf(glyph);
}

/** A font from its glyphs: text set the way the game sets Minecraft Ten, each character's pixels side by side with a pixel between. */
export function fontOf(glyph: (char: string) => GlyphPixels | undefined): TenFont {
  return {
    glyph,
    text(text: string): TextPixels {
      const placed: [number, number][] = [];
      let x = 0;
      for (const char of text) {
        const pixels = char === " " ? undefined : glyph(char);
        if (!pixels || pixels.filled.length === 0) {
          x += SPACE + GAP;
          continue;
        }
        const left = Math.min(...pixels.filled.map(([column]) => column));
        const right = Math.max(...pixels.filled.map(([column]) => column));
        for (const [column, row] of pixels.filled) placed.push([x + column - left, row]);
        x += right - left + 1 + GAP;
      }
      if (placed.length === 0) return { width: 0, height: 0, filled: [] };
      const width = Math.max(...placed.map(([column]) => column)) + 1;
      const top = Math.max(...placed.map(([, row]) => row));
      const bottom = Math.min(...placed.map(([, row]) => row));
      const height = top - bottom + 1;
      const filled = new Array<boolean>(width * height).fill(false);
      for (const [column, row] of placed) filled[(top - row) * width + column] = true;
      return { width, height, filled };
    },
  };
}

// ---- The glyphs the dice use, kept in the repo ------------------------------------------------

/**
 * The glyphs the dice tool last read for the characters Block Party draws (every digit, and every
 * face's show text), so the build can draw a die's number on its icon in the item panel without the
 * font (it isn't on the server, and never goes in git). The dice tool writes it.
 */
export const GLYPH_FILE = fileURLToPath(new URL("./ten-glyphs.json", import.meta.url));

/** Every glyph `chars` need, from `font`, as the glyph file keeps them. */
export function glyphTable(font: TenFont, chars: Iterable<string>): Record<string, GlyphPixels> {
  const table: Record<string, GlyphPixels> = {};
  for (const char of [...new Set(chars)].sort()) {
    const pixels = char === " " ? undefined : font.glyph(char);
    if (pixels) table[char] = pixels;
  }
  return table;
}

/** The glyph file's font (undefined if the dice tool hasn't written one): characters it doesn't hold are blanks. */
export function storedFont(path: string = GLYPH_FILE): TenFont | undefined {
  if (!existsSync(path)) return undefined;
  const glyphs = (JSON.parse(readFileSync(path, "utf8")) as { glyphs?: Record<string, GlyphPixels> }).glyphs ?? {};
  return fontOf((char) => glyphs[char]);
}

/** The character to glyph table (format 4, the Basic Multilingual Plane). */
function readCmap(data: Buffer, cmap: number): Map<number, number> {
  const map = new Map<number, number>();
  const subtables = data.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const at = cmap + data.readUInt32BE(cmap + 8 + 8 * i);
    if (data.readUInt16BE(at) !== 4) continue;
    const segments = data.readUInt16BE(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + 2 * segments + 2;
    const deltas = starts + 2 * segments;
    const ranges = deltas + 2 * segments;
    for (let s = 0; s < segments; s++) {
      const end = data.readUInt16BE(ends + 2 * s);
      const start = data.readUInt16BE(starts + 2 * s);
      const delta = data.readInt16BE(deltas + 2 * s);
      const range = data.readUInt16BE(ranges + 2 * s);
      for (let code = start; code <= end && code !== 0xffff; code++) {
        let glyph: number;
        if (range === 0) glyph = (code + delta) & 0xffff;
        else {
          glyph = data.readUInt16BE(ranges + 2 * s + range + 2 * (code - start));
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        map.set(code, glyph);
      }
    }
    return map;
  }
  throw new Error("the font has no format 4 character table");
}

/** A contour's outline as straight lines: TrueType's curves (off-curve points) cut into short steps. */
function flatten(points: Point[], on: boolean[]): Point[] {
  if (on.every(Boolean)) return points;
  const out: Point[] = [];
  const n = points.length;
  // Start from an on-curve point (or the middle of two off-curve ones).
  let startAt = on.indexOf(true);
  let start: Point;
  if (startAt < 0) {
    start = mid(points[0], points[1 % n]);
    startAt = 0;
  } else start = points[startAt];
  out.push(start);
  let previous = start;
  for (let step = 1; step <= n; step++) {
    const i = (startAt + step) % n;
    if (on[i]) {
      out.push(points[i]);
      previous = points[i];
      continue;
    }
    const nextAt = (i + 1) % n;
    const end = on[nextAt] ? points[nextAt] : mid(points[i], points[nextAt]);
    for (let t = 1; t <= 8; t++) {
      const k = t / 8;
      out.push([
        (1 - k) * (1 - k) * previous[0] + 2 * (1 - k) * k * points[i][0] + k * k * end[0],
        (1 - k) * (1 - k) * previous[1] + 2 * (1 - k) * k * points[i][1] + k * k * end[1],
      ]);
    }
    previous = end;
    if (on[nextAt]) step++;
  }
  return out;
}

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Whether (x, y) is inside the outlines, by TrueType's rule (non-zero winding). */
function inside(contours: Point[][], x: number, y: number): boolean {
  let winding = 0;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const [x0, y0] = contour[i];
      const [x1, y1] = contour[(i + 1) % contour.length];
      if (y0 <= y) {
        if (y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) winding++;
      } else if (y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) winding--;
    }
  }
  return winding !== 0;
}
