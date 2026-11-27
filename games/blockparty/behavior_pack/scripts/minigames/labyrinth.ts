// Labyrinth (1v3; docs/plans/block-party-minigames.md): a maze with walls 2 blocks tall. The trio
// start at one side and must reach the Exit; the hunter chases them with a camera high over their own
// head that sees over every wall, and catches a runner with a hit (out). The trio win only if enough
// of them (all, by default) get out before time, so a single catch can win it for the hunter. The
// game builds a random maze in the Maze box each time (a map with Maze off keeps its own). Bots: the
// hunter takes the maze's shortest way to the nearest runner; runners take it to the exit.
import { world, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_RUN, BOT_WALK, botWalkTo, clock, everyTick, flat, isPlayer, onPlan, setBlock, shuffled } from "./common.ts";
import { middleOf, over, type MinigameDef, type Outcome, type Play, type WorldBox } from "./kit.ts";

const WALL = "minecraft:stone_bricks";
/** How close a bot hunter gets to catch. */
const CATCH = 1.4;

/** Lays a random maze in a box (cells on even steps from its corner, walls between), two blocks tall from its floor. */
function buildMaze(play: Play, box: WorldBox): void {
  const w = box.max.x - box.min.x + 1;
  const d = box.max.z - box.min.z + 1;
  const y0 = box.min.y;
  const cw = Math.floor((w + 1) / 2);
  const cd = Math.floor((d + 1) / 2);
  const open = new Uint8Array(w * d);
  const seen = new Uint8Array(cw * cd);
  const stack: [number, number][] = [[0, 0]];
  seen[0] = 1;
  open[0] = 1;
  while (stack.length > 0) {
    const [cx, cz] = stack[stack.length - 1];
    const next = shuffled(
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const,
      play.random,
    ).find(([dx, dz]) => cx + dx >= 0 && cz + dz >= 0 && cx + dx < cw && cz + dz < cd && !seen[(cx + dx) * cd + cz + dz]);
    if (!next) {
      stack.pop();
      continue;
    }
    const [dx, dz] = next;
    const nx = cx + dx;
    const nz = cz + dz;
    seen[nx * cd + nz] = 1;
    // The cell and the wall between it and the last one open.
    open[nx * 2 * d + nz * 2] = 1;
    open[(cx * 2 + dx) * d + (cz * 2 + dz)] = 1;
    stack.push([nx, nz]);
  }
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      const block = open[x * d + z] ? "minecraft:air" : WALL;
      setBlock(play.dimension, { x: box.min.x + x, y: y0, z: box.min.z + z }, block);
      setBlock(play.dimension, { x: box.min.x + x, y: y0 + 1, z: box.min.z + z }, block);
    }
  }
}

/** Clears a spot (two tall) and its four neighbors, so it joins the maze. */
function clearAround(play: Play, at: Vector3, y0: number): void {
  for (const [dx, dz] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    for (const dy of [0, 1]) setBlock(play.dimension, { x: Math.floor(at.x) + dx, y: y0 + dy, z: Math.floor(at.z) + dz }, "minecraft:air");
  }
}

