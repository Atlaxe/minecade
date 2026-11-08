// The guns every server knows (the shared guns pack, packs/guns): Paintball's guns in each of the
// 16 paint colors, how each fires, the ball and grenade entities, and the paint colors themselves;
// and the arsenal, the real guns, grenades and the stimpack (one item each, at the end). Plain data
// with no Minecraft imports, so the pack's generator (tools/assets/guns.ts) and the games' scripts
// (guns.ts, arsenal.ts) read the same names and numbers.
import { COLOR_SLOT } from "@minecade/minigame-core/config";

/** The ball a gun fires: a sprite in one of the 16 paint colors (its `minecade:color` property). */
export const PAINTBALL = "minecade:paintball";
/** A thrown grenade, in flight until it lands. */
export const THROWN_GRENADE = "minecade:paint_grenade_thrown";
/** A grenade that landed: it sits swelling for its fuse, then bursts. */
export const PRIMED_GRENADE = "minecade:paint_grenade_primed";
/** A gun or grenade floating over a spot for players to pick up (its `minecade:kind` property: PICKUP_KINDS). */
export const GUN_PICKUP = "minecade:gun_pickup";
/** A ball's and a grenade's paint color: an index into DYES. */
export const COLOR_PROPERTY = "minecade:color";
export const KIND_PROPERTY = "minecade:kind";
/** The splash a ball or a grenade leaves, tinted by `variable.color` (MolangVariableMap.setColorRGB). */
export const PAINT_SPLASH = "minecade:paint_splash";

/** How a gun fires on a left click: one shot, or again and again while the button stays down. */
export type FireMode = "tap" | "hold";

export const GUN_KINDS = ["pistol", "rifle", "shotgun"] as const;
export type GunKind = (typeof GUN_KINDS)[number];
/** What a pickup shows (its kind property is the index), and every model the pack has. */
export const PICKUP_KINDS = [...GUN_KINDS, "grenade"] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];

/** A magazine: shots before a reload, the reload's length, and the spare rounds (none left out means endless). */
export interface AmmoDef {
  magazine: number;
  reloadTicks: number;
  reserve?: number;
}

/**
 * How a gun's shot travels: a paint ball that flies (Paintball's), a bullet that lands at once
 * where the aim meets a player or a block (hitscan), a beam that does the same through every player
 * in line, or a rocket that flies and explodes where it hits.
 */
export type ShotKind = "ball" | "bullet" | "beam" | "rocket";

/** What a hit takes off: health (2 is a heart), more for a headshot, less far off. */
export interface DamageDef {
  body: number;
  head: number;
  /** Past `from` blocks the damage falls off evenly, down to `least` of it (a fraction) at `to` and beyond. */
  falloff?: { from: number; to: number; least: number };
}

export interface GunDef {
  /** Which model and items (a GunKind or an ArsenalGun): a game can hand out the pack's guns with numbers of its own. */
  id: string;
  name: string;
  fire: FireMode;
  /** Ticks between shots. */
  everyTicks: number;
  /**
   * A held gun keeps firing this many ticks after the last swing. Bedrock reports a held attack
   * button only as repeated swings, and in the air they come in bursts (seen in game), so the
   * window bridges the gaps between them (Guns' onTrigger reports how far apart they came).
   */
  triggerTicks: number;
  /** Balls a shot fires, spread in a cone. */
  pellets: number;
  /** The cone's half angle from the hip, and (a gun that aims) while aiming: how far a shot can stray from where the player looks. */
  hipSpreadDegrees: number;
  aimSpreadDegrees?: number;
  /**
   * The camera's field of view while aiming. Left out, the gun doesn't aim and a right click does
   * nothing. Only the Sniper Rifle, Rail Gun and RPG aim for now: Bedrock sends a script no left
   * click while right click is held, so aiming is a right click toggle (docs/guns.md, "Aiming").
   */
  aimFov?: number;
  /** Blocks a tick the ball or rocket leaves the gun at (a snowball is about 1.5); a bullet's streak flies at it. */
  speed: number;
  /** Ticks before a ball or rocket that hit nothing is taken away (its range). Bullets and beams use `range`. */
  lifeTicks: number;
  /** Most hits one shot counts on one target (a shotgun's balls or pellets together). */
  maxHitsPerShot: number;
  sound: Sound;
  /** Left out, a gun never runs dry (Paintball's). */
  ammo?: AmmoDef;
  /** A paint ball when left out. */
  shot?: ShotKind;
  /** Bullets and beams: how far they reach, in blocks. */
  range?: number;
  /** What a bullet, a beam or a rocket's direct hit takes off. Paint balls leave it to the game. */
  damage?: DamageDef;
  /** A tap fires `shots` shots, `gapTicks` apart (a burst gun); `everyTicks` counts from the first. */
  burst?: { shots: number; gapTicks: number };
  /** How each shot kicks the held model and the shooter's view; none when left out. */
  recoil?: RecoilDef;
}

