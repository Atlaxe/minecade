// The aim cursor: while a map editor holds a tool that reaches past their own reach (the Spawn,
// Region and Select tools), an entity shows where a use would land: a glowing outline around the
// block for the box tools, or a see-through mannequin at the exact spot (and turned the way it would
// face) for spawns. A spawn's screen shows the spawn being set up the same way. It's an entity, so it
// moves with the aim, hides behind blocks, and shows as far out as the tools reach. Cursors are
// removed before the world is saved (pause), and swept up when the server starts.
import { type Dimension, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";

export const CURSOR = "minecade:editor_cursor";
const MODE_PROPERTY = "minecade:mode";
/** How often cursors follow the aim. */
const FOLLOW_TICKS = 2;

/** Where a player's cursor goes: a block (its outline) or a point (a mannequin, turned to `yaw`). */
export type CursorAim = { kind: "block"; at: Vector3 } | { kind: "point"; at: Vector3; yaw: number };

export class Cursors {
  private readonly dimension: Dimension;
  private readonly aim: (player: Player) => CursorAim | undefined;
  private readonly cursors = new Map<string, Entity>();
  private paused = false;

  constructor(scope: Scope, dimension: Dimension, aim: (player: Player) => CursorAim | undefined) {
    this.dimension = dimension;
    this.aim = aim;
    scope.interval(() => this.follow(), FOLLOW_TICKS);
  }

  /** Removes every cursor in the world (ones an earlier run left too), and shows none until resume. */
  pause(): void {
    this.paused = true;
    this.cursors.clear();
    try {
      for (const entity of this.dimension.getEntities({ type: CURSOR })) entity.remove();
    } catch (error) {
      log.warn(`could not remove the aim cursors: ${describeError(error)}`);
    }
  }

  resume(): void {
    this.paused = false;
  }

  private follow(): void {
    if (this.paused) return;
    const seen = new Set<string>();
    for (const player of this.dimension.getPlayers()) {
      const key = player.name.toLowerCase();
      const aim = this.aimOf(player);
      if (!aim) continue;
      seen.add(key);
      const at = aim.kind === "block" ? { x: aim.at.x + 0.5, y: aim.at.y, z: aim.at.z + 0.5 } : aim.at;
      const yaw = aim.kind === "point" ? aim.yaw : 0;
      const mode = aim.kind === "block" ? 0 : 1;
      let cursor = this.cursors.get(key);
      try {
        if (!cursor?.isValid) {
          cursor = this.dimension.spawnEntity(CURSOR, at, { initialRotation: yaw });
          this.cursors.set(key, cursor);
        } else if (distance(cursor.location, at) > 0.01 || Math.abs(cursor.getRotation().y - yaw) > 0.5) {
          cursor.teleport(at, { rotation: { x: 0, y: yaw } });
        }
        if (cursor.getProperty(MODE_PROPERTY) !== mode) cursor.setProperty(MODE_PROPERTY, mode);
      } catch {
        // Out of loaded chunks: try again next time.
      }
    }
    for (const [key, cursor] of this.cursors) {
      if (seen.has(key)) continue;
      if (cursor.isValid) cursor.remove();
      this.cursors.delete(key);
    }
  }

  private aimOf(player: Player): CursorAim | undefined {
    try {
      return this.aim(player);
    } catch {
      return undefined;
    }
  }
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
