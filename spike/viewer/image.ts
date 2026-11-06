// Block textures as RGBA pixels: PNG in every form Minecraft's packs use (gray, RGB, palette,
// gray with alpha, RGBA; 1 to 16 bits; Adam7 interlacing; tRNS transparency) and TGA (true color
// or gray, plain or run-length coded). tools/editor/png.ts reads only 8-bit RGB(A) screenshots.
import { crc32, deflateSync, inflateSync } from "node:zlib";

/** A picture as an RGBA PNG. */
export function encodeRgbaPng(picture: Picture): Buffer {
  const stride = picture.width * 4;
  const raw = Buffer.alloc(picture.height * (stride + 1));
  for (let y = 0; y < picture.height; y++) raw.set(picture.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(picture.width, 0);
  header.writeUInt32BE(picture.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export interface Picture {
  width: number;
  height: number;
  /** 4 bytes a pixel: red, green, blue, alpha, row by row from the top. */
  data: Uint8Array;
}

export function decodeImage(file: Uint8Array, name = ""): Picture {
  const buffer = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buffer.readUInt32BE(0) === 0x89504e47) return decodePng(buffer);
  if (name.endsWith(".tga") || [2, 3, 10, 11].includes(buffer[2])) return decodeTga(buffer);
  throw new Error(`${name}: neither a PNG nor a TGA`);
}

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

function decodePng(buffer: Buffer): Picture {
  let width = 0;
  let height = 0;
  let depth = 8;
  let color = 6;
  let interlace = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("latin1", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === "IHDR") [width, height, depth, color, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9], body[12]];
    else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color] ?? 0;
  if (!channels) throw new Error(`a PNG of color type ${color}`);
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  const bitsPerPixel = channels * depth;
  const step = Math.max(1, bitsPerPixel >> 3);
  const max = (1 << depth) - 1;
  let at = 0;
  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];
  for (const [x0, y0, dx, dy] of passes) {
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
        const left = i >= step ? line[i - step] : 0;
        const above = previous[i];
        const corner = i >= step ? previous[i - step] : 0;
        line[i] = (line[i] + predict(filter, left, above, corner)) & 0xff;
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
        const clear = (n: number): boolean => !!transparency && Array.from({ length: n }, (_, i) => transparency.readUInt16BE(2 * i) === stored(i)).every(Boolean);
        const pixel = ((y0 + row * dy) * width + x0 + col * dx) * 4;
        let rgba: [number, number, number, number];
        if (color === 3) {
          const index = stored(0);
          rgba = [palette![index * 3], palette![index * 3 + 1], palette![index * 3 + 2], transparency && index < transparency.length ? transparency[index] : 255];
        } else if (color === 0) rgba = [sample(0), sample(0), sample(0), clear(1) ? 0 : 255];
        else if (color === 4) rgba = [sample(0), sample(0), sample(0), sample(1)];
        else if (color === 2) rgba = [sample(0), sample(1), sample(2), clear(3) ? 0 : 255];
        else rgba = [sample(0), sample(1), sample(2), sample(3)];
        out.set(rgba, pixel);
      }
    }
  }
  return { width, height, data: out };
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

function decodeTga(buffer: Buffer): Picture {
  const idLength = buffer[0];
  const type = buffer[2];
  const colorMapLength = buffer.readUInt16LE(5);
  const colorMapDepth = buffer[7];
  const width = buffer.readUInt16LE(12);
  const height = buffer.readUInt16LE(14);
  const depth = buffer[16];
  const topDown = (buffer[17] & 0x20) !== 0;
  const bytes = depth >> 3;
  let at = 18 + idLength + Math.ceil((colorMapLength * colorMapDepth) / 8);
  const pixels = width * height;
  const flat = new Uint8Array(pixels * bytes);
  if (type === 2 || type === 3) flat.set(buffer.subarray(at, at + pixels * bytes));
  else if (type === 10 || type === 11) {
    for (let p = 0; p < pixels; ) {
      const header = buffer[at++];
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        const value = buffer.subarray(at, at + bytes);
        at += bytes;
        for (let i = 0; i < count; i++) flat.set(value, (p + i) * bytes);
      } else {
        flat.set(buffer.subarray(at, at + count * bytes), p * bytes);
        at += count * bytes;
      }
      p += count;
    }
  } else throw new Error(`a TGA of type ${type}`);
  const data = new Uint8Array(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    const row = Math.floor(p / width);
    const target = ((topDown ? row : height - 1 - row) * width + (p % width)) * 4;
    const s = p * bytes;
    if (bytes === 1) data.set([flat[s], flat[s], flat[s], 255], target);
    else data.set([flat[s + 2], flat[s + 1], flat[s], bytes === 4 ? flat[s + 3] : 255], target);
  }
  return { width, height, data };
}
