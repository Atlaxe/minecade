// Block Party's space markers (docs/plans/block-party.md, "Space markers"): every space on the board
// is the game's own model, blockparty:space, put there at the start. It has two parts, a thin
// perimeter the marker's whole footprint and a pedestal on it where the pieces stand, each in its
// type's block texture (games/blockparty/spaces.json; tools/blockparty/space-pack.ts makes the model,
// resource_pack/models/entity/space.geo.json, and space-model.json, which this reads).
//   - The pedestal is stood on for real: an invisible block, blockparty:space_floor, in each block it
//     covers, as tall as the pedestal (its cell state picks how much of the block), so a walking piece
//     steps up onto it as onto a slab, and a piece put on a space stands on its top (board.ts, STAND).
//     A block already there (the map's own) is left as it is.
//   - A space lights up (blockparty:lit: drawn at full light with the highlight's pulsing color over
//     it) while a piece anyone can see stands on it, its middle over the pedestal (so a walk lights
//     each space as it crosses it), and while the stage's shot is on it (select(): a Star's reveal or
//     move, the Wandering Trader's space, a Happening).
// Pure apart from SpaceMarkers, so the tests can check what lights.
import { BlockPermutation, type Dimension, type Entity } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import model from "../../space-model.json";
import { floorOf, type Space, type Vec3 } from "./board.ts";

export const SPACE_ENTITY = "blockparty:space";
export const FLOOR_BLOCK = "blockparty:space_floor";
const CELL_STATE = "blockparty:cell";
const TYPE_PROPERTY = "blockparty:type";
const LIT_PROPERTY = "blockparty:lit";
/** How often (ticks) who stands where is looked at. */
const LIT_EVERY = 2;

/** How far the pedestal reaches from a space's middle, x and z, in blocks. */
export const PEDESTAL: readonly [number, number] = [model.pedestal.reach[0] / 16, model.pedestal.reach[1] / 16];
/** The blocks of the pedestal's floor, from the space's own block (east +x, south +z), and each one's cell state. */
export const FLOOR_CELLS: readonly { dx: number; dz: number; cell: number }[] = model.floor;

/** A type's place in the render controllers' texture arrays (Blue's for a type the model doesn't have). */
export function typeIndex(type: string): number {
  const index = model.types.indexOf(type);
  return index >= 0 ? index : Math.max(0, model.types.indexOf("blue"));
}

/** Whether a piece at `at` (its feet) stands on `space`: its middle over the pedestal, its feet about the marker's height. */
export function standsOn(space: Space, at: Vec3): boolean {
  return Math.abs(at[0] - space.at[0]) <= PEDESTAL[0] && Math.abs(at[2] - space.at[2]) <= PEDESTAL[1] && at[1] >= floorOf(space) - 0.5 && at[1] <= space.at[1] + 1.5;
}

/** The spaces that are lit: each a piece at `pieces` stands on, and each of `selected`. */
export function litSpaces(spaces: readonly Space[], pieces: readonly Vec3[], selected: Iterable<number>): Set<number> {
  const lit = new Set<number>();
  for (const at of pieces) {
    const on = spaces.find((space) => standsOn(space, at));
    if (on) lit.add(on.index);
  }
  for (const index of selected) if (spaces[index]) lit.add(index);
  return lit;
}

/** The blocks of a space's pedestal floor: where each goes and its cell state. */
export function floorBlocks(space: Space): { at: Vec3; cell: number }[] {
  const x = Math.floor(space.at[0]);
  const z = Math.floor(space.at[2]);
  const y = Math.floor(floorOf(space));
  return FLOOR_CELLS.map(({ dx, dz, cell }) => ({ at: [x + dx, y, z + dz], cell }));
}

export interface MarkerDeps {
  scope: Scope;
  dimension: Dimension;
  spaces(): readonly Space[];
  /** The pieces anyone can see (players and bots on the board; a faded seat isn't one). */
  pieces(): readonly Entity[];
}

export class SpaceMarkers {
  private readonly deps: MarkerDeps;
  /** Each space's marker, by its index. */
  private readonly models = new Map<number, Entity>();
  private readonly lit = new Set<number>();
  private readonly selected = new Set<number>();
  /** Every space lit (the Tests' Light every space). */
  private all = false;

  constructor(deps: MarkerDeps) {
    this.deps = deps;
    deps.scope.add(() => this.clear());
    deps.scope.interval(() => this.keep(), LIT_EVERY);
  }

  /** Puts every space's marker and its pedestal's floor on the board (any left from before go first). */
  lay(): void {
    this.clear();
    const { dimension } = this.deps;
    try {
      for (const old of dimension.getEntities({ type: SPACE_ENTITY })) old.remove();
    } catch {
      // none to find
    }
    for (const space of this.deps.spaces()) {
      for (const { at, cell } of floorBlocks(space)) {
        try {
          const block = dimension.getBlock({ x: at[0], y: at[1], z: at[2] });
          if (block?.isAir) block.setPermutation(BlockPermutation.resolve(FLOOR_BLOCK, { [CELL_STATE]: cell }));
        } catch (error) {
          log.warn(`blockparty: space ${space.index + 1}'s floor failed: ${describeError(error)}`);
        }
      }
      try {
        const marker = dimension.spawnEntity(SPACE_ENTITY, { x: space.at[0], y: floorOf(space), z: space.at[2] });
        marker.setRotation({ x: 0, y: 0 });
        marker.setProperty(TYPE_PROPERTY, typeIndex(space.type));
        this.models.set(space.index, marker);
      } catch (error) {
        log.warn(`blockparty: space ${space.index + 1}'s marker failed: ${describeError(error)}`);
      }
    }
  }

  /** The space the stage's shot is on lights up (undefined: none, the shot is somewhere else). */
  select(space: Space | undefined): void {
    this.selected.clear();
    if (space) this.selected.add(space.index);
    this.keep();
  }

  /** Every space lit, or back to the pieces and the stage's (the Tests). */
  lightAll(on: boolean): void {
    this.all = on;
    this.keep();
  }

  get allLit(): boolean {
    return this.all;
  }

  /** Each marker lit or not, as who stands where and the stage's shot say. */
  private keep(): void {
    if (this.models.size === 0) return;
    const spaces = this.deps.spaces();
    const at: Vec3[] = [];
    for (const piece of this.deps.pieces()) {
      try {
        const { x, y, z } = piece.location;
        at.push([x, y, z]);
      } catch {
        // gone
      }
    }
    const lit = this.all ? new Set(spaces.map((space) => space.index)) : litSpaces(spaces, at, this.selected);
    for (const [index, marker] of this.models) {
      const on = lit.has(index);
      if (on === this.lit.has(index)) continue;
      try {
        if (!marker.isValid) continue;
        marker.setProperty(LIT_PROPERTY, on);
        if (on) this.lit.add(index);
        else this.lit.delete(index);
      } catch {
        // gone
      }
    }
  }

  /** The markers go (the floor blocks stay with the board's world). */
  private clear(): void {
    for (const marker of this.models.values()) {
      try {
        if (marker.isValid) marker.remove();
      } catch {
        // gone with the server
      }
    }
    this.models.clear();
    this.lit.clear();
  }
}
