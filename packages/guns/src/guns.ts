// Guns any game can hand out (the shared guns pack, packs/guns). Right click fires: a tap gun one
// shot a press (a burst gun a few shots a press), a held gun (fire "hold": the Paintball Rifle, SMG,
// Assault Rifle) again and again until the button goes up. Each gun item is used like a bow (its
// use_modifiers), so Bedrock says when the button goes down and when it comes up; aimed at a block,
// it repeats the interaction instead, and a window bridges the repeats. Left click fires one shot
// with a gun that doesn't aim (not the pistols, GunDef.leftClickFires), and raises or lowers one
// that does (an aimFov: the Sniper Rifle, Rail Gun and RPG; Bedrock sends no left click while right
// click is held, so it can't be both): the camera zooms, the shots stray less, and the held model
// comes up (the aim marker in the off hand); a scoped gun (the Sniper Rifle) also has the game draw
// a scope over the screen, and slows its holder more while it's up (GunDef.aimSpeed). A left click
// while sneaking reloads a gun with a magazine instead. A heavy gun (the Sniper Rifle, Rail Gun and
// RPG) slows its holder while it's in hand.
// Each shot shades the gun's hotbar slot
// for its fire rate (the item's own cooldown), kicks the held model back until the next shot, and
// shakes the shooter's camera for a moment (defs.ts's RecoilDef). A thrown item goes with
// either click: a grenade lands, sits for its fuse and bursts; a Molotov bursts where it hits; a
// knife stops where it hits.
//
// A shot travels by its gun's ShotKind. Paintball's balls fly as PAINTBALL entities in the shooter's
// paint color, spread in a cone, and the game hears where each lands (a player, a mob, a block's
// face). A bullet is hitscan: a ray from the eyes finds the first player or block in its range at
// once, with a streak drawn from the muzzle; a beam goes on through every player to the first block.
// A rocket flies, trailing smoke, and bursts where it hits. Bullet, beam and rocket hits come with
// their damage (DamageDef: headshots, falloff); what a hit or a burst does is the game's (arsenal.ts
// for the real weapons). A gun with an AmmoDef has a magazine that reloads by itself when it runs
// dry. The guns' numbers are defs.ts's.
import {
  EntityComponentTypes,
  EntitySwingSource,
  EquipmentSlot,
  ItemLockMode,
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
  AIM_MARKER,
  AIM_RECOIL,
  ARSENAL_MODELS,
  COLOR_PROPERTY,
  DYES,
  GRENADE,
  GUNS,
  MODEL_PROPERTY,
  PAINTBALL,
  PAINT_RGB,
  PAINT_SPLASH,
  PARTICLES,
  ROCKET,
  canAim,
  damageAt,
  dyeIndex,
  gunCooldown,
  parseGunItem,
  weaponId,
  type Dye,
  type GunDef,
  type Sound,
  type ThrowableDef,
} from "./defs.ts";

/** One trigger pull (or throw): a shotgun's balls or pellets share it. */
export interface Shot {
  id: number;
  shooter: string;
  /** The gun's or the throwable's id ("pistol", "grenade", "handgun", "molotov"). */
  weapon: string;
  /** The paint color: an index into DYES (white for the arsenal's, which have none). */
  color: number;
}

/** Where a ball landed on a block: the block, and the face it hit. */
export interface BlockHit {
  block: Block;
  face: Direction;
}

/** How a bullet, a beam, a rocket or a knife met a player: what it takes off (its gun's DamageDef), whether in the head, from how far. */
export interface HitInfo {
  damage?: number;
  headshot: boolean;
  distance: number;
}

/** A gun's magazine as the game's HUD shows it. */
export interface AmmoState {
  gun: string;
  loaded: number;
  magazine: number;
  /** Spare rounds; undefined when they never run out. */
  reserve: number | undefined;
  reloading: boolean;
}

export interface GunsOptions {
  /** The guns players may fire, by model (defs.ts's GUNS by default): a game can change their numbers or give them ammo. */
  guns?: readonly GunDef[];
  /** GRENADE by default. */
  throwables?: readonly ThrowableDef[];
  /** Whether a player may fire now: playing, not out, not frozen. */
  canFire(player: Player): boolean;
  /** Whether a bullet or beam stops at (and hits) an entity; players only by default. */
  isTarget?(entity: Entity): boolean;
  /** The paint color (DYES index) a player's balls take; the held item's own paint by default. */
  colorOf?(player: Player, itemDye: Dye): number;
  /**
   * A ball, bullet, beam, rocket or knife reached a player or a mob. A gun's maxHitsPerShot caps how
   * many of one shot's balls or pellets count on one target. `info` comes with all but paint balls.
   */
  onHitEntity?(shot: Shot, entity: Entity, location: Vector3, info?: HitInfo): void;
  /** A ball or bullet reached a block. */
  onHitBlock?(shot: Shot, hit: BlockHit, location: Vector3): void;
  /** A grenade's fuse ran out where it sits, a Molotov or rocket hit something, or a knife came to rest. */
  onBurst?(shot: Shot, location: Vector3): void;
  onFire?(player: Player, shot: Shot): void;
  /** A magazine changed (a shot, a reload starting or done), for the game's HUD (ammoText). */
  onAmmo?(player: Player, ammo: AmmoState): void;
  /**
   * A held gun's right click let go: the shots it fired, how long it was down and how Bedrock
   * reported it (to tune held fire).
   */
  onTrigger?(player: Player, report: TriggerReport): void;
  /** A player raised a gun to aim (`aiming`) or lowered it: the game can redraw its HUD at once (isScoped). */
  onAim?(player: Player, aiming: boolean): void;
  random?: () => number;
}

