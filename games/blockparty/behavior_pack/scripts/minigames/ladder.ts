// Climb the Ladder (FFA; docs/plans/block-party-minigames.md): a tall wall of ladders. Everyone
// climbs; hit the others to knock them off (a push out from the wall). A fall lands you at the bottom
// to climb again (no fall damage). First to the Top wins; at time the rest place by how high they
// got. Bots climb the column in front of their spawn (moved up by script while they're in a ladder)
// and hit anyone in reach.
import type { Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, botBrawl, botStep, clock, everyTick, isPlayer, moveBot, onPlan, placesBy } from "./common.ts";
import { inOrder, middleOf, over, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** A bot's climb, blocks a tick (a player's is about 0.12). */
const BOT_CLIMB = 0.11;

export const LADDER: MinigameDef = {
  id: "ladder",
  name: "Climb the Ladder",
  kind: "ffa",
  rules: "Climb to the top first. Knock the others off the ladders.",
  tutorial: [
    {
      objective: "Climb the ladders to the top. Hit the others to knock them off. First to the top wins.",
      controls: [
        { input: "move", what: "Climb" },
        { input: "jump", what: "Climb on" },
        { input: "attack", what: "Knock them off" },
      ],
    },
  ],
  ...onPlan("ladder"),
  problem(field) {
    return field.regions(MARKUP.top)[0] ? undefined : "its arena map has no Top";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, dimension } = play;
    const top = field.regions(MARKUP.top)[0];
    const goal = middleOf(top);
    const everyone = play.sides.flat();
    const strength = play.setting("knockback") / 10;
    const total = play.setting("playTime") * 20;
    const best = new Map(everyone.map((who) => [who.key, 0]));
    const lastHit = new Map<string, number>();
    const finished: string[] = [];
    const bottom = field.spawns[0]?.y ?? field.min.y + 1;
    // Each bot's column: the ladder nearest its spawn, toward the wall.
    const columns = new Map<string, Vector3>();
    everyone.forEach((who, i) => {
      const spawn = field.spawns[i];
      if (!spawn || who.player) return;
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const at = { x: spawn.x + dx, y: spawn.y, z: spawn.z + dz };
          if (!columns.has(who.key) && blockId(dimension, at).includes("ladder")) columns.set(who.key, { x: Math.floor(at.x) + 0.5, y: spawn.y, z: Math.floor(at.z) + 0.5 });
        }
      }
    });
    play.hits("push", strength);
    await everyTick(play, total, (tick) => {
      for (const who of play.inPlay()) {
        if (finished.includes(who.key)) continue;
        const body = play.bodyOf(who);
        if (!body) continue;
        const height = body.location.y - bottom;
        if (height > (best.get(who.key) ?? 0)) best.set(who.key, height);
        if (over(top, body.location, 0, 2) && body.location.y >= top.min.y + 0.9) {
          finished.push(who.key);
          play.say(`${who.name} reached the top${finished.length === 1 ? " first" : ""}.`);
          continue;
        }
        if (isPlayer(body)) continue;
        if (play.pushed(who)) continue;
        // A bot: hit anyone close, else climb its column (or walk to it), and onto the top at the end.
        const hit = botBrawl(play, who, play.inPlay(), strength, lastHit, undefined, 0);
        if (hit) continue;
        const column = columns.get(who.key);
        const inLadder = blockId(dimension, body.location).includes("ladder") || blockId(dimension, { x: body.location.x, y: body.location.y + 1, z: body.location.z }).includes("ladder");
        if (body.location.y >= top.min.y) botStep(play, who, { x: goal.x, y: goal.y, z: goal.z }, BOT_WALK);
        else if (inLadder) moveBot(body, 0, BOT_CLIMB, 0);
        else if (column) botStep(play, who, column, BOT_WALK, 0.2);
      }
      if (tick % 5 === 0) play.status(`${everyone.map((who) => `${who.name} ${Math.floor(best.get(who.key) ?? 0)}`).join("  ")}  ${clock(total - tick)}`);
      return finished.length >= play.inPlay().length;
    });
    const rest = everyone.map((who) => who.key).filter((key) => !finished.includes(key));
    return { places: [...finished.map((key) => [key]), ...placesBy(rest, (key) => Math.floor(best.get(key) ?? 0))] };
  },
};
