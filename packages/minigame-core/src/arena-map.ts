// Arena maps (docs/maps.md, "Arena maps"): maps a game places into its own world while it plays,
// such as Block Party's minigame arenas. Each arena of a game's config (GameConfig.arenas) is its own
// entry in the map editor's list, "<game>-<arena>", with its own checklist: what the arena asks, and
// the Arena box (the "structure" region). Publish cuts that box out of the world as a structure
// (structure.mcstructure beside the published world, tools/maps/store.ts), and every server of the
// game gets each published arena map: the entrypoint puts the structures in the game's behavior pack
// and passes their map.json in the "arenas" server variable (vars.ts). The game places a structure
// where it wants it, turned a quarter or not, and reads the map's markup there through placeArena.
import type { ArenaConfig, MapEntryRequirement, MapRequirementsConfig } from "./config.ts";
import { worldPoint, type Box, type MapConfig, type MapPosition, type Vec3 } from "./map-config.ts";

/** The region every arena map has: the box cut out as its structure (labelled "Arena" in the editors). */
export const STRUCTURE_REGION = "structure";

/** The map editor's entry for one of a game's arenas: "blockparty-hotfloor". */
export function arenaTargetId(game: string, arena: string): string {
  return `${game}-${arena}`;
}

/** What an arena's maps need: its own map block, and the Arena box, no bigger than the arena allows. */
export function arenaRequirements(arena: ArenaConfig): MapRequirementsConfig {
  const own = arena.map?.regions;
  const regions: Record<string, MapEntryRequirement> = Array.isArray(own) ? Object.fromEntries(own.map((name) => [name, {}])) : { ...own };
  const box: MapEntryRequirement = { label: "Arena", maxFootprint: arena.box.footprint, ...(arena.box.height !== undefined ? { maxHeight: arena.box.height } : {}) };
  return { ...arena.map, regions: { [STRUCTURE_REGION]: box, ...regions } };
}

/** One published arena map, as a server of its game gets it (the "arenas" server variable). */
export interface ArenaMap {
  /** The map's id. */
  map: string;
  /** Its structure in the game's behavior pack ("arena:hotfloor_1"). */
  structure: string;
  /** Its map.json, as servers get it. */
  config: MapConfig;
}

/** Every published arena map a server has, by arena id. */
export type ArenaMaps = Record<string, ArenaMap[]>;

/** The map's Arena box: the first "structure" box. */
export function arenaBox(config: Pick<MapConfig, "regions">): Box | undefined {
  const box = config.regions?.[STRUCTURE_REGION]?.[0];
  return box && Array.isArray(box.min) && Array.isArray(box.max) ? box : undefined;
}

/** Quarter turns clockwise, seen from above: how a structure is placed (Bedrock's StructureRotation None, Rotate90, Rotate180, Rotate270). */
export type QuarterTurns = 0 | 1 | 2 | 3;

/** A box's size in blocks after `turns` quarter turns: x and z change places on an odd number. */
export function turnedSize(size: Vec3, turns: QuarterTurns): Vec3 {
  return turns % 2 === 1 ? [size[2], size[1], size[0]] : [size[0], size[1], size[2]];
}

/**
 * How an arena `size` across fits a slot `slot` blocks across (x by z): as it is (0), turned a quarter
 * (1), or not at all (undefined). As it is when both fit.
 */
export function turnsToFit(size: Vec3, slot: readonly [number, number]): 0 | 1 | undefined {
  if (size[0] <= slot[0] && size[2] <= slot[1]) return 0;
  if (size[2] <= slot[0] && size[0] <= slot[1]) return 1;
  return undefined;
}

/** A point where an arena map put it, placed in the world: x, y, z, and its facing turned with it (when it has one). */
export interface PlacedPoint {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  pitch?: number;
}

/** An arena map placed in the world: where its box went, and its markup there. */
export interface PlacedArena {
  /** The placed box's lowest corner and its size, after turning. */
  min: Vec3;
  size: Vec3;
  turns: QuarterTurns;
  /** A position of the map's (a block's middle for whole x and z, as worldPoint reads it), where it is now. */
  point(position: MapPosition): PlacedPoint;
  /** A box of the map's (whole blocks, both corners inside), where it is now. */
  box(box: Box): Box;
  /** A yaw of the map's, turned with it. */
  yaw(yaw: number): number;
}

/**
 * Where an arena map's markup lands when its Arena box is placed with its lowest corner at `min`,
 * turned `turns` quarter turns clockwise (the structure placed there with the same rotation). A
 * quarter turn clockwise takes east to south: x across the box becomes z, and z becomes x counted
 * from the far side.
 */
export function placeArena(config: Pick<MapConfig, "regions">, min: Vec3, turns: QuarterTurns = 0): PlacedArena {
  const box = arenaBox(config);
  if (!box) throw new Error("the map has no Arena box");
  const sx = box.max[0] - box.min[0] + 1;
  const sz = box.max[2] - box.min[2] + 1;
  const size = turnedSize([sx, box.max[1] - box.min[1] + 1, sz], turns);
  /** A point across the box (u along x, w along z, from its lowest corner), turned. */
  const turn = (u: number, w: number): [number, number] => {
    if (turns === 1) return [sz - w, u];
    if (turns === 2) return [sx - u, sz - w];
    if (turns === 3) return [w, sx - u];
    return [u, w];
  };
  const yaw = (value: number) => normalizeYaw(value + 90 * turns);
  return {
    min: [...min] as Vec3,
    size,
    turns,
    point(position) {
      const at = worldPoint(position);
      const [u, w] = turn(at.x - box.min[0], at.z - box.min[2]);
      const placed: PlacedPoint = { x: min[0] + u, y: min[1] + (at.y - box.min[1]), z: min[2] + w };
      if (position.length === 5) {
        placed.yaw = yaw(position[3]);
        placed.pitch = position[4];
      }
      return placed;
    },
    box(entry) {
      // Each corner block's middle, turned, then back to whole blocks.
      const a = turn(entry.min[0] - box.min[0] + 0.5, entry.min[2] - box.min[2] + 0.5);
      const b = turn(entry.max[0] - box.min[0] + 0.5, entry.max[2] - box.min[2] + 0.5);
      const xs = [a[0], b[0]].map((value) => min[0] + Math.floor(value));
      const zs = [a[1], b[1]].map((value) => min[2] + Math.floor(value));
      const y0 = min[1] + (entry.min[1] - box.min[1]);
      const y1 = min[1] + (entry.max[1] - box.min[1]);
      return { min: [Math.min(...xs), Math.min(y0, y1), Math.min(...zs)], max: [Math.max(...xs), Math.max(y0, y1), Math.max(...zs)] };
    },
    yaw,
  };
}

/** A yaw in (-180, 180]. */
function normalizeYaw(yaw: number): number {
  let value = ((yaw % 360) + 360) % 360;
  if (value > 180) value -= 360;
  return value;
}