/**
 * A shot's kick. The held model goes back `back` pixels with its muzzle tipped up `lift` degrees,
 * then eases home over the gun's own cooldown (its fire rate, `everyTicks`), so it settles just as
 * the gun can fire again; a burst kicks once. The shooter's view turns up `pitch` degrees and
 * sideways by up to `yaw` either way, and stays there: the player pulls it back down. Aiming takes
 * AIM_RECOIL of both.
 */
export interface RecoilDef {
  back: number;
  lift: number;
  pitch: number;
  yaw: number;
}

/** How much of a gun's kick is left while aiming: a raised gun is steadier. */
export const AIM_RECOIL = 0.6;

/**
 * What a thrown item does when it hits something: lands and sits for its fuse, then bursts (a
 * grenade); bursts right there (a Molotov); or stops there, a hit on a player counting (a knife).
 */
export type LandKind = "fuse" | "impact" | "stick";

export interface ThrowableDef {
  /** "grenade" (Paintball's), or an ArsenalThrowable. */
  id: string;
  name: string;
  /** The entity it flies as, and (a fuse throwable) the one it sits as once it lands. */
  entity: string;
  primed?: string;
  /** "fuse" when left out. */
  land?: LandKind;
  /** Ticks between throws. */
  everyTicks: number;
  speed: number;
  /** Ticks before one that hit nothing is taken away. */
  lifeTicks: number;
  /** Ticks it sits (swelling, flashing) before it bursts. */
  fuseTicks: number;
  sound: Sound;
  fuseSound?: Sound;
  burstSound: Sound;
  /** A "stick" throwable's hit on a player. */
  damage?: DamageDef;
}

export interface Sound {
  id: string;
  pitch: number;
  volume: number;
}

/** The guns, in pickup kind order. Nothing here runs dry: AmmoDef is for games that want magazines. */
export const GUNS = {
  pistol: {
    id: "pistol",
    name: "Paintball Pistol",
    fire: "tap",
    everyTicks: 6,
    triggerTicks: 0,
    pellets: 1,
    hipSpreadDegrees: 2.5,
    speed: 3,
    lifeTicks: 40,
    maxHitsPerShot: 1,
    sound: { id: "mob.llama.spit", pitch: 1.3, volume: 0.8 },
    recoil: { back: 2, lift: 12, pitch: 1.5, yaw: 0.5 },
  },
  rifle: {
    id: "rifle",
    name: "Paintball Rifle",
    fire: "hold",
    everyTicks: 4,
    triggerTicks: 10,
    pellets: 1,
    hipSpreadDegrees: 5,
    speed: 3.5,
    lifeTicks: 40,
    maxHitsPerShot: 1,
    sound: { id: "mob.llama.spit", pitch: 1.6, volume: 0.7 },
    recoil: { back: 1.2, lift: 5, pitch: 0.8, yaw: 0.5 },
  },
  shotgun: {
    id: "shotgun",
    name: "Paintball Shotgun",
    fire: "tap",
    everyTicks: 20,
    triggerTicks: 0,
    pellets: 6,
    hipSpreadDegrees: 12,
    speed: 2.2,
    lifeTicks: 10,
    maxHitsPerShot: 2,
    sound: { id: "mob.llama.spit", pitch: 0.7, volume: 1 },
    recoil: { back: 3, lift: 20, pitch: 4, yaw: 1.5 },
  },
} as const satisfies Record<GunKind, GunDef>;

export const GRENADE = {
  id: "grenade",
  name: "Paint Grenade",
  entity: THROWN_GRENADE,
  primed: PRIMED_GRENADE,
  everyTicks: 10,
  speed: 1.2,
  lifeTicks: 200,
  fuseTicks: 20,
  sound: { id: "random.bow", pitch: 0.6, volume: 1 },
  fuseSound: { id: "random.fuse", pitch: 1.6, volume: 0.8 },
  burstSound: { id: "mob.slime.big", pitch: 0.7, volume: 1.5 },
} as const satisfies ThrowableDef;

