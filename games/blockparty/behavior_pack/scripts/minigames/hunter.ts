// Hunter (1v3, a small version of the plan's Hunter vs. Runners): the runners start at one end, the
// hunter in the middle, who waits 2 seconds after Go. A runner the hunter hits is caught and out; a
// runner who reaches the goal is safe. The runners win if at least half of them (2 of 3, 1 of 2) get
// to the goal before the time runs out; otherwise the hunter wins. A bot hunter catches whoever it
// gets close to; bot runners head for the goal, swerving away from the hunter when it's near and
// ahead of them.
// Its arena map (arenas.ts) marks the Hunter spawn, 3 Runner spawns (1v2 uses the first 2) and the
// Goal box (a runner standing over it is home). Its test arena is a walled field with a gold goal at
// the far end.
import { world, type Entity, type Vector3 } from "@minecraft/server";
import { BOT_RUN, BOT_WALK, isPlayer, stepBot, stepToward, thinkTicks, type Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { at, fill, middleOf, over, secondsText, spread, testField, type Field, type MinigameDef, type Outcome, type Play, type WorldBox } from "./kit.ts";

/** The test arena: length (x) and width (z) inside the walls, and where the gold starts from the near end. */
const LENGTH = 40;
const WIDTH = 20;
const GOAL = LENGTH - 4;
const PLAY_TICKS = 900;
/** Ticks the hunter waits after Go. */
const HEAD_START = 40;
/** How close a bot hunter gets to catch someone. */
const CATCH = 1.4;
/** How near the hunter is before a bot runner swerves. */
const SWERVE = 8;
/** Bot runners run a little slower than the hunter. */
const RUNNER_SPEED = (BOT_WALK + BOT_RUN) / 2;

function goalOf(field: Field): WorldBox | undefined {
  return field.regions(MARKUP.goal)[0];
}

export const HUNTER: MinigameDef = {
  id: "hunter",
  name: "Hunter",
  kind: "1v3",
  rules: "Runners: reach the goal. Hunter: hit the runners first. Half of the runners home wins it for them.",
  size: [LENGTH + 2, 6, WIDTH + 2],
  build(dimension, min) {
    const far = { x: min.x + LENGTH + 1, y: min.y, z: min.z + WIDTH + 1 };
    fill(dimension, min, { x: far.x, y: min.y + 3, z: far.z }, "minecraft:stone_bricks");
    fill(dimension, { x: min.x + 1, y: min.y + 1, z: min.z + 1 }, { x: far.x - 1, y: min.y + 3, z: far.z - 1 }, "minecraft:air");
    fill(dimension, { x: min.x + 1, y: min.y, z: min.z + 1 }, { x: far.x - 1, y: min.y, z: far.z - 1 }, "minecraft:moss_block");
    fill(dimension, { x: min.x + 1 + GOAL, y: min.y, z: min.z + 1 }, { x: far.x - 1, y: min.y, z: far.z - 1 }, "minecraft:gold_block");
  },
  testField(min) {
    const goal = { min: { x: min.x + 1 + GOAL, y: min.y, z: min.z + 1 }, max: { x: min.x + LENGTH, y: min.y, z: min.z + WIDTH } };
    const hunter = [at(min, 1 + LENGTH / 2, 1, 1 + WIDTH / 2)];
    const runners = spread(at(min, 2, 1, 4), at(min, 2, 1, WIDTH - 3), 3);
    return testField(min, this.size, { points: { [MARKUP.hunter]: hunter, [MARKUP.runners]: runners }, regions: { [MARKUP.goal]: [goal] } });
  },
  problem(field) {
    return goalOf(field) ? undefined : "its arena map has no Goal box";
  },
  spawns(field, sides) {
    return [field.points(MARKUP.hunter).slice(0, sides[0] ?? 1), field.points(MARKUP.runners).slice(0, sides[1] ?? 0)];
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides } = play;
    const [hunters, runners] = sides;
    const hunter = hunters[0];
    const goal = goalOf(field)!;
    const goalMiddle = middleOf(goal);
    const needed = Math.ceil(runners.length / 2);
    const safe = new Set<string>();
    const caught = new Set<string>();
    const runnerKeys = new Set(runners.map((who) => who.key));
    play.titleEach("Run!", (key) => (key === hunter.key ? "You hunt: catch them" : runners.some((who) => who.key === key) ? `Reach the goal: ${needed} home wins` : ""));
    const catchRunner = (who: Who) => {
      if (caught.has(who.key) || safe.has(who.key)) return;
      caught.add(who.key);
      play.out(who);
      play.say(`${hunter.name} caught ${who.name}.`);
    };
    // A player hunter catches by hitting.
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (!isPlayer(damagingEntity) || damagingEntity.id !== play.bodyOf(hunter)?.id) return;
      const runner = runners.find((who) => play.bodyOf(who)?.id === hitEntity.id);
      if (runner && !play.isOut(runner)) catchRunner(runner);
    });
    // The hunter waits: a player can't move till then.
    play.freeze(hunter, HEAD_START);
    const starts = new Map(runners.map((who) => [who.key, thinkTicks(play.random, 0, 30)]));
    const lane = new Map(runners.map((who) => [who.key, play.random() < 0.5 ? -1 : 1]));
    let tick = 0;
    for (; tick < PLAY_TICKS && !scope.disposed; tick++) {
      const hunterBody = play.bodyOf(hunter);
      const active = runners.filter((who) => !play.isOut(who) && !safe.has(who.key));
      if (active.length === 0) break;
      // Home: a runner over the goal.
      for (const who of active) {
        const body = play.bodyOf(who);
        if (!body) {
          caught.add(who.key);
          continue;
        }
        if (over(goal, body.location)) {
          safe.add(who.key);
          play.say(`${who.name} is home.`);
          if (!isPlayer(body)) stepBot(body, 0, 0);
        }
      }
      // The bot hunter: after its wait, after the runner nearest the goal.
      if (hunterBody && !isPlayer(hunterBody)) {
        if (tick >= HEAD_START) {
          const prey = nearestToGoal(active, play, caught, safe, goalMiddle);
          if (prey) {
            const preyBody = play.bodyOf(prey)!;
            stepToward(hunterBody, preyBody.location, BOT_RUN, 0.2);
            if (Math.hypot(preyBody.location.x - hunterBody.location.x, preyBody.location.z - hunterBody.location.z) <= CATCH) catchRunner(prey);
          } else stepBot(hunterBody, 0, 0);
        }
      }
      // Bot runners: for the goal, swerving to their side when the hunter is near and ahead.
      for (const who of active) {
        const body = play.bodyOf(who);
        if (!body || isPlayer(body) || safe.has(who.key) || caught.has(who.key) || tick < (starts.get(who.key) ?? 0)) continue;
        stepToward(body, runnerTarget(body.location, goalMiddle, hunterBody?.location, lane.get(who.key) ?? 1, field), RUNNER_SPEED, 0.1);
      }
      if (tick % 5 === 0) play.status(`Home ${safe.size} of ${needed}, ${secondsText(PLAY_TICKS - tick)}`);
      await scope.wait(1);
    }
    const home = [...safe].filter((key) => runnerKeys.has(key)).length;
    play.say(`${home} of ${runners.length} runners got home.`);
    return { winner: home >= needed ? 1 : 0 };
  },
};

