// Bots (the user's idea, 2026-11-17): a game one player starts gets bots in the empty seats (the
// lobby's Bots option), so a whole game can be watched to work out how it flows. A bot is a
// Steve-looking entity of the game's own (blockparty:bot, on the player's model and Steve's skin;
// vanilla's zombie model maps a 64 x 32 skin and stretched Steve's), named "Bot 1" and on (its name
// shows when you look at it). It sits in a seat like a player: its piece walks the board, it rolls
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

export const BOT_ENTITY = "blockparty:bot";

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
    if (Math.hypot(x, z) > 0.01) body.setRotation({ x: 0, y: (Math.atan2(-x, z) * 180) / Math.PI });
  } catch {
    // gone
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
  // A step up close ahead (a zombie after its target onto a space's marker): hop up it.
  const climb = target.y - at.y;
  stepBot(body, (dx / gap) * step, (dz / gap) * step, gap < 1.5 && climb > 0.05 && climb <= 0.6 ? climb : 0);
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
  /** Bodies by lowercased name, in the order the bots were added. */
  private readonly bodies = new Map<string, { name: string; body?: Entity }>();

  constructor(scope: Scope, dimension: Dimension) {
    this.dimension = dimension;
    scope.add(() => this.removeAll());
  }

  /** Sits `count` bots down, "Bot 1" and on; each gets a body at `at`. */
  add(count: number, at: Vector3): Who[] {
    const added: Who[] = [];
    for (let i = 0; i < count; i++) {
      const name = `Bot ${this.bodies.size + 1}`;
      this.bodies.set(name.toLowerCase(), { name });
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
      if (entry) entry.body = body;
      return body;
    } catch (error) {
      log.warn(`blockparty: ${name} couldn't be placed: ${describeError(error)}`);
      return undefined;
    }
  }

  private removeAll(): void {
    for (const entry of this.bodies.values()) {
      try {
        if (entry.body?.isValid) entry.body.remove();
      } catch {
        // gone with the world
      }
    }
    this.bodies.clear();
  }
}
