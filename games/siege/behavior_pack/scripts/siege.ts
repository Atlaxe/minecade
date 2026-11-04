// Siege on the minigame framework. Core already runs the rest: the two teams, the class form before
// every round (the kit form), one life a round with the last team standing taking it, best of 5
// with the circles top right, each round's clock, and the stats. This class gives each class its
// ability (the item in the last hotbar slot; the level over the hotbar counts the seconds until it's
// ready again), makes water hurt everyone but a Seaman (who is fast in it, and whose trident always
// comes back), and decides a round that runs out of time.
import { EntityComponentTypes, EquipmentSlot, ItemLockMode, system, world, type Entity, type ItemStack, type Player, type Vector3 } from "@minecraft/server";
import {
  COLOR,
  FAKE_PLAYER,
  LevelSeconds,
  Minigame,
  describeError,
  draw,
  kitStack,
  leapPush,
  log,
  nameOf,
  say,
  type Down,
  type DownDecision,
  type GameContext,
  type Hit,
  type Result,
} from "@minecade/minigame-core";
import type config from "../../game.config.ts";

/** A class: the id of its kit. */
export type ClassId = keyof typeof config.abilities;

const ARROW = "minecraft:arrow";
const TRIDENT = "minecraft:trident";
/** A down from water: in it, or soaked by a Tidal Wave. */
export const WATER = "water";
/** Minecraft's own: a player hit takes no other hit for this long. A Fortified Tank keeps it. */
const HIT_COOLDOWN_TICKS = 10;
const ABILITY_CHECK_TICKS = 5;
const SEAMAN_CHECK_TICKS = 10;
const WATER_HURT_TICKS = 20;
/** A Seaman's Speed in water lasts this long, renewed at every check while they're in it. */
const SEAMAN_SPEED_TICKS = 15;
const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
/** What a player hears when their ability is ready again, and when they use it too soon. */
const READY_SOUND = "random.orb";
const NOT_READY_SOUND = "note.bass";

/** A vanished Assassin: until when, the armor taken off them, and the name over their head. */
interface Vanish {
  until: number;
  armor: (ItemStack | undefined)[];
  nameTag: string;
}

/** A team when a round runs out of time: its players still standing, and their health added up. */
export interface Standing {
  team: string;
  players: number;
  health: number;
}

/**
 * Who takes a round that ran out of time: the team with more players standing, then the one with
 * more health left (`by` says which). Undefined for a draw.
 */
export function timeUpWinner(sides: Standing[]): { team: string; by: "players" | "health" } | undefined {
  const [first, second] = [...sides].sort((a, b) => b.players - a.players || b.health - a.health);
  if (!first || first.players === 0) return undefined;
  if (!second || first.players > second.players) return { team: first.team, by: "players" };
  return first.health > second.health ? { team: first.team, by: "health" } : undefined;
}

/** A Volley's directions: the look, turned left and right around the vertical `spreadDegrees` apart, `count` in all. */
export function fan(view: Vector3, count: number, spreadDegrees: number): Vector3[] {
  const length = Math.hypot(view.x, view.y, view.z) || 1;
  const [x, y, z] = [view.x / length, view.y / length, view.z / length];
  return Array.from({ length: count }, (_, index) => {
    const angle = ((index - (count - 1) / 2) * spreadDegrees * Math.PI) / 180;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    return { x: x * cos - z * sin, y, z: x * sin + z * cos };
  });
}

export class Siege extends Minigame<typeof config> {
  /** Each player's level counts down the seconds until their ability is ready. */
  private readonly levels = new LevelSeconds();
  /** When each player's ability can be used again (tick). */
  private readonly readyAt = new Map<string, number>();
  /** Players whose ability is cooling down: they hear it once it's ready. */
  private readonly cooling = new Set<string>();
  /** Until when a Tidal Wave keeps each player soaked: water hurts them wherever they are. */
  private readonly soakedUntil = new Map<string, number>();
  /** Until when each Tank is Fortified, and when a hit last came off one. */
  private readonly fortifiedUntil = new Map<string, number>();
  private readonly absorbedAt = new Map<string, number>();
  private readonly vanished = new Map<string, Vanish>();
  /** When each Seaman's trident went (tick), for a new one if it doesn't come back. */
  private readonly tridentGoneAt = new Map<string, number>();
  /** The class each player was last told about, so they're told again only when they change. */
  private readonly told = new Map<string, string>();