/** One hold of a held gun's right click: what it fired, how long it was down, and how Bedrock reported the button. */
export interface TriggerReport {
  gun: string;
  shots: number;
  /** Ticks from the press to the let go. */
  ticks: number;
  /**
   * "use": Bedrock said when the button came up (the gun used like a bow). "repeats": aimed at a
   * block, the interaction repeated while the button was down, `gaps` ticks apart. "press": neither
   * came, so it let go its gun's triggerTicks after the press.
   */
  held: "use" | "repeats" | "press";
  gaps: number[];
}

/** A right click down on a gun: what keeps it down, and what it fired. */
interface Trigger {
  player: Player;
  gun: GunDef;
  pressedAt: number;
  /** The last event that kept it down. */
  lastEvent: number;
  /** In use: down until Bedrock says the button came up. Otherwise down until `until`, which each repeat moves on. */
  using: boolean;
  until: number;
  /** Ticks between the repeated block interactions that kept it down. */
  gaps: number[];
  shots: number;
}

/** A ball, rocket or thrown item in the air: its shot, until when it may fly, and how many of its shot's hits one target may take. */
interface Flying {
  entity: Entity;
  shot: Shot;
  until: number;
  maxHits: number;
  throwable?: ThrowableDef;
  /** A rocket's gun. */
  rocket?: GunDef;
}

/** A grenade that landed, waiting until it bursts. */
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

/** A burst gun's shots still to come from one click. */
interface Burst {
  player: Player;
  gun: GunDef;
  typeId: string;
  left: number;
  nextAt: number;
}

/** Balls leave from just ahead of the eyes, so they clear the shooter's own body. */
const MUZZLE = 0.6;
/** Where a bullet's streak starts, from the eyes: ahead, to the right (from the hip), and down. */
const STREAK_FROM = { ahead: 0.7, right: 0.22, down: 0.2 };
/** A bullet or beam with no range of its own reaches this far. */
const DEFAULT_RANGE = 64;
/** A hit this close under the eyes or higher is in the head (a player's head is half a block, the eyes 0.18 under its top). */
const HEAD_BELOW_EYES = 0.32;
/** A thrown item leaves rising a little, so it arcs. */
const THROW_LIFT = 0.15;
/** A grenade or knife lands this far off the face it hit, so it doesn't start inside the block. */
const LAND_OFF_FACE = 0.2;
/** The zoom's ease in and out, in seconds. */
const AIM_EASE = 0.15;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
/** How often each player's held item is weighed (GunDef.carrySpeed), in ticks. */
const CARRY_CHECK_TICKS = 4;
/** A shot shakes the shooter's camera until the gun can fire again, but at least and at most this long. */
const SHAKE_SECONDS = { least: 0.1, most: 0.3 };
/**
 * Right click events this close together are one press: a press can bring a use, its start and a
 * block interaction, and a use's release can bring a use of its own.
 */
const PRESS_GAP_TICKS = 3;
/**
 * Left clicks closer together than this are one, for raising and lowering a gun: a held button
 * can repeat its swing every 4 to 5 ticks (docs/spike-results.md), which would lower it again.
 */
const AIM_CLICK_GAP_TICKS = 7;
/**
 * Blocks a right click opens, shuts or presses (vanilla's, and Paintball's painted doors,
 * trapdoors and gates): a gun's right click at one does that, and doesn't fire.
 */