/** The 16 dyes in Minecraft's own order: a ball's color property is the index. */
export const DYES = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
] as const;
export type Dye = (typeof DYES)[number];

/** Each dye's paint, as its concrete looks (0xRRGGBB): balls, splashes, the guns' paint and painted blocks match. */
export const PAINT_RGB: Record<Dye, number> = {
  white: 0xcfd5d6,
  orange: 0xe06100,
  magenta: 0xa9309f,
  light_blue: 0x2389c6,
  yellow: 0xf0af15,
  lime: 0x5ea918,
  pink: 0xd5658e,
  gray: 0x36393d,
  light_gray: 0x7d7d73,
  cyan: 0x157788,
  purple: 0x64209c,
  blue: 0x2c2e8f,
  brown: 0x603c20,
  green: 0x495b24,
  red: 0x8e2020,
  black: 0x080a0f,
};

/** A dye's index in DYES (white for a name that isn't one). */
export function dyeIndex(name: string): number {
  return Math.max(0, DYES.indexOf(name as Dye));
}

const ITEM_NAMES: Record<PickupKind, string> = {
  pistol: "paintball_pistol",
  rifle: "paintball_rifle",
  shotgun: "paintball_shotgun",
  grenade: "paint_grenade",
};

/**
 * A gun's or grenade's item in a paint color, its paint parts (the hopper, the grenade's shell) in
 * it: minecade:red_paintball_pistol. White is the pickups' look.
 */
export function gunItem(kind: PickupKind, dye: Dye = "white"): string {
  return `minecade:${dye}_${ITEM_NAMES[kind]}`;
}

/** A kit's item for a gun or grenade in the player's team color ("{color}", which kits fill in). */
export function teamGunItem(kind: PickupKind): string {
  return `minecade:${COLOR_SLOT}_${ITEM_NAMES[kind]}`;
}

/** Which gun or grenade, in which paint, an item id is; undefined for anything else. */
export function parseGunItem(typeId: string): { kind: PickupKind; dye: Dye } | undefined {
  if (!typeId.startsWith("minecade:")) return undefined;
  const name = typeId.slice("minecade:".length);
  for (const kind of PICKUP_KINDS) {
    const suffix = `_${ITEM_NAMES[kind]}`;
    if (!name.endsWith(suffix)) continue;
    const dye = name.slice(0, -suffix.length) as Dye;
    return DYES.includes(dye) ? { kind, dye } : undefined;
  }
  return undefined;
}

/** Every item the guns pack adds: each gun and the grenade in every paint color. */
export function gunItems(): string[] {
  return PICKUP_KINDS.flatMap((kind) => DYES.map((dye) => gunItem(kind, dye)));
}

/**
 * The hidden block a gun's or grenade's item shows as its icon: the game draws the model in 3D in
 * the inventory, the way it draws a wall or a banner. It's never placed.
 */
export function gunModelBlock(kind: PickupKind, dye: Dye): string {
  return `${gunItem(kind, dye)}_model`;
}

/**
 * A gun's own cooldown category (a GunKind's or an ArsenalGun's): its fire rate, which Minecraft
 * shades over its hotbar slot and the held model's recoil runs off (it reads the main hand's cooldown).
 */
export function gunCooldown(kind: string): string {
  return `minecade_${kind}`;
}

/**
 * The hidden item that says a player is aiming: Guns puts it in their off hand while they aim, and
 * the held model reads the off hand (q.is_item_name_any) to show the aim pose. It looks like
 * nothing, in a hand or in the off hand's slot.
 */
export const AIM_MARKER = { item: "minecade:aim_marker" } as const;

/** Whether a gun aims (right click raises it): only those with an aimFov. */
export function canAim(gun: Pick<GunDef, "aimFov">): boolean {
  return gun.aimFov !== undefined;
}

// ---- The arsenal: real guns, grenades, a knife and the stimpack -------------------------------
//
// Built in the guns' style without Paintball's paint (no hopper, no colors): one item each,
// minecade:<id>. Bullets are hitscan, the RPG fires a rocket, the grenades and the knife fly as
// projectiles. What each does to players is arsenal.ts's (any game can use it); the numbers are here.