  /** `picturePack`: the game's resource pack UUID, where the build draws the class form's pictures. */
  constructor(ctx: GameContext, gameConfig: typeof config, picturePack?: string) {
    super(ctx, gameConfig);
    this.kitPicturePack = picturePack;
  }

  /** A player's class: the kit they picked (the first, until they pick). */
  classOf(name: string): ClassId | undefined {
    return this.kits.kitFor(name)?.id as ClassId | undefined;
  }

  protected override setup(): void {
    // A shot arrow (a bow's or a Volley's) is gone as it lands, so nobody picks it up.
    this.scope.subscribe(world.afterEvents.projectileHitBlock, ({ projectile }) => {
      try {
        if (projectile.typeId === ARROW) projectile.remove();
      } catch (error) {
        log.warn(`siege: could not remove an arrow: ${describeError(error)}`);
      }
    });
    this.scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => this.useAbility(source, itemStack.typeId));
    // A vanished Assassin shows again once they hit someone or someone hits them (water and falls don't count).
    this.scope.subscribe(
      world.afterEvents.entityHurt,
      ({ hurtEntity, damageSource }) => {
        const attacker = this.whoIs(damageSource.damagingEntity);
        if (attacker === undefined) return;
        for (const name of [attacker, this.whoIs(hurtEntity)]) if (name !== undefined && this.vanished.has(name.toLowerCase())) this.reveal(name);
      },
      { entityTypes: ["minecraft:player", FAKE_PLAYER] },
    );
    this.scope.interval(() => this.watchAbilities(), ABILITY_CHECK_TICKS);
    this.scope.interval(() => this.watchSeamen(), SEAMAN_CHECK_TICKS);
    this.scope.interval(() => this.hurtInWater(), WATER_HURT_TICKS);
  }

  protected override onRoundStart(round: number): void {
    const series = this.bestOf;
    if (round === 1 && series) {
      this.broadcast(say.info(`The last team standing takes the round. Best of ${series.rounds}: the first to ${series.winsNeeded} rounds wins.`));
      this.broadcast(say.minor("Your class's ability is the item in your last hotbar slot. The number over your hotbar counts down until it's ready again."));
    }
    // Each player hears what their class does, the first round they play it.
    for (const participant of this.roster.inState("alive")) {
      const key = participant.name.toLowerCase();
      const kit = this.kits.kitFor(participant.name);
      const player = this.player(participant.name);
      if (!kit || !player || this.told.get(key) === kit.id) continue;
      this.told.set(key, kit.id);
      player.sendMessage(`${say.important(`${kit.name}:`)} ${say.info(this.abilityText(kit.id as ClassId))}`);
    }
  }

  /** A spawn (the start, or the next round) brings the ability back and clears what the last round left. */
  protected override onSpawn(player: Player): void {
    const key = player.name.toLowerCase();
    const states: Map<string, unknown>[] = [this.readyAt, this.soakedUntil, this.fortifiedUntil, this.absorbedAt, this.vanished, this.tridentGoneAt];
    for (const state of states) state.delete(key);
    this.cooling.delete(key);
    this.levels.forget(player.name);
  }

  /** Out until the next round, when the kit brings everything back. An Assassin who struck from hiding shows again. */
  protected override onDown(name: string, down: Down): DownDecision | void {
    const key = name.toLowerCase();
    this.vanished.delete(key);
    this.fortifiedUntil.delete(key);
    this.soakedUntil.delete(key);
    if (down.killer !== undefined && this.vanished.has(down.killer.toLowerCase())) this.reveal(down.killer);
  }

  protected override deathMessage(victim: string, down: Down): string | undefined {
    if (down.cause !== WATER || down.killer !== undefined) return super.deathMessage(victim, down);
    return `${nameOf(victim, this.teamOf(victim)?.color ?? COLOR.minor)} ${COLOR.highlight}was washed away§r`;
  }

  /**
   * A Scout takes no fall damage. A hit on a Fortified Tank is canceled, so it pushes nobody, and its
   * damage comes off on the next tick instead (absorb). Minecraft's half second between hits stays:
   * a canceled hit doesn't start it, so quick clicks would add up otherwise.
   */
  protected override onDamage(hit: Hit): number | "cancel" | void {
    if (hit.cause === "fall" && this.classOf(hit.victim) === "scout") return "cancel";
    const attacker = hit.attacker;
    if (attacker === undefined || !this.fortified(hit.victim)) return;
    const key = hit.victim.toLowerCase();
    const now = system.currentTick;
    if (now - (this.absorbedAt.get(key) ?? -HIT_COOLDOWN_TICKS) < HIT_COOLDOWN_TICKS) return "cancel";
    this.absorbedAt.set(key, now);
    const { victim, damage, cause } = hit;
    this.scope.defer(() => this.absorb(victim, attacker, damage, cause));
    return "cancel";
  }

  /** A round out of time: the team with more players standing takes it, then the one with more health left. */
  protected override onRoundTimeUp(): Result {
    const sides = this.teamDefs.map((team): Standing => {
      const standing = this.roster.teamMembers(team.id).filter((member) => member.state === "alive");
      const health = standing.reduce((sum, member) => sum + (this.body(member.name)?.getComponent(EntityComponentTypes.Health)?.currentValue ?? 0), 0);
      return { team: team.id, players: standing.length, health };
    });
    const winner = timeUpWinner(sides);
    if (!winner) return draw("time ran out");
    return this.teamWins(winner.team, winner.by === "players" ? "more players standing" : "more health left");
  }

  private fortified(name: string): boolean {
    return (this.fortifiedUntil.get(name.toLowerCase()) ?? 0) > system.currentTick;
  }

  /** One line on what a class's ability does, with this match's numbers. */
  private abilityText(id: ClassId): string {
    const abilities = this.config.abilities;
    const every = ` Ready every ${abilities[id].cooldownSeconds} seconds.`;
    switch (id) {
      case "soldier":
        return `Rally gives you and teammates within ${abilities.soldier.radius} blocks Strength and Speed for ${abilities.soldier.seconds} seconds.${every}`;
      case "archer":
        return `Volley shoots ${abilities.archer.arrows} arrows at once, where you look.${every}`;
      case "seaman":
        return `Tidal Wave pushes away and soaks enemies within ${abilities.seaman.radius} blocks. Water doesn't hurt you, and you're fast in it.${every}`;
      case "tank":
        return `Fortify: for ${abilities.tank.seconds} seconds you take less damage, and hits don't push you.${every}`;
      case "medic":
        return `Heal gives you and teammates within ${abilities.medic.radius} blocks ${abilities.medic.health / 2} hearts back.${every}`;
      case "scout":
        return `Leap throws you the way you look, and you never take fall damage.${every}`;
      case "assassin":
        return `Vanish makes you invisible for ${abilities.assassin.seconds} seconds, until you hit someone or someone hits you.${every}`;
    }
  }

  /** Using a class's ability item: its ability, once it's ready, while a round is played. */
  private useAbility(player: Player, typeId: string): void {
    const name = player.name;
    if (!this.roundInPlay || this.roster.get(name)?.state !== "alive") return;
    const kit = this.kits.kitFor(name);
    if (!kit || kit.items.find((item) => item.slot === this.config.abilitySlot)?.item !== typeId) return;
    const id = kit.id as ClassId;
    const key = name.toLowerCase();
    const now = system.currentTick;
    if ((this.readyAt.get(key) ?? 0) > now) {
      player.playSound(NOT_READY_SOUND, { pitch: 0.7, volume: 0.6 });
      return;
    }
    try {
      this.ability(player, id);
    } catch (error) {
      log.warn(`siege: ${name}'s ${kit.name} ability failed: ${describeError(error)}`);
    }
    this.readyAt.set(key, now + this.config.abilities[id].cooldownSeconds * 20);
    this.cooling.add(key);
  }

  private ability(player: Player, id: ClassId): void {
    switch (id) {
      case "soldier":
        return this.rally(player);
      case "archer":
        return this.volley(player);
      case "seaman":
        return this.tidalWave(player);
      case "tank":
        return this.fortify(player);
      case "medic":
        return this.heal(player);
      case "scout":
        return this.leap(player);
      case "assassin":
        return this.vanish(player);
    }
  }

  /** Rally: Strength and Speed for the Soldier and every teammate near. */
  private rally(player: Player): void {
    const { radius, seconds } = this.config.abilities.soldier;
    const ticks = seconds * 20;
    for (const { body } of this.near(player.name, player.location, radius, "team")) {
      body.addEffect("strength", ticks, { amplifier: 0, showParticles: false });
      // A longer Speed (a Scout's own) stays as it is.
      if ((body.getEffect("speed")?.duration ?? 0) < ticks) body.addEffect("speed", ticks, { amplifier: 0, showParticles: false });
      this.particle("minecraft:villager_angry", above(body.location, 2.2));
    }
    this.sound("raid.horn", player.location, 0.5);
  }

  /** Volley: arrows at once in a fan where the Archer looks, theirs as if shot from their bow. */
  private volley(player: Player): void {
    const { arrows, spreadDegrees, speed } = this.config.abilities.archer;
    const head = player.getHeadLocation();
    const dimension = world.getDimension("overworld");
    for (const direction of fan(player.getViewDirection(), arrows, spreadDegrees)) {
      const arrow = dimension.spawnEntity(ARROW, { x: head.x + direction.x, y: head.y + direction.y, z: head.z + direction.z });
      this.track(arrow);
      const projectile = arrow.getComponent(EntityComponentTypes.Projectile);
      if (!projectile) {
        arrow.remove();
        continue;
      }
      projectile.owner = player;
      projectile.shoot({ x: direction.x * speed, y: direction.y * speed, z: direction.z * speed });
    }
    this.sound("random.bow", head);
  }

  /** Tidal Wave: every enemy near is pushed away (a Fortified Tank isn't), slowed, and soaked. */
  private tidalWave(player: Player): void {
    const { radius, push, lift, soakSeconds } = this.config.abilities.seaman;
    const from = player.location;
    const now = system.currentTick;
    for (const { name, body } of this.near(player.name, from, radius, "enemies")) {
      const away = { x: body.location.x - from.x, z: body.location.z - from.z };
      const length = Math.hypot(away.x, away.z) || 1;
      if (!this.fortified(name)) body.applyKnockback({ x: (away.x / length) * push, z: (away.z / length) * push }, lift);
      body.addEffect("slowness", soakSeconds * 20, { amplifier: 0, showParticles: false });
      this.soakedUntil.set(name.toLowerCase(), now + soakSeconds * 20);
      // A soaked player who goes down is the Seaman's kill.
      this.credit.hit(name, player.name, now);
      this.particle("minecraft:water_splash_particle_manual", above(body.location, 1));
    }
    for (let step = 0; step < 12; step++) {
      const angle = (step / 12) * Math.PI * 2;
      this.particle("minecraft:water_splash_particle_manual", { x: from.x + Math.cos(angle) * 2, y: from.y + 0.5, z: from.z + Math.sin(angle) * 2 });
    }
    this.sound("random.splash", from);
  }

  /** Fortify: Resistance, and no hit pushes the Tank (onDamage), for a few seconds. */
  private fortify(player: Player): void {
    const { seconds, resistance } = this.config.abilities.tank;
    player.addEffect("resistance", seconds * 20, { amplifier: resistance, showParticles: false });
    this.fortifiedUntil.set(player.name.toLowerCase(), system.currentTick + seconds * 20);
    this.sound("mob.shulker.close", player.location);
  }

  /** Heal: health back for the Medic and every teammate near. */
  private heal(player: Player): void {
    const { radius, health } = this.config.abilities.medic;
    for (const { body } of this.near(player.name, player.location, radius, "team")) {
      const component = body.getComponent(EntityComponentTypes.Health);
      if (!component) continue;
      component.setCurrentValue(Math.min(component.effectiveMax, component.currentValue + health));
      this.particle("minecraft:heart_particle", above(body.location, 2.2));
    }
    this.sound("beacon.power", player.location);
  }

  /** Leap: a push the way the Scout looks. */
  private leap(player: Player): void {
    const push = leapPush(player.getViewDirection(), this.config.abilities.scout);
    player.applyKnockback({ x: push.x, z: push.z }, push.vertical);
    player.playSound("mob.enderdragon.flap", { pitch: 1.6, volume: 0.6 });
  }

  /** Vanish: invisible, with no armor and no name over their head, until it runs out or they hit or are hit. */
  private vanish(player: Player): void {
    const { seconds } = this.config.abilities.assassin;
    const equipment = player.getComponent(EntityComponentTypes.Equippable);
    const armor = ARMOR_SLOTS.map((slot) => equipment?.getEquipment(slot));
    for (const slot of ARMOR_SLOTS) equipment?.setEquipment(slot, undefined);
    this.vanished.set(player.name.toLowerCase(), { until: system.currentTick + seconds * 20, armor, nameTag: player.nameTag });
    player.nameTag = "";
    player.addEffect("invisibility", seconds * 20, { amplifier: 0, showParticles: false });
    this.particle("minecraft:basic_smoke_particle", above(player.location, 1));
    this.sound("mob.endermen.portal", player.location);
  }

  /** A vanished Assassin in sight again, in their armor and with their name. */
  private reveal(name: string): void {
    const key = name.toLowerCase();
    const vanish = this.vanished.get(key);
    this.vanished.delete(key);
    const player = this.player(name);
    if (!vanish || !player) return;
    try {
      player.removeEffect("invisibility");
      const equipment = player.getComponent(EntityComponentTypes.Equippable);
      ARMOR_SLOTS.forEach((slot, index) => equipment?.setEquipment(slot, vanish.armor[index]));
      player.nameTag = vanish.nameTag;
      this.sound("mob.endermen.portal", player.location);
    } catch (error) {
      log.warn(`siege: could not bring ${name} back into sight: ${describeError(error)}`);
    }
  }

  /** A Fortified Tank's hit, taken without its push: the damage off their health and the attacker credited, or a down when it's lethal. */
  private absorb(victim: string, attacker: string, damage: number, cause: string): void {
    const body = this.body(victim);
    const health = body?.getComponent(EntityComponentTypes.Health);
    if (!body || !health || !this.roundInPlay || this.roster.get(victim)?.state !== "alive") return;
    if (this.vanished.has(attacker.toLowerCase())) this.reveal(attacker);
    if (damage >= health.currentValue) {
      this.combat.hit(body, attacker, "lethal", cause);
      return;
    }
    this.credit.hit(victim, attacker, system.currentTick);
    this.stats.damage(victim, damage, attacker);
    health.setCurrentValue(health.currentValue - damage);
    this.sound("game.player.hurt", body.location);
  }

  /** The level over each player's hotbar: the seconds until their ability is ready, with a chime once it is. Vanish runs out here. */
  private watchAbilities(): void {
    if (this.phase !== "playing") return;
    const now = system.currentTick;
    for (const [key, vanish] of [...this.vanished]) if (vanish.until <= now) this.reveal(key);
    for (const participant of this.roster.inState("alive")) {
      const player = this.player(participant.name);
      if (!player) continue;
      const key = participant.name.toLowerCase();
      const seconds = Math.max(0, Math.ceil(((this.readyAt.get(key) ?? 0) - now) / 20));
      this.levels.show(player, seconds);
      if (seconds === 0 && this.cooling.delete(key)) player.playSound(READY_SOUND, { pitch: 1.4, volume: 0.6 });
    }
  }

  /** Seamen: Speed while they're in water, and always their trident. */
  private watchSeamen(): void {
    if (!this.roundInPlay) return;
    const now = system.currentTick;
    for (const participant of this.roster.inState("alive")) {
      if (this.classOf(participant.name) !== "seaman") continue;
      const body = this.body(participant.name);
      if (body && inWater(body)) body.addEffect("speed", SEAMAN_SPEED_TICKS, { amplifier: this.config.water.seamanSpeed, showParticles: false });
      const player = this.player(participant.name);
      if (player) this.keepTrident(player, now);
    }
  }

  /**
   * A Seaman always has one trident. Loyalty brings a thrown one back, and it's locked again here
   * (so it can't be dropped); one that hasn't come back in a few seconds is replaced, and a late one
   * that comes back after all is taken away.
   */
  private keepTrident(player: Player, now: number): void {
    const key = player.name.toLowerCase();
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      if (!inventory) return;
      let found = 0;
      for (let slot = 0; slot < inventory.size; slot++) {
        const stack = inventory.getItem(slot);
        if (stack?.typeId !== TRIDENT) continue;
        found++;
        if (found > 1) {
          inventory.setItem(slot, undefined);
        } else if (stack.lockMode !== ItemLockMode.inventory) {
          stack.lockMode = ItemLockMode.inventory;
          inventory.setItem(slot, stack);
        }
      }
      if (found > 0) {
        this.tridentGoneAt.delete(key);
        return;
      }
      const since = this.tridentGoneAt.get(key) ?? now;
      this.tridentGoneAt.set(key, since);
      if (now - since < this.config.tridentBackSeconds * 20) return;
      const kit = this.kits.kitFor(player.name);
      const entry = kit?.items.find((item) => item.item === TRIDENT);
      if (!kit || !entry) return;
      const stack = kitStack(kit, entry, this.teamOf(player.name)?.color);
      if (entry.slot !== undefined && inventory.getItem(entry.slot) === undefined) inventory.setItem(entry.slot, stack);
      else inventory.addItem(stack);
      this.tridentGoneAt.delete(key);
      player.playSound("item.trident.return");
    } catch (error) {
      log.warn(`siege: could not give ${player.name} their trident back: ${describeError(error)}`);
    }
  }

  /** Water hurts everyone but a Seaman, and so does a Tidal Wave's soaking, wherever they are. */
  private hurtInWater(): void {
    if (!this.roundInPlay) return;
    const now = system.currentTick;
    for (const participant of this.roster.inState("alive")) {
      if (this.classOf(participant.name) === "seaman") continue;
      const body = this.body(participant.name);
      const soaked = (this.soakedUntil.get(participant.name.toLowerCase()) ?? 0) > now;
      if (body && (soaked || inWater(body))) this.combat.hit(body, undefined, this.config.water.damage, WATER);
    }
  }

  /** Players still in the round within `radius` blocks of `at` (a preview's fake players too): `name`'s team (them too), or its enemies. */
  private near(name: string, at: Vector3, radius: number, side: "team" | "enemies"): { name: string; body: Entity }[] {
    const team = this.teamOf(name)?.id;
    const found: { name: string; body: Entity }[] = [];
    for (const participant of this.roster.inState("alive")) {
      if ((participant.team === team) !== (side === "team")) continue;
      const body = this.body(participant.name);
      if (body && distance(body.location, at) <= radius) found.push({ name: participant.name, body });
    }
    return found;
  }

  private particle(id: string, at: Vector3): void {
    try {
      world.getDimension("overworld").spawnParticle(id, at);
    } catch {
      // not loaded
    }
  }

  private sound(id: string, at: Vector3, volume = 1): void {
    try {
      world.getDimension("overworld").playSound(id, at, { volume });
    } catch {
      // not loaded
    }
  }
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function above(at: Vector3, by: number): Vector3 {
  return { x: at.x, y: at.y + by, z: at.z };
}

function inWater(body: Entity): boolean {
  try {
    return body.isInWater;
  } catch {
    return false; // gone
  }
}
