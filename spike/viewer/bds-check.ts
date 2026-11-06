// Map viewer spike, step 1's check: boots a throwaway BDS container (minecade-viewercheck, no
// published ports) on a copy of a map's world from the map store, with the shared blocks pack and
// spike/viewer/probe.ts, and compares BDS's topmost block of each sample column (decode.ts wrote
// them to work/viewer/spike/<target>-<map>.json) with the decoder's. The store isn't changed.
//   npx tsx spike/viewer/bds-check.ts bridges/temples [--blocks <packs\blocks folder>] [--verbose]
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import * as tar from "tar";
import { attachConsole, connectDocker, findContainerByName } from "../../tools/build/docker-util.ts";
import { enableBetaApis, readLevelDat, writeLevelDat } from "../../tools/build/leveldat.ts";
import { repoRoot, workingDir } from "../../tools/maps/paths.ts";

const NAME = "minecade-viewercheck";
const IMAGE = "minecade/bds:local";
const PACK_UUID = "0e6f3f0a-6a55-4c0e-9a51-3c1d8f0b7a21";
const verbose = process.argv.includes("--verbose");
const blocksArg = process.argv.indexOf("--blocks");
// packs\blocks is git-ignored: a worktree has only its README, so the main checkout's is the default.
const blocksDir = blocksArg > 0 ? process.argv[blocksArg + 1] : [join(repoRoot, "packs", "blocks"), join(repoRoot, "..", "network", "packs", "blocks")].find((dir) => existsSync(join(dir, "behavior_pack", "manifest.json")));
const path = process.argv[2];

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name check
set_prop allow-cheats true
set_prop content-log-console-output-enabled true
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

const MANIFEST = {
  format_version: 2,
  header: { name: "Minecade Viewer Check", description: "Spike: topmost blocks", uuid: PACK_UUID, version: [1, 0, 0], min_engine_version: [1, 26, 60] },
  modules: [{ type: "script", language: "javascript", uuid: "1f7a4b2c-8d3e-4f5a-9b6c-7d8e9f0a1b32", version: [1, 0, 0], entry: "scripts/main.js" }],
  dependencies: [{ module_name: "@minecraft/server", version: "2.11.0" }],
};

interface Sample {
  x: number;
  z: number;
  y: number;
  name: string;
  states: Record<string, string | number>;
}

async function main(): Promise<void> {
  const [target, map] = path.split("/");
  const { box, spots } = JSON.parse(await readFile(join(repoRoot, "work", "viewer", "spike", `${target}-${map}.json`), "utf8")) as { box: { min: number[]; max: number[] }; spots: Sample[] };
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-viewercheck-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "check");
    await cp(join(workingDir(target), map, "world"), worldDir, { recursive: true });
    const dat = await readLevelDat(join(worldDir, "level.dat"));
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    const packs = [{ pack_id: PACK_UUID, version: [1, 0, 0] }];
    if (blocksDir) {
      const blocks = JSON.parse(await readFile(join(blocksDir, "behavior_pack", "manifest.json"), "utf8")) as { header: { uuid: string; version: number[] } };
      await cp(join(blocksDir, "behavior_pack"), join(staging, "behavior_packs", "minecade_blocks"), { recursive: true });
      packs.push({ pack_id: blocks.header.uuid, version: blocks.header.version });
    } else console.log("no blocks pack found: custom blocks will show as unknown");
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify(packs));
    const pack = join(staging, "behavior_packs", "viewer_check");
    await mkdir(join(pack, "scripts"), { recursive: true });
    await writeFile(join(pack, "manifest.json"), JSON.stringify(MANIFEST, null, 2));
    await build({
      entryPoints: [join(repoRoot, "spike", "viewer", "probe.ts")],
      outfile: join(pack, "scripts", "main.js"),
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["@minecraft/*"],
      define: { SPOTS: JSON.stringify(spots.map(({ x, y, z }) => [x, y, z])) },
      logLevel: "warning",
    });
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server"] }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    const errors: string[] = [];
    const results: Record<string, unknown>[] = [];
    serverConsole.onLine((line) => {
      if (/ERROR|\[Scripting\].*(Error|error)/.test(line) && !/VIEWER\|/.test(line)) errors.push(line);
      const match = /VIEWER\|(.*)$/.exec(line);
      if (match) results.push(JSON.parse(match[1]) as Record<string, unknown>);
    });
    const booted = Date.now();
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log(`server started in ${((Date.now() - booted) / 1000).toFixed(1)} s`);
    // BDS sometimes garbles the first console line it reads, so the ticking area is sent until it's added.
    for (let i = 0; ; i++) {
      const added = serverConsole.waitFor(/Added ticking area|already exists/, 3_000).catch(() => "");
      serverConsole.send(`tickingarea add ${box.min[0]} 0 ${box.min[2]} ${box.max[0]} 0 ${box.max[2]} viewer true`);
      if (await added) break;
      if (i > 5) throw new Error("the ticking area was never added");
    }
    const done = serverConsole.waitFor(/VIEWER\|"done"/, 120_000);
    serverConsole.send("scriptevent viewer:probe");
    await done;
    // The same block, and every state the world stores the same (BDS's script API adds old states
    // worked out from the name, such as color and wood_type, which the world doesn't store).
    let same = 0;
    const differ: string[] = [];
    for (const spot of spots) {
      const seen = results.find((result) => result.x === spot.x && result.y === spot.y && result.z === spot.z);
      const states = (seen?.states ?? {}) as Record<string, unknown>;
      const match = seen?.name === spot.name && Object.entries(spot.states).every(([key, value]) => normal(states[key]) === value);
      if (match) same++;
      else differ.push(`  ${spot.x} ${spot.y} ${spot.z}: decoded ${spot.name} ${JSON.stringify(spot.states)}\n      BDS ${JSON.stringify(seen)}`);
    }
    console.log(`${same} of ${spots.length} spots: the same block and stored states`);
    for (const line of differ.slice(0, 30)) console.log(line);
    if (errors.length > 0) console.log(`server errors:\n  ${errors.slice(0, 20).join("\n  ")}`);
    serverConsole.send("stop");
    await Promise.race([container.wait(), delay(20_000)]);
    serverConsole.close();
  } finally {
    await container.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

/** A state's value as the world stores it: booleans as 0 and 1 (NBT bytes). */
function normal(value: unknown): unknown {
  return typeof value === "boolean" ? Number(value) : value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
