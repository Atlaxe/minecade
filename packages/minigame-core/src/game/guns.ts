// Guns any game can hand out (the shared guns pack, packs/guns). A tap gun fires a shot each use,
// a held gun keeps firing while use is held, and a grenade is thrown. A shot's balls fly as
// PAINTBALL entities in the shooter's paint color, from where they look, spread in a cone; the game
// hears where each lands (a player, a mob, a block's face) and decides what that does. The guns'
// numbers are gun-defs.ts's, which the pack's item cooldowns share.
import {
  EntityComponentTypes,
  ItemComponentTypes,
  MolangVariableMap,
  system,
  world,
  type Block,
  type Direction,
  type Dimension,
  type Entity,
  type ItemStack,
  type Player,
  type Vector3,
} from "@minecraft/server";
import { COLOR_PROPERTY, DYES, GRENADE, GUNS, PAINTBALL, PAINT_RGB, PAINT_SPLASH, type GunDef, type ThrowableDef } from "../gun-defs.ts";
import { describeError, log } from "../log.ts";
import type { Scope } from "../scope.ts";

/** One trigger pull (or throw): a shotgun's balls share it. */
export interface Shot {
  id: number;
  shooter: string;
  /** The gun's or the throwable's id ("pistol", "grenade"). */
  weapon: string;
  /** The paint color: an index into DYES. */
  color: number;
}

/** Where a ball landed on a block: the block, and the face it hit. */
export interface BlockHit {
  block: Block;
  face: Direction;
}

export interface GunsOptions {
  /** The guns players may fire (all of gun-defs.ts's by default). */
  guns?: readonly GunDef[];
  throwables?: readonly ThrowableDef[];
  /** Whether a player may fire now: playing, not out, not frozen. */
  canFire(player: Player): boolean;
  /** The paint color (DYES index) a player's balls take. */
  colorOf(player: Player): number;
  /** A ball reached a player or a mob. A gun's maxHitsPerShot caps how many of one shot's balls count on one target. */
  onHitEntity?(shot: Shot, entity: Entity, location: Vector3): void;
  onHitBlock?(shot: Shot, hit: BlockHit, location: Vector3): void;
  /** A thrown grenade hit something. */
  onBurst?(shot: Shot, location: Vector3): void;
  onFire?(player: Player, shot: Shot): void;
  random?: () => number;
}

/** A ball or grenade in the air: its shot, until when it may fly, and how many of its shot's hits one target may take. */
interface Flying {
  entity: Entity;
  shot: Shot;
  until: number;
  maxHits: number;
  thrown: boolean;
}

/** A shot still in the air: its balls not yet down, and its hits by target. */
interface ShotState {
  flying: number;
  hits: Map<string, number>;
}

/** Balls leave from just ahead of the eyes, so they clear the shooter's own body. */
const MUZZLE = 0.6;
/** A thrown grenade leaves rising a little, so it arcs. */
const THROW_LIFT = 0.15;

export class Guns {
  private readonly options: GunsOptions;
  private readonly random: () => number;
  private readonly guns = new Map<string, GunDef>();
  private readonly throwables = new Map<string, ThrowableDef>();
  /** By entity id. */
  private readonly flying = new Map<string, Flying>();
  private readonly shots = new Map<number, ShotState>();
  /** When each player (lowercase name) may fire again. */
  private readonly readyAt = new Map<string, number>();
  /** Players holding use on a held gun. */
  private readonly holding = new Map<string, { player: Player; gun: GunDef }>();
  private nextShot = 1;

