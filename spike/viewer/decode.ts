// Map viewer spike, step 1: decodes maps' worlds from the map store (read only) and prints what
// they hold and how long it took; checks each chunk's height map against the decoded blocks; and
// writes sample columns' top blocks to work/viewer/spike/<target>-<map>.json for bds-check.ts.
//   npx tsx spike/viewer/decode.ts bridges/temples sumo/sinkhole ...
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { workingDir } from "../../tools/maps/paths.ts";
import { blockAt, blockBox, decodeWorld, topBlock } from "./world.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const out = join(root, "work", "viewer", "spike");
mkdirSync(out, { recursive: true });

for (const path of process.argv.slice(2)) {
  const [target, map] = path.split("/");
  const world = join(workingDir(target), map, "world");
  const decoded = decodeWorld(world);
  const box = blockBox(decoded)!;
  const size = box.max.map((v, i) => v - box.min[i] + 1);
  let solid = 0;
  const counts = new Map<string, number>();
  for (const layers of decoded.sections.values()) {
    for (const id of layers[0]) {
      if (id === 0) continue;
      solid++;
      const name = decoded.palette.blocks[id].name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const layerCounts = new Map<number, number>();
  for (const layers of decoded.sections.values()) layerCounts.set(layers.length, (layerCounts.get(layers.length) ?? 0) + 1);
  console.log(`== ${path}`);
  console.log(`  db: ${decoded.db.tables} tables, ${decoded.db.logs} logs, ${decoded.db.skippedTables} left-over tables skipped, ${decoded.db.entries} entries, ${decoded.db.deletes} deleted keys`);
  console.log(`  read ${decoded.ms.read.toFixed(0)} ms, decoded ${decoded.sections.size} sub-chunks in ${decoded.ms.decode.toFixed(0)} ms (${decoded.palette.parsed} palette entries parsed, ${decoded.palette.blocks.length} block states)`);
  console.log(`  layers per sub-chunk: ${[...layerCounts].map(([n, c]) => `${n}: ${c}`).join(", ")}`);
  console.log(`  box ${JSON.stringify(box.min)} to ${JSON.stringify(box.max)} (${size.join("x")}), ${solid} blocks, ${counts.size} kinds`);
  console.log(`  most: ${[...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n.replace("minecraft:", "")} ${c}`).join(", ")}`);

  // Height maps against the decoded top block: which order and offset fit.
  const fits = { xz: new Map<number, number>(), zx: new Map<number, number>() };
  let columns = 0;
  for (const [key, heights] of decoded.heights) {
    const [cx, cz] = key.split(",").map(Number);
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const top = topBlock(decoded, cx * 16 + lx, cz * 16 + lz);
        if (!top) continue;
        columns++;
        const xz = heights[lx * 16 + lz] - top.y;
        const zx = heights[lz * 16 + lx] - top.y;
        fits.xz.set(xz, (fits.xz.get(xz) ?? 0) + 1);
        fits.zx.set(zx, (fits.zx.get(zx) ?? 0) + 1);
      }
    }
  }
  const best = (m: Map<number, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, c]) => `${d}: ${c}`).join(", ");
  console.log(`  height maps: ${decoded.heights.size} chunks, ${columns} columns with blocks; height - top y by [x*16+z]: ${best(fits.xz)}; by [z*16+x]: ${best(fits.zx)}`);

  // Spots for the BDS check: sample columns' top blocks and the air above them (a grid over the
  // box plus random columns), and random spots anywhere in the box.
  const spots: { x: number; y: number; z: number; name: string; states: Record<string, string | number> }[] = [];
  const spot = (x: number, y: number, z: number) => spots.push({ x, y, z, ...decoded.palette.blocks[blockAt(decoded, x, y, z)] });
  const column = (x: number, z: number) => {
    const top = topBlock(decoded, x, z);
    if (top) for (const y of [top.y, top.y + 1]) spot(x, y, z);
  };
  for (let x = box.min[0]; x <= box.max[0]; x += Math.max(1, Math.floor(size[0] / 8))) for (let z = box.min[2]; z <= box.max[2]; z += Math.max(1, Math.floor(size[2] / 8))) column(x, z);
  let seed = 12345;
  const random = (n: number) => Math.floor(((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * n);
  for (let i = 0; i < 120; i++) column(box.min[0] + random(size[0]), box.min[2] + random(size[2]));
  for (let i = 0; i < 400; i++) spot(box.min[0] + random(size[0]), box.min[1] + random(size[1]), box.min[2] + random(size[2]));
  writeFileSync(join(out, `${target}-${map}.json`), JSON.stringify({ target, map, box, spots }, null, 1));
  console.log(`  ${spots.length} spots written`);
}
