// Boxes and heights in block coordinates, as map.json stores them (a box's min and max blocks are
// both inside it), and the dots that outline them with particles: pure functions, so they can be
// tested without a server.
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
/** The widest gap between outline dots, however big the box. */
const MAX_SPACING = 64;

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

/** One of a box's 12 edges, cut down to the part within reach. */
interface Edge {
  axis: number;
  /** The edge's start corner (its other two coordinates are fixed). */
  corner: Vec3;
  lo: number;
  hi: number;
  /** The part within reach, from `from` to `to` along the axis. */
  from: number;
  to: number;
  /** The x edges draw the corners, so no corner is drawn twice. */
  corners: boolean;
}

/**
 * Dots along the edges of a box's outer faces (from min to max + 1 in world units), one per block,
 * keeping only those within `radius` of `near`. When that's more than `budget`, the gap between
 * dots doubles until it fits, so a box of any size costs about the same to draw. The dots sit on
 * multiples of the gap from the box's corner, so they hold still as the player moves.
 */
export function edgePoints(box: Box, near: Point, radius: number, budget: number): Point[] {
  const lo = box.min;
  const hi: Vec3 = [box.max[0] + 1, box.max[1] + 1, box.max[2] + 1];
  const at = [near.x, near.y, near.z];
  const edges: Edge[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const [b, c] = [0, 1, 2].filter((other) => other !== axis);
    for (const vb of [lo[b], hi[b]]) {
      for (const vc of [lo[c], hi[c]]) {
        const across = (vb - at[b]) ** 2 + (vc - at[c]) ** 2;
        if (across > radius * radius) continue;
        const half = Math.sqrt(radius * radius - across);
        const from = Math.max(lo[axis], at[axis] - half);
        const to = Math.min(hi[axis], at[axis] + half);
        if (from > to) continue;
        const corner: Vec3 = [0, 0, 0];
        corner[b] = vb;
        corner[c] = vc;
        edges.push({ axis, corner, lo: lo[axis], hi: hi[axis], from, to, corners: axis === 0 });
      }
    }
  }
  let spacing = 1;
  while (spacing < MAX_SPACING && edges.reduce((count, edge) => count + spots(edge, spacing).length, 0) > budget) spacing *= 2;
  return edges.flatMap((edge) =>
    spots(edge, spacing).map((value) => {
      const point: Vec3 = [...edge.corner];
      point[edge.axis] = value;
      return { x: point[0], y: point[1], z: point[2] };
    }),
  );
}

/** Where an edge's dots go along its axis. */
function spots(edge: Edge, spacing: number): number[] {
  const values: number[] = [];
  for (let k = Math.max(0, Math.ceil((edge.from - edge.lo) / spacing)); edge.lo + k * spacing <= edge.to; k++) values.push(edge.lo + k * spacing);
  // The far corner, when the gap doesn't land on it.
  if (edge.to >= edge.hi && values[values.length - 1] !== edge.hi) values.push(edge.hi);
  return edge.corners ? values : values.filter((value) => value !== edge.lo && value !== edge.hi);
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
