// Map viewer spike, steps 3 and 4: serves page.ts to an Edge window of its own (its own profile in
// work\viewer\spike\edge-profile, so it's a separate browser, closed at the end) with three scenes,
// and prints what the page measured. Results and screenshots go to work\viewer\spike\.
//   worst       256x384x256 of noise caves, every block a different look (nothing merges)
//   realistic   the 256x256 area with the most blocks in one of the client's converted worlds
//   temples     Bridges' Temples, from the map store
// three.js isn't a dependency yet (pass V.3 adds it): this installs it in work\viewer\spike\three.
//   npx tsx spike/viewer/render/serve.ts [<scene> ...]
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { build } from "esbuild";
import { worldFolders } from "../../../tools/editor/worlds.ts";
import { repoRoot, workingDir } from "../../../tools/maps/paths.ts";
import { blockBox, decodeWorld, type DecodedWorld } from "../world.ts";

const spike = join(repoRoot, "work", "viewer", "spike");
const out = join(spike, "render");
const profile = join(spike, "edge-profile");
const threeDir = join(spike, "three");
const HIDDEN = /^minecraft:(air|structure_void|barrier|invisible_bedrock|light_block(_\d+)?)$/;
mkdirSync(out, { recursive: true });

if (!existsSync(join(threeDir, "node_modules", "three"))) {
  mkdirSync(threeDir, { recursive: true });
  writeFileSync(join(threeDir, "package.json"), '{"private":true}');
  spawnSync("npm", ["install", "three@0.186.1", "--no-audit", "--no-fund"], { cwd: threeDir, shell: true, stdio: "inherit" });
}
await build({
  entryPoints: [join(repoRoot, "spike", "viewer", "render", "page.ts"), join(repoRoot, "spike", "viewer", "render", "worker.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  target: "es2022",
  nodePaths: [join(threeDir, "node_modules")],
  logLevel: "warning",
});

const faces = JSON.parse(readFileSync(join(spike, "faces.json"), "utf8")) as Record<string, Record<"up" | "down" | "side", number[]>>;

/** A scene's bytes: the header's length, the header (size, 12 color bytes and a drawn flag per id), then the blocks (16-bit, y fastest, then z, then x). */
function sceneFile(size: [number, number, number], volume: Uint16Array, names: string[]): Buffer {
  const colors: number[] = [];
  const drawn: number[] = [];
  for (const name of names) {
    const face = faces[name];
    colors.push(...(face ? [...face.up, ...face.down, ...face.side] : [255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255]));
    drawn.push(HIDDEN.test(name) ? 0 : 1);
  }
  const header = Buffer.from(JSON.stringify({ size, colors, drawn }));
  const pad = (4 + header.length) % 2;
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  return Buffer.concat([length, header, Buffer.alloc(pad), Buffer.from(volume.buffer, volume.byteOffset, volume.byteLength)]);
}

/** A box of a decoded world as a dense volume. */
function cut(world: DecodedWorld, min: number[], max: number[]): Buffer {
  const size: [number, number, number] = [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];
  const volume = new Uint16Array(size[0] * size[1] * size[2]);
  for (const [key, layers] of world.sections) {
    const [cx, cz, cy] = key.split(",").map(Number);
    if (cx * 16 + 15 < min[0] || cx * 16 > max[0] || cz * 16 + 15 < min[2] || cz * 16 > max[2] || cy * 16 + 15 < min[1] || cy * 16 > max[1]) continue;
    const blocks = layers[0];
    for (let i = 0; i < 4096; i++) {
      if (!blocks[i]) continue;
      const x = cx * 16 + (i >> 8) - min[0];
      const z = cz * 16 + ((i >> 4) & 15) - min[2];
      const y = cy * 16 + (i & 15) - min[1];
      if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) continue;
      volume[(x * size[2] + z) * size[1] + y] = blocks[i];
    }
  }
  return sceneFile(size, volume, world.palette.blocks.map((block) => block.name));
}

function worstScene(): Buffer {
  const size: [number, number, number] = [256, 384, 256];
  const volume = new Uint16Array(size[0] * size[1] * size[2]);
  const hash = (x: number, y: number, z: number) => {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number, z: number, scale: number) => {
    const [fx, fy, fz] = [x / scale, y / scale, z / scale];
    const [ix, iy, iz] = [Math.floor(fx), Math.floor(fy), Math.floor(fz)];
    const [tx, ty, tz] = [smooth(fx - ix), smooth(fy - iy), smooth(fz - iz)];
    let value = 0;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) value += hash(ix + dx, iy + dy, iz + dz) * (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
    return value;
  };
  for (let x = 0; x < size[0]; x++) for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) {
    if (noise(x, y, z, 24) * 0.7 + noise(x, y, z, 7) * 0.3 > 0.5) volume[(x * size[2] + z) * size[1] + y] = 1 + Math.floor(hash(x, y, z + 99) * 64);
  }
  const names = ["minecraft:air", ...Array.from({ length: 64 }, (_, i) => `worst:${i}`)];
  for (let i = 0; i < 64; i++) {
    const color = [60 + Math.floor(hash(i, 1, 2) * 190), 60 + Math.floor(hash(i, 3, 4) * 190), 60 + Math.floor(hash(i, 5, 6) * 190), 255];
    faces[`worst:${i}`] = { up: color, down: color, side: color };
  }
  return sceneFile(size, volume, names);
}

