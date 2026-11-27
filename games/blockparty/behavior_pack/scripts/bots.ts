// Bots (the user's idea, 2026-11-17): a game one player starts gets bots in the empty seats (the
// lobby's Bots option, which also sets how well they play: bot-skill.ts), so a whole game can be
// watched to work out how it flows. A bot is an entity of the game's own (blockparty:bot, on the
// player's model; vanilla's zombie model maps a 64 x 32 skin and stretched Steve's) wearing one of
// Minecraft's skins (bot-skins.ts: a different one for each bot, at random, kept every time it's made
// again), named "Bot 1" and on (its name shows when you look at it). It moves and acts like a player
// (the user, 2026-11-27): it turns as it walks rather than snapping round, looks at what it's after,
// swings its arm to hit, open, use, throw or place, crouches, draws a bow, and holds and wears what a
// minigame hands out. Its client entity plays the player's own animations for those (vanilla's arm
// swing, sneak, bow draw and holding) from its blockparty:swing and blockparty:pose properties. It sits in a seat like a player: its piece walks the board, it rolls
// (the die over its head, a short think, a hop), picks a way at a branch, buys a Star when it has the
// coins, and plays the minigames, each step after a delay so you can see it happen. Bots move by a set
// speed each tick (clearVelocity, then applyImpulse), keeping their fall.
//
// A bot that goes a long way with a player (into a minigame's arena and back) is made again where it
// goes, after the player has got there (respawn): a body teleported in the same tick as a player is
// dropped by that player's screen with the place they left and never sent again, so the user saw the
// bots vanish at the first minigame while the server still had them playing.
import type { Dimension, Entity, Player, Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { BOT_SKINS, pickSkin, type BotSkin } from "./bot-skins.ts";

export const BOT_ENTITY = "blockparty:bot";
/** The bot's skin: its index in BOT_SKINS (bot-skins.ts). */
const SKIN_PROPERTY = "blockparty:skin";
/** A counter that goes up by one for each arm swing: the client plays the player's swing when it changes. */
const SWING_PROPERTY = "blockparty:swing";
const SWING_COUNT = 64;
/** The bot's stance: POSE_CODES's. */
const POSE_PROPERTY = "blockparty:pose";

/** A bot's stance, as a player's: standing, crouching (sneaking) or drawing a bow. */
export type BotPose = "stand" | "crouch" | "bow";
export const POSE_CODES: Readonly<Record<BotPose, number>> = { stand: 0, crouch: 1, bow: 2 };

/** Most degrees a walking bot turns in a tick (a player turns fast, but not in no time at all). */
const TURN_STEP = 40;
/** How high a bot's eyes are over its feet (a player's). */
const EYE_HEIGHT = 1.62;

/** Someone in the game: a player, or a bot. */
export interface Who {
  name: string;
  /** The lowercased name everything is kept under. */
  key: string;
  /** The player, or the bot's entity. */
  body: Entity;
  player?: Player;
}

export function isPlayer(body: Entity): body is Player {
  return body.typeId === "minecraft:player";
}

export function whoOf(player: Player): Who {
  return { name: player.name, key: player.name.toLowerCase(), body: player, player };
}

/** A body's name: a player's gamertag, a bot's name tag. */
export function nameOf(body: Entity): string {
  return isPlayer(body) ? body.name : body.nameTag;
}

/** A bot's walk in blocks a tick: a player's (4.3 a second). */
export const BOT_WALK = 0.215;
/** A bot's run in blocks a tick: a player's sprint (5.6 a second). */
export const BOT_RUN = 0.28;

/** Gravity on a bot, blocks a tick each tick. */
const BOT_GRAVITY = 0.08;

/** The upward speed that takes a bot up `climb` blocks with a little to spare (a hop up a step), at most a jump's. */
export function hopUp(climb: number): number {
  return Math.min(0.42, Math.sqrt(2 * BOT_GRAVITY * (climb + 0.15)));
}

/**
 * One tick's step for a bot: `x` and `z` blocks this tick, keeping whatever it's falling at; `climb`
 * (blocks) a step up ahead, which it hops up when it isn't on its way up already (a bot set moving
 * doesn't step up on its own).
 */
export function stepBot(body: Entity, x: number, z: number, climb = 0): void {
  try {
    const fall = body.getVelocity().y;
    body.clearVelocity();
    body.applyImpulse({ x, y: climb > 0 && fall <= 0.01 ? hopUp(climb) : fall, z });
    if (Math.hypot(x, z) > 0.01) turnToward(body, (Math.atan2(-x, z) * 180) / Math.PI);
  } catch {
    // gone
  }
}

/**
 * Sets a bot moving `x`, `y` and `z` blocks this tick, turned the way it goes along the ground: its
 * walk on the board, where the walk's plan (walk-plan.ts) says how far up or down each tick, so it
 * jumps, falls and climbs as the plan does.
 */
export function moveBot(body: Entity, x: number, y: number, z: number): void {
  try {
    body.clearVelocity();
    body.applyImpulse({ x, y, z });
    if (Math.hypot(x, z) > 0.01) turnToward(body, (Math.atan2(-x, z) * 180) / Math.PI);
  } catch {
    // gone
  }
}

/** The shortest turn from one yaw to another, in degrees (-180 to 180). */
export function yawGap(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Turns a walking bot toward `yaw` by at most TURN_STEP this tick, its look easing back to level. */
function turnToward(body: Entity, yaw: number): void {
  const { x, y } = body.getRotation();
  const gap = yawGap(y, yaw);
  body.setRotation({ x: x * 0.7, y: y + Math.max(-TURN_STEP, Math.min(TURN_STEP, gap)) });
}

/** Turns a bot to look at a spot (at its eye height, when `eyes`, as at a player's or bot's face): its body round and its head up or down. */
export function lookAt(body: Entity, at: Vector3, eyes = false): void {
  try {
    const from = body.location;
    const dx = at.x - from.x;
    const dz = at.z - from.z;
    const dy = at.y + (eyes ? EYE_HEIGHT : 0) - (from.y + EYE_HEIGHT);
    const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
    const pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    body.setRotation({ x: Math.max(-89, Math.min(89, pitch)), y: yaw });
  } catch {
    // gone
  }
}

/** A bot swings its arm, as a player does to hit, open, use, throw or place something. */
export function swingArm(body: Entity): void {
  try {
    const count = body.getProperty(SWING_PROPERTY);
    body.setProperty(SWING_PROPERTY, ((typeof count === "number" ? count : 0) + 1) % SWING_COUNT);
  } catch {
    // gone
  }
}

/** A bot's stance now. */
export function poseOf(body: Entity): BotPose {
  try {
    const code = body.getProperty(POSE_PROPERTY);
    return (Object.keys(POSE_CODES) as BotPose[]).find((pose) => POSE_CODES[pose] === code) ?? "stand";
  } catch {
    return "stand";
  }
}

function showPose(body: Entity, pose: BotPose): void {
  try {
    if (body.getProperty(POSE_PROPERTY) !== POSE_CODES[pose]) body.setProperty(POSE_PROPERTY, POSE_CODES[pose]);
  } catch {
    // gone
  }
}

/** Bodies in a crouch tap of their own (tapCrouch), by entity id: setPose ends it. */
const tapping = new Set<string>();

/** Puts a bot in a stance (crouching while it defuses, drawing a bow), which stays until another. */
export function setPose(body: Entity, pose: BotPose): void {
  tapping.delete(body.id);
  showPose(body, pose);
}

/**
 * Half of a crouch tap, the way players bob down and up while they wait: down only from standing,
 * and up only from its own tap's crouch (a stance set meanwhile stays).
 */
export function tapCrouch(body: Entity, down: boolean): void {
  if (down) {
    if (poseOf(body) !== "stand") return;
    tapping.add(body.id);
    showPose(body, "crouch");
  } else if (tapping.delete(body.id)) showPose(body, "stand");
}

/** What each bot body holds, by entity id (holdItem). */
const held = new Map<string, string>();

/** A bot holds an item in its hand (as a player holds their selected slot's), or nothing. */
export function holdItem(body: Entity, itemId: string | undefined): void {
  if (itemId) held.set(body.id, itemId);
  else held.delete(body.id);
  try {
    body.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${itemId ?? "air"}`);
  } catch {
    // gone, or not an item this server knows
  }
}

/** What a bot holds (holdItem), if anything. */
export function heldBy(body: Entity): string | undefined {
  return held.get(body.id);
}

/** Forgets a body that's gone: what it held, and any crouch tap of its own. */
function forget(id: string): void {
  held.delete(id);
  tapping.delete(id);
}

/** A bot puts on armor, by slot (anything left out stays as it is). */
export function wearArmor(body: Entity, armor: { head?: string; chest?: string; legs?: string; feet?: string }): void {
  for (const [slot, id] of [
    ["head", armor.head],
    ["chest", armor.chest],
    ["legs", armor.legs],
    ["feet", armor.feet],
  ] as const) {
    if (!id) continue;
    try {
      body.runCommand(`replaceitem entity @s slot.armor.${slot} 0 ${id}`);
    } catch {
      // gone, or not an item this server knows
    }
  }
}

/** Steers a bot a tick toward `target` at `speed` blocks a tick; true once it's within `near`. */
export function stepToward(body: Entity, target: Vector3, speed: number, near = 0.3): boolean {
  let at: Vector3;
  try {
    at = body.location;
  } catch {
    return true;
  }
  const dx = target.x - at.x;
  const dz = target.z - at.z;
  const gap = Math.hypot(dx, dz);
  if (gap <= near) {
    stepBot(body, 0, 0);
    return true;
  }
  const step = Math.min(speed, gap);
  // A step up close ahead (a zombie after its target onto a space's marker, or up a block where the
  // board rises): hop up it.
  const climb = target.y - at.y;
  stepBot(body, (dx / gap) * step, (dz / gap) * step, gap < 1.5 && climb > 0.05 && climb <= 1.3 ? climb : 0);
  return false;
}

/** A bot's hop (a jump, as a player's): it rolls the die by it. */
export function hop(body: Entity): void {
  try {
    body.applyImpulse({ x: 0, y: 0.42, z: 0 });
  } catch {
    // gone
  }
}

/** Ticks a bot thinks before a step: between `min` and `max`. */
export function thinkTicks(random: () => number, min = 20, max = 40): number {
  return min + Math.floor(random() * (max - min + 1));
}

export class Bots {
  private readonly dimension: Dimension;
  /** The skins this build can draw (bot-skins.ts, wearableSkins), and the game's random. */
  private readonly wearable: readonly number[];
  private readonly random: () => number;
  /** Bodies by lowercased name, in the order the bots were added, each with its skin (an index in BOT_SKINS). */
  private readonly bodies = new Map<string, { name: string; skin: number; body?: Entity }>();

  constructor(scope: Scope, dimension: Dimension, wearable: readonly number[], random: () => number) {
    this.dimension = dimension;
    this.wearable = wearable;
    this.random = random;
    scope.add(() => this.removeAll());
  }

  /** Sits `count` bots down, "Bot 1" and on, each in a skin no other bot wears while there are enough; each gets a body at `at`. */
  add(count: number, at: Vector3): Who[] {
    const added: Who[] = [];
    for (let i = 0; i < count; i++) {
      const name = `Bot ${this.bodies.size + 1}`;
      const skin = pickSkin(this.wearable, [...this.bodies.values()].map((entry) => entry.skin), this.random);
      this.bodies.set(name.toLowerCase(), { name, skin });
      const body = this.spawn(name, at);
      if (body) added.push({ name, key: name.toLowerCase(), body });
    }
    return added;
  }

  has(name: string): boolean {
    return this.bodies.has(name.toLowerCase());
  }

  get count(): number {
    return this.bodies.size;
  }

  /** A bot's skin. */
  skinOf(name: string): BotSkin | undefined {
    const entry = this.bodies.get(name.toLowerCase());
    return entry ? BOT_SKINS[entry.skin] : undefined;
  }

  /** A bot with its body (a new one at `at` when the old is gone and `at` is given). */
  who(name: string, at?: Vector3): Who | undefined {
    const entry = this.bodies.get(name.toLowerCase());
    if (!entry) return undefined;
    const body = entry.body?.isValid ? entry.body : at ? this.spawn(entry.name, at) : undefined;
    return body ? { name: entry.name, key: entry.name.toLowerCase(), body } : undefined;
  }

  /** Every bot with a body. */
  all(): Who[] {
    return [...this.bodies.values()].flatMap((entry) => (entry.body?.isValid ? [{ name: entry.name, key: entry.name.toLowerCase(), body: entry.body }] : []));
  }

  /** A bot's body made again at `at` facing `yaw` (the old one taken away); `who` gets the new body. */
  respawn(who: Who, at: Vector3, yaw = 180): void {
    const entry = this.bodies.get(who.key);
    if (!entry) return;
    if (entry.body) forget(entry.body.id);
    try {
      if (entry.body?.isValid) entry.body.remove();
    } catch {
      // gone already
    }
    const body = this.spawn(entry.name, at);
    if (!body) return;
    try {
      body.setRotation({ x: 0, y: yaw });
    } catch {
      // gone
    }
    who.body = body;
  }

  private spawn(name: string, at: Vector3): Entity | undefined {
    try {
      const body = this.dimension.spawnEntity(BOT_ENTITY, at);
      body.nameTag = name;
      const entry = this.bodies.get(name.toLowerCase());
      if (entry) {
        entry.body = body;
        body.setProperty(SKIN_PROPERTY, entry.skin);
      }
      return body;
    } catch (error) {
      log.warn(`blockparty: ${name} couldn't be placed: ${describeError(error)}`);
      return undefined;
    }
  }

  private removeAll(): void {
    for (const entry of this.bodies.values()) {
      if (entry.body) forget(entry.body.id);
      try {
        if (entry.body?.isValid) entry.body.remove();
      } catch {
        // gone with the world
      }
    }
    this.bodies.clear();
  }
}
