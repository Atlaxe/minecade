// The arsenal's effects, for any game that hands out the real guns, grenades, knife and stimpack
// (defs.ts's ARSENAL_*): an Arsenal fires them (its own Guns) and does what each does to players,
// through a small host the game gives it, which owns the rules (who's fighting, teams, protection,
// kill credit; core's combat.hit with { direct: true } does all of it).
//
// - Bullets and beams take their damage (headshots, falloff) from whoever they hit; a rocket's
//   direct hit too, then its blast. The shooter hears a hit, a headshot and a down apart.
// - A frag grenade's and a rocket's blast hurt everyone near, less far off and through cover, and
//   throw them out; the thrower takes their own share (BLASTS). No blocks break.
// - A Molotov leaves a pool of flames that hurts whoever stands in it (FIRE); no fire blocks.
// - A flashbang whites out the screens of players who can see it, more the closer and the more
//   they look at it (FLASH), thrower included.
// - A smoke grenade leaves a cloud that blinds whoever stands in it (SMOKE).
// - A throwing knife kills whoever it hits, and floats where it came to rest until someone walks
//   over it and takes it.
// - A stimpack, used with either click, gives health back and a moment of Speed (STIM).
// - vanillaDamage: for the game's onDamage, a crossbow's arrow and a netherite sword kill in one hit.
//   Crossbow carriers are kept in arrows, and arrows that land are taken away.
import { EntityComponentTypes, ItemStack, MolangVariableMap, system, world, type Dimension, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { describeError, log, type Hit, type Scope } from "@minecade/minigame-core";
import {
  ARSENAL_GUN_DEFS,
  ARSENAL_MODELS,
  ARSENAL_PICKUP,
  ARSENAL_THROWABLE_DEFS,
  BLASTS,
  CROSSBOW_ARROWS,
  FIRE,
  FLASH,
  MODEL_PROPERTY,
  ONE_HIT,
  PARTICLES,
  SMOKE,
  STIM,
  STIMPACK,
  arsenalItem,
  blastDamage,
  flashStrength,
  type BlastDef,
  type GunDef,
  type ThrowableDef,
} from "./defs.ts";
import { Guns, ammoText, heldItem, type HitInfo, type Shot } from "./guns.ts";

/** What hurt a player, for the game's kill feed. */
export type ArsenalCause = "gun" | "explosion" | "fire" | "knife";
/** What came of a hurt: it put them down, it took health, or it didn't count (a teammate, protection, not fighting). */
export type HurtResult = "down" | "hurt" | undefined;

export interface ArsenalHost {
  /** Whether a player may fire, throw or use a stimpack now: playing, not out. */
  canFire(player: Player): boolean;
  /** The bodies the arsenal reaches: every participant still fighting (players, and a preview's fake players). */
  targets(): Entity[];
  /** A participant's name for one of those bodies; undefined for anything else (bullets pass through it). */
  nameOf(entity: Entity): string | undefined;
  /**
   * Takes `amount` of a body's health (or all of it), credited to `attacker`, none for a player's
   * own blast or fire. The game's rules decide whether it counts.
   */
  hurt(victim: Entity, attacker: string | undefined, amount: number | "lethal", cause: ArsenalCause): HurtResult;
  /** A knife picked up off the map: where it goes. The first free hotbar slot when left out. */
  give?(player: Player, item: string): boolean;
}

export interface ArsenalOptions {
  /** The guns and throwables it fires: every arsenal gun and throwable by default. */
  guns?: readonly GunDef[];
  throwables?: readonly ThrowableDef[];
  random?: () => number;
  /** Arrows each crossbow carrier is kept at (CROSSBOW_ARROWS by default). */
  arrows?: number;
  /** A magazine changed (a shot, a reload starting or done): the game can show ammoLine at once. */
  onAmmo?(player: Player): void;
}

/** Damage past anyone's health: what vanillaDamage gives a one-hit kill. */
export const LETHAL = 1000;
const TICK_EVERY = 2;
const SMOKE_BLIND_TICKS = 30;
const SMOKE_BLIND_EVERY = 10;
const ARROW_CHECK_TICKS = 20;
/** How close (blocks, from the knife to the feet) takes a knife off the map. */
const KNIFE_REACH = 1.5;
/** How far down a Molotov's flames or a smoke cloud look for the ground under where it hit. */
const GROUND_SEARCH = 6;
const FLASH_COLOR = { red: 1, green: 1, blue: 1 };
const FIRE_SWINGS = new Set<string>(["Attack", "Mine", "None"]);

const SOUNDS = {
  hit: { id: "random.orb", pitch: 1.2, volume: 0.5 },
  headshot: { id: "random.orb", pitch: 1.9, volume: 0.6 },
  down: { id: "random.levelup", pitch: 1.8, volume: 0.5 },
  hurt: { id: "game.player.hurt", pitch: 1, volume: 0.8 },
  explosion: { id: "random.explode", pitch: 1, volume: 1.4 },
  ignite: { id: "fire.ignite", pitch: 0.8, volume: 1.2 },
  flashRing: { id: "note.pling", pitch: 2, volume: 0.6 },
  pickUp: { id: "random.pop", pitch: 1.4, volume: 0.6 },
} as const;

interface Fire {
  at: Vector3;
  thrower: string;
  until: number;
  nextHurt: number;
}

interface Cloud {
  at: Vector3;
  until: number;
  nextBlind: number;
}

interface Knife {
  entity: Entity;
  at: Vector3;
}

export class Arsenal {
  /** The guns underneath: forget, refill, reload, ammoOf and isAiming are theirs. */
  readonly guns: Guns;
  private readonly host: ArsenalHost;
  private readonly arrows: number;
  private readonly fires: Fire[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly knives: Knife[] = [];
  /** When each player (lowercase) may use a stimpack again. */
  private readonly stimReady = new Map<string, number>();

  constructor(scope: Scope, host: ArsenalHost, options: ArsenalOptions = {}) {
    this.host = host;
    this.arrows = options.arrows ?? CROSSBOW_ARROWS;
    this.guns = new Guns(scope, {
      guns: options.guns ?? Object.values(ARSENAL_GUN_DEFS),
      throwables: options.throwables ?? Object.values(ARSENAL_THROWABLE_DEFS),
      canFire: (player) => host.canFire(player),
      isTarget: (entity) => host.nameOf(entity) !== undefined,
      onHitEntity: (shot, entity, location, info) => this.struck(shot, entity, location, info),
      onBurst: (shot, location) => this.burst(shot, location),
      onAmmo: options.onAmmo && ((player) => options.onAmmo!(player)),
      random: options.random,
    });
    const stimpack = arsenalItem(STIMPACK);
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (itemStack.typeId === stimpack) this.stim(source);
    });
    scope.subscribe(world.afterEvents.playerInteractWithBlock, ({ player, itemStack, isFirstEvent }) => {
      if (isFirstEvent && itemStack?.typeId === stimpack) this.stim(player);
    });
    scope.subscribe(world.afterEvents.playerSwingStart, ({ player, heldItemStack, swingSource }) => {
      if (heldItemStack?.typeId === stimpack && FIRE_SWINGS.has(swingSource)) this.stim(player);
    });
    // A crossbow's arrows don't pile up: each is gone where it lands (a hit on a player is the game's onDamage).
    scope.subscribe(world.afterEvents.projectileHitBlock, ({ projectile }) => {
      try {
        if (projectile.typeId === ONE_HIT.arrow) projectile.remove();
      } catch {
        // already gone
      }
    });
    scope.interval(() => this.tick(), TICK_EVERY);
    scope.interval(() => this.topUpArrows(), ARROW_CHECK_TICKS);
    scope.add(() => this.clear());
  }

  /**
   * For the game's onDamage: a crossbow's arrow or a netherite sword's hit kills outright (LETHAL);
   * undefined for anything else, which the game rules on.
   */
  vanillaDamage(hit: Hit): number | undefined {
    if (hit.projectile === ONE_HIT.arrow) return LETHAL;
    if (hit.cause !== "entityAttack" || hit.attacker === undefined || hit.projectile !== undefined) return undefined;
    const attacker = world.getAllPlayers().find((player) => player.name.toLowerCase() === hit.attacker!.toLowerCase());
    return attacker && heldItem(attacker)?.typeId === ONE_HIT.sword ? LETHAL : undefined;
  }

  /** The held gun's magazine as a HUD line ("12/30", "Reloading"); undefined for no gun with ammo. */
  ammoLine(player: Player): string | undefined {
    const ammo = this.guns.ammoOf(player);
    return ammo && ammoText(ammo);
  }

  /** A player went down or left: their trigger, aim and stimpack wait go. */
  forget(name: string): void {
    this.guns.forget(name);
    this.stimReady.delete(name.toLowerCase());
  }

  /** Full magazines for a player (a respawn, a new round). */
  refill(name: string): void {
    this.guns.refill(name);
  }

  // ---- Hits ------------------------------------------------------------------------------------

  /** A bullet, beam, rocket or knife hit a body. */
  private struck(shot: Shot, entity: Entity, location: Vector3, info: HitInfo | undefined): void {
    const name = this.host.nameOf(entity);
    if (name === undefined || name.toLowerCase() === shot.shooter.toLowerCase()) return;
    const knife = shot.weapon === "throwing_knife";
    const amount = knife ? "lethal" : info?.damage;
    if (amount === undefined || amount === 0) return;
    const cause: ArsenalCause = knife ? "knife" : shot.weapon === "rpg" ? "explosion" : "gun";
    const result = this.host.hurt(entity, shot.shooter, amount, cause);
    const dimension = world.getDimension("overworld");
    particle(dimension, PARTICLES.hit, location);
    if (!result) return;
    playAt(dimension, SOUNDS.hurt, entity.location);
    this.playTo(shot.shooter, result === "down" ? SOUNDS.down : info?.headshot ? SOUNDS.headshot : SOUNDS.hit);
  }

  /** A grenade's fuse ran out, a Molotov or rocket hit, or a knife came to rest. */
  private burst(shot: Shot, location: Vector3): void {
    try {
      switch (shot.weapon) {
        case "frag_grenade":
          return this.explode(shot, location, BLASTS.frag_grenade);
        case "rpg":
          playAt(world.getDimension("overworld"), SOUNDS.explosion, location);
          return this.explode(shot, location, BLASTS.rpg);
        case "molotov":
          return this.ignite(shot, location);
        case "flashbang":
          return this.flash(location);
        case "smoke_grenade":
          return this.smoke(location);
        case "throwing_knife":
          return this.dropKnife(location);
      }
    } catch (error) {
      log.warn(`arsenal: ${shot.weapon} at ${location.x.toFixed(1)} ${location.y.toFixed(1)} ${location.z.toFixed(1)} failed: ${describeError(error)}`);
    }
  }

  /** A blast: everyone near is hurt (less far off, a quarter through cover) and thrown out from its middle. */
  private explode(shot: Shot, at: Vector3, blast: BlastDef): void {
    const dimension = world.getDimension("overworld");
    const variables = new MolangVariableMap();
    variables.setFloat("variable.radius", blast.radius);
    particle(dimension, PARTICLES.explosion, at, variables);
    for (const body of this.host.targets()) {
      const name = this.host.nameOf(body);
      if (name === undefined) continue;
      const middle = { x: body.location.x, y: body.location.y + 0.9, z: body.location.z };
      const far = distance(at, middle);
      if (far >= blast.radius) continue;
      const own = name.toLowerCase() === shot.shooter.toLowerCase();
      const amount = blastDamage(blast, far, blocked(dimension, at, middle)) * (own ? blast.selfFactor : 1);
      if (amount > 0.05) this.host.hurt(body, own ? undefined : shot.shooter, amount, "explosion");
      push(body, at, blast.push * (1 - far / blast.radius));
    }
  }

  /** A Molotov's flames, on the ground under where it broke, for FIRE.seconds. */
  private ignite(shot: Shot, at: Vector3): void {
    const dimension = world.getDimension("overworld");
    const ground = groundUnder(dimension, at);
    const variables = new MolangVariableMap();
    variables.setFloat("variable.radius", FIRE.radius);
    variables.setFloat("variable.seconds", FIRE.seconds);
    particle(dimension, PARTICLES.fire, ground, variables);
    playAt(dimension, SOUNDS.ignite, ground);
    const now = system.currentTick;
    this.fires.push({ at: ground, thrower: shot.shooter, until: now + FIRE.seconds * 20, nextHurt: now });
  }

  /** A flashbang: each player who can see it is whited out by how close and how straight they look at it. */
  private flash(at: Vector3): void {
    const dimension = world.getDimension("overworld");
    particle(dimension, PARTICLES.flash, at);
    for (const body of this.host.targets()) {
      if (body.typeId !== "minecraft:player") continue;
      const player = body as Player;
      const eye = player.getHeadLocation();
      const far = distance(eye, at);
      if (far >= FLASH.range || far < 1e-3) continue;
      const toward = { x: (at.x - eye.x) / far, y: (at.y - eye.y) / far, z: (at.z - eye.z) / far };
      const view = player.getViewDirection();
      const facing = view.x * toward.x + view.y * toward.y + view.z * toward.z;
      const strength = flashStrength(far, facing, !blocked(dimension, eye, at));
      if (strength <= 0.05) continue;
      try {
        player.camera.fade({
          fadeColor: FLASH_COLOR,
          fadeTime: { fadeInTime: 0.05, holdTime: FLASH.seconds * strength * 0.6, fadeOutTime: 0.3 + FLASH.seconds * strength * 0.4 },
        });
        player.playSound(SOUNDS.flashRing.id, { pitch: SOUNDS.flashRing.pitch, volume: SOUNDS.flashRing.volume * strength });
      } catch (error) {
        log.warn(`arsenal: could not flash ${player.name}: ${describeError(error)}`);
      }
    }
  }

  /** A smoke grenade's cloud, standing on the ground where it landed, for SMOKE.seconds. */
  private smoke(at: Vector3): void {
    const dimension = world.getDimension("overworld");
    const ground = groundUnder(dimension, at);
    const variables = new MolangVariableMap();
    variables.setFloat("variable.radius", SMOKE.radius);
    variables.setFloat("variable.seconds", SMOKE.seconds);
    particle(dimension, PARTICLES.smoke, ground, variables);
    const now = system.currentTick;
    this.clouds.push({ at: { x: ground.x, y: ground.y + 1, z: ground.z }, until: now + SMOKE.seconds * 20, nextBlind: now });
  }

  /** A thrown knife, floating where it came to rest until someone takes it. */
  private dropKnife(at: Vector3): void {
    const dimension = world.getDimension("overworld");
    const ground = groundUnder(dimension, at);
    const entity = dimension.spawnEntity(ARSENAL_PICKUP, ground);
    entity.setProperty(MODEL_PROPERTY, ARSENAL_MODELS.indexOf("throwing_knife"));
    this.knives.push({ entity, at: ground });
  }

  // ---- The stimpack ----------------------------------------------------------------------------

  private stim(player: Player): void {
    if (!this.host.canFire(player)) return;
    const key = player.name.toLowerCase();
    const now = system.currentTick;
    if ((this.stimReady.get(key) ?? 0) > now) return;
    const health = player.getComponent(EntityComponentTypes.Health);
    if (!health) return;
    this.stimReady.set(key, now + STIM.everyTicks);
    try {
      health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + STIM.health));
      player.addEffect("speed", STIM.speedSeconds * 20, { amplifier: 0, showParticles: false });
      takeOne(player, arsenalItem(STIMPACK));
      const dimension = world.getDimension("overworld");
      particle(dimension, PARTICLES.stim, player.location);
      playAt(dimension, STIM.sound, player.location);
    } catch (error) {
      log.warn(`arsenal: ${player.name}'s stimpack failed: ${describeError(error)}`);
    }
  }

  // ---- Over time -------------------------------------------------------------------------------

  private tick(): void {
    const now = system.currentTick;
    const dimension = world.getDimension("overworld");
    for (const fire of [...this.fires]) {
      if (fire.until <= now) {
        this.fires.splice(this.fires.indexOf(fire), 1);
        continue;
      }
      if (fire.nextHurt > now) continue;
      fire.nextHurt = now + FIRE.everyTicks;
      for (const body of this.host.targets()) {
        const name = this.host.nameOf(body);
        const feet = body.location;
        const across = Math.hypot(feet.x - fire.at.x, feet.z - fire.at.z);
        if (name === undefined || across > FIRE.radius || feet.y < fire.at.y - 1 || feet.y > fire.at.y + 2) continue;
        const own = name.toLowerCase() === fire.thrower.toLowerCase();
        if (this.host.hurt(body, own ? undefined : fire.thrower, FIRE.damage, "fire")) particle(dimension, PARTICLES.burning, feet);
      }
    }
    for (const cloud of [...this.clouds]) {
      if (cloud.until <= now) {
        this.clouds.splice(this.clouds.indexOf(cloud), 1);
        continue;
      }
      if (cloud.nextBlind > now) continue;
      cloud.nextBlind = now + SMOKE_BLIND_EVERY;
      for (const body of this.host.targets()) {
        if (body.typeId !== "minecraft:player" || distance(body.location, cloud.at) > SMOKE.radius) continue;
        try {
          body.addEffect("blindness", SMOKE_BLIND_TICKS, { amplifier: 0, showParticles: false });
        } catch {
          // left
        }
      }
    }
    for (const knife of [...this.knives]) {
      if (!knife.entity.isValid) {
        this.knives.splice(this.knives.indexOf(knife), 1);
        continue;
      }
      const taker = this.host.targets().find((body) => body.typeId === "minecraft:player" && distance(body.location, knife.at) <= KNIFE_REACH && this.host.canFire(body as Player));
      if (!taker || !this.give(taker as Player, arsenalItem("throwing_knife"))) continue;
      remove(knife.entity);
      this.knives.splice(this.knives.indexOf(knife), 1);
      playAt(dimension, SOUNDS.pickUp, knife.at);
    }
  }

  private give(player: Player, item: string): boolean {
    if (this.host.give) return this.host.give(player, item);
    try {
      const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
      if (!container) return false;
      for (let slot = 0; slot < 9; slot++) {
        if (container.getItem(slot)) continue;
        container.setItem(slot, new ItemStack(item, 1));
        return true;
      }
    } catch (error) {
      log.warn(`arsenal: could not give ${player.name} a ${item}: ${describeError(error)}`);
    }
    return false;
  }

  /** Every player carrying a crossbow has at least `arrows` arrows, in the inventory above the hotbar. */
  private topUpArrows(): void {
    for (const body of this.host.targets()) {
      if (body.typeId !== "minecraft:player") continue;
      try {
        const container = (body as Player).getComponent(EntityComponentTypes.Inventory)?.container;
        if (!container) continue;
        let [crossbow, arrows, free] = [false, 0, -1];
        for (let slot = 0; slot < container.size; slot++) {
          const stack = container.getItem(slot);
          if (stack?.typeId === ONE_HIT.crossbow) crossbow = true;
          else if (stack?.typeId === ONE_HIT.arrow) arrows += stack.amount;
          else if (!stack && slot >= 9 && free < 0) free = slot;
        }
        if (crossbow && arrows < this.arrows && free >= 0) container.setItem(free, new ItemStack(ONE_HIT.arrow, this.arrows - arrows));
      } catch {
        // left
      }
    }
  }

  private clear(): void {
    for (const knife of this.knives) remove(knife.entity);
    this.knives.length = 0;
    this.fires.length = 0;
    this.clouds.length = 0;
    this.stimReady.clear();
  }

  private playTo(name: string, sound: { id: string; pitch: number; volume: number }): void {
    try {
      world.getAllPlayers().find((player) => player.name === name)?.playSound(sound.id, { pitch: sound.pitch, volume: sound.volume });
    } catch {
      // left
    }
  }
}

