// Montecarlo (FFA, tiled; docs/plans/block-party-minigames.md): a run of hallways, each ending in a
// wall of doors: one (or two) lead on to the next hallway, the rest drop you back to the start of the
// hallway you're in. Through the last hallway's right door is the Finish. Fastest through wins; at
// time the rest place by hallways passed, then by who got there first. Each player plays their own
// copy, each copy with its own right doors at random. Stepping into a door's box decides it. Bots try
// a door they haven't tried in this hallway.
import type { Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, botArm, botStep, clock, everyTick, inside, moveTo, onPlan, placesBy, shuffled, tilesOf } from "./common.ts";
import { middleOf, type Field, type MinigameDef, type Outcome, type Play, type Spot, type WorldBox } from "./kit.ts";

interface Course {
  hallways: WorldBox[];
  starts: Spot[];
  /** Each hallway's doors, and which of them lead on. */
  doors: WorldBox[][];
  right: Set<WorldBox>;
  finish: WorldBox;
}

function courseOf(field: Field, rightDoors: number, random: () => number): Course | undefined {
  const hallways = field.regions(MARKUP.hallways);
  const starts = field.points(MARKUP.hallwayStarts);
  const finish = field.regions(MARKUP.finish)[0];
  if (hallways.length === 0 || !finish) return undefined;
  const all = field.regions(MARKUP.doors);
  const doors = hallways.map((hall) => all.filter((door) => inside(hall, middleOf(door), 0.6)));
  const right = new Set<WorldBox>();
  for (const group of doors) for (const door of shuffled(group, random).slice(0, Math.min(rightDoors, Math.max(1, group.length - 1)))) right.add(door);
  return { hallways, starts, doors, right, finish };
}

export const MONTECARLO: MinigameDef = {
  id: "montecarlo",
  name: "Montecarlo",
  kind: "ffa",
  rules: "Pick a door at the end of each hallway: the right one leads on, the rest send you back. Fastest through wins.",
  tutorial: [
    {
      objective: "Each hallway ends in doors: one leads on, the rest send you back to the hallway's start. Remember which you tried. Fastest through wins.",
      controls: [
        { input: "move", what: "Go through a door" },
        { input: "use", what: "Open a door" },
      ],
    },
  ],
  ...onPlan("montecarlo"),
  problem(field) {
    if (field.regions(MARKUP.hallways).length === 0) return "its arena map has no Hallways";
    if (field.points(MARKUP.hallwayStarts).length < field.regions(MARKUP.hallways).length) return "its arena map needs a Hallway start for each hallway";
    return field.regions(MARKUP.finish)[0] ? undefined : "its arena map has no Finish";
  },
  spawns(field, sides) {
    const tiles = tilesOf(field);
    return sides.map((count, i) => (tiles[i] ?? tiles[0]).spawns.slice(0, count));
  },
  async play(play: Play): Promise<Outcome> {
    const { field } = play;
    const everyone = play.sides.flat();
    const tiles = tilesOf(field);
    const total = play.setting("playTime") * 20;
    const rightDoors = play.setting("rightDoors");
    const backAfter = play.setting("backAfter") * 2;
    const courses = new Map(everyone.map((who, i) => [who.key, courseOf(tiles[i] ?? tiles[0], rightDoors, play.random)]));
    const hall = new Map(everyone.map((who) => [who.key, 0]));
    const reachedAt = new Map(everyone.map((who) => [who.key, 0]));
    const finished: string[] = [];
    /** A wrong door's way back: when it happens. */
    const goingBack = new Map<string, number>();
    const tried = new Map(everyone.map((who) => [who.key, new Set<WorldBox>()]));
    const target = new Map<string, Vector3>();
    /** Bots that have pushed the door they're headed for (a new door, a new push). */
    const pushed = new Set<string>();
    await everyTick(play, total, (tick) => {
      for (const who of play.inPlay()) {
        if (finished.includes(who.key)) continue;
        const body = play.bodyOf(who);
        const course = courses.get(who.key);
        if (!body || !course) continue;
        const h = hall.get(who.key) ?? 0;
        const back = goingBack.get(who.key);
        if (back !== undefined) {
          if (tick >= back) {
            goingBack.delete(who.key);
            const start = course.starts[h];
            if (start) moveTo(who, body, start);
          }
          continue;
        }
        if (inside(course.finish, body.location, 0.3)) {
          finished.push(who.key);
          play.say(`${who.name} got through${finished.length === 1 ? " first" : ""}.`);
          continue;
        }
        const door = (course.doors[h] ?? []).find((box) => inside(box, body.location, 0.1));
        if (door) {
          tried.get(who.key)?.add(door);
          if (course.right.has(door)) {
            const next = h + 1;
            hall.set(who.key, next);
            reachedAt.set(who.key, tick);
            tried.set(who.key, new Set());
            target.delete(who.key);
            const start = course.starts[next];
            if (start) moveTo(who, body, start);
            else moveTo(who, body, middleOf(course.finish));
            play.tell(who, next < course.hallways.length ? `Right door! Hallway ${next + 1}.` : "Right door!", 30);
          } else {
            goingBack.set(who.key, tick + Math.max(1, backAfter));
            target.delete(who.key);
            play.freeze(who, Math.max(1, backAfter));
            play.dimension.playSound("random.door_close", body.location);
            play.tell(who, "Wrong door!", 30);
          }
          continue;
        }
        if (who.player) continue;
        // A bot: a door it hasn't tried here.
        let goal = target.get(who.key);
        if (!goal) {
          const untried = (course.doors[h] ?? []).filter((box) => !tried.get(who.key)?.has(box));
          const pick = untried[Math.floor(play.random() * untried.length)] ?? course.doors[h]?.[0];
          if (pick) {
            const middle = middleOf(pick);
            goal = { x: middle.x, y: pick.min.y, z: middle.z };
            target.set(who.key, goal);
            pushed.delete(who.key);
          }
        }
        if (goal) {
          // The door pushed open with a swing as it gets there, as a player opens one.
          if (Math.hypot(goal.x - body.location.x, goal.z - body.location.z) < 1.6 && !pushed.has(who.key)) {
            pushed.add(who.key);
            botArm(play, who);
          }
          botStep(play, who, goal, BOT_WALK, 0.1);
        }
      }
      if (tick % 5 === 0) play.status(`${everyone.map((who) => `${who.name} ${finished.includes(who.key) ? "done" : `hall ${(hall.get(who.key) ?? 0) + 1}`}`).join("  ")}  ${clock(total - tick)}`);
      return finished.length >= play.inPlay().length;
    });
    const rest = everyone.map((who) => who.key).filter((key) => !finished.includes(key));
    // The rest: more hallways passed first, then who got to theirs sooner.
    return { places: [...finished.map((key) => [key]), ...placesBy(rest, (key) => (hall.get(key) ?? 0) * 100000 - (reachedAt.get(key) ?? 0))] };
  },
};
