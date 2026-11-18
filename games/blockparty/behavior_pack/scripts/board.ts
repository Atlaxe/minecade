// The spike's board: a map's own spaces (the board kit's, placed with the Spaces tool), or on a map
// without any, a test board of 12 spaces around a square on a 3-wide path. Either way each space is
// a marker the game puts there at the start, its type's model standing on the floor (space-markers.ts;
// the plan's "Space markers"), and a piece stands on the marker's pedestal, STAND over the floor.
// Pure, apart from layPaths(), so the tests can check the layout and the paths.
import { BlockVolume, type Dimension } from "@minecraft/server";
import type { BoardSpace } from "@minecade/minigame-core/config";
import model from "../../space-model.json";

export type Vec3 = [number, number, number];

/** How high a piece stands over the floor on a space: the top of its marker's pedestal, in blocks (space-model.json, from the model). */
export const STAND = model.pedestal.top / 16;

/** The test board's 12 types, Start first, going around. */
export const TEST_TYPES: readonly string[] = ["start", "blue", "blue", "item", "blue", "red", "chance", "blue", "warden", "shop", "versus", "happening"];

export const PATH_BLOCK = "minecraft:smooth_stone";

export interface Space {
  index: number;
  type: string;
  /** The middle of its marker, where a piece stands: x and z a block's middle, y the top of the pedestal (the floor and STAND). */
  at: Vec3;
  /** The floor the marker stands on (the top of the block under it), when it isn't at's y less STAND. */
  floor?: number;
  /** The spaces it leads to, by index (a piece takes the first for now). */
  next: number[];
  /** Its id on the map (a map's spaces only). */
  id?: number;
  /** A spot the Star can be at, and one the first Star can be at. */
  star?: boolean;
  opening?: boolean;
}

/** The test board's Star candidates, by index, and its two opening spots among them. */
export const TEST_STARS: readonly number[] = [3, 6, 9];
export const TEST_OPENINGS: readonly number[] = [3, 9];

/**
 * The spaces around a square of 4 a side, `spacing` blocks apart, `middle` the square's middle (y the
 * floor the markers stand on), clockwise from the north-west corner as seen from above (east is +x,
 * south is +z).
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
  return ring.map(([dx, dz], index) => ({
    index,
    type: TEST_TYPES[index % TEST_TYPES.length],
    at: [Math.floor(mx + dx) + 0.5, y + STAND, Math.floor(mz + dz) + 0.5],
    floor: y,
    next: [(index + 1) % ring.length],
    ...(TEST_STARS.includes(index) ? { star: true } : {}),
    ...(TEST_OPENINGS.includes(index) ? { opening: true } : {}),
  }));
}

/**
 * A map's spaces as the spike's: in the map's order, Start first, each at its position (whole x and z
 * are a block's middle, as map.json's positions are; y the floor its marker stands on, a piece STAND
 * over it), its links as indices. A space without a type is Blue.
 */
export function mapSpaces(list: readonly BoardSpace[]): Space[] {
  const ordered = [...list].sort((a, b) => (a.type === "start" ? -1 : b.type === "start" ? 1 : 0));
  const index = new Map(ordered.map((space, i) => [space.id, i]));
  const middle = (value: number) => (Number.isInteger(value) ? value + 0.5 : value);
  return ordered.map((space, i) => ({
    index: i,
    id: space.id,
    type: space.type ?? "blue",
    at: [middle(space.at[0]), space.at[1] + STAND, middle(space.at[2])],
    floor: space.at[1],
    next: (space.next ?? []).flatMap((id) => (index.has(id) ? [index.get(id)!] : [])),
    ...(space.star ? { star: true } : {}),
    ...(space.opening ? { opening: true } : {}),
  }));
}

/** The spaces a piece passes from `from`, `steps` ahead (the last is where it lands), taking each space's first way on. */
export function route(spaces: readonly Space[], from: number, steps: number): Space[] {
  const out: Space[] = [];
  let at = from;
  for (let step = 1; step <= steps; step++) {
    at = spaces[at].next[0] ?? at;
    out.push(spaces[at]);
  }
  return out;
}

/** The space `steps` back from `from`, against the links (where two ways meet, the first space leading in). */
export function back(spaces: readonly Space[], from: number, steps: number): number {
  let at = from;
  for (let step = 0; step < steps; step++) {
    const before = spaces.find((space) => space.next.includes(at));
    if (!before) break;
    at = before.index;
  }
  return at;
}

/** Where a piece stands on a space: one corner of its pedestal each, so four can share it (`corner` 0 to 3; -1 the middle). */
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

/** The signed turn from yaw `from` to yaw `to`, in degrees, the short way round (-180 to 180). */
export function angleGap(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** The box the board takes, with room around it (the spike keeps players inside the map's bounds there). */
export function boardBox(spaces: readonly Space[]): { min: Vec3; max: Vec3 } {
  const xs = spaces.map((space) => space.at[0]);
  const zs = spaces.map((space) => space.at[2]);
  const y = floorOf(spaces[0]);
  return {
    min: [Math.floor(Math.min(...xs)) - 12, y - 8, Math.floor(Math.min(...zs)) - 12],
    max: [Math.floor(Math.max(...xs)) + 12, y + 30, Math.floor(Math.max(...zs)) + 12],
  };
}

/** The floor a space's marker stands on (the top of the block under it). */
export function floorOf(space: Pick<Space, "at" | "floor">): number {
  return space.floor ?? space.at[1] - STAND;
}

/** Lays the test board's paths: 3 wide between neighbors, the floor's top level with the markers' floor. */
export function layPaths(dimension: Dimension, spaces: readonly Space[]): void {
  const cell = (space: Space) => [Math.floor(space.at[0]), Math.floor(space.at[2])];
  const y = floorOf(spaces[0]) - 1;
  spaces.forEach((space) => {
    const [ax, az] = cell(space);
    for (const next of space.next) {
      const [bx, bz] = cell(spaces[next]);
      dimension.fillBlocks(new BlockVolume({ x: Math.min(ax, bx) - 1, y, z: Math.min(az, bz) - 1 }, { x: Math.max(ax, bx) + 1, y, z: Math.max(az, bz) + 1 }), PATH_BLOCK);
    }
  });
}