const USED_BLOCKS = /(door|fence_gate|button|lever)$/;
/** Left clicks. A right click's own swings (using, placing, interacting) and a drop aren't. */
const LEFT_CLICKS = new Set<string>([EntitySwingSource.Attack, EntitySwingSource.Mine, EntitySwingSource.None]);
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
  private readonly isTarget: (entity: Entity) => boolean;
  private readonly guns = new Map<string, GunDef>();
  private readonly throwables = new Map<string, ThrowableDef>();
  /** By entity id. */
  private readonly flying = new Map<string, Flying>();
  private readonly primed = new Map<string, Primed>();
  private readonly shots = new Map<number, ShotState>();
  /** When each player (lowercase name) may fire or throw again. */
  private readonly readyAt = new Map<string, number>();
  /** Players with right click down on a gun. */
  private readonly triggers = new Map<string, Trigger>();
  /** Burst guns part way through a burst, by player. */
  private readonly bursts = new Map<string, Burst>();
  /** Players aiming a gun (left click toggles it). */
  private readonly aiming = new Map<string, { player: Player; gun: GunDef }>();
  /** When each player's last left click came, to tell one from the next. */
  private readonly lastLeftClick = new Map<string, number>();
  /** When each player's last use of a gun ended, so a use that comes with the release isn't a press. */
  private readonly lastRelease = new Map<string, number>();
  /** The players a heavy gun slows (lowercase name), and the share of their speed it leaves. */
  private readonly carrying = new Map<string, { player: Player; speed: number }>();
  /** Each player's magazines, by gun, for guns with ammo. */
  private readonly magazines = new Map<string, Map<string, Magazine>>();
  private nextShot = 1;

  constructor(scope: Scope, options: GunsOptions) {
    this.options = options;
    this.random = options.random ?? Math.random;
    this.isTarget = options.isTarget ?? ((entity) => entity.typeId === "minecraft:player");
    for (const gun of options.guns ?? Object.values(GUNS)) this.guns.set(gun.id, gun);
    for (const throwable of options.throwables ?? [GRENADE]) this.throwables.set(throwable.id, throwable);
    scope.subscribe(world.afterEvents.playerSwingStart, ({ player, heldItemStack, swingSource }) => {
      if (heldItemStack && LEFT_CLICKS.has(swingSource)) this.leftClick(player, heldItemStack.typeId);
    });
    // Right click fires, at the sky (a use, and the use's start and end) or at a block (an
    // interaction, repeated while the button stays down). A grenade is thrown with it too, like a
    // snowball.
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => this.press(source, itemStack.typeId, false));
    scope.subscribe(world.afterEvents.itemStartUse, ({ source, itemStack }) => this.press(source, itemStack.typeId, true));
    scope.subscribe(world.afterEvents.itemStopUse, ({ source }) => this.release(source));
    scope.subscribe(world.afterEvents.itemReleaseUse, ({ source }) => this.release(source));
    scope.subscribe(world.afterEvents.playerInteractWithBlock, ({ player, itemStack, block, isFirstEvent }) => {
      if (!itemStack || USED_BLOCKS.test(block?.typeId ?? "")) return;
      if (isFirstEvent) this.press(player, itemStack.typeId, false);
      else this.repeat(player, itemStack.typeId);
    });
    scope.subscribe(world.afterEvents.projectileHitEntity, (event) => {
      const flying = this.landed(event.projectile);
      if (!flying) return;
      const target = event.getEntityHit().entity;
      if (flying.throwable) return this.thrownHit(flying, flying.throwable, event.location, target);
      if (flying.rocket) return this.rocketHit(flying, flying.rocket, event.location, target);
      if (target && this.countHit(flying.shot, flying.maxHits, target)) this.notify(() => this.options.onHitEntity?.(flying.shot, target, event.location));
    });
    scope.subscribe(world.afterEvents.projectileHitBlock, (event) => {
      const flying = this.landed(event.projectile);
      if (!flying) return;
      const { block, face } = event.getBlockHit();
      if (flying.throwable || flying.rocket) {
        const out = FACE_OUT[face] ?? FACE_OUT.Up;
        const at = event.location;
        const off = { x: at.x + out.x * LAND_OFF_FACE, y: at.y + out.y * LAND_OFF_FACE, z: at.z + out.z * LAND_OFF_FACE };
        if (flying.throwable) return this.thrownHit(flying, flying.throwable, off);
        return this.rocketHit(flying, flying.rocket!, off);
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
    this.bursts.delete(key);
    this.stopAiming(key);
    this.readyAt.delete(key);
    this.lastLeftClick.delete(key);
    this.lastRelease.delete(key);
    this.putDown(key);
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

  /** Whether a player is looking through a gun's scope: aiming a gun with one (GunDef.scope). */
  isScoped(name: string): boolean {
    return this.aiming.get(name.toLowerCase())?.gun.scope === true;
  }

  /** Balls, rockets and thrown items in the air, and grenades waiting to burst. */
  get inFlight(): number {
    return this.flying.size + this.primed.size;
  }

  private gunOf(typeId: string): GunDef | undefined {
    const id = weaponId(typeId);
    return id === undefined ? undefined : this.guns.get(id);
  }

  private throwableOf(typeId: string): ThrowableDef | undefined {
    const id = weaponId(typeId);
    return id === undefined ? undefined : this.throwables.get(id);
  }

  private heldGun(player: Player): GunDef | undefined {
    const held = heldItem(player);
    return held && this.gunOf(held.typeId);
  }

  /**
   * A left click with `typeId` in hand: a thrown item goes; sneaking, a gun with a magazine reloads;
   * a gun that aims is raised or lowered (once a click), and any other gun fires one shot (a burst
   * gun its burst), unless it fires on right click only (leftClickFires false: the pistols).
   */
  private leftClick(player: Player, typeId: string): void {
    const throwable = this.throwableOf(typeId);
    if (throwable) return void this.tryThrow(player, throwable, typeId);
    const gun = this.gunOf(typeId);
    if (!gun) return;
    const key = player.name.toLowerCase();
    const now = system.currentTick;
    const last = this.lastLeftClick.get(key);
    this.lastLeftClick.set(key, now);
    if (gun.ammo && isSneaking(player)) {
      if (last === undefined || now - last >= AIM_CLICK_GAP_TICKS) this.reload(player);
      return;
    }
    if (!canAim(gun)) {
      if (gun.leftClickFires !== false) this.tryFire(player, gun, typeId);
      return;
    }
    if (last !== undefined && now - last < AIM_CLICK_GAP_TICKS) return;
    if (this.aiming.has(key)) this.stopAiming(key);
    else this.aim(player, gun);
  }

  /**
   * A right click with `typeId` in hand: a thrown item goes, and a gun fires (a held gun goes on
   * firing in tick while the button stays down). `using`: Bedrock started using the gun, and says
   * when the button comes up (release). One press can bring a use, its start and a block
   * interaction, so events close together are one press.
   */
  private press(player: Player, typeId: string, using: boolean): void {
    const throwable = this.throwableOf(typeId);
    if (throwable) return void (!using && this.tryThrow(player, throwable, typeId));
    const gun = this.gunOf(typeId);
    if (!gun) return;
    const key = player.name.toLowerCase();
    const now = system.currentTick;
    const trigger = this.triggers.get(key);
    if (trigger && trigger.gun === gun && (now - trigger.pressedAt < PRESS_GAP_TICKS || (trigger.using && !using))) {
      if (using) trigger.using = true;
      return;
    }
    if (!using && now - (this.lastRelease.get(key) ?? -Infinity) < PRESS_GAP_TICKS) return;
    if (trigger) this.letGo(key);
    const pressed: Trigger = { player, gun, pressedAt: now, lastEvent: now, using, until: now + gun.triggerTicks, gaps: [], shots: 0 };
    this.triggers.set(key, pressed);
    if (this.tryFire(player, gun, typeId)) pressed.shots++;
  }

  /** A right click held at a block: Bedrock repeats the interaction while the button stays down. */
  private repeat(player: Player, typeId: string): void {
    const gun = this.gunOf(typeId);
    if (!gun) return;
    const trigger = this.triggers.get(player.name.toLowerCase());
    // Repeats too far apart for the window: a held gun picks up again; a tap gun waits for a press.
    if (!trigger || trigger.gun !== gun) return void (gun.fire === "hold" && this.press(player, typeId, false));
    const now = system.currentTick;
    trigger.gaps.push(now - trigger.lastEvent);
    trigger.lastEvent = now;
    trigger.until = now + gun.triggerTicks;
  }

  /** Bedrock says the button using a gun came up. */
  private release(player: Player): void {
    const key = player.name.toLowerCase();
    this.lastRelease.set(key, system.currentTick);
    this.letGo(key);
  }

  /** A gun's right click lets go: for a held gun, the game hears what it fired and how the button came. */
  private letGo(key: string): void {
    const trigger = this.triggers.get(key);
    if (!trigger) return;
    this.triggers.delete(key);
    if (trigger.gun.fire !== "hold" || !trigger.player.isValid) return;
    const held = trigger.using ? "use" : trigger.gaps.length > 0 ? "repeats" : "press";
    const report: TriggerReport = { gun: trigger.gun.id, shots: trigger.shots, ticks: system.currentTick - trigger.pressedAt, held, gaps: trigger.gaps };
    this.notify(() => this.options.onTrigger?.(trigger.player, report));
  }

  /** Raises the gun: the camera zooms, and the aim marker in the off hand tells the held model. */
  private aim(player: Player, gun: GunDef): void {
    this.aiming.set(player.name.toLowerCase(), { player, gun });
    this.setFov(player, gun.aimFov);
    setAimMarker(player, true);
    if (gun.aimSpeed !== undefined) this.weigh();
    this.notify(() => this.options.onAim?.(player, true));
  }

  private stopAiming(key: string): void {
    const aim = this.aiming.get(key);
    if (!aim) return;
    this.aiming.delete(key);
    if (!aim.player.isValid) return;
    this.setFov(aim.player, undefined);
    setAimMarker(aim.player, false);
    if (aim.gun.aimSpeed !== undefined) this.weigh();
    this.notify(() => this.options.onAim?.(aim.player, false));
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
    this.fireRound(player, gun, typeId, magazine, true);
    if (gun.burst && gun.burst.shots > 1 && (!magazine || magazine.loaded > 0)) {
      this.bursts.set(player.name.toLowerCase(), { player, gun, typeId, left: gun.burst.shots - 1, nextAt: system.currentTick + gun.burst.gapTicks });
    }
    return true;
  }

  /** One round: fired, and taken from the magazine (which starts reloading once it's empty). */
  private fireRound(player: Player, gun: GunDef, typeId: string, magazine: Magazine | undefined, first: boolean): void {
    this.fire(player, gun, typeId, first);
    if (!magazine) return;
    magazine.loaded--;
    if (magazine.loaded <= 0) this.startReload(player, gun, magazine);
    else this.ammoChanged(player, gun, magazine);
  }

  /** True (and the next shot waits `ticks`) when the player's last shot was long enough ago. */
  private ready(player: Player, ticks: number): boolean {
    const key = player.name.toLowerCase();
    const now = system.currentTick;
    if ((this.readyAt.get(key) ?? 0) > now) return false;
    this.readyAt.set(key, now + ticks);
    return true;
  }

  /** One shot: its balls, bullets, beam or rocket, its sound and kick. `first`: a burst's first shot, which shades the slot. */
  private fire(player: Player, gun: GunDef, typeId: string, first: boolean): void {
    const shot = this.newShot(player, gun.id, typeId);
    const head = player.getHeadLocation();
    const dimension = world.getDimension("overworld");
    const aiming = this.aiming.has(player.name.toLowerCase());
    const spread = aiming ? (gun.aimSpreadDegrees ?? gun.hipSpreadDegrees) : gun.hipSpreadDegrees;
    const kind = gun.shot ?? "ball";
    for (const direction of coneDirections(player.getViewDirection(), gun.pellets, spread, this.random)) {
      if (kind === "bullet" || kind === "beam") {
        this.hitscan(dimension, player, gun, shot, direction, aiming);
        continue;
      }
      const from = { x: head.x + direction.x * MUZZLE, y: head.y - 0.1 + direction.y * MUZZLE, z: head.z + direction.z * MUZZLE };
      const velocity = { x: direction.x * gun.speed, y: direction.y * gun.speed, z: direction.z * gun.speed };
      if (kind === "rocket") this.launch(dimension, ROCKET, player, shot, from, velocity, {}, { lifeTicks: gun.lifeTicks, maxHits: 1, rocket: gun });
      else this.launch(dimension, PAINTBALL, player, shot, from, velocity, { [COLOR_PROPERTY]: shot.color }, { lifeTicks: gun.lifeTicks, maxHits: gun.maxHitsPerShot });
    }
    playAt(dimension, gun.sound, head);
    // The gun's own cooldown shades its slot until it can fire again, and the held model kicks over
    // it (the attachable reads the main hand's cooldown): once a shot, or once a burst.
    if (first) startCooldown(player, gunCooldown(gun.id), gun.everyTicks);
    this.shakeView(player, gun, aiming);
    this.notify(() => this.options.onFire?.(player, shot));
  }

  /**
   * A shot's kick on the shooter's view: a moment of camera shake (rotational), stronger for a gun
   * with a bigger RecoilDef.shake and weaker while aiming. The shake is the client's own, so it never
   * fights the mouse: the view kick it replaced turned the view with a teleport from the rotation
   * the server last had, a few ticks old while the mouse moves, so looking around while firing
   * jumped (seen 2026-11-09). The shake doesn't move the aim.
   */
  private shakeView(player: Player, gun: GunDef, aiming: boolean): void {
    const shake = gun.recoil?.shake ?? 0;
    if (shake <= 0) return;
    const intensity = Math.min(4, shake * (aiming ? AIM_RECOIL : 1));
    const seconds = Math.max(SHAKE_SECONDS.least, Math.min(SHAKE_SECONDS.most, gun.everyTicks / 20));
    try {
      player.runCommand(`camerashake add @s ${round(intensity, 3)} ${round(seconds, 2)} rotational`);
    } catch (error) {
      log.warn(`guns: could not shake ${player.name}'s view: ${describeError(error)}`);
    }
  }

  /**
   * A bullet or beam along `direction` from the eyes: the first player it meets before a block
   * (every player, for a beam) takes its hit at once, a streak or beam is drawn from the muzzle, and
   * a bullet that met no one marks the block it reached.
   */
  private hitscan(dimension: Dimension, player: Player, gun: GunDef, shot: Shot, direction: Vector3, aiming: boolean): void {
    const eye = player.getHeadLocation();
    const range = gun.range ?? DEFAULT_RANGE;
    const beam = gun.shot === "beam";
    let wall: { block: Block; face: Direction; at: Vector3 } | undefined;
    try {
      const hit = dimension.getBlockFromRay(eye, direction, { maxDistance: range, includeLiquidBlocks: false, includePassableBlocks: false });
      if (hit) wall = { block: hit.block, face: hit.face, at: plus(hit.block.location, hit.faceLocation) };
    } catch (error) {
      log.warn(`guns: a bullet could not find its block: ${describeError(error)}`);
    }
    const reach = wall ? distance(eye, wall.at) : range;
    let met: { entity: Entity; distance: number }[] = [];
    try {
      met = dimension
        .getEntitiesFromRay(eye, direction, { maxDistance: reach, ignoreBlockCollision: true })
        .filter((hit) => hit.entity.id !== player.id && this.isTarget(hit.entity))
        .sort((a, b) => a.distance - b.distance);
    } catch (error) {
      log.warn(`guns: a bullet could not find its target: ${describeError(error)}`);
    }
    const struck = beam ? met : met.slice(0, 1);
    for (const hit of struck) {
      const at = along(eye, direction, hit.distance);
      if (!this.countHit(shot, gun.maxHitsPerShot, hit.entity)) continue;
      const headshot = isHeadshot(hit.entity, at);
      const info: HitInfo = { damage: gun.damage && damageAt(gun.damage, hit.distance, headshot), headshot, distance: hit.distance };
      this.notify(() => this.options.onHitEntity?.(shot, hit.entity, at, info));
    }
    const stopped = !beam && struck.length > 0 ? struck[0].distance : reach;
    const end = along(eye, direction, stopped);
    this.drawShot(dimension, player, gun, direction, end, aiming);
    if (wall && stopped >= reach) {
      const block = wall;
      spawnParticle(dimension, PARTICLES.impact, block.at);
      this.notify(() => this.options.onHitBlock?.(shot, { block: block.block, face: block.face }, block.at));
    }
  }

  /** A bullet's streak or a beam, from the gun's muzzle to `end`. */
  private drawShot(dimension: Dimension, player: Player, gun: GunDef, direction: Vector3, end: Vector3, aiming: boolean): void {
    const from = muzzleOf(player.getHeadLocation(), direction, aiming);
    const length = distance(from, end);
    if (length < 0.5) return;
    const variables = new MolangVariableMap();
    variables.setVector3("variable.dir", { x: (end.x - from.x) / length, y: (end.y - from.y) / length, z: (end.z - from.z) / length });
    variables.setFloat("variable.dist", length);
    variables.setFloat("variable.speed", gun.speed * 20);
    spawnParticle(dimension, gun.shot === "beam" ? PARTICLES.beam : PARTICLES.streak, from, variables);
  }

  private tryThrow(player: Player, throwable: ThrowableDef, typeId: string): void {
    if (!this.options.canFire(player) || !this.ready(player, throwable.everyTicks)) return;
    const shot = this.newShot(player, throwable.id, typeId);
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const dimension = world.getDimension("overworld");
    const from = { x: head.x + view.x * MUZZLE, y: head.y - 0.1 + view.y * MUZZLE, z: head.z + view.z * MUZZLE };
    const velocity = { x: view.x * throwable.speed, y: view.y * throwable.speed + THROW_LIFT, z: view.z * throwable.speed };
    this.launch(dimension, throwable.entity, player, shot, from, velocity, entityLook(shot), { lifeTicks: throwable.lifeTicks, maxHits: 1, throwable });
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
    properties: Record<string, number>,
    how: { lifeTicks: number; maxHits: number; throwable?: ThrowableDef; rocket?: GunDef },
  ): void {
    try {
      const entity = dimension.spawnEntity(typeId, from);
      for (const [property, value] of Object.entries(properties)) entity.setProperty(property, value);
      const projectile = entity.getComponent(EntityComponentTypes.Projectile);
      if (!projectile) {
        entity.remove();
        return;
      }
      projectile.owner = owner;
      projectile.shoot(velocity);
      this.flying.set(entity.id, { entity, shot, until: system.currentTick + how.lifeTicks, maxHits: how.maxHits, throwable: how.throwable, rocket: how.rocket });
      this.shots.get(shot.id)!.flying++;
    } catch (error) {
      log.warn(`guns: could not launch ${typeId}: ${describeError(error)}`);
    }
  }

  /** A thrown item hit something at `location` (a player, `target`, or a block). */
  private thrownHit(flying: Flying, throwable: ThrowableDef, location: Vector3, target?: Entity): void {
    const land = throwable.land ?? "fuse";
    if (land === "fuse") return this.prime(flying, throwable, location);
    if (land === "stick" && target && this.countHit(flying.shot, flying.maxHits, target)) {
      const thrower = world.getAllPlayers().find((player) => player.name === flying.shot.shooter);
      const headshot = isHeadshot(target, location);
      const far = thrower ? distance(thrower.location, location) : 0;
      const info: HitInfo = { damage: throwable.damage && damageAt(throwable.damage, far, headshot), headshot, distance: far };
      this.notify(() => this.options.onHitEntity?.(flying.shot, target, location, info));
    }
    // A knife comes to rest at the feet of whoever it hit.
    this.burst(flying.shot, target && land === "stick" ? target.location : location, throwable.burstSound);
  }

  /** A rocket hit something: a player it hit straight on takes its direct hit, then it bursts. */
  private rocketHit(flying: Flying, gun: GunDef, location: Vector3, target?: Entity): void {
    if (target && this.isTarget(target) && this.countHit(flying.shot, flying.maxHits, target)) {
      const headshot = isHeadshot(target, location);
      const info: HitInfo = { damage: gun.damage && damageAt(gun.damage, 0, headshot), headshot, distance: 0 };
      this.notify(() => this.options.onHitEntity?.(flying.shot, target, location, info));
    }
    this.burst(flying.shot, location);
  }

  /** A grenade landed at `location`: it sits there (swelling, flashing) until its fuse runs out. */
  private prime(flying: Flying, throwable: ThrowableDef, location: Vector3): void {
    const dimension = world.getDimension("overworld");
    try {
      if (!throwable.primed) throw new Error(`${throwable.id} has no entity to sit as`);
      const entity = dimension.spawnEntity(throwable.primed, location);
      for (const [property, value] of Object.entries(entityLook(flying.shot))) entity.setProperty(property, value);
      this.primed.set(entity.id, { entity, shot: flying.shot, throwable, burstAt: system.currentTick + throwable.fuseTicks, location });
      if (throwable.fuseSound) playAt(dimension, throwable.fuseSound, location);
    } catch (error) {
      log.warn(`guns: could not land ${throwable.id}: ${describeError(error)}`);
      this.burst(flying.shot, location, throwable.burstSound);
    }
  }

  private burst(shot: Shot, location: Vector3, sound?: Sound): void {
    if (sound) playAt(world.getDimension("overworld"), sound, location);
    this.notify(() => this.options.onBurst?.(shot, location));
  }

  /** The ball, rocket or thrown item that just hit something, now out of the air; undefined for anything else. */
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

  /** Whether this hit counts: a shot's balls or pellets count on one target up to `maxHits`. */
  private countHit(shot: Shot, maxHits: number, target: Entity): boolean {
    const state = this.shots.get(shot.id);
    const key = target.id;
    const hits = state?.hits.get(key) ?? 0;
    if (hits >= maxHits) return false;
    state?.hits.set(key, hits + 1);
    return true;
  }

  /** Takes a ball, rocket or thrown item out of the air (and the world): it landed, or flew its whole range. */
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
    if (now % CARRY_CHECK_TICKS === 0) this.weigh();
    // A held gun fires on at its rate while its right click stays down; switching away lets go.
    for (const [key, trigger] of [...this.triggers]) {
      const held = trigger.player.isValid ? heldItem(trigger.player) : undefined;
      if (!held || this.gunOf(held.typeId) !== trigger.gun || (!trigger.using && trigger.until < now)) {
        this.letGo(key);
        continue;
      }
      if (trigger.gun.fire === "hold" && this.tryFire(trigger.player, trigger.gun, held.typeId)) trigger.shots++;
    }
    // A burst's later shots, while the gun is still in hand, the player may fire and it has rounds.
    for (const [key, burst] of [...this.bursts]) {
      if (burst.nextAt > now) continue;
      const held = burst.player.isValid ? heldItem(burst.player) : undefined;
      const magazine = this.magazine(burst.player, burst.gun);
      if (!held || held.typeId !== burst.typeId || !this.options.canFire(burst.player) || (magazine && (magazine.loaded <= 0 || this.isReloading(magazine)))) {
        this.bursts.delete(key);
        continue;
      }
      this.fireRound(burst.player, burst.gun, burst.typeId, magazine, false);
      burst.left--;
      burst.nextAt = now + (burst.gun.burst?.gapTicks ?? 1);
      if (burst.left <= 0) this.bursts.delete(key);
    }
    // Switching away from the gun lowers it.
    for (const [key, { player, gun }] of [...this.aiming]) {
      const held = player.isValid ? heldItem(player) : undefined;
      if (!held || this.gunOf(held.typeId) !== gun) this.stopAiming(key);
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
      this.burst(primed.shot, primed.location, primed.throwable.burstSound);
    }
    // A rocket's smoke comes from its client entity, so it follows the rocket the client draws.
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
    this.bursts.clear();
    this.readyAt.clear();
    this.lastLeftClick.clear();
    this.lastRelease.clear();
    this.magazines.clear();
    for (const key of [...this.carrying.keys()]) this.putDown(key);
  }

  /**
   * Slows each player holding a heavy gun to its carrySpeed (its aimSpeed while it's raised), and
   * gives back their own speed to a player who no longer holds one.
   */
  private weigh(): void {
    const holding = new Map<string, { player: Player; speed: number }>();
    for (const player of world.getAllPlayers()) {
      const held = heldItem(player);
      const gun = held ? this.gunOf(held.typeId) : undefined;
      const key = player.name.toLowerCase();
      const speed = gun && this.aiming.get(key)?.gun === gun ? (gun.aimSpeed ?? gun.carrySpeed) : gun?.carrySpeed;
      if (speed !== undefined && speed !== 1) holding.set(key, { player, speed });
    }
    for (const [key, carried] of holding) {
      if (this.carrying.get(key)?.speed === carried.speed) continue;
      if (setWalkSpeed(carried.player, carried.speed)) this.carrying.set(key, carried);
    }
    for (const key of [...this.carrying.keys()]) if (!holding.has(key)) this.putDown(key);
  }

  /** A player's heavy gun no longer slows them. */
  private putDown(key: string): void {
    const carried = this.carrying.get(key);
    if (!carried) return;
    this.carrying.delete(key);
    if (carried.player.isValid) setWalkSpeed(carried.player, 1);
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

/** Sets a player's walking speed to `share` of their own (1: their own again). False if it couldn't. */
function setWalkSpeed(player: Player, share: number): boolean {
  try {
    const movement = player.getComponent(EntityComponentTypes.Movement);
    if (!movement) return false;
    if (share === 1) movement.resetToDefaultValue();
    else movement.setCurrentValue(movement.defaultValue * share);
    return true;
  } catch (error) {
    log.warn(`guns: could not change ${player.name}'s speed: ${describeError(error)}`);
    return false;
  }
}

/** Whether a player is sneaking (false for anything that isn't a player now). */
function isSneaking(player: Player): boolean {
  try {
    return player.isSneaking;
  } catch {
    return false;
  }
}

/** The item in a player's selected hotbar slot. */
export function heldItem(player: Player): ItemStack | undefined {
  return player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex);
}

/** The properties a thrown or landed item's entity shows it by: an arsenal item's model, or a paint grenade's color. */
function entityLook(shot: Shot): Record<string, number> {
  const model = (ARSENAL_MODELS as readonly string[]).indexOf(shot.weapon);
  return model >= 0 ? { [MODEL_PROPERTY]: model } : { [COLOR_PROPERTY]: shot.color };
}

/** Whether a hit at `at` is in `entity`'s head: no lower than just under its eyes. */
function isHeadshot(entity: Entity, at: Vector3): boolean {
  let eyes: number;
  try {
    eyes = entity.getHeadLocation().y;
  } catch {
    eyes = entity.location.y + 1.62;
  }
  return at.y >= eyes - HEAD_BELOW_EYES;
}

/** Where a shot's streak leaves the gun: ahead of the eyes, to the right and down from the hip, under the crosshair when aiming. */
export function muzzleOf(eye: Vector3, direction: Vector3, aiming: boolean): Vector3 {
  const level = Math.hypot(direction.x, direction.z);
  const right = level < 1e-6 ? { x: -1, y: 0, z: 0 } : { x: -direction.z / level, y: 0, z: direction.x / level };
  const side = aiming ? 0 : STREAK_FROM.right;
  return {
    x: eye.x + direction.x * STREAK_FROM.ahead + right.x * side,
    y: eye.y + direction.y * STREAK_FROM.ahead - STREAK_FROM.down,
    z: eye.z + direction.z * STREAK_FROM.ahead + right.z * side,
  };
}

const plus = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const along = (from: Vector3, direction: Vector3, length: number): Vector3 => ({
  x: from.x + direction.x * length,
  y: from.y + direction.y * length,
  z: from.z + direction.z * length,
});
const distance = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function spawnParticle(dimension: Dimension, id: string, location: Vector3, variables?: MolangVariableMap): void {
  try {
    dimension.spawnParticle(id, location, variables);
  } catch {
    // An unloaded spot, or out of the world: the shot still counted.
  }
}

/**
 * Puts the aim marker in a player's off hand (`on`), or takes it out, for the held model's aim pose
 * (it reads the off hand natively). Locked in its slot so it can't be moved or dropped. Something
 * else of the player's in the off hand is left alone (the model then stays lowered).
 */
function setAimMarker(player: Player, on: boolean): void {
  try {
    const equipment = player.getComponent(EntityComponentTypes.Equippable);
    if (!equipment) return;
    const current = equipment.getEquipment(EquipmentSlot.Offhand);
    if (on) {
      if (current && current.typeId !== AIM_MARKER.item) return;
      const marker = new ItemStack(AIM_MARKER.item);
      marker.lockMode = ItemLockMode.slot;
      equipment.setEquipment(EquipmentSlot.Offhand, marker);
    } else if (current?.typeId === AIM_MARKER.item) {
      equipment.setEquipment(EquipmentSlot.Offhand, undefined);
    }
  } catch (error) {
    log.warn(`guns: could not ${on ? "set" : "clear"} ${player.name}'s aim marker: ${describeError(error)}`);
  }
}

/**
 * Starts a player's cooldown of `category` for `ticks`: a gun's own (its fire rate, shaded over its
 * hotbar slot, which the held model's kick runs off). The player's own call: an item's cooldown
 * component throws on startCooldown on @minecraft/server 2.11.0, for every item
 * (docs/spike-results.md, "Recoil").
 */
function startCooldown(player: Player, category: string, ticks: number): void {
  try {
    player.startItemCooldown(category, Math.max(1, Math.round(ticks)));
  } catch (error) {
    log.warn(`guns: could not start the ${category} cooldown: ${describeError(error)}`);
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
