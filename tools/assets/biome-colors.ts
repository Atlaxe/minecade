// Writes packages/minigame-core/src/biome-colors.ts: every biome's water, grass and foliage colors
// as the client draws them, the map editor's Colors tool's presets (map.json "colors"), and plains'
// client biome without its colors, which a map's colors pack (tools/maps/colors-pack.ts) gives the
// map's own. It reads the Minecraft client's vanilla packs (its data folder: MINECRAFT_DATA, else
// two folders up from the vanilla resource pack), each kind's layers oldest first (vanilla, then
// vanilla_1.14 and on), a newer layer's file replacing an older one's:
// - the behavior packs' biomes (__brarchive/biomes.brarchive): each biome's climate;
// - the resource packs' client biomes (the same archive name): a fixed grass, foliage or water color,
//   or a color map by name; and the older biomes_client.json, for water no client biome colors;
// - the color maps (vanilla's textures/colormap.brarchive): grass.png, foliage.png and the others,
//   looked up by climate the way the client does (hot and wet toward the top left).
// Rerun after a game update that adds biomes or changes their colors, and commit the file:
//
//     npx tsx tools/assets/biome-colors.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readArchive, VANILLA_PACK } from "../build/vanilla-textures.ts";
import type { Image } from "../skins/png.ts";
import { decodeAnyPng } from "../viewer/png.ts";

export const BIOME_COLORS_FILE = fileURLToPath(new URL("../../packages/minigame-core/src/biome-colors.ts", import.meta.url));

/** The client's data folder (behavior_packs\, resource_packs\). */
const DATA = process.env.MINECRAFT_DATA ?? resolve(VANILLA_PACK, "..", "..");

/**
 * Each biome's name in the Colors tool, by its Bedrock id: Java's name for it today, or for one only
 * older worlds have, its name back then. A biome missing here stops the script, so a new one gets a name.
 */
const NAMES: Record<string, string> = {
  bamboo_jungle: "Bamboo Jungle",
  bamboo_jungle_hills: "Bamboo Jungle Hills",
  basalt_deltas: "Basalt Deltas",
  beach: "Beach",
  birch_forest: "Birch Forest",
  birch_forest_hills: "Birch Forest Hills",
  birch_forest_hills_mutated: "Tall Birch Hills",
  birch_forest_mutated: "Old Growth Birch Forest",
  cherry_grove: "Cherry Grove",
  cold_beach: "Snowy Beach",
  cold_ocean: "Cold Ocean",
  cold_taiga: "Snowy Taiga",
  cold_taiga_hills: "Snowy Taiga Hills",
  cold_taiga_mutated: "Snowy Taiga Mountains",
  crimson_forest: "Crimson Forest",
  dappled_forest: "Dappled Forest",
  deep_cold_ocean: "Deep Cold Ocean",
  deep_dark: "Deep Dark",
  deep_frozen_ocean: "Deep Frozen Ocean",
  deep_lukewarm_ocean: "Deep Lukewarm Ocean",
  deep_ocean: "Deep Ocean",
  deep_warm_ocean: "Deep Warm Ocean",
  desert: "Desert",
  desert_hills: "Desert Hills",
  desert_mutated: "Desert Lakes",
  dripstone_caves: "Dripstone Caves",
  extreme_hills: "Windswept Hills",
  extreme_hills_edge: "Mountain Edge",
  extreme_hills_mutated: "Windswept Gravelly Hills",
  extreme_hills_plus_trees: "Windswept Forest",
  extreme_hills_plus_trees_mutated: "Gravelly Mountains+",
  flower_forest: "Flower Forest",
  forest: "Forest",
  forest_hills: "Wooded Hills",
  frozen_ocean: "Frozen Ocean",
  frozen_peaks: "Frozen Peaks",
  frozen_river: "Frozen River",
  grove: "Grove",
  hell: "Nether Wastes",
  ice_mountains: "Snowy Mountains",
  ice_plains: "Snowy Plains",
  ice_plains_spikes: "Ice Spikes",
  jagged_peaks: "Jagged Peaks",
  jungle: "Jungle",
  jungle_edge: "Sparse Jungle",
  jungle_edge_mutated: "Modified Jungle Edge",
  jungle_hills: "Jungle Hills",
  jungle_mutated: "Modified Jungle",
  legacy_frozen_ocean: "Legacy Frozen Ocean",
  lukewarm_ocean: "Lukewarm Ocean",
  lush_caves: "Lush Caves",
  mangrove_swamp: "Mangrove Swamp",
  meadow: "Meadow",
  mega_taiga: "Old Growth Pine Taiga",
  mega_taiga_hills: "Giant Tree Taiga Hills",
  mesa: "Badlands",
  mesa_bryce: "Eroded Badlands",
  mesa_plateau: "Badlands Plateau",
  mesa_plateau_mutated: "Modified Badlands Plateau",
  mesa_plateau_stone: "Wooded Badlands",
  mesa_plateau_stone_mutated: "Modified Wooded Badlands Plateau",
  mushroom_island: "Mushroom Fields",
  mushroom_island_shore: "Mushroom Field Shore",
  ocean: "Ocean",
  pale_garden: "Pale Garden",
  plains: "Plains",
  redwood_taiga_hills_mutated: "Giant Spruce Taiga Hills",
  redwood_taiga_mutated: "Old Growth Spruce Taiga",
  river: "River",
  roofed_forest: "Dark Forest",
  roofed_forest_mutated: "Dark Forest Hills",
  savanna: "Savanna",
  savanna_mutated: "Windswept Savanna",
  savanna_plateau: "Savanna Plateau",
  savanna_plateau_mutated: "Shattered Savanna Plateau",
  snowy_slopes: "Snowy Slopes",
  soulsand_valley: "Soul Sand Valley",
  stone_beach: "Stony Shore",
  stony_peaks: "Stony Peaks",
  sulfur_caves: "Sulfur Caves",
  sunflower_plains: "Sunflower Plains",
  swampland: "Swamp",
  swampland_mutated: "Swamp Hills",
  taiga: "Taiga",
  taiga_hills: "Taiga Hills",
  taiga_mutated: "Taiga Mountains",
  the_end: "The End",
  warm_ocean: "Warm Ocean",
  warped_forest: "Warped Forest",
};

