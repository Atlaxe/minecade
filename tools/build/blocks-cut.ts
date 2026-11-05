// The network's blocks pack: the shared blocks pack (packs/blocks/, every one of its 1,500 blocks)
// cut down to the blocks the published maps use, so servers load and players download far less.
// The editor, and a game whose players build (Build Swap: its config's blocks: "full"), keep the
// whole pack. The cut follows the pack's own references, the way Bedrock reads it: each kept
// block's file names its geometry, culling rules, textures and loot table, and an item names the
// block it places; the list files (terrain_texture.json, item_texture.json, flipbook_textures.json,
// blocks.json, the creative menu's catalog) keep just those blocks' entries. A kept block also
// keeps the blocks it can turn into: any block its own files name (a loot table's drop), its wall
// variant in the block script's table (data.js "w"), and a lamp's pole and the other way round
// (the block script swaps them). The script, its table, the entities, sounds and texts stay whole.
// The cut packs get uuids of their own (derived from the full packs'), so both can sit in BDS's
// pack folders, and a client never mixes them up.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Manifest } from "./mc-versions.ts";

/** Folders holding one block's (or item's) files each: only the kept ones are copied. */
const PER_BLOCK = {
  behavior: ["blocks", "items", join("loot_tables", "blocks")],
  resource: [join("models", "blocks"), "block_culling", join("textures", "minecade")],
};
/** The lists the cut rewrites (they're copied whole otherwise). */
const LISTS = {
  catalog: join("item_catalog", "crafting_item_catalog.json"),
  terrain: join("textures", "terrain_texture.json"),
  items: join("textures", "item_texture.json"),
  flipbooks: join("textures", "flipbook_textures.json"),
  sounds: "blocks.json",
};

