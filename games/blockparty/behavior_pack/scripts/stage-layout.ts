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

// ---- A cutscene's way (the user, 2026-11-23) --------------------------------------------------
// While the board camera never turns, every shot of a cutscene on the board looks its way too, so a
// board built to be seen from one side is only ever seen from that side; a space can opt out (its
// camera "free") or look its own way (its camera's yaw, and the pitch and distance to go with it).

/** Which way a cutscene's shots look (degrees: 0 south, 90 west), and, when given, how far down and how far back. */
export interface ShotWay {
  yaw: number;
  pitch?: number;
  distance?: number;
}

/** A space's cutscene camera, as the map gives it (core SpaceCamera). */
export interface SpaceCameraLike {
  free?: boolean;
  yaw?: number;
  pitch?: number;
  distance?: number;
}

/**
 * The way a cutscene's shots at a space look: the space's own yaw (with its pitch and distance),
 * else the board camera's way (`boardYaw`, while it never turns) unless the space is free; undefined
 * when each shot picks its own side (the board camera turns, or the space is free).
 */
export function cutsceneWay(own: SpaceCameraLike | undefined, boardYaw: number | undefined): ShotWay | undefined {
  const tuned = { ...(own?.pitch !== undefined ? { pitch: own.pitch } : {}), ...(own?.distance !== undefined ? { distance: own.distance } : {}) };
  if (own?.yaw !== undefined) return { yaw: own.yaw, ...tuned };
  if (own?.free || boardYaw === undefined) return undefined;
  return { yaw: boardYaw, ...tuned };
}

/**
 * A shot looking along `way` at `look`: as far back as the way says (else `back`), and as high as
 * looking down the way's pitch (else `pitch`) needs, so what it looks at is in the middle.
 */
export function wayShot(look: Vec3, way: ShotWay, back: number, pitch: number): Shot {
  const tilt = way.pitch ?? pitch;
  const away = way.distance ?? back;
  const [fx, fz] = ahead(way.yaw);
  const level = Math.cos((tilt * Math.PI) / 180) * away;
  const up = Math.sin((tilt * Math.PI) / 180) * away;
  return { location: [look[0] - fx * level, look[1] + up, look[2] - fz * level], rotation: { yaw: ((way.yaw % 360) + 360) % 360, pitch: tilt } };
}

/** The flat unit vector a yaw looks along (yaw 0 is +z, south). */
function ahead(yaw: number): [number, number] {
  const radians = (yaw * Math.PI) / 180;
  return [-Math.sin(radians), Math.cos(radians)];
}

/** The space a seat stands on: the nearest whose middle is within `reach` blocks across (pieces stand on its corners), else none. */
export function nearestSpace<T extends { at: Vec3 }>(spaces: readonly T[], at: Vec3, reach = 2.5): T | undefined {
  let best: T | undefined;
  let gap = reach;
  for (const space of spaces) {
    const d = Math.hypot(space.at[0] - at[0], space.at[2] - at[2]);
    if (d <= gap && Math.abs(space.at[1] - at[1]) < 4) {
      best = space;
      gap = d;
    }
  }
  return best;
}

/** How a two-shot laid along a way looks down, and a shot of a space. */
const TWO_PITCH = 15;
const SPACE_BACK = 7.6;
const SPACE_PITCH = 26;

/**
 * Two people talking (a player and an NPC), seen from the side of the line between them, a little
 * over their heads, both in frame: `side` picks which side (1 or -1). Along a `way`, the camera
 * looks that way at the middle of them instead, as far back.
 */
