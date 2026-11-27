// Co-op Painters (2v2): a floor to paint. Every block of it a player walks over takes their team's
// color, Red or Blue, and the team with the most floor when time runs out wins. Bots head for floor
// that isn't their color yet, the nearest of a few spots they look at.
// Its arena map (arenas.ts) marks the Floor box (its lowest layer is what gets painted: build it
// in any one block, flat) and Red and Blue team spawns, 2 each. Its test arena is a white floor
// inside a low glass wall.
import type { Vector3 } from "@minecraft/server";
import { BOT_WALK, isPlayer, stepToward } from "../bots.ts";
import { MARKUP, PAINTER_TEAMS } from "./arenas.ts";
import { botPace } from "./common.ts";
import { at, fill, secondsText, spread, testField, type Field, type MinigameDef, type Outcome, type Play, type WorldBox } from "./kit.ts";

/** The test arena: the floor's width each way, its corner from the arena's, and its height. */
const FLOOR = 20;
const EDGE = 2;
const FLOOR_Y = 1;
const WHITE = "minecraft:white_concrete";
/** Each side's color, as its team (arenas.ts) is keyed: Red, then Blue. */
const TEAMS = [
  { block: "minecraft:red_concrete", name: "§cRed" },
  { block: "minecraft:blue_concrete", name: "§9Blue" },
] as const;
const PLAY_TICKS = 600;
/** Spots a bot looks at before picking where to paint next. */
const LOOKS = 6;

function floorOf(field: Field): WorldBox | undefined {
  return field.regions(MARKUP.floor)[0];
}

export const PAINTERS: MinigameDef = {
  id: "painters",
  name: "Co-op Painters",
  kind: "2v2",
  rules: "Walk over the floor to paint it your team's color. The team with the most floor wins.",
  tutorial: [
    {
      objective: "Walk over the floor to paint it your team's color. The team with the most floor at the end wins.",
      controls: [{ input: "move", what: "Paint where you walk" }],
    },
  ],
  size: [FLOOR + EDGE * 2, 6, FLOOR + EDGE * 2],
  build(dimension, min) {
    const floor = { x: min.x + EDGE, y: min.y + FLOOR_Y, z: min.z + EDGE };
    const far = { x: floor.x + FLOOR - 1, y: floor.y, z: floor.z + FLOOR - 1 };
    // A glass wall two high around the floor, then the floor.
    fill(dimension, { x: floor.x - 1, y: floor.y, z: floor.z - 1 }, { x: far.x + 1, y: floor.y + 2, z: far.z + 1 }, "minecraft:glass");
    fill(dimension, { x: floor.x, y: floor.y + 1, z: floor.z }, { x: far.x, y: floor.y + 2, z: far.z }, "minecraft:air");
    fill(dimension, floor, far, WHITE);
  },
  testField(min) {
    const floor = { min: { x: min.x + EDGE, y: min.y + FLOOR_Y, z: min.z + EDGE }, max: { x: min.x + EDGE + FLOOR - 1, y: min.y + FLOOR_Y, z: min.z + EDGE + FLOOR - 1 } };
    const red = spread(at(min, EDGE + 4, FLOOR_Y + 1, EDGE + 1), at(min, EDGE + FLOOR - 5, FLOOR_Y + 1, EDGE + 1), 2);
    const blue = spread(at(min, EDGE + 4, FLOOR_Y + 1, EDGE + FLOOR - 2), at(min, EDGE + FLOOR - 5, FLOOR_Y + 1, EDGE + FLOOR - 2), 2);
    return testField(min, this.size, { teamSpawns: { [PAINTER_TEAMS[0].id]: red, [PAINTER_TEAMS[1].id]: blue }, regions: { [MARKUP.floor]: [floor] } });
  },
  problem(field) {
    return floorOf(field) ? undefined : "its arena map has no Floor box";
  },
  spawns(field, sides) {
    return sides.map((count, side) => field.teamSpawns(PAINTER_TEAMS[side]?.id ?? "").slice(0, count));
  },
  async play(play: Play): Promise<Outcome> {
    const { dimension, field, scope, sides } = play;
    const floor = floorOf(field)!;
    const floorY = floor.min.y;
    const x0 = floor.min.x;
    const z0 = floor.min.z;
    const width = floor.max.x - x0 + 1;
    const depth = floor.max.z - z0 + 1;
    // One notice for everyone (no titles): who paints for which team.
    play.notice(`Paint!\n${sides.map((members, side) => `${TEAMS[side].name}§r: ${members.map((who) => who.name).join(" and ")}`).join("   ")}`);
    /** Each floor block's team (by x * depth + z), -1 while unpainted. */
    const painted = new Int8Array(width * depth).fill(-1);
    const counts = [0, 0];
    const sideOf = new Map(sides.flatMap((side, index) => side.map((who) => [who.key, index] as const)));
    const targets = new Map<string, Vector3>();
    const pickTarget = (key: string, from: Vector3, side: number): Vector3 => {
      let best: { spot: Vector3; score: number } | undefined;
      for (let i = 0; i < LOOKS; i++) {
        const fx = Math.floor(play.random() * width);
        const fz = Math.floor(play.random() * depth);
        const spot = { x: x0 + fx + 0.5, y: floorY + 1, z: z0 + fz + 0.5 };
        const score = Math.hypot(spot.x - from.x, spot.z - from.z) + (painted[fx * depth + fz] === side ? 30 : 0);
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
          if (stepToward(body, target, botPace(play, BOT_WALK))) pickTarget(who.key, body.location, side);
        }
        const fx = Math.floor(body.location.x) - x0;
        const fz = Math.floor(body.location.z) - z0;
        if (fx < 0 || fz < 0 || fx >= width || fz >= depth || Math.abs(body.location.y - (floorY + 1)) > 1.2) continue;
        const index = fx * depth + fz;
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
