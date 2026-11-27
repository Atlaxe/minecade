// What a bot does while it stands still in a minigame (the user, 2026-11-27: bots more like players):
// now and then it looks round, at someone near (a player's or a bot's face) or just off to one side,
// and every so often it bobs down and up the way players crouch while they wait. Only while it's
// still and standing: a bot that moves, or that a minigame has put in a stance (crouching to defuse,
// drawing a bow), is left alone, and a minigame that reads where its bots look (the Enderman's
// stare) turns it off (MinigameDef.botsIdle).
import type { Entity, Vector3 } from "@minecraft/server";
import type { Scope } from "@minecade/minigame-core";
import { isPlayer, lookAt, poseOf, tapCrouch, type Who } from "./bots.ts";

/** Ticks between looks at the bots. */
const EVERY = 4;
/** Ticks a bot has to stand still before it looks round, and how far it may have moved meanwhile (blocks). */
const STILL_FOR = 24;
const STILL_WITHIN = 0.08;
/** Ticks between a still bot's glances: at least, and up to this many more. */
const GLANCE_GAP = 30;
const GLANCE_SPREAD = 60;
/** How near someone is to be looked at (blocks), and how often a glance goes to them rather than off to the side. */
const NEAR = 16;
const AT_SOMEONE = 0.6;
/** How often a glance is a crouch tap instead, and the ticks of each half of a tap. */
const TAP_SHARE = 0.2;
const TAP_TICKS = 3;

interface Still {
  at: Vector3;
  since: number;
  next: number;
}

/**
 * Looks after the bots among `everyone` while a minigame plays, until `scope` ends: `bodyOf` gives
 * each one's body now (none once it's gone).
 */
export function botsIdle(scope: Scope, everyone: readonly Who[], bodyOf: (who: Who) => Entity | undefined, random: () => number): void {
  const bots = everyone.filter((who) => !who.player);
  if (bots.length === 0) return;
  const still = new Map<string, Still>();
  let tick = 0;
  const glance = (body: Entity) => {
    const others = everyone.flatMap((who) => {
      const other = bodyOf(who);
      return other && other.id !== body.id && other.isValid ? [other] : [];
    });
    const near = others.filter((other) => Math.hypot(other.location.x - body.location.x, other.location.z - body.location.z) <= NEAR);
    if (near.length > 0 && random() < AT_SOMEONE) {
      lookAt(body, near[Math.floor(random() * near.length) % near.length].location, true);
      return;
    }
    try {
      const { y } = body.getRotation();
      body.setRotation({ x: (random() - 0.5) * 40, y: y + (random() - 0.5) * 140 });
    } catch {
      // gone
    }
  };
  const tap = (body: Entity) => {
    for (let half = 0; half < 4; half++) {
      scope.timeout(() => body.isValid && tapCrouch(body, half % 2 === 0), half * TAP_TICKS);
    }
  };
  scope.interval(() => {
    tick += EVERY;
    for (const who of bots) {
      const body = bodyOf(who);
      if (!body || isPlayer(body) || !body.isValid) {
        still.delete(who.key);
        continue;
      }
      let at: Vector3;
      try {
        at = body.location;
      } catch {
        continue;
      }
      const was = still.get(who.key);
      if (!was || Math.hypot(at.x - was.at.x, at.y - was.at.y, at.z - was.at.z) > STILL_WITHIN) {
        still.set(who.key, { at, since: tick, next: tick + STILL_FOR + Math.floor(random() * GLANCE_GAP) });
        continue;
      }
      if (tick - was.since < STILL_FOR || tick < was.next || poseOf(body) !== "stand") continue;
      was.next = tick + GLANCE_GAP + Math.floor(random() * GLANCE_SPREAD);
      if (random() < TAP_SHARE) tap(body);
      else glance(body);
    }
  }, EVERY);
}