export function twoShot(a: Vec3, b: Vec3, side: 1 | -1 = 1, way?: ShotWay): Shot {
  const [dx, dz] = flat(a, b);
  const gap = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const away = Math.max(4.5, gap * 1.3 + 2);
  const middle: Vec3 = [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 1.1, (a[2] + b[2]) / 2];
  if (way) return wayShot(middle, way, away, TWO_PITCH);
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

/** A shot of a space (the Star reveal): from across the path and up, the space in the middle; along a `way`, from that way, as far back. */
export function spaceShot(space: Space, spaces: readonly Space[], way?: ShotWay): Shot {
  const [dx, dz] = pathWay(space, spaces);
  const [x, y, z] = space.at;
  if (way) return wayShot([x, y + 0.8, z], way, SPACE_BACK, SPACE_PITCH);
  return { location: [x + dz * 7 - dx * 3, y + 4.5, z - dx * 7 - dz * 3], facing: [x, y + 0.8, z] };
}

/** A Lightning Strike's shot along a way: from beside them that way, low, looking up their bolt (as the free one does). */
export function lightningShot(at: Vec3, way: ShotWay): Shot {
  const [fx, fz] = ahead(way.yaw);
  const back = way.distance ?? 4.2;
  return { location: [at[0] - fx * back, at[1] + 1, at[2] - fz * back], facing: [at[0], at[1] + 6, at[2]] };
}

/** How far back the camera on a flight is, and how far down it looks, along a way. */
const FLIGHT_BACK = 9.5;
const FLIGHT_PITCH = 18;

/** The camera on someone flying (Chris under his balloon), looking along a way at them. */
export function flightShot(at: Vec3, way: ShotWay): Shot {
  return wayShot([at[0], at[1] + 1.2, at[2]], way, FLIGHT_BACK, FLIGHT_PITCH);
}

/** A close shot of someone standing at `at` facing `yaw`: in front of them, at their eyes. */
export function faceShot(at: Vec3, yaw: number, away = 3.2): Shot {
  const radians = (yaw * Math.PI) / 180;
  // Yaw 0 faces +z (south); their front is that way.
  const fx = -Math.sin(radians);
  const fz = Math.cos(radians);
  return { location: [at[0] + fx * away, at[1] + EYE + 0.1, at[2] + fz * away], facing: [at[0], at[1] + EYE - 0.15, at[2]] };
}

/** How far in front of a seat a hand-over's shot of them stands, how far over their eyes, and how far over their eyes it looks. */
export const SEAT_SHOT_AWAY = 3.4;
const SEAT_SHOT_UP = 0.35;
const SEAT_SHOT_LOOK = 0.3;

/**
 * A hand-over's shot of one seat standing at `at` facing `yaw` (handovers.ts): in front of them,
 * the whole of them in it with room over their head for the count there, so the tokens leave out of
 * the top of it and come down into it from there.
 */
export function seatShot(at: Vec3, yaw: number, away = SEAT_SHOT_AWAY): Shot {
  const radians = (yaw * Math.PI) / 180;
  // Yaw 0 faces +z (south); their front is that way.
  const fx = -Math.sin(radians);
  const fz = Math.cos(radians);
  return { location: [at[0] + fx * away, at[1] + EYE + SEAT_SHOT_UP, at[2] + fz * away], facing: [at[0], at[1] + EYE + SEAT_SHOT_LOOK, at[2]] };
}

/** A hand-over's shot of one seat along a way: the same framing, the camera that way of them (they turn to face it). */
export function seatWayShot(at: Vec3, way: ShotWay): Shot {
  const look: Vec3 = [at[0], at[1] + EYE + SEAT_SHOT_LOOK, at[2]];
  // Level with the look, as the free one is, unless the way says.
  return wayShot(look, way, SEAT_SHOT_AWAY, 1);
}

/** The ways a seat shot is tried, by how far round from the seat's front (degrees): the front first, then further round either side, the back last. */
export const SEAT_SHOT_TURNS: readonly number[] = [0, 40, -40, 80, -80, 125, -125, 180];

// ---- The end of the game (pass 8) -------------------------------------------------------------

/** The final podium: where each place stands (1st first) and the way they face, Chris's spot, and the camera. */
export interface FinalPodium {
  spots: Vec3[];
  yaws: number[];
  chris: Vec3;
  camera: Shot;
  /** Whether the map marks a final podium (else the pre-game podium stands in). */
  marked: boolean;
}

/** How far in front of a final podium with no camera of its own the camera stands, at the least, and how high over the spots. */
const FINAL_BACK = 7;
const FINAL_UP = 2.4;
/** How far past the end of an unmarked Chris's podium he stands. */
const CHRIS_ASIDE = 2.5;

/** The average of some yaws by their directions (undefined when they cancel out or there are none). */
export function meanYaw(yaws: readonly number[]): number | undefined {
  if (yaws.length === 0) return undefined;
  const x = yaws.reduce((sum, yaw) => sum - Math.sin((yaw * Math.PI) / 180), 0);
  const z = yaws.reduce((sum, yaw) => sum + Math.cos((yaw * Math.PI) / 180), 0);
  if (Math.hypot(x, z) < 1e-6) return undefined;
  return (Math.atan2(-x, z) * 180) / Math.PI;
}

function middleOf(points: readonly Vec3[]): Vec3 {
  const n = points.length || 1;
  return [0, 1, 2].map((axis) => points.reduce((sum, at) => sum + at[axis], 0) / n) as Vec3;
}

/**
 * The final podium for `seats` places (the map's Final podium, 1st to 4th, when it marks as many),
 * each spot facing the way the map placed it, else toward the camera; the camera the map's Final
 * podium camera, else one in front of the spots the way they face, looking at them; Chris at his
 * Final podium marker, else past the end of the podium facing its middle. Without a final podium,
 * the pre-game podium (`pregame`) stands in: its spots in place order, everyone facing its camera,
 * Chris at his spot (or his Final podium marker).
 */
export function finalPodium(spots: readonly Marker[], chris: Marker | undefined, camera: Marker | undefined, seats: number, pregame: Podium): FinalPodium {
  const marked = seats > 0 && spots.length >= seats;
  if (!marked) {
    const at = pregame.lineup.map((spot): Vec3 => [...spot]);
    const shot = camera ? markerShot(camera, [middleOf(at)[0], middleOf(at)[1] + 1.1, middleOf(at)[2]]) : pregame.camera;
    return { spots: at, yaws: at.map((spot) => yawFrom(spot, shot.location)), chris: chris?.at ?? pregame.chris, camera: shot, marked: false };
  }
  const chosen = spots.slice(0, seats);
  const at = chosen.map((spot): Vec3 => [...spot.at]);
  const middle = middleOf(at);
  const look: Vec3 = [middle[0], middle[1] + 1.1, middle[2]];
  let shot: Shot;
  if (camera) shot = markerShot(camera, look);
  else {
    const facing = meanYaw(chosen.flatMap((spot) => (spot.yaw === undefined ? [] : [spot.yaw]))) ?? 0;
    const wide = at.reduce((most, a) => Math.max(most, ...at.map((b) => Math.hypot(a[0] - b[0], a[2] - b[2]))), 0);
    const back = Math.max(FINAL_BACK, wide * 1.3 + 2);
    const radians = (facing * Math.PI) / 180;
    shot = { location: [middle[0] - Math.sin(radians) * back, middle[1] + FINAL_UP, middle[2] + Math.cos(radians) * back], facing: look };
  }
  const yaws = chosen.map((spot) => spot.yaw ?? yawFrom(spot.at, shot.location));
  return { spots: at, yaws, chris: chris?.at ?? chrisBeside(at, yaws), camera: shot, marked: true };
}

/** A spot past the end of a podium's row, across the way its places face, on its lowest spot's floor. */
function chrisBeside(spots: readonly Vec3[], yaws: readonly number[]): Vec3 {
  const middle = middleOf(spots);
  const facing = meanYaw(yaws) ?? 0;
  const radians = (facing * Math.PI) / 180;
  // Across the way they face (their right hand, seen from the front: the camera's left).
  const across: [number, number] = [Math.cos(radians), Math.sin(radians)];
  const reach = Math.max(0, ...spots.map((spot) => (spot[0] - middle[0]) * across[0] + (spot[2] - middle[2]) * across[1]));
  const floor = Math.min(...spots.map((spot) => spot[1]));
  return [middle[0] + across[0] * (reach + CHRIS_ASIDE), floor, middle[2] + across[1] * (reach + CHRIS_ASIDE)];
}

/** Which way a shot looks, as a unit vector. */
function forwardOf(shot: Shot): Vec3 {
  if (shot.rotation) {
    const yaw = (shot.rotation.yaw * Math.PI) / 180;
    const pitch = (shot.rotation.pitch * Math.PI) / 180;
    return [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  }
  const to = shot.facing ?? shot.location;
  const d: Vec3 = [to[0] - shot.location[0], to[1] - shot.location[1], to[2] - shot.location[2]];
  const length = Math.hypot(...d) || 1;
  return [d[0] / length, d[1] / length, d[2] / length];
}

/** The same shot pulled `back` blocks back the way it looks and `up` higher, still looking at the same thing (the final podium's slow ease in starts there). */
export function pulledBack(shot: Shot, back: number, up = 0): Shot {
  const [fx, fy, fz] = forwardOf(shot);
  const location: Vec3 = [shot.location[0] - fx * back, shot.location[1] - fy * back + up, shot.location[2] - fz * back];
  if (shot.rotation && up === 0) return { location, rotation: shot.rotation };
  // Raised, it tips down to keep its aim: at what it looked at, or where it looked `back` blocks on.
  const aim: Vec3 = shot.facing ?? [shot.location[0] + fx * back, shot.location[1] + fy * back, shot.location[2] + fz * back];
  return { location, facing: aim };
}

/**
 * The winner's orbit: `steps` + 1 shots on an arc `arc` degrees wide round the front of someone
 * standing at `at` facing `yaw`, `radius` out and a little over their eyes, each looking at their
 * chest, from their left round to their right (seen from the front).
 */
export function orbitShots(at: Vec3, yaw: number, radius: number, arc: number, steps: number): Shot[] {
  const look: Vec3 = [at[0], at[1] + 1.2, at[2]];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const degrees = yaw - arc / 2 + (arc * i) / Math.max(1, steps);
    const radians = (degrees * Math.PI) / 180;
    return { location: [at[0] - Math.sin(radians) * radius, at[1] + EYE + 0.5, at[2] + Math.cos(radians) * radius] as Vec3, facing: look };
  });
}

/**
 * Several seats in one shot (Gift Exchange's passes): from high over their middle, looking down at
 * it from the south side, far enough back to take them all in.
 */
export function groupShot(points: readonly Vec3[]): Shot {
  const middle = middleOf(points);
  const spread = Math.max(3, ...points.map((at) => Math.hypot(at[0] - middle[0], at[2] - middle[2])));
  const away = Math.max(9, spread * 1.7 + 4);
  return { location: [middle[0], middle[1] + away * 0.75, middle[2] + away * 0.7], facing: [middle[0], middle[1] + 1, middle[2]] };
}

/** Where the Allay hovers in front of someone at `at` turned toward `toward`: `away` blocks toward it, over their head. */
export function hoverBefore(at: Vec3, toward: Vec3, away = 1.4): Vec3 {
  const [dx, dz] = flat(at, toward);
  return [at[0] + dx * away, at[1] + EYE + 0.3, at[2] + dz * away];
}
