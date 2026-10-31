// A small PNG reader and writer for the camera's pictures (screenshot.ts): 8-bit RGB and RGBA, not
// interlaced, which is what the Xbox Game Bar and Windows' screenshot keys save. The repo has no
// image library, and these are all a map preview needs: read, crop to 16:9, scale down, write.
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Pixels, 4 bytes each (red, green, blue, alpha), row by row. */
export interface Picture {
  width: number;
  height: number;
  data: Uint8Array;
}

export function decodePng(file: Uint8Array): Picture {
  const buffer = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG file");
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  for (let at = 8; at + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("latin1", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      channels = color === 2 ? 3 : color === 6 ? 4 : 0;
      if (depth !== 8 || channels === 0 || interlace !== 0) {
        throw new Error(`this PNG is ${depth}-bit, color type ${color}${interlace ? ", interlaced" : ""}: only 8-bit RGB or RGBA screenshots are read`);
      }
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
  }
  if (width === 0 || height === 0) throw new Error("the PNG has no image header");
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("the PNG's image data is cut short");
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : undefined;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? out[i - channels] : 0;
      const above = up ? up[i] : 0;
      const corner = up && i >= channels ? up[i - channels] : 0;
      out[i] = (line[i] + predict(filter, left, above, corner)) & 0xff;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    pixels[p * 4] = rows[p * channels];
    pixels[p * 4 + 1] = rows[p * channels + 1];
    pixels[p * 4 + 2] = rows[p * channels + 2];
    pixels[p * 4 + 3] = channels === 4 ? rows[p * channels + 3] : 255;
  }
  return { width, height, data: pixels };
}

/** An opaque picture as an RGB PNG (alpha is dropped). */
export function encodePng(picture: Picture): Buffer {
  const { width, height, data } = picture;
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    // Each row as differences from the one above (filter 2, "up"), which compresses photos well.
    raw[y * (stride + 1)] = 2;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const value = data[(y * width + x) * 4 + c];
        const above = y > 0 ? data[((y - 1) * width + x) * 4 + c] : 0;
        raw[y * (stride + 1) + 1 + x * 3 + c] = (value - above) & 0xff;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** The largest middle part of the picture with this shape (16:9 for 16, 9). */
export function cropToAspect(picture: Picture, wide: number, high: number): Picture {
  const { width, height } = picture;
  const fit = Math.min(width / wide, height / high);
  const w = Math.max(1, Math.round(wide * fit));
  const h = Math.max(1, Math.round(high * fit));
  const left = Math.floor((width - w) / 2);
  const top = Math.floor((height - h) / 2);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(picture.data.subarray(((top + y) * width + left) * 4, ((top + y) * width + left + w) * 4), y * w * 4);
  return { width: w, height: h, data };
}

/** Scales a picture down, each new pixel the average of the old ones it covers. */
export function scaleDown(picture: Picture, width: number, height: number): Picture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * picture.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * picture.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * picture.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * picture.width) / width));
      const sum = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) for (let c = 0; c < 4; c++) sum[c] += picture.data[(sy * picture.width + sx) * 4 + c];
      }
      const count = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = Math.round(sum[c] / count);
    }
  }
  return { width, height, data };
}

/** A filter's prediction for one byte (PNG's None, Sub, Up, Average and Paeth). */
function predict(filter: number, left: number, above: number, corner: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return above;
    case 3:
      return (left + above) >> 1;
    case 4: {
      const estimate = left + above - corner;
      const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - above), Math.abs(estimate - corner)];
      return a <= b && a <= c ? left : b <= c ? above : corner;
    }
    default:
      throw new Error(`the PNG has an unknown row filter (${filter})`);
  }
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
