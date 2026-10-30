// Bakes a map's world from its map.json: boots BDS on an empty (void) world in a temporary
// container, runs the map's build commands, and copies the result to <target>/maps/<map>/world.
//   npm run bake -- <target> <map>     for example: npm run bake -- lobby main
//   npm run bake -- --all              every map that has a "build" section
//   add --verbose to echo the server console
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as tar from "tar";
import type { GameConfig, MapConfig } from "@minecade/minigame-core/config";
import { BASE_IMAGE, buildBaseImage } from "./base-image.ts";
import { bakeSettings, checkBakeSettings, classifyResponse, stripLogPrefix } from "./bake-core.ts";
import { attachConsole, connectDocker, copyDirFromContainer, findContainerByName, type ServerConsole } from "./docker-util.ts";
import { readLevelDat, writeLevelDat } from "./leveldat.ts";
import { validateMapConfig } from "./validate.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const NAME = "minecade-bake";
/** A level.dat written by BDS 1.26.60.6. Newer servers upgrade it when they load it. */
const BASE_LEVEL_DAT = join(root, "tools", "build", "fixtures", "base-level.dat");
const COMMAND_ATTEMPTS = 15;
const LOAD_TIMEOUT_MS = 30_000;
const verbose = process.argv.includes("--verbose");

// Runs inside the container: point BDS at the prepared world and start it.
const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name bake
set_prop allow-cheats true
set_prop content-log-console-output-enabled true
exec ./bedrock_server
`;

interface MapRef {
  target: string;
  mapId: string;
  targetDir: string;
  map: MapConfig;
}

async function loadMap(target: string, mapId: string): Promise<MapRef> {
  const targetDir = target === "lobby" ? join(root, "lobby") : join(root, "games", target);
  const mapJson = join(targetDir, "maps", mapId, "map.json");
  if (!existsSync(mapJson)) throw new Error(`no map at ${relative(root, mapJson)}`);
  const map = JSON.parse(await readFile(mapJson, "utf8")) as MapConfig;
  let maxPlayers: number | undefined;
  if (target !== "lobby") {
    const config = (await import(pathToFileURL(join(targetDir, "game.config.ts")).href)).default as GameConfig;
    maxPlayers = config.maxPlayers;
  }
  const problems = validateMapConfig(map, { kind: target === "lobby" ? "lobby" : "game", maxPlayers });
  if (!map.build) problems.push('has no "build" section, so there is nothing to bake');
  if (problems.length > 0) throw new Error(`${relative(root, mapJson)}:\n  ${problems.join("\n  ")}`);
  return { target, mapId, targetDir, map };
}

async function findAllMaps(): Promise<MapRef[]> {
  const targets = ["lobby", ...(await readdir(join(root, "games"))).sort()];
  const refs: MapRef[] = [];
  for (const target of targets) {
    const mapsDir = target === "lobby" ? join(root, "lobby", "maps") : join(root, "games", target, "maps");
    if (!existsSync(mapsDir)) continue;
    for (const mapId of (await readdir(mapsDir)).sort()) {
      const mapJson = join(mapsDir, mapId, "map.json");
      if (existsSync(mapJson) && JSON.parse(await readFile(mapJson, "utf8")).build) refs.push(await loadMap(target, mapId));
    }
  }
  return refs;
}

/** Sends console commands one at a time, each followed by a scriptevent marker that ends its reply. */
function commandRunner(serverConsole: ServerConsole) {
  let markers = 0;

  async function exchange(command: string): Promise<string[]> {
    const marker = `Script event bake:m${++markers} has been sent`;
    const lines: string[] = [];
    const off = serverConsole.onLine((line) => lines.push(line));
    try {
      serverConsole.send(command);
      serverConsole.send(`scriptevent bake:m${markers}`);
      await serverConsole.waitFor(new RegExp(marker), 10_000);
    } finally {
      off();
    }
    return lines.slice(0, lines.findIndex((line) => line.includes(marker)));
  }

  async function run(command: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const outcome = classifyResponse(await exchange(command));
      if (outcome.result === "ok") return;
      if (outcome.result === "error") throw new Error(`"${command}" failed: ${outcome.message}`);
      if (attempt >= COMMAND_ATTEMPTS) throw new Error(`"${command}": the chunks never loaded (${outcome.message})`);
      await delay(1000);
    }
  }

  /** y = -64 is bedrock in every generated world except a void one. Doubles as the chunk-load wait. */
  async function probeVoid(x: number, z: number): Promise<void> {
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    for (;;) {
      const replies = (await exchange(`testforblock ${x} -64 ${z} air`)).map(stripLogPrefix);
      if (replies.some((line) => line.startsWith("Successfully found the block"))) return;
      const block = replies.find((line) => /^The block at .* is /.test(line));
      if (block) throw new Error(`the world is not void: ${block}`);
      if (Date.now() > deadline) throw new Error(`the map's chunks did not load within ${LOAD_TIMEOUT_MS / 1000} s`);
      await delay(250);
    }
  }

  return { run, probeVoid };
}

