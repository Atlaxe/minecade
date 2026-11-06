// Select from above (pass V.10), the Panel's side: a world's picture seen from above, and a view of
// the columns in a box of it, both read without a server and without changing the world.
// - The picture: each column's top block, found from the top down (each chunk's sub-chunks from the
//   highest, all-air ones skipped by their palette), since converted worlds have no height maps.
//   Blocks nobody sees from above (air, barriers, light blocks, structure voids, invisible bedrock)
//   are looked through. Kept in work\viewer\worlds\ under the world's stamp, as view files are.
// - A box's view: the view file (view-format.ts) of only the blocks in the box, for its height trim,
//   its picture from the side and its 3D look. Each takes the world's sub-chunks, which are kept in
//   memory for the world last used for a few minutes (reading a big world's tables takes about a second).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { allAir, BlockPalette, chunkKey, decodeSubChunk, isOverworldSubChunk } from "./subchunk.ts";
import { NO_TOP, OVERVIEW_FORMAT, OVERVIEW_MAGIC, type OverviewHeader } from "./overview-format.ts";
import { MAX_VIEW_WIDTH } from "./view-format.ts";
import { encodeView, viewOf, ViewError, worldStamp, type ViewClip } from "./view-file.ts";
import { readWorldDb } from "./world-reader.ts";

/** The most columns a picture may have (4096 x 4096): a world spread wider is refused. */
export const MAX_COLUMNS = 4096 * 4096;
/** Looked through from above. */
const SEE_THROUGH = /^minecraft:(air|structure_void|barrier|invisible_bedrock|light_block(_\d+)?|light)$/;
/** How long a world's sub-chunks stay in memory after their last use. */
const KEEP_MS = 5 * 60_000;
/** The world's height. */
export const MIN_Y = -64;
export const MAX_Y = 319;

let kept: { world: string; stamp: string; values: Map<string, Buffer>; timer?: ReturnType<typeof setTimeout> } | undefined;

/** A world's Overworld sub-chunks, from memory when it's the world last read and hasn't changed. */
export function worldSubChunks(world: string): { values: Map<string, Buffer>; stamp: string } {
  const db = join(world, "db");
  if (!existsSync(db)) throw new ViewError(`there's no world at ${world}`);
  const stamp = worldStamp(world);
  if (kept?.world !== world || kept.stamp !== stamp) {
    if (kept?.timer) clearTimeout(kept.timer);
    kept = { world, stamp, values: readWorldDb(db, isOverworldSubChunk).values };
  }
  if (kept.timer) clearTimeout(kept.timer);
  kept.timer = setTimeout(() => (kept = undefined), KEEP_MS);
  kept.timer.unref?.();
  return { values: kept.values, stamp };
}

export interface BuiltOverview {
  header: OverviewHeader;
  tops: Int16Array;
  blocks: Uint16Array;
}

/** A world's picture from above: every chunk it has, each column's top block and its height. */
export function buildOverview(values: Map<string, Buffer>, stamp: string): BuiltOverview {
  const chunks = new Map<string, { x: number; z: number; sections: { y: number; value: Buffer }[] }>();
  for (const [text, value] of values) {
    const key = chunkKey(Buffer.from(text, "latin1"))!;
    const id = `${key.x},${key.z}`;
    let chunk = chunks.get(id);
    if (!chunk) chunks.set(id, (chunk = { x: key.x, z: key.z, sections: [] }));
    chunk.sections.push({ y: key.y!, value });
  }
  if (chunks.size === 0) throw new ViewError("the world has no blocks");
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const { x, z } of chunks.values()) [minX, maxX, minZ, maxZ] = [Math.min(minX, x), Math.max(maxX, x), Math.min(minZ, z), Math.max(maxZ, z)];
  const width = (maxX - minX + 1) * 16;
  const depth = (maxZ - minZ + 1) * 16;
  if (width * depth > MAX_COLUMNS) throw new ViewError(`the world's chunks spread over ${width} by ${depth} blocks: Select from above shows worlds up to ${Math.sqrt(MAX_COLUMNS)} by ${Math.sqrt(MAX_COLUMNS)}`);
  const tops = new Int16Array(width * depth).fill(NO_TOP);
  const blocks = new Uint16Array(width * depth);
  const palette = new BlockPalette();
  /** Each palette id's name index, or -1 when it's looked through. */
  const nameOf: number[] = [];
  const names: string[] = [];
  const nameIds = new Map<string, number>();
  const nameIndex = (id: number) => {
    if (nameOf[id] === undefined) {
      const name = palette.blocks[id].name;
      if (SEE_THROUGH.test(name)) nameOf[id] = -1;
      else {
        let index = nameIds.get(name);
        if (index === undefined) nameIds.set(name, (index = names.push(name) - 1));
        nameOf[id] = index;
      }
    }
    return nameOf[id];
  };
  let [low, high] = [Infinity, -Infinity];
  for (const chunk of chunks.values()) {
    chunk.sections.sort((a, b) => b.y - a.y);
    let found = 0;
    const done = new Uint8Array(256);
    for (const { y: sectionY, value } of chunk.sections) {
      if (allAir(value, palette)) continue;
      const decoded = decodeSubChunk(value, palette);
      const sy = decoded.y ?? sectionY;
      const layer = decoded.layers[0];
      for (let lx = 0; lx < 16; lx++) {
        for (let lz = 0; lz < 16; lz++) {
          if (done[lx * 16 + lz]) continue;
          for (let ly = 15; ly >= 0; ly--) {
            const id = layer[(lx << 8) | (lz << 4) | ly];
            if (id === 0) continue;
            const index = nameIndex(id);
            if (index < 0) continue;
            const at = ((chunk.z - minZ) * 16 + lz) * width + (chunk.x - minX) * 16 + lx;
            const y = sy * 16 + ly;
            tops[at] = y;
            blocks[at] = index;
            [low, high] = [Math.min(low, y), Math.max(high, y)];
            done[lx * 16 + lz] = 1;
            found++;
            break;
          }
        }
      }
      if (found === 256) break;
    }
  }
  if (low === Infinity) [low, high] = [0, 0];
  return { header: { format: OVERVIEW_FORMAT, stamp, x: minX * 16, z: minZ * 16, width, depth, low, high, names }, tops, blocks };
}

