// Sumo Duel (FFA; docs/plans/block-party-minigames.md): knock everyone else off the platform. Hits
// push twice vanilla's by default (the Knockback setting, Sumo's measured numbers). Last one on wins;
// the rest place by when they fell. In the sudden death's pool. Bots walk at the nearest player and
// hit. Cactus Slap (cactus.ts) plays the same way with cactus that put you out.
import type { Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { botBrawl, clock, everyTick, fellOut, floorOf, onPlan, placesByOut } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/**
 * A knock-off: hits push (Knockback setting); a fall below Kill Y, or `outBy` saying so, is out.
 * Last one in wins; the rest place by when they went out; at time everyone still in ties first.
 */
export async function knockOff(play: Play, outBy?: (who: Who, at: Vector3) => string | undefined): Promise<Outcome> {
  const { field } = play;
  const everyone = play.sides.flat();
  const strength = play.setting("knockback") / 10;
  const total = play.setting("playTime") * 20;
  const floorY = floorOf(field.spawns, field);
  const outAt = new Map<string, number>();
  const lastHit = new Map<string, number>();
  play.hits("push", strength);
  await everyTick(play, total, (tick) => {
    for (const who of play.inPlay()) {
      const body = play.bodyOf(who);
      if (!body) continue;
      const why = fellOut(field, body, floorY) ? "fell" : outBy?.(who, body.location);
      if (why) {
        outAt.set(who.key, tick);
        play.out(who);
        play.say(`${who.name} ${why}.`);
        continue;
      }
      if (!who.player) botBrawl(play, who, play.inPlay(), strength, lastHit);
    }
    if (tick % 5 === 0) play.status(`${play.inPlay().length} left  ${clock(total - tick)}`);
    return everyone.length > 1 ? play.inPlay().length <= 1 : play.inPlay().length === 0;
  });
  return { places: placesByOut(everyone.map((who) => who.key), outAt) };
}

export const SUMO_DUEL: MinigameDef = {
  id: "sumoduel",
  name: "Sumo Duel",
  kind: "ffa",
  rules: "Knock everyone else off the platform. Last one on wins.",
  tutorial: [
    {
      objective: "Knock everyone else off the platform. Last one on wins.",
      controls: [
        { input: "move", what: "Close in" },
        { input: "attack", what: "Push" },
        { input: "jump", what: "Dodge" },
      ],
    },
  ],
  ...onPlan("sumoduel"),
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  play: (play) => knockOff(play),
};
