// Block Party's pieces check, headless: boots a throwaway BDS (minecade-bppieces, no published
// ports) on a void world with Block Party's entities (games/blockparty/behavior_pack/entities) and
// the check pack (pieces-pack/), plus the private players pack when given, and prints what the
// server side of the spike's in-game tests does with SimulatedPlayers: the entities spawn, the
// mount carries a player while teleported and while gliding, a locked player is pushed and
// teleported, the jump button, the camera calls, and with the players pack a player riding a player
// and on another's lead. Content log errors and warnings are printed too. Findings:
// docs/spike-results.md, "Block Party".
//   npx tsx spike/blockparty/pieces.ts [--players <behavior pack folder>] [--verbose]
// The players pack is built by the workshop's block-party-players (out\behavior_pack).
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { bakeSettings } from "../../tools/build/bake-core.ts";
import { attachConsole, connectDocker, findContainerByName } from "../../tools/build/docker-util.ts";
import { enableBetaApis, readLevelDat, writeLevelDat } from "../../tools/build/leveldat.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");
const NAME = "minecade-bppieces";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");
const playersAt = process.argv.indexOf("--players");
const playersPack = playersAt > 0 ? resolve(process.argv[playersAt + 1]) : undefined;

const ENTITIES_MANIFEST = {
  format_version: 2,
  header: { name: "Block Party entities (check)", description: "games/blockparty/behavior_pack/entities", uuid: "5f2a8c41-6e9d-4b37-8a12-c4d7e3b9f065", version: [1, 0, 0], min_engine_version: [1, 26, 60] },
  modules: [{ type: "data", uuid: "a7c3e9d1-2b48-4f6a-9e05-81d6b2c4f7a3", version: [1, 0, 0] }],
};

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name pieces
set_prop allow-cheats true
set_prop difficulty peaceful
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

async function main(): Promise<void> {
  if (playersPack && !existsSync(join(playersPack, "manifest.json"))) throw new Error(`no pack at ${playersPack}`);
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-bppieces-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "pieces");
    await mkdir(worldDir, { recursive: true });
    const dat = await readLevelDat(join(root, "tools", "build", "fixtures", "base-level.dat"));
    bakeSettings(dat, { spawns: [[0, 64, 0]] } as never);
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    const packs: { dir: string; name: string }[] = [];
    const check = join(staging, "behavior_packs", "bp_pieces");
    await cp(join(here, "pieces-pack"), check, { recursive: true });
    packs.push({ dir: check, name: "check" });
    const entities = join(staging, "behavior_packs", "bp_entities");
    await cp(join(root, "games", "blockparty", "behavior_pack", "entities"), join(entities, "entities"), { recursive: true });
    await writeFile(join(entities, "manifest.json"), JSON.stringify(ENTITIES_MANIFEST, null, 2));
    packs.push({ dir: entities, name: "entities" });
    if (playersPack) {
      const players = join(staging, "behavior_packs", "bp_players");
      await cp(playersPack, players, { recursive: true });
      packs.push({ dir: players, name: "players" });
    }
    const refs = [];
    for (const pack of packs) {
      const manifest = JSON.parse(await readFile(join(pack.dir, "manifest.json"), "utf8"));
      refs.push({ pack_id: manifest.header.uuid, version: manifest.header.version });
    }
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify(refs));
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server", "@minecraft/server-gametest"] }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    const notes: string[] = [];
    serverConsole.onLine((line) => {
      const match = /BP\|(.*)$/.exec(line);
      if (match) console.log(match[1]);
      else if (/ERROR|WARN|\[Json|\[Actor|\[Entity|blockparty/i.test(line) && !/ALLOW LIST|allowlist|Allow list|=====|telemetry/i.test(line)) notes.push(line.trim());
    });
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log(`server started with ${packs.map((pack) => pack.name).join(", ")}`);
    await delay(3000);
    const done = serverConsole.waitFor(/BP\|\{"id":"done"/, 300_000);
    for (let attempt = 0; attempt < 5; attempt++) {
      const answered = serverConsole.waitFor(/BP\|\{"id":"entities"/, 8000).then(
        () => true,
        () => false,
      );
      serverConsole.send("scriptevent bp:run");
      if (await answered) break;
    }
    await done;
    if (notes.length > 0) console.log(`content log and warnings:\n  ${notes.join("\n  ")}`);
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
