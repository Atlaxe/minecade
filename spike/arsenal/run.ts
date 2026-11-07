// Arsenal check: boots a throwaway BDS container (minecade-armscheck, no published ports) with the
// shared guns behavior pack and spike/arsenal/probe.ts on a void world, then prints what the probe
// found: every arsenal item and its cooldown, every arsenal entity with its model property, where the
// raycasts the bullets rely on say a block face and a mob are, and a rocket's flight. Content log
// errors and warnings are printed at the end.
//   npx tsx spike/arsenal/run.ts [--verbose]
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as tar from "tar";
import { bakeSettings } from "../../tools/build/bake-core.ts";
import { attachConsole, connectDocker, findContainerByName } from "../../tools/build/docker-util.ts";
import { enableBetaApis, readLevelDat, writeLevelDat } from "../../tools/build/leveldat.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");
const NAME = "minecade-armscheck";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");
const PROBE_UUID = "3c1d5e7f-2a4b-4c6d-8e9f-a0b1c2d3e4f5";
const GUNS_UUID = "e1900088-b84a-49b4-bf3b-ec99d7eaed86";

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name arms
set_prop allow-cheats true
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

const MANIFEST = {
  format_version: 2,
  header: { name: "Minecade Arsenal Check", description: "Spike: the arsenal's items, entities and raycasts", uuid: PROBE_UUID, version: [1, 0, 0], min_engine_version: [1, 26, 60] },
  modules: [{ type: "script", language: "javascript", uuid: "4d2e6f8a-3b5c-4d7e-9fa0-b1c2d3e4f5a6", version: [1, 0, 0], entry: "scripts/main.js" }],
  dependencies: [{ module_name: "@minecraft/server", version: "2.11.0" }],
};

async function main(): Promise<void> {
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-armscheck-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "arms");
    await mkdir(worldDir, { recursive: true });
    const dat = await readLevelDat(join(root, "tools", "build", "fixtures", "base-level.dat"));
    bakeSettings(dat, { spawns: [[0, 100, 0]] } as never);
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    await writeFile(
      join(worldDir, "world_behavior_packs.json"),
      JSON.stringify([
        { pack_id: GUNS_UUID, version: [0, 1, 0] },
        { pack_id: PROBE_UUID, version: [1, 0, 0] },
      ]),
    );
    await cp(join(root, "packs", "guns", "behavior_pack"), join(staging, "behavior_packs", "guns"), { recursive: true });
    const pack = join(staging, "behavior_packs", "arms_check");
    await mkdir(join(pack, "scripts"), { recursive: true });
    await writeFile(join(pack, "manifest.json"), JSON.stringify(MANIFEST, null, 2));
    // The rocket's flight was measured against variants of it here (no projectile gravity, no
    // physics gravity, the snowball's and the arrow's runtimes): only a vanilla runtime keeps its speed.
    await build({ entryPoints: [join(here, "probe.ts")], outfile: join(pack, "scripts", "main.js"), bundle: true, format: "esm", platform: "neutral", target: "es2022", external: ["@minecraft/*"], logLevel: "warning" });
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server"] }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    const problems: string[] = [];
    const results: Record<string, unknown>[] = [];
    serverConsole.onLine((line) => {
      if (/ERROR|WARN|\[Scripting\].*(Error|error)/.test(line) && !/ARMS\||outside of the world/.test(line)) problems.push(line);
      const match = /ARMS\|(\{.*)$/.exec(line);
      if (match) results.push(JSON.parse(match[1]));
    });
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log("server started");
    for (let i = 0; ; i++) {
      if (i % 20 === 0) serverConsole.send(`tickingarea add -16 0 -16 16 0 16 arms${i} true`);
      const found = serverConsole.waitFor(/Successfully found the block|outside of the world|did not match/, 5_000).catch(() => "");
      serverConsole.send("testforblock 0 100 0 air");
      if ((await found).includes("Successfully found")) break;
      if (i > 100) throw new Error("chunks did not load");
      await delay(500);
    }
    const done = serverConsole.waitFor(/ARMS\|\{"id":"done"/, 60_000);
    serverConsole.send("scriptevent arms:probe");
    await done;
    for (const result of results) console.log(JSON.stringify(result));
    if (problems.length > 0) console.log(`server errors and warnings:\n  ${problems.join("\n  ")}`);
    else console.log("no content log errors or warnings");
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
