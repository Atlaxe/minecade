// Paint shapes check: boots a throwaway BDS container (minecade-paintcheck, no published ports) with
// Paintball's painted blocks and spike/paint/probe.ts on a void world, then prints, for every state
// of vanilla's doors, trapdoors and fence gates, whether the painted copy is hit by rays in the same
// places as the vanilla block, and whether Bedrock takes every painted block's every state. Content
// log errors are printed at the end. Findings are in docs/spike-results.md ("Painted shapes").
//   npx tsx spike/paint/run.ts [--verbose]
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const NAME = "minecade-paintcheck";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");
const PACK_UUID = "5b0c7d0e-3f43-4f7e-9a1c-6f1d2b8e4a10";

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name paint
set_prop allow-cheats true
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

const MANIFEST = {
  format_version: 2,
  header: { name: "Minecade Paint Check", description: "Spike: painted shapes against vanilla's", uuid: PACK_UUID, version: [1, 0, 0], min_engine_version: [1, 26, 60] },
  modules: [
    { type: "data", uuid: "8d2e1f4a-6b3c-4d5e-8f9a-0b1c2d3e4f50", version: [1, 0, 0] },
    { type: "script", language: "javascript", uuid: "9e3f2a5b-7c4d-4e6f-9a0b-1c2d3e4f5a61", version: [1, 0, 0], entry: "scripts/main.js" },
  ],
  dependencies: [{ module_name: "@minecraft/server", version: "2.11.0" }],
};

async function main(): Promise<void> {
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-paintcheck-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "paint");
    await mkdir(worldDir, { recursive: true });
    const dat = await readLevelDat(join(root, "tools", "build", "fixtures", "base-level.dat"));
    bakeSettings(dat, { spawns: [[0, 100, 0]] } as never);
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: PACK_UUID, version: [1, 0, 0] }]));
    const pack = join(staging, "behavior_packs", "paint_check");
    await mkdir(join(pack, "scripts"), { recursive: true });
    await writeFile(join(pack, "manifest.json"), JSON.stringify(MANIFEST, null, 2));
    await cp(join(root, "games", "paintball", "behavior_pack", "blocks"), join(pack, "blocks"), { recursive: true });
    await build({ entryPoints: [join(here, "probe.ts")], outfile: join(pack, "scripts", "main.js"), bundle: true, format: "esm", platform: "neutral", target: "es2022", external: ["@minecraft/*"], logLevel: "warning" });
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server"] }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    const errors: string[] = [];
    const results: Record<string, unknown>[] = [];
    serverConsole.onLine((line) => {
      if (/ERROR|WARN|\[Scripting\].*(Error|error)/.test(line) && !/PAINT\||outside of the world/.test(line)) errors.push(line);
      const match = /PAINT\|(\{.*)$/.exec(line);
      if (match) results.push(JSON.parse(match[1]));
    });
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log("server started");
    for (let i = 0; ; i++) {
      if (i % 20 === 0) serverConsole.send(`tickingarea add -16 0 -16 16 0 16 paint${i} true`);
      const found = serverConsole.waitFor(/Successfully found the block|outside of the world|did not match/, 5_000).catch(() => "");
      serverConsole.send("testforblock 0 100 0 air");
      if ((await found).includes("Successfully found")) break;
      if (i > 100) throw new Error("chunks did not load");
      await delay(500);
    }
    const done = serverConsole.waitFor(/PAINT\|done/, 60_000);
    serverConsole.send("scriptevent paint:probe");
    await done;
    const shapes = results.filter((result) => result.id !== "states");
    const differ = shapes.filter((result) => normal(String(result.vanilla)) !== normal(String(result.painted)) || (result.errors as string[] | undefined)?.length);
    console.log(`${shapes.length - differ.length} of ${shapes.length} vanilla states painted to the same shape`);
    for (const result of differ) console.log(`  ${result.id}${(result.errors as string[])?.length ? ` errors: ${(result.errors as string[]).join("; ")}` : ""}\n    vanilla ${result.vanilla}\n    painted ${result.painted}  ${JSON.stringify(result.target)}`);
    console.log(JSON.stringify(results.find((result) => result.id === "states")));
    if (errors.length > 0) console.log(`server errors and warnings:\n  ${errors.join("\n  ")}`);
    serverConsole.send("stop");
    await Promise.race([container.wait(), delay(20_000)]);
    serverConsole.close();
  } finally {
    await container.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * A signature with each hit's depth to a sixteenth: a custom block reports a face on the block's
 * far edge (east, south, top) at 0 where vanilla says 1, so those read as 1.
 */
function normal(signature: string): string {
  return signature.replace(/(\w+)@([\d.]+)/g, (_, face: string, depth: string) => {
    const value = Number(depth) === 0 && ["East", "South", "Up"].includes(face) ? 1 : Number(depth);
    return `${face}@${Math.round(value * 16)}`;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
