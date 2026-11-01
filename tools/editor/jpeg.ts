// A small JPEG reader for the camera's pictures (screenshot.ts): baseline JPEGs, 8-bit and Huffman
// coded, gray or YCbCr with any chroma sampling and restart markers, which is what Minecraft
// Bedrock's screenshot key saves. Like png.ts it's hand-written because the repo has no image library.
import type { Picture } from "./png.ts";

/** Where each of a block's 64 coefficients goes (row by row), in the zigzag order they're stored in. */
const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42,
  49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

/** The inverse DCT's basis: COSINES[x * 8 + u] is what frequency u adds at position x. */
const COSINES = Float64Array.from({ length: 64 }, (_, i) => {
  const [x, u] = [i >> 3, i & 7];
  return ((u === 0 ? Math.SQRT1_2 : 1) / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
});

interface Component {
  id: number;
  /** Sampling factors: how many blocks across and down it has in each MCU. */
  h: number;
  v: number;
  quant: number;
  /** Its samples, decoded in whole blocks and so `stride` wide. */
  samples: Uint8ClampedArray;
  stride: number;
  /** The last block's DC coefficient, which the next one is coded as a difference from. */
  dc: number;
}

interface Frame {
  width: number;
  height: number;
  hMax: number;
  vMax: number;
  mcusAcross: number;
  mcusDown: number;
  components: Component[];
}

export function decodeJpeg(file: Uint8Array): Picture {
  if (file[0] !== 0xff || file[1] !== 0xd8) throw new Error("not a JPEG file");
  const quantTables: Uint16Array[] = [];
  const huffmanTables: Uint16Array[] = []; // DC tables 0-3, then AC tables 0-3
  let frame: Frame | undefined;
  let restartInterval = 0;
  let scans = 0;
  for (let at = 2; at + 1 < file.length; ) {
    const marker = file[at + 1];
    // Between segments there can be fill bytes, and after a scan, the last few bytes of its data.
    if (file[at] !== 0xff || marker === 0xff || marker === 0) {
      at++;
      continue;
    }
    at += 2;
    if (marker === 0xd9) break; // end of image
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) continue; // markers with no segment
    const length = (file[at] << 8) | file[at + 1];
    if (length < 2 || at + length > file.length) throw new Error("the JPEG is cut short");
    const body = file.subarray(at + 2, at + length);
    at += length;
    if (marker === 0xdb) {
      for (let i = 0; i < body.length; ) {
        const wide = body[i] >> 4 === 1; // 16-bit values
        const table = new Uint16Array(64);
        for (let k = 0; k < 64; k++) table[k] = wide ? (body[i + 1 + k * 2] << 8) | body[i + 2 + k * 2] : body[i + 1 + k];
        quantTables[body[i] & 3] = table;
        i += wide ? 129 : 65;
      }
    } else if (marker === 0xc4) {
      for (let i = 0; i < body.length; ) {
        const counts = body.subarray(i + 1, i + 17);
        const total = counts.reduce((sum, n) => sum + n, 0);
        huffmanTables[(body[i] >> 4 ? 4 : 0) + (body[i] & 3)] = huffmanTable(counts, body.subarray(i + 17, i + 17 + total));
        i += 17 + total;
      }
    } else if (marker === 0xdd) {
      restartInterval = (body[0] << 8) | body[1];
    } else if (marker === 0xc0 || marker === 0xc1) {
      frame = readFrame(body);
    } else if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const kind = (marker & 3) === 2 ? "progressive" : (marker & 3) === 3 ? "lossless" : marker & 8 ? "arithmetic coded" : "hierarchical";
      throw new Error(`this JPEG is ${kind}: only baseline screenshots are read`);
    } else if (marker === 0xda) {
      if (!frame) throw new Error("the JPEG has no image header");
      at = decodeScan(file, at, body, frame, quantTables, huffmanTables, restartInterval);
      scans++;
    }
    // Anything else (JFIF and Exif headers, comments) is skipped.
  }
  if (!frame) throw new Error("the JPEG has no image header");
  if (scans === 0) throw new Error("the JPEG has no image data");
  return toPicture(frame);
}

function readFrame(body: Uint8Array): Frame {
  const precision = body[0];
  const height = (body[1] << 8) | body[2];
  const width = (body[3] << 8) | body[4];
  const count = body[5];
  if (precision !== 8) throw new Error(`this JPEG is ${precision}-bit: only 8-bit screenshots are read`);
  if (count !== 1 && count !== 3) throw new Error(`this JPEG has ${count} color components: only gray or YCbCr screenshots are read`);
  if (width === 0 || height === 0) throw new Error("the JPEG's image header has no size");
  const parts = [];
  for (let i = 0; i < count; i++) {
    const [id, h, v, quant] = [body[6 + i * 3], body[7 + i * 3] >> 4, body[7 + i * 3] & 15, body[8 + i * 3] & 3];
    if (h < 1 || h > 4 || v < 1 || v > 4) throw new Error(`the JPEG's sampling factors (${h}x${v}) are out of range`);
    parts.push({ id, h, v, quant });
  }
  const hMax = Math.max(...parts.map((p) => p.h));
  const vMax = Math.max(...parts.map((p) => p.v));
  const mcusAcross = Math.ceil(width / (8 * hMax));
  const mcusDown = Math.ceil(height / (8 * vMax));
  const components = parts.map((p) => {
    const stride = mcusAcross * p.h * 8;
    return { ...p, samples: new Uint8ClampedArray(stride * mcusDown * p.v * 8), stride, dc: 0 };
  });
  return { width, height, hMax, vMax, mcusAcross, mcusDown, components };
}

