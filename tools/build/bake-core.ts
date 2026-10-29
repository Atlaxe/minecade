// Map baking logic with no I/O, kept apart from bake.ts so it can be unit-tested.
import nbt from "prismarine-nbt";
import type { MapConfig } from "@minecade/minigame-core";
import { getTag, setTag, type LevelDat } from "./leveldat.ts";

type Tag = Parameters<typeof setTag>[2];

/** Gamerules (top-level byte tags in level.dat) that baked maps turn off. */
const GAMERULES_OFF = ["dodaylightcycle", "doweathercycle", "domobspawning", "dofiretick", "mobgriefing", "spawnMobs"];
/** Noon. */
const BAKE_TIME = 6000;
/** Flat generator with a single air layer: an empty world. An empty layer list may fall back to the default preset. */
const FLAT_GENERATOR = 2;

/**
 * The level.dat settings of a baked map: a void world, fixed noon, no weather, mobs or fire
 * spread, and the world spawn at the first spawn point. Beta APIs are left to the build.
 */
export function bakeSettings(dat: LevelDat, map: MapConfig): void {
  const layers = parseLayers(getTag(dat, "FlatWorldLayers"));
  layers.block_layers = [{ block_name: "minecraft:air", count: 1 }];
  setTag(dat, "Generator", nbt.int(FLAT_GENERATOR) as Tag);
  setTag(dat, "FlatWorldLayers", nbt.string(JSON.stringify(layers)) as Tag);
  for (const rule of GAMERULES_OFF) setTag(dat, rule, nbt.byte(0) as Tag);
  setTag(dat, "spawnradius", nbt.int(0) as Tag);
  setTag(dat, "Time", nbt.long([0, BAKE_TIME]) as Tag);
  const [x, y, z] = map.spawns[0];
  setTag(dat, "SpawnX", nbt.int(Math.floor(x)) as Tag);
  setTag(dat, "SpawnY", nbt.int(Math.floor(y)) as Tag);
  setTag(dat, "SpawnZ", nbt.int(Math.floor(z)) as Tag);
}

/** Names the bake settings that BDS changed while the world was running. Empty if none. */
export function checkBakeSettings(dat: LevelDat, map: MapConfig): string[] {
  const [x, y, z] = map.spawns[0].map(Math.floor);
  const expected: Record<string, number> = { Generator: FLAT_GENERATOR, spawnradius: 0, SpawnX: x, SpawnY: y, SpawnZ: z };
  const changed: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    if (getTag(dat, key)?.value !== value) changed.push(key);
  }
  for (const rule of GAMERULES_OFF) {
    if (getTag(dat, rule)?.value !== 0) changed.push(rule);
  }
  const layers = parseLayers(getTag(dat, "FlatWorldLayers")).block_layers;
  if (JSON.stringify(layers) !== JSON.stringify([{ block_name: "minecraft:air", count: 1 }])) changed.push("FlatWorldLayers");
  return changed;
}

function parseLayers(tag: Tag | undefined): { block_layers: unknown[]; [key: string]: unknown } {
  const defaults = { biome_id: 1, block_layers: [], encoding_version: 6, structure_options: null, world_version: "version.post_1_18" };
  if (tag?.type !== "string") return defaults;
  try {
    return { ...defaults, ...JSON.parse(tag.value) };
  } catch {
    return defaults;
  }
}

export type Classification = { result: "ok" } | { result: "retry" | "error"; message: string };

// Lines BDS prints between a console command and the scriptevent marker sent after it.
const NOT_LOADED = /outside of the world/;
const FATAL = /Syntax error|Unknown command|Too many blocks|Ticking area contains more than|Cannot fill block|There is no such block|Unable to place block|An unknown error/;

/** Decides how a build command went from the server lines that answered it. */
export function classifyResponse(lines: string[]): Classification {
  const replies = lines.map(stripLogPrefix).filter((line) => line && !line.startsWith("Running AutoCompaction"));
  const fatal = replies.find((line) => FATAL.test(line));
  if (fatal) return { result: "error", message: fatal };
  const notLoaded = replies.find((line) => NOT_LOADED.test(line));
  if (notLoaded) return { result: "retry", message: notLoaded };
  if (replies.length === 0) return { result: "error", message: "the server printed no reply" };
  return { result: "ok" };
}

/** "[2026-10-29 02:24:21:027 ERROR] text" -> "text". */
export function stripLogPrefix(line: string): string {
  return line.replace(/^\[[^\]]*\]\s*/, "").trim();
}
