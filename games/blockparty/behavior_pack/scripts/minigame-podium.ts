// The minigame podium (docs/plans/block-party.md, "The minigame podium"; the user, 2026-11-18): after
// a minigame its players go to the podium marked on the arena map (arenas.ts, "Minigame podium": 4
// spots, 1st place to 4th), best first, and the results play there through the podium camera: the
// coins each wins drop in over their head (and a duel's stake flies from the loser to the winner),
// the winners celebrate and those who came away with nothing are sad, each holding their pose
// (moves.ts, hold) until everyone goes back to the board. A duel's stake is never a board hand-over
// (handovers.ts): the podium is where a minigame's results show (the user, 2026-11-20).
// Pure, so the tests can check who stands where and the shot.
import type { Field, Outcome, Spot } from "./minigames/kit.ts";
import { MARKUP } from "./minigames/arenas.ts";

/** A point in the world. */
export interface Point {
  x: number;
  y: number;
  z: number;
}

/** The camera on the podium: where it stands, and either its own facing or the point it looks at. */
export interface PodiumShot {
  location: Point;
  rotation?: { x: number; y: number };
  facing?: Point;
}

export interface PodiumLayout {
  /** Where each place stands, 1st first, and the way they face. */
  spots: Required<Pick<Spot, "x" | "y" | "z" | "yaw">>[];
  shot: PodiumShot;
  /** Whether the arena map marks a podium (else the stand-in podium's spots). */
  marked: boolean;
}

/** How far in front of the podium the camera stands when the map has no podium camera, at the least, and how high. */
const SHOT_BACK = 6;
const SHOT_UP = 2.2;
/** The height on a player the shot looks at. */
const CHEST = 1.1;

/**
 * Who stands where on the podium, best first, as groups tied for a place: an FFA's places (anyone
 * the outcome left out, a player who left, last), a team minigame's winning side and then the rest,
 * or everyone together after a draw.
 */
export function podiumPlaces(sides: readonly (readonly string[])[], outcome: Outcome): string[][] {
  const everyone = sides.flat();
  if ("places" in outcome) {
    const placed = new Set(outcome.places.flat());
    const rest = everyone.filter((key) => !placed.has(key));
    return [...outcome.places.filter((group) => group.length > 0).map((group) => [...group]), ...(rest.length > 0 ? [rest] : [])];
  }
  if (outcome.winner === undefined) return everyone.length > 0 ? [everyone] : [];
  const won = sides[outcome.winner] ?? [];
  const lost = sides.filter((_, index) => index !== outcome.winner).flat();
  return [[...won], lost].filter((group) => group.length > 0);
}

/** The podium's order as one list, each key on the next spot: ties stand side by side in the order they're given. */
export function podiumOrder(places: readonly (readonly string[])[]): string[] {
  return places.flat();
}

