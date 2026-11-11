// The particle dots that outline a box for one player, as the map editor's Select mode and Build
// Swap's selection draw them: pure functions, so they can be tested without a server. Each dot is
// core's minecade:outline particle (resource_pack/particles/outline.json), drawn by drawOutline
// (game/outline.ts).
import type { Box, Vec3 } from "./map-config.ts";

/** A point in the world. */
export interface Point {
  x: number;
  y: number;
  z: number;
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

