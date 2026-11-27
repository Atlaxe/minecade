// Quiz Floor (FFA; docs/plans/block-party-minigames.md): a question shows in the dialogue box with 4
// answers, each over one of 4 colored pads (red, blue, yellow, green). Stand on your answer; jump on
// it to lock it in. When time's up every right answer scores, more for a faster lock (10 points, and
// up to 10 more for speed); an answer never locked counts for the pad you're on, with no speed
// points. The right pad lights up. Most points after the questions wins. The questions are the
// user's, games/blockparty/minigames/quiz.json. Bots are right about 60% of the time, locking in
// after 2 to 6 seconds (a Medium bot; the lobby's level moves both).
import { ButtonState, InputButton, world } from "@minecraft/server";
import file from "../../../minigames/quiz.json";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, blocksOf, botJump, botOdds, botStep, botWait, clock, everyTick, onPlan, placesBy, setBlock, shuffled, spotIn } from "./common.ts";
import { inOrder, over, type MinigameDef, type Outcome, type Play } from "./kit.ts";

export const QUESTIONS: readonly { question: string; answers: string[]; right: number }[] = file.questions;
const PADS = ["§cRed", "§9Blue", "§eYellow", "§aGreen"] as const;
/** Ticks the right pad stays lit, and between questions. */
const REVEAL = 50;

export const QUIZ: MinigameDef = {
  id: "quiz",
  name: "Quiz Floor",
  kind: "ffa",
  rules: "Stand on the pad of the right answer, and jump to lock it in. Faster locks score more.",
  tutorial: [
    {
      objective: "A question comes with 4 answers, one over each pad. Stand on the right one and jump to lock it in: a faster lock scores more.",
      controls: [
        { input: "move", what: "Stand on your answer" },
        { input: "jump", what: "Lock it in" },
      ],
    },
  ],
  ...onPlan("quiz"),
  problem(field) {
    return field.regions(MARKUP.answers).length >= 4 ? undefined : "its arena map needs 4 Answer pads";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension } = play;
    const pads = field.regions(MARKUP.answers).slice(0, 4);
    const everyone = play.sides.flat();
    const answerTime = play.setting("answerTime") * 20;
    const count = Math.min(play.setting("questions"), QUESTIONS.length);
    const points = new Map(everyone.map((who) => [who.key, 0]));
    const padOf = (who: (typeof everyone)[number]) => {
      const body = play.bodyOf(who);
      return body ? pads.findIndex((pad) => over(pad, body.location, 1, 3)) : -1;
    };
    let locks = new Map<string, { pad: number; tick: number }>();
    let tickNow = 0;
    let open = false;
    scope.subscribe(world.afterEvents.playerButtonInput, ({ player, button, newButtonState }) => {
      if (!open || button !== InputButton.Jump || newButtonState !== ButtonState.Pressed) return;
      const who = everyone.find((one) => one.player?.id === player.id);
      if (!who || locks.has(who.key)) return;
      const pad = padOf(who);
      if (pad >= 0) {
        locks.set(who.key, { pad, tick: tickNow });
        play.tell(who, `Locked in: ${PADS[pad]}`, 40);
      }
    });
    for (const [n, q] of shuffled(QUESTIONS, play.random).slice(0, count).entries()) {
      if (scope.disposed) break;
      locks = new Map();
      open = true;
      play.notice(`${q.question}\n${q.answers.map((answer, i) => `${PADS[i]}§r ${answer}`).join("   ")}`, answerTime + 10);
      const botPlan = new Map(everyone.filter((who) => !who.player).map((who) => [who.key, { pad: play.random() < botOdds(play, 0.6) ? q.right : Math.floor(play.random() * 4), at: botWait(play, 40 + Math.floor(play.random() * 80)) }]));
      const botSpot = new Map([...botPlan].map(([key, plan]) => [key, spotIn(pads[plan.pad], play.random, 1)]));
      await everyTick(play, answerTime, (tick) => {
        tickNow = tick;
        for (const who of play.inPlay()) {
          if (who.player || locks.has(who.key)) continue;
          const plan = botPlan.get(who.key);
          const spot = botSpot.get(who.key);
          if (!plan || !spot) continue;
          const there = botStep(play, who, spot, BOT_WALK, 0.6);
          if (there && tick >= plan.at) {
            const body = play.bodyOf(who);
            if (body) botJump(body);
            locks.set(who.key, { pad: plan.pad, tick });
          }
        }
        if (tick % 5 === 0) play.status(`Question ${n + 1} of ${count}  ${clock(answerTime - tick)}`);
      });
      open = false;
      // Score: a right lock 10 and up to 10 for speed; standing on the right pad unlocked, 10.
      for (const who of everyone) {
        const lock = locks.get(who.key);
        const pad = lock?.pad ?? padOf(who);
        if (pad !== q.right) continue;
        const speed = lock ? Math.round(10 * (1 - lock.tick / answerTime)) : 0;
        points.set(who.key, (points.get(who.key) ?? 0) + 10 + speed);
      }
      // The right pad lights up.
      const right = pads[q.right];
      const floor = blocksOf({ min: right.min, max: { ...right.max, y: right.min.y } });
      const before = floor.map((at) => blockId(dimension, at));
      for (const at of floor) setBlock(dimension, at, "minecraft:sea_lantern");
      play.notice(`${PADS[q.right]}§r: ${q.answers[q.right]}`, REVEAL);
      play.status(everyone.map((who) => `${who.name} ${points.get(who.key)}`).join("  "));
      await scope.wait(REVEAL);
      floor.forEach((at, i) => setBlock(dimension, at, before[i] || "minecraft:white_concrete"));
    }
    return { places: placesBy(everyone.map((who) => who.key), (key) => points.get(key) ?? 0) };
  },
};
