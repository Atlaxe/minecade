// Builds every server target into dist/templates/servers/<target>/, writes dist/registry.json,
// and bundles the orchestrator into dist/orchestrator/. A target is the lobby (lobby/) or a game
// (games/<id>/ with a game.config.ts). Everything is validated first, and all problems are
// reported together. Each behavior pack is bundled once per transport, and the container
// entrypoint keeps the pair that matches TRANSPORT.
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { holoPictures, holoPortraits, skinTexture, type GameConfig, type MapConfig, type PlayerSkin, type Registry, type RegistryGame } from "@minecade/minigame-core/config";
import type { TransportKind } from "@minecade/minigame-core/protocol";
import { encodePng } from "../skins/png.ts";
import { RENDERS, renderSkinSet } from "../skins/skin-set.ts";
import { readSkins } from "../skins/store.ts";
import { enableBetaApis, patchLevelDat } from "./leveldat.ts";
import { MODULE_VERSIONS, pinManifest, type Manifest } from "./mc-versions.ts";
import { contentHash, withPatchVersion } from "./pack-version.ts";
import { registryPlugin, skinsPlugin, transportPlugin } from "./transport-plugin.ts";
import { validateGameConfig, validateMapConfig } from "./validate.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(root, "dist");
const TRANSPORTS: TransportKind[] = ["http", "log"];
/** Added to the HTTP variant's manifest only, so log-transport servers never load it. */
const SERVER_NET = { module_name: "@minecraft/server-net", version: MODULE_VERSIONS["@minecraft/server-net"] };
/** A pack holding only these files has no content, and clients shouldn't download it. */
const PACK_BOILERPLATE = new Set(["manifest.json", "pack_icon.png"]);

interface Target {
  id: string;
  dir: string;
  game?: GameConfig;
  behaviorPack?: Manifest;
  resourcePack?: Manifest;
  /** The game's 16:9 icon.png (required for games). */
  icon?: string;
  maps: { id: string; dir: string; config: MapConfig; preview?: string }[];
}

const problems: string[] = [];
const uuids = new Map<string, string>();

function report(path: string, list: string[]): void {
  for (const problem of list) problems.push(`${relative(root, path)}: ${problem}`);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    report(path, [`not valid JSON (${error instanceof Error ? error.message : String(error)})`]);
    return undefined;
  }
}

/** Reads and checks a pack manifest: pinned versions and UUIDs unique across every pack. */
async function loadManifest(packDir: string): Promise<Manifest | undefined> {
  const path = join(packDir, "manifest.json");
  const manifest = (await readJson(path)) as Manifest | undefined;
  if (!manifest) return undefined;
  try {
    const pinned = pinManifest(manifest);
    for (const uuid of [pinned.header.uuid, ...pinned.modules.map((module) => module.uuid)]) {
      const owner = uuids.get(uuid);
      if (owner) report(path, [`UUID ${uuid} is already used by ${owner}`]);
      uuids.set(uuid, relative(root, packDir));
    }
    return pinned;
  } catch (error) {
    report(path, [error instanceof Error ? error.message : String(error)]);
    return undefined;
  }
}

async function hasContent(dir: string): Promise<boolean> {
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && !(entry.parentPath === dir && PACK_BOILERPLATE.has(entry.name))) return true;
  }
  return false;
}

async function loadTarget(id: string, dir: string, configPath?: string): Promise<Target> {
  const target: Target = { id, dir, maps: [] };
  if (configPath) {
    target.game = (await import(pathToFileURL(configPath).href)).default as GameConfig;
    report(configPath, validateGameConfig(target.game, id));
  }
  if (existsSync(join(dir, "behavior_pack", "manifest.json"))) target.behaviorPack = await loadManifest(join(dir, "behavior_pack"));
  const rpDir = join(dir, "resource_pack");
  if (existsSync(join(rpDir, "manifest.json")) && (await hasContent(rpDir))) target.resourcePack = await loadManifest(rpDir);
  if (target.game) {
    if (existsSync(join(dir, "icon.png"))) target.icon = join(dir, "icon.png");
    else report(dir, ["icon.png is missing: the lobby's game picker and hologram show it (a 16:9 PNG, such as 320x180)"]);
  }

  const mapsDir = join(dir, "maps");
  for (const mapId of existsSync(mapsDir) ? (await readdir(mapsDir)).sort() : []) {
    const mapDir = join(mapsDir, mapId);
    const mapJson = join(mapDir, "map.json");
    if (!existsSync(mapJson)) {
      report(mapDir, ["map.json is missing"]);
      continue;
    }
    const config = await readJson(mapJson);
    if (config === undefined) continue;
    report(mapJson, validateMapConfig(config, { kind: target.game ? "game" : "lobby", maxPlayers: target.game?.maxPlayers, requires: target.game?.map }));
    if (!existsSync(join(mapDir, "world", "level.dat"))) {
      report(mapDir, ["world/level.dat is missing: run npm run bake, or drop in a world built in the client"]);
    }
    const preview = join(mapDir, "preview.png");
    target.maps.push({ id: mapId, dir: mapDir, config: config as MapConfig, ...(existsSync(preview) ? { preview } : {}) });
  }
  if (target.maps.length === 0) report(dir, ["needs at least one map in maps/<id>/"]);
  return target;
}

