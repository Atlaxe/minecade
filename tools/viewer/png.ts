// PNG in every form Minecraft's block textures use, for the map viewer's looks: gray, RGB,
// palette, gray with alpha and RGBA; 1 to 16 bits; Adam7 interlacing; tRNS transparency
// (docs/spike-results.md, "Map viewer"). tools/skins/png.ts, which the build's pictures use, reads
// only 8-bit RGB(A) without interlacing.
import { inflateSync } from "node:zlib";
import type { Image } from "../skins/png.ts";

/** Adam7's passes: where each starts and how far apart its pixels are. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodeAnyPng(file: Uint8Array): Image {
  const bytes = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let depth = 8;
  let color = 6;
  let interlace = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const parts: Buffer[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === "IHDR") [width, height, depth, color, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9], body[12]];
    else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;
  }
  const channels = CHANNELS[color];
  if (!channels) throw new Error(`a PNG of color type ${color}`);
  const raw = inflateSync(Buffer.concat(parts));
  const data = new Uint8Array(width * height * 4);
  const bitsPerPixel = channels * depth;
  const step = Math.max(1, bitsPerPixel >> 3);
  const max = (1 << depth) - 1;
  let at = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const passWidth = Math.ceil((width - x0) / dx);
    const passHeight = Math.ceil((height - y0) / dy);
    if (passWidth <= 0 || passHeight <= 0) continue;
    const stride = Math.ceil((passWidth * bitsPerPixel) / 8);
    let previous = new Uint8Array(stride);
    for (let row = 0; row < passHeight; row++) {
      const filter = raw[at];
      const line = new Uint8Array(raw.subarray(at + 1, at + 1 + stride));
      at += 1 + stride;
      for (let i = 0; i < stride; i++) {
        line[i] = (line[i] + predict(filter, i >= step ? line[i - step] : 0, previous[i], i >= step ? previous[i - step] : 0)) & 0xff;
      }
      previous = line;
      for (let col = 0; col < passWidth; col++) {
        /** Sample n of this pixel as stored (0 to 2^depth - 1). */
        const stored = (n: number): number => {
          const index = col * channels + n;
          if (depth === 8) return line[index];
          if (depth === 16) return (line[index * 2] << 8) | line[index * 2 + 1];
          const bit = index * depth;
          return (line[bit >> 3] >> (8 - depth - (bit & 7))) & max;
        };
        /** Sample n scaled to 8 bits. */
        const sample = (n: number): number => (depth === 8 ? stored(n) : Math.round((stored(n) * 255) / max));
        /** Whether the pixel is tRNS's one see-through color (gray or RGB). */
        const clear = (samples: number): boolean => !!transparency && Array.from({ length: samples }, (_, i) => transparency.readUInt16BE(2 * i) === stored(i)).every(Boolean);
        const pixel = ((y0 + row * dy) * width + x0 + col * dx) * 4;
        if (color === 3) {
          const index = stored(0);
          data.set([palette?.[index * 3] ?? 0, palette?.[index * 3 + 1] ?? 0, palette?.[index * 3 + 2] ?? 0, transparency && index < transparency.length ? transparency[index] : 255], pixel);
        } else if (color === 0) data.set([sample(0), sample(0), sample(0), clear(1) ? 0 : 255], pixel);
        else if (color === 4) data.set([sample(0), sample(0), sample(0), sample(1)], pixel);
        else if (color === 2) data.set([sample(0), sample(1), sample(2), clear(3) ? 0 : 255], pixel);
        else data.set([sample(0), sample(1), sample(2), sample(3)], pixel);
      }
    }
  }
  return { width, height, data };
}

function predict(filter: number, left: number, above: number, corner: number): number {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return above;
    case 3:
      return (left + above) >> 1;
    case 4: {
      const p = left + above - corner;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - above);
      const pc = Math.abs(p - corner);
      return pa <= pb && pa <= pc ? left : pb <= pc ? above : corner;
    }
    default:
      return 0;
  }
}