/** The arsenal's guns, in the order Gun Game's ladder climbs them. */
export const ARSENAL_GUNS = ["handgun", "smg", "assault_rifle", "burst_rifle", "pump_shotgun", "double_barrel", "sniper_rifle", "rail_gun", "rpg"] as const;
export type ArsenalGun = (typeof ARSENAL_GUNS)[number];
export const ARSENAL_THROWABLES = ["frag_grenade", "molotov", "flashbang", "smoke_grenade", "throwing_knife"] as const;
export type ArsenalThrowable = (typeof ARSENAL_THROWABLES)[number];
export const STIMPACK = "stimpack";
/** Every arsenal item, which is also its model: the thrown, landed and pickup entities' `minecade:model` property is the index. */
export const ARSENAL_MODELS = [...ARSENAL_GUNS, ...ARSENAL_THROWABLES, STIMPACK] as const;
export type ArsenalModel = (typeof ARSENAL_MODELS)[number];

/** A thrown arsenal grenade or knife in flight (its `minecade:model` property says which). */
export const THROWN_ARSENAL = "minecade:arsenal_thrown";
/** A grenade that landed and sits for its fuse. */
export const PRIMED_ARSENAL = "minecade:arsenal_primed";
/** An arsenal item floating to be picked up (a thrown knife where it landed, or a game's pickups). */
export const ARSENAL_PICKUP = "minecade:arsenal_pickup";
export const MODEL_PROPERTY = "minecade:model";
/** The RPG's rocket in flight. */
export const ROCKET = "minecade:rocket";

/** The arsenal's particles (packs/guns/resource_pack/particles), and the Molang variables each reads. */
export const PARTICLES = {
  /** A bullet's streak from the muzzle to where it hit: v.dir (a direction), v.dist (blocks), v.speed (blocks a second). */
  streak: "minecade:bullet_streak",
  /** Dust where a bullet hit a block. */
  impact: "minecade:bullet_impact",
  /** Red sparks where a bullet hit a player. */
  hit: "minecade:hit_spark",
  /** The rail gun's beam: v.dir and v.dist, as the streak. */
  beam: "minecade:rail_beam",
  /** Smoke a flying rocket leaves behind it. */
  trail: "minecade:rocket_trail",
  /** A frag grenade's or a rocket's blast: v.radius. */
  explosion: "minecade:explosion",
  /** A Molotov's pool of flames: v.radius, v.seconds. */
  fire: "minecade:fire_pool",
  /** Flames on a player standing in the fire. */
  burning: "minecade:burning",
  /** A smoke grenade's cloud: v.radius, v.seconds. */
  smoke: "minecade:smoke_cloud",
  /** A flashbang's burst of light. */
  flash: "minecade:flash_burst",
  /** Green motes rising off a player who used a stimpack. */
  stim: "minecade:stim_glow",
} as const;

