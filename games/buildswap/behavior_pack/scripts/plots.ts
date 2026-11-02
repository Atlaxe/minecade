// Build Swap's building areas: the map's "plot" regions, each paired with a spawn. Pure geometry
// (pairing, growing and clamping boxes, the swap), then the world side: snapshots of a build, kept
// as structures in memory so voting can show it as it was before its twist, and liquids that run
// out of an area, which are cleared from the block-thick shell around it.
import { BlockVolume, StructureSaveMode, world, type Vector3 } from "@minecraft/server";
import { describeError, inside, log, worldPoint, type Box, type MapPosition, type Vec3 } from "@minecade/minigame-core";

/** The map's region list of building areas. */
export const PLOT_REGION = "plot";
/** The structure size limit, in blocks along each side: bigger areas are saved in pieces. */
const TILE = 64;
export const LIQUIDS = ["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"];

export interface Plot {
  /** Its place in the list, which is its spawn's place in the map's spawns. */
  index: number;
  box: Box;
  /** Where its builder starts, and where everyone stands to vote on it. */
  spawn: MapPosition;
}

/** How far a point is from a box (0 inside it); boxes are whole blocks, both corners inside. */
export function distanceToBox(point: Vector3, box: Box): number {
  const gap = (value: number, axis: number) => Math.max(box.min[axis] - value, 0, value - (box.max[axis] + 1));
  return Math.hypot(gap(point.x, 0), gap(point.y, 1), gap(point.z, 2));
}

/**
 * Pairs each spawn with a building area: the one it stands in, else the nearest one still free
 * (closest pairs first). Spawns past the number of areas get none. In spawn order.
 */
export function pairPlots(spawns: readonly MapPosition[], boxes: readonly Box[]): Plot[] {
  const pairs: { spawn: number; box: number; distance: number }[] = [];
  spawns.forEach((spawn, s) => boxes.forEach((box, b) => pairs.push({ spawn: s, box: b, distance: distanceToBox(worldPoint(spawn), box) })));
  pairs.sort((a, b) => a.distance - b.distance || a.spawn - b.spawn || a.box - b.box);
  const boxOf = new Map<number, number>();
  const taken = new Set<number>();
  for (const pair of pairs) {
    if (boxOf.has(pair.spawn) || taken.has(pair.box)) continue;
    boxOf.set(pair.spawn, pair.box);
    taken.add(pair.box);
  }
  return spawns.flatMap((spawn, index) => {
    const box = boxOf.get(index);
    return box === undefined ? [] : [{ index, box: boxes[box], spawn }];
  });
}

/** A box grown by `by` blocks on every side. */
export function grow(box: Box, by: number): Box {
  return { min: box.min.map((value) => value - by) as Vec3, max: box.max.map((value) => value + by) as Vec3 };
}

/** The point nearest `point` that is inside `box` (a whole-block box reaches to max + 1). */
export function clampInto(point: Vector3, box: Box): Vector3 {
  const clamp = (value: number, axis: number) => Math.min(Math.max(value, box.min[axis] + 0.5), box.max[axis] + 0.5);
  return { x: clamp(point.x, 0), y: clamp(point.y, 1), z: clamp(point.z, 2) };
}

/** Whether the whole block at `block` is in the box. */
export function blockInside(block: Vector3, box: Box): boolean {
  return inside({ x: Math.floor(block.x) + 0.5, y: Math.floor(block.y) + 0.5, z: Math.floor(block.z) + 0.5 }, box);
}

/**
 * The twist round's swap: who builds on whose build. Everyone in `builders` moves to another's
 * area, in one shuffled loop, so nobody keeps their own (unless they're the only one). Twist
 * builder to the area's first builder.
 */
export function swapPlots(builders: readonly string[], random: () => number): Map<string, string> {
  const order = [...builders];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return new Map(order.map((name, i) => [name, order[(i + 1) % order.length]]));
}

/** The pieces a box is saved in: no bigger than the structure limit along any side. */
export function tiles(box: Box): Box[] {
  const ranges = (axis: number) => {
    const list: [number, number][] = [];
    for (let start = box.min[axis]; start <= box.max[axis]; start += TILE) list.push([start, Math.min(start + TILE - 1, box.max[axis])]);
    return list;
  };
  return ranges(0).flatMap(([x0, x1]) => ranges(1).flatMap(([y0, y1]) => ranges(2).map(([z0, z1]) => ({ min: [x0, y0, z0] as Vec3, max: [x1, y1, z1] as Vec3 }))));
}

