// Recoil check: boots a throwaway BDS container (minecade-recoilcheck, no published ports) with the
// shared guns behavior pack and spike/recoil/probe.ts (bundled with packages/guns' real Guns) on a
// void world with a stone floor, then prints what the probe found: each gun's shot marker cooldown,
// each gun fired by a SimulatedPlayer (its cooldowns and how its facing moved), and the teleport the
// view kick is made of on a walking and a jumping player. Content log errors and warnings come last.
// Only the server side: the held model's kick is drawn by the client, which a server can't see.
//   npx tsx spike/recoil/run.ts [--verbose]
import { mkdir, mkdtemp, rm, writeFile, cp } from "node:fs/promises";
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
const NAME = "minecade-recoilcheck";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");
const PROBE_UUID = "5b7d1f3a-6c2e-4a8b-9d0f-1e2a3b4c5d6e";
const GUNS_UUID = "e1900088-b84a-49b4-bf3b-ec99d7eaed86";

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name recoil
set_prop allow-cheats true
set_prop gamemode adventure
set_prop difficulty peaceful
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

const MANIFEST = {
  format_version: 2,
  header: { name: "Minecade Recoil Check", description: "Spike: the guns' recoil on a SimulatedPlayer", uuid: PROBE_UUID, version: [1, 0, 0], min_engine_version: [1, 26, 60] },
  modules: [{ type: "script", language: "javascript", uuid: "6c8e2a4b-7d3f-4b9c-8e1a-2f3b4c5d6e7f", version: [1, 0, 0], entry: "scripts/main.js" }],
  dependencies: [
    { module_name: "@minecraft/server", version: "2.11.0" },
    { module_name: "@minecraft/server-gametest", version: "1.0.0-beta" },
  ],
};

async function main(): Promise<void> {
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-recoilcheck-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "recoil");
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
    const pack = join(staging, "behavior_packs", "recoil_check");
    await mkdir(join(pack, "scripts"), { recursive: true });
    await writeFile(join(pack, "manifest.json"), JSON.stringify(MANIFEST, null, 2));
    // Guns takes describeError, log and Scope from minigame-core's index, which pulls in modules this
    // pack doesn't load; the shim gives it those three alone (the /config subpath resolves as usual).
    await build({
      entryPoints: [join(here, "probe.ts")],
      outfile: join(pack, "scripts", "main.js"),
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["@minecraft/*"],
      logLevel: "warning",
      plugins: [{ name: "core-shim", setup: (b) => b.onResolve({ filter: /^@minecade\/minigame-core$/ }, () => ({ path: join(here, "shim.ts") })) }],
    });
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server", "@minecraft/server-gametest"] }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    const problems: string[] = [];
    const results: Record<string, unknown>[] = [];
    serverConsole.onLine((line) => {
      if (/ERROR|WARN|\[Scripting\].*(Error|error)/.test(line) && !/RC\||outside of the world/.test(line)) problems.push(line);
      const match = /RC\|(\{.*)$/.exec(line);
      if (match) results.push(JSON.parse(match[1]));
    });
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log("server started");
    for (let i = 0; ; i++) {
      if (i % 20 === 0) serverConsole.send(`tickingarea add -16 0 -16 16 0 16 recoil${i} true`);
      const found = serverConsole.waitFor(/Successfully found the block|outside of the world|did not match/, 5_000).catch(() => "");
      serverConsole.send("testforblock 0 100 0 air");
      if ((await found).includes("Successfully found")) break;
      if (i > 100) throw new Error("chunks did not load");
      await delay(500);
    }
    serverConsole.send("fill -12 99 -12 12 99 12 stone");
    await delay(1000);
    const done = serverConsole.waitFor(/RC\|\{"id":"(done|error)"/, 120_000);
    serverConsole.send("scriptevent rc:run");
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
