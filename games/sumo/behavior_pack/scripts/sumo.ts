// Sumo on the minigame framework. Core already handles the rest: no fall damage, knock-offs
// below killY or out of bounds count as a down with kill credit, no respawns, last one standing
// wins. This class decides what a hit does (twice vanilla's knockback by default) and gives each
// player one more jump in the air.
import { ButtonState, InputButton, system, world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { Minigame, describeError, log, type Hit, type Result, type Scope } from "@minecade/minigame-core";
import type config from "../../game.config.ts";

type Knockback = (typeof config)["knockback"];

/** A jump press this soon after the player last stood on the ground is the ground jump, not the one in the air. */
const GROUND_GRACE_TICKS = 3;
/**
 * In the air, applyKnockback sets the upward speed to min(v + (vy + 0.125) / 2, v), where vy is what
 * getVelocity says (measured on BDS, docs/spike-results.md "Knockback"): a falling player keeps half
 * their fall, which the double jump pays back so it always rises the same.
 */
const AIR_PULL = 0.125;
const DOUBLE_JUMP_SOUND = { id: "mob.enderdragon.flap", pitch: 1.6, volume: 0.6 };

export class Sumo extends Minigame<typeof config> {
  /** Runs inside the before-event: decide only. */
  protected override onDamage(hit: Hit): number | "cancel" {
    return this.config.knockback.mode === "vanilla" && hit.attacker !== undefined && hit.cause === "entityAttack" ? 0 : "cancel";
  }

  protected override async play(): Promise<Result | void> {
    const { timedOut } = await this.stage("Match", { seconds: this.timeLimit }, (stage) => {
      if (this.config.knockback.mode === "scripted") this.pushOnHit(stage.scope);
      else if (this.config.knockback.strength > 1) this.pushHarder(stage.scope);
      if (this.config.doubleJump.enabled) this.doubleJumps(stage.scope);
    });
    if (timedOut) return this.onTimeUp();
  }

  /**
   * Vanilla mode, stronger: each hit that lands keeps Minecraft's own knockback (and hurt flash,
   * sound and half-second cooldown), and a push on top takes it to `strength` times as far.
   */
  private pushHarder(scope: Scope): void {
    const knockback = this.config.knockback;
    scope.subscribe(world.afterEvents.entityHurt, ({ hurtEntity, damageSource }) => {
      const attacker = damageSource.damagingEntity;
      if (damageSource.cause !== "entityAttack" || attacker?.typeId !== "minecraft:player" || damageSource.damagingProjectile) return;
      const victim = this.whoIs(hurtEntity);
      const name = (attacker as Player).name;
      if (victim === undefined || this.roster.get(name)?.state !== "alive" || this.roster.get(victim)?.state !== "alive") return;
      const push = extraPush(knockback, (attacker as Player).isSprinting);
      if (!push) return;
      const { x, z } = pushDirection(attacker.location, hurtEntity.location, (attacker as Player).getViewDirection());
      knock(hurtEntity, { x: x * push.horizontal, z: z * push.horizontal }, push.vertical);
    });
  }

  /** Scripted mode: the hit itself was canceled, so push the victim away from the attacker and credit the push. */
  private pushOnHit(scope: Scope): void {
    const { cooldownTicks } = this.config.knockback;
    const lastPush = new Map<string, number>();
    scope.subscribe(
      world.afterEvents.entityHitEntity,
      ({ damagingEntity, hitEntity }) => {
        const attacker = damagingEntity as Player;
        // A player, or a preview's fake player.
        const victim = this.whoIs(hitEntity);
        if (victim === undefined || this.roster.get(attacker.name)?.state !== "alive" || this.roster.get(victim)?.state !== "alive") return;
        const key = victim.toLowerCase();
        if (system.currentTick - (lastPush.get(key) ?? Number.NEGATIVE_INFINITY) < cooldownTicks) return;
        lastPush.set(key, system.currentTick);
        const { horizontal, vertical } = scriptedPush(this.config.knockback, attacker.isSprinting);
        const { x, z } = pushDirection(attacker.location, hitEntity.location, attacker.getViewDirection());
        hitEntity.applyKnockback({ x: x * horizontal, z: z * horizontal }, vertical);
        this.credit.hit(victim, attacker.name, system.currentTick);
      },
      { entityTypes: ["minecraft:player"] },
    );
  }

  /**
   * Jump again in the air, once until you land: up the same height every time, and forward or back
   * the way you look while you hold forward or back (half your speed in the air is kept).
   */
  private doubleJumps(scope: Scope): void {
    const lastOnGround = new Map<string, number>();
    const used = new Set<string>();
    scope.interval(() => {
      for (const participant of this.roster.inState("alive")) {
        const player = this.player(participant.name);
        if (!player || !onGround(player)) continue;
        const key = participant.name.toLowerCase();
        lastOnGround.set(key, system.currentTick);
        used.delete(key);
      }
    }, 1);
    scope.subscribe(
      world.afterEvents.playerButtonInput,
      ({ player }) => {
        const key = player.name.toLowerCase();
        if (this.roster.get(player.name)?.state !== "alive" || used.has(key) || onGround(player)) return;
        if (system.currentTick - (lastOnGround.get(key) ?? Number.NEGATIVE_INFINITY) <= GROUND_GRACE_TICKS) return;
        used.add(key);
        try {
          const push = doubleJumpPush(player.getViewDirection(), player.inputInfo.getMovementVector().y, player.getVelocity().y, this.config.doubleJump);
          player.applyKnockback({ x: push.x, z: push.z }, push.vertical);
          world.getDimension("overworld").playSound(DOUBLE_JUMP_SOUND.id, player.location, { pitch: DOUBLE_JUMP_SOUND.pitch, volume: DOUBLE_JUMP_SOUND.volume });
        } catch (error) {
          log.warn(`sumo: ${player.name}'s double jump failed: ${describeError(error)}`);
        }
      },
      { buttons: [InputButton.Jump], state: ButtonState.Pressed },
    );
  }
}

/** Whether a player stands on something now (false for one who's gone). */
function onGround(player: Player): boolean {
  try {
    return player.isOnGround;
  } catch {
    return false;
  }
}

function knock(entity: Entity, horizontal: { x: number; z: number }, vertical: number): void {
  try {
    entity.applyKnockback(horizontal, vertical);
  } catch {
    // gone
  }
}

/** Scripted mode's push: vanilla's own numbers (the sprint ones for a sprinting attacker), the horizontal times `strength`. */
export function scriptedPush(knockback: Knockback, sprinting: boolean): { horizontal: number; vertical: number } {
  const { horizontal, vertical, sprintHorizontal, sprintVertical, strength } = knockback;
  return sprinting ? { horizontal: sprintHorizontal * strength, vertical: sprintVertical } : { horizontal: horizontal * strength, vertical };
}

/**
 * Vanilla mode's push on top of a hit's own, for `strength` times vanilla's distance; none at 1 or
 * less. Measured on BDS (docs/spike-results.md, "Knockback"): a push in the same tick as a hit
 * halves the hit's speed and adds its own, so twice vanilla takes 1.5 times vanilla's push
 * (2.25 times a sprint hit's); the height stays vanilla's.
 */
export function extraPush(knockback: Knockback, sprinting: boolean): { horizontal: number; vertical: number } | undefined {
  if (knockback.strength <= 1) return undefined;
  const base = sprinting ? knockback.sprintHorizontal : knockback.horizontal;
  return { horizontal: base * (knockback.strength - 0.5), vertical: sprinting ? knockback.sprintVertical : knockback.vertical };
}

/**
 * A double jump's push: `forward` along the ground the way the player looks, times how far forward
 * (or back, below 0) they push the stick or keys, and up so they rise at `up` blocks a tick whatever
 * their speed (a falling player's fall is paid back).
 */
export function doubleJumpPush(view: Vector3, forwardInput: number, velocityY: number, jump: { up: number; forward: number }): { x: number; z: number; vertical: number } {
  const level = Math.hypot(view.x, view.z);
  const along = level < 1e-3 ? 0 : (Math.max(-1, Math.min(1, forwardInput)) * jump.forward) / level;
  return { x: view.x * along, z: view.z * along, vertical: jump.up - Math.min(0, velocityY + AIR_PULL) / 2 };
}

/** The unit direction from attacker to victim on the ground plane, or the attacker's view when they overlap. */
export function pushDirection(from: Vector3, to: Vector3, view: Vector3): { x: number; z: number } {
  let x = to.x - from.x;
  let z = to.z - from.z;
  if (Math.hypot(x, z) < 0.01) {
    x = view.x;
    z = view.z;
  }
  const length = Math.hypot(x, z);
  return length < 0.0001 ? { x: 0, z: 1 } : { x: x / length, z: z / length };
}