/** The six block-thick slabs around a box (sides, top and bottom), leaving out any that cut into one of `others`. */
export function shell(box: Box, others: readonly Box[]): Box[] {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  const slabs: Box[] = [
    { min: [x0 - 1, y0, z0], max: [x0 - 1, y1, z1] },
    { min: [x1 + 1, y0, z0], max: [x1 + 1, y1, z1] },
    { min: [x0, y0, z0 - 1], max: [x1, y1, z0 - 1] },
    { min: [x0, y0, z1 + 1], max: [x1, y1, z1 + 1] },
    { min: [x0, y0 - 1, z0], max: [x1, y0 - 1, z1] },
    { min: [x0, y1 + 1, z0], max: [x1, y1 + 1, z1] },
  ];
  return slabs.filter((slab) => !others.some((other) => overlaps(slab, other)));
}

function overlaps(a: Box, b: Box): boolean {
  return [0, 1, 2].every((axis) => a.min[axis] <= b.max[axis] && b.min[axis] <= a.max[axis]);
}

function corner(at: Vec3): Vector3 {
  return { x: at[0], y: at[1], z: at[2] };
}

/** Builds saved as structures in memory, by name, until dispose(). */
export class Snapshots {
  private readonly saved = new Map<string, string[]>();

  /** Saves the blocks in `box` (no entities) as `name`. False when it couldn't (an unloaded chunk). */
  save(name: string, box: Box): boolean {
    this.forget(name);
    const dimension = world.getDimension("overworld");
    const ids: string[] = [];
    try {
      tiles(box).forEach((tile, i) => {
        const id = `minecade:buildswap_${name}_${i}`;
        world.structureManager.delete(id);
        world.structureManager.createFromWorld(id, dimension, corner(tile.min), corner(tile.max), { saveMode: StructureSaveMode.Memory, includeEntities: false, includeBlocks: true });
        ids.push(id);
      });
      this.saved.set(name, ids);
      return true;
    } catch (error) {
      log.warn(`buildswap: could not save ${name}: ${describeError(error)}`);
      for (const id of ids) this.deleteQuietly(id);
      return false;
    }
  }

  has(name: string): boolean {
    return this.saved.has(name);
  }

  /** Puts a saved build back over `box`, the area it was saved from. False when it couldn't. */
  restore(name: string, box: Box): boolean {
    const ids = this.saved.get(name);
    if (!ids) return false;
    const dimension = world.getDimension("overworld");
    try {
      tiles(box).forEach((tile, i) => world.structureManager.place(ids[i], dimension, corner(tile.min), { includeEntities: false }));
      return true;
    } catch (error) {
      log.warn(`buildswap: could not put back ${name}: ${describeError(error)}`);
      return false;
    }
  }

  dispose(): void {
    for (const name of [...this.saved.keys()]) this.forget(name);
  }

  private forget(name: string): void {
    for (const id of this.saved.get(name) ?? []) this.deleteQuietly(id);
    this.saved.delete(name);
  }

  private deleteQuietly(id: string): void {
    try {
      world.structureManager.delete(id);
    } catch {
      // gone already
    }
  }
}

/**
 * Keeps liquids in the building areas: the liquid blocks already in an area's shell when it starts
 * watching (the map's own water) stay, and any other liquid that turns up there is cleared.
 */
export class LiquidGuard {
  private readonly slabs: Box[];
  /** The map's own liquid blocks in each slab, as "x,y,z", once read (a slab in an unloaded chunk is read later). */
  private readonly original: (Set<string> | undefined)[];

  constructor(boxes: readonly Box[]) {
    this.slabs = boxes.flatMap((box) => shell(box, boxes.filter((other) => other !== box)));
    this.original = this.slabs.map(() => undefined);
  }

  /** Reads the map's own liquids: before anyone builds. */
  learn(): void {
    this.slabs.forEach((slab, i) => {
      if (this.original[i] === undefined) this.original[i] = this.liquids(slab);
    });
  }

  /** Clears liquid that ran out of an area since learn(). */
  sweep(): void {
    const dimension = world.getDimension("overworld");
    this.slabs.forEach((slab, i) => {
      const known = this.original[i];
      if (known === undefined) {
        this.original[i] = this.liquids(slab);
        return;
      }
      for (const at of this.liquids(slab) ?? []) {
        if (known.has(at)) continue;
        const [x, y, z] = at.split(",").map(Number);
        try {
          dimension.getBlock({ x, y, z })?.setType("minecraft:air");
        } catch (error) {
          log.warn(`buildswap: could not clear liquid at ${at}: ${describeError(error)}`);
        }
      }
    });
  }

  /** The liquid blocks in a slab, or undefined when its chunks aren't loaded. */
  private liquids(slab: Box): Set<string> | undefined {
    try {
      const found = world.getDimension("overworld").getBlocks(new BlockVolume(corner(slab.min), corner(slab.max)), { includeTypes: LIQUIDS }, false);
      const set = new Set<string>();
      for (const at of found.getBlockLocationIterator()) set.add(`${at.x},${at.y},${at.z}`);
      return set;
    } catch {
      return undefined;
    }
  }
}
