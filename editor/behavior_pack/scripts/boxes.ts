// Boxes and heights in block coordinates, as map.json stores them (a box's min and max blocks are
// both inside it), and the dots that outline them with particles for one player: pure functions,
// so they can be tested without a server.
import type { Box, Vec3 } from "@minecade/minigame-core/config";

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** How far each side of a box moves, in blocks: a positive number moves it outward. */
export interface Sides {
  west: number;
  east: number;
  down: number;
  up: number;
  north: number;
  south: number;
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

/** A height typed into a form: a whole number within the world's heights, or undefined. */
export function parseHeight(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const y = Number(trimmed);
  return y >= MIN_HEIGHT && y <= MAX_HEIGHT ? y : undefined;
}

/** Where a dot is drawn for one player, and how big (its size grows with distance, so it looks the same near and far). */
export interface Dot extends Point {
  size: number;
}

/** Where a player looks from, and the way they look (a unit vector). */
export interface View {
  eye: Point;
  look: Point;
}

/** How outline dots are spaced and sized for a player. Tune in game. */
export const DOTS = {
  /** The gap between dots, as an angle seen from the eye (radians): about 2 degrees. */
  angle: 0.035,
  /** The narrowest and widest gaps, in blocks (powers of two). */
  minGap: 0.25,
  maxGap: 64,
  /** A dot's size per block of distance, and its smallest and largest. */
  sizePerBlock: 0.007,
  minSize: 0.05,
  maxSize: 0.5,
  /** Dots farther than this are drawn this far out on the same line of sight, so they show from any distance. */
  project: 40,
  /** Dots behind the player (cosine from the view direction below this) aren't drawn. */
  behind: -0.35,
} as const;

/**
 * Dots along a box's 12 outer edges (from min to max + 1 in world units), for one player. Each
 * edge is drawn whole, however far: the gap between dots grows with distance (a power of two, so
 * dots hold still as the player moves) and dots past DOTS.project are pulled in along the line of
 * sight. Dots behind the player are left out. When that's more than `budget`, the gaps double
 * until it fits, so a big box costs no more than a small one.
 */
export function viewDots(box: Box, view: View, budget: number): Dot[] {
  const lo = box.min;
  const hi: Vec3 = [box.max[0] + 1, box.max[1] + 1, box.max[2] + 1];
  const segments: Segment[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const [b, c] = [0, 1, 2].filter((other) => other !== axis);
    for (const vb of [lo[b], hi[b]]) {
      for (const vc of [lo[c], hi[c]]) {
        const start: Vec3 = [0, 0, 0];
        start[axis] = lo[axis];
        start[b] = vb;
        start[c] = vc;
        // The x edges draw the corners, so no corner is drawn twice.
        segments.push({ start, axis, length: hi[axis] - lo[axis], ends: axis === 0 });
      }
    }
  }
  return segmentDots(segments, view, budget);
}

/** Dots along the rectangle at height `y` from (x0, z0) to (x1, z1): the kill Y plane's edge. */
export function rectDots(x0: number, z0: number, x1: number, z1: number, y: number, view: View, budget: number): Dot[] {
  return segmentDots(
    [
      { start: [x0, y, z0], axis: 0, length: x1 - x0, ends: true },
      { start: [x0, y, z1], axis: 0, length: x1 - x0, ends: true },
      { start: [x0, y, z0], axis: 2, length: z1 - z0, ends: false },
      { start: [x1, y, z0], axis: 2, length: z1 - z0, ends: false },
    ],
    view,
    budget,
  );
}

/** Points near the player as dots: the ones in front, sized by their distance. */
export function nearDots(points: Point[], view: View): Dot[] {
  const dots: Dot[] = [];
  for (const point of points) {
    const dot = place([point.x, point.y, point.z], view);
    if (dot) dots.push(dot);
  }
  return dots;
}

/** A straight run of dots from `start`, `length` blocks along `axis`, with dots at its two ends when `ends`. */
interface Segment {
  start: Vec3;
  axis: number;
  length: number;
  ends: boolean;
}

function segmentDots(segments: Segment[], view: View, budget: number): Dot[] {
  let angle: number = DOTS.angle;
  let dots: Dot[] = [];
  for (let tries = 0; tries < 8; tries++) {
    dots = [];
    for (const segment of segments) walk(segment, view, angle, dots);
    if (dots.length <= budget) return dots;
    angle *= 2;
  }
  return dots.slice(0, budget);
}

/** Adds a segment's dots: at multiples of the gap that fits each dot's distance, from the segment's start. */
function walk(segment: Segment, view: View, angle: number, out: Dot[]): void {
  const at = (t: number): Vec3 => {
    const point: Vec3 = [...segment.start];
    point[segment.axis] += t;
    return point;
  };
  let t = segment.ends ? 0 : undefined;
  if (t === undefined) t = gapAt(at(0), view, angle);
  while (t < segment.length) {
    const point = at(t);
    const dot = place(point, view);
    if (dot) out.push(dot);
    const gap = gapAt(point, view, angle);
    t = (Math.floor(t / gap + 1e-9) + 1) * gap;
  }
  if (segment.ends) {
    const dot = place(at(segment.length), view);
    if (dot) out.push(dot);
  }
}

/** The gap between dots at `point`: a power of two that looks about `angle` wide from the eye. */
function gapAt(point: Vec3, view: View, angle: number): number {
  const wanted = Math.max(DOTS.minGap, distance(point, view.eye) * angle);
  return Math.min(DOTS.maxGap, 2 ** Math.ceil(Math.log2(wanted)));
}

/** Where a point is drawn for this view, or undefined when it's behind the player. */
function place(point: Vec3, view: View): Dot | undefined {
  const { eye, look } = view;
  const d = distance(point, eye);
  if (d > 0.01 && ((point[0] - eye.x) * look.x + (point[1] - eye.y) * look.y + (point[2] - eye.z) * look.z) / d < DOTS.behind) return undefined;
  const scale = d > DOTS.project ? DOTS.project / d : 1;
  const drawn = d * scale;
  return {
    x: eye.x + (point[0] - eye.x) * scale,
    y: eye.y + (point[1] - eye.y) * scale,
    z: eye.z + (point[2] - eye.z) * scale,
    size: Math.min(DOTS.maxSize, Math.max(DOTS.minSize, drawn * DOTS.sizePerBlock)),
  };
}

function distance(point: Vec3, eye: Point): number {
  return Math.hypot(point[0] - eye.x, point[1] - eye.y, point[2] - eye.z);
}

/**
 * Dots on the plane at height `y`, every `spacing` blocks, within `radius` of `near` and, when
 * given, over the box `extent` (the map's bounds). None when the player is farther than `radius`
 * from the plane.
 */
export function planePoints(y: number, extent: Box | undefined, near: Point, radius: number, spacing: number): Point[] {
  const dy = near.y - y;
  if (Math.abs(dy) > radius) return [];
  const reach = Math.sqrt(radius * radius - dy * dy);
  let [x0, x1, z0, z1] = [near.x - reach, near.x + reach, near.z - reach, near.z + reach];
  if (extent) {
    x0 = Math.max(x0, extent.min[0]);
    x1 = Math.min(x1, extent.max[0] + 1);
    z0 = Math.max(z0, extent.min[2]);
    z1 = Math.min(z1, extent.max[2] + 1);
  }
  const points: Point[] = [];
  // + 0 turns -0 into 0.
  for (let x = Math.ceil(x0 / spacing) * spacing + 0; x <= x1; x += spacing) {
    for (let z = Math.ceil(z0 / spacing) * spacing + 0; z <= z1; z += spacing) {
      if ((x - near.x) ** 2 + (z - near.z) ** 2 <= reach * reach) points.push({ x, y, z });
    }
  }
  return points;
}
