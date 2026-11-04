// The guns every server knows (the shared guns pack, packs/guns): their items in each of the 16
// paint colors, how each fires, the ball and grenade entities, and the paint colors themselves.
// Plain data with no Minecraft imports, so the pack's generator (tools/assets/guns.ts) and the
// games' scripts (guns.ts) read the same names and numbers.
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

export interface GunDef {
  /** Which model and items: a game can hand out the pack's guns with numbers of its own. */
  id: GunKind;
  name: string;
  fire: FireMode;
  /** Ticks between shots. */
  everyTicks: number;
  /**
   * A held gun keeps firing this many ticks after the last swing: Bedrock repeats the swing while
   * the attack button is down, so a held button is a stream of swings.
   */
  triggerTicks: number;
  /** Balls a shot fires, spread in a cone. */
  pellets: number;
  /** The cone's half angle, aiming (use held) and from the hip: how far a ball can stray from where the player looks. */
  aimSpreadDegrees: number;
  hipSpreadDegrees: number;
  /** The camera's field of view while aiming. */
  aimFov: number;
  /** Blocks a tick the ball leaves the gun at (a snowball is about 1.5). */
  speed: number;
  /** Ticks before a ball that hit nothing is taken away (its range). */
  lifeTicks: number;
  /** Most hits one shot counts on one target (a shotgun's balls together). */
  maxHitsPerShot: number;
  sound: Sound;
  /** Left out, a gun never runs dry (Paintball's). */
  ammo?: AmmoDef;
}

export interface ThrowableDef {
  id: "grenade";
  name: string;
  /** The entity it flies as, and the one it sits as once it lands. */
  entity: string;
  primed: string;
  /** Ticks between throws. */
  everyTicks: number;
  speed: number;
  /** Ticks before one that hit nothing is taken away. */
  lifeTicks: number;
  /** Ticks it sits swelling before it bursts. */
  fuseTicks: number;
  sound: Sound;
  fuseSound: Sound;
  burstSound: Sound;
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
    aimSpreadDegrees: 0.5,
    hipSpreadDegrees: 2.5,
    aimFov: 60,
    speed: 3,
    lifeTicks: 40,
    maxHitsPerShot: 1,
    sound: { id: "mob.llama.spit", pitch: 1.3, volume: 0.8 },
  },
  rifle: {
    id: "rifle",
    name: "Paintball Rifle",
    fire: "hold",
    everyTicks: 4,
    triggerTicks: 8,
    pellets: 1,
    aimSpreadDegrees: 2,
    hipSpreadDegrees: 5,
    aimFov: 50,
    speed: 3.5,
    lifeTicks: 40,
    maxHitsPerShot: 1,
    sound: { id: "mob.llama.spit", pitch: 1.6, volume: 0.7 },
  },
  shotgun: {
    id: "shotgun",
    name: "Paintball Shotgun",
    fire: "tap",
    everyTicks: 20,
    triggerTicks: 0,
    pellets: 6,
    aimSpreadDegrees: 9,
    hipSpreadDegrees: 12,
    aimFov: 60,
    speed: 2.2,
    lifeTicks: 10,
    maxHitsPerShot: 2,
    sound: { id: "mob.llama.spit", pitch: 0.7, volume: 1 },
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
 * The hidden item whose cooldown a gun's shot starts, and that cooldown's category: the held
 * model's recoil reads q.cooldown_time_remaining of the category. It isn't the gun's own
 * cooldown, which would also stop the gun being used (aimed).
 */
export function shotMarker(kind: GunKind): { item: string; category: string } {
  return { item: `minecade:${kind}_shot`, category: `minecade_${kind}_shot` };
}
