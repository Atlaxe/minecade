// The moves left over a walker's head (the user, 2026-11-18): once a die bursts, its number shows over
// the roller's head in the game's Minecraft Ten font, follows them as they walk, and counts down a
// space at a time (board-loop.ts, move), gone as they land. It's a particle sent every tick
// (numbers.ts, number-sprites.ts), so it always faces the camera the players look through.
//
// It follows a spot over the head a little ahead of where the body is going, closing half the gap
// each tick, and each tick's particle moves the way the number is going until the next one takes over,
// so it glides rather than stepping 20 times a second. Far off (a swap, back from a minigame) it's put
// there at once. It grows in where the die burst, and swells a little each time it changes.
import { system, type Entity, type Vector3 } from "@minecraft/server";
import type { Scope } from "@minecade/minigame-core";
import { sendNumber } from "./number-sprites.ts";
import { popScale } from "./numbers.ts";

/** How far over a body's feet the number's middle stands: a little over the head. */
export const COUNT_MIDDLE = 2.6;
/** Ticks ahead of the body it aims for, so it keeps up with a walk. */
const LEAD = 1.5;
/** The part of the gap to its spot it closes each tick. */
const FOLLOW = 0.5;
/** Farther off than this, it's put there at once. */
const FAR = 4;
/** Its little bob up and down, in blocks, and how many degrees of it a second. */
const BOB = 0.03;
const BOB_SPEED = 180;

interface Shown {
  value: number;
  /** Where its middle is now. */
  at: Vector3;
  shownAt: number;
  changedAt: number;
}

export interface CountsDeps {
  scope: Scope;
  /** A seat's body by key, if they're here. */
  bodyOf(key: string): Entity | undefined;
}

export class Counts {
  private readonly deps: CountsDeps;
  private readonly shown = new Map<string, Shown>();

  constructor(deps: CountsDeps) {
    this.deps = deps;
    deps.scope.interval(() => this.tick(), 1);
    deps.scope.add(() => this.shown.clear());
  }

  /** Whether `key`'s moves left are over their head now (a transfer's count stands over them: transfers.ts). */
  shows(key: string): boolean {
    return this.shown.has(key);
  }

  /**
   * Shows `value` over `key`'s head, or changes it (a new one grows in at `from`, the burst die's
   * middle, else over the head); undefined takes it away.
   */
  set(key: string, value: number | undefined, from?: Vector3): void {
    if (value === undefined) {
      this.shown.delete(key);
      return;
    }
    const now = system.currentTick;
    const shown = this.shown.get(key);
    if (shown) {
      if (shown.value !== value) shown.changedAt = now;
      shown.value = value;
      return;
    }
    const body = this.deps.bodyOf(key);
    if (!body?.isValid) return;
    this.shown.set(key, { value, at: from ?? overHead(body.location), shownAt: now, changedAt: now });
  }

  /** Each number a tick closer to its spot over its body's head, and its particle for this tick. */
  private tick(): void {
    const now = system.currentTick;
    for (const [key, shown] of this.shown) {
      const body = this.deps.bodyOf(key);
      if (!body?.isValid) {
        this.shown.delete(key);
        continue;
      }
      try {
        const going = body.getVelocity();
        const feet = body.location;
        const spot = overHead({ x: feet.x + going.x * LEAD, y: feet.y, z: feet.z + going.z * LEAD });
        const at = shown.at;
        const far = Math.hypot(spot.x - at.x, spot.y - at.y, spot.z - at.z) > FAR;
        const next = far ? spot : { x: at.x + (spot.x - at.x) * FOLLOW, y: at.y + (spot.y - at.y) * FOLLOW, z: at.z + (spot.z - at.z) * FOLLOW };
        const life = (now - shown.shownAt) / 20;
        const bob = Math.sin((life * BOB_SPEED * Math.PI) / 180) * BOB;
        sendNumber(body.dimension, {
          kind: "count",
          value: shown.value,
          at: { x: at.x, y: at.y + bob, z: at.z },
          // Blocks a second toward where the next tick's starts (none on a jump to a far spot).
          velocity: far ? undefined : { x: (next.x - at.x) * 20, y: (next.y - at.y) * 20, z: (next.z - at.z) * 20 },
          scale: popScale(life, (now - shown.changedAt) / 20),
        });
        shown.at = next;
      } catch {
        // gone this tick
      }
    }
  }
}

/** The number's middle over a body standing at `feet`. */
function overHead(feet: Vector3): Vector3 {
  return { x: feet.x, y: feet.y + COUNT_MIDDLE, z: feet.z };
}