async function discoverTargets(): Promise<Target[]> {
  const targets = [await loadTarget("lobby", join(root, "lobby"))];
  for (const id of (await readdir(join(root, "games"))).sort()) {
    const configPath = join(root, "games", id, "game.config.ts");
    if (existsSync(configPath)) targets.push(await loadTarget(id, join(root, "games", id), configPath));
  }
  return targets;
}

async function buildBehaviorPack(src: string, out: string, manifest: Manifest, registry: Registry, skins: PlayerSkin[]): Promise<void> {
  // Everything except the sources and the manifest ships as-is (icons, texts, ...).
  await cp(src, out, { recursive: true, filter: (path) => !path.endsWith(".ts") && path !== join(src, "manifest.json") });
  for (const kind of TRANSPORTS) {
    const bundle = join(out, "scripts", `main.${kind}.js`);
    await build({
      entryPoints: [join(src, "scripts", "main.ts")],
      outfile: bundle,
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["@minecraft/*"],
      plugins: [transportPlugin(kind), registryPlugin(registry), skinsPlugin(skins)],
      logLevel: "warning",
    });
    const variant = structuredClone(manifest);
    for (const module of variant.modules) if (module.type === "script") module.entry = `scripts/main.${kind}.js`;
    if (kind === "http") variant.dependencies = [...(variant.dependencies ?? []), SERVER_NET];
    await writeFile(join(out, `manifest.${kind}.json`), JSON.stringify(variant, null, 2));
    // A script importing a module its manifest doesn't declare fails to load at all on the server.
    const declared = new Set(variant.dependencies?.map((dependency) => dependency.module_name));
    const imported = new Set([...(await readFile(bundle, "utf8")).matchAll(/from\s*"(@minecraft\/[a-z-]+)"/g)].map((match) => match[1]));
    const missing = [...imported].filter((module) => !declared.has(module));
    if (missing.length > 0) {
      throw new Error(`${relative(root, src)}: the ${kind} bundle imports ${missing.join(", ")}; add it to manifest.json dependencies`);
    }
  }
}

/**
 * Copies a resource pack (plus anything `extra` adds), versioned by its content so clients
 * download it again whenever it changes.
 */
async function buildResourcePack(src: string, out: string, manifest: Manifest, extra?: (out: string) => Promise<void>): Promise<void> {
  await cp(src, out, { recursive: true, filter: (path) => path !== join(src, "manifest.json") });
  await extra?.(out);
  const stamped = withPatchVersion(manifest, await contentHash(out));
  await writeFile(join(out, "manifest.json"), JSON.stringify(stamped, null, 2));
}

/** The hologram's "minecade:picture" and "minecade:portrait" properties go up to these (lobby behavior pack entity). */
const MAX_HOLO_PICTURES = 256;
const MAX_HOLO_PORTRAITS = 256;

/**
 * Renders of every player skin the watcher saved (skins/<xuid>/), for the lobby pack, by texture
 * path, and the list the lobby looks them up in ("#skins"). A skin that can't be drawn is left
 * out, so its player keeps their letter badge.
 */
