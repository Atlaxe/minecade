// Block Party's arena check, headless: can a minigame's arena come from another map into a board's
// world at play time? It writes a published map's arena (the box around its bounds) as a
// .mcstructure file with no server (tools/maps/structure.ts), plus a 130 by 8 by 130 test pattern bigger
// than the 64 a script can save at once, puts both in a behavior pack's structures/ folder, and
// boots a throwaway BDS (minecade-bpcheck, no published ports) on a copy of the map's own world.
// The pack's script places the arena 3000 blocks east and compares every block with the original
// (type, states, water, container contents, sign text), then places and checks the big pattern.
// The map store is only read. Findings: docs/spike-results.md, "Block Party: arenas from another map".
//   npx tsx spike/blockparty/run.ts [<game> <map>] [--verbose]      (default: sumo sinkhole)
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { attachConsole, connectDocker, findContainerByName } from "../../tools/build/docker-util.ts";
import { enableBetaApis, readLevelDat, writeLevelDat } from "../../tools/build/leveldat.ts";
import { plainBlock, worldToStructure, writeStructure, type Vec3 } from "../../tools/maps/structure.ts";
import { publishedMap } from "./published.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const NAME = "minecade-bpcheck";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");
const [game = "sumo", map = "sinkhole"] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const BIG: Vec3 = [130, 8, 130];
const COLORS = ["minecraft:red_concrete", "minecraft:blue_concrete", "minecraft:lime_concrete", "minecraft:yellow_concrete"];

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name arena
set_prop allow-cheats true
set_prop difficulty peaceful
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

async function main(): Promise<void> {
  const source = publishedMap(game, map);
  let started = Date.now();
  const arena = worldToStructure(source.world, source.box);
  console.log(`${game}/${map} v${source.version}: box ${JSON.stringify(source.box)}, written in ${Date.now() - started} ms: ${JSON.stringify(arena.stats)}, ${arena.file.length} bytes`);

  // The big pattern: index z fastest, then y, then x, as the file wants.
  const [bx, by, bz] = BIG;
  const layer0 = new Int32Array(bx * by * bz);
  const layer1 = new Int32Array(bx * by * bz).fill(-1);
  for (let x = 0; x < bx; x++) for (let y = 0; y < by; y++) for (let z = 0; z < bz; z++) layer0[(x * by + y) * bz + z] = (x + 3 * z + 7 * y) % COLORS.length;
  const big = writeStructure(BIG, [0, 0, 0], layer0, layer1, COLORS.map((name) => plainBlock(name, arena.stats.version)));
  console.log(`big pattern ${BIG.join("x")}: ${big.length} bytes`);

  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-bpcheck-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "arena");
    await cp(source.world, worldDir, { recursive: true });
    const dat = await readLevelDat(join(worldDir, "level.dat"));
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    const manifest = JSON.parse(await readFile(join(here, "pack", "manifest.json"), "utf8"));
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: manifest.header.uuid, version: manifest.header.version }]));
    await rm(join(worldDir, "world_resource_packs.json"), { force: true });
    const pack = join(staging, "behavior_packs", "bp_check");
    await cp(join(here, "pack"), pack, { recursive: true });
    await mkdir(join(pack, "structures", "minecade"), { recursive: true });
    await writeFile(join(pack, "structures", "minecade", "arena.mcstructure"), arena.file);
    await writeFile(join(pack, "structures", "minecade", "big.mcstructure"), big);
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server"] }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    const errors: string[] = [];
    serverConsole.onLine((line) => {
      if (/ERROR|\[Scripting\].*(Error|error)|structure/i.test(line) && !/BP\|/.test(line)) errors.push(line);
      const match = /BP\|(.*)$/.exec(line);
      if (match) console.log(match[1]);
    });
    started = Date.now();
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log(`server started in ${Date.now() - started} ms`);
    await delay(3000);
    const [sx, sy, sz] = arena.stats.size;
    const spec = {
      arena: { id: "minecade:arena", min: { x: source.box.min[0], y: source.box.min[1], z: source.box.min[2] }, size: { x: sx, y: sy, z: sz }, offset: { x: 3000, y: 0, z: 0 } },
      big: { id: "minecade:big", at: { x: 6000, y: 0, z: 6000 }, colors: COLORS },
    };
    const done = serverConsole.waitFor(/BP\|\{"id":"done"/, 600_000);
    // The first console command can arrive garbled (docs/spike-results.md, "Map editor"): send it
    // again until the script answers.
    for (let attempt = 0; attempt < 5; attempt++) {
      const answered = serverConsole.waitFor(/BP\|\{"id":"limits"/, 5000).then(
        () => true,
        () => false,
      );
      serverConsole.send(`scriptevent bp:run ${JSON.stringify(spec)}`);
      if (await answered) break;
    }
    await done;
    if (errors.length > 0) console.log(`server lines worth a look:\n  ${errors.join("\n  ")}`);
    serverConsole.send("stop");
    await Promise.race([container.wait(), delay(20_000)]);
    serverConsole.close();
  } finally {
    await container.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
