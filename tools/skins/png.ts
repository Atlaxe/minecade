// PNG files for the skin renders, with Node's zlib only: 8-bit RGBA out, 8-bit RGBA or RGB in.
import { crc32, deflateSync, inflateSync } from "node:zlib";

/** A picture as raw pixels: 4 bytes per pixel (red, green, blue, alpha), rows top to bottom. */
export interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

export function blankImage(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG of an image (8 bits per channel, RGBA, no filtering). */
export function encodePng(image: Image): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const stride = image.width * 4;
  const rows = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) rows.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** Reads an 8-bit RGBA or RGB PNG (not interlaced), as RGBA. */
export function decodePng(file: Uint8Array): Image {
  const bytes = Buffer.from(file);
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Buffer[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("ascii", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || (color !== 6 && color !== 2) || interlace !== 0) throw new Error("only 8-bit RGBA or RGB PNGs without interlacing");
      channels = color === 6 ? 4 : 3;
    } else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      pixels[y * stride + x] = (row[x] + unfilter(filter, left, up, upLeft)) & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2], 255], i * 4);
  return { width, height, data: rgba };
}

function unfilter(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toUpLeft = Math.abs(estimate - upLeft);
      return toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
    }
    default:
      throw new Error(`unknown PNG filter ${filter}`);
  }
}