const distance = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Whether a block stands between two points. */
function blocked(dimension: Dimension, from: Vector3, to: Vector3): boolean {
  const far = distance(from, to);
  if (far < 0.3) return false;
  const direction = { x: (to.x - from.x) / far, y: (to.y - from.y) / far, z: (to.z - from.z) / far };
  try {
    return dimension.getBlockFromRay(from, direction, { maxDistance: far - 0.2, includeLiquidBlocks: false, includePassableBlocks: false }) !== undefined;
  } catch {
    return false;
  }
}

/** The ground under a point (the top of the first block below, within GROUND_SEARCH), or the point itself. */
function groundUnder(dimension: Dimension, at: Vector3): Vector3 {
  try {
    const hit = dimension.getBlockFromRay(at, { x: 0, y: -1, z: 0 }, { maxDistance: GROUND_SEARCH, includeLiquidBlocks: true, includePassableBlocks: false });
    if (hit) return { x: at.x, y: hit.block.location.y + hit.faceLocation.y, z: at.z };
  } catch {
    // out of the world
  }
  return at;
}

/** Throws a body out from `from` along the ground, and up a little. */
function push(body: Entity, from: Vector3, strength: number): void {
  if (strength <= 0) return;
  const [dx, dz] = [body.location.x - from.x, body.location.z - from.z];
  const across = Math.hypot(dx, dz);
  const [x, z] = across < 1e-3 ? [0, 0] : [(dx / across) * strength, (dz / across) * strength];
  try {
    body.applyKnockback({ x, z }, 0.25 + strength * 0.2);
  } catch {
    // a fake player, or gone
  }
}

function particle(dimension: Dimension, id: string, at: Vector3, variables?: MolangVariableMap): void {
  try {
    dimension.spawnParticle(id, at, variables);
  } catch {
    // unloaded
  }
}

function playAt(dimension: Dimension, sound: { id: string; pitch: number; volume: number }, at: Vector3): void {
  try {
    dimension.playSound(sound.id, at, { pitch: sound.pitch, volume: sound.volume });
  } catch {
    // unloaded
  }
}

function remove(entity: Entity): void {
  try {
    if (entity.isValid) entity.remove();
  } catch {
    // already gone
  }
}

/** Takes one `item` from the player's selected slot. */
function takeOne(player: Player, item: string): void {
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  const stack = container?.getItem(player.selectedSlotIndex);
  if (!container || stack?.typeId !== item) return;
  if (stack.amount > 1) {
    stack.amount--;
    container.setItem(player.selectedSlotIndex, stack);
  } else {
    container.setItem(player.selectedSlotIndex, undefined);
  }
}
