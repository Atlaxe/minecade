// Building during a match (the game's `build` config). Players in the match place blocks inside the
// bounds, but never in a no-build region or a box the game adds (Bridges' holes), and break only
// the blocks placed during the match, which drop nothing. Nobody changes the world before the match
// or while out. The placed blocks are remembered, so a game can clear them (between best-of rounds).
import { BlockTypes, Direction, ItemLockMode, system, world, type Block, type Dimension, type Player, type Vector3 } from "@minecraft/server";
import type { BuildConfig } from "../config.ts";
import { describeError, log } from "../log.ts";
import type { Box, Vec3 } from "../map-config.ts";
import type { Scope } from "../scope.ts";
import { inside, type MapView } from "./map-view.ts";

/** What building needs from the game. */
export interface BuildHost {
  readonly playing: boolean;
  /** A participant who's in play: may place and break blocks. */
  canBuild(name: string): boolean;
  /** Boxes of the game's own where nobody builds, such as Bridges' holes. */
  noBuild(): Box[];
}

const FACE_OFFSETS: Record<Direction, Vec3> = {
  [Direction.Down]: [0, -1, 0],
  [Direction.Up]: [0, 1, 0],
  [Direction.North]: [0, 0, -1],
  [Direction.South]: [0, 0, 1],
  [Direction.West]: [-1, 0, 0],
  [Direction.East]: [1, 0, 0],
};

/**
 * Whether a block may go at `block` (whole block coordinates): inside a bounds box (and above killY,
 * outside kill regions), and in none of the no-build boxes.
 */
export function buildAllowed(block: Vec3, map: MapView, noBuild: readonly Box[]): boolean {
  const middle = { x: block[0] + 0.5, y: block[1] + 0.5, z: block[2] + 0.5 };
  return !map.outOfBounds(middle) && !noBuild.some((box) => inside(middle, box));
}

/** Every box of the named regions, and of each one's per-team lists ("spawnGuard" also covers "spawnGuard.red"). */
export function noBuildRegions(map: MapView, names: readonly string[]): Box[] {
  const regions = map.config.regions ?? {};
  return Object.entries(regions)
    .filter(([key]) => names.some((name) => key === name || key.startsWith(`${name}.`)))
    .flatMap(([, boxes]) => boxes);
}

export class BuildRules {
  private readonly host: BuildHost;
  private readonly map: MapView;
  private readonly regions: Box[];
  private readonly dimension: Dimension;
  /** Blocks placed this match, as "x,y,z". */
  private readonly placed = new Map<string, Vec3>();

  constructor(host: BuildHost, config: BuildConfig, map: MapView) {
    this.host = host;
    this.map = map;
    this.regions = noBuildRegions(map, config.noBuild ?? []);
    this.dimension = world.getDimension("overworld");
  }

  get placedCount(): number {
    return this.placed.size;
  }

  /** Whether a block may go at `block` now, by the map and the game's own boxes. */
  allowed(block: Vec3): boolean {
    return buildAllowed(block, this.map, [...this.regions, ...this.host.noBuild()]);
  }

  attach(scope: Scope): void {
    // Placing: refused before it happens when the spot is plain from the face used. A placement that
    // still lands where it may not (into grass, say) is taken back after.
    scope.subscribeBefore(world.beforeEvents.playerInteractWithBlock, (event) => {
      const item = event.itemStack;
      if (!item || BlockTypes.get(item.typeId) === undefined) return;
      const offset = FACE_OFFSETS[event.blockFace] ?? [0, 0, 0];
      const { x, y, z } = event.block.location;
      if (!this.mayBuild(event.player) || !this.allowed([x + offset[0], y + offset[1], z + offset[2]])) event.cancel = true;
    });
    scope.subscribe(world.afterEvents.playerPlaceBlock, ({ player, block }) => {
      const at = blockOf(block.location);
      if (this.mayBuild(player) && this.allowed(at)) this.placed.set(key(at), at);
      else this.takeBack(player, block);
    });
    // Breaking: only a block placed this match, and it drops nothing.
    scope.subscribeBefore(world.beforeEvents.playerBreakBlock, (event) => {
      event.cancel = true;
      const at = blockOf(event.block.location);
      if (!this.placed.has(key(at)) || !this.mayBuild(event.player)) return;
      system.run(() => this.remove(at));
    });
  }

  /** Removes every block placed this match (between rounds). */
  clearPlaced(): void {
    for (const at of [...this.placed.values()]) this.remove(at);
  }

  private mayBuild(player: Player): boolean {
    return this.host.playing && this.host.canBuild(player.name);
  }

  private remove(at: Vec3): void {
    this.placed.delete(key(at));
    try {
      this.dimension.getBlock({ x: at[0], y: at[1], z: at[2] })?.setType("minecraft:air");
    } catch (error) {
      log.warn(`could not remove the block at ${at.join(" ")}: ${describeError(error)}`);
    }
  }

  /** Undoes a placement that wasn't allowed, giving the block back. */
  private takeBack(player: Player, block: Block): void {
    try {
      const item = block.getItemStack(1);
      block.setType("minecraft:air");
      if (item && player.isValid) {
        item.lockMode = ItemLockMode.inventory;
        player.getComponent("minecraft:inventory")?.container.addItem(item);
      }
    } catch (error) {
      log.warn(`could not take back ${player.name}'s block: ${describeError(error)}`);
    }
  }
}

function blockOf(location: Vector3): Vec3 {
  return [Math.floor(location.x), Math.floor(location.y), Math.floor(location.z)];
}

function key(at: Vec3): string {
  return at.join(",");
}
