// Map viewer spike, step 5: Select's picture of a whole source world, read only. Times reading
// just the height maps; then the picture, each column's top block found from the top down (each
// chunk's sub-chunks from the highest, all-air ones skipped without decoding, until every column
// has its top); checks both against a full decode; and writes the picture to
// work/viewer/spike/overview-<slug>.png (one pixel per column, shaded by height).
//   npx tsx spike/viewer/overview.ts "<world folder>" [<colors.json>]
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { encodePng } from "../../tools/editor/png.ts";
import { repoRoot } from "../../tools/maps/paths.ts";
import { readDb } from "./leveldb.ts";
import { allAir, chunkKey, decodeSubChunk, Palette, SUBCHUNK } from "./subchunk.ts";
import { decodeWorld, topBlock } from "./world.ts";

const NONE = -1000;
const world = process.argv[2];
const colorsFile = process.argv[3] ?? join(repoRoot, "work", "viewer", "spike", "colors.json");
const colors = existsSync(colorsFile) ? (JSON.parse(readFileSync(colorsFile, "utf8")) as Record<string, [number, number, number]>) : {};
const db = join(world, "db");
const megabytes = readdirSync(db).reduce((total, name) => total + statSync(join(db, name)).size, 0) / 2 ** 20;

let started = performance.now();
const heightsOnly = decodeWorld(world, { heightsOnly: true });
console.log(`${basename(world)}: ${megabytes.toFixed(1)} MB in db\\, ${heightsOnly.db.tables} tables, ${heightsOnly.db.logs} logs, ${heightsOnly.db.entries} entries`);
console.log(`  height maps only: ${heightsOnly.heights.size} chunks in ${(performance.now() - started).toFixed(0)} ms`);

started = performance.now();
const { values } = readDb(db, (key) => {
  const parsed = chunkKey(key);
  return !!parsed && parsed.dimension === 0 && parsed.tag === SUBCHUNK && parsed.y !== undefined;
});
const readMs = performance.now() - started;
const chunks = new Map<string, { y: number; value: Buffer }[]>();
for (const [text, value] of values) {
  const key = chunkKey(Buffer.from(text, "latin1"))!;
  const id = `${key.x},${key.z}`;
  if (!chunks.has(id)) chunks.set(id, []);
  chunks.get(id)!.push({ y: key.y!, value });
}
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const key of chunks.keys()) {
  const [cx, cz] = key.split(",").map(Number);
  [minX, maxX, minZ, maxZ] = [Math.min(minX, cx), Math.max(maxX, cx), Math.min(minZ, cz), Math.max(maxZ, cz)];
}
const width = (maxX - minX + 1) * 16;
const height = (maxZ - minZ + 1) * 16;
const tops = new Int32Array(width * height).fill(NONE);
const ids = new Uint16Array(width * height);
const palette = new Palette();
let decodedCount = 0;
let skipped = 0;
for (const [key, sections] of chunks) {
  const [cx, cz] = key.split(",").map(Number);
  sections.sort((a, b) => b.y - a.y);
  let found = 0;
  for (const { y: sy, value } of sections) {
    if (allAir(value, palette)) {
      skipped++;
      continue;
    }
    decodedCount++;
    const blocks = decodeSubChunk(value, palette).layers[0];
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const at = ((cz - minZ) * 16 + lz) * width + (cx - minX) * 16 + lx;
        if (tops[at] !== NONE) continue;
        for (let ly = 15; ly >= 0; ly--) {
          const id = blocks[(lx << 8) | (lz << 4) | ly];
          if (id === 0) continue;
          tops[at] = sy * 16 + ly;
          ids[at] = id;
          found++;
          break;
        }
      }
    }
    if (found === 256) break;
  }
}
const pictureMs = performance.now() - started;
console.log(`  picture: ${values.size} sub-chunks read in ${readMs.toFixed(0)} ms; ${skipped} all air skipped, ${decodedCount} decoded; ${width}x${height} columns; ${pictureMs.toFixed(0)} ms in all`);

// Checked against a full decode: the scan's tops, and the height maps'.
started = performance.now();
const full = decodeWorld(world);
const fullMs = performance.now() - started;
let columns = 0;
let scanRight = 0;
let mapRight = 0;
for (let z = 0; z < height; z++) {
  for (let x = 0; x < width; x++) {
    const wx = x + minX * 16;
    const wz = z + minZ * 16;
    const real = topBlock(full, wx, wz);
    if (!real) continue;
    columns++;
    if (real.y === tops[z * width + x]) scanRight++;
    const map = full.heights.get(`${wx >> 4},${wz >> 4}`);
    if (map && map[(wz & 15) * 16 + (wx & 15)] - 65 === real.y) mapRight++;
  }
}
console.log(`  full decode for the check: ${full.sections.size} sub-chunks in ${fullMs.toFixed(0)} ms. Of ${columns} columns with blocks, the scan has ${scanRight} right, the height maps ${mapRight}`);

let lowest = Infinity;
let highest = -Infinity;
for (const y of tops) if (y !== NONE) [lowest, highest] = [Math.min(lowest, y), Math.max(highest, y)];
const pixels = new Uint8Array(width * height * 4);
const unknown = new Set<string>();
for (let at = 0; at < width * height; at++) {
  if (tops[at] === NONE) {
    pixels.set([24, 24, 28, 255], at * 4);
    continue;
  }
  const name = palette.blocks[ids[at]].name;
  if (!colors[name]) unknown.add(name);
  const base = colors[name] ?? hashColor(name);
  const shade = 0.55 + 0.45 * ((tops[at] - lowest) / Math.max(1, highest - lowest));
  pixels.set([base[0] * shade, base[1] * shade, base[2] * shade, 255], at * 4);
}
const slug = basename(world).replace(/[^A-Za-z0-9]+/g, "-");
const file = join(repoRoot, "work", "viewer", "spike", `overview-${slug}.png`);
writeFileSync(file, encodePng({ width, height, data: pixels }));
console.log(`  wrote ${file} (y ${lowest} to ${highest}); ${unknown.size} top blocks without a color${unknown.size ? `: ${[...unknown].slice(0, 12).join(", ")}` : ""}`);

function hashColor(name: string): [number, number, number] {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return [80 + (hash & 127), 80 + ((hash >> 7) & 127), 80 + ((hash >> 14) & 127)];
}
