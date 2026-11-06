// The map viewer's view file: a map's world as the Panel sends it to its page to draw (view-file.ts
// makes it; decodeView reads it, in Node or the browser, so nothing here uses Node).
//
//   "MCVW"                      4 bytes
//   header length               32-bit little-endian
//   header                      JSON (ViewHeader), then a 0 byte if needed to end on an even offset
//   sections, each:             16-bit x, y, z (the section's place: world x >> 4, y >> 4, z >> 4),
//                               a flags byte (UNIFORM, WATER, WATER_UNIFORM), a 0 byte,
//                               the blocks: one 16-bit look id (UNIFORM) or 4096 of them,
//                               then, with WATER, layer 1 the same way
//
// Every number is little-endian, and every 16-bit array starts on an even offset, so the page can
// view them in place. In a section, blocks are at (x << 8) | (z << 4) | y, as Bedrock keeps them.
// Look 0 is air. The Panel gzips the file.

export const VIEW_MAGIC = "MCVW";
/** Changed whenever the layout or what goes in it changes: cached views of another format are made again. */
export const VIEW_FORMAT = 1;
/** The widest a map can be on x and z, in blocks. */
export const MAX_VIEW_WIDTH = 256;

export const UNIFORM = 1;
export const WATER = 2;
export const WATER_UNIFORM = 4;

export interface ViewBox {
  min: [x: number, y: number, z: number];
  max: [x: number, y: number, z: number];
}

/** A block as the viewer draws it: its name and only the states that change how it's drawn. */
export interface ViewLook {
  name: string;
  states?: Record<string, string | number>;
}

export interface ViewHeader {
  format: number;
  /** What the world's db\ folder was when the view was made (view-file.ts worldStamp). */
  stamp: string;
  /** The box the blocks fill. */
  box: ViewBox;
  looks: ViewLook[];
  sections: number;
}

export interface ViewSection {
  /** The section's place: world x >> 4, y >> 4, z >> 4. */
  x: number;
  y: number;
  z: number;
  /** Look ids at (x << 8) | (z << 4) | y, or one look for the whole section. */
  blocks: Uint16Array | number;
  /** Layer 1 (mostly water in waterlogged blocks), the same way, when the section has any. */
  water?: Uint16Array | number;
}

export interface View extends ViewHeader {
  list: ViewSection[];
}

export function decodeView(bytes: Uint8Array): View {
  // 16-bit arrays are viewed in place, which needs the bytes on an even offset.
  const data = bytes.byteOffset % 2 === 0 ? bytes : bytes.slice();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== VIEW_MAGIC) throw new Error("not a map viewer view file");
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(data.subarray(8, 8 + headerLength))) as ViewHeader;
  if (header.format !== VIEW_FORMAT) throw new Error(`a view file in format ${header.format}, where this reads ${VIEW_FORMAT}`);
  let at = 8 + headerLength;
  at += at % 2;
  const list: ViewSection[] = [];
  const layer = (uniform: boolean): Uint16Array | number => {
    if (uniform) {
      const look = view.getUint16(at, true);
      at += 2;
      return look;
    }
    const blocks = new Uint16Array(data.buffer, data.byteOffset + at, 4096);
    at += 8192;
    return blocks;
  };
  for (let n = 0; n < header.sections; n++) {
    const x = view.getInt16(at, true);
    const y = view.getInt16(at + 2, true);
    const z = view.getInt16(at + 4, true);
    const flags = data[at + 6];
    at += 8;
    const blocks = layer((flags & UNIFORM) !== 0);
    const water = flags & WATER ? layer((flags & WATER_UNIFORM) !== 0) : undefined;
    list.push({ x, y, z, blocks, ...(water !== undefined ? { water } : {}) });
  }
  return { ...header, list };
}

/** A section's look at a block inside it (0 to 15 on each axis). */
export function lookAt(layer: Uint16Array | number, x: number, y: number, z: number): number {
  return typeof layer === "number" ? layer : layer[(x << 8) | (z << 4) | y];
}