/** The real guns. Damage is health (20 is a full bar); bullets are hitscan, so `speed` is only their streak's. */
export const ARSENAL_GUN_DEFS = {
  handgun: {
    id: "handgun",
    name: "Pistol",
    fire: "tap",
    shot: "bullet",
    everyTicks: 5,
    triggerTicks: 0,
    pellets: 1,
    hipSpreadDegrees: 2,
    speed: 8,
    lifeTicks: 0,
    range: 60,
    maxHitsPerShot: 1,
    damage: { body: 5, head: 8, falloff: { from: 25, to: 60, least: 0.6 } },
    ammo: { magazine: 12, reloadTicks: 30 },
    sound: { id: "firework.blast", pitch: 1.4, volume: 1 },
    recoil: { back: 2, lift: 12, pitch: 2, yaw: 0.6 },
  },
  smg: {
    id: "smg",
    name: "SMG",
    fire: "hold",
    shot: "bullet",
    everyTicks: 2,
    triggerTicks: 10,
    pellets: 1,
    hipSpreadDegrees: 3.5,
    speed: 8,
    lifeTicks: 0,
    range: 45,
    maxHitsPerShot: 1,
    damage: { body: 3, head: 4, falloff: { from: 15, to: 35, least: 0.5 } },
    ammo: { magazine: 32, reloadTicks: 35 },
    sound: { id: "firework.blast", pitch: 1.75, volume: 0.7 },
    recoil: { back: 0.8, lift: 4, pitch: 0.7, yaw: 0.6 },
  },
  assault_rifle: {
    id: "assault_rifle",
    name: "Assault Rifle",
    fire: "hold",
    shot: "bullet",
    everyTicks: 3,
    triggerTicks: 10,
    pellets: 1,
    hipSpreadDegrees: 3.5,
    speed: 8,
    lifeTicks: 0,
    range: 90,
    maxHitsPerShot: 1,
    damage: { body: 4, head: 6, falloff: { from: 40, to: 90, least: 0.7 } },
    ammo: { magazine: 30, reloadTicks: 40 },
    sound: { id: "firework.blast", pitch: 1.1, volume: 0.9 },
    recoil: { back: 1.2, lift: 5, pitch: 1, yaw: 0.5 },
  },
  burst_rifle: {
    id: "burst_rifle",
    name: "Burst Rifle",
    fire: "tap",
    shot: "bullet",
    everyTicks: 12,
    triggerTicks: 0,
    pellets: 1,
    hipSpreadDegrees: 3,
    speed: 8,
    lifeTicks: 0,
    range: 90,
    maxHitsPerShot: 1,
    burst: { shots: 3, gapTicks: 2 },
    damage: { body: 5, head: 8, falloff: { from: 40, to: 90, least: 0.7 } },
    ammo: { magazine: 24, reloadTicks: 40 },
    sound: { id: "firework.blast", pitch: 1.25, volume: 0.9 },
    // The model kicks once a burst; the view each shot.
    recoil: { back: 2, lift: 10, pitch: 1.2, yaw: 0.5 },
  },
  pump_shotgun: {
    id: "pump_shotgun",
    name: "Pump Shotgun",
    fire: "tap",
    shot: "bullet",
    everyTicks: 18,
    triggerTicks: 0,
    pellets: 6,
    hipSpreadDegrees: 6,
    speed: 8,
    lifeTicks: 0,
    range: 18,
    maxHitsPerShot: 6,
    damage: { body: 3.5, head: 4, falloff: { from: 6, to: 18, least: 0.4 } },
    ammo: { magazine: 6, reloadTicks: 60 },
    sound: { id: "firework.large_blast", pitch: 0.9, volume: 1 },
    recoil: { back: 3.5, lift: 24, pitch: 5, yaw: 1.5 },
  },
  double_barrel: {
    id: "double_barrel",
    name: "Double Barrel",
    fire: "tap",
    shot: "bullet",
    everyTicks: 6,
    triggerTicks: 0,
    pellets: 8,
    hipSpreadDegrees: 8,
    speed: 8,
    lifeTicks: 0,
    range: 14,
    maxHitsPerShot: 8,
    damage: { body: 2.5, head: 3, falloff: { from: 5, to: 14, least: 0.3 } },
    ammo: { magazine: 2, reloadTicks: 40 },
    sound: { id: "firework.large_blast", pitch: 0.8, volume: 1 },
    recoil: { back: 3.5, lift: 26, pitch: 6, yaw: 2 },
  },
  sniper_rifle: {
    id: "sniper_rifle",
    name: "Sniper Rifle",
    fire: "tap",
    shot: "bullet",
    everyTicks: 30,
    triggerTicks: 0,
    pellets: 1,
    aimSpreadDegrees: 0,
    hipSpreadDegrees: 10,
    // Bedrock allows a custom field of view from 30 to 110: the strongest zoom there is.
    aimFov: 30,
    speed: 12,
    lifeTicks: 0,
    range: 200,
    maxHitsPerShot: 1,
    damage: { body: 17, head: 40 },
    ammo: { magazine: 5, reloadTicks: 50 },
    sound: { id: "firework.large_blast", pitch: 0.6, volume: 1.2 },
    recoil: { back: 4, lift: 28, pitch: 8, yaw: 1 },
  },
  rail_gun: {
    id: "rail_gun",
    name: "Rail Gun",
    fire: "tap",
    shot: "beam",
    everyTicks: 40,
    triggerTicks: 0,
    pellets: 1,
    aimSpreadDegrees: 0,
    hipSpreadDegrees: 1.5,
    aimFov: 40,
    speed: 12,
    lifeTicks: 0,
    range: 120,
    maxHitsPerShot: 1,
    damage: { body: 20, head: 20 },
    ammo: { magazine: 4, reloadTicks: 60 },
    sound: { id: "conduit.attack", pitch: 1.2, volume: 1.2 },
    recoil: { back: 3, lift: 18, pitch: 5, yaw: 0.5 },
  },
  rpg: {
    id: "rpg",
    name: "RPG",
    fire: "tap",
    shot: "rocket",
    everyTicks: 20,
    triggerTicks: 0,
    pellets: 1,
    aimSpreadDegrees: 0.5,
    hipSpreadDegrees: 2,
    aimFov: 55,
    speed: 1.6,
    lifeTicks: 100,
    maxHitsPerShot: 1,
    // A direct hit; the blast around it is BLASTS.rpg.
    damage: { body: 20, head: 20 },
    ammo: { magazine: 1, reloadTicks: 60 },
    sound: { id: "firework.launch", pitch: 0.6, volume: 1.2 },
    recoil: { back: 4, lift: 12, pitch: 4, yaw: 0.5 },
  },
} as const satisfies Record<ArsenalGun, GunDef>;

