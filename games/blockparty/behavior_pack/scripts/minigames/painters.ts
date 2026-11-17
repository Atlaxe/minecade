// Co-op Painters (2v2): a white floor inside a low glass wall. Every block a player walks over takes
// their team's color, Red or Blue, and the team with the most floor when time runs out wins. Bots
// head for floor that isn't their color yet, the nearest of a few spots they look at.
import type { Vector3 } from "@minecraft/server";
import { BOT_WALK, isPlayer, stepToward } from "../bots.ts";
import { at, fill, secondsText, spread, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** The floor's width each way, its corner from the arena's, and its height. */
const FLOOR = 20;
const EDGE = 2;
const FLOOR_Y = 1;
const WHITE = "minecraft:white_concrete";
const TEAMS = [
  { block: "minecraft:red_concrete", name: "§cRed" },
  { block: "minecraft:blue_concrete", name: "§9Blue" },
] as const;
const PLAY_TICKS = 600;
/** Spots a bot looks at before picking where to paint next. */
const LOOKS = 6;

export const PAINTERS: MinigameDef = {
  id: "painters",
  name: "Co-op Painters",
  kind: "2v2",
  rules: "Walk over the floor to paint it your team's color. The team with the most floor wins.",
  size: [FLOOR + EDGE * 2, 6, FLOOR + EDGE * 2],
  build(dimension, min) {
    const floor = { x: min.x + EDGE, y: min.y + FLOOR_Y, z: min.z + EDGE };
    const far = { x: floor.x + FLOOR - 1, y: floor.y, z: floor.z + FLOOR - 1 };
    // A glass wall two high around the floor, then the floor.
    fill(dimension, { x: floor.x - 1, y: floor.y, z: floor.z - 1 }, { x: far.x + 1, y: floor.y + 2, z: far.z + 1 }, "minecraft:glass");
    fill(dimension, { x: floor.x, y: floor.y + 1, z: floor.z }, { x: far.x, y: floor.y + 2, z: far.z }, "minecraft:air");
    fill(dimension, floor, far, WHITE);
  },
  spawns(min, sides) {
    const near = { a: at(min, EDGE + 4, FLOOR_Y + 1, EDGE + 1), b: at(min, EDGE + FLOOR - 5, FLOOR_Y + 1, EDGE + 1) };
    const far = { a: at(min, EDGE + 4, FLOOR_Y + 1, EDGE + FLOOR - 2), b: at(min, EDGE + FLOOR - 5, FLOOR_Y + 1, EDGE + FLOOR - 2) };
    return sides.map((count, side) => (side === 0 ? spread(near.a, near.b, count) : spread(far.a, far.b, count)));
  },
  async play(play: Play): Promise<Outcome> {
    const { dimension, min, scope, sides } = play;
    const floorY = min.y + FLOOR_Y;
    const x0 = min.x + EDGE;
    const z0 = min.z + EDGE;
    play.titleEach("Paint!", (key) => {
      const side = sides.findIndex((members) => members.some((who) => who.key === key));
      return side < 0 ? "" : `You're ${TEAMS[side].name}`;
    });
    /** Each floor block's team (by x * FLOOR + z), -1 while white. */
    const painted = new Int8Array(FLOOR * FLOOR).fill(-1);
    const counts = [0, 0];
    const sideOf = new Map(sides.flatMap((side, index) => side.map((who) => [who.key, index] as const)));
    const targets = new Map<string, Vector3>();
    const pickTarget = (key: string, from: Vector3, side: number): Vector3 => {
      let best: { spot: Vector3; score: number } | undefined;
      for (let i = 0; i < LOOKS; i++) {
        const fx = Math.floor(play.random() * FLOOR);
        const fz = Math.floor(play.random() * FLOOR);
        const spot = { x: x0 + fx + 0.5, y: floorY + 1, z: z0 + fz + 0.5 };
        const score = Math.hypot(spot.x - from.x, spot.z - from.z) + (painted[fx * FLOOR + fz] === side ? 30 : 0);
        if (!best || score < best.score) best = { spot, score };
      }
      const spot = best!.spot;
      targets.set(key, spot);
      return spot;
    };
    for (let tick = 0; tick < PLAY_TICKS && !scope.disposed; tick++) {
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        const side = sideOf.get(who.key);
        if (!body || side === undefined) continue;
        if (!isPlayer(body)) {
          const target = targets.get(who.key) ?? pickTarget(who.key, body.location, side);
          if (stepToward(body, target, BOT_WALK)) pickTarget(who.key, body.location, side);
        }
        const fx = Math.floor(body.location.x) - x0;
        const fz = Math.floor(body.location.z) - z0;
        if (fx < 0 || fz < 0 || fx >= FLOOR || fz >= FLOOR || Math.abs(body.location.y - (floorY + 1)) > 1.2) continue;
        const index = fx * FLOOR + fz;
        if (painted[index] === side) continue;
        if (painted[index] >= 0) counts[painted[index]]--;
        painted[index] = side;
        counts[side]++;
        try {
          dimension.getBlock({ x: x0 + fx, y: floorY, z: z0 + fz })?.setType(TEAMS[side].block);
        } catch {
          // unloaded
        }
      }
      if (tick % 5 === 0) play.status(`${TEAMS[0].name} ${counts[0]}  ${TEAMS[1].name} ${counts[1]}  §f${secondsText(PLAY_TICKS - tick)}`);
      await scope.wait(1);
    }
    play.say(`Red painted ${counts[0]} blocks, Blue ${counts[1]}.`);
    return { winner: counts[0] === counts[1] ? undefined : counts[0] > counts[1] ? 0 : 1 };
  },
};
