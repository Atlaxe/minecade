// Power-ups on the map's spots (Paintball's "Power-up spot" points): two at a time, each owned by a
// timer. Both appear at "Go!"; whenever a timer comes round, its power-up (taken or not) appears
// again on a free random spot, never the other one's, as a random kind. A player who comes close
// takes it, if the game lets them (one gun at a time, one grenade). They float as the guns pack's
// pickups, in white.
import { world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { GUN_PICKUP, KIND_PROPERTY, PICKUP_KINDS, type PickupKind } from "@minecade/guns";
import { describeError, log, type Scope } from "@minecade/minigame-core";

const CHECK_TICKS = 4;
/** A player takes one with their feet this close to the spot's height (they can jump for it). */
const REACH_UP = 2;
const SPAWN_SOUND = "random.pop";
const TAKE_SOUND = "random.orb";

export interface PowerUpsOptions {
  /** The spots, in the world: the middle of each, at its floor. */
  spots: readonly Vector3[];
  /** Each timer's seconds; one power-up each. */
  everySeconds: readonly number[];
  kinds: readonly PickupKind[];
  /** How close (blocks, across) a player's feet must come. */
  radius: number;
  random(): number;
  /** The players who could take one: everyone playing and alive. */
  players(): Player[];
  canTake(player: Player, kind: PickupKind): boolean;
  onTake(player: Player, kind: PickupKind): void;
  /** Called with every pickup spawned, so the game removes it at the end. */
  track?(entity: Entity): void;
}

/** One timer's power-up: where it is and what, while it's out. */
interface Slot {
  spot?: number;
  kind?: PickupKind;
  entity?: Entity;
}

/** A spot for a power-up: any but those `taken`, at random. Undefined when none is free. */
export function freeSpot(spots: number, taken: ReadonlySet<number>, random: () => number): number | undefined {
  const free = Array.from({ length: spots }, (_, index) => index).filter((index) => !taken.has(index));
  return free.length === 0 ? undefined : free[Math.floor(random() * free.length)];
}

export class PowerUps {
  private readonly options: PowerUpsOptions;
  private readonly slots: Slot[];

  constructor(scope: Scope, options: PowerUpsOptions) {
    this.options = options;
    this.slots = options.everySeconds.map(() => ({}));
    options.everySeconds.forEach((seconds, index) => {
      this.place(index);
      scope.interval(() => this.place(index), Math.max(1, Math.round(seconds * 20)));
    });
    scope.interval(() => this.check(), CHECK_TICKS);
    scope.add(() => this.slots.forEach((slot) => this.clear(slot)));
  }

  /** What's out now, by timer: its spot's index and kind (undefined once taken, until the timer comes round). */
  get out(): ({ spot: number; kind: PickupKind } | undefined)[] {
    return this.slots.map((slot) => (slot.spot === undefined || slot.kind === undefined ? undefined : { spot: slot.spot, kind: slot.kind }));
  }

  /** A timer came round: its power-up goes to a free spot as a new kind. */
  private place(index: number): void {
    const slot = this.slots[index];
    this.clear(slot);
    const taken = new Set(this.slots.filter((other) => other !== slot && other.spot !== undefined).map((other) => other.spot!));
    const spot = freeSpot(this.options.spots.length, taken, this.options.random);
    if (spot === undefined || this.options.kinds.length === 0) return;
    const kind = this.options.kinds[Math.floor(this.options.random() * this.options.kinds.length)];
    const at = this.options.spots[spot];
    try {
      const dimension = world.getDimension("overworld");
      const entity = dimension.spawnEntity(GUN_PICKUP, at);
      entity.setProperty(KIND_PROPERTY, PICKUP_KINDS.indexOf(kind));
      this.options.track?.(entity);
      dimension.playSound(SPAWN_SOUND, at, { volume: 0.6 });
      Object.assign(slot, { spot, kind, entity });
    } catch (error) {
      log.warn(`paintball: could not put out a power-up: ${describeError(error)}`);
    }
  }

  private check(): void {
    for (const slot of this.slots) {
      if (slot.spot === undefined || slot.kind === undefined) continue;
      const at = this.options.spots[slot.spot];
      const kind = slot.kind;
      const taker = this.options.players().find((player) => {
        const feet = player.location;
        const across = Math.hypot(feet.x - at.x, feet.z - at.z);
        return across <= this.options.radius && feet.y >= at.y - 0.5 && feet.y <= at.y + REACH_UP && this.options.canTake(player, kind);
      });
      if (!taker) continue;
      this.clear(slot);
      try {
        world.getDimension("overworld").playSound(TAKE_SOUND, at, { volume: 0.8 });
      } catch {
        // the sound is only a nicety
      }
      this.options.onTake(taker, kind);
    }
  }

  private clear(slot: Slot): void {
    try {
      if (slot.entity?.isValid) slot.entity.remove();
    } catch {
      // already gone
    }
    slot.spot = undefined;
    slot.kind = undefined;
    slot.entity = undefined;
  }
}
