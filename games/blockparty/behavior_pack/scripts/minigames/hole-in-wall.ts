// Hole in the Wall (FFA; docs/plans/block-party-minigames.md): players stand on a platform over
// water. Walls come at them one after another from the Wall start, each with holes (1 wide, 2 tall,
// at the floor or raised a block to jump into), fewer than players by default. Get in a hole and the
// wall passes around you; a wall that reaches you outside a hole pushes you off the far edge into the
// water (Kill Y), out. Each wall comes faster. Last one in wins; the rest place by when they went
// out. Each wall is blocks moved a layer at a time. Bots walk to the nearest free floor hole's line
// after a moment.
import type { Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, botStep, botWait, everyTick, fellOut, onPlan, placesByOut, setBlock, shuffled } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

const WALL = "minecraft:light_blue_concrete";
/** Ticks before a bot heads for a hole (a Medium bot's: botWait). */
const BOT_REACT = 14;
/** Ticks between walls. */
const BETWEEN = 30;

interface Hole {
  /** Across the wall (x or z), and how high its bottom is over the platform. */
  across: number;
  raised: number;
}

export const HOLE_IN_WALL: MinigameDef = {
  id: "holeinwall",
  name: "Hole in the Wall",
  kind: "ffa",
  rules: "Get into a hole in each wall as it comes, or it pushes you into the water.",
  tutorial: [
    {
      objective: "Walls come at you with holes in them. Stand in a hole (jump into the raised ones) as the wall passes, or it pushes you into the water. Last one in wins.",
      controls: [
        { input: "move", what: "Get in a hole" },
        { input: "jump", what: "Jump into the high ones" },
      ],
    },
  ],
  ...onPlan("holeinwall"),
  problem(field) {
    if (!field.regions(MARKUP.platform)[0]) return "its arena map has no Platform";
    return field.regions(MARKUP.wallStart)[0] ? undefined : "its arena map has no Wall start";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension } = play;
    const platform = field.regions(MARKUP.platform)[0];
    const start = field.regions(MARKUP.wallStart)[0];
    const everyone = play.sides.flat();
    const walls = play.setting("walls");
    const firstSpeed = play.setting("firstSpeed");
    const lastSpeed = play.setting("lastSpeed");
    const holeCount = play.setting("holes");
    // The wall runs across x when it's wider that way (then it moves along z), else across z.
    const acrossX = start.max.x - start.min.x >= start.max.z - start.min.z;
    const lo = acrossX ? start.min.x : start.min.z;
    const hi = acrossX ? start.max.x : start.max.z;
    const from = acrossX ? start.min.z : start.min.x;
    const pMin = acrossX ? platform.min.z : platform.min.x;
    const pMax = acrossX ? platform.max.z : platform.max.x;
    const dir = from <= (pMin + pMax) / 2 ? 1 : -1;
    const to = dir > 0 ? pMax + 1 : pMin - 1;
    const floor = platform.max.y + 1;
    const top = Math.max(start.max.y, floor + 2);
    const floorY = platform.min.y;
    const outAt = new Map<string, number>();
    const react = botWait(play, BOT_REACT);
    let tickAll = 0;
    const layer = (at: number, holes: readonly Hole[], block: string) => {
      for (let a = lo; a <= hi; a++) {
        for (let y = floor; y <= top; y++) {
          const open = holes.some((hole) => hole.across === a && y >= floor + hole.raised && y <= floor + hole.raised + 1);
          const spot = acrossX ? { x: a, y, z: at } : { x: at, y, z: a };
          setBlock(dimension, spot, open && block !== "minecraft:air" ? "minecraft:air" : block);
        }
      }
    };
    const across = (spot: Vector3) => (acrossX ? spot.x : spot.z);
    const along = (spot: Vector3) => (acrossX ? spot.z : spot.x);
    for (let n = 0; n < walls && !scope.disposed; n++) {
      if (everyone.length > 1 ? play.inPlay().length <= 1 : play.inPlay().length === 0) break;
      const speed = firstSpeed + ((lastSpeed - firstSpeed) * n) / Math.max(1, walls - 1);
      const every = Math.max(1, Math.round(20 / speed));
      const spots = shuffled(
        Array.from({ length: hi - lo + 1 }, (_, i) => lo + i),
        play.random,
      ).slice(0, Math.max(1, holeCount));
      const holes: Hole[] = spots.map((a) => ({ across: a, raised: play.random() < 0.3 ? 1 : 0 }));
      play.status(`Wall ${n + 1} of ${walls}`);
      let at = from;
      layer(at, holes, WALL);
      const botHole = new Map<string, Hole>();
      const steps = Math.abs(to - from);
      await everyTick(play, steps * every + 1, (tick) => {
        tickAll++;
        for (const who of play.inPlay()) {
          const body = play.bodyOf(who);
          if (!body) continue;
          if (fellOut(field, body, floorY, 2)) {
            outAt.set(who.key, tickAll);
            play.out(who);
            play.say(`${who.name} went in the water.`);
            continue;
          }
          if (who.player || tick < react) continue;
          // A bot: to a floor hole's line, in front of the wall.
          let hole = botHole.get(who.key);
          if (!hole) {
            const floorHoles = holes.filter((one) => one.raised === 0);
            const choices = floorHoles.length > 0 ? floorHoles : holes;
            hole = choices.reduce((best, one) => (Math.abs(one.across + 0.5 - across(body.location)) < Math.abs(best.across + 0.5 - across(body.location)) ? one : best), choices[0]);
            botHole.set(who.key, hole);
          }
          const line = hole.across + 0.5;
          const spot = acrossX ? { x: line, y: body.location.y, z: body.location.z } : { x: body.location.x, y: body.location.y, z: line };
          botStep(play, who, spot, BOT_WALK, 0.15);
        }
        if (tick % every !== 0 || tick === 0) return;
        // The wall steps on: the old layer cleared, the new one laid, anyone it meets outside a hole pushed off.
        layer(at, holes, "minecraft:air");
        at += dir;
        if (at === to) return true;
        layer(at, holes, WALL);
        for (const who of play.inPlay()) {
          const body = play.bodyOf(who);
          if (!body || Math.floor(along(body.location)) !== at) continue;
          const a = Math.floor(across(body.location));
          const feet = body.location.y;
          const inHole = holes.some((hole) => hole.across === a && feet >= floor + hole.raised - 0.1 && feet <= floor + hole.raised + 0.6);
          if (inHole) continue;
          const behind = acrossX ? { x: body.location.x, y: body.location.y, z: at - dir * 2 } : { x: at - dir * 2, y: body.location.y, z: body.location.z };
          play.push(who, behind, 3.5);
        }
      });
      layer(at, holes, "minecraft:air");
      await scope.wait(BETWEEN);
    }
    return { places: placesByOut(everyone.map((who) => who.key), outAt) };
  },
};
