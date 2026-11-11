// A tiled map's arenas (Build Swap, Guess the Build): the map holds one arena, a box (its "arena"
// region) with everything one player needs inside it (their spawn and the box they build in), and
// the game copies it side by side at the start, one for each player. Tile 0 is the map's own arena;
// the others go east (+x) and south (+z) of it, edge to edge, in rows as wide as the square grid the
// game's most players need (3 for 8), so a tile never moves once it's there. Each copy is the
// arena's blocks, saved as structures and placed at the tile. Every tile keeps a ticking area of its
// own until the match ends, so a game can save and put back builds in it with nobody near: a chunk
// that nothing loads can't be read or written (docs/spike-results.md, "Arena tiles"). BDS allows
// 300 ticking chunks in all, so the arena has a size limit (the game's maxSize for it).
import { StructureSaveMode, world, type Vector3 } from "@minecraft/server";
import { describeError, log } from "../log.ts";
import type { Box, MapPosition, Vec3 } from "../map-config.ts";
import type { Scope } from "../scope.ts";
import type { MapView } from "./map-view.ts";

/** The structure size limit along x and z (and the most saved along y at once): bigger boxes are saved in pieces. */
export const STRUCTURE_PIECE = 64;

export interface ArenaTile {
  index: number;
  /** How far this tile is from the map's own arena, in whole blocks. */
  offset: Vec3;
  /** This tile's copy of the arena box. */
  box: Box;
}

/** How many tiles go in a row, for a game of up to `most` players: the side of the smallest square grid that holds them. */
export function tileColumns(most: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, most))));
}

/** Where tile `index` goes from the arena: along x in rows of `columns`, the rows along z. */
export function tileOffset(arena: Box, index: number, columns: number): Vec3 {
  const [width, , depth] = [0, 1, 2].map((axis) => arena.max[axis] - arena.min[axis] + 1);
  return [(index % columns) * width, 0, Math.floor(index / columns) * depth];
}

export function shiftBox(box: Box, by: Vec3): Box {
  return { min: box.min.map((value, axis) => value + by[axis]) as Vec3, max: box.max.map((value, axis) => value + by[axis]) as Vec3 };
}

/** A position moved by whole blocks, its facing kept (a whole x or z still means a block's middle). */
export function shiftPosition(position: MapPosition, by: Vec3): MapPosition {
  const moved = [position[0] + by[0], position[1] + by[1], position[2] + by[2]];
  return (position.length === 5 ? [...moved, position[3], position[4]] : moved) as MapPosition;
}

/** The pieces a box is saved in as structures: no bigger than STRUCTURE_PIECE along any side. */
export function structurePieces(box: Box, size = STRUCTURE_PIECE): Box[] {
  const ranges = (axis: number) => {
    const list: [number, number][] = [];
    for (let start = box.min[axis]; start <= box.max[axis]; start += size) list.push([start, Math.min(start + size - 1, box.max[axis])]);
    return list;
  };
  return ranges(0).flatMap(([x0, x1]) => ranges(1).flatMap(([y0, y1]) => ranges(2).map(([z0, z1]) => ({ min: [x0, y0, z0] as Vec3, max: [x1, y1, z1] as Vec3 }))));
}

const point = (at: Vec3): Vector3 => ({ x: at[0], y: at[1], z: at[2] });

export interface ArenaTilesOptions {
  /** The map's arena box. */
  arena: Box;
  /** The game's most players: decides how many tiles go in a row. */
  most: number;
  /** Names its structures and ticking areas: the game's id. */
  name: string;
  /** Everything is removed (ticking areas, saved pieces) when this is disposed. */
  scope: Scope;
  /** A map with bounds gets each tile's box as another bounds box, so spectators fly over them all. */
  map?: MapView;
}

