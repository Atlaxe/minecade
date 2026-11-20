// Block Party's walk check, headless: boots a throwaway BDS (minecade-bpwalk, no published ports) on
// a void world, lays the test board there and walks a SimulatedPlayer over each of its 12 stretches
// exactly as the game walks a piece (walk-pack/main.ts bundles the game's own test-board.ts,
// terrain.ts, walk-plan.ts and walk-follow.ts). Prints each stretch's outcome (end: got there; stuck:
// ran out of ticks; blocked, fell: put at the end) and writes every tick to spike/results/walk.json.
// Findings: docs/spike-results.md, "Walking the test board".
//   npx tsx spike/blockparty/walk.ts [--bot] [--only 0,3,5] [--verbose]
// --bot walks the game's bot entity (as bots.ts moves it) in place of a SimulatedPlayer.
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
const NAME = "minecade-bpwalk";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > 0 ? process.argv[onlyAt + 1] : "";
const bot = process.argv.includes("--bot");
const STRETCHES = ["stairs up 2", "ladder down 2", "block up", "void gap 2", "slab down", "ladder up 3", "stair, drop 2", "partial blocks", "water gap 3", "vines up 2", "stairs down 2", "hurdle"];

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name walk
set_prop allow-cheats true
set_prop difficulty peaceful
set_prop gamemode adventure
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

interface Line {
  id: string;
  i?: number;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-bpwalk-"));
  const container = await docker.createContainer({ name: NAME, Image: IMAGE, Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT], OpenStdin: true, StdinOnce: false, Tty: false });
  try {
    const worldDir = join(staging, "worlds", "walk");
    await mkdir(worldDir, { recursive: true });
    const dat = await readLevelDat(join(root, "tools", "build", "fixtures", "base-level.dat"));
    bakeSettings(dat, { spawns: [[0, 64, 48]] } as never);
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    const pack = join(staging, "behavior_packs", "bp_walk");
    await mkdir(join(pack, "scripts"), { recursive: true });
    await cp(join(here, "walk-pack", "manifest.json"), join(pack, "manifest.json"));
    // The markers' floor block, and the bot.
    await cp(join(root, "games", "blockparty", "behavior_pack", "blocks"), join(pack, "blocks"), { recursive: true });
    await mkdir(join(pack, "entities"), { recursive: true });
    await cp(join(root, "games", "blockparty", "behavior_pack", "entities", "bot.json"), join(pack, "entities", "bot.json"));
    await build({
      entryPoints: [join(here, "walk-pack", "main.ts")],
      outfile: join(pack, "scripts", "main.js"),
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["@minecraft/*"],
      alias: { "@minecade/minigame-core": join(here, "walk-pack", "core-shim.ts") },
      logLevel: "warning",
    });
    const manifest = JSON.parse(await readFile(join(pack, "manifest.json"), "utf8"));
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: manifest.header.uuid, version: manifest.header.version }]));
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server", "@minecraft/server-gametest"] }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });

    const serverConsole = await attachConsole(container, verbose);
    const lines: Line[] = [];
    const notes: string[] = [];
    serverConsole.onLine((line) => {
      const match = /BP\|(.*)$/.exec(line);
      if (match) {
        const parsed = JSON.parse(match[1]) as Line;
        lines.push(parsed);
        if (parsed.id === "leg") console.log(summary(parsed));
        if (parsed.id === "ray") console.log(`ray down on ${String(parsed.what)}: ${String(parsed.block)} at y ${String(parsed.y)}, face ${String(parsed.face)}, faceLocation.y ${String(parsed.faceY)}`);
      } else if (/ERROR|WARN|\[Json|\[Scripting|blockparty/i.test(line) && !/ALLOW LIST|allowlist|Allow list|=====|telemetry/i.test(line)) notes.push(line.trim());
    });
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log("server started");
    await delay(3000);
    const done = serverConsole.waitFor(/BP\|\{"id":"done"/, 600_000);
    for (let attempt = 0; attempt < 5; attempt++) {
      const answered = serverConsole.waitFor(/BP\|\{"id":"started"/, 8000).then(
        () => true,
        () => false,
      );
      serverConsole.send(`scriptevent bp:walk ${bot ? "bot" : ""} ${only}`.trim());
      if (await answered) break;
    }
    await done;
    const error = lines.find((line) => line.id === "done")?.error;
    if (error) console.log(`failed: ${String(error)}`);
    if (notes.length > 0) console.log(`content log and warnings:\n  ${notes.join("\n  ")}`);
    await mkdir(join(root, "spike", "results"), { recursive: true });
    const file = bot ? "walk-bot.json" : "walk.json";
    await writeFile(join(root, "spike", "results", file), JSON.stringify(lines));
    console.log(`every tick: spike/results/${file}`);
    serverConsole.send("stop");
    await Promise.race([container.wait(), delay(20_000)]);
    serverConsole.close();
  } finally {
    await container.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

function summary(line: Line): string {
  const i = line.i ?? 0;
  return `${String(i + 1).padStart(2)} to ${String(((i + 1) % 12) + 1).padEnd(2)} ${STRETCHES[i].padEnd(16)} ${String(line.outcome).padEnd(8)} ${line.ticks}/${line.budget} ticks, ended ${line.alongLeft} short at y ${line.endY} (space ${line.bY})`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
