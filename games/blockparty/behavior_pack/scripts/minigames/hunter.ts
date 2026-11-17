// Hunter (1v3, a small version of the plan's Hunter vs. Runners): a walled field with a gold goal at
// the far end. The runners start at the near end, the hunter in the middle, who waits 2 seconds
// after Go. A runner the hunter hits is caught and out; a runner who reaches the gold is safe. The
// runners win if at least half of them (2 of 3, 1 of 2) get to the gold before the time runs out;
// otherwise the hunter wins. A bot hunter catches whoever it gets close to; bot runners head for the
// gold, swerving away from the hunter when it's near.
import { world, type Entity, type Vector3 } from "@minecraft/server";
import { BOT_RUN, BOT_WALK, isPlayer, stepBot, stepToward, thinkTicks, type Who } from "../bots.ts";
import { at, fill, secondsText, spread, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** The field: length (x) and width (z) inside the walls. */
const LENGTH = 40;
const WIDTH = 20;
/** Where the gold starts, from the field's near end. */
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

export const HUNTER: MinigameDef = {
  id: "hunter",
  name: "Hunter",
  kind: "1v3",
  rules: "Runners: reach the gold at the far end. Hunter: hit the runners first. Half of the runners home wins it for them.",
  size: [LENGTH + 2, 6, WIDTH + 2],
  build(dimension, min) {
    const far = { x: min.x + LENGTH + 1, y: min.y, z: min.z + WIDTH + 1 };
    fill(dimension, min, { x: far.x, y: min.y + 3, z: far.z }, "minecraft:stone_bricks");
    fill(dimension, { x: min.x + 1, y: min.y + 1, z: min.z + 1 }, { x: far.x - 1, y: min.y + 3, z: far.z - 1 }, "minecraft:air");
    fill(dimension, { x: min.x + 1, y: min.y, z: min.z + 1 }, { x: far.x - 1, y: min.y, z: far.z - 1 }, "minecraft:moss_block");
    fill(dimension, { x: min.x + 1 + GOAL, y: min.y, z: min.z + 1 }, { x: far.x - 1, y: min.y, z: far.z - 1 }, "minecraft:gold_block");
  },
  spawns(min, sides) {
    const hunter = [at(min, 1 + LENGTH / 2, 1, 1 + WIDTH / 2)];
    const runners = spread(at(min, 2, 1, 4), at(min, 2, 1, WIDTH - 3), sides[1] ?? 0);
    return [hunter, runners];
  },
  async play(play: Play): Promise<Outcome> {
    const { min, scope, sides } = play;
    const [hunters, runners] = sides;
    const hunter = hunters[0];
    const goalX = min.x + 1 + GOAL;
    const needed = Math.ceil(runners.length / 2);
    const safe = new Set<string>();
    const caught = new Set<string>();
    const runnerKeys = new Set(runners.map((who) => who.key));
    play.titleEach("Run!", (key) => (key === hunter.key ? "You hunt: catch them" : runners.some((who) => who.key === key) ? `Reach the gold: ${needed} home wins` : ""));
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
      // Home: a runner on the gold.
      for (const who of active) {
        const body = play.bodyOf(who);
        if (!body) {
          caught.add(who.key);
          continue;
        }
        if (body.location.x >= goalX) {
          safe.add(who.key);
          play.say(`${who.name} is home.`);
          if (!isPlayer(body)) stepBot(body, 0, 0);
        }
      }
      // The bot hunter: after its wait, after the runner nearest the gold.
      if (hunterBody && !isPlayer(hunterBody)) {
        if (tick >= HEAD_START) {
          const prey = nearestToGoal(active, play, caught, safe);
          if (prey) {
            const preyBody = play.bodyOf(prey)!;
            stepToward(hunterBody, preyBody.location, BOT_RUN, 0.2);
            if (Math.hypot(preyBody.location.x - hunterBody.location.x, preyBody.location.z - hunterBody.location.z) <= CATCH) catchRunner(prey);
          } else stepBot(hunterBody, 0, 0);
        }
      }
      // Bot runners: for the gold, swerving to their side when the hunter is near and ahead.
      for (const who of active) {
        const body = play.bodyOf(who);
        if (!body || isPlayer(body) || safe.has(who.key) || caught.has(who.key) || tick < (starts.get(who.key) ?? 0)) continue;
        const here = body.location;
        let target: Vector3 = { x: goalX + 2, y: here.y, z: here.z };
        if (hunterBody) {
          const there = hunterBody.location;
          const near = Math.hypot(there.x - here.x, there.z - here.z) < SWERVE && there.x > here.x - 1;
          if (near) {
            const away = here.z === there.z ? (lane.get(who.key) ?? 1) : Math.sign(here.z - there.z);
            target = { x: here.x + 2, y: here.y, z: Math.max(min.z + 1.5, Math.min(min.z + WIDTH + 0.5, here.z + away * 4)) };
          }
        }
        stepToward(body, target, RUNNER_SPEED, 0.1);
      }
      if (tick % 5 === 0) play.status(`Home ${safe.size} of ${needed}, ${secondsText(PLAY_TICKS - tick)}`);
      await scope.wait(1);
    }
    const home = [...safe].filter((key) => runnerKeys.has(key)).length;
    play.say(`${home} of ${runners.length} runners got home.`);
    return { winner: home >= needed ? 1 : 0 };
  },
};

/** The runner still running who's nearest the gold. */
function nearestToGoal(active: readonly Who[], play: Play, caught: ReadonlySet<string>, safe: ReadonlySet<string>): Who | undefined {
  let best: { who: Who; x: number } | undefined;
  for (const who of active) {
    if (caught.has(who.key) || safe.has(who.key)) continue;
    const body: Entity | undefined = play.bodyOf(who);
    if (body && (!best || body.location.x > best.x)) best = { who, x: body.location.x };
  }
  return best?.who;
}