/** Decodes the scan whose data starts at `start`, and returns where its data ends. */
function decodeScan(
  file: Uint8Array,
  start: number,
  body: Uint8Array,
  frame: Frame,
  quantTables: Uint16Array[],
  huffmanTables: Uint16Array[],
  restartInterval: number,
): number {
  const scan = [];
  for (let i = 0; i < body[0]; i++) {
    const component = frame.components.find((c) => c.id === body[1 + i * 2]);
    if (!component) throw new Error(`the JPEG's scan has a component (${body[1 + i * 2]}) its image header doesn't`);
    const dcTable = huffmanTables[(body[2 + i * 2] >> 4) & 3];
    const acTable = huffmanTables[4 + (body[2 + i * 2] & 3)];
    const quant = quantTables[component.quant];
    if (!dcTable || !acTable) throw new Error("the JPEG is missing a Huffman table");
    if (!quant) throw new Error("the JPEG is missing a quantization table");
    component.dc = 0;
    scan.push({ component, dcTable, acTable, quant });
  }
  // A scan of one component goes block by block over just that component; otherwise MCU by MCU.
  const single = scan.length === 1 ? scan[0].component : undefined;
  const across = single ? Math.ceil(Math.ceil((frame.width * single.h) / frame.hMax) / 8) : frame.mcusAcross;
  const down = single ? Math.ceil(Math.ceil((frame.height * single.v) / frame.vMax) / 8) : frame.mcusDown;
  const reader = new BitReader(file, start);
  const block = new Int32Array(64);
  const rows = new Float64Array(64);
  for (let mcu = 0; mcu < across * down; mcu++) {
    if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
      reader.restart();
      for (const { component } of scan) component.dc = 0;
    }
    const mcuX = mcu % across;
    const mcuY = (mcu - mcuX) / across;
    for (const { component, dcTable, acTable, quant } of scan) {
      const h = single ? 1 : component.h;
      const v = single ? 1 : component.v;
      for (let y = 0; y < v; y++) {
        for (let x = 0; x < h; x++) {
          decodeBlock(reader, component, dcTable, acTable, quant, block);
          idct(block, rows, component.samples, ((mcuY * v + y) * component.stride + mcuX * h + x) * 8, component.stride);
        }
      }
    }
  }
  return reader.at;
}

/** Reads one block's coefficients, already multiplied back up by the quantization table. */
function decodeBlock(
  reader: BitReader,
  component: Component,
  dcTable: Uint16Array,
  acTable: Uint16Array,
  quant: Uint16Array,
  block: Int32Array,
): void {
  block.fill(0);
  const size = reader.huffman(dcTable);
  if (size > 11) throw new Error("the JPEG's image data is damaged");
  component.dc += reader.number(size);
  block[0] = component.dc * quant[0];
  for (let k = 1; k < 64; k++) {
    const symbol = reader.huffman(acTable);
    const zeros = symbol >> 4;
    if ((symbol & 15) === 0) {
      if (zeros === 15) {
        k += 15;
        continue;
      }
      break; // the rest of the block is zeros
    }
    k += zeros;
    if (k > 63) throw new Error("the JPEG's image data is damaged");
    block[ZIGZAG[k]] = reader.number(symbol & 15) * quant[k];
  }
}

/** Turns a block of coefficients into 8x8 samples: rows first, skipping the all-zero ones, then columns. */
function idct(block: Int32Array, rows: Float64Array, out: Uint8ClampedArray, at: number, stride: number): void {
  let used = 0;
  for (let v = 0; v < 8; v++) {
    let zero = true;
    for (let u = 0; u < 8; u++) if (block[v * 8 + u] !== 0) zero = false;
    if (zero) {
      rows.fill(0, v * 8, v * 8 + 8);
      continue;
    }
    used = v + 1;
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) sum += block[v * 8 + u] * COSINES[x * 8 + u];
      rows[v * 8 + x] = sum;
    }
  }
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 128;
      for (let v = 0; v < used; v++) sum += rows[v * 8 + x] * COSINES[y * 8 + v];
      out[at + y * stride + x] = sum;
    }
  }
}