export interface CutResult {
  /** Blocks kept, of how many. */
  kept: number;
  of: number;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Writes the cut of `src` (packs/blocks/, with behavior_pack/ and resource_pack/) to `out`, keeping
 * the blocks in `names` (any names: the ones that aren't blocks are dropped) and what they need.
 */
export async function cutBlocksPack(src: string, out: string, names: Iterable<string>): Promise<CutResult> {
  const bp = join(src, "behavior_pack");
  const rp = join(src, "resource_pack");
  const blocks = await byIdentifier(bp, "blocks", (json) => field(json, "minecraft:block", "description", "identifier"));
  const items = await byIdentifier(bp, "items", (json) => field(json, "minecraft:item", "description", "identifier"));
  const geometries = await byIdentifier(rp, join("models", "blocks"), (json) => {
    const list = field(json, "minecraft:geometry");
    return Array.isArray(list) ? field(list[0], "description", "identifier") : undefined;
  });
  const cullings = await byIdentifier(rp, "block_culling", (json) => field(json, "minecraft:block_culling_rules", "description", "identifier"));
  const terrain = (await readJson(join(rp, LISTS.terrain))) as { texture_data?: Record<string, Json> } | undefined;
  const itemTextures = (await readJson(join(rp, LISTS.items))) as { texture_data?: Record<string, Json> } | undefined;
  const turnsInto = await scriptTable(join(bp, "scripts", "data.js"));

  // The kept blocks, closed over what each can turn into, and every file and list entry they name.
  const kept = new Set<string>();
  const files = { behavior: new Set<string>(), resource: new Set<string>() };
  const terrainNames = new Set<string>();
  const itemTextureNames = new Set<string>();
  const queue = [...names].filter((name) => blocks.has(name));
  const keep = (id: string) => {
    if (blocks.has(id) && !kept.has(id)) queue.push(id);
  };
  const follow = (values: string[]) => {
    for (const value of values) {
      keep(value);
      const geometry = geometries.get(value);
      if (geometry) files.resource.add(geometry.file);
      const culling = cullings.get(value);
      if (culling) files.resource.add(culling.file);
      if (terrain?.texture_data?.[value] !== undefined) terrainNames.add(value);
      if (itemTextures?.texture_data?.[value] !== undefined) itemTextureNames.add(value);
      // A loot table (whose drops are blocks too).
      const file = value.split("/").join(sep);
      if (value.endsWith(".json") && !files.behavior.has(file) && existsSync(join(bp, file))) {
        files.behavior.add(file);
        follow(strings(readJsonSync(join(bp, file)) ?? null));
      }
    }
  };
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (kept.has(id)) continue;
    kept.add(id);
    const block = blocks.get(id)!;
    files.behavior.add(block.file);
    follow(strings(block.json));
    const wall = turnsInto[id]?.w;
    if (typeof wall === "string") keep(wall);
    if (id.endsWith("_lamp")) keep(`${id}_connector`);
    if (id.endsWith("_lamp_connector")) keep(id.slice(0, -"_connector".length));
    const item = items.get(id);
    if (item) {
      files.behavior.add(item.file);
      follow(strings(item.json));
    }
  }

  // The textures the kept list entries point at.
  for (const name of terrainNames) addTextures(rp, terrain!.texture_data![name], files.resource);
  for (const name of itemTextureNames) addTextures(rp, itemTextures!.texture_data![name], files.resource);

  await rm(out, { recursive: true, force: true });
  for (const [kind, from] of [["behavior", bp], ["resource", rp]] as const) {
    const to = join(out, `${kind}_pack`);
    const skipped = PER_BLOCK[kind].map((dir) => join(from, dir));
    await cp(from, to, { recursive: true, filter: (path) => !skipped.some((dir) => path === dir || path.startsWith(dir + sep)) });
    for (const file of files[kind]) {
      await mkdir(dirname(join(to, file)), { recursive: true });
      await cp(join(from, file), join(to, file));
    }
  }
  await writeLists(rp, join(out, "resource_pack"), bp, join(out, "behavior_pack"), { kept, terrainNames, itemTextureNames, terrain, itemTextures });
  for (const kind of ["behavior", "resource"] as const) {
    const path = join(out, `${kind}_pack`, "manifest.json");
    await writeFile(path, JSON.stringify(cutManifest(JSON.parse(await readFile(path, "utf8")) as Manifest), null, 1));
  }
  return { kept: kept.size, of: blocks.size };
}

/** The pack's own manifest with uuids of its own, the same each time for the same full pack. */
export function cutManifest(manifest: Manifest): Manifest {
  const cut = structuredClone(manifest) as Manifest & { header: { name?: string } };
  cut.header.uuid = derivedUuid(cut.header.uuid);
  if (cut.header.name) cut.header.name = `${cut.header.name} (network)`;
  for (const module of cut.modules) module.uuid = derivedUuid(module.uuid);
  for (const dependency of cut.dependencies ?? []) if (dependency.uuid) dependency.uuid = derivedUuid(dependency.uuid);
  return cut;
}

/** A uuid made from another one (a version 5 style uuid from a SHA-1 of it). */
function derivedUuid(uuid: string): string {
  const hex = createHash("sha1").update(`minecade cut blocks pack ${uuid}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const text = hex.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

async function writeLists(
  rp: string,
  rpOut: string,
  bp: string,
  bpOut: string,
  cut: {
    kept: Set<string>;
    terrainNames: Set<string>;
    itemTextureNames: Set<string>;
    terrain: { texture_data?: Record<string, Json> } | undefined;
    itemTextures: { texture_data?: Record<string, Json> } | undefined;
  },
): Promise<void> {
  const only = (data: Record<string, Json> | undefined, names: Set<string>) => Object.fromEntries(Object.entries(data ?? {}).filter(([name]) => names.has(name)));
  if (cut.terrain) await writeJson(join(rpOut, LISTS.terrain), { ...cut.terrain, texture_data: only(cut.terrain.texture_data, cut.terrainNames) });
  if (cut.itemTextures) await writeJson(join(rpOut, LISTS.items), { ...cut.itemTextures, texture_data: only(cut.itemTextures.texture_data, cut.itemTextureNames) });
  const flipbooks = await readJson(join(rp, LISTS.flipbooks));
  if (Array.isArray(flipbooks)) {
    await writeJson(join(rpOut, LISTS.flipbooks), flipbooks.filter((book) => cut.terrainNames.has(String(field(book, "atlas_tile")))));
  }
  const sounds = (await readJson(join(rp, LISTS.sounds))) as Record<string, Json> | undefined;
  if (sounds) await writeJson(join(rpOut, LISTS.sounds), Object.fromEntries(Object.entries(sounds).filter(([key]) => !key.includes(":") || cut.kept.has(key))));
  const catalog = (await readJson(join(bp, LISTS.catalog))) as { "minecraft:crafting_items_catalog"?: { categories?: { groups?: { group_identifier?: { icon?: string }; items?: Json[] }[] }[] } } | undefined;
  for (const category of catalog?.["minecraft:crafting_items_catalog"]?.categories ?? []) {
    category.groups = (category.groups ?? [])
      .map((group) => {
        const items = (group.items ?? []).filter((item) => typeof item === "string" && cut.kept.has(item));
        const icon = group.group_identifier?.icon;
        if (group.group_identifier && items.length > 0 && (icon === undefined || !cut.kept.has(icon))) group.group_identifier.icon = String(items[0]);
        return { ...group, items };
      })
      .filter((group) => group.items.length > 0);
  }
  if (catalog) await writeJson(join(bpOut, LISTS.catalog), catalog);
}

/** A list entry's texture paths (a string, or strings within it) that are files in the pack. */
function addTextures(rp: string, entry: Json | undefined, files: Set<string>): void {
  for (const value of strings(entry ?? null)) {
    for (const extension of [".png", ".tga"]) {
      if (existsSync(join(rp, `${value}${extension}`))) files.add(`${value}${extension}`.split("/").join(sep));
    }
  }
}

/** Every JSON file under the pack's `dir`, by the identifier `identify` reads from it, with its path in the pack. */
async function byIdentifier(pack: string, dir: string, identify: (json: Json) => Json | undefined): Promise<Map<string, { file: string; json: Json }>> {
  const found = new Map<string, { file: string; json: Json }>();
  if (!existsSync(join(pack, dir))) return found;
  for (const entry of await readdir(join(pack, dir), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = join(entry.parentPath, entry.name);
    const json = await readJson(path);
    const id = json === undefined ? undefined : identify(json);
    if (typeof id === "string") found.set(id, { file: relative(pack, path), json: json! });
  }
  return found;
}

/** The block script's table (data.js: BLOCKS), by block id, or {} when it can't be read. */
async function scriptTable(path: string): Promise<Record<string, { w?: Json }>> {
  if (!existsSync(path)) return {};
  const match = /export const BLOCKS = (.*);\s*$/m.exec(await readFile(path, "utf8"));
  try {
    return match ? (JSON.parse(match[1]) as Record<string, { w?: Json }>) : {};
  } catch {
    return {};
  }
}

/** Every string in a JSON value, keys included. */
function strings(value: Json): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, inner]) => [key, ...strings(inner)]);
  return [];
}

function field(value: Json | undefined, ...path: string[]): Json | undefined {
  let at = value;
  for (const key of path) {
    if (!at || typeof at !== "object" || Array.isArray(at)) return undefined;
    at = at[key];
  }
  return at;
}

function readJsonSync(path: string): Json | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as Json;
  } catch {
    return undefined;
  }
}

async function readJson(path: string): Promise<Json | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")) as Json;
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}
