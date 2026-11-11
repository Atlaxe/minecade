// The build areas of a building game (Build Swap, Guess the Build): one per copy of the map's arena
// (game/arenas.ts), each with the arena's spawn. Pure geometry (growing and clamping boxes, the
// floor, the shell around an area), then the world side: snapshots of a build, kept as structures in
// memory so a game can show a build again later (Build Swap's before its twist, Guess the Build's
// chains), and liquids that run out of an area, which are cleared from the block-thick shell around it.
import { BlockVolume, StructureSaveMode, world, type Vector3 } from "@minecraft/server";
import { structurePieces } from "../game/arenas.ts";
import { inside } from "../game/map-view.ts";
import { describeError, log } from "../log.ts";
import type { Box, MapPosition, Vec3 } from "../map-config.ts";

export const LIQUIDS = ["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"];

export interface Plot {
  /** Its arena tile's place: 0 is the map's own arena. */
  index: number;
  box: Box;
  /** Where its builder starts, and where everyone stands to look at (and vote on) its build. */
  spawn: MapPosition;
}

/** The bottom layer of a box: what /floor lays. */
export function floorOf(box: Box): Box {
  return { min: [...box.min] as Vec3, max: [box.max[0], box.min[1], box.max[2]] };
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

/** Builds saved as structures in memory, by name, until dispose(). Any box of the same size can take one back. */
export class Snapshots {
  /** Starts every structure's id: the game's. */
  private readonly prefix: string;
  private readonly saved = new Map<string, string[]>();

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  /** Saves the blocks in `box` (no entities) as `name`. False when it couldn't (an unloaded chunk). */
  save(name: string, box: Box): boolean {
    this.forget(name);
    const dimension = world.getDimension("overworld");
    const ids: string[] = [];
    try {
      structurePieces(box).forEach((piece, i) => {
        const id = `minecade:${this.prefix}_${name}_${i}`;
        world.structureManager.delete(id);
        world.structureManager.createFromWorld(id, dimension, corner(piece.min), corner(piece.max), { saveMode: StructureSaveMode.Memory, includeEntities: false, includeBlocks: true });
        ids.push(id);
      });
      this.saved.set(name, ids);
      return true;
    } catch (error) {
      log.warn(`${this.prefix}: could not save ${name}: ${describeError(error)}`);
      for (const id of ids) this.deleteQuietly(id);
      return false;
    }
  }

  has(name: string): boolean {
    return this.saved.has(name);
  }

  /** Puts a saved build over `box`: the area it was saved from, or another of the same size. False when it couldn't. */
  restore(name: string, box: Box): boolean {
    const ids = this.saved.get(name);
    if (!ids) return false;
    const dimension = world.getDimension("overworld");
    try {
      structurePieces(box).forEach((piece, i) => world.structureManager.place(ids[i], dimension, corner(piece.min), { includeEntities: false }));
      return true;
    } catch (error) {
      log.warn(`${this.prefix}: could not put back ${name}: ${describeError(error)}`);
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
 * Keeps liquids in the build areas: the liquid blocks already in an area's shell when it starts
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
          log.warn(`could not clear liquid at ${at}: ${describeError(error)}`);
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
