// Trap Master (1v3; docs/plans/block-party-minigames.md): the trio cross a gauntlet to the Finish.
// The solo watches from a booth and hits levers, each springing its trap, the lever then waiting a
// few seconds. Four kinds of trap: drop (the floor in its box drops away for a moment), vanish (every
// block in its box vanishes for a moment), TNT (a lit TNT drops into its box and blows, throwing
// runners near it: a push, breaking nothing), water (water pours over its box for a moment). The nth
// lever of a kind works the nth trap of that kind. A runner who falls (Kill Y) or touches water goes
// back to the start. The runners win if at least half get through before time; else the master.
// Bots: the master springs the trap a runner is on after a moment; runners walk at the Finish,
// hopping gaps.
import { world, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, blocksOf, botArm, botLook, botOdds, botRun, botWait, clock, everyTick, fellOut, inside, isPlayer, moveTo, now, onPlan, setBlock, spawnIn, removeEntity } from "./common.ts";
import { middleOf, over, type MinigameDef, type Outcome, type Play, type WorldBox } from "./kit.ts";

const KINDS = ["drop", "vanish", "tnt", "water"] as const;
type Kind = (typeof KINDS)[number];
const TRAPS: Record<Kind, string> = { drop: MARKUP.dropTraps, vanish: MARKUP.vanishTraps, tnt: MARKUP.tntTraps, water: MARKUP.waterTraps };
const LEVERS: Record<Kind, string> = { drop: MARKUP.dropLevers, vanish: MARKUP.vanishLevers, tnt: MARKUP.tntLevers, water: MARKUP.waterLevers };
/** Ticks a TNT falls before it blows. */
const FUSE = 30;
/** Ticks a bot master waits before it springs a trap a runner is on (a Medium bot's: botWait). */
const BOT_REACT = 10;

interface Trap {
  kind: Kind;
  box: WorldBox;
  lever: Vector3;
  /** When its lever works again (system tick). */
  ready: number;
  /** The blocks it took away, to put back. */
  taken?: { at: Vector3; id: string }[];
}

