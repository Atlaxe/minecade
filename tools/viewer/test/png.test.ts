import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeAnyPng } from "../png.ts";

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

interface Spec {
  width: number;
  height: number;
  color: 0 | 2 | 3 | 4 | 6;
  depth: 1 | 2 | 4 | 8 | 16;
  interlace?: boolean;
  /** Each row filtered with filter (row % 5), else none. */
  filters?: boolean;
  palette?: number[][];
  transparency?: Buffer;
  /** A pixel's samples as stored (0 to 2^depth - 1). */
  samples: (x: number, y: number) => number[];
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A PNG as an encoder writes one: rows packed MSB first, interlaced by Adam7 if asked. */
function encode(spec: Spec): Buffer {
  const channels = CHANNELS[spec.color];
  const bits = channels * spec.depth;
  const step = Math.max(1, bits >> 3);
  const rows: Buffer[] = [];
  let rowNumber = 0;
  for (const [x0, y0, dx, dy] of spec.interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const width = Math.ceil((spec.width - x0) / dx);
    const height = Math.ceil((spec.height - y0) / dy);
    if (width <= 0 || height <= 0) continue;
    const stride = Math.ceil((width * bits) / 8);
    let previous = Buffer.alloc(stride);
    for (let row = 0; row < height; row++) {
      const line = Buffer.alloc(stride);
      for (let col = 0; col < width; col++) {
        spec.samples(x0 + col * dx, y0 + row * dy).forEach((sample, n) => {
          const index = col * channels + n;
          if (spec.depth === 16) line.writeUInt16BE(sample, index * 2);
          else if (spec.depth === 8) line[index] = sample;
          else line[(index * spec.depth) >> 3] |= sample << (8 - spec.depth - ((index * spec.depth) & 7));
        });
      }
      const filter = spec.filters ? rowNumber % 5 : 0;
      const out = Buffer.alloc(stride);
      for (let i = 0; i < stride; i++) {
        const left = i >= step ? line[i - step] : 0;
        const above = previous[i];
        const corner = i >= step ? previous[i - step] : 0;
        const p = left + above - corner;
        const predictor = [0, left, above, (left + above) >> 1, Math.abs(p - left) <= Math.abs(p - above) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - above) <= Math.abs(p - corner) ? above : corner][filter];
        out[i] = (line[i] - predictor) & 0xff;
      }
      rows.push(Buffer.from([filter]), out);
      previous = line;
      rowNumber++;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(spec.width, 0);
  header.writeUInt32BE(spec.height, 4);
  header.set([spec.depth, spec.color, 0, 0, spec.interlace ? 1 : 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(spec.palette ? [chunk("PLTE", Buffer.from(spec.palette.flat()))] : []),
    ...(spec.transparency ? [chunk("tRNS", spec.transparency)] : []),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pixel = (data: Uint8Array, width: number, x: number, y: number) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

describe("decodeAnyPng", () => {
  it("reads 8-bit RGBA, every row filter", () => {
    const samples = (x: number, y: number) => [x * 20, y * 30, (x * y) % 256, 255 - x];
    const image = decodeAnyPng(encode({ width: 9, height: 7, color: 6, depth: 8, filters: true, samples }));
    expect(image).toMatchObject({ width: 9, height: 7 });
    for (const [x, y] of [[0, 0], [8, 6], [3, 4]]) expect(pixel(image.data, 9, x, y)).toEqual(samples(x, y));
  });

  it("reads RGB with a tRNS color as see-through", () => {
    const image = decodeAnyPng(encode({ width: 2, height: 1, color: 2, depth: 8, transparency: Buffer.from([0, 10, 0, 20, 0, 30]), samples: (x) => (x === 0 ? [10, 20, 30] : [1, 2, 3]) }));
    expect(pixel(image.data, 2, 0, 0)).toEqual([10, 20, 30, 0]);
    expect(pixel(image.data, 2, 1, 0)).toEqual([1, 2, 3, 255]);
  });

  it("reads a 2-bit palette with tRNS alphas", () => {
    const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]];
    const image = decodeAnyPng(encode({ width: 5, height: 3, color: 3, depth: 2, palette, transparency: Buffer.from([255, 128]), samples: (x, y) => [(x + y) % 4] }));
    expect(pixel(image.data, 5, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(image.data, 5, 1, 0)).toEqual([0, 255, 0, 128]);
    expect(pixel(image.data, 5, 4, 2)).toEqual([0, 0, 255, 255]);
    expect(pixel(image.data, 5, 2, 1)).toEqual([9, 9, 9, 255]);
  });

  it("scales gray of 1, 4 and 16 bits to 8, and reads gray with alpha", () => {
    expect(pixel(decodeAnyPng(encode({ width: 3, height: 1, color: 0, depth: 1, samples: (x) => [x % 2] })).data, 3, 1, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(decodeAnyPng(encode({ width: 3, height: 1, color: 0, depth: 4, samples: () => [5] })).data, 3, 2, 0)).toEqual([85, 85, 85, 255]);
    expect(pixel(decodeAnyPng(encode({ width: 1, height: 1, color: 0, depth: 16, samples: () => [65535] })).data, 1, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(decodeAnyPng(encode({ width: 2, height: 2, color: 4, depth: 8, samples: (x, y) => [100 + x, 50 * y] })).data, 2, 1, 1)).toEqual([101, 101, 101, 50]);
  });

  it("puts an interlaced image's pixels back in place", () => {
    const samples = (x: number, y: number) => [x * 10, y * 10, x + y, 255];
    for (const [width, height] of [[16, 16], [5, 7], [1, 1], [3, 9]]) {
      const image = decodeAnyPng(encode({ width, height, color: 6, depth: 8, interlace: true, filters: true, samples }));
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) expect(pixel(image.data, width, x, y)).toEqual(samples(x, y));
    }
  });

  it("refuses what isn't a PNG", () => {
    expect(() => decodeAnyPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a PNG/);
  });
});