  constructor(scope: Scope, options: GunsOptions) {
    this.options = options;
    this.random = options.random ?? Math.random;
    for (const gun of options.guns ?? Object.values(GUNS)) this.guns.set(gun.item, gun);
    for (const throwable of options.throwables ?? [GRENADE]) this.throwables.set(throwable.item, throwable);
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => this.use(source, itemStack));
    scope.subscribe(world.afterEvents.itemStartUse, ({ source, itemStack }) => {
      const gun = this.guns.get(itemStack.typeId);
      if (gun?.fire !== "hold") return;
      this.holding.set(source.name.toLowerCase(), { player: source, gun });
      this.tryFire(source, gun);
    });
    scope.subscribe(world.afterEvents.itemStopUse, ({ source }) => this.holding.delete(source.name.toLowerCase()));
    scope.subscribe(world.afterEvents.itemReleaseUse, ({ source }) => this.holding.delete(source.name.toLowerCase()));
    scope.subscribe(world.afterEvents.projectileHitEntity, (event) => {
      const flying = this.landed(event.projectile);
      if (!flying) return;
      if (flying.thrown) return this.burst(flying, event.location);
      const target = event.getEntityHit().entity;
      if (target && this.countHit(flying, target)) this.notify(() => this.options.onHitEntity?.(flying.shot, target, event.location));
    });
    scope.subscribe(world.afterEvents.projectileHitBlock, (event) => {
      const flying = this.landed(event.projectile);
      if (!flying) return;
      if (flying.thrown) return this.burst(flying, event.location);
      const { block, face } = event.getBlockHit();
      this.notify(() => this.options.onHitBlock?.(flying.shot, { block, face }, event.location));
    });
    scope.interval(() => this.tick(), 1);
    scope.add(() => this.clear());
  }

  /** Forgets a player's held trigger and fire rate (they went out, or left). */
  forget(name: string): void {
    const key = name.toLowerCase();
    this.holding.delete(key);
    this.readyAt.delete(key);
  }

  /** Balls and grenades in the air. */
  get inFlight(): number {
    return this.flying.size;
  }

  private use(player: Player, stack: ItemStack): void {
    const gun = this.guns.get(stack.typeId);
    if (gun) {
      if (!this.tryFire(player, gun) || gun.fire !== "tap") return;
      // The item's cooldown times the recoil and greys the slot until the next shot.
      try {
        stack.getComponent(ItemComponentTypes.Cooldown)?.startCooldown(player);
      } catch (error) {
        log.warn(`guns: no cooldown for ${gun.item}: ${describeError(error)}`);
      }
      return;
    }
    // A throw waits on its item's own cooldown, not on the guns' fire rate.
    const throwable = this.throwables.get(stack.typeId);
    if (throwable && this.options.canFire(player)) this.throw(player, throwable);
  }

  /** Fires `gun` if the player may and its fire rate allows. */
  private tryFire(player: Player, gun: GunDef): boolean {
    if (!this.ready(player, gun.everyTicks) || !this.options.canFire(player)) return false;
    this.fire(player, gun);
    return true;
  }

  /** True (and the next shot waits `ticks`) when the player's last shot was long enough ago. */
  private ready(player: Player, ticks: number): boolean {
    const key = player.name.toLowerCase();
    const now = system.currentTick;
    if ((this.readyAt.get(key) ?? 0) > now) return false;
    this.readyAt.set(key, now + ticks);
    return true;
  }

  private fire(player: Player, gun: GunDef): void {
    const shot = this.newShot(player, gun.id);
    const head = player.getHeadLocation();
    const dimension = world.getDimension("overworld");
    for (const direction of coneDirections(player.getViewDirection(), gun.pellets, gun.spreadDegrees, this.random)) {
      const from = { x: head.x + direction.x * MUZZLE, y: head.y - 0.1 + direction.y * MUZZLE, z: head.z + direction.z * MUZZLE };
      const velocity = { x: direction.x * gun.speed, y: direction.y * gun.speed, z: direction.z * gun.speed };
      this.launch(dimension, PAINTBALL, player, shot, from, velocity, { lifeTicks: gun.lifeTicks, maxHits: gun.maxHitsPerShot, thrown: false });
    }
    dimension.playSound(gun.sound.id, head, { pitch: gun.sound.pitch, volume: gun.sound.volume });
    this.notify(() => this.options.onFire?.(player, shot));
  }

  private throw(player: Player, throwable: ThrowableDef): void {
    const shot = this.newShot(player, throwable.id);
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const dimension = world.getDimension("overworld");
    const from = { x: head.x + view.x * MUZZLE, y: head.y - 0.1 + view.y * MUZZLE, z: head.z + view.z * MUZZLE };
    const velocity = { x: view.x * throwable.speed, y: view.y * throwable.speed + THROW_LIFT, z: view.z * throwable.speed };
    this.launch(dimension, throwable.entity, player, shot, from, velocity, { lifeTicks: throwable.lifeTicks, maxHits: 1, thrown: true });
    dimension.playSound(throwable.sound.id, head, { pitch: throwable.sound.pitch, volume: throwable.sound.volume });
    consumeHeld(player, throwable.item);
    this.notify(() => this.options.onFire?.(player, shot));
  }

  private newShot(player: Player, weapon: string): Shot {
    const shot = { id: this.nextShot++, shooter: player.name, weapon, color: this.options.colorOf(player) };
    this.shots.set(shot.id, { flying: 0, hits: new Map() });
    return shot;
  }

  private launch(
    dimension: Dimension,
    typeId: string,
    owner: Player,
    shot: Shot,
    from: Vector3,
    velocity: Vector3,
    how: { lifeTicks: number; maxHits: number; thrown: boolean },
  ): void {
    try {
      const entity = dimension.spawnEntity(typeId, from);
      entity.setProperty(COLOR_PROPERTY, shot.color);
      const projectile = entity.getComponent(EntityComponentTypes.Projectile);
      if (!projectile) {
        entity.remove();
        return;
      }
      projectile.owner = owner;
      projectile.shoot(velocity);
      this.flying.set(entity.id, { entity, shot, until: system.currentTick + how.lifeTicks, maxHits: how.maxHits, thrown: how.thrown });
      this.shots.get(shot.id)!.flying++;
    } catch (error) {
      log.warn(`guns: could not launch ${typeId}: ${describeError(error)}`);
    }
  }

  /** The ball or grenade that just hit something, now out of the air; undefined for anything else. */
  private landed(projectile: Entity): Flying | undefined {
    let id: string;
    try {
      id = projectile.id;
    } catch {
      return undefined;
    }
    const flying = this.flying.get(id);
    if (!flying) return undefined;
    this.down(id, flying);
    return flying;
  }

  /** Whether this hit counts: a shot's balls count on one target up to its gun's maxHitsPerShot. */
  private countHit(flying: Flying, target: Entity): boolean {
    const state = this.shots.get(flying.shot.id);
    const key = target.id;
    const hits = state?.hits.get(key) ?? 0;
    if (hits >= flying.maxHits) return false;
    state?.hits.set(key, hits + 1);
    return true;
  }

  private burst(flying: Flying, location: Vector3): void {
    this.notify(() => this.options.onBurst?.(flying.shot, location));
  }

  /** Takes a ball or grenade out of the air (and the world): it landed, or flew its whole range. */
  private down(id: string, flying: Flying): void {
    this.flying.delete(id);
    try {
      if (flying.entity.isValid) flying.entity.remove();
    } catch {
      // Already gone: a ball is removed as it hits.
    }
    // The shot itself is forgotten on the next tick, once its last ball's hit has counted.
    const state = this.shots.get(flying.shot.id);
    if (state) state.flying--;
  }

  private tick(): void {
    const now = system.currentTick;
    for (const [key, { player, gun }] of [...this.holding]) {
      if (!player.isValid || heldItem(player)?.typeId !== gun.item) {
        this.holding.delete(key);
        continue;
      }
      this.tryFire(player, gun);
    }
    for (const [id, flying] of [...this.flying]) if (flying.until <= now) this.down(id, flying);
    for (const [id, state] of [...this.shots]) if (state.flying <= 0) this.shots.delete(id);
  }

  private clear(): void {
    for (const [id, flying] of [...this.flying]) this.down(id, flying);
    this.shots.clear();
    this.holding.clear();
    this.readyAt.clear();
  }

  /** Runs a game's callback; an error there doesn't stop the guns. */
  private notify(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      log.warn(`guns: a game callback failed: ${describeError(error)}`);
    }
  }
}

