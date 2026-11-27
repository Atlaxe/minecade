// Paired Parkour (2v2, tiled; docs/plans/block-party-minigames.md): teammates are tied together by a
// lead and cross a parkour course, each team on its own copy; when one falls (Kill Y), both go back
// to their last checkpoint. First team with both over the Finish wins; at time the team further along
// wins, and equal is a draw. The lead is the players pack's (private_packs/players) between two
// players; without it, or with a bot, the game pulls the further one back past 5 blocks. Bots hop
// along the course from checkpoint to checkpoint.
import type { Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, botRun, clock, everyTick, fellOut, flat, inside, isPlayer, moveTo, onPlan, tilesOf } from "./common.ts";
import { middleOf, type Field, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** How far apart the lead lets teammates get. */
const LEAD = 5;

/** Ties `who` to `holder` with the players pack's lead, if both are players and it's installed. True when it took. */
function leash(who: Who, holder: Who): boolean {
  try {
    const leashable = who.player?.getComponent("minecraft:leashable");
    if (!leashable || !holder.player) return false;
    leashable.leashTo(holder.player);
    return true;
  } catch {
    return false;
  }
}

function unleash(who: Who): void {
  try {
    const leashable = who.player?.getComponent("minecraft:leashable");
    if (leashable?.isLeashed) leashable.unleash();
  } catch {
    // gone
  }
}

export const PARKOUR: MinigameDef = {
  id: "parkour",
  name: "Paired Parkour",
  kind: "2v2",
  rules: "Cross the course tied to your teammate. One falls, both go back. Both over the Finish wins.",
  tutorial: [
    {
      objective: "You and your teammate are tied together. Cross the parkour course: when one of you falls, both go back to your last checkpoint. Both over the Finish wins.",
      controls: [
        { input: "move", what: "Cross together" },
        { input: "jump", what: "Jump the gaps" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("parkour"),
  problem(field) {
    return field.regions(MARKUP.finish)[0] ? undefined : "its arena map has no Finish";
  },
  spawns(field, sides) {
    const tiles = tilesOf(field);
    return sides.map((count, i) => (tiles[i] ?? tiles[0]).spawns.slice(0, count));
  },
  async play(play: Play): Promise<Outcome> {
    const { scope, sides, field } = play;
    const tiles = tilesOf(field);
    const courses: Field[] = sides.map((_, i) => tiles[i] ?? tiles[0]);
    const total = play.setting("playTime") * 20;
    /** Each team's last checkpoint (-1: the start), and who's over the Finish. */
    const reached = sides.map(() => -1);
    const done = sides.map(() => new Set<string>());
    const tied = sides.map((side) => side.length === 2 && leash(side[1], side[0]));
    scope.add(() => sides.flat().forEach(unleash));
    const restart = (s: number) => {
      const course = courses[s];
      const checkpoint = course.regions(MARKUP.checkpoints)[reached[s]];
      sides[s].forEach((who, i) => {
        const spot = checkpoint ? { ...middleOf(checkpoint), x: middleOf(checkpoint).x + (i === 0 ? -0.6 : 0.6) } : (course.spawns[i] ?? course.spawns[0]);
        moveTo(who, play.bodyOf(who), spot);
      });
    };
    let winner: number | undefined;
    await everyTick(play, total, (tick) => {
      sides.forEach((side, s) => {
        const course = courses[s];
        const checkpoints = course.regions(MARKUP.checkpoints);
        const finish = course.regions(MARKUP.finish)[0];
        const bodies = side.map((who) => play.bodyOf(who));
        // One falls: both back.
        if (bodies.some((body) => body && fellOut(course, body, course.min.y, 3))) {
          restart(s);
          for (const who of side) play.tell(who, "A fall! Back to your checkpoint.", 30);
          return;
        }
        side.forEach((who, i) => {
          const body = bodies[i];
          if (!body) return;
          checkpoints.forEach((box, c) => {
            if (c > reached[s] && inside(box, body.location, 0.5)) reached[s] = c;
          });
          if (finish && inside(finish, body.location, 0.5)) done[s].add(who.key);
          else done[s].delete(who.key);
          if (isPlayer(body)) return;
          // A bot: the next checkpoint, then the Finish, waiting for its teammate past the lead.
          const mate = bodies[1 - i];
          if (mate && flat(mate.location, body.location) > LEAD - 1 && reachedAhead(course, body.location, mate.location)) return;
          const next = checkpoints[reached[s] + 1] ?? finish;
          if (next) botRun(play, who, middleOf(next), BOT_WALK * 0.9, 0.4);
        });
        // No lead: pull the one ahead back toward the other past the lead's length.
        if (!tied[s] && bodies.length === 2 && bodies[0] && bodies[1]) {
          const gap = flat(bodies[0].location, bodies[1].location);
          if (gap > LEAD) {
            const lead = bodies[0].location.y >= bodies[1].location.y ? 0 : 1;
            play.push(side[lead], bodies[1 - lead]!.location, -Math.min(1.2, (gap - LEAD) * 0.3));
          }
        }
        if (done[s].size >= side.length && winner === undefined) winner = s;
      });
      if (tick % 5 === 0) play.status(`${sides.map((side, s) => `${side.map((who) => who.name).join("+")} ${reached[s] + 1}`).join("  ")}  ${clock(total - tick)}`);
      return winner !== undefined;
    });
    if (winner !== undefined) return { winner };
    // Further along: checkpoints, then how close the nearer of each team is to its next one.
    const along = sides.map((side, s) => {
      const course = courses[s];
      const next = course.regions(MARKUP.checkpoints)[reached[s] + 1] ?? course.regions(MARKUP.finish)[0];
      const gaps = side.map((who) => play.bodyOf(who)).map((body) => (body && next ? flat(body.location, middleOf(next)) : 999));
      return reached[s] * 1000 - Math.round(Math.min(...gaps));
    });
    return { winner: along[0] === along[1] ? undefined : along[0] > along[1] ? 0 : 1 };
  },
};

/** Whether `at` is further along the course than `mate` (it waits for them): nearer the course's far end. */
function reachedAhead(course: Field, at: Vector3, mate: Vector3): boolean {
  const finish = course.regions(MARKUP.finish)[0];
  if (!finish) return false;
  const goal = middleOf(finish);
  return flat(at, goal) < flat(mate, goal);
}
