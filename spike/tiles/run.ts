// Tiles check: boots a throwaway BDS container (minecade-tilescheck, no published ports) with
// spike/tiles/pack on a void world and prints whether a script can copy an arena into far-off void
// chunks it loads with ticking areas (structures), the ticking area limits, and what a chunk reads
// once its area is gone. Findings are in docs/spike-results.md ("Arena tiles"). Build Swap and
// Guess the Build use them.
//   npx tsx spike/tiles/run.ts [--verbose]
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
const NAME = "minecade-tilescheck";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name tiles
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
  const staging = await mkdtemp(join(tmpdir(), "minecade-tilescheck-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "tiles");
    await mkdir(worldDir, { recursive: true });
    const dat = await readLevelDat(join(root, "tools", "build", "fixtures", "base-level.dat"));
    bakeSettings(dat, { spawns: [[0, 100, 0]] } as never);
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    const manifest = JSON.parse(await readFile(join(here, "pack", "manifest.json"), "utf8"));
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: manifest.header.uuid, version: manifest.header.version }]));
    await cp(join(here, "pack"), join(staging, "behavior_packs", "tiles_check"), { recursive: true });
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server"] }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    const errors: string[] = [];
    serverConsole.onLine((line) => {
      if (/ERROR|\[Scripting\].*(Error|error)/.test(line) && !/TL\||outside of the world/.test(line)) errors.push(line);
      const match = /TL\|(.*)$/.exec(line);
      if (match) console.log(match[1]);
    });
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log("server started");
    await delay(3000);
    const done = serverConsole.waitFor(/TL\|\{"id":"done"/, 120_000);
    serverConsole.send("scriptevent tl:run");
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
