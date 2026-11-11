// Builds every server target into dist/templates/servers/<target>/, writes dist/registry.json,
// and bundles the orchestrator into dist/orchestrator/. A target is the lobby (lobby/), a game
// (games/<id>/ with a game.config.ts), or the map editor (editor/, packs only). Everything is
// validated first, and all problems are reported together. Packs are built by packs.ts, and every
// server gets the shared packs (the core resource pack, the shared blocks pack and the rest): they're
// built once into dist/shared/, which the image copies into BDS's own pack folders, and each
// template gets the world's pack lists with them in. The blocks pack comes twice: whole, and the
// network's cut of it, only the blocks the published maps use (blocks-cut.ts), which every server
// loads but a game whose config asks for every block (blocks: "full"). The maps are the published ones in the map
// store (tools/maps), as their catalog has them: each map's card (<target>/<map>.json: its name and
// kits) and preview (<target>/<map>.png), and each game's picture (<game>/icon.png), in the store's
// published\catalog\, or MAPS_CATALOG, which the Docker build sets. Their worlds aren't built in:
// servers read them from the store's published\worlds\, mounted at /maps. A game with no
// published map is skipped with a warning. A game that borrows other games' maps (map.borrow:
// Gunfight plays Siege's) lists their published maps after its own, each with its owner, once the
// build has checked their games ask at least what it asks of a map. A target can also have private
// packs (<target>/private_packs/<name>/, git-ignored, filled from outside the repo: packs.ts,
// privatePacks), which go into its template only.
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  holoPictures,
  holoPortraits,
  mapRequirements,
  possibleTeams,
  uncoveredRequirements,
  skinTexture,
  type GameConfig,
  type LobbyConfig,
  type PlayerSkin,
  type Registry,
  type RegistryGame,
} from "@minecade/minigame-core/config";
import { encodePng } from "../skins/png.ts";
import { RENDERS, renderSkinSet } from "../skins/skin-set.ts";
import { readSkins } from "../skins/store.ts";
import { writeArmorPack } from "../assets/armor.ts";
import { catalogDir } from "../maps/paths.ts";
import type { MapCard } from "../maps/store.ts";
import { cutBlocksPack } from "./blocks-cut.ts";
import { addGameKitPictures } from "./kit-pictures.ts";
import { addTeamButtons } from "./team-buttons.ts";
import { pinManifest, type Manifest } from "./mc-versions.ts";
import { addSharedPacks, buildBehaviorPack, buildResourcePack, hasContent, PACK_PREFIX, privatePacks, sharedPacks, writePackLists, type SharedPack } from "./packs.ts";
import { validateGameConfig } from "./validate.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(root, "dist");
const catalog = catalogDir(root);
/** The map editor's target: packs only, no maps (tools/editor stages the map it edits). */
const EDITOR = "editor";

interface Target {
  id: string;
  dir: string;
  game?: GameConfig;
  /** The lobby's lobby/lobby.config.ts, when it has one. */
  lobby?: LobbyConfig;
  /** Every team the game can have, for team spawns and "<name>.<team>" keys. */
  teams: { id: string; name: string }[];
  /** A game whose maps are all drafts: not built at all. */
  skip?: boolean;
  behaviorPack?: Manifest;
  resourcePack?: Manifest;
  /** Packs from outside the repo in its private_packs/ (git-ignored; packs.ts, privatePacks). */
  privatePacks: { pack: SharedPack; manifest: Manifest }[];
  /** The game's 16:9 icon.png (without one, the lobby shows the stand-in picture). */
  icon?: string;
  /** The published maps, by their cards in the catalog: its own, then the ones it borrows (with their owner game). */
  maps: { id: string; card: MapCard; preview?: string; owner?: string }[];
}

const problems: string[] = [];
const warnings: string[] = [];
const uuids = new Map<string, string>();

function report(path: string, list: string[]): void {
  for (const problem of list) problems.push(`${relative(root, path)}: ${problem}`);
}