export const TRAP_MASTER: MinigameDef = {
  id: "trapmaster",
  name: "Trap Master",
  kind: "1v3",
  rules: "Runners: cross the gauntlet to the Finish. Master: spring the traps from your booth.",
  tutorial: [
    {
      objective: "Hit the levers in your booth to spring the traps on the runners. Stop half of them from reaching the Finish and you win.",
      controls: [{ input: "attack", what: "Hit a lever to spring its trap" }],
    },
    {
      objective: "Cross the gauntlet to the Finish. A fall or a touch of water sends you back to the start. Half of you through wins it.",
      controls: [
        { input: "move", what: "Run the course" },
        { input: "jump", what: "Jump the gaps" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("trapmaster"),
  problem(field) {
    if (!field.regions(MARKUP.finish)[0]) return "its arena map has no Finish";
    return field.points(MARKUP.master)[0] ? undefined : "its arena map has no Master spawn";
  },
  spawns(field, sides) {
    return [field.points(MARKUP.master).slice(0, sides[0] ?? 1), field.points(MARKUP.runners).slice(0, sides[1] ?? 0)];
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides, dimension } = play;
    const [masters, runners] = sides;
    const master = masters[0];
    const finish = field.regions(MARKUP.finish)[0];
    const goal = middleOf(finish);
    const starts = field.points(MARKUP.runners);
    const total = play.setting("playTime") * 20;
    const open = Math.max(5, play.setting("open") * 2);
    const cooldown = play.setting("cooldown") * 20;
    const radius = play.setting("tntRadius");
    const needed = Math.ceil(runners.length / 2);
    const traps: Trap[] = KINDS.flatMap((kind) => {
      const boxes = field.regions(TRAPS[kind]);
      const levers = field.points(LEVERS[kind]);
      return boxes.flatMap((box, i) => (levers[i] ? [{ kind, box, lever: levers[i], ready: 0 }] : []));
    });
    for (const trap of traps) setBlock(dimension, trap.lever, "minecraft:lever", { lever_direction: "up_north_south" });
    const floorY = Math.min(...starts.map((spot) => spot.y)) - 1;
    const safe = new Set<string>();
    const startOf = (who: Who) => starts[runners.indexOf(who)] ?? starts[0];
    const sendBack = (who: Who, why: string) => {
      moveTo(who, play.bodyOf(who), startOf(who));
      play.tell(who, `${why} Back to the start.`);
    };
    const end = (trap: Trap) => {
      for (const block of trap.taken ?? []) setBlock(dimension, block.at, block.id);
      trap.taken = undefined;
      if (trap.kind === "water") {
        // The water and its flow, in and around the box.
        const around = { min: { x: trap.box.min.x - 3, y: trap.box.min.y - 2, z: trap.box.min.z - 3 }, max: { x: trap.box.max.x + 3, y: trap.box.max.y, z: trap.box.max.z + 3 } };
        for (const at of blocksOf(around)) if (blockId(dimension, at).includes("water")) setBlock(dimension, at, "minecraft:air");
      }
    };
    const spring = (trap: Trap) => {
      if (now() < trap.ready) return;
      trap.ready = now() + cooldown;
      dimension.playSound("random.click", trap.lever);
      if (trap.kind === "drop" || trap.kind === "vanish") {
        const blocks = trap.kind === "drop" ? blocksOf({ min: trap.box.min, max: { ...trap.box.max, y: trap.box.min.y } }) : blocksOf(trap.box);
        trap.taken = blocks.map((at) => ({ at, id: blockId(dimension, at) })).filter((block) => block.id !== "minecraft:air" && block.id !== "");
        for (const block of trap.taken) setBlock(dimension, block.at, "minecraft:air");
        scope.timeout(() => end(trap), open);
      } else if (trap.kind === "water") {
        for (const at of blocksOf({ min: { ...trap.box.min, y: trap.box.max.y }, max: trap.box.max })) setBlock(dimension, at, "minecraft:water");
        scope.timeout(() => end(trap), open);
      } else {
        const middle = middleOf(trap.box);
        const tnt = spawnIn(play, "minecraft:tnt", { x: middle.x, y: trap.box.max.y + 3, z: middle.z });
        scope.timeout(() => {
          const at = tnt?.isValid ? tnt.location : middle;
          removeEntity(tnt);
          try {
            dimension.spawnParticle("minecraft:huge_explosion_emitter", at);
          } catch {
            // unloaded
          }
          dimension.playSound("random.explode", at, { volume: 2 });
          for (const who of runners) {
            const body = play.bodyOf(who);
            if (body && !play.isOut(who) && Math.hypot(body.location.x - at.x, body.location.y - at.y, body.location.z - at.z) <= radius) play.push(who, at, 2.5);
          }
        }, FUSE);
      }
    };
    const leverAt = (at: Vector3) => traps.find((trap) => Math.floor(trap.lever.x) === at.x && Math.floor(trap.lever.y) === at.y && Math.floor(trap.lever.z) === at.z);
    const byMaster = (id: string) => play.bodyOf(master)?.id === id;
    scope.subscribe(world.afterEvents.entityHitBlock, ({ damagingEntity, hitBlock }) => {
      const trap = leverAt(hitBlock.location);
      if (trap && byMaster(damagingEntity.id)) spring(trap);
    });
    scope.subscribe(world.afterEvents.playerInteractWithBlock, ({ player, block }) => {
      const trap = leverAt(block.location);
      if (trap && byMaster(player.id)) spring(trap);
    });
    play.notice(`${master.name} springs the traps. The rest: reach the Finish, ${needed} through wins.`);
    const reactEvery = botWait(play, BOT_REACT);
    await everyTick(play, total, (tick) => {
      for (const who of runners) {
        if (safe.has(who.key) || play.isOut(who)) continue;
        const body = play.bodyOf(who);
        if (!body) continue;
        const at = body.location;
        if (over(finish, at, 1, 3)) {
          safe.add(who.key);
          play.say(`${who.name} made it through.`);
          continue;
        }
        if (fellOut(field, body, floorY, 2)) sendBack(who, "You fell!");
        else if (blockId(dimension, at).includes("water") || blockId(dimension, { x: at.x, y: at.y + 1, z: at.z }).includes("water")) sendBack(who, "Water!");
        else if (!isPlayer(body)) botRun(play, who, { x: goal.x, y: goal.y, z: goal.z }, BOT_WALK * 0.9, 0.6);
      }
      // A bot master springs the trap a runner has been on for a moment.
      const masterBody = play.bodyOf(master);
      if (masterBody && !isPlayer(masterBody) && tick % reactEvery === 0) {
        for (const trap of traps) {
          const caught = runners.some((who) => {
            const body = play.bodyOf(who);
            return body && !safe.has(who.key) && inside(trap.box, body.location, trap.kind === "tnt" ? 1 : 0.5);
          });
          if (caught && play.random() < botOdds(play, 0.6)) {
            // Its lever pulled, as a player hits it.
            botLook(play, master, trap.lever);
            botArm(play, master);
            spring(trap);
          }
        }
      }
      if (tick % 5 === 0) play.status(`Through ${safe.size} of ${needed}  ${clock(total - tick)}`);
      return safe.size >= needed;
    });
    for (const trap of traps) end(trap);
    return { winner: safe.size >= needed ? 1 : 0 };
  },
};