/** The 256x256 area (16x16 chunks) with the most blocks in the client's converted worlds, height trimmed to its blocks. */
async function realisticScene(): Promise<Buffer> {
  let best: { world: DecodedWorld; count: number; cx: number; cz: number; name: string } | undefined;
  const folders = await worldFolders();
  for (const id of ["7F7qoUrdiFE=", "YEDRMEBRUWU="]) {
    const folder = folders.map((dir) => join(dir, id)).find((dir) => existsSync(join(dir, "db")));
    if (!folder) continue;
    const world = decodeWorld(folder);
    const perChunk = new Map<string, number>();
    for (const [key, layers] of world.sections) {
      const [cx, cz] = key.split(",");
      let n = 0;
      for (const block of layers[0]) if (block) n++;
      perChunk.set(`${cx},${cz}`, (perChunk.get(`${cx},${cz}`) ?? 0) + n);
    }
    for (const key of perChunk.keys()) {
      const [cx, cz] = key.split(",").map(Number);
      // Windows starting at each chunk that has blocks.
      let count = 0;
      for (let dx = 0; dx < 16; dx++) for (let dz = 0; dz < 16; dz++) count += perChunk.get(`${cx + dx},${cz + dz}`) ?? 0;
      if (!best || count > best.count) best = { world, count, cx, cz, name: id };
    }
  }
  if (!best) throw new Error("no converted world found for the realistic scene");
  const min = [best.cx * 16, -64, best.cz * 16];
  const max = [best.cx * 16 + 255, 319, best.cz * 16 + 255];
  // Trim the height to the blocks in the area.
  let low = 320;
  let high = -65;
  for (const [key, layers] of best.world.sections) {
    const [cx, cz, cy] = key.split(",").map(Number);
    if (cx < best.cx || cx >= best.cx + 16 || cz < best.cz || cz >= best.cz + 16) continue;
    for (let i = 0; i < 4096; i++) if (layers[0][i]) [low, high] = [Math.min(low, cy * 16 + (i & 15)), Math.max(high, cy * 16 + (i & 15))];
  }
  console.log(`realistic: ${best.name}, chunks ${best.cx},${best.cz} on, ${best.count} blocks, y ${low} to ${high}`);
  return cut(best.world, [min[0], low, min[2]], [max[0], high, max[2]]);
}

