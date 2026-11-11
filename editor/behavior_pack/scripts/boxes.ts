// Boxes and heights in block coordinates, as map.json stores them (a box's min and max blocks are
// both inside it), and the dots that outline them with particles for one player: pure functions,
// so they can be tested without a server.
import type { Box, Point, Vec3 } from "@minecade/minigame-core/config";

// The outline dots live in core (outline-dots.ts), so games draw them too (Build Swap's selection).
export { DOTS, viewDots, type Dot, type Point, type View } from "@minecade/minigame-core/config";

/** How far each side of a box moves, in blocks: a positive number moves it outward. */
export interface Sides {
  west: number;
  east: number;
  down: number;
  up: number;
  north: number;
  south: number;
}

/** A compass direction a player faces, or a box's side faces. */
export type Cardinal = "north" | "east" | "south" | "west";

/** Clockwise from north: the next one is to the right. */
const CLOCKWISE: Cardinal[] = ["north", "east", "south", "west"];

/** The direction a player faces, from their yaw (0 is south, 90 west, 180 north, -90 east). */
export function facingOf(yaw: number): Cardinal {
  const turned = (((Math.round(yaw / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  return (["south", "west", "north", "east"] as const)[turned];
}

/** Where a side is from a player facing `facing`. */
export function relativeSide(facing: Cardinal, side: Cardinal): "ahead" | "right" | "behind" | "left" {
  const turn = (CLOCKWISE.indexOf(side) - CLOCKWISE.indexOf(facing) + 4) % 4;
  return (["ahead", "right", "behind", "left"] as const)[turn];
}

/** Bedrock's overworld heights, the range kill Y can take. */
export const MIN_HEIGHT = -64;
export const MAX_HEIGHT = 319;

/** The box of one block. */
export function blockBox(at: Vec3): Box {
  return { min: [at[0], at[1], at[2]], max: [at[0], at[1], at[2]] };
}

/** The smallest box holding `box` and the block at `at`. */
export function growBox(box: Box, at: Vec3): Box {
  return {
    min: [Math.min(box.min[0], at[0]), Math.min(box.min[1], at[1]), Math.min(box.min[2], at[2])],
    max: [Math.max(box.max[0], at[0]), Math.max(box.max[1], at[1]), Math.max(box.max[2], at[2])],
  };
}

/** The box with its sides moved (west is -x, north is -z), or undefined when a side would pass the one across from it. */
export function nudgeBox(box: Box, sides: Sides): Box | undefined {
  const min: Vec3 = [box.min[0] - sides.west, box.min[1] - sides.down, box.min[2] - sides.north];
  const max: Vec3 = [box.max[0] + sides.east, box.max[1] + sides.up, box.max[2] + sides.south];
  return min.every((value, axis) => value <= max[axis]) ? { min, max } : undefined;
}

/** The box with its bottom at height `y`, or undefined when that's above its top. */
export function floorAt(box: Box, y: number): Box | undefined {
  return y <= box.max[1] ? { min: [box.min[0], y, box.min[2]], max: [...box.max] } : undefined;
}

export function sameBox(a: Box, b: Box): boolean {
  return a.min.every((value, axis) => value === b.min[axis]) && a.max.every((value, axis) => value === b.max[axis]);
}

/** "12 x 5 x 30": blocks along x, y and z. */
export function sizeText(box: Box): string {
  return box.min.map((value, axis) => box.max[axis] - value + 1).join(" x ");
}

/** "12 x 5 x 30 blocks, from -6 60 -15 to 5 64 14". */
export function describeBox(box: Box): string {
  return `${sizeText(box)} blocks, from ${box.min.join(" ")} to ${box.max.join(" ")}`;
}

/** Where Go to puts a player: on top of the box, over its middle. */
export function topCenter(box: Box): Point {
  return { x: (box.min[0] + box.max[0] + 1) / 2, y: box.max[1] + 1, z: (box.min[2] + box.max[2] + 1) / 2 };
}

/** A height typed into a form: a whole number within the world's heights (up to `max`), or undefined. */
export function parseHeight(text: string, max = MAX_HEIGHT): number | undefined {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const y = Number(trimmed);
  return y >= MIN_HEIGHT && y <= max ? y : undefined;
}

