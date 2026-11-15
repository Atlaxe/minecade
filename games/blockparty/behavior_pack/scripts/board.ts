// The spike's test board: 12 spaces around a square, each a 3x3 pad of its type's block on a
// 3-wide path, the way a real board's spaces will be laid in vanilla blocks at the start (the plan's
// "Building spaces"). Pure, apart from build(), so the tests can check the layout and the paths.
import { BlockVolume, type Dimension } from "@minecraft/server";

export type Vec3 = [number, number, number];

export type SpaceType = "start" | "blue" | "red" | "item" | "shop" | "chance" | "warden" | "versus" | "happening";

/** Each type's block (the plan's proposal): Start white concrete, Blue blue concrete, and so on. */
export const SPACE_BLOCKS: Record<SpaceType, string> = {
  start: "minecraft:white_concrete",
  blue: "minecraft:blue_concrete",
  red: "minecraft:red_concrete",
  item: "minecraft:gold_block",
  shop: "minecraft:emerald_block",
  chance: "minecraft:purple_concrete",
  warden: "minecraft:sculk",
  versus: "minecraft:orange_concrete",
  happening: "minecraft:pink_concrete",
};

/** The 12 spaces' types, Start first, going around. */
export const TEST_TYPES: readonly SpaceType[] = ["start", "blue", "blue", "item", "blue", "red", "chance", "blue", "warden", "shop", "versus", "happening"];

export const PATH_BLOCK = "minecraft:smooth_stone";

export interface Space {
  index: number;
  type: SpaceType;
  /** The middle of its pad, where a piece stands: x and z a block's middle, y the top of the pad. */
  at: Vec3;
}

/**
 * The spaces around a square of 4 a side, `spacing` blocks apart, `middle` the square's middle (y the
 * pads' top), clockwise from the north-west corner as seen from above (east is +x, south is +z).
 */
export function testSpaces(middle: Vec3, spacing: number): Space[] {
  const [mx, y, mz] = middle;
  const offsets = [-1.5, -0.5, 0.5, 1.5].map((n) => n * spacing);
  const ring: [number, number][] = [
    ...offsets.map((x): [number, number] => [x, offsets[0]]),
    ...offsets.slice(1).map((z): [number, number] => [offsets[3], z]),
    ...offsets.slice(0, 3).reverse().map((x): [number, number] => [x, offsets[3]]),
    ...offsets.slice(1, 3).reverse().map((z): [number, number] => [offsets[0], z]),
  ];
  return ring.map(([dx, dz], index) => ({ index, type: TEST_TYPES[index % TEST_TYPES.length], at: [Math.floor(mx + dx) + 0.5, y, Math.floor(mz + dz) + 0.5] }));
}

/** The spaces a piece passes from `from`, `steps` ahead (the last is where it lands), around the loop. */
export function route(spaces: readonly Space[], from: number, steps: number): Space[] {
  const out: Space[] = [];
  for (let step = 1; step <= steps; step++) out.push(spaces[(from + step) % spaces.length]);
  return out;
}

/** Where a piece stands on a space: one corner of its pad each, so four can share it (`corner` 0 to 3; -1 the middle). */
export function standAt(space: Space, corner: number): Vec3 {
  if (corner < 0) return space.at;
  const [x, y, z] = space.at;
  const dx = corner === 0 || corner === 3 ? -0.7 : 0.7;
  const dz = corner < 2 ? -0.7 : 0.7;
  return [x + dx, y, z + dz];
}

/** The yaw (degrees, 0 south, 90 west) that faces from `from` to `to` along the ground. */
export function yawTo(from: Vec3, to: Vec3): number {
  return (Math.atan2(-(to[0] - from[0]), to[2] - from[2]) * 180) / Math.PI;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A point `t` of the way from `a` to `b`. */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A walk's polyline: its points and the length to each. */
export interface Path {
  points: Vec3[];
  /** The distance along the path to each point (the first 0). */
  at: number[];
  length: number;
}

export function pathOf(points: Vec3[]): Path {
  const at = [0];
  for (let i = 1; i < points.length; i++) at.push(at[i - 1] + distance(points[i - 1], points[i]));
  return { points, at, length: at[at.length - 1] ?? 0 };
}

/** Where a walk is `d` along its path, and the yaw of the leg it's on (the last leg's past the end). */
export function along(path: Path, d: number): { point: Vec3; yaw: number; leg: number } {
  const { points, at } = path;
  if (points.length === 1) return { point: points[0], yaw: 0, leg: 0 };
  const clamped = Math.max(0, Math.min(d, path.length));
  let leg = 0;
  while (leg < points.length - 2 && at[leg + 1] < clamped) leg++;
  const span = at[leg + 1] - at[leg];
  const t = span > 0 ? (clamped - at[leg]) / span : 1;
  return { point: lerp(points[leg], points[leg + 1], t), yaw: yawTo(points[leg], points[leg + 1]), leg };
}

/** The box the board takes, with room around it (the spike keeps players inside the map's bounds there). */
export function boardBox(spaces: readonly Space[]): { min: Vec3; max: Vec3 } {
  const xs = spaces.map((space) => space.at[0]);
  const zs = spaces.map((space) => space.at[2]);
  const y = spaces[0].at[1];
  return {
    min: [Math.floor(Math.min(...xs)) - 12, y - 8, Math.floor(Math.min(...zs)) - 12],
    max: [Math.floor(Math.max(...xs)) + 12, y + 30, Math.floor(Math.max(...zs)) + 12],
  };
}

/** Lays the board: a 3-wide path between neighbors, then each space's 3x3 pad, all at the pads' height. */
export function build(dimension: Dimension, spaces: readonly Space[]): void {
  const y = spaces[0].at[1] - 1;
  const cell = (space: Space) => [Math.floor(space.at[0]), Math.floor(space.at[2])];
  spaces.forEach((space, i) => {
    const [ax, az] = cell(space);
    const [bx, bz] = cell(spaces[(i + 1) % spaces.length]);
    dimension.fillBlocks(new BlockVolume({ x: Math.min(ax, bx) - 1, y, z: Math.min(az, bz) - 1 }, { x: Math.max(ax, bx) + 1, y, z: Math.max(az, bz) + 1 }), PATH_BLOCK);
  });
  for (const space of spaces) {
    const [x, z] = cell(space);
    dimension.fillBlocks(new BlockVolume({ x: x - 1, y, z: z - 1 }, { x: x + 1, y, z: z + 1 }), SPACE_BLOCKS[space.type]);
  }
}
