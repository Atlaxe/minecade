// A map's view file (view-format.ts) made from its world, read only, and kept in a cache:
// work\viewer\maps\<target>\<map>\<stamp>.bin.gz, where the stamp is a hash of the world's db\ files'
// names, sizes and times (and the view format). A map opens at once the second time; a world that
// changed makes a new one, and the old one goes.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { allAir, BlockPalette, chunkKey, decodeSubChunk, isOverworldSubChunk, stateText, type BlockState } from "./subchunk.ts";
import { MAX_VIEW_WIDTH, UNIFORM, VIEW_FORMAT, VIEW_MAGIC, WATER, WATER_UNIFORM, type ViewBox, type ViewHeader, type ViewLook, type ViewSection } from "./view-format.ts";
import { readWorldDb } from "./world-reader.ts";

/** A world the viewer can't show: none there, no blocks, or too wide. The message says which. */
export class ViewError extends Error {}

/**
 * Vanilla states that change how a block is drawn: faces turned (logs), half or part of a block
 * (slabs, stairs, snow), doors, gates and trapdoors, posts' arms, liquids' height. The rest (a
 * leaf's update_bit) only keep alike blocks from merging into one face. A custom block keeps all
 * of its states: its permutations can change its shape.
 */
const DRAWN_STATES = new Set([
  "pillar_axis",
  "minecraft:vertical_half",
  "top_slot_bit",
  "upside_down_bit",
  "weirdo_direction",
  "minecraft:corner",
  "direction",
  "facing_direction",
  "minecraft:facing_direction",
  "minecraft:cardinal_direction",
  "minecraft:block_face",
  "open_bit",
  "upper_block_bit",
  "door_hinge_bit",
  "in_wall_bit",
  "height",
  "liquid_depth",
  "hanging",
  "torch_facing_direction",
  "rail_direction",
  "minecraft:connection_north",
  "minecraft:connection_east",
  "minecraft:connection_south",
  "minecraft:connection_west",
  "wall_connection_type_north",
  "wall_connection_type_east",
  "wall_connection_type_south",
  "wall_connection_type_west",
  "wall_post_bit",
]);

/** How the viewer draws a block state: its name and the states that matter. */
export function lookOf(block: BlockState): ViewLook {
  const custom = !block.name.startsWith("minecraft:");
  const states = Object.entries(block.states)
    .filter(([key]) => custom || DRAWN_STATES.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return states.length > 0 ? { name: block.name, states: Object.fromEntries(states) } : { name: block.name };
}

export interface BuiltView {
  header: ViewHeader;
  list: ViewSection[];
}

/** A world's view: its Overworld's blocks, in the box they fill, refused when that's wider than MAX_VIEW_WIDTH. */
export function buildView(world: string, stamp = worldStamp(world)): BuiltView {
  const db = join(world, "db");
  if (!existsSync(db)) throw new ViewError(`there's no world at ${world}`);
  return viewOf(readWorldDb(db, isOverworldSubChunk).values, stamp);
}

/** Blocks a view keeps (Select's box): x and z, and optionally y, each inclusive. */
export interface ViewClip {
  min: [x: number, y: number, z: number];
  max: [x: number, y: number, z: number];
}

/**
 * The view of a world's Overworld sub-chunks (keys as latin1, values as stored), every block, or
 * with `clip` only the blocks in that box (the rest is air).
 */
export function viewOf(values: Map<string, Buffer>, stamp: string, clip?: ViewClip): BuiltView {
  const palette = new BlockPalette();
  const sections: { x: number; y: number; z: number; layers: Uint16Array[] }[] = [];
  for (const [text, value] of values) {
    const key = chunkKey(Buffer.from(text, "latin1"))!;
    if (clip && !sectionMeets(key.x, key.z, key.y!, clip)) continue;
    // All-air sub-chunks (a converted world keeps one for every empty section) are left out.
    if (allAir(value, palette)) continue;
    const { y, layers } = decodeSubChunk(value, palette);
    const section = { x: key.x, y: y ?? key.y!, z: key.z, layers };
    if (clip) clipSection(section, clip);
    sections.push(section);
  }
  // Block palette ids to look ids, for the blocks in use only: a sub-chunk's palette keeps entries
  // after their blocks are gone (Temples' still list hundreds of the editor's plane blocks).
  const used = new Uint8Array(palette.blocks.length);
  for (const { layers } of sections) for (const layer of layers) for (const id of layer) used[id] = 1;
  const looks: ViewLook[] = [{ name: "minecraft:air" }];
  const lookIds = new Map<string, number>([[stateText({ name: "minecraft:air", states: {} }), 0]]);
  const toLook = new Uint16Array(palette.blocks.length);
  palette.blocks.forEach((block, id) => {
    if (!used[id]) return;
    const look = lookOf(block);
    const text = stateText({ name: look.name, states: look.states ?? {} });
    let lookId = lookIds.get(text);
    if (lookId === undefined) {
      lookId = looks.length;
      looks.push(look);
      lookIds.set(text, lookId);
    }
    toLook[id] = lookId;
  });
  const box = blocksBox(sections);
  if (!box) throw new ViewError("the world has no blocks");
  const width = box.max[0] - box.min[0] + 1;
  const depth = box.max[2] - box.min[2] + 1;
  if (width > MAX_VIEW_WIDTH || depth > MAX_VIEW_WIDTH) {
    throw new ViewError(`the world's blocks are ${width} by ${depth} blocks across (x ${box.min[0]} to ${box.max[0]}, z ${box.min[2]} to ${box.max[2]}): the viewer shows maps up to ${MAX_VIEW_WIDTH} by ${MAX_VIEW_WIDTH}`);
  }
  const list: ViewSection[] = [];
  for (const section of sections.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)) {
    const blocks = asLooks(section.layers[0], toLook);
    const water = section.layers[1] ? asLooks(section.layers[1], toLook) : undefined;
    list.push({ x: section.x, y: section.y, z: section.z, blocks, ...(water !== undefined && water !== 0 ? { water } : {}) });
  }
  return { header: { format: VIEW_FORMAT, stamp, box, looks, sections: list.length }, list };
}