async function bake(ref: MapRef): Promise<void> {
  const label = `${ref.target}/${ref.mapId}`;
  const { bounds, build } = ref.map as Required<Pick<MapConfig, "bounds" | "build">>;
  console.log(`Baking ${label}: ${build.commands.length} build commands`);

  const staging = await mkdtemp(join(tmpdir(), "minecade-bake-"));
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const container = await docker.createContainer({
    name: NAME,
    Image: BASE_IMAGE,
    Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT],
    OpenStdin: true,
    StdinOnce: false,
    Tty: false,
  });
  try {
    // A level.dat with no db/ makes BDS generate every chunk from these settings: a void world.
    await mkdir(join(staging, "worlds", "bake"), { recursive: true });
    const dat = await readLevelDat(BASE_LEVEL_DAT);
    bakeSettings(dat, ref.map);
    await writeLevelDat(join(staging, "worlds", "bake", "level.dat"), dat);
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    const commands = commandRunner(serverConsole);
    const [minX, , minZ] = bounds.min;
    const [maxX, , maxZ] = bounds.max;
    await commands.run(`tickingarea add ${minX} 0 ${minZ} ${maxX} 0 ${maxZ} bake true`);
    await commands.probeVoid(minX, minZ);
    console.log("  void probe passed");
    for (const command of build.commands) {
      await commands.run(command);
      console.log(`  ok: ${command}`);
    }
    // A leftover ticking area would count toward the server's limit of 10 at runtime.
    await commands.run("tickingarea remove_all");
    serverConsole.send("stop");
    await container.wait();
    serverConsole.close();

    const worldDir = join(ref.targetDir, "maps", ref.mapId, "world");
    const fresh = `${worldDir}.new`;
    await rm(fresh, { recursive: true, force: true });
    await copyDirFromContainer(container, "/bds/worlds/bake", fresh);
    await rm(join(fresh, "level.dat_old"), { force: true });
    const changed = checkBakeSettings(await readLevelDat(join(fresh, "level.dat")), ref.map);
    if (changed.length > 0) console.warn(`  warning: BDS changed ${changed.join(", ")} in level.dat while baking`);
    // Retries cover Windows file watchers (VS Code) briefly holding files in the old world.
    await rm(worldDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rename(fresh, worldDir);
    console.log(`  wrote ${relative(root, worldDir)}`);
  } finally {
    await container.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!process.argv.includes("--all") && positional.length !== 2) {
  console.error("Usage: npm run bake -- <target> <map>   (for example: lobby main)\n       npm run bake -- --all");
  process.exit(1);
}
try {
  const refs = process.argv.includes("--all") ? await findAllMaps() : [await loadMap(positional[0], positional[1])];
  if (refs.length === 0) throw new Error('no map has a "build" section');
  buildBaseImage(root, verbose);
  for (const ref of refs) await bake(ref);
  console.log(`Baked ${refs.length} map${refs.length === 1 ? "" : "s"}. Commit the world folders.`);
} catch (error) {
  console.error(`Bake failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
