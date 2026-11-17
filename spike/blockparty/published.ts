// A published map's world in the map store, read only: where its folder is, its map.json, and the
// box around its bounds (the box an arena is cut from, until arenas mark an Arena box of their own).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publishedDir } from "../../tools/maps/paths.ts";
import type { Box, Vec3 } from "../../tools/maps/structure.ts";

export interface PublishedMap {
  game: string;
  map: string;
  version: number;
  /** The world folder (db\ and level.dat inside). */
  world: string;
  config: { name?: string; bounds?: Box | Box[]; spawns?: number[][] } & Record<string, unknown>;
  /** The box around all of its bounds boxes. */
  box: Box;
}

export function publishedMap(game: string, map: string): PublishedMap {
  const worlds = join(publishedDir(), "worlds");
  const index = JSON.parse(readFileSync(join(worlds, "index.json"), "utf8")) as Record<string, Record<string, number>>;
  const version = index[game]?.[map];
  if (version === undefined) throw new Error(`${game}/${map} isn't published (the map store's published\\worlds\\index.json)`);
  const folder = join(worlds, game, map, String(version));
  const world = join(folder, "world");
  if (!existsSync(join(world, "db"))) throw new Error(`${folder} has no world`);
  const config = JSON.parse(readFileSync(join(folder, "map.json"), "utf8")) as PublishedMap["config"];
  const boxes = config.bounds ? (Array.isArray(config.bounds) ? config.bounds : [config.bounds]) : [];
  if (boxes.length === 0) throw new Error(`${game}/${map} has no bounds to cut an arena from`);
  const min = [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => box.min[axis]))) as Vec3;
  const max = [0, 1, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis]))) as Vec3;
  return { game, map, version, world, config, box: { min, max } };
}
