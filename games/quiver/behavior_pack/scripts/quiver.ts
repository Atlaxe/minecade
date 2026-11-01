// One in the Quiver on the minigame framework. Core already handles the rest: unlimited respawns
// after a short delay with spawn protection, a kill (and a point) for each credited down, the Kills
// sidebar, the clock and the stats. This class makes arrows lethal, pays an arrow for every kill,
// removes missed arrows, respawns players away from everyone, and ends the match at the kill target.
import { EntityComponentTypes, ItemLockMode, ItemStack, system, world, type Player, type Vector3 } from "@minecraft/server";
import {
  Minigame,
  deathMessage as killLine,
  describeError,
  log,
  nameOf,
  say,
  worldPoint,
  type Down,
  type DownDecision,
  type Hit,
  type MapPosition,
  type Result,
  type SpawnReason,
} from "@minecade/minigame-core";
import type config from "../../game.config.ts";

const ARROW = "minecraft:arrow";
/** The last hotbar slot: the arrow count shows there, out of the way of the sword and the bow. */
export const ARROW_SLOT = 8;
const MAX_STACK = 64;
/** Any arrow hit from another player is lethal. */
const LETHAL = 1000;
/** How long "+1 arrow" stays on the action bar after a kill. */
const REWARD_TICKS = 40;
/** Kill streaks are announced in chat every this many kills in a row. */
const STREAK_EVERY = 5;
/** The share of spawns, safest first, that a respawn picks from at random (at least one). */
const SAFE_SHARE = 0.3;
/** "<victim> was <verb> by <killer>" for an arrow kill; sword kills use the usual verbs. */
export const ARROW_VERBS = ["shot", "sniped", "skewered", "pinned", "picked off", "tagged"];

export class Quiver extends Minigame<typeof config> {
  /** When each player last earned an arrow (tick), for the action bar. */
  private readonly rewardAt = new Map<string, number>();

  /** The lobby's First to setting, or its first choice. */
  get killTarget(): number {
    const picked = Number(this.ctx.vars.settings.target);
    return Number.isInteger(picked) && picked > 0 ? picked : Number(this.config.options[0].values[0].value);
  }

  protected override setup(): void {
    // A missed arrow is gone: it's removed where it lands, so nobody can pick it up.
    this.scope.subscribe(world.afterEvents.projectileHitBlock, ({ projectile }) => {
      try {
        if (projectile.typeId === ARROW) projectile.remove();
      } catch (error) {
        log.warn(`quiver: could not remove an arrow: ${describeError(error)}`);
      }
    });
    // An arrow that reaches a player kills even when no damage event comes: a hit during the
    // victim's hit cooldown (just after a sword hit) fires none when it's weaker (measured on BDS).
    // When the damage event did come first, its down is already under way and this does nothing.
    this.scope.subscribe(world.afterEvents.projectileHitEntity, (event) => {
      try {
        const victim = event.getEntityHit().entity;
        const shooter = event.source;
        if (event.projectile.typeId !== ARROW || victim?.typeId !== "minecraft:player" || shooter?.typeId !== "minecraft:player") return;
        const from = (shooter as Player).name;
        if (from.toLowerCase() !== (victim as Player).name.toLowerCase()) this.combat.hit(victim as Player, from, "lethal", "projectile");
      } catch (error) {
        log.warn(`quiver: could not handle an arrow hit: ${describeError(error)}`);
      }
    });
  }

  protected override onStart(): void {
    this.broadcast(say.info(`First to ${this.killTarget} kills wins. An arrow kills in one hit, and every kill earns another.`));
  }

  /** Runs inside the before-event: decide only. */
  protected override onDamage(hit: Hit): number | "cancel" | void {
    if (hit.projectile !== ARROW) return;
    if (hit.attacker === undefined || hit.attacker.toLowerCase() === hit.victim.toLowerCase()) return "cancel";
    return LETHAL;
  }

  protected override onSpawn(player: Player, why: SpawnReason): void {
    giveArrows(player, this.config.arrows.perLife);
    // A late joiner is on the sidebar from the start, like everyone else.
    if (why === "join" && !this.score.entries().some(([id]) => id === player.name)) this.score.set(player.name, 0);
  }

