// Map editor spike, automated part (pass 10.1): Chunker prunes a converted world to one build's
// chunks, BDS loads it, the spike pack (spike/editor/pack) fingerprints the build, probes structure
// sizes and moves the build to the middle, then Chunker prunes to the new chunks and BDS loads that
// again, and the fingerprint must still match. Prints a summary and writes
// spike/results/editor.json. Findings are in docs/spike-results.md ("Map editor").
//   npx tsx spike/editor/run.ts "<world folder>" [--verbose]
// Worlds are copied into the containers, so the folder is never changed (Chunker rewrites its
// input). The box below is build B of "Datapacking (imported)".
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Docker from "dockerode";
import * as tar from "tar";
import { bakeSettings } from "../../tools/build/bake-core.ts";
import { attachConsole, connectDocker, copyDirFromContainer, findContainerByName, type ServerConsole } from "../../tools/build/docker-util.ts";
import { readLevelDat, writeLevelDat } from "../../tools/build/leveldat.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");
const CHUNKER = "minecade/chunker:local";
const BDS = "minecade/bds:local";
const NAME = "minecade-editor-spike";
const verbose = process.argv.includes("--verbose");
const source = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

type Vec = { x: number; y: number; z: number };
/** Build B: chunks x 6..12, z -5..2, from the floor (y -64) up. */
const BOX = { min: { x: 96, y: -64, z: -80 }, max: { x: 207, y: 0, z: 47 } };
/** Moves the box's middle to x 0, z 0 (it ends at x -56..55, z -64..63). */
const OFFSET = { x: -152, y: 0, z: 16 };
const MOVED = { min: add(BOX.min, OFFSET), max: add(BOX.max, OFFSET) };
const SIZES = [
  [64, 64, 64],
  [64, 128, 64],
  [64, 384, 64],
  [96, 65, 96],
  [112, 65, 128],
  [144, 65, 128],
];

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name es
set_prop allow-cheats true
set_prop gamemode creative
set_prop difficulty peaceful
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

const results: Record<string, unknown> = {};
const timings: Record<string, number> = {};

function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    timings[label] = Date.now() - started;
    console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
}