async function renderPlayerSkins(): Promise<{ list: PlayerSkin[]; files: Map<string, Buffer> }> {
  const list: PlayerSkin[] = [];
  const files = new Map<string, Buffer>();
  for (const skin of await readSkins(join(root, "skins"))) {
    try {
      const renders = renderSkinSet(skin);
      for (const kind of RENDERS) files.set(`${skinTexture(skin.meta.xuid, kind)}.png`, encodePng(renders[kind]));
      list.push({ name: skin.meta.name, key: skin.meta.xuid });
    } catch (error) {
      console.warn(`left out ${skin.meta.name}'s skin: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { list, files };
}

/**
 * The lobby pack gets every game's picture and map preview (for the Play menus), the players' skin
 * renders, and the hologram's picture and portrait lists from holoPictures() and holoPortraits(),
 * which the lobby's Hologram numbers the same way.
 */
async function addGameIcons(out: string): Promise<void> {
  for (const [path, png] of playerSkins.files) {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), png);
  }
  for (const target of targets) {
    if (target.icon) await cp(target.icon, join(out, "textures", "minecade", "games", `${target.id}.png`));
    for (const map of target.maps) {
      if (map.preview) await cp(map.preview, join(out, "textures", "minecade", "maps", target.id, `${map.id}.png`));
    }
  }
  const entityPath = join(out, "entity", "holo_display.entity.json");
  const controllersPath = join(out, "render_controllers", "holo_display.render_controllers.json");
  if (!existsSync(entityPath) || !existsSync(controllersPath)) return;
  const entity = JSON.parse(await readFile(entityPath, "utf8"));
  const controllers = JSON.parse(await readFile(controllersPath, "utf8"));
  const pictures = holoPictures(registry);
  if (pictures.length > MAX_HOLO_PICTURES) {
    throw new Error(`the lobby hologram can show ${MAX_HOLO_PICTURES} pictures, but the games and maps have ${pictures.length}`);
  }
  const textures = entity["minecraft:client_entity"].description.textures;
  pictures.forEach((picture, index) => (textures[`picture_${index}`] = picture));
  const list = pictures.map((_, index) => `Texture.picture_${index}`);
  controllers.render_controllers["controller.render.minecade.holo_picture"].arrays.textures["Array.pictures"] = list;
  const portraits = holoPortraits(playerSkins.list);
  if (portraits.length > MAX_HOLO_PORTRAITS) {
    throw new Error(`the lobby hologram can show ${MAX_HOLO_PORTRAITS} portraits, but the badges and player skins make ${portraits.length}`);
  }
  portraits.forEach((portrait, index) => (textures[`portrait_${index}`] = portrait));
  controllers.render_controllers["controller.render.minecade.holo_portrait"].arrays.textures["Array.portraits"] = portraits.map((_, index) => `Texture.portrait_${index}`);
  await writeFile(entityPath, JSON.stringify(entity, null, 2));
  await writeFile(controllersPath, JSON.stringify(controllers, null, 2));
}

async function buildMaps(target: Target, out: string): Promise<{ id: string; name: string }[]> {
  for (const map of target.maps) {
    const mapOut = join(out, "maps", map.id);
    await cp(join(map.dir, "world"), join(mapOut, "world"), { recursive: true });
    // Worlds built by hand in the client usually lack Beta APIs, which every pack needs.
    await patchLevelDat(join(mapOut, "world", "level.dat"), enableBetaApis);
    const { build: _bakeOnly, ...runtime } = map.config;
    await writeFile(join(mapOut, "map.json"), JSON.stringify(runtime, null, 2));
  }
  return target.maps.map((map) => ({ id: map.id, name: map.config.name }));
}

function pick({ id, name, description, minPlayers, maxPlayers, teams, options, stats }: GameConfig): Omit<RegistryGame, "maps"> {
  return {
    id,
    name,
    description,
    minPlayers,
    maxPlayers,
    icon: `textures/minecade/games/${id}`,
    ...(teams ? { teams } : {}),
    ...(options ? { options } : {}),
    ...(stats ? { stats } : {}),
  };
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
    external: ["cpu-features", "*.node", "node:sqlite"],
    logLevel: "warning",
  });
}

const targets = await discoverTargets();
// Every server gets the core resource pack (the HUD timer and other shared UI), before its own.
const coreRpDir = join(root, "packages", "minigame-core", "resource_pack");
const coreResourcePack = existsSync(join(coreRpDir, "manifest.json")) ? await loadManifest(coreRpDir) : undefined;
if (problems.length > 0) {
  console.error(`Build stopped: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// Known before any bundling, so the lobby pack can embed it ("#registry").
const registry: Registry = {
  games: targets.flatMap(({ game, maps }) =>
    game
      ? [
          {
            ...pick(game),
            maps: maps.map((map) => ({
              id: map.id,
              name: map.config.name,
              ...(map.preview ? { preview: `textures/minecade/maps/${game.id}/${map.id}` } : {}),
            })),
          },
        ]
      : [],
  ),
};

// Also known before any bundling, for "#skins".
const playerSkins = await renderPlayerSkins();

await rm(dist, { recursive: true, force: true });
for (const target of targets) {
  const out = join(dist, "templates", "servers", target.id);
  await mkdir(out, { recursive: true });
  if (target.behaviorPack) {
    await buildBehaviorPack(join(target.dir, "behavior_pack"), join(out, "behavior_packs", `${target.id}_bp`), target.behaviorPack, registry, playerSkins.list);
  }
  if (coreResourcePack) await buildResourcePack(coreRpDir, join(out, "resource_packs", "core_rp"), coreResourcePack);
  if (target.resourcePack) {
    const extra = target.id === "lobby" ? addGameIcons : undefined;
    await buildResourcePack(join(target.dir, "resource_pack"), join(out, "resource_packs", `${target.id}_rp`), target.resourcePack, extra);
  }
  const maps = await buildMaps(target, out);
  console.log(`built ${target.id} (maps: ${maps.map((map) => map.id).join(", ")}${target.resourcePack ? ", resource pack" : ""})`);
}
await writeFile(join(dist, "registry.json"), JSON.stringify(registry, null, 2));
await buildOrchestrator();
console.log(`built registry.json and the orchestrator; ${playerSkins.list.length} player skin${playerSkins.list.length === 1 ? "" : "s"} rendered`);