function warn(path: string, list: string[]): void {
  for (const warning of list) warnings.push(`${relative(root, path)}: ${warning}`);
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

async function loadTarget(id: string, dir: string, configPath?: string): Promise<Target> {
  const target: Target = { id, dir, teams: [], maps: [], privatePacks: [] };
  const kind = id === "lobby" ? "lobby" : "game";
  if (configPath && kind === "lobby") {
    target.lobby = (await import(pathToFileURL(configPath).href)).default as LobbyConfig;
  } else if (configPath) {
    target.game = (await import(pathToFileURL(configPath).href)).default as GameConfig;
    report(configPath, validateGameConfig(target.game, id));
    if (target.game.teams) target.teams = possibleTeams(target.game.teams).map(({ id: teamId, name }) => ({ id: teamId, name }));
  }
  if (existsSync(join(dir, "behavior_pack", "manifest.json"))) target.behaviorPack = await loadManifest(join(dir, "behavior_pack"));
  const rpDir = join(dir, "resource_pack");
  // A game whose players pick kits ships its pack even with nothing else in it: the build draws the kit pictures into it.
  const pictures = target.game?.kits?.select !== undefined;
  if (existsSync(join(rpDir, "manifest.json")) && (pictures || (await hasContent(rpDir)))) target.resourcePack = await loadManifest(rpDir);
  for (const pack of await privatePacks(dir, id)) {
    const manifest = await loadManifest(pack.dir);
    if (manifest) target.privatePacks.push({ pack, manifest });
  }
  if (id === EDITOR) return target;

  // Every map in the catalog was checked when it was published (the map editor's checklist is the
  // map rules the build used to check), so only its card is read here.
  const mapsDir = join(catalog, id);
  target.maps.push(...(await publishedMaps(id)));
  for (const owner of target.game?.map?.borrow ?? []) {
    for (const map of await publishedMaps(owner)) {
      if (target.maps.some((other) => other.id === map.id)) report(join(catalog, owner, `${map.id}.json`), [`has the same id as another of ${id}'s maps, which borrows it`]);
      else target.maps.push({ ...map, owner });
    }
  }
  const borrowedOnly = target.maps.length > 0 && target.maps.every((map) => map.owner !== undefined);
  if (target.maps.length === 0 && kind === "game") {
    // A new game's first map is made in the map editor, which reads games/ itself.
    warn(dir, ["no published maps yet, so the game is skipped (make one in the map editor)"]);
    target.skip = true;
  } else if (target.maps.length === 0) {
    report(dir, [`needs at least one published map (none in ${mapsDir}: publish one in the map editor, or npm run maps -- export)`]);
  }
  if (target.game && !target.skip) {
    const icon = join(mapsDir, "icon.png");
    if (existsSync(icon)) target.icon = icon;
    // A game playing only other games' maps has none of its own to take its picture on yet: the lobby shows the stand-in.
    else if (borrowedOnly) warn(dir, ["has no picture yet (it plays only other games' maps): the lobby shows the stand-in picture"]);
    // Without one the lobby shows the stand-in too: a missing picture never keeps the network from starting.
    else warn(dir, ["has no picture yet, so the lobby shows the stand-in picture (take one with the map editor's Camera tool on its thumbnail map)"]);
  }
  return target;
}

/** A game's published maps in the catalog, by their cards (name, blocks) and previews. */
async function publishedMaps(game: string): Promise<{ id: string; card: MapCard; preview?: string }[]> {
  const mapsDir = join(catalog, game);
  const entries = existsSync(mapsDir) ? await readdir(mapsDir, { withFileTypes: true }) : [];
  const maps: { id: string; card: MapCard; preview?: string }[] = [];
  for (const file of entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort()) {
    const mapId = file.slice(0, -".json".length);
    const cardPath = join(mapsDir, file);
    const card = (await readJson(cardPath)) as MapCard | undefined;
    if (card === undefined) continue;
    if (typeof card.name !== "string" || card.name.trim() === "") {
      report(cardPath, ["has no name"]);
      continue;
    }
    const preview = join(mapsDir, `${mapId}.png`);
    maps.push({ id: mapId, card, ...(existsSync(preview) ? { preview } : {}) });
  }
  return maps;
}

/**
 * Each borrowing game's lenders must be games that ask at least what it asks of a map, so any map
 * they publish will do for it too (a lender game skipped for having no maps lends none).
 */
function checkBorrowed(all: Target[]): void {
  for (const target of all) {
    const game = target.game;
    if (!game?.map?.borrow) continue;
    const needs = mapRequirements(game.map, { kind: "game", maxPlayers: game.maxPlayers, teams: target.teams });
    for (const owner of game.map.borrow) {
      const lender = all.find((candidate) => candidate.id === owner);
      if (!lender?.game) {
        report(join(target.dir, "game.config.ts"), [`map.borrow: "${owner}" isn't a game`]);
        continue;
      }
      const has = mapRequirements(lender.game.map, { kind: "game", maxPlayers: lender.game.maxPlayers, teams: lender.teams });
      const missing = uncoveredRequirements(needs, has);
      if (missing.length > 0) report(join(target.dir, "game.config.ts"), [`map.borrow: ${lender.game.name}'s maps needn't have ${missing.map((requirement) => requirement.label).join(", ")}, which ${game.name} needs`]);
    }
  }
}

async function discoverTargets(): Promise<Target[]> {
  const lobbyConfig = join(root, "lobby", "lobby.config.ts");
  const targets = [await loadTarget("lobby", join(root, "lobby"), existsSync(lobbyConfig) ? lobbyConfig : undefined)];
  for (const id of (await readdir(join(root, "games"))).sort()) {
    const configPath = join(root, "games", id, "game.config.ts");
    if (existsSync(configPath)) targets.push(await loadTarget(id, join(root, "games", id), configPath));
  }
  checkBorrowed(targets);
  const editorDir = join(root, EDITOR);
  if (existsSync(join(editorDir, "behavior_pack", "manifest.json"))) targets.push(await loadTarget(EDITOR, editorDir));
  return targets.filter((target) => !target.skip);
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
 * renders, the team form's buttons (team-buttons.ts), and the hologram's picture and portrait lists
 * from holoPictures() and holoPortraits(), which the lobby's Hologram numbers the same way.
 */
async function addGameIcons(out: string): Promise<void> {
  await addTeamButtons(out, registry);
  for (const [path, png] of playerSkins.files) {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), png);
  }
  for (const target of targets) {
    if (target.icon) await cp(target.icon, join(out, "textures", "minecade", "games", `${target.id}.png`));
    // A borrowed map's preview is its own game's, copied there.
    for (const map of target.maps) {
      if (map.preview && !map.owner) await cp(map.preview, join(out, "textures", "minecade", "maps", target.id, `${map.id}.png`));
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

function pick({ id, name, description, minPlayers, maxPlayers, test, teams, options, stats }: GameConfig, hasIcon: boolean): Omit<RegistryGame, "maps"> {
  return {
    id,
    name,
    description,
    minPlayers,
    maxPlayers,
    ...(test ? { test } : {}),
    // Without one (no picture published yet), the lobby shows the stand-in.
    ...(hasIcon ? { icon: `textures/minecade/games/${id}` } : {}),
    ...(teams ? { teams } : {}),
    ...(options ? { options } : {}),
    ...(stats ? { stats } : {}),
  };
}

/** The blocks pack's folders in the container, whole and cut. */
const FULL_NAMES = [`${PACK_PREFIX}blocks_bp`, `${PACK_PREFIX}blocks_rp`];
const CUT_NAMES = [`${PACK_PREFIX}blocks_cut_bp`, `${PACK_PREFIX}blocks_cut_rp`];

/**
 * Cuts the blocks pack down to the blocks the published maps use (into dist/blocks-cut/), and adds
 * the cut to the shared packs. False when there's nothing to cut, or a map's card doesn't say which
 * blocks it uses: every server gets the whole pack then.
 */
async function cutBlocks(): Promise<boolean> {
  const whole = shared.filter(({ pack }) => pack.name === "blocks_bp" || pack.name === "blocks_rp");
  if (whole.length !== 2) return false;
  const cards = targets.flatMap((target) => target.maps.map((map) => map.card));
  if (cards.some((card) => !Array.isArray(card.customNames))) {
    console.warn("the map catalog doesn't say which blocks the maps use (npm run maps -- export writes it again), so every server gets the whole blocks pack");
    return false;
  }
  const out = join(dist, "blocks-cut");
  const result = await cutBlocksPack(join(root, "packs", "blocks"), out, cards.flatMap((card) => card.customNames));
  for (const [kind, name] of [["behavior", "blocks_cut_bp"], ["resource", "blocks_cut_rp"]] as const) {
    const dir = join(out, `${kind}_pack`);
    const manifest = await loadManifest(dir);
    if (!manifest) throw new Error(`the cut blocks pack's ${kind} manifest: ${problems.join("; ")}`);
    shared.push({ pack: { kind, name, dir }, manifest });
  }
  console.log(`cut the blocks pack to the ${result.kept} blocks the published maps use (of ${result.of})`);
  return true;
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
// The dyed leather armor pack is Minecraft's leather tinted, so it's written here from the textures
// on this PC (or their cache) rather than kept in git.
if (!writeArmorPack()) warnings.push("packs/armor: Minecraft's leather textures aren't here, so the armor pack stays as it was (see tools/build/vanilla-textures.ts)");
if (warnings.length > 0) console.warn(`${warnings.length} warning${warnings.length === 1 ? "" : "s"}:\n  ${warnings.join("\n  ")}`);
// Every server gets the shared packs (the core resource pack, the shared blocks pack and the rest).
const shared: { pack: SharedPack; manifest: Manifest }[] = [];
for (const pack of await sharedPacks()) {
  const manifest = await loadManifest(pack.dir);
  if (manifest) shared.push({ pack, manifest });
}
if (problems.length > 0) {
  console.error(`Build stopped: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// Known before any bundling, so the lobby pack can embed it ("#registry"). Each entry carries what
// its maps need (the map editor's checklist).
const lobbyTarget = targets.find((target) => target.id === "lobby")!;
const registry: Registry = {
  games: targets.flatMap(({ game, maps, teams, icon }) =>
    game
      ? [
          {
            ...pick(game, icon !== undefined),
            maps: maps.map((map) => ({
              id: map.id,
              name: map.card.name,
              ...(map.preview ? { preview: `textures/minecade/maps/${map.owner ?? game.id}/${map.id}` } : {}),
              ...(map.owner ? { owner: map.owner } : {}),
            })),
            mapRequirements: mapRequirements(game.map, { kind: "game", maxPlayers: game.maxPlayers, teams }),
          },
        ]
      : [],
  ),
  lobby: {
    maps: lobbyTarget.maps.map((map) => ({ id: map.id, name: map.card.name })),
    mapRequirements: mapRequirements(lobbyTarget.lobby?.map, { kind: "lobby" }),
  },
};

// Also known before any bundling, for "#skins".
const playerSkins = await renderPlayerSkins();

await rm(dist, { recursive: true, force: true });
const cut = await cutBlocks();
// Once for every server (the image puts them in BDS's own pack folders), named as in the container.
const sharedOut = join(dist, "shared");
await addSharedPacks(sharedOut, shared, PACK_PREFIX);
for (const target of targets) {
  const out = join(dist, "templates", "servers", target.id);
  await mkdir(out, { recursive: true });
  if (target.behaviorPack) {
    await buildBehaviorPack(join(target.dir, "behavior_pack"), join(out, "behavior_packs", `${target.id}_bp`), target.behaviorPack, registry, playerSkins.list);
  }
  if (target.resourcePack) {
    const game = target.game;
    const maps = target.maps.map((map) => ({ id: map.id, config: map.card }));
    const extra = target.id === "lobby" ? addGameIcons : game?.kits?.select ? (pack: string) => addGameKitPictures(pack, game, maps).then(() => {}) : undefined;
    await buildResourcePack(join(target.dir, "resource_pack"), join(out, "resource_packs", `${target.id}_rp`), target.resourcePack, extra);
  }
  await addSharedPacks(out, target.privatePacks);
  // Each server loads one blocks pack: the cut, or the whole one for a game that asks (and the editor).
  const full = target.game?.blocks === "full" || target.id === EDITOR;
  await writePackLists(out, sharedOut, (name) => cut && (full ? CUT_NAMES.includes(name) : FULL_NAMES.includes(name)));
  const parts = [...(target.maps.length > 0 ? [`maps: ${target.maps.map((map) => map.id).join(", ")}`] : []), ...(target.resourcePack ? ["resource pack"] : [])];
  console.log(`built ${target.id}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`);
}
await writeFile(join(dist, "registry.json"), JSON.stringify(registry, null, 2));
await buildOrchestrator();
console.log(`built registry.json and the orchestrator; ${playerSkins.list.length} player skin${playerSkins.list.length === 1 ? "" : "s"} rendered`);