/** The client biome components a map's colors replace (the rest of plains' stay in its colors pack). */
const COLOR_COMPONENTS = ["minecraft:water_appearance", "minecraft:grass_appearance", "minecraft:foliage_appearance"];

type Json = Record<string, unknown>;

/** A pack layer's version, for sorting: vanilla first, then vanilla_1.14, vanilla_1.16.100 and on; undefined for other packs (experiments). */
function layerVersion(name: string): number[] | undefined {
  if (name === "vanilla") return [];
  const match = /^vanilla_(\d+(?:\.\d+)*)$/.exec(name);
  return match ? match[1].split(".").map(Number) : undefined;
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? -1) - (b[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The vanilla layers of `kind` (behavior_packs or resource_packs), oldest first. */
function layers(kind: string): string[] {
  const root = join(DATA, kind);
  return readdirSync(root)
    .map((name) => ({ name, version: layerVersion(name) }))
    .filter((layer): layer is { name: string; version: number[] } => layer.version !== undefined)
    .sort((a, b) => compareVersions(a.version, b.version))
    .map((layer) => join(root, layer.name));
}

/** Every layer's biomes.brarchive merged, by biome id (its file name's stem): the newest file of each. */
function biomeFiles(kind: string, suffix: string): Map<string, { json: Json; layer: string }> {
  const merged = new Map<string, { json: Json; layer: string }>();
  for (const layer of layers(kind)) {
    const path = join(layer, "__brarchive", "biomes.brarchive");
    if (!existsSync(path)) continue;
    for (const [name, data] of readArchive(new Uint8Array(readFileSync(path)))) {
      if (!name.endsWith(suffix)) continue;
      merged.set(name.slice(0, -suffix.length), { json: JSON.parse(new TextDecoder().decode(data)) as Json, layer });
    }
  }
  return merged;
}

/** biomes_client.json's entries across the layers, later ones' fields over earlier ones'. */
function legacyClientBiomes(): Map<string, Json> {
  const merged = new Map<string, Json>();
  for (const layer of layers("resource_packs")) {
    const path = join(layer, "biomes_client.json");
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8")
      .replace(/^﻿/, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const biomes = ((JSON.parse(text) as Json).biomes ?? {}) as Record<string, Json>;
    for (const [id, fields] of Object.entries(biomes)) merged.set(id, { ...merged.get(id), ...fields });
  }
  return merged;
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** A color map's color for a climate: the client's lookup (temperature across, temperature times downfall down, both from 1). */
function lookUp(map: Image, temperature: number, downfall: number): string {
  const t = Math.min(Math.max(temperature, 0), 1);
  const d = Math.min(Math.max(downfall, 0), 1) * t;
  const x = Math.trunc((1 - t) * (map.width - 1));
  const y = Math.trunc((1 - d) * (map.height - 1));
  const at = (y * map.width + x) * 4;
  return hex(map.data[at], map.data[at + 1], map.data[at + 2]);
}

/** Dark forests' grass: the grass color halfway to a dark green (the client's grass_is_shaded, as Java draws it). */
function shaded(color: string): string {
  const value = Number.parseInt(color.slice(1), 16);
  const mixed = ((value & 0xfefefe) + 0x28340a) >> 1;
  return hex((mixed >> 16) & 0xff, (mixed >> 8) & 0xff, mixed & 0xff);
}

function main(): void {
  const colorMaps = new Map<string, Image>();
  for (const [name, data] of readArchive(new Uint8Array(readFileSync(join(DATA, "resource_packs", "vanilla", "__brarchive", "textures", "colormap.brarchive"))))) {
    colorMaps.set(name.replace(/\.png$/, ""), decodeAnyPng(data));
  }
  const servers = biomeFiles("behavior_packs", ".biome.json");
  const clients = biomeFiles("resource_packs", ".client_biome.json");
  const legacy = legacyClientBiomes();
  const missing = [...servers.keys()].filter((id) => !NAMES[id]);
  if (missing.length > 0) throw new Error(`no name for ${missing.join(", ")}: add them to NAMES`);

  const biomes = [...servers].map(([id, server]) => {
    const climate = (((server.json["minecraft:biome"] as Json)?.components as Json)?.["minecraft:climate"] ?? {}) as { temperature?: number; downfall?: number };
    const temperature = climate.temperature ?? 0.5;
    const downfall = climate.downfall ?? 0.5;
    const components = (((clients.get(id)?.json["minecraft:client_biome"] as Json)?.components ?? {}) as Record<string, Json>);
    const tint = (component: string, fallback: string): string => {
      const color = components[component]?.color;
      if (typeof color === "string") return color.toUpperCase();
      const name = typeof color === "object" && color !== null ? String((color as Json).color_map) : fallback;
      const map = colorMaps.get(name);
      if (!map) throw new Error(`${id}: no color map "${name}"`);
      return lookUp(map, temperature, downfall);
    };
    let grass = tint("minecraft:grass_appearance", "grass");
    if (components["minecraft:grass_appearance"]?.grass_is_shaded === true) grass = shaded(grass);
    const water = components["minecraft:water_appearance"]?.surface_color ?? legacy.get(id)?.water_surface_color ?? legacy.get("default")?.water_surface_color ?? "#44AFF5";
    return { id, name: NAMES[id], water: String(water).toUpperCase(), grass, foliage: tint("minecraft:foliage_appearance", "foliage") };
  });
  biomes.sort((a, b) => a.name.localeCompare(b.name));

  const plains = clients.get("plains")?.json["minecraft:client_biome"] as Json | undefined;
  if (!plains) throw new Error("no plains client biome");
  const kept = Object.fromEntries(Object.entries((plains.components ?? {}) as Json).filter(([key]) => !COLOR_COMPONENTS.includes(key)));
  const plainsFormat = String(clients.get("plains")!.json.format_version);

  const rows = biomes.map((biome) => `  { id: ${JSON.stringify(biome.id)}, name: ${JSON.stringify(biome.name)}, water: "${biome.water}", grass: "${biome.grass}", foliage: "${biome.foliage}" },`);
  const file = `// Written by tools/assets/biome-colors.ts from the Minecraft client's vanilla packs: rerun it after a
// game update, don't edit by hand. Each biome's water, grass and foliage colors as the client draws
// them (the map editor's Colors tool's presets), and plains' client biome without those three (a
// map's colors pack keeps the rest: tools/maps/colors-pack.ts).

/** A biome's colors: its Bedrock id, its name (Java's), and its water, grass and foliage as "#RRGGBB". */
export interface BiomeColors {
  id: string;
  name: string;
  water: string;
  grass: string;
  foliage: string;
}

/** Every biome, by name. */
export const BIOME_COLORS: readonly BiomeColors[] = [
${rows.join("\n")}
];

/** Plains' client biome: its file's format version, and its components but water, grass and foliage. */
export const PLAINS_CLIENT_BIOME = {
  formatVersion: ${JSON.stringify(plainsFormat)},
  components: ${JSON.stringify(kept, null, 2).replace(/\n/g, "\n  ")},
};
`;
  writeFileSync(BIOME_COLORS_FILE, file);
  console.log(`Wrote ${biomes.length} biomes to ${BIOME_COLORS_FILE}`);
}

main();