/** The guns pack's paint splash at `location`, in a paint color (a DYES index); `bursts` of it for a bigger one. */
export function paintSplash(location: Vector3, color: number, bursts = 1): void {
  const rgb = PAINT_RGB[DYES[color] ?? "white"];
  const variables = new MolangVariableMap();
  variables.setColorRGB("variable.color", { red: (rgb >> 16) / 255, green: ((rgb >> 8) & 0xff) / 255, blue: (rgb & 0xff) / 255 });
  const dimension = world.getDimension("overworld");
  for (let i = 0; i < bursts; i++) dimension.spawnParticle(PAINT_SPLASH, location, variables);
}

/** The item in a player's selected hotbar slot. */
export function heldItem(player: Player): ItemStack | undefined {
  return player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex);
}

/** Takes one `item` from the player's selected slot (a thrown grenade). */
function consumeHeld(player: Player, item: string): void {
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

/**
 * `count` directions within `spreadDegrees` of `view`, spread evenly over the cone's round face (a
 * shotgun's pattern; one ball's small stray for the other guns).
 */
export function coneDirections(view: Vector3, count: number, spreadDegrees: number, random: () => number): Vector3[] {
  const length = Math.hypot(view.x, view.y, view.z) || 1;
  const forward = { x: view.x / length, y: view.y / length, z: view.z / length };
  // Two directions square to the view: right (level), and up from it.
  const level = Math.hypot(forward.x, forward.z);
  const right = level < 1e-6 ? { x: 1, y: 0, z: 0 } : { x: -forward.z / level, y: 0, z: forward.x / level };
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  return Array.from({ length: count }, () => {
    const angle = ((spreadDegrees * Math.PI) / 180) * Math.sqrt(random());
    const turn = 2 * Math.PI * random();
    const [along, aside] = [Math.cos(angle), Math.sin(angle)];
    const [sideways, upward] = [Math.cos(turn) * aside, Math.sin(turn) * aside];
    return {
      x: forward.x * along + right.x * sideways + up.x * upward,
      y: forward.y * along + right.y * sideways + up.y * upward,
      z: forward.z * along + right.z * sideways + up.z * upward,
    };
  });
}