/** Whether a section's blocks reach into a clip box at all. */
function sectionMeets(sx: number, sz: number, sy: number, clip: ViewClip): boolean {
  const meets = (s: number, axis: 0 | 1 | 2) => s * 16 + 15 >= clip.min[axis] && s * 16 <= clip.max[axis];
  return meets(sx, 0) && meets(sy, 1) && meets(sz, 2);
}

/** Makes every block of a section outside a clip box air, in each layer. */
function clipSection(section: { x: number; y: number; z: number; layers: Uint16Array[] }, clip: ViewClip): void {
  const inside = (s: number, local: number, axis: 0 | 1 | 2) => {
    const at = s * 16 + local;
    return at >= clip.min[axis] && at <= clip.max[axis];
  };
  for (let i = 0; i < 4096; i++) {
    if (inside(section.x, i >> 8, 0) && inside(section.z, (i >> 4) & 15, 2) && inside(section.y, i & 15, 1)) continue;
    for (const layer of section.layers) layer[i] = 0;
  }
}

/** A layer as look ids, or one look when it's all the same. */
function asLooks(layer: Uint16Array, toLook: Uint16Array): Uint16Array | number {
  const looks = new Uint16Array(4096);
  let same = true;
  for (let i = 0; i < 4096; i++) {
    looks[i] = toLook[layer[i]];
    if (looks[i] !== looks[0]) same = false;
  }
  return same ? looks[0] : looks;
}

/** The box layer 0's non-air blocks fill. */
function blocksBox(sections: { x: number; y: number; z: number; layers: Uint16Array[] }[]): ViewBox | undefined {
  let box: ViewBox | undefined;
  for (const { x: sx, y: sy, z: sz, layers } of sections) {
    const blocks = layers[0];
    for (let i = 0; i < 4096; i++) {
      if (blocks[i] === 0) continue;
      const x = sx * 16 + (i >> 8);
      const z = sz * 16 + ((i >> 4) & 15);
      const y = sy * 16 + (i & 15);
      if (!box) box = { min: [x, y, z], max: [x, y, z] };
      else {
        if (x < box.min[0]) box.min[0] = x;
        if (y < box.min[1]) box.min[1] = y;
        if (z < box.min[2]) box.min[2] = z;
        if (x > box.max[0]) box.max[0] = x;
        if (y > box.max[1]) box.max[1] = y;
        if (z > box.max[2]) box.max[2] = z;
      }
    }
  }
  return box;
}

/** A view as the file's bytes (view-format.ts), before gzip. */
export function encodeView({ header, list }: BuiltView): Buffer {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const parts: Buffer[] = [Buffer.from(VIEW_MAGIC, "latin1"), u32(json.length), json];
  if ((8 + json.length) % 2) parts.push(Buffer.alloc(1));
  for (const section of list) {
    const head = Buffer.alloc(8);
    head.writeInt16LE(section.x, 0);
    head.writeInt16LE(section.y, 2);
    head.writeInt16LE(section.z, 4);
    head[6] = (typeof section.blocks === "number" ? UNIFORM : 0) | (section.water !== undefined ? WATER : 0) | (typeof section.water === "number" ? WATER_UNIFORM : 0);
    parts.push(head, layerBytes(section.blocks));
    if (section.water !== undefined) parts.push(layerBytes(section.water));
  }
  return Buffer.concat(parts);
}

function layerBytes(layer: Uint16Array | number): Buffer {
  if (typeof layer === "number") {
    const one = Buffer.alloc(2);
    one.writeUInt16LE(layer);
    return one;
  }
  const bytes = Buffer.alloc(8192);
  for (let i = 0; i < 4096; i++) bytes.writeUInt16LE(layer[i], i * 2);
  return bytes;
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

/** What a world's db\ folder is now: a hash of its files' names, sizes and times, and the view format. */
export function worldStamp(world: string): string {
  const db = join(world, "db");
  const hash = createHash("sha256").update(`format ${VIEW_FORMAT}\n`);
  if (existsSync(db)) {
    for (const name of readdirSync(db).sort()) {
      const info = statSync(join(db, name));
      hash.update(`${name} ${info.size} ${Math.floor(info.mtimeMs)}\n`);
    }
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * The world's view file, gzipped, from the cache folder when the world hasn't changed since it was
 * made, else made now (and older ones in the folder removed). `built` says which.
 */
export function cachedView(world: string, cacheDir: string): { gzipped: Buffer; stamp: string; built: boolean } {
  const stamp = worldStamp(world);
  const file = join(cacheDir, `${stamp}.bin.gz`);
  if (existsSync(file)) return { gzipped: readFileSync(file), stamp, built: false };
  const gzipped = gzipSync(encodeView(buildView(world, stamp)));
  mkdirSync(cacheDir, { recursive: true });
  const partial = `${file}.${process.pid}.part`;
  writeFileSync(partial, gzipped);
  renameSync(partial, file);
  for (const name of readdirSync(cacheDir)) {
    if (name !== `${stamp}.bin.gz` && name.endsWith(".bin.gz")) rmSync(join(cacheDir, name), { force: true });
  }
  return { gzipped, stamp, built: true };
}
