// The moves left over a walker's head (the user, 2026-11-18): once a die bursts, its number shows over
// the roller's head in the game's Minecraft Ten font, follows them as they walk, and counts down a
// space at a time (board-loop.ts, move), gone as they land. It's blockparty:count, a model of every
// digit the dice tool draws in the dice file's "number" look (tools/blockparty/dice-model.ts); its
// render controller shows the digits its property names, and its digits turn to face each player's
// own camera (animation.blockparty.count_face: its upright bone undoes whatever turn the entity's
// body took, as it's walked along by impulses, and its count bone turns to the camera as Minecraft's
// billboard does), drawn unshaded at full brightness (entity_emissive) so white reads white.
//
// It follows by being set moving each tick toward its spot over the head, a little ahead of where the
// body is going, the way the bots walk (bots.ts): teleporting every tick stutters (20 stops a second,
// pieces.ts). Far off (a swap, back from a minigame) it's put there at once.
import type { Entity, Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { COUNT_ENTITY, COUNT_PROPERTY, MAX_COUNT } from "./dice.ts";

/** How far over a body's feet the number's entity stands: its digits' middle half a block higher, a little over the head. */
export const COUNT_OVER = 2.1;
/** Ticks ahead of the body it aims for, so it keeps up with a walk. */
const LEAD = 1.5;
/** Farther off than this, it's put there at once. */
const FAR = 4;

export interface CountsDeps {
  scope: Scope;
  /** A seat's body by key, if they're here. */
  bodyOf(key: string): Entity | undefined;
}

export class Counts {
  private readonly deps: CountsDeps;
  private readonly shown = new Map<string, Entity>();

  constructor(deps: CountsDeps) {
    this.deps = deps;
    deps.scope.interval(() => this.tick(), 1);
    deps.scope.add(() => {
      for (const key of [...this.shown.keys()]) this.set(key, undefined);
    });
  }

  /** Whether `key`'s moves left are over their head now (a transfer's count stands over them: transfers.ts). */
  shows(key: string): boolean {
    return this.shown.get(key)?.isValid === true;
  }

  /**
   * Shows `value` over `key`'s head, or changes it (a new one grows in where `from` says, the burst
   * die's place, else over the head); undefined takes it away.
   */
  set(key: string, value: number | undefined, from?: Vector3): void {
    const entity = this.shown.get(key);
    if (value === undefined) {
      this.shown.delete(key);
      try {
        if (entity?.isValid) entity.remove();
      } catch {
        // gone
      }
      return;
    }
    const number = Math.max(0, Math.min(MAX_COUNT, Math.round(value)));
    try {
      if (entity?.isValid) {
        entity.setProperty(COUNT_PROPERTY, number);
        return;
      }
      const body = this.deps.bodyOf(key);
      if (!body?.isValid) return;
      const spawned = body.dimension.spawnEntity(COUNT_ENTITY, from ?? overHead(body.location));
      // It never turns: the digits face the camera from a model turned to the south.
      spawned.setRotation({ x: 0, y: 0 });
      spawned.setProperty(COUNT_PROPERTY, number);
      this.shown.set(key, spawned);
    } catch (error) {
      log.warn(`blockparty: showing ${key}'s moves left failed: ${describeError(error)}`);
    }
  }

  /** Each number a tick closer to its spot over its body's head. */
  private tick(): void {
    for (const [key, entity] of this.shown) {
      const body = this.deps.bodyOf(key);
      if (!entity.isValid || !body?.isValid) {
        this.set(key, undefined);
        continue;
      }
      try {
        const going = body.getVelocity();
        const feet = body.location;
        const spot = overHead({ x: feet.x + going.x * LEAD, y: feet.y, z: feet.z + going.z * LEAD });
        const at = entity.location;
        const step = { x: spot.x - at.x, y: spot.y - at.y, z: spot.z - at.z };
        entity.clearVelocity();
        if (Math.hypot(step.x, step.y, step.z) > FAR) entity.teleport(spot);
        else entity.applyImpulse(step);
      } catch {
        // gone this tick
      }
    }
  }
}

/** The number's spot over a body standing at `feet`. */
function overHead(feet: Vector3): Vector3 {
  return { x: feet.x, y: feet.y + COUNT_OVER, z: feet.z };
}