const THROW_SOUND: Sound = { id: "random.bow", pitch: 0.6, volume: 1 };

export const ARSENAL_THROWABLE_DEFS = {
  frag_grenade: {
    id: "frag_grenade",
    name: "Frag Grenade",
    entity: THROWN_ARSENAL,
    primed: PRIMED_ARSENAL,
    land: "fuse",
    everyTicks: 10,
    speed: 1.2,
    lifeTicks: 200,
    fuseTicks: 30,
    sound: THROW_SOUND,
    fuseSound: { id: "random.fuse", pitch: 1.2, volume: 0.8 },
    burstSound: { id: "random.explode", pitch: 1, volume: 1.4 },
  },
  molotov: {
    id: "molotov",
    name: "Molotov",
    entity: THROWN_ARSENAL,
    land: "impact",
    everyTicks: 10,
    speed: 1.1,
    lifeTicks: 200,
    fuseTicks: 0,
    sound: THROW_SOUND,
    burstSound: { id: "random.glass", pitch: 0.9, volume: 1.2 },
  },
  flashbang: {
    id: "flashbang",
    name: "Flashbang",
    entity: THROWN_ARSENAL,
    primed: PRIMED_ARSENAL,
    land: "fuse",
    everyTicks: 10,
    speed: 1.2,
    lifeTicks: 200,
    fuseTicks: 12,
    sound: THROW_SOUND,
    fuseSound: { id: "random.click", pitch: 1.4, volume: 0.8 },
    burstSound: { id: "firework.large_blast", pitch: 1.8, volume: 1.4 },
  },
  smoke_grenade: {
    id: "smoke_grenade",
    name: "Smoke Grenade",
    entity: THROWN_ARSENAL,
    primed: PRIMED_ARSENAL,
    land: "fuse",
    everyTicks: 10,
    speed: 1.2,
    lifeTicks: 200,
    fuseTicks: 10,
    sound: THROW_SOUND,
    fuseSound: { id: "random.click", pitch: 1, volume: 0.8 },
    burstSound: { id: "random.fizz", pitch: 0.6, volume: 1.2 },
  },
  throwing_knife: {
    id: "throwing_knife",
    name: "Throwing Knife",
    entity: THROWN_ARSENAL,
    land: "stick",
    everyTicks: 10,
    speed: 1.8,
    lifeTicks: 100,
    fuseTicks: 0,
    sound: { id: "item.trident.throw", pitch: 1.3, volume: 1 },
    burstSound: { id: "item.trident.hit_ground", pitch: 1.3, volume: 1 },
    // One hit kills: more than anyone's health.
    damage: { body: 40, head: 40 },
  },
} as const satisfies Record<ArsenalThrowable, ThrowableDef>;

/** The stimpack: used with either click, `health` back at once and Speed I for `speedSeconds`. */
export const STIM = { name: "Stimpack", health: 8, speedSeconds: 4, everyTicks: 20, sound: { id: "random.drink", pitch: 1.4, volume: 1 } } as const;

/**
 * A blast's reach: full `damage` at the middle, falling off evenly to none at `radius`, a quarter
 * through cover. The thrower's own blast takes `selfFactor` of it from them.
 */
export interface BlastDef {
  radius: number;
  damage: number;
  selfFactor: number;
  /** How hard it throws players out from its middle. */
  push: number;
}