/** The arena's tiles in the world: tile 0 is the map's own, ensure() copies it for more. */
export class ArenaTiles {
  private readonly options: ArenaTilesOptions;
  private readonly columns: number;
  private readonly placed: ArenaTile[] = [];
  private readonly areas: string[] = [];
  private pieces: { id: string; box: Box }[] | undefined;
  /** The copying under way, so two calls never copy the same tile. */
  private busy: Promise<number> | undefined;

  constructor(options: ArenaTilesOptions) {
    this.options = options;
    this.columns = tileColumns(options.most);
    options.scope.add(() => this.dispose());
  }

  get arena(): Box {
    return this.options.arena;
  }

  /** The tiles in place, tile 0 (the map's own arena) first. */
  get tiles(): readonly ArenaTile[] {
    return this.placed;
  }

  /**
   * Copies the arena until there are `count` tiles, keeping each one's chunks loaded. Resolves to
   * how many there are: fewer when the ticking areas run out of room (an arena too big for this many
   * players) or a copy fails, which is logged. Never settles once its scope is disposed.
   */
  ensure(count: number): Promise<number> {
    const run = (this.busy ?? Promise.resolve(0)).then(() => this.copy(count));
    this.busy = run.catch(() => this.placed.length);
    return this.options.scope.guard(run);
  }

  private async copy(count: number): Promise<number> {
    const { scope } = this.options;
    const dimension = world.getDimension("overworld");
    for (let index = this.placed.length; index < count && !scope.disposed; index++) {
      const offset = tileOffset(this.arena, index, this.columns);
      const box = shiftBox(this.arena, offset);
      if (!(await this.load(index, box)) || scope.disposed) break;
      try {
        // The arena is saved once, the first time its chunks are loaded, before anyone builds there.
        this.pieces ??= this.save();
        if (index > 0) for (const piece of this.pieces) world.structureManager.place(piece.id, dimension, point(shiftBox(piece.box, offset).min), { includeEntities: false });
      } catch (error) {
        log.warn(`${this.options.name}: could not copy the arena to tile ${index}: ${describeError(error)}`);
        break;
      }
      const tile = { index, offset, box };
      this.placed.push(tile);
      if (index > 0) this.options.map?.extendBounds([box]);
    }
    return this.placed.length;
  }

  /** A ticking area over a tile, loaded. False when there's no room for it (or it failed). */
  private async load(index: number, box: Box): Promise<boolean> {
    const manager = world.tickingAreaManager;
    const id = `minecade:${this.options.name}_tile${index}`;
    const options = { dimension: world.getDimension("overworld"), from: point(box.min), to: point(box.max) };
    try {
      if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
      if (!manager.hasCapacity(options)) {
        log.warn(`${this.options.name}: no room to keep tile ${index} loaded (${manager.chunkCount} of ${manager.maxChunkCount} ticking chunks in use): the arena is too big for this many players`);
        return false;
      }
      this.areas.push(id);
      await manager.createTickingArea(id, options);
      return true;
    } catch (error) {
      log.warn(`${this.options.name}: could not load tile ${index}: ${describeError(error)}`);
      return false;
    }
  }

  /** Saves the arena's blocks (no entities) in pieces. */
  private save(): { id: string; box: Box }[] {
    const dimension = world.getDimension("overworld");
    return structurePieces(this.arena).map((box, i) => {
      const id = `minecade:${this.options.name}_arena_${i}`;
      try {
        world.structureManager.delete(id);
      } catch {
        // none yet
      }
      world.structureManager.createFromWorld(id, dimension, point(box.min), point(box.max), { saveMode: StructureSaveMode.Memory, includeEntities: false, includeBlocks: true });
      return { id, box };
    });
  }

  private dispose(): void {
    for (const piece of this.pieces ?? []) {
      try {
        world.structureManager.delete(piece.id);
      } catch {
        // gone with the server
      }
    }
    this.pieces = undefined;
    const manager = world.tickingAreaManager;
    for (const id of this.areas.splice(0)) {
      try {
        if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
      } catch {
        // gone with the server
      }
    }
  }
}
