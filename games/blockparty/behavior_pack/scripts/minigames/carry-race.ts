// Carry Race (2v2, tiled; docs/plans/block-party-minigames.md): one teammate walks a maze carrying
// the other on their head. The walls are too tall for the walker to see over, but the rider sees the
// whole maze: the rider guides the walker over voice, and has four items that call Left, Right,
// Straight and Back (a use shows that word on the walker's own line, with a sound). First team to the
// Finish wins; at time, the team nearer the Finish wins. The rider rides the walker with the players
// pack (private_packs/players) when both are players and it's installed; otherwise the game keeps
// the rider over the walker's head itself. Bots: a walker takes the maze's shortest way; a rider calls
// the next turn.
import { world, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, botWalkTo, clock, everyTick, flat, inside, isPlayer, item, onPlan, tilesOf, walkPath, yawToward } from "./common.ts";
import { middleOf, type Field, type MinigameDef, type Outcome, type Play } from "./kit.ts";

const CALLS = ["Left", "Right", "Straight", "Back"] as const;
/** How high over the walker's feet the rider is kept. */
const RIDE = 1.67;
/** Ticks between a bot rider's calls. */
const BOT_CALL = 40;

/** The rider on the walker's head with the players pack's riding. True when it took. */
function mount(rider: Who, walker: Who): boolean {
  try {
    const rideable = walker.player?.getComponent("minecraft:rideable");
    if (!rideable || !rider.player || !rideable.getFamilyTypes().includes("player")) return false;
    return rideable.addRider(rider.player);
  } catch {
    return false;
  }
}

function dismount(rider: Who): void {
  try {
    rider.player?.getComponent("minecraft:riding")?.entityRidingOn?.getComponent("minecraft:rideable")?.ejectRider(rider.player);
  } catch {
    // gone
  }
}

/** Which way a turn is from a walker's facing to a spot: one of CALLS. */
function turnTo(facing: number, from: Vector3, to: Vector3): (typeof CALLS)[number] {
  const want = yawToward(from, to);
  const turn = ((((want - facing) % 360) + 540) % 360) - 180;
  if (Math.abs(turn) < 45) return "Straight";
  if (Math.abs(turn) > 135) return "Back";
  // Yaw grows turning right (toward -x from facing +z is a left turn by Minecraft's yaw).
  return turn > 0 ? "Right" : "Left";
}

export const CARRY_RACE: MinigameDef = {
  id: "carryrace",
  name: "Carry Race",
  kind: "2v2",
  rules: "The walker carries the rider through a maze. Only the rider sees over the walls: guide them out first.",
  tutorial: [
    {
      objective: "Walker: carry your rider through the maze; you can't see over the walls, so go where they say. Rider: you see the whole maze, call the way. First team out wins.",
      controls: [
        { input: "move", what: "Walker: walk where your rider says" },
        { input: "use", what: "Rider: call a way to your walker" },
      ],
    },
  ],
  ...onPlan("carryrace"),
  problem(field) {
    return field.regions(MARKUP.finish)[0] ? undefined : "its arena map has no Finish";
  },
  spawns(field, sides) {
    const tiles = tilesOf(field);
    return sides.map((count, i) => (tiles[i] ?? tiles[0]).spawns.slice(0, count));
  },
  async play(play: Play): Promise<Outcome> {
    const { scope, sides, field, dimension } = play;
    const tiles = tilesOf(field);
    const mazes: Field[] = sides.map((_, i) => tiles[i] ?? tiles[0]);
    const total = play.setting("playTime") * 20;
    const walkers = sides.map((side) => side[0]);
    const riders = sides.map((side) => side[1]);
    const riding = sides.map((_, s) => (riders[s] ? mount(riders[s]!, walkers[s]) : false));
    scope.add(() => riders.forEach((rider) => rider && dismount(rider)));
    for (const rider of riders) if (rider) CALLS.forEach((call, slot) => play.give(rider, item("minecraft:carrot_on_a_stick", { name: call }), slot));
    const call = (s: number, word: string) => {
      const walker = walkers[s];
      play.tell(walker, `${word}!`, 30);
      const body = play.bodyOf(walker);
      if (body) dimension.playSound("note.pling", body.location, { pitch: CALLS.indexOf(word as never) * 0.2 + 0.8 });
    };
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      const s = riders.findIndex((rider) => rider?.player?.id === source.id);
      if (s < 0 || !itemStack.nameTag || !CALLS.includes(itemStack.nameTag as never)) return;
      call(s, itemStack.nameTag);
    });
    const paths = new Map<string, { path: Vector3[]; at: number }>();
    const lastCall = sides.map(() => 0);
    let winner: number | undefined;
    await everyTick(play, total, (tick) => {
      sides.forEach((_, s) => {
        const maze = mazes[s];
        const finish = maze.regions(MARKUP.finish)[0];
        const walker = walkers[s];
        const body = play.bodyOf(walker);
        if (!body || !finish) return;
        if (inside(finish, body.location, 0.5) || inside(finish, { ...body.location, y: body.location.y - 1 }, 0.5)) {
          winner ??= s;
          return;
        }
        // The rider kept over the walker's head when the pack isn't riding them.
        const rider = riders[s];
        const riderBody = rider && play.bodyOf(rider);
        if (rider && riderBody && !riding[s]) {
          try {
            riderBody.teleport({ x: body.location.x, y: body.location.y + RIDE, z: body.location.z }, { keepVelocity: false });
            if (!rider.player) riderBody.clearVelocity();
          } catch {
            // gone
          }
        }
        const floor = { min: maze.min, max: { x: maze.min.x + maze.size[0] - 1, y: maze.min.y, z: maze.min.z + maze.size[2] - 1 } };
        const standY = Math.floor(maze.spawns[0]?.y ?? maze.min.y + 1);
        const goal = middleOf(finish);
        const target = { x: goal.x, y: standY, z: goal.z };
        // A bot rider calls the next turn of the way out.
        if (rider && riderBody && !isPlayer(riderBody) && tick - lastCall[s] >= BOT_CALL) {
          lastCall[s] = tick;
          const next = walkPath(dimension, floor, standY, body.location, target)[1];
          if (next) call(s, turnTo(body.getRotation().y, body.location, next));
        }
        if (!isPlayer(body)) botWalkTo(play, walker, floor, standY, target, paths, BOT_WALK * 0.8);
      });
      if (tick % 5 === 0) play.status(`${sides.map((side, s) => `${side.map((who) => who.name).join("+")}`).join("  vs  ")}  ${clock(total - tick)}`);
      return winner !== undefined;
    });
    if (winner !== undefined) return { winner };
    const gaps = sides.map((_, s) => {
      const finish = mazes[s].regions(MARKUP.finish)[0];
      const body = play.bodyOf(walkers[s]);
      return body && finish ? Math.round(flat(body.location, middleOf(finish))) : 999;
    });
    return { winner: gaps[0] === gaps[1] ? undefined : gaps[0] < gaps[1] ? 0 : 1 };
  },
};