  protected override onDown(name: string, down: Down): DownDecision | void {
    const killer = down.killer;
    if (killer === undefined) return;
    if (down.cause === "projectile") {
      this.stats.extra(killer, "bowKills", 1);
      const distance = this.shotDistance(name, killer);
      if (distance !== undefined) this.stats.extra(killer, "longestShot", distance);
    }
    const shooter = this.player(killer);
    if (shooter && this.roster.get(killer)?.state === "alive") {
      giveArrows(shooter, this.config.arrows.perKill);
      this.rewardAt.set(killer.toLowerCase(), system.currentTick);
      shooter.playSound("random.orb", { pitch: 1.4, volume: 0.7 });
    }
    const streak = this.stats.get(killer)?.streak ?? 0;
    if (streak > 0 && streak % STREAK_EVERY === 0) this.broadcast(say.highlight(`${nameOf(killer)} is on a ${streak} kill streak!`));
  }

  protected override deathMessage(victim: string, down: Down): string | undefined {
    if (down.killer === undefined || down.cause !== "projectile") return super.deathMessage(victim, down);
    const line = killLine({ victim, killer: down.killer, cause: down.cause }, { verbs: ARROW_VERBS, replace: true }, this.ctx.random);
    const distance = this.shotDistance(victim, down.killer);
    return distance === undefined ? line : `${line} ${say.minor(`(${distance} blocks)`)}`;
  }

  /** First to the kill target. Otherwise core's rule: the last player left wins once everyone else has gone. */
  protected override checkWin(): Result | undefined {
    const target = this.killTarget;
    const leader = this.score.reached(target);
    if (leader !== undefined) return this.playerWins(leader, `first to ${target} kills`);
    return super.checkWin();
  }

  /** Respawns and late joins land at one of the spawns farthest from everyone still alive. */
  protected override spawnPoint(name: string, why: SpawnReason): MapPosition {
    if (why === "start") return super.spawnPoint(name, why);
    const key = name.toLowerCase();
    const enemies = this.roster
      .inState("alive")
      .filter((participant) => participant.name.toLowerCase() !== key)
      .map((participant) => this.player(participant.name)?.location)
      .filter((location): location is Vector3 => location !== undefined);
    return pickSpawn(this.map.spawns, enemies, this.ctx.random) ?? super.spawnPoint(name, why);
  }

  protected override hud(name: string): string | undefined {
    const base = super.hud(name);
    const earned = this.rewardAt.get(name.toLowerCase());
    if (earned === undefined || system.currentTick - earned >= REWARD_TICKS) return base;
    const count = this.config.arrows.perKill;
    return [say.success(`+${count} arrow${count === 1 ? "" : "s"}`), base].filter(Boolean).join("   ");
  }

  /** Whole blocks between the killer and the victim, while both are here. */
  private shotDistance(victim: string, killer: string): number | undefined {
    const from = this.player(killer)?.location;
    const to = this.player(victim)?.location;
    return from && to ? Math.round(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)) : undefined;
  }
}

/** Adds arrows to the arrow slot (anywhere free if something else is there), locked in the inventory like kit items. */
export function giveArrows(player: Player, count: number): void {
  if (count <= 0) return;
  try {
    const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!inventory) return;
    const held = inventory.getItem(ARROW_SLOT);
    if (held !== undefined && held.typeId !== ARROW) {
      inventory.addItem(arrows(count));
      return;
    }
    const total = (held?.amount ?? 0) + count;
    inventory.setItem(ARROW_SLOT, arrows(Math.min(total, MAX_STACK)));
    if (total > MAX_STACK) inventory.addItem(arrows(total - MAX_STACK));
  } catch (error) {
    log.warn(`quiver: could not give ${player.name} arrows: ${describeError(error)}`);
  }
}

function arrows(count: number): ItemStack {
  const stack = new ItemStack(ARROW, count);
  stack.lockMode = ItemLockMode.inventory;
  return stack;
}

/**
 * A spawn away from the enemies: one of the safest few (the top 30%, at least one), at random so
 * respawns can't be predicted. With nobody else alive, any spawn. Undefined when there are none.
 */
export function pickSpawn(spawns: MapPosition[], enemies: Vector3[], random: () => number): MapPosition | undefined {
  if (spawns.length === 0) return undefined;
  const ranked = rankSpawns(spawns, enemies);
  const pool = enemies.length === 0 ? ranked : ranked.slice(0, Math.max(1, Math.round(ranked.length * SAFE_SHARE)));
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** Spawns from the one farthest from its nearest enemy to the closest (map order breaks ties). */
export function rankSpawns(spawns: MapPosition[], enemies: Vector3[]): MapPosition[] {
  const scored = spawns.map((spawn, index) => {
    const at = worldPoint(spawn);
    const nearest = Math.min(...enemies.map((enemy) => Math.hypot(enemy.x - at.x, enemy.y - at.y, enemy.z - at.z)));
    return { spawn, index, nearest };
  });
  return scored.sort((a, b) => b.nearest - a.nearest || a.index - b.index).map((entry) => entry.spawn);
}