export const LABYRINTH: MinigameDef = {
  id: "labyrinth",
  name: "Labyrinth",
  kind: "1v3",
  rules: "Runners: all of you out of the maze before time. Hunter: catch one with a hit.",
  tutorial: [
    {
      objective: "You see the maze from high over your head. Catch a runner with a hit before they all get out.",
      controls: [
        { input: "move", what: "Chase them; you see over the walls" },
        { input: "attack", what: "Catch" },
      ],
    },
    {
      objective: "Find the way out of the maze: all of you must get out before time, and the hunter sees over the walls.",
      controls: [
        { input: "move", what: "Find the exit" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("labyrinth"),
  problem(field) {
    if (!field.regions(MARKUP.exit)[0]) return "its arena map has no Exit";
    return field.points(MARKUP.hunter)[0] ? undefined : "its arena map has no Hunter spawn";
  },
  spawns(field, sides) {
    return [field.points(MARKUP.hunter).slice(0, sides[0] ?? 1), field.points(MARKUP.runners).slice(0, sides[1] ?? 0)];
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides } = play;
    const [hunters, runners] = sides;
    const hunter = hunters[0];
    const exit = field.regions(MARKUP.exit)[0];
    const goal = middleOf(exit);
    const maze = field.regions(MARKUP.maze)[0];
    const total = play.setting("playTime") * 20;
    const headStart = play.setting("headStart") * 20;
    const needed = Math.min(play.setting("needed"), runners.length);
    const height = play.setting("cameraHeight");
    const standY = Math.floor(field.points(MARKUP.runners)[0]?.y ?? field.min.y + 1);
    if (maze) {
      buildMaze(play, maze);
      for (const spot of [...field.points(MARKUP.hunter), ...field.points(MARKUP.runners)]) clearAround(play, spot, maze.min.y);
      for (let x = exit.min.x; x <= exit.max.x; x++) for (let z = exit.min.z; z <= exit.max.z; z++) clearAround(play, { x, y: 0, z }, maze.min.y);
    }
    const area: WorldBox = maze ?? { min: field.min, max: { x: field.min.x + field.size[0] - 1, y: field.min.y, z: field.min.z + field.size[2] - 1 } };
    const out = new Set<string>();
    const free = new Set<string>();
    const catchRunner = (who: Who) => {
      if (out.has(who.key) || free.has(who.key)) return;
      out.add(who.key);
      play.out(who);
      play.say(`${hunter.name} caught ${who.name}.`);
    };
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (!isPlayer(damagingEntity) || play.bodyOf(hunter)?.id !== damagingEntity.id) return;
      const who = runners.find((one) => play.bodyOf(one)?.id === hitEntity.id);
      if (who) catchRunner(who);
    });
    play.freeze(hunter, headStart);
    const paths = new Map<string, { path: Vector3[]; at: number }>();
    play.notice(`Run! ${needed === runners.length ? "All of you" : `${needed} of you`} must get out.`);
    await everyTick(play, total, (tick) => {
      // The hunter's camera, high over their head.
      const hunterBody = play.bodyOf(hunter);
      if (hunterBody && hunter.player && tick % 2 === 0) {
        try {
          const at = hunterBody.location;
          hunter.player.camera.setCamera("minecraft:free", { location: { x: at.x, y: at.y + height, z: at.z - height * 0.35 }, facingLocation: { x: at.x, y: at.y, z: at.z }, easeOptions: { easeTime: 0.12 } });
        } catch {
          // gone
        }
      }
      for (const who of runners) {
        if (out.has(who.key) || free.has(who.key)) continue;
        const body = play.bodyOf(who);
        if (!body) continue;
        if (over(exit, body.location, 1, 3)) {
          free.add(who.key);
          play.say(`${who.name} got out.`);
          continue;
        }
        if (!isPlayer(body)) botWalkTo(play, who, area, standY, goal, paths, BOT_WALK * 0.95);
      }
      if (hunterBody && !isPlayer(hunterBody) && tick >= headStart) {
        const prey = runners.filter((who) => !out.has(who.key) && !free.has(who.key)).map((who) => ({ who, body: play.bodyOf(who) })).filter((one) => one.body).sort((a, b) => flat(a.body!.location, hunterBody.location) - flat(b.body!.location, hunterBody.location))[0];
        if (prey?.body) {
          if (flat(prey.body.location, hunterBody.location) < CATCH) catchRunner(prey.who);
          else botWalkTo(play, hunter, area, standY, prey.body.location, paths, BOT_RUN * 0.9);
        }
      }
      if (tick % 5 === 0) play.status(`Out ${free.size} of ${needed}  ${clock(total - tick)}`);
      return free.size >= needed || runners.length - out.size < needed;
    });
    return { winner: free.size >= needed ? 1 : 0 };
  },
};
