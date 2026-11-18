// Where Block Party's NPCs stand and where its shots look from (docs/plans/block-party.md, "Shots"
// and "Stages and camera anchors"; block-party-ui.md, "Cameras"), pure so the tests can check them.
// A board map marks its podium and its intro (the Game marker tool: the lineup, Chris's spot, the
// podium camera, the intro's shots); a map without them gets the stand-ins here, laid out from its
// spaces, so every board plays.
import { floorOf, type Space, type Vec3 } from "./board.ts";

/** How far over a marker's feet the eyes are: a camera marker is placed standing where the camera goes. */
export const EYE = 1.62;

/** A camera: where it is, and where it looks (a point), or which way (yaw and pitch, in degrees). */
export interface Shot {
  location: Vec3;
  facing?: Vec3;
  rotation?: { yaw: number; pitch: number };
}

/** A marker of the map's, as the game reads it: its feet, and its facing when it has one. */
export interface Marker {
  at: Vec3;
  yaw?: number;
  pitch?: number;
}

/** A camera marker's shot: from its eyes, its own facing, or toward `lookAt` without one. */
export function markerShot(marker: Marker, lookAt?: Vec3): Shot {
  const location: Vec3 = [marker.at[0], marker.at[1] + EYE, marker.at[2]];
  if (marker.yaw !== undefined) return { location, rotation: { yaw: marker.yaw, pitch: marker.pitch ?? 0 } };
  return { location, facing: lookAt ?? [marker.at[0], marker.at[1] + EYE, marker.at[2] + 1] };
}

function flat(a: Vec3, b: Vec3): [number, number] {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const length = Math.hypot(dx, dz) || 1;
  return [dx / length, dz / length];
}

/**
 * Two people talking (a player and an NPC), seen from the side of the line between them, a little
 * over their heads, both in frame: `side` picks which side (1 or -1).
 */
export function twoShot(a: Vec3, b: Vec3, side: 1 | -1 = 1): Shot {
  const [dx, dz] = flat(a, b);
  const gap = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const away = Math.max(4.5, gap * 1.3 + 2);
  const middle: Vec3 = [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 1.1, (a[2] + b[2]) / 2];
  return { location: [middle[0] - dz * side * away, middle[1] + 1.2, middle[2] + dx * side * away], facing: middle };
}

/** The spaces that lead into `space`. */
function into(space: Space, spaces: readonly Space[]): Space[] {
  return spaces.filter((other) => other.next.includes(space.index));
}

/** The way the path runs through a space (x and z, a unit), from the one before it to the one after. */
export function pathWay(space: Space, spaces: readonly Space[]): [number, number] {
  const before = into(space, spaces)[0];
  const after = spaces[space.next[0] ?? -1];
  if (before && after) return flat(before.at, after.at);
  if (after) return flat(space.at, after.at);
  if (before) return flat(before.at, space.at);
  return [0, 1];
}

/**
 * Spots beside a space for an NPC to stand (Chris at the Star), best first: across the path to
 * either side, `away` blocks from the marker's middle, then ahead and behind. The game takes the first
 * with ground under it and room to stand.
 */
export function besideSpace(space: Space, spaces: readonly Space[], away = 2.5): Vec3[] {
  const [dx, dz] = pathWay(space, spaces);
  // On the floor beside the marker, not up on its pedestal.
  const [x, , z] = space.at;
  const y = floorOf(space);
  return [
    [x - dz * away, y, z + dx * away],
    [x + dz * away, y, z - dx * away],
    [x + dx * away, y, z + dz * away],
    [x - dx * away, y, z - dz * away],
  ];
}

/** The yaw that faces from `from` to `to` (degrees: 0 south, 90 west). */
export function yawFrom(from: Vec3, to: Vec3): number {
  return (Math.atan2(-(to[0] - from[0]), to[2] - from[2]) * 180) / Math.PI;
}

/** The starting podium: where each seat stands (1st seat first), Chris's spot, and its camera. */
export interface Podium {
  lineup: Vec3[];
  chris: Vec3;
  camera: Shot;
}

