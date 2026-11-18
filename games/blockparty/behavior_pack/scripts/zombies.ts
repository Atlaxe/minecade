// The zombies that follow a seat (docs/plans/block-party.md, "Items": the Zombie Spawn; "The
// Warden": the Zombie Curse; "Chance Time": Zombie Outbreak): a blockparty:zombie on vanilla's zombie
// model walks behind its target's piece, at a walk when it's near, and turns up beside them at once
// when they've gone far (a swap, back from a minigame). It fades with its target on others' turns
// (fade.ts, follow). How many rounds it stays and the coins it takes are the board loop's
// (seats.ts, item-play.ts); this only keeps the body. It comes and goes in the Witch's puff of smoke
// (the user, 2026-11-18), with the sounds of the dialogue tool's events npc.zombie.appear and
// npc.zombie.vanish.
import type { Dimension, Entity, Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { BOT_WALK, stepToward } from "./bots.ts";
import type { TurnFade } from "./fade.ts";
import { eventCue, playCue } from "./sounds.ts";

export const ZOMBIE_ENTITY = "blockparty:zombie";
/** The puff a zombie comes and goes in (the Witch's: stage.ts), at its feet, middle and head. */
const PUFF = "blockparty:smoke_puff";
const PUFF_HEIGHTS = [0.2, 0.9, 1.6];
/** How far behind its target a zombie stands, and how far off it may get before it turns up beside them. */
const BEHIND = 1.6;
const FAR = 7;

export interface ZombiesDeps {
  scope: Scope;
  dimension: Dimension;
  /** A seat's body by key, if they're here. */
  bodyOf(key: string): Entity | undefined;
  /** Whether a seat is off the board now (a minigame): their zombie waits where it is. */
  offBoard(key: string): boolean;
  fade: TurnFade;
}

export class Zombies {
  private readonly deps: ZombiesDeps;
  private readonly following = new Map<string, Entity>();

  constructor(deps: ZombiesDeps) {
    this.deps = deps;
    deps.scope.interval(() => this.tick(), 1);
    // The game's end takes them away quietly.
    deps.scope.add(() => {
      for (const key of [...this.following.keys()]) this.remove(key, false);
    });
  }

  has(key: string): boolean {
    return this.following.get(key)?.isValid === true;
  }

  /** The zombie on a seat, if one follows them. */
  of(key: string): Entity | undefined {
    const entity = this.following.get(key);
    return entity?.isValid ? entity : undefined;
  }

  /** A zombie follows `key` from now (one each: a second keeps the first). */
  add(key: string): Entity | undefined {
    const had = this.of(key);
    if (had) return had;
    const body = this.deps.bodyOf(key);
    if (!body?.isValid) return undefined;
    try {
      const spot = this.behind(body);
      this.puff(spot, "appear");
      const entity = this.deps.dimension.spawnEntity(ZOMBIE_ENTITY, spot);
      this.following.set(key, entity);
      this.deps.fade.follow(entity, key);
      return entity;
    } catch (error) {
      log.warn(`blockparty: the zombie couldn't come: ${describeError(error)}`);
      return undefined;
    }
  }

  /** The zombie on `key` goes, in a puff of smoke unless `puff` is false. */
  remove(key: string, puff = true): void {
    const entity = this.following.get(key);
    this.following.delete(key);
    if (!entity) return;
    try {
      this.deps.fade.unfollow(entity);
      if (entity.isValid) {
        if (puff) this.puff(entity.location, "vanish");
        entity.remove();
      }
    } catch {
      // gone
    }
  }

  /** The Witch's puff of smoke where a zombie comes or goes, and its sound. */
  private puff(at: Vector3, how: "appear" | "vanish"): void {
    playCue(eventCue(`npc.zombie.${how}`));
    for (const up of PUFF_HEIGHTS) {
      try {
        this.deps.dimension.spawnParticle(PUFF, { x: at.x, y: at.y + up, z: at.z });
      } catch {
        // unloaded
      }
    }
  }

  /** A spot behind `body`, the way it faces. */
  private behind(body: Entity): Vector3 {
    const at = body.location;
    let yaw = 0;
    try {
      yaw = (body.getRotation().y * Math.PI) / 180;
    } catch {
      // keeps 0
    }
    return { x: at.x + Math.sin(yaw) * BEHIND, y: at.y, z: at.z - Math.cos(yaw) * BEHIND };
  }

  /** Each tick: each zombie walks after its target, or turns up beside them when they're far. */
  private tick(): void {
    for (const [key, entity] of this.following) {
      if (!entity.isValid) {
        this.following.delete(key);
        continue;
      }
      const body = this.deps.bodyOf(key);
      if (!body?.isValid || this.deps.offBoard(key)) continue;
      try {
        const spot = this.behind(body);
        const at = entity.location;
        const gap = Math.hypot(spot.x - at.x, spot.z - at.z);
        if (gap > FAR || Math.abs(spot.y - at.y) > 3) {
          entity.teleport(spot);
          entity.setRotation({ x: 0, y: body.getRotation().y });
        } else stepToward(entity, spot, BOT_WALK * 1.3, 0.4);
      } catch {
        // gone this tick
      }
    }
  }
}