/** The frag grenade's and the rocket's blasts. Neither breaks blocks. */
export const BLASTS = {
  frag_grenade: { radius: 5, damage: 18, selfFactor: 1, push: 1.2 },
  rpg: { radius: 4, damage: 14, selfFactor: 0.5, push: 1.6 },
} as const satisfies Record<string, BlastDef>;

/** A Molotov's fire: `damage` every `everyTicks` to anyone within `radius` (across) and a block or two up, for `seconds`. No fire blocks. */
export const FIRE = { radius: 3, seconds: 6, damage: 1, everyTicks: 10 } as const;
/** A flashbang whites out players within `range` who can see it, for up to `seconds` (less far off or looking away). */
export const FLASH = { range: 20, seconds: 3 } as const;
/** A smoke grenade's cloud: `radius` blocks for `seconds`; anyone inside is blinded while they stay. */
export const SMOKE = { radius: 4, seconds: 10 } as const;
/** Arrows a crossbow carrier is kept at. */
export const CROSSBOW_ARROWS = 8;
/** The vanilla weapons the arsenal makes one-hit kills. */
export const ONE_HIT = { crossbow: "minecraft:crossbow", arrow: "minecraft:arrow", sword: "minecraft:netherite_sword" } as const;

/** An arsenal item's id: minecade:handgun. */
export function arsenalItem(model: ArsenalModel): string {
  return `minecade:${model}`;
}

/** Which arsenal item an item id is; undefined for anything else. */
export function parseArsenalItem(typeId: string): ArsenalModel | undefined {
  if (!typeId.startsWith("minecade:")) return undefined;
  const name = typeId.slice("minecade:".length);
  return (ARSENAL_MODELS as readonly string[]).includes(name) ? (name as ArsenalModel) : undefined;
}

/** Every item the arsenal adds. */
export function arsenalItems(): string[] {
  return ARSENAL_MODELS.map(arsenalItem);
}

/** The hidden block an arsenal item shows as its icon, as gunModelBlock. */
export function arsenalModelBlock(model: ArsenalModel): string {
  return `${arsenalItem(model)}_model`;
}

export const isArsenalGun = (model: string): model is ArsenalGun => (ARSENAL_GUNS as readonly string[]).includes(model);

/** A gun's own numbers by id (a GunKind or an ArsenalGun), the ones the pack's files are drawn from; undefined for anything else. */
export function gunDef(id: string): GunDef | undefined {
  return (GUNS as Record<string, GunDef>)[id] ?? (ARSENAL_GUN_DEFS as Record<string, GunDef>)[id];
}
export const isArsenalThrowable = (model: string): model is ArsenalThrowable => (ARSENAL_THROWABLES as readonly string[]).includes(model);

/**
 * Which gun or throwable an item is, by the id Guns knows it as: a Paintball gun's kind ("pistol",
 * "grenade"), or an arsenal item's model ("handgun", "molotov"). Undefined for anything else.
 */
export function weaponId(typeId: string): string | undefined {
  return parseGunItem(typeId)?.kind ?? parseArsenalItem(typeId);
}

/** A hit's damage `distance` blocks off, a headshot or not. */
export function damageAt(damage: DamageDef, distance: number, headshot: boolean): number {
  const full = headshot ? damage.head : damage.body;
  const falloff = damage.falloff;
  if (!falloff || distance <= falloff.from) return full;
  const along = Math.min(1, (distance - falloff.from) / Math.max(1e-6, falloff.to - falloff.from));
  return full * (1 - along * (1 - falloff.least));
}

/** A blast's damage `distance` blocks from its middle: falling off evenly to none at its radius, a quarter through cover. */
export function blastDamage(blast: BlastDef, distance: number, covered: boolean): number {
  if (distance >= blast.radius) return 0;
  return blast.damage * (1 - distance / blast.radius) * (covered ? 0.25 : 1);
}

/**
 * How hard a flash whites a player out, 0 to 1: full close up and looking at it, falling off evenly
 * to none at its range, a third when looking away (`facing` is the cosine between where they look
 * and the flash: 1 straight at it). Nothing through walls.
 */
export function flashStrength(distance: number, facing: number, seen: boolean): number {
  if (!seen || distance >= FLASH.range) return 0;
  const near = 1 - distance / FLASH.range;
  const look = facing >= 0.5 ? 1 : facing <= 0 ? 1 / 3 : 1 / 3 + ((facing / 0.5) * 2) / 3;
  return near * look;
}
