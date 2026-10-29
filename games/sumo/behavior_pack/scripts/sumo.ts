// Sumo on the minigame framework. Core already handles the rest: no fall damage, knock-offs
// below killY or out of bounds count as a down with kill credit, no respawns, last one standing
// wins. This class only decides what a hit does.
import { system, world, type Player, type Vector3 } from "@minecraft/server";
import { Minigame, type Hit, type Result, type Scope } from "@minecade/minigame-core";
import type config from "../../game.config.ts";

export class Sumo extends Minigame<typeof config> {
  /** Runs inside the before-event: decide only. */
  protected override onDamage(hit: Hit): number | "cancel" {
    return this.config.knockback.mode === "vanilla" && hit.attacker !== undefined && hit.cause === "entityAttack" ? 0 : "cancel";
  }

  protected override async play(): Promise<Result | void> {
    const { timedOut } = await this.stage("Match", { seconds: this.config.timeLimitSeconds }, (stage) => {
      if (this.config.knockback.mode === "scripted") this.pushOnHit(stage.scope);
    });
    if (timedOut) return this.onTimeUp();
  }

  /** Scripted mode: the hit itself was canceled, so push the victim away from the attacker. */
  private pushOnHit(scope: Scope): void {
    const { horizontal, vertical, cooldownTicks } = this.config.knockback;
    const lastPush = new Map<string, number>();
    scope.subscribe(
      world.afterEvents.entityHitEntity,
      ({ damagingEntity, hitEntity }) => {
        if (hitEntity.typeId !== "minecraft:player") return;
        const attacker = damagingEntity as Player;
        const victim = hitEntity as Player;
        if (this.roster.get(attacker.name)?.state !== "alive" || this.roster.get(victim.name)?.state !== "alive") return;
        const key = victim.name.toLowerCase();
        if (system.currentTick - (lastPush.get(key) ?? Number.NEGATIVE_INFINITY) < cooldownTicks) return;
        lastPush.set(key, system.currentTick);
        const { x, z } = pushDirection(attacker.location, victim.location, attacker.getViewDirection());
        victim.applyKnockback({ x: x * horizontal, z: z * horizontal }, vertical);
      },
      { entityTypes: ["minecraft:player"] },
    );
  }
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