function mapScene(target: string, map: string): Buffer {
  const world = decodeWorld(join(workingDir(target), map, "world"));
  const box = blockBox(world)!;
  return cut(world, box.min, box.max);
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ["temples", "realistic", "worst"];
const sceneFiles = new Map<string, Buffer>();
for (const name of wanted) {
  const started = performance.now();
  sceneFiles.set(name, name === "worst" ? worstScene() : name === "realistic" ? await realisticScene() : mapScene("bridges", "temples"));
  console.log(`scene ${name}: ${(sceneFiles.get(name)!.length / 2 ** 20).toFixed(1)} MB, made in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

const results: unknown[] = [];
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const url = req.url ?? "/";
    const body = Buffer.concat(chunks);
    const send = (type: string, data: string | Buffer) => {
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(data);
    };
    if (url === "/") return send("text/html", `<!doctype html><meta charset="utf-8"><title>Viewer spike</title><style>body{margin:0;overflow:hidden}#status{position:fixed;left:12px;top:8px;font:14px system-ui;color:#fff;text-shadow:0 1px 2px #000}</style><div id="status">starting</div><script type="module" src="page.js"></script>`);
    if (url === "/page.js" || url === "/worker.js") return send("text/javascript", readFileSync(join(out, url.slice(1))));
    if (url === "/scenes") return send("application/json", JSON.stringify(wanted));
    if (url.startsWith("/scene/")) return send("application/octet-stream", sceneFiles.get(url.slice(7))!);
    if (url === "/progress") {
      console.log(`${new Date().toISOString().slice(11, 19)}  ${body.toString()}`);
      return send("text/plain", "ok");
    }
    if (url === "/measure") return send("application/json", JSON.stringify(edgeMemory()));
    if (url.startsWith("/shot/")) {
      writeFileSync(join(spike, `shot-${url.slice(6)}.png`), body);
      return send("text/plain", "ok");
    }
    if (url === "/result") {
      const result = JSON.parse(body.toString()) as unknown;
      results.push(result);
      console.log(JSON.stringify(result, null, 1));
      return send("text/plain", "ok");
    }
    if (url === "/done") {
      const about = JSON.parse(body.toString()) as unknown;
      console.log(JSON.stringify(about, null, 1));
      writeFileSync(join(spike, "render-results.json"), JSON.stringify({ about, results }, null, 1));
      send("text/plain", "ok");
      finish();
      return;
    }
    res.writeHead(404);
    res.end();
  });
});
server.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const port = (server.address() as { port: number }).port;
const edgeExe = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean).map((dir) => join(dir!, "Microsoft", "Edge", "Application", "msedge.exe")).find(existsSync)!;
const edge = spawn(edgeExe, [`--app=http://127.0.0.1:${port}/`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1600,1000", "--enable-precise-memory-info", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-features=CalculateNativeWinOcclusion"], { stdio: "ignore" });
const timeout = setTimeout(() => {
  console.log("timed out");
  finish();
}, 15 * 60_000);

/** The spike's Edge processes (found by their profile folder): working set and private bytes, in all and the GPU process's. */
function edgeMemory(): Record<string, number> {
  const script = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*edge-profile*' } | ForEach-Object { '{0} {1} {2}' -f $_.WorkingSetSize, $_.PrivatePageCount, ($(if ($_.CommandLine -like '*--type=gpu-process*') { 'gpu' } elseif ($_.CommandLine -like '*--type=renderer*') { 'renderer' } else { 'other' })) }`;
  const lines = execFileSync("powershell", ["-NoProfile", "-Command", script]).toString().trim().split(/\r?\n/);
  const total = { workingSetMB: 0, privateMB: 0, gpuPrivateMB: 0, rendererPrivateMB: 0, processes: lines.length };
  for (const line of lines) {
    const [working, privateBytes, kind] = line.split(" ");
    total.workingSetMB += Number(working) / 2 ** 20;
    total.privateMB += Number(privateBytes) / 2 ** 20;
    if (kind === "gpu") total.gpuPrivateMB += Number(privateBytes) / 2 ** 20;
    if (kind === "renderer") total.rendererPrivateMB += Number(privateBytes) / 2 ** 20;
  }
  return Object.fromEntries(Object.entries(total).map(([key, value]) => [key, Math.round(value)]));
}

function finish(): void {
  clearTimeout(timeout);
  if (edge.pid) spawnSync("taskkill", ["/PID", String(edge.pid), "/T", "/F"], { stdio: "ignore" });
  server.close();
  setTimeout(() => process.exit(0), 500);
}