/** Runs Chunker on a copy of `world`, keeping only the given chunks, into `out`. */
async function prune(docker: Docker, label: string, world: string, chunks: { minX: number; minZ: number; maxX: number; maxZ: number }, out: string): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), "minecade-chunker-"));
  const container = await docker.createContainer({ Image: CHUNKER, Cmd: ["-i", "in", "-o", "out", "-f", "INPUT", "-p", "pruning.json"], Tty: false });
  try {
    await cp(world, join(staging, "in"), { recursive: true });
    const pruning = { configs: { "minecraft:overworld": { include: true, regions: [{ minChunkX: chunks.minX, minChunkZ: chunks.minZ, maxChunkX: chunks.maxX, maxChunkZ: chunks.maxZ }] } } };
    await writeFile(join(staging, "pruning.json"), JSON.stringify(pruning));
    await timed(`${label}: copy in`, () => container.putArchive(tar.c({ cwd: staging, portable: true }, ["in", "pruning.json"]) as unknown as NodeJS.ReadableStream, { path: "/work" }));
    await timed(`${label}: chunker`, async () => {
      await container.start();
      const { StatusCode } = (await container.wait()) as { StatusCode: number };
      const log = String(await container.logs({ stdout: true, stderr: true }));
      if (StatusCode !== 0) throw new Error(`chunker exited ${StatusCode}: ${log.slice(-600)}`);
    });
    await rm(out, { recursive: true, force: true });
    await timed(`${label}: copy out`, () => copyDirFromContainer(container, "/work/out", out));
  } finally {
    await container.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

/** The void world settings, with the world spawn at `spawn`. */
async function voidLevelDat(world: string, spawn: [number, number, number]): Promise<void> {
  const path = join(world, "level.dat");
  const dat = await readLevelDat(path);
  bakeSettings(dat, { spawns: [spawn] } as never);
  await writeLevelDat(path, dat);
}

/** Boots BDS on `world` with the spike pack, runs `steps`, stops (saving) and copies the world to `saveTo`. */
async function withServer(docker: Docker, label: string, world: string, steps: (server: Server) => Promise<void>, saveTo?: string): Promise<void> {
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-editor-spike-"));
  const container = await docker.createContainer({ name: NAME, Image: BDS, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "es");
    await cp(world, worldDir, { recursive: true });
    const manifest = JSON.parse(await readFile(join(here, "pack", "manifest.json"), "utf8"));
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: manifest.header.uuid, version: manifest.header.version }]));
    await cp(join(here, "pack"), join(staging, "behavior_packs", "editor_spike"), { recursive: true });
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server"] }));
    await timed(`${label}: stage`, () => container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" }));
    const serverConsole = await attachConsole(container, verbose);
    const server = new Server(serverConsole);
    await container.start();
    await timed(`${label}: boot`, () => serverConsole.waitFor(/Server started\./, 180_000));
    await steps(server);
    if (server.errors.length > 0) console.log(`server errors:\n  ${server.errors.join("\n  ")}`);
    serverConsole.send("stop");
    await Promise.race([container.wait(), delay(30_000)]);
    serverConsole.close();
    if (saveTo) {
      await rm(saveTo, { recursive: true, force: true });
      await timed(`${label}: copy out`, () => copyDirFromContainer(container, "/bds/worlds/es", saveTo));
    }
  } finally {
    await container.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

class Server {
  readonly errors: string[] = [];
  private readonly console: ServerConsole;
  private readonly parts = new Map<string, Record<string, unknown>[]>();
  private markers = 0;

  constructor(serverConsole: ServerConsole) {
    this.console = serverConsole;
    serverConsole.onLine((line) => {
      if (/ERROR|\[Scripting\].*(Error|error)/.test(line) && !/ES\||outside of the world|expected: Air/.test(line)) this.errors.push(line);
      const match = /ES\|(.*)$/.exec(line);
      if (!match) return;
      const part = JSON.parse(match[1]) as Record<string, unknown>;
      const list = this.parts.get(part.id as string) ?? [];
      list.push(part);
      this.parts.set(part.id as string, list);
    });
  }

  /** Sends a console command and returns its reply lines (up to a scriptevent marker). */
  async run(command: string): Promise<string[]> {
    const marker = `Script event esm:m${++this.markers} has been sent`;
    const lines: string[] = [];
    const off = this.console.onLine((line) => lines.push(line));
    try {
      this.console.send(command);
      this.console.send(`scriptevent esm:m${this.markers}`);
      await this.console.waitFor(new RegExp(marker), 15_000);
    } finally {
      off();
    }
    return lines.slice(0, lines.findIndex((line) => line.includes(marker)));
  }

  /** Runs a spike pack command and resolves its result parts once it ends. */
  async pack(command: string, args: Record<string, unknown>, timeoutMs = 300_000): Promise<Record<string, unknown>> {
    const id = args.id as string;
    const done = this.console.waitFor(new RegExp(`ES\\|\\{"id":"${id}","part":"end"`), timeoutMs);
    this.console.send(`scriptevent ${command} ${JSON.stringify(args)}`);
    await done;
    const merged = Object.assign({}, ...(this.parts.get(id) ?? []).filter((part) => part.part !== "end"));
    results[id] = merged;
    const { byType: _byType, ...summary } = merged;
    console.log(`${id}: ${JSON.stringify(summary)}`);
    return merged;
  }

  /**
   * Keeps a box loaded, and waits until its corners answer. The first command right after
   * "Server started." can arrive garbled ("Unknown command: {"), so the ticking area is added
   * until BDS confirms it.
   */
  async load(name: string, min: Vec, max: Vec): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const replies = await this.run(`tickingarea add ${min.x} 0 ${min.z} ${max.x} 0 ${max.z} ${name} true`);
      if (replies.some((line) => line.includes("Added ticking area"))) break;
      if (attempt >= 5) throw new Error(`could not add ticking area ${name}: ${replies.join(" / ")}`);
      await delay(1000);
    }
    for (let i = 0; ; i++) {
      const replies = [...(await this.run(`testforblock ${min.x} ${min.y} ${min.z} air`)), ...(await this.run(`testforblock ${max.x} ${max.y} ${max.z} air`))];
      if (!replies.some((line) => line.includes("outside of the world"))) return;
      if (i > 120) throw new Error(`${name} did not load: ${replies.join(" / ")}`);
      await delay(500);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!source) throw new Error('usage: npx tsx spike/editor/run.ts "<world folder>"');
  const docker = connectDocker();
  const scratch = await mkdtemp(join(tmpdir(), "minecade-editor-run-"));
  try {
    // 1. Prune the converted world to build B's chunks.
    const pruned = join(scratch, "pruned");
    await prune(docker, "prune 1", source, { minX: 6, minZ: -5, maxX: 12, maxZ: 2 }, pruned);
    await voidLevelDat(pruned, [152, -40, -16]);

    // 2. Load it, fingerprint the build, probe structure sizes, move it to the middle.
    const moved = join(scratch, "moved");
    await withServer(
      docker,
      "server 1",
      pruned,
      async (server) => {
        await timed("load source", () => server.load("src", BOX.min, { ...BOX.max, x: BOX.min.x + 143 }));
        await timed("load destination", () => server.load("dst", MOVED.min, MOVED.max));
        await server.pack("es:fingerprint", { id: "before", ...BOX });
        await server.pack("es:probe", { id: "probe", min: BOX.min, sizes: SIZES });
        await server.pack("es:move", { id: "move", ...BOX, offset: OFFSET, tile: 64, passes: 2 });
        await server.pack("es:fingerprint", { id: "after_moved", ...MOVED });
        await server.pack("es:fingerprint", { id: "after_old_spot", ...BOX });
      },
      moved,
    );

    // 3. Prune again to the new chunks, and check the build survived a save, a prune and a reload.
    const final = join(scratch, "final");
    await prune(docker, "prune 2", moved, { minX: -4, minZ: -4, maxX: 3, maxZ: 3 }, final);
    await voidLevelDat(final, [0, -40, 0]);
    await withServer(docker, "server 2", final, async (server) => {
      await timed("load reloaded", () => server.load("dst", MOVED.min, MOVED.max));
      await server.pack("es:fingerprint", { id: "reloaded", ...MOVED });
      await server.load("src", BOX.min, BOX.max);
      await server.pack("es:fingerprint", { id: "reloaded_old_spot", ...BOX });
    });

    const before = results.before as { hash: string };
    const verdict = {
      movedMatches: (results.after_moved as { hash: string }).hash === before.hash,
      reloadedMatches: (results.reloaded as { hash: string }).hash === before.hash,
      oldSpotEmpty: (results.after_old_spot as { solid: number }).solid === 0,
      prunedSpotEmpty: (results.reloaded_old_spot as { solid: number }).solid === 0,
    };
    console.log(JSON.stringify(verdict));
    results.verdict = verdict;
    // Which block types differ from the original, after the move and after the reload.
    const types = (id: string) => (results[id] as { byType: Record<string, string> }).byType;
    for (const id of ["after_moved", "reloaded"]) {
      const original = types("before");
      const other = types(id);
      const differ = [...new Set([...Object.keys(original), ...Object.keys(other)])].filter((type) => original[type] !== other[type]);
      console.log(`${id} differs in: ${differ.map((type) => `${type} ${original[type] ?? "-"} -> ${other[type] ?? "-"}`).join(", ") || "nothing"}`);
    }
  } finally {
    results.timings = timings;
    await mkdir(join(root, "spike", "results"), { recursive: true });
    await writeFile(join(root, "spike", "results", "editor.json"), `${JSON.stringify(results, null, 2)}\n`);
    await rm(scratch, { recursive: true, force: true });
  }
}

await main();