/**
 * The podium on a board with no podium markup: the seats on Start's corners, Chris on the space
 * after it (the ground there is the board's own), the camera behind Start, up a little, looking at
 * Chris over the players.
 */
export function podiumOnStart(start: Space, spaces: readonly Space[]): Podium {
  const next = spaces[start.next[0] ?? -1];
  // Along Start's way out, toward the space after it.
  const [dx, dz] = next ? flat(start.at, next.at) : pathWay(start, spaces);
  const [x, y, z] = start.at;
  const lineup: Vec3[] = [-1.5, -0.5, 0.5, 1.5].map((across) => [x - dz * across * 0.9, y, z + dx * across * 0.9]);
  const chris: Vec3 = next ? [...next.at] : [x + dx * 4.5, y, z + dz * 4.5];
  const camera: Shot = { location: [x - dx * 6, y + 3.2, z - dz * 6], facing: [chris[0], chris[1] + 0.8, chris[2]] };
  return { lineup, chris, camera };
}

/**
 * The podium from the map's markup: the pre-game podium's spots in order, Chris's pre-game spot, and
 * the podium camera (its own facing, or looking at Chris). Without a podium camera, the camera
 * stands behind the podium's middle, up a little, looking at Chris over the players, like the
 * stand-in's. Undefined unless the podium (a spot for every seat) and Chris are there.
 */
export function podiumFromMarkup(lineup: readonly Marker[], chris: Marker | undefined, camera: Marker | undefined, seats: number): Podium | undefined {
  if (!chris || lineup.length < seats) return undefined;
  const look: Vec3 = [chris.at[0], chris.at[1] + 0.8, chris.at[2]];
  const spots = lineup.map((spot) => spot.at);
  if (camera) return { lineup: spots, chris: chris.at, camera: markerShot(camera, look) };
  const middle: Vec3 = [0, 1, 2].map((axis) => spots.reduce((sum, spot) => sum + spot[axis], 0) / spots.length) as Vec3;
  const [dx, dz] = flat(middle, chris.at);
  return { lineup: spots, chris: chris.at, camera: { location: [middle[0] - dx * 6, middle[1] + 3.2, middle[2] - dz * 6], facing: look } };
}

/** The box around the spaces. */
function around(spaces: readonly Space[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const space of spaces) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], space.at[axis]);
      max[axis] = Math.max(max[axis], space.at[axis]);
    }
  }
  return { min, max };
}

/**
 * The intro on a board with no intro markup: three high shots round the board (from the south-west,
 * the north-west, then the east), each looking at its middle, the camera easing from one to the next.
 */
export function introAround(spaces: readonly Space[]): Shot[] {
  if (spaces.length === 0) return [];
  const { min, max } = around(spaces);
  const middle: Vec3 = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const reach = Math.max(12, Math.hypot(max[0] - min[0], max[2] - min[2]) * 0.6);
  const height = Math.max(10, reach * 0.55);
  const at = (degrees: number): Shot => {
    const radians = (degrees * Math.PI) / 180;
    return { location: [middle[0] + Math.cos(radians) * reach, middle[1] + height, middle[2] + Math.sin(radians) * reach], facing: middle };
  };
  return [at(135), at(225), at(330)];
}

/** A shot of a space (the Star reveal): from across the path and up, the space in the middle. */
export function spaceShot(space: Space, spaces: readonly Space[]): Shot {
  const [dx, dz] = pathWay(space, spaces);
  const [x, y, z] = space.at;
  return { location: [x + dz * 7 - dx * 3, y + 4.5, z - dx * 7 - dz * 3], facing: [x, y + 0.8, z] };
}

/** A close shot of someone standing at `at` facing `yaw`: in front of them, at their eyes. */
export function faceShot(at: Vec3, yaw: number, away = 3.2): Shot {
  const radians = (yaw * Math.PI) / 180;
  // Yaw 0 faces +z (south); their front is that way.
  const fx = -Math.sin(radians);
  const fz = Math.cos(radians);
  return { location: [at[0] + fx * away, at[1] + EYE + 0.1, at[2] + fz * away], facing: [at[0], at[1] + EYE - 0.15, at[2]] };
}
