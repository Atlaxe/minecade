// Guns any game can hand out (the shared guns pack, packs/guns). Left click fires: a tap gun one
// shot a click, a held gun again and again while the button stays down (Bedrock repeats the
// swing). Right click raises the gun to aim and lowers it again (a toggle: Bedrock sends no left
// click while right click is held): the camera zooms, the shots stray less, and the held model
// comes up to the middle of the screen. Each shot shades the gun's hotbar slot for its fire rate
// (the item's own cooldown). A grenade is thrown with either click, lands, swells for its fuse and
// bursts. A shot's balls fly as PAINTBALL entities in the shooter's paint color, from
// where they look, spread in a cone; the game hears where each lands (a player, a mob, a block's
// face) and decides what that does. A gun with an AmmoDef has a magazine that reloads by itself
// when it runs dry. The guns' numbers are defs.ts's.
import {
  EntityComponentTypes,
  EntitySwingSource,
  ItemComponentTypes,
  ItemStack,
  MolangVariableMap,
  system,
  world,
  type Block,
  type Direction,
  type Dimension,
  type Entity,
  type Player,
  type Vector3,
} from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import {
  COLOR_PROPERTY,
  DYES,
  GRENADE,
  GUNS,
  PAINTBALL,
  PAINT_RGB,
  PAINT_SPLASH,
  AIM_MARKER,
  dyeIndex,
  parseGunItem,
  shotMarker,
  type Dye,
  type GunDef,
  type GunKind,
  type Sound,
  type ThrowableDef,
} from "./defs.ts";

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

/** A gun's magazine as the game's HUD shows it. */
export interface AmmoState {
  gun: GunKind;
  loaded: number;
  magazine: number;
  /** Spare rounds; undefined when they never run out. */
  reserve: number | undefined;
  reloading: boolean;
}

export interface GunsOptions {
  /** The guns players may fire, by model (defs.ts's GUNS by default): a game can change their numbers or give them ammo. */
  guns?: readonly GunDef[];
  throwables?: readonly ThrowableDef[];
  /** Whether a player may fire now: playing, not out, not frozen. */
  canFire(player: Player): boolean;
  /** The paint color (DYES index) a player's balls take; the held item's own paint by default. */
  colorOf?(player: Player, itemDye: Dye): number;
  /** A ball reached a player or a mob. A gun's maxHitsPerShot caps how many of one shot's balls count on one target. */
  onHitEntity?(shot: Shot, entity: Entity, location: Vector3): void;
  onHitBlock?(shot: Shot, hit: BlockHit, location: Vector3): void;
  /** A grenade's fuse ran out where it sits. */
  onBurst?(shot: Shot, location: Vector3): void;
  onFire?(player: Player, shot: Shot): void;
  /** A magazine changed (a shot, a reload starting or done), for the game's HUD (ammoText). */
  onAmmo?(player: Player, ammo: AmmoState): void;
  random?: () => number;
}

/** A ball or grenade in the air: its shot, until when it may fly, and how many of its shot's hits one target may take. */
interface Flying {
  entity: Entity;
  shot: Shot;
  until: number;
  maxHits: number;
  throwable?: ThrowableDef;
}

/** A grenade that landed, swelling until it bursts. */
interface Primed {
  entity: Entity;
  shot: Shot;
  throwable: ThrowableDef;
  burstAt: number;
  location: Vector3;
}

/** A shot still in the air: its balls not yet down, and its hits by target. */
interface ShotState {
  flying: number;
  hits: Map<string, number>;
}

interface Magazine {
  loaded: number;
  reserve: number;
  reloadingUntil: number;
}

/** Balls leave from just ahead of the eyes, so they clear the shooter's own body. */
const MUZZLE = 0.6;
/** A thrown grenade leaves rising a little, so it arcs. */
const THROW_LIFT = 0.15;
/** A grenade lands this far off the face it hit, so it doesn't start inside the block. */
const LAND_OFF_FACE = 0.2;
/** The zoom's ease in and out, in seconds. */
const AIM_EASE = 0.15;
/** Ticks between restarts of the aim marker's cooldown (it lasts 6), which keeps the held model up. */
const AIM_REFRESH_TICKS = 2;
/**
 * Right click events closer together than this are one press: holding the button can repeat
 * them, and a press can bring both a use and a block interaction.
 */
