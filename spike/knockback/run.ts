// Knockback check: boots a throwaway BDS container (minecade-kbcheck, no published ports) with
// spike/knockback/pack on a void world with a stone floor, spawns SimulatedPlayers and runs melee
// cases. Prints a summary per case and writes the raw results to spike/results/knockback.json.
// Findings are in docs/spike-results.md ("Knockback").
//   npx tsx spike/knockback/run.ts [cases.json] [--verbose]
// cases.json is a list of case objects (see the header of pack/scripts/main.js); default: CASES.
// The container needs a network: with none, BDS waits forever for Minecraft services.
import { readFile, mkdtemp, mkdir, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { bakeSettings } from "../../tools/build/bake-core.ts";
import { attachConsole, connectDocker, findContainerByName, type ServerConsole } from "../../tools/build/docker-util.ts";
import { enableBetaApis, readLevelDat, writeLevelDat } from "../../tools/build/leveldat.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");
const NAME = "minecade-kbcheck";
const IMAGE = "minecade/bds:local";
const verbose = process.argv.includes("--verbose");
const casesArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
set_prop level-name kb
set_prop allow-cheats true
set_prop gamemode adventure
set_prop difficulty peaceful
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
exec ./bedrock_server
`;

type Case = { id: string; [key: string]: unknown };

const MODES = ["vanilla", "zero", "cancel"];
/** Cancel cases apply the scripted knockback that matched vanilla. */
const scripted = (mode: string) => (mode === "cancel" ? { kb: [1.0, 0.4] } : {});

const CASES: Case[] = [
  // Baseline: bare hand, swords, and attack() (raycast) instead of attackEntity().
  { id: "vanilla-hand", mode: "vanilla" },
  { id: "vanilla-hand-swing", mode: "vanilla", method: "swing" },
  { id: "vanilla-wood", mode: "vanilla", weapon: "wooden_sword" },
  { id: "vanilla-iron", mode: "vanilla", weapon: "iron_sword" },
  // damage = 0 and cancel = true in beforeEvents.entityHurt.
  { id: "zero-hand", mode: "zero" },
  { id: "zero-iron", mode: "zero", weapon: "iron_sword" },
  { id: "cancel-hand", mode: "cancel" },
  // cancel + applyKnockback([h, v]) in afterEvents.entityHitEntity.
  ...[[0.4, 0.4], [0.5, 0.4], [0.9, 0.4], [1.0, 0.4], [1.1, 0.4], [2.0, 0.4], [1.0, 0.3], [1.0, 0.5]].map((kb) => ({
    id: `kb-${kb[0]}-${kb[1]}`,
    mode: "cancel",
    kb,
  })),
  // Direction: attacker off-axis, and attacker facing away from the victim.
  { id: "vanilla-diag", mode: "vanilla", attackerAt: [-0.5, 0.5] },
  { id: "cancel-diag", mode: "cancel", kb: [1.0, 0.4], attackerAt: [-0.5, 0.5] },
  { id: "vanilla-facing-away", mode: "vanilla", attackerYaw: 180 },
  // The same attacker hitting again.
  ...MODES.flatMap((mode) => [
    { id: `${mode}-cd5`, mode, hits: [0, 5], ...scripted(mode) },
    { id: `${mode}-cd9-10`, mode, hits: [0, 9, 10], ...scripted(mode) },
    { id: `${mode}-cd12`, mode, hits: [0, 12], ...scripted(mode) },
    { id: `${mode}-spam`, mode, hits: [0, 2, 4, 6, 8, 10, 12], ...scripted(mode) },
  ]),
  // Whose cooldown: the same attacker on another target, and a second attacker on the victim.
  { id: "vanilla-bystander-only", mode: "vanilla", targets: ["bystander"] },
  { id: "vanilla-othertarget-t5", mode: "vanilla", hits: [0, 5], targets: ["victim", "bystander"] },
  ...MODES.flatMap((mode) => [1, 5, 9, 10].map((t) => ({ id: `${mode}-a2-t${t}`, mode, hits: [0, t], by: ["a", "b"], ...scripted(mode) }))),
  // A stronger second hit (iron sword) from the second attacker inside the victim's cooldown.
  ...MODES.map((mode) => ({ id: `${mode}-a2-stronger-t5`, mode, hits: [0, 5], by: ["a", "b"], weapons: ["none", "iron_sword"], ...scripted(mode) })),
  // Sprinting attacker: the flag alone, and a real sprint run-up.
  { id: "vanilla-sprintflag", mode: "vanilla", sprint: "flag" },
  { id: "vanilla-run", mode: "vanilla", sprint: "run" },
  { id: "zero-run", mode: "zero", sprint: "run" },
  { id: "cancel-run-kb", mode: "cancel", kb: [1.0, 0.4], sprint: "run" },
  { id: "cancel-run-kbsprint", mode: "cancel", kb: [1.0, 0.4], kbSprint: [1.5, 0.32], sprint: "run" },
];

async function main(): Promise<void> {
  const cases: Case[] = casesArg ? JSON.parse(await readFile(casesArg, "utf8")) : CASES;
  const docker = connectDocker();
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });

  const staging = await mkdtemp(join(tmpdir(), "minecade-kbcheck-"));
  const container = await docker.createContainer({
    name: NAME,
    Image: IMAGE,
    Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT],
    OpenStdin: true,
    StdinOnce: false,
    Tty: false,
  });
  const results = new Map<string, Record<string, unknown>>();
  try {
    // World: a void world with Beta APIs and the pack; spawn at the test area.
    const worldDir = join(staging, "worlds", "kb");
    await mkdir(worldDir, { recursive: true });
    const dat = await readLevelDat(join(root, "tools", "build", "fixtures", "base-level.dat"));
    bakeSettings(dat, { spawns: [[0, 100, 0]] } as never);
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    const manifest = JSON.parse(await readFile(join(here, "pack", "manifest.json"), "utf8"));
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: manifest.header.uuid, version: manifest.header.version }]));
    await cp(join(here, "pack"), join(staging, "behavior_packs", "kb_check"), { recursive: true });
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(
      join(staging, "config", "default", "permissions.json"),
      JSON.stringify({ allowed_modules: ["@minecraft/server", "@minecraft/server-gametest"] }),
    );
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "config"]) as unknown as NodeJS.ReadableStream, {
      path: "/bds",
    });

    const serverConsole = await attachConsole(container, verbose);
    const errors: string[] = [];
    serverConsole.onLine((line) => {
      // "outside of the world" is the expected reply while the ticking area loads.
      if (/ERROR|\[Scripting\].*(Error|error)/.test(line) && !/KB\||outside of the world/.test(line)) errors.push(line);
      const match = /KB\|(.*)$/.exec(line);
      if (!match) return;
      const part = JSON.parse(match[1]);
      const entry = results.get(part.id) ?? { id: part.id, events: [], samples: [] };
      if (part.part === "events") (entry.events as unknown[]).push(...part.events);
      else if (part.part === "samples") (entry.samples as unknown[]).push(...part.samples);
      else Object.assign(entry, part, { part: undefined });
      results.set(part.id, entry);
    });
    await container.start();
    await serverConsole.waitFor(/Server started\./, 180_000);
    console.log("server started");
    const run = commandRunner(serverConsole);
    for (let i = 0; ; i++) {
      // The ticking area is sometimes not honored right after startup; re-adding it helps.
      if (i % 20 === 0) console.log((await run(`tickingarea add -32 0 -32 32 0 32 kb${i} true`)).join("\n"));
      const replies = await run("testforblock 0 99 0 air");
      if (replies.some((line) => line.includes("Successfully found the block"))) break;
      if (i > 100) throw new Error(`chunks did not load: ${replies.join(" / ")}`);
      await delay(500);
    }
    console.log((await run("fill -24 99 -24 24 99 24 stone")).join("\n"));
    await run("gamerule naturalregeneration false");
    await run("gamerule pvp true");

    const setup = serverConsole.waitFor(/KB\|\{"id":"setup"/, 15_000);
    serverConsole.send("scriptevent kb:setup");
    console.log(await setup);
    if (!results.get("setup")?.ok) throw new Error("SimulatedPlayers could not be spawned");

    for (const spec of cases) {
      const done = serverConsole.waitFor(new RegExp(`KB\\|\\{"id":"${spec.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}","part":"end"`), 30_000);
      serverConsole.send(`scriptevent kb:case ${JSON.stringify(spec)}`);
      await done;
      console.log(summarize(results.get(spec.id)!));
    }
    if (errors.length > 0) console.log(`server errors:\n  ${errors.join("\n  ")}`);
    serverConsole.send("stop");
    await Promise.race([container.wait(), delay(20_000)]);
    serverConsole.close();
  } finally {
    await mkdir(join(here, "..", "results"), { recursive: true });
    const lines = [...results.values()].map((result) => JSON.stringify(result));
    await writeFile(join(here, "..", "results", "knockback.json"), `[\n${lines.join(",\n")}\n]\n`);
    await container.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

/** One line per case: attacks, events, peak height, distance at 10 ticks and at the end. */
function summarize(result: Record<string, unknown>): string {
  if (result.error) return `${result.id}: ERROR ${result.error}`;
  const samples = result.samples as number[][];
  const events = (result.events as { ev: string; t: number; who?: string; dmg?: number; hp?: number }[])
    .map((e) => `${e.ev}@${e.t}[${e.who}]${e.dmg !== undefined ? `(dmg ${e.dmg}, hp ${e.hp})` : ""}`)
    .join(" ");
  const peak = Math.max(...samples.map((s) => s[2]));
  const peakTick = samples.find((s) => s[2] === peak)?.[0];
  const firstMove = samples.find((s) => s[1] > 0.001 || Math.abs(s[2]) > 0.001)?.[0];
  const at = (t: number) => samples.find((s) => s[0] === t)?.[1];
  const attacks = (result.attacks as { t: number; ok: boolean; by: string; target: string }[])
    .map((a) => `${a.t} ${a.by}>${a.target} ${a.ok}`)
    .join(", ");
  return (
    `${result.id}: attacks ${attacks} | hp ${result.hpBefore}->${result.hpAfter} | ${events || "no events"}\n` +
    `    first move t=${firstMove}, peak dy ${peak} at t=${peakTick}, dist t5 ${at(5)} t10 ${at(10)} t15 ${at(15)} end ${samples.at(-1)?.[1]}`
  );
}

/** Sends a console command followed by a scriptevent marker, and returns the lines in between. */
function commandRunner(serverConsole: ServerConsole) {
  let markers = 0;
  return async (command: string): Promise<string[]> => {
    const marker = `Script event kbm:m${++markers} has been sent`;
    const lines: string[] = [];
    const off = serverConsole.onLine((line) => lines.push(line));
    try {
      serverConsole.send(command);
      serverConsole.send(`scriptevent kbm:m${markers}`);
      await serverConsole.waitFor(new RegExp(marker), 10_000);
    } finally {
      off();
    }
    return lines.slice(0, lines.findIndex((line) => line.includes(marker)));
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