/** The yaw from `from` toward `to` (Minecraft's: 0 looks south, +z; 90 west, -x). */
export function yawToward(from: Point, to: Point): number {
  return (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
}

/** The middle of some points. */
function middleOf(points: readonly Point[]): Point {
  const n = points.length || 1;
  return { x: points.reduce((sum, at) => sum + at.x, 0) / n, y: points.reduce((sum, at) => sum + at.y, 0) / n, z: points.reduce((sum, at) => sum + at.z, 0) / n };
}

/** The average of some yaws, by their directions (undefined when they cancel out or there are none). */
function meanYaw(yaws: readonly number[]): number | undefined {
  if (yaws.length === 0) return undefined;
  const x = yaws.reduce((sum, yaw) => sum - Math.sin((yaw * Math.PI) / 180), 0);
  const z = yaws.reduce((sum, yaw) => sum + Math.cos((yaw * Math.PI) / 180), 0);
  if (Math.hypot(x, z) < 1e-6) return undefined;
  return (Math.atan2(-x, z) * 180) / Math.PI;
}

/** A block to lay for the stand-in podium. */
export interface PodiumBlock {
  at: Point;
  block: string;
}

/** The stand-in podium's columns, 1st to 4th: how high each stands over the floor, and its block. */
const STAND_IN = [
  { height: 3, block: "minecraft:gold_block" },
  { height: 2, block: "minecraft:iron_block" },
  { height: 1, block: "minecraft:copper_block" },
  { height: 0, block: "minecraft:smooth_stone" },
] as const;
/** Where each place's column stands across the podium, in blocks from its middle (2nd, 1st, 3rd, 4th from one side). */
const STAND_IN_ACROSS = [-1, -3, 1, 3];

/**
 * A podium laid in code where an arena has none marked (a minigame's test arena, or an arena map
 * from before the Minigame podium): four columns side by side round `middle`, 1st the highest, with
 * its floor block at `floor` (the minigame's floor: where its spawns stand, less one), facing `yaw`
 * (turned to the nearest side, so the columns line up with the blocks). Its spots, 1st first, and
 * the blocks to lay; the arena is cleared after, so they go with it.
 */
export function standInPodium(middle: Point, floor: number, yaw: number, count: number): { spots: Required<Pick<Spot, "x" | "y" | "z" | "yaw">>[]; blocks: PodiumBlock[] } {
  const facing = Math.round(yaw / 90) * 90;
  const radians = (facing * Math.PI) / 180;
  // Across the way they face.
  const across = { x: Math.round(Math.cos(radians)), z: Math.round(Math.sin(radians)) };
  const cx = Math.floor(middle.x);
  const cz = Math.floor(middle.z);
  const spots: Required<Pick<Spot, "x" | "y" | "z" | "yaw">>[] = [];
  const blocks: PodiumBlock[] = [];
  for (let place = 0; place < Math.min(count, STAND_IN.length); place++) {
    const { height, block } = STAND_IN[place];
    const x = cx + across.x * STAND_IN_ACROSS[place];
    const z = cz + across.z * STAND_IN_ACROSS[place];
    for (let y = floor; y <= floor + height; y++) blocks.push({ at: { x, y, z }, block });
    spots.push({ x: x + 0.5, y: floor + height + 1, z: z + 0.5, yaw: facing });
  }
  return { spots, blocks };
}

/**
 * The podium for `count` players on `field`: the map's Minigame podium (its first `count` spots)
 * when it marks enough of them, else `standIns` (the stand-in podium's, standInPodium); and its
 * shot: the map's Podium camera with its own facing, else one in front of the spots (the way they
 * face) looking at them, else `rulesCamera` looking at them. Each spot faces the way the map placed it,
 * else toward the shot.
 */
export function podiumLayout(field: Field, count: number, standIns: readonly Spot[], rulesCamera: Point): PodiumLayout {
  const podium = field.points(MARKUP.podium);
  const marked = count > 0 && podium.length >= count;
  const chosen = (marked ? podium : standIns).slice(0, Math.max(0, count));
  const middle = middleOf(chosen);
  const look = { x: middle.x, y: middle.y + CHEST, z: middle.z };
  const camera = field.points(MARKUP.podiumCamera)[0];
  let shot: PodiumShot;
  if (camera && camera.yaw !== undefined) shot = { location: { x: camera.x, y: camera.y, z: camera.z }, rotation: { x: camera.pitch ?? 0, y: camera.yaw } };
  else if (camera) shot = { location: { x: camera.x, y: camera.y, z: camera.z }, facing: look };
  else {
    const facing = meanYaw(chosen.flatMap((spot) => (spot.yaw === undefined ? [] : [spot.yaw])));
    if (facing === undefined) shot = { location: { ...rulesCamera }, facing: look };
    else {
      // As far back as the podium is wide, at the least SHOT_BACK, in front of where they face.
      const wide = chosen.reduce((most, a) => Math.max(most, ...chosen.map((b) => Math.hypot(a.x - b.x, a.z - b.z))), 0);
      const back = Math.max(SHOT_BACK, wide * 1.3 + 2);
      const radians = (facing * Math.PI) / 180;
      shot = { location: { x: middle.x - Math.sin(radians) * back, y: middle.y + SHOT_UP, z: middle.z + Math.cos(radians) * back }, facing: look };
    }
  }
  const spots = chosen.map((spot) => ({ x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw ?? yawToward(spot, shot.location) }));
  return { spots, shot, marked };
}
