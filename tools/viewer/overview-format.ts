// Select from above's picture of a world (overview.ts makes it; decodeOverview reads it, in Node or
// the browser, so nothing here uses Node): each block column's top block seen from above.
//
//   "MCOV"                      4 bytes
//   header length               32-bit little-endian
//   header                      JSON (OverviewHeader), then a 0 byte if needed to end on an even offset
//   tops                        width x depth 16-bit signed: each column's top block's y (NO_TOP: none)
//   blocks                      width x depth 16-bit: the top block, an index into the header's names
//
// Columns go row by row from the north west corner: x across, then z down (south). Every number is
// little-endian. The Panel gzips the file.

export const OVERVIEW_MAGIC = "MCOV";
/** Changed whenever the layout or what goes in it changes: cached pictures of another format are made again. */
export const OVERVIEW_FORMAT = 1;
/** A column with no block at all. */
export const NO_TOP = -32768;

export interface OverviewHeader {
  format: number;
  /** What the world's db\\ folder was when the picture was made. */
  stamp: string;
  /** The north west corner's block x and z: the picture covers every chunk the world has. */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** The lowest and highest top. */
  low: number;
  high: number;
  /** The top blocks' names (minecraft:grass_block), by index. */
  names: string[];
}

export interface Overview extends OverviewHeader {
  tops: Int16Array;
  blocks: Uint16Array;
}

export function decodeOverview(bytes: Uint8Array): Overview {
  const data = bytes.byteOffset % 2 === 0 ? bytes : bytes.slice();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== OVERVIEW_MAGIC) throw new Error("not a Select picture");
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(data.subarray(8, 8 + headerLength))) as OverviewHeader;
  if (header.format !== OVERVIEW_FORMAT) throw new Error(`a Select picture in format ${header.format}, where this reads ${OVERVIEW_FORMAT}`);
  let at = 8 + headerLength;
  at += at % 2;
  const count = header.width * header.depth;
  const tops = new Int16Array(data.buffer, data.byteOffset + at, count);
  const blocks = new Uint16Array(data.buffer, data.byteOffset + at + count * 2, count);
  return { ...header, tops, blocks };
}