/** A picture as the file's bytes (overview-format.ts), before gzip. */
export function encodeOverview({ header, tops, blocks }: BuiltOverview): Buffer {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  const parts: Buffer[] = [Buffer.from(OVERVIEW_MAGIC, "latin1"), length, json];
  if ((8 + json.length) % 2) parts.push(Buffer.alloc(1));
  parts.push(Buffer.from(tops.buffer, tops.byteOffset, tops.byteLength), Buffer.from(blocks.buffer, blocks.byteOffset, blocks.byteLength));
  return Buffer.concat(parts);
}

/** A world's cache folder in work\viewer\worlds\, by its path (two worlds can share a name). */
export function worldCacheDir(root: string, world: string): string {
  return join(root, "work", "viewer", "worlds", createHash("sha256").update(world.toLowerCase()).digest("hex").slice(0, 16));
}

/** The world's picture, gzipped, from its cache folder when the world hasn't changed, else made now. */
export function cachedOverview(world: string, cacheDir: string): { gzipped: Buffer; stamp: string; built: boolean } {
  const stamp = `${worldStamp(world)}-${OVERVIEW_FORMAT}`;
  const file = join(cacheDir, `${stamp}.overview.gz`);
  if (existsSync(file)) return { gzipped: readFileSync(file), stamp, built: false };
  const { values } = worldSubChunks(world);
  const gzipped = gzipSync(encodeOverview(buildOverview(values, stamp)));
  mkdirSync(cacheDir, { recursive: true });
  const partial = `${file}.${process.pid}.part`;
  writeFileSync(partial, gzipped);
  renameSync(partial, file);
  for (const name of readdirSync(cacheDir)) if (name !== `${stamp}.overview.gz` && name.endsWith(".overview.gz")) rmSync(join(cacheDir, name), { force: true });
  return { gzipped, stamp, built: true };
}

/** Select's box: x and z of its corner columns, and a floor and ceiling, all inclusive. */
export interface SelectBox {
  min: [x: number, y: number, z: number];
  max: [x: number, y: number, z: number];
}

/** Why a box can't be Select's, or undefined: whole numbers, at most MAX_VIEW_WIDTH across, within the world's height. */
export function selectBoxProblem(box: SelectBox): string | undefined {
  const all = [...box.min, ...box.max];
  if (all.length !== 6 || !all.every(Number.isInteger)) return "a box is whole blocks";
  if (box.min.some((value, axis) => value > box.max[axis])) return "a box's lowest corner can't be past its highest";
  const [width, depth] = [box.max[0] - box.min[0] + 1, box.max[2] - box.min[2] + 1];
  if (width > MAX_VIEW_WIDTH || depth > MAX_VIEW_WIDTH) return `a box is at most ${MAX_VIEW_WIDTH} by ${MAX_VIEW_WIDTH} blocks (this one is ${width} by ${depth})`;
  if (box.min[1] < MIN_Y || box.max[1] > MAX_Y) return `a box's floor and ceiling are within y ${MIN_Y} to ${MAX_Y}`;
  return undefined;
}

const boxViews: { key: string; gzipped: Buffer }[] = [];

/** The view of the blocks in a box of a world, gzipped (the last few are kept). */
export function boxView(world: string, box: SelectBox): { gzipped: Buffer; stamp: string } {
  const { values, stamp } = worldSubChunks(world);
  const key = `${world}\n${stamp}\n${box.min.join(",")} ${box.max.join(",")}`;
  const known = boxViews.find((entry) => entry.key === key);
  if (known) return { gzipped: known.gzipped, stamp };
  const clip: ViewClip = { min: [...box.min], max: [...box.max] };
  // Only the box's chunks are decoded.
  const inBox = new Map<string, Buffer>();
  const [cx0, cz0, cx1, cz1] = [box.min[0] >> 4, box.min[2] >> 4, box.max[0] >> 4, box.max[2] >> 4];
  for (const [text, value] of values) {
    const chunk = chunkKey(Buffer.from(text, "latin1"))!;
    if (chunk.x >= cx0 && chunk.x <= cx1 && chunk.z >= cz0 && chunk.z <= cz1) inBox.set(text, value);
  }
  const gzipped = gzipSync(encodeView(viewOf(inBox, stamp, clip)));
  boxViews.unshift({ key, gzipped });
  boxViews.length = Math.min(boxViews.length, 4);
  return { gzipped, stamp };
}
