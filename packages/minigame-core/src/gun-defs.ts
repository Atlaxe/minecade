// The guns every server knows (the shared guns pack, packs/guns): their items, how each fires, the
// ball and grenade entities, and the 16 paint colors. Plain data with no Minecraft imports, so the
// pack's generator (tools/assets/guns.ts) and the games' scripts (game/guns.ts) read the same
// numbers: a tap gun's item cooldown is its fire rate, so the two must agree.

/** The ball a gun fires: a sprite in one of the 16 paint colors (its `minecade:color` property). */
export const PAINTBALL = "minecade:paintball";
/** A thrown grenade, in flight until it hits something. */
export const THROWN_GRENADE = "minecade:paint_grenade_thrown";
/** A gun or grenade floating over a spot for players to pick up (its `minecade:kind` property: PICKUP_KINDS). */
export const GUN_PICKUP = "minecade:gun_pickup";
/** The ball's and the thrown grenade's paint color: an index into DYES. */
export const COLOR_PROPERTY = "minecade:color";
export const KIND_PROPERTY = "minecade:kind";
/** The splash a ball or a grenade leaves, tinted by `variable.color` (MolangVariableMap.setColorRGB). */
export const PAINT_SPLASH = "minecade:paint_splash";

/** How a gun fires: once per tap, or again and again while use is held. */
export type FireMode = "tap" | "hold";

export interface GunDef {
  /** Short name: the model's, its textures' and its pickup kind's. */
  id: string;
  item: string;
  name: string;
  fire: FireMode;
  /** Ticks between shots: a tap gun's item cooldown, a held gun's rate. */
  everyTicks: number;
  /** Balls a shot fires, spread in a cone. */
  pellets: number;
  /** The cone's half angle: how far a ball can stray from where the player looks. */
  spreadDegrees: number;
  /** Blocks a tick the ball leaves the gun at (a snowball is about 1.5). */
  speed: number;
  /** Ticks before a ball that hit nothing is taken away (its range). */
  lifeTicks: number;
  /** Most hits one shot counts on one target (a shotgun's balls together). */
  maxHitsPerShot: number;
  sound: { id: string; pitch: number; volume: number };
}

export interface ThrowableDef {
  id: string;
  item: string;
  name: string;
  /** The entity it flies as. */
  entity: string;
  speed: number;
  /** Ticks before one that hit nothing is taken away. */
  lifeTicks: number;
  sound: { id: string; pitch: number; volume: number };
}

/** The guns, in pickup kind order after the pistol. */
export const GUNS = {
  pistol: {
    id: "pistol",
    item: "minecade:paintball_pistol",
    name: "Pistol",
    fire: "tap",
    everyTicks: 6,
    pellets: 1,
    spreadDegrees: 0.5,
    speed: 3,
    lifeTicks: 40,
    maxHitsPerShot: 1,
    sound: { id: "mob.llama.spit", pitch: 1.3, volume: 0.8 },
  },
  rifle: {
    id: "rifle",
    item: "minecade:paintball_rifle",
    name: "Rifle",
    fire: "hold",
    everyTicks: 4,
    pellets: 1,
    spreadDegrees: 2,
    speed: 3.5,
    lifeTicks: 40,
    maxHitsPerShot: 1,
    sound: { id: "mob.llama.spit", pitch: 1.6, volume: 0.7 },
  },
  shotgun: {
    id: "shotgun",
    item: "minecade:paintball_shotgun",
    name: "Shotgun",
    fire: "tap",
    everyTicks: 20,
    pellets: 6,
    spreadDegrees: 9,
    speed: 2.2,
    lifeTicks: 10,
    maxHitsPerShot: 2,
    sound: { id: "mob.llama.spit", pitch: 0.7, volume: 1 },
  },
} as const satisfies Record<string, GunDef>;

export const GRENADE = {
  id: "grenade",
  item: "minecade:paint_grenade",
  name: "Paint grenade",
  entity: THROWN_GRENADE,
  speed: 1.2,
  lifeTicks: 200,
  sound: { id: "random.bow", pitch: 0.6, volume: 1 },
} as const satisfies ThrowableDef;

export type GunId = keyof typeof GUNS;

/** What a pickup shows (its kind property is the index). */
export const PICKUP_KINDS = ["pistol", "rifle", "shotgun", "grenade"] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];

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

/** Each dye's paint, as its concrete looks (0xRRGGBB): balls, splashes and painted blocks match. */
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

/** Every item the guns pack adds, by id: the guns and the grenade. */
export function gunItems(): string[] {
  return [...Object.values(GUNS).map((gun) => gun.item), GRENADE.item];
}