/** A Huffman table as a lookup on the next 16 bits: (code length << 8) | symbol, or 0 where no code starts. */
function huffmanTable(counts: Uint8Array, symbols: Uint8Array): Uint16Array {
  const table = new Uint16Array(1 << 16);
  let code = 0;
  let next = 0;
  for (let length = 1; length <= 16; length++, code <<= 1) {
    for (let i = 0; i < counts[length - 1]; i++, code++) {
      if (code >= 1 << length) throw new Error("the JPEG has a broken Huffman table");
      const span = 1 << (16 - length);
      table.fill((length << 8) | symbols[next++], code * span, (code + 1) * span);
    }
  }
  return table;
}

/** Reads a scan's data a few bits at a time, dropping the zero byte stuffed after each 0xff. */
class BitReader {
  private readonly file: Uint8Array;
  at: number;
  private bits = 0; // the low `count` bits are the next ones
  private count = 0;

  constructor(file: Uint8Array, at: number) {
    this.file = file;
    this.at = at;
  }

  huffman(table: Uint16Array): number {
    if (this.count < 16) this.fill();
    const entry = table[(this.bits >>> (this.count - 16)) & 0xffff];
    if (entry === 0) throw new Error("the JPEG's image data is damaged");
    this.count -= entry >> 8;
    return entry & 0xff;
  }

  /** A `size`-bit signed number: the low half of each size's range is its negative values. */
  number(size: number): number {
    if (size === 0) return 0;
    if (this.count < size) this.fill();
    this.count -= size;
    const value = (this.bits >>> this.count) & ((1 << size) - 1);
    return value < 1 << (size - 1) ? value - (1 << size) + 1 : value;
  }

  /** Skips past the restart marker that ends an interval, where coding starts over on a fresh byte. */
  restart(): void {
    this.bits = this.count = 0;
    while (this.at + 1 < this.file.length && !(this.file[this.at] === 0xff && (this.file[this.at + 1] & 0xf8) === 0xd0)) this.at++;
    this.at += 2;
  }

  private fill(): void {
    while (this.count <= 24) {
      let byte = 0;
      if (this.file[this.at] !== 0xff) {
        if (this.at >= this.file.length) throw new Error("the JPEG's image data is cut short");
        byte = this.file[this.at++];
      } else if (this.file[this.at + 1] === 0) {
        byte = 0xff;
        this.at += 2;
      } // otherwise it's a marker: the data has ended, and zeros stand in for what's past it
      this.bits = (this.bits << 8) | byte;
      this.count += 8;
    }
  }
}

/** The picture in RGBA: each component brought to full size, then YCbCr (or gray) turned into RGB. */
function toPicture(frame: Frame): Picture {
  const { width, height } = frame;
  const [luma, blue, red] = frame.components.map((c) => fullSize(c, frame));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      const l = luma.samples[y * luma.stride + x];
      const cb = blue ? blue.samples[y * blue.stride + x] - 128 : 0;
      const cr = red ? red.samples[y * red.stride + x] - 128 : 0;
      out[i] = l + 1.402 * cr;
      out[i + 1] = l - 0.344136 * cb - 0.714136 * cr;
      out[i + 2] = l + 1.772 * cb;
      out[i + 3] = 255;
    }
  }
  return { width, height, data: new Uint8Array(out.buffer) };
}

/**
 * A component's samples at the picture's size. One with fewer samples is spread out by bilinear
 * interpolation between sample centers, which is what libjpeg's "fancy" upsampling does for 2x.
 */
function fullSize(c: Component, frame: Frame): { samples: Uint8ClampedArray; stride: number } {
  const { width, height, hMax, vMax } = frame;
  if (c.h === hMax && c.v === vMax) return c;
  const across = taps(width, Math.ceil((width * c.h) / hMax), c.h / hMax);
  const down = taps(height, Math.ceil((height * c.v) / vMax), c.v / vMax);
  const samples = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const top = down.near[y] * c.stride;
    const bottom = down.far[y] * c.stride;
    for (let x = 0; x < width; x++) {
      const near = across.near[x];
      const far = across.far[x];
      const upper = c.samples[top + near] + (c.samples[top + far] - c.samples[top + near]) * across.weight[x];
      const lower = c.samples[bottom + near] + (c.samples[bottom + far] - c.samples[bottom + near]) * across.weight[x];
      samples[y * width + x] = upper + (lower - upper) * down.weight[y];
    }
  }
  return { samples, stride: width };
}

/**
 * For each of `size` pixels, the two of `count` samples (spaced 1 / `scale` pixels apart) on either side
 * of its center, and how far along it is from the first to the second.
 */
function taps(size: number, count: number, scale: number): { near: Int32Array; far: Int32Array; weight: Float64Array } {
  const near = new Int32Array(size);
  const far = new Int32Array(size);
  const weight = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const at = Math.min(Math.max((i + 0.5) * scale - 0.5, 0), count - 1);
    near[i] = Math.floor(at);
    far[i] = Math.min(near[i] + 1, count - 1);
    weight[i] = at - near[i];
  }
  return { near, far, weight };
}
