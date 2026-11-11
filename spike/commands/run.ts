// Command name check: boots a throwaway BDS container (minecade-cmdcheck, no published ports) with
// spike/commands/pack, which registers custom commands under names a WorldEdit player would type
// (Bedrock reads a player's "//wand" as a command named "/wand"), then prints which names the
// registry took and what the console makes of each command. Findings are in
// docs/spike-results.md ("Custom command names"). Build Swap's selection commands use them.
//   npx tsx spike/commands/run.ts [--verbose]
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
const NAME = "minecade-cmdcheck";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");
const COMMANDS = ["/wand", "wand", "minecade:/wand", "set stone", "set red_concrete_powder", "minecade:set stone", "replace", "fix", "-set"];

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name cmd
set_prop allow-cheats true
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

async function main(): Promise<void> {
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-cmdcheck-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "cmd");
    await mkdir(worldDir, { recursive: true });
    const dat = await readLevelDat(join(root, "tools", "build", "fixtures", "base-level.dat"));
    bakeSettings(dat, { spawns: [[0, 100, 0]] } as never);
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    const manifest = JSON.parse(await readFile(join(here, "pack", "manifest.json"), "utf8"));
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: manifest.header.uuid, version: manifest.header.version }]));
    await cp(join(here, "pack"), join(staging, "behavior_packs", "cmd_check"), { recursive: true });
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    serverConsole.onLine((line) => {
      const match = /CMD\|(.*)$/.exec(line);
      if (match) console.log(match[1]);
      else if (/ERROR|\[Scripting\]/.test(line)) console.log(line);
    });
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log("server started");
    for (const command of COMMANDS) {
      const lines: string[] = [];
      const off = serverConsole.onLine((line) => lines.push(line));
      serverConsole.send(command);
      await delay(1500);
      off();
      console.log(`> ${command}: ${lines.map((line) => line.replace(/^\[[^\]]*\] /, "")).join(" | ")}`);
    }
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
