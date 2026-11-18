// Plays Block Party's animations (animations.ts) on the players, the bots and the NPCs.
//   - A player's set (Celebration, Sad, Dice roll, Select): one of its animations at random, on the
//     players' own controller, so a new one takes the place of the one playing. The same set asked
//     for again while it plays isn't started over (the game and a line's actions often ask for the
//     same one at once: a Star bought, and the line about it). Bots play them too (their model has
//     the players' bones).
//   - A character's move: its animation (the pack's, or the vanilla one the table names), held a
//     while and then the NPC rests again when it loops, a property switched on for a while (the
//     Referee's cheer), and what the script does with it: turning to the player, falling in again,
//     the Enderman's blink with portal particles, the Allay's falling Star.
import { system, type Entity, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { CLIPS, npcMove, pickClip, PLAYER, SHOWN, variantsOf, type PlayerSet } from "./animations.ts";
import { NPC_ANIMATION } from "./npcs.ts";

/** The animation controller the players' sets play on. */
export const PLAYER_ANIMATION = "blockparty.player";
/** The animation that ends a held one (it plays nothing). */
const REST = "animation.blockparty.rest";
/** The Allay's Star: the model, its turning, its fall, and how long it's there. */
const STAR = "blockparty:star";
const STAR_TURNING = "blockparty:turning";
const STAR_DROP = "animation.blockparty.star.drop";
const STAR_AFTER = 10;
const STAR_TICKS = 40;
/** The Enderman's blink: portal particles as he goes, and again as he's back. */
const BLINK_BACK = 12;
/** Ticks after a hidden NPC's animation is played before it's shown (the animation reaches the client first). */
const APPEAR_AFTER = 2;

export interface MovesDeps {
  scope: Scope;
  random(): number;
  /** An NPC drops in again from above where it stands (stage.ts, fallIn): Chris's Fall in. */
  fallIn?(entity: Entity): void;
}

export class Moves {
  private readonly deps: MovesDeps;
  /** The set each body is playing, and the tick it ends, by entity id. */
  private readonly playing = new Map<string, { set: string; until: number }>();
  /** Each NPC's latest move, by entity id: a hold's end rests the NPC only if nothing came after it. */
  private readonly latest = new Map<string, number>();
  private serial = 0;
  /** Moves with nothing to play, logged once each. */
  private readonly missing = new Set<string>();

  constructor(deps: MovesDeps) {
    this.deps = deps;
  }

  /**
   * One of a set's animations on a player or a bot, unless they're in the middle of the same set
   * (`set`: one of PLAYER_SETS, or a Player action the user added in the dialogue tool). Returns how
   * many ticks it has left to play (0 when there's none).
   */
  player(body: Entity, set: PlayerSet | (string & {})): number {
    if (!body.isValid) return 0;
    const now = system.currentTick;
    const playing = this.playing.get(body.id);
    if (playing && playing.set === set && playing.until > now) return playing.until - now;
    const clip = pickClip(variantsOf(CLIPS, PLAYER, set), () => this.deps.random());
    if (!clip) {
      this.logMissing(`${PLAYER}/${set}`);
      return 0;
    }
    try {
      body.playAnimation(clip.name, { controller: PLAYER_ANIMATION, stopExpression: "q.any_animation_finished", blendOutTime: 0.2 });
    } catch (error) {
      log.warn(`blockparty: ${set} on ${body.typeId} failed: ${describeError(error)}`);
      return 0;
    }
    const ticks = Math.max(1, Math.round(clip.seconds * 20));
    this.playing.set(body.id, { set, until: now + ticks });
    return ticks;
  }

  /**
   * A character's action (`character` and `action` as the dialogue tool names them) on its entity.
   * `toward`: the seat it's about, which Look at the player turns it to.
   */
  npc(entity: Entity, character: string, action: string, toward?: Entity): void {
    if (!entity.isValid) return;
    const { clips, move } = npcMove(CLIPS, character, action);
    const clip = pickClip(clips, () => this.deps.random());
    if (!clip && !move) {
      this.logMissing(`${character}/${action}`);
      return;
    }
    const serial = ++this.serial;
    this.latest.set(entity.id, serial);
    const hold = move?.hold;
    try {
      if (move?.property) entity.setProperty(move.property, true);
      if (clip) entity.playAnimation(clip.name, { controller: NPC_ANIMATION, stopExpression: hold !== undefined ? "0" : "q.any_animation_finished", blendOutTime: 0.2 });
    } catch (error) {
      log.warn(`blockparty: ${character}'s ${action} failed: ${describeError(error)}`);
    }
    if (typeof hold === "number") {
      this.deps.scope.timeout(() => {
        if (!entity.isValid || this.latest.get(entity.id) !== serial) return;
        try {
          if (move?.property) entity.setProperty(move.property, false);
          if (clip) entity.playAnimation(REST, { controller: NPC_ANIMATION, stopExpression: "q.any_animation_finished", blendOutTime: 0.2 });
        } catch {
          // gone
        }
      }, Math.max(1, Math.round(hold * 20)));
    }
    // Shown once the animation has begun (the client has it a tick or two after the call), hidden
    // once it has the NPC out of sight.
    if (move?.appear) this.deps.scope.timeout(() => setShown(entity, true), APPEAR_AFTER);
    if (move?.vanish !== undefined) {
      this.deps.scope.timeout(() => {
        if (this.latest.get(entity.id) === serial) setShown(entity, false);
      }, Math.max(1, Math.round(move.vanish * 20)));
    }
    switch (move?.deed) {
      case "look":
        if (toward?.isValid) face(entity, toward.location);
        break;
      case "fall in":
        this.deps.fallIn?.(entity);
        break;
      case "teleport":
        this.blink(entity);
        break;
      case "drop star":
        this.dropStar(entity);
        break;
    }
  }

  /** The Enderman's blink: portal particles round him as he goes (his animation shrinks him away), and again as he's back. */
  private blink(entity: Entity): void {
    portal(entity);
    this.deps.scope.timeout(() => entity.isValid && portal(entity), BLINK_BACK);
  }

  /** The Allay lets go of a Star: the Star model turns and falls from its hands, then goes. */
  private dropStar(entity: Entity): void {
    this.deps.scope.timeout(() => {
      if (!entity.isValid) return;
      try {
        const at = entity.location;
        const star = entity.dimension.spawnEntity(STAR, { x: at.x, y: at.y + 0.2, z: at.z });
        star.setProperty(STAR_TURNING, true);
        star.playAnimation(STAR_DROP, { controller: NPC_ANIMATION, stopExpression: "0" });
        this.deps.scope.timeout(() => {
          try {
            if (star.isValid) star.remove();
          } catch {
            // gone
          }
        }, STAR_TICKS);
      } catch (error) {
        log.warn(`blockparty: the Allay's Star failed: ${describeError(error)}`);
      }
    }, STAR_AFTER);
  }

  private logMissing(what: string): void {
    if (this.missing.has(what)) return;
    this.missing.add(what);
    log.info(`blockparty: ${what} has no animation in the pack and nothing for the script to do, so it's skipped`);
  }
}

/** Shows or hides an NPC that starts hidden (SHOWN); nothing for one without the property. */
function setShown(entity: Entity, shown: boolean): void {
  try {
    if (entity.isValid && entity.getProperty(SHOWN) !== undefined) entity.setProperty(SHOWN, shown);
  } catch {
    // gone, or it has no such property
  }
}

/** Turns an entity to face a spot (level). */
function face(entity: Entity, toward: Vector3): void {
  try {
    const at = entity.location;
    const yaw = (Math.atan2(-(toward.x - at.x), toward.z - at.z) * 180) / Math.PI;
    entity.setRotation({ x: 0, y: yaw });
  } catch {
    // gone
  }
}

/** Portal particles round an entity, head to foot. */
function portal(entity: Entity): void {
  try {
    const at = entity.location;
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      entity.dimension.spawnParticle("minecraft:mob_portal", { x: at.x + Math.cos(angle) * 0.5, y: at.y + (i % 6) * 0.5, z: at.z + Math.sin(angle) * 0.5 });
    }
  } catch {
    // unloaded
  }
}
