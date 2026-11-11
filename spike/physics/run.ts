// Block physics check: boots a throwaway BDS container (minecade-physcheck, no published ports) with
// spike/physics/pack on a void world with a stone floor, and prints whether gravity blocks put in
// the air by a script (setType, setPermutation, /setblock, fillBlocks, a structure) or by a
// SimulatedPlayer fall, and whether a script that puts a fallen block back (its falling block
// entity removed) or re-places a player's block keeps it up. Findings are in
// docs/spike-results.md ("Block physics"). Build Swap uses them.
//   npx tsx spike/physics/run.ts [--verbose]
// The container needs a network: with none, BDS waits forever for Minecraft services.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { bakeSettings } from "../../tools/build/bake-core.ts";
import { attachConsole, connectDocker, findContainerByName } from "../../tools/build/docker-util.ts";
import { enableBetaApis, readLevelDat, writeLevelDat } from "../../tools/build/leveldat.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");
const NAME = "minecade-physcheck";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name phys
set_prop allow-cheats true
set_prop gamemode creative
set_prop difficulty peaceful
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

async function main(): Promise<void> {
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-physcheck-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "phys");
    await mkdir(worldDir, { recursive: true });
    const dat = await readLevelDat(join(root, "tools", "build", "fixtures", "base-level.dat"));
    bakeSettings(dat, { spawns: [[0, 100, 0]] } as never);
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    const manifest = JSON.parse(await readFile(join(here, "pack", "manifest.json"), "utf8"));
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: manifest.header.uuid, version: manifest.header.version }]));
    await cp(join(here, "pack"), join(staging, "behavior_packs", "phys_check"), { recursive: true });
    // Build Swap's twins, to see them load and stay up.
    await cp(join(root, "games", "buildswap", "behavior_pack", "blocks"), join(staging, "behavior_packs", "phys_check", "blocks"), { recursive: true });
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server", "@minecraft/server-gametest"] }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    const errors: string[] = [];
    serverConsole.onLine((line) => {
      if (/ERROR|\[Scripting\].*(Error|error)/.test(line) && !/PH\||outside of the world/.test(line)) errors.push(line);
      const match = /PH\|(.*)$/.exec(line);
      if (match) console.log(match[1]);
    });
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log("server started");
    for (let i = 0; ; i++) {
      if (i % 20 === 0) serverConsole.send(`tickingarea add -8 0 -8 48 0 16 ph${i} true`);
      const reply = serverConsole.waitFor(/Successfully found the block|did not match|outside of the world|is not|Cannot|cannot/, 5_000).catch(() => "");
      serverConsole.send("testforblock 0 99 0 air");
      if ((await reply).includes("Successfully found")) break;
      if (i > 100) throw new Error("chunks did not load");
      await delay(500);
    }
    serverConsole.send("fill -8 99 -8 48 99 16 stone");
    serverConsole.send("gamerule dofiretick false");
    await delay(1000);
    const done = serverConsole.waitFor(/PH\|\{"id":"done"/, 120_000);
    serverConsole.send("scriptevent ph:run");
    await done;
    if (errors.length > 0) console.log(`server errors:\n  ${errors.join("\n  ")}`);
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
