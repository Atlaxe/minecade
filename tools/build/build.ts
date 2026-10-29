// Builds every server target into dist/templates/servers/<target>/, writes dist/registry.json,
// and bundles the orchestrator into dist/orchestrator/. A target is the lobby (lobby/) or a game
// (games/<id>/ with a game.config.ts). Each behavior pack is bundled once per transport, and the
// container entrypoint keeps the pair that matches TRANSPORT.
// Milestone 4 adds full validation, map baking, resource packs and shared packs.
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { GameConfig } from "@minecade/minigame-core";
import type { TransportKind } from "@minecade/minigame-core/protocol";
import { transportPlugin } from "./transport-plugin.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(root, "dist");
const TRANSPORTS: TransportKind[] = ["http", "log"];
/** Added to the HTTP variant's manifest only, so log-transport servers never load it. */
const SERVER_NET = { module_name: "@minecraft/server-net", version: "1.0.0-beta" };

interface Target {
  id: string;
  dir: string;
  game?: GameConfig;
}

interface Manifest {
  header: { uuid: string };
  modules: { type: string; uuid: string; entry?: string }[];
  dependencies?: { module_name?: string; uuid?: string; version: unknown }[];
}

async function discoverTargets(): Promise<Target[]> {
  const targets: Target[] = [{ id: "lobby", dir: join(root, "lobby") }];
  for (const id of (await readdir(join(root, "games"))).sort()) {
    const configPath = join(root, "games", id, "game.config.ts");
    if (!existsSync(configPath)) continue;
    const game = (await import(pathToFileURL(configPath).href)).default as GameConfig;
    if (game.id !== id) throw new Error(`games/${id}/game.config.ts: id "${game.id}" must match the folder name`);
    targets.push({ id, dir: join(root, "games", id), game });
  }
  return targets;
}

async function buildPack(src: string, out: string, uuids: Map<string, string>): Promise<void> {
  const manifest = JSON.parse(await readFile(join(src, "manifest.json"), "utf8")) as Manifest;
  for (const uuid of [manifest.header.uuid, ...manifest.modules.map((module) => module.uuid)]) {
    const owner = uuids.get(uuid);
    if (owner) throw new Error(`${relative(root, src)}: UUID ${uuid} is already used by ${owner}`);
    uuids.set(uuid, relative(root, src));
  }
  // Everything except the sources and the manifest ships as-is (icons, texts, ...).
  await cp(src, out, {
    recursive: true,
    filter: (path) => !path.endsWith(".ts") && path !== join(src, "manifest.json"),
  });
  for (const kind of TRANSPORTS) {
    await build({
      entryPoints: [join(src, "scripts", "main.ts")],
      outfile: join(out, "scripts", `main.${kind}.js`),
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["@minecraft/*"],
      plugins: [transportPlugin(kind)],
      logLevel: "warning",
    });
    const variant = structuredClone(manifest);
    for (const module of variant.modules) if (module.type === "script") module.entry = `scripts/main.${kind}.js`;
    if (kind === "http") variant.dependencies = [...(variant.dependencies ?? []), SERVER_NET];
    await writeFile(join(out, `manifest.${kind}.json`), JSON.stringify(variant, null, 2));
  }
}

async function buildMaps(target: Target, out: string): Promise<{ id: string; name: string }[]> {
  const mapsDir = join(target.dir, "maps");
  const maps: { id: string; name: string }[] = [];
  for (const id of existsSync(mapsDir) ? (await readdir(mapsDir)).sort() : []) {
    const world = join(mapsDir, id, "world");
    if (!existsSync(join(world, "level.dat"))) throw new Error(`${relative(root, world)}: level.dat is missing`);
    await cp(join(mapsDir, id), join(out, "maps", id), { recursive: true });
    const mapJson = join(mapsDir, id, "map.json");
    const name = existsSync(mapJson) ? (JSON.parse(await readFile(mapJson, "utf8")).name ?? id) : id;
    maps.push({ id, name });
  }
  if (maps.length === 0) throw new Error(`${relative(root, target.dir)}: needs at least one map in maps/<id>/world`);
  return maps;
}

async function buildOrchestrator(): Promise<void> {
  await build({
    entryPoints: [join(root, "orchestrator", "src", "index.ts")],
    outfile: join(dist, "orchestrator", "index.cjs"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    // ssh2 (via dockerode) loads optional native addons inside try/catch; it falls back to JS.
    external: ["cpu-features", "*.node"],
    logLevel: "warning",
  });
}

await rm(dist, { recursive: true, force: true });
const uuids = new Map<string, string>();
const registry: { games: unknown[] } = { games: [] };
for (const target of await discoverTargets()) {
  const out = join(dist, "templates", "servers", target.id);
  await mkdir(out, { recursive: true });
  const packDir = join(target.dir, "behavior_pack");
  if (existsSync(join(packDir, "manifest.json"))) {
    await buildPack(packDir, join(out, "behavior_packs", `${target.id}_bp`), uuids);
  }
  const maps = await buildMaps(target, out);
  if (target.game) {
    const { id, name, description, minPlayers, maxPlayers } = target.game;
    registry.games.push({ id, name, description, minPlayers, maxPlayers, maps });
  }
  console.log(`built ${target.id} (maps: ${maps.map((map) => map.id).join(", ")})`);
}
await writeFile(join(dist, "registry.json"), JSON.stringify(registry, null, 2));
await buildOrchestrator();
console.log("built registry.json and the orchestrator");