const PRESS_GAP_TICKS = 5;
/** Left clicks that fire. A right click's own swings (using, placing, interacting) and a drop don't. */
const FIRE_SWINGS = new Set<string>([EntitySwingSource.Attack, EntitySwingSource.Mine, EntitySwingSource.None]);
const RELOAD_START: Sound = { id: "crossbow.loading.start", pitch: 1.2, volume: 0.8 };
const RELOAD_END: Sound = { id: "crossbow.loading.end", pitch: 1.2, volume: 0.8 };
const DRY_CLICK: Sound = { id: "random.click", pitch: 1.6, volume: 0.6 };

const FACE_OUT: Record<string, Vector3> = {
  Up: { x: 0, y: 1, z: 0 },
  Down: { x: 0, y: -1, z: 0 },
  North: { x: 0, y: 0, z: -1 },
  South: { x: 0, y: 0, z: 1 },
  East: { x: 1, y: 0, z: 0 },
  West: { x: -1, y: 0, z: 0 },
};

export class Guns {
  private readonly options: GunsOptions;
  private readonly random: () => number;
  private readonly guns = new Map<string, GunDef>();
  private readonly throwables = new Map<string, ThrowableDef>();
  /** By entity id. */
  private readonly flying = new Map<string, Flying>();
  private readonly primed = new Map<string, Primed>();
  private readonly shots = new Map<number, ShotState>();
  /** When each player (lowercase name) may fire or throw again. */
  private readonly readyAt = new Map<string, number>();
  /** Players holding the attack button on a held gun: until when the last swing keeps it firing. */
  private readonly triggers = new Map<string, { player: Player; gun: GunDef; until: number }>();
  /** Players aiming a gun (right click toggles it). */
  private readonly aiming = new Map<string, { player: Player; gun: GunDef }>();
  /** When each player's last right click event came, to tell one press from the next. */
  private readonly lastPress = new Map<string, number>();
  /** Each player's magazines, by gun, for guns with ammo. */
  private readonly magazines = new Map<string, Map<GunKind, Magazine>>();
  private nextShot = 1;