/**
 * Where a bot runner at `here` heads: the goal, or, with the hunter near and ahead, a step to its
 * side of the way to the goal (away from the hunter), kept inside the arena.
 */
function runnerTarget(here: Vector3, goal: Vector3, hunter: Vector3 | undefined, lane: number, field: Field): Vector3 {
  const dx = goal.x - here.x;
  const dz = goal.z - here.z;
  const length = Math.hypot(dx, dz) || 1;
  const ahead = { x: dx / length, z: dz / length };
  if (!hunter) return { x: goal.x, y: here.y, z: goal.z };
  const hx = hunter.x - here.x;
  const hz = hunter.z - here.z;
  const near = Math.hypot(hx, hz) < SWERVE && hx * ahead.x + hz * ahead.z > -1;
  if (!near) return { x: goal.x, y: here.y, z: goal.z };
  // Across the way: the side the hunter isn't on (its lane when it's straight ahead).
  const across = { x: -ahead.z, z: ahead.x };
  const side = hx * across.x + hz * across.z;
  const away = side === 0 ? lane : -Math.sign(side);
  const x = here.x + ahead.x * 2 + across.x * away * 4;
  const z = here.z + ahead.z * 2 + across.z * away * 4;
  const { min, size } = field;
  return { x: Math.max(min.x + 1.5, Math.min(min.x + size[0] - 1.5, x)), y: here.y, z: Math.max(min.z + 1.5, Math.min(min.z + size[2] - 1.5, z)) };
}

/** The runner still running who's nearest the goal. */
function nearestToGoal(active: readonly Who[], play: Play, caught: ReadonlySet<string>, safe: ReadonlySet<string>, goal: Vector3): Who | undefined {
  let best: { who: Who; gap: number } | undefined;
  for (const who of active) {
    if (caught.has(who.key) || safe.has(who.key)) continue;
    const body: Entity | undefined = play.bodyOf(who);
    if (!body) continue;
    const gap = Math.hypot(goal.x - body.location.x, goal.z - body.location.z);
    if (!best || gap < best.gap) best = { who, gap };
  }
  return best?.who;
}
