// Damage rules and deaths. Lethal damage is canceled and turned into a "down" that the game
// handles (respawn, elimination), so players never see the vanilla death screen. Before-event
// handlers may only decide: the down itself runs on the next tick.
import {
  EntityComponentTypes,
  system,
  world,
  type Entity,
  type EntityDieAfterEvent,
  type EntityHurtAfterEvent,
  type EntityHurtBeforeEvent,
  type Player,
} from "@minecraft/server";
import type { CombatConfig } from "../config.ts";
import type { Scope } from "../scope.ts";
import type { KillCredit } from "./credit.ts";
import type { StatsRecorder } from "./stats.ts";

export interface Hit {
  victim: string;
  attacker?: string;
  cause: string;
  damage: number;
  /** Projectile type, when a projectile did it. */
  projectile?: string;
}

/** What combat needs from the game. */
export interface CombatHost {
  readonly playing: boolean;
  /** An alive participant: may deal and take damage. */
  canFight(name: string): boolean;
  /** Spawn protection. */
  isProtected(name: string): boolean;
  /** True when `a` may not hurt `b` (teammates without friendly fire). */
  areAllies(a: string, b: string): boolean;
  onDamage(hit: Hit): number | "cancel" | void;
  down(name: string, cause: string): void;
}

const MAX_HEALTH = 20;
/** Ticks after a vanilla death before the respawned player is handled. */
const BACKSTOP_DELAY_TICKS = 5;

export class Combat {
  private readonly host: CombatHost;
  private readonly config: CombatConfig;
  private readonly stats: StatsRecorder;
  private readonly credit: KillCredit;
  /** Players whose down is queued: every further hit is ignored until it runs. */
  private readonly dying = new Set<string>();

  constructor(host: CombatHost, config: CombatConfig, stats: StatsRecorder, credit: KillCredit) {
    this.host = host;
    this.config = config;
    this.stats = stats;
    this.credit = credit;
  }

  attach(scope: Scope): void {
    scope.subscribeBefore(world.beforeEvents.entityHurt, (event) => this.beforeHurt(event, scope), {
      entityFilter: { type: "minecraft:player" },
    });
    scope.subscribe(world.afterEvents.entityHurt, (event) => this.afterHurt(event), { entityTypes: ["minecraft:player"] });
    scope.subscribe(world.afterEvents.entityDie, (event) => this.died(event, scope), { entityTypes: ["minecraft:player"] });
  }

  /** Clears the "dying" mark once the player is back (respawned) or out. */
  settled(name: string): void {
    this.dying.delete(name.toLowerCase());
  }

  /**
   * A game-made hit, such as a paintball or a one-shot arrow, under the same rules as real
   * damage. Call it outside before-events.
   */
  hit(victim: Player, attacker: string | undefined, amount: number | "lethal"): void {
    const name = victim.name;
    if (!this.host.playing || this.dying.has(name.toLowerCase()) || !this.host.canFight(name) || this.host.isProtected(name)) return;
    if (attacker && (!this.host.canFight(attacker) || this.host.areAllies(attacker, name))) return;
    if (attacker) this.credit.hit(name, attacker, system.currentTick);
    const health = victim.getComponent(EntityComponentTypes.Health)?.currentValue ?? MAX_HEALTH;
    if (amount === "lethal" || amount >= health) {
      this.dying.add(name.toLowerCase());
      this.stats.damage(name, health, attacker);
      this.host.down(name, "entityAttack");
    } else {
      victim.applyDamage(amount);
    }
  }

  private beforeHurt(event: EntityHurtBeforeEvent, scope: Scope): void {
    const victim = event.hurtEntity as Player;
    const name = victim.name;
    const attacker = playerName(event.damageSource.damagingEntity);
    const cause = event.damageSource.cause;
    if (!this.host.playing || this.dying.has(name.toLowerCase()) || !this.host.canFight(name) || this.host.isProtected(name)) {
      event.cancel = true;
      return;
    }
    if (attacker !== undefined && attacker !== name) {
      if (!this.host.canFight(attacker) || this.host.areAllies(attacker, name)) {
        event.cancel = true;
        return;
      }
      this.credit.hit(name, attacker, system.currentTick);
    }
    if ((cause === "fall" && this.config.fall === false) || this.config.damage === "none") {
      event.cancel = true; // knockback games: the hit still counts toward kill credit (above)
      return;
    }
    // Measured on BDS 1.26.60: here the reported health already has this hit taken off, and
    // `damage` is after armor and resistance. So the health before the hit is the sum.
    const before = (victim.getComponent(EntityComponentTypes.Health)?.currentValue ?? MAX_HEALTH) + event.damage;
    const verdict = this.host.onDamage({ victim: name, attacker, cause, damage: event.damage, projectile: event.damageSource.damagingProjectile?.typeId });
    if (verdict === "cancel") {
      event.cancel = true;
      return;
    }
    if (typeof verdict === "number") event.damage = verdict; // final: armor isn't applied again
    // Absorption is spent after this event, so it could still save them: let the hit through,
    // and the entityDie backstop handles it if it does kill.
    if (event.damage >= before && !victim.getEffect("absorption")) {
      event.cancel = true;
      this.dying.add(name.toLowerCase());
      this.stats.damage(name, before, attacker);
      scope.defer(() => this.host.down(name, cause));
    }
  }

  /** Non-lethal damage that went through: count it. */
  private afterHurt(event: EntityHurtAfterEvent): void {
    if (!this.host.playing) return;
    const victim = (event.hurtEntity as Player).name;
    this.stats.damage(victim, Math.min(event.damage, MAX_HEALTH), playerName(event.damageSource.damagingEntity));
  }

  /** A death we couldn't intercept (/kill, or damage set straight to zero). */
  private died(event: EntityDieAfterEvent, scope: Scope): void {
    const name = (event.deadEntity as Player).name;
    if (!this.host.playing || this.dying.has(name.toLowerCase()) || !this.host.canFight(name)) return;
    this.dying.add(name.toLowerCase());
    // doImmediateRespawn brings them straight back; handle them once they are.
    scope.timeout(() => this.host.down(name, event.damageSource.cause), BACKSTOP_DELAY_TICKS);
  }
}

function playerName(entity: Entity | undefined): string | undefined {
  try {
    return entity?.typeId === "minecraft:player" ? (entity as Player).name : undefined;
  } catch {
    return undefined; // the attacker left
  }
}