  constructor(scope: Scope, options: GunsOptions) {
    this.options = options;
    this.random = options.random ?? Math.random;
    for (const gun of options.guns ?? Object.values(GUNS)) this.guns.set(gun.id, gun);
    for (const throwable of options.throwables ?? [GRENADE]) this.throwables.set(throwable.id, throwable);
    scope.subscribe(world.afterEvents.playerSwingStart, ({ player, heldItemStack, swingSource }) => {
      if (heldItemStack && FIRE_SWINGS.has(swingSource)) this.pull(player, heldItemStack.typeId);
    });
    // A grenade is thrown with a right click too, like a snowball. A gun's right click raises or
    // lowers it, at the sky (a use) or at a block (an interaction).
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      const throwable = this.throwableOf(itemStack.typeId);
      if (throwable) return void this.tryThrow(source, throwable, itemStack.typeId);
      this.rightClick(source, itemStack.typeId);
    });
    scope.subscribe(world.afterEvents.playerInteractWithBlock, ({ player, itemStack, isFirstEvent }) => {
      if (isFirstEvent && itemStack) this.rightClick(player, itemStack.typeId);
    });
    scope.subscribe(world.afterEvents.projectileHitEntity, (event) => {
      const flying = this.landed(event.projectile);
      if (!flying) return;
      if (flying.throwable) return this.prime(flying, flying.throwable, event.location);
      const target = event.getEntityHit().entity;
      if (target && this.countHit(flying, target)) this.notify(() => this.options.onHitEntity?.(flying.shot, target, event.location));
    });
    scope.subscribe(world.afterEvents.projectileHitBlock, (event) => {
      const flying = this.landed(event.projectile);
      if (!flying) return;
      const { block, face } = event.getBlockHit();
      if (flying.throwable) {
        const out = FACE_OUT[face] ?? FACE_OUT.Up;
        const at = event.location;
        return this.prime(flying, flying.throwable, { x: at.x + out.x * LAND_OFF_FACE, y: at.y + out.y * LAND_OFF_FACE, z: at.z + out.z * LAND_OFF_FACE });
      }
      this.notify(() => this.options.onHitBlock?.(flying.shot, { block, face }, event.location));
    });
    scope.interval(() => this.tick(), 1);
    scope.add(() => this.clear());
  }

  /** Forgets a player's trigger, aim and fire rate (they went out, or left); the zoom goes back. */
  forget(name: string): void {
    const key = name.toLowerCase();
    this.triggers.delete(key);
    this.stopAiming(key);
    this.readyAt.delete(key);
    this.lastPress.delete(key);
  }

  /** Fills every magazine a player has, spare rounds too (a respawn). */
  refill(name: string): void {
    this.magazines.delete(name.toLowerCase());
  }

  /** Reloads the gun a player holds, if it has ammo and isn't full. */
  reload(player: Player): void {
    const gun = this.heldGun(player);
    const magazine = gun && this.magazine(player, gun);
    if (gun?.ammo && magazine && magazine.loaded < gun.ammo.magazine && !this.isReloading(magazine)) this.startReload(player, gun, magazine);
  }

  /** The magazine of the gun a player holds; undefined for a gun without ammo, or none. */
  ammoOf(player: Player): AmmoState | undefined {
    const gun = this.heldGun(player);
    const magazine = gun && this.magazine(player, gun);
    return gun && magazine ? this.ammoState(gun, magazine) : undefined;
  }

  /** Whether a player has a gun raised to aim. */
  isAiming(name: string): boolean {
    return this.aiming.has(name.toLowerCase());
  }

  /** Balls and grenades in the air, and grenades waiting to burst. */
  get inFlight(): number {
    return this.flying.size + this.primed.size;
  }

  private gunOf(typeId: string): GunDef | undefined {
    const item = parseGunItem(typeId);
    return item && item.kind !== "grenade" ? this.guns.get(item.kind) : undefined;
  }

  private throwableOf(typeId: string): ThrowableDef | undefined {
    const item = parseGunItem(typeId);
    return item?.kind === "grenade" ? this.throwables.get(item.kind) : undefined;
  }

  private heldGun(player: Player): GunDef | undefined {
    const held = heldItem(player);
    return held && this.gunOf(held.typeId);
  }

  /** A left click with `typeId` in hand. */
  private pull(player: Player, typeId: string): void {
    const throwable = this.throwableOf(typeId);
    if (throwable) return void this.tryThrow(player, throwable, typeId);
    const gun = this.gunOf(typeId);
    if (!gun) return;
    if (gun.fire === "hold") this.triggers.set(player.name.toLowerCase(), { player, gun, until: system.currentTick + gun.triggerTicks });
    this.tryFire(player, gun, typeId);
  }

  /** A right click with `typeId` in hand: a gun's raises or lowers it, once a press. */
  private rightClick(player: Player, typeId: string): void {
    const gun = this.gunOf(typeId);
    if (!gun) return;
    const key = player.name.toLowerCase();
    const now = system.currentTick;
    const last = this.lastPress.get(key);
    this.lastPress.set(key, now);
    if (last !== undefined && now - last < PRESS_GAP_TICKS) return;
    if (this.aiming.has(key)) this.stopAiming(key);
    else this.aim(player, gun);
  }

  private aim(player: Player, gun: GunDef): void {
    this.aiming.set(player.name.toLowerCase(), { player, gun });
    this.setFov(player, gun.aimFov);
    startCooldown(player, AIM_MARKER.item);
  }

  private stopAiming(key: string): void {
    const aim = this.aiming.get(key);
    if (!aim) return;
    this.aiming.delete(key);
    if (aim.player.isValid) this.setFov(aim.player, undefined);
  }

  /** Zooms a player's camera to `fov`, or back to their own with none. */
  private setFov(player: Player, fov: number | undefined): void {
    try {
      player.camera.setFov(fov === undefined ? { easeOptions: { easeTime: AIM_EASE } } : { fov, easeOptions: { easeTime: AIM_EASE } });
    } catch (error) {
      log.warn(`guns: could not zoom ${player.name}: ${describeError(error)}`);
    }
  }

  /** Fires `gun` (held as `typeId`) if the player may, its fire rate allows and it has a round loaded. */
  private tryFire(player: Player, gun: GunDef, typeId: string): boolean {
    if (!this.options.canFire(player)) return false;
    const magazine = this.magazine(player, gun);
    if (magazine && (this.isReloading(magazine) || magazine.loaded <= 0)) {
      if (magazine.loaded <= 0 && !this.isReloading(magazine) && this.ready(player, gun.everyTicks)) this.startReload(player, gun, magazine);
      return false;
    }
    if (!this.ready(player, gun.everyTicks)) return false;
    this.fire(player, gun, typeId);
    if (magazine) {
      magazine.loaded--;
      if (magazine.loaded <= 0) this.startReload(player, gun, magazine);
      else this.ammoChanged(player, gun, magazine);
    }
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

  private fire(player: Player, gun: GunDef, typeId: string): void {
    const shot = this.newShot(player, gun.id, typeId);
    const head = player.getHeadLocation();
    const dimension = world.getDimension("overworld");
    const spread = this.aiming.has(player.name.toLowerCase()) ? gun.aimSpreadDegrees : gun.hipSpreadDegrees;
    for (const direction of coneDirections(player.getViewDirection(), gun.pellets, spread, this.random)) {
      const from = { x: head.x + direction.x * MUZZLE, y: head.y - 0.1 + direction.y * MUZZLE, z: head.z + direction.z * MUZZLE };
      const velocity = { x: direction.x * gun.speed, y: direction.y * gun.speed, z: direction.z * gun.speed };
      this.launch(dimension, PAINTBALL, player, shot, from, velocity, { lifeTicks: gun.lifeTicks, maxHits: gun.maxHitsPerShot });
    }
    playAt(dimension, gun.sound, head);
    // The gun's own cooldown shades its hotbar slot until it can fire again; the held model's
    // recoil runs off its shot marker's (the pack's attachables read that category).
    startCooldown(player, typeId);
    startCooldown(player, shotMarker(gun.id).item);
    this.notify(() => this.options.onFire?.(player, shot));
  }

  private tryThrow(player: Player, throwable: ThrowableDef, typeId: string): void {
    if (!this.options.canFire(player) || !this.ready(player, throwable.everyTicks)) return;
    const shot = this.newShot(player, throwable.id, typeId);
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const dimension = world.getDimension("overworld");
    const from = { x: head.x + view.x * MUZZLE, y: head.y - 0.1 + view.y * MUZZLE, z: head.z + view.z * MUZZLE };
    const velocity = { x: view.x * throwable.speed, y: view.y * throwable.speed + THROW_LIFT, z: view.z * throwable.speed };
    this.launch(dimension, throwable.entity, player, shot, from, velocity, { lifeTicks: throwable.lifeTicks, maxHits: 1, throwable });
    playAt(dimension, throwable.sound, head);
    consumeHeld(player, typeId);
    this.notify(() => this.options.onFire?.(player, shot));
  }

  private newShot(player: Player, weapon: string, typeId: string): Shot {
    const dye = parseGunItem(typeId)?.dye ?? "white";
    const color = this.options.colorOf ? this.options.colorOf(player, dye) : dyeIndex(dye);
    const shot = { id: this.nextShot++, shooter: player.name, weapon, color };
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
    how: { lifeTicks: number; maxHits: number; throwable?: ThrowableDef },
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
      this.flying.set(entity.id, { entity, shot, until: system.currentTick + how.lifeTicks, maxHits: how.maxHits, throwable: how.throwable });
      this.shots.get(shot.id)!.flying++;
    } catch (error) {
      log.warn(`guns: could not launch ${typeId}: ${describeError(error)}`);
    }
  }

  /** A grenade landed at `location`: it sits there, swelling, until its fuse runs out. */
  private prime(flying: Flying, throwable: ThrowableDef, location: Vector3): void {
    const dimension = world.getDimension("overworld");
    try {
      const entity = dimension.spawnEntity(throwable.primed, location);
      entity.setProperty(COLOR_PROPERTY, flying.shot.color);
      this.primed.set(entity.id, { entity, shot: flying.shot, throwable, burstAt: system.currentTick + throwable.fuseTicks, location });
      playAt(dimension, throwable.fuseSound, location);
    } catch (error) {
      log.warn(`guns: could not land ${throwable.primed}: ${describeError(error)}`);
      this.burst(flying.shot, throwable, location);
    }
  }

  private burst(shot: Shot, throwable: ThrowableDef, location: Vector3): void {
    playAt(world.getDimension("overworld"), throwable.burstSound, location);
    this.notify(() => this.options.onBurst?.(shot, location));
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

  /** Takes a ball or grenade out of the air (and the world): it landed, or flew its whole range. */
  private down(id: string, flying: Flying): void {
    this.flying.delete(id);
    remove(flying.entity);
    // The shot itself is forgotten on the next tick, once its last ball's hit has counted.
    const state = this.shots.get(flying.shot.id);
    if (state) state.flying--;
  }

  private magazine(player: Player, gun: GunDef): Magazine | undefined {
    if (!gun.ammo) return undefined;
    const key = player.name.toLowerCase();
    let byGun = this.magazines.get(key);
    if (!byGun) this.magazines.set(key, (byGun = new Map()));
    let magazine = byGun.get(gun.id);
    if (!magazine) byGun.set(gun.id, (magazine = { loaded: gun.ammo.magazine, reserve: gun.ammo.reserve ?? Infinity, reloadingUntil: 0 }));
    return magazine;
  }

  private isReloading(magazine: Magazine): boolean {
    return magazine.reloadingUntil > system.currentTick;
  }

  private startReload(player: Player, gun: GunDef, magazine: Magazine): void {
    const dimension = world.getDimension("overworld");
    if (magazine.reserve <= 0) {
      playAt(dimension, DRY_CLICK, player.getHeadLocation());
      return;
    }
    magazine.reloadingUntil = system.currentTick + gun.ammo!.reloadTicks;
    playAt(dimension, RELOAD_START, player.getHeadLocation());
    this.ammoChanged(player, gun, magazine);
  }

  private ammoState(gun: GunDef, magazine: Magazine): AmmoState {
    return {
      gun: gun.id,
      loaded: magazine.loaded,
      magazine: gun.ammo!.magazine,
      reserve: Number.isFinite(magazine.reserve) ? magazine.reserve : undefined,
      reloading: this.isReloading(magazine),
    };
  }

  private ammoChanged(player: Player, gun: GunDef, magazine: Magazine): void {
    this.notify(() => this.options.onAmmo?.(player, this.ammoState(gun, magazine)));
  }

  private tick(): void {
    const now = system.currentTick;
    for (const [key, trigger] of [...this.triggers]) {
      const held = trigger.player.isValid ? heldItem(trigger.player) : undefined;
      if (trigger.until < now || !held || this.gunOf(held.typeId) !== trigger.gun) {
        this.triggers.delete(key);
        continue;
      }
      this.tryFire(trigger.player, trigger.gun, held.typeId);
    }
    // Switching away from the gun lowers it; while it's up, the aim marker keeps the model up.
    for (const [key, { player, gun }] of [...this.aiming]) {
      const held = player.isValid ? heldItem(player) : undefined;
      if (!held || this.gunOf(held.typeId) !== gun) this.stopAiming(key);
      else if (now % AIM_REFRESH_TICKS === 0) startCooldown(player, AIM_MARKER.item);
    }
    for (const [key, byGun] of this.magazines) {
      for (const [kind, magazine] of byGun) {
        if (magazine.reloadingUntil === 0 || magazine.reloadingUntil > now) continue;
        magazine.reloadingUntil = 0;
        const gun = this.guns.get(kind);
        const player = world.getAllPlayers().find((candidate) => candidate.name.toLowerCase() === key);
        if (!gun?.ammo || !player) continue;
        const take = Math.min(gun.ammo.magazine - magazine.loaded, magazine.reserve);
        magazine.loaded += take;
        magazine.reserve -= take;
        playAt(world.getDimension("overworld"), RELOAD_END, player.getHeadLocation());
        this.ammoChanged(player, gun, magazine);
      }
    }
    for (const [id, primed] of [...this.primed]) {
      if (primed.entity.isValid) primed.location = primed.entity.location;
      if (primed.burstAt > now) continue;
      this.primed.delete(id);
      remove(primed.entity);
      this.burst(primed.shot, primed.throwable, primed.location);
    }
    for (const [id, flying] of [...this.flying]) if (flying.until <= now) this.down(id, flying);
    for (const [id, state] of [...this.shots]) if (state.flying <= 0) this.shots.delete(id);
  }

  private clear(): void {
    for (const [id, flying] of [...this.flying]) this.down(id, flying);
    for (const primed of this.primed.values()) remove(primed.entity);
    this.primed.clear();
    for (const key of [...this.aiming.keys()]) this.stopAiming(key);
    this.shots.clear();
    this.triggers.clear();
    this.readyAt.clear();
    this.lastPress.clear();
    this.magazines.clear();
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

/** A magazine as a short HUD line: "12/30  90", or "Reloading". */
export function ammoText(ammo: AmmoState): string {
  if (ammo.reloading) return "§7Reloading";
  const count = `${ammo.loaded > 0 ? "§f" : "§c"}${ammo.loaded}§7/${ammo.magazine}`;
  return ammo.reserve === undefined ? count : `${count}  §8${ammo.reserve}`;
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

/** Starts a player's cooldown of an item's category (a gun's own, or a hidden marker's). */
function startCooldown(player: Player, item: string): void {
  try {
    new ItemStack(item).getComponent(ItemComponentTypes.Cooldown)?.startCooldown(player);
  } catch (error) {
    log.warn(`guns: no cooldown for ${item}: ${describeError(error)}`);
  }
}

function playAt(dimension: Dimension, sound: Sound, location: Vector3): void {
  dimension.playSound(sound.id, location, { pitch: sound.pitch, volume: sound.volume });
}

function remove(entity: Entity): void {
  try {
    if (entity.isValid) entity.remove();
  } catch {
    // Already gone: a ball is removed as it hits.
  }
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
