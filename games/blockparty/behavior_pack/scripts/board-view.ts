// The board menu's pure parts (docs/plans/block-party-ui.md, "The board menu" and "The item panel"),
// so the tests can check them: which way the movement keys step, stepping through a list that skips
// what's disabled and wraps round, and Board's view of the whole board (the user: a wide, still view
// of the entire board, nothing to move).
import { floorOf, type Space, type Vec3 } from "./board.ts";
import type { Shot } from "./stage-layout.ts";

/**
 * The sign of the movement vector's x for the D key (right). Bedrock's vector has x going left (A
 * gives +1, as its move vector does), so right is -1. If A and D step the wrong way in game, this is
 * the one thing to turn round.
 */
export const RIGHT_X = -1;

/** Past this far from the middle, the stick or a key counts as pushed. */
export const PUSHED = 0.5;

/**
 * A push of the movement keys as one step through a list: back (-1: W, A, up, left) or on (+1: S, D,
 * down, right), whichever way is pushed more; 0 for none. As the value Steering (dialogue-codes.ts)
 * takes: W's way (up the list) is above PUSHED.
 */
export function pushOf(vector: { x: number; y: number }): number {
  const right = vector.x * RIGHT_X;
  if (Math.abs(vector.y) < PUSHED && Math.abs(right) < PUSHED) return 0;
  // Steering steps -1 for a value above PUSHED (W) and +1 below -PUSHED (S): right (D) is on, so it's below.
  return Math.abs(vector.y) >= Math.abs(right) ? vector.y : -right;
}

/**
 * A push of A or D alone, as pushOf gives it (W and S count for nothing): the item panel steps only
 * left and right, the chevrons' way (the user).
 */
export function sidewaysOf(vector: { x: number; y: number }): number {
  const right = vector.x * RIGHT_X;
  return Math.abs(right) < PUSHED ? 0 : -right;
}

/**
 * The next index from `at` stepping `step` (-1 or 1) through `count` choices, wrapping round and
 * skipping any `disabled`; `at` itself when nothing else can be picked.
 */
export function stepThrough(at: number, count: number, step: number, disabled: (index: number) => boolean = () => false): number {
  if (count <= 0 || step === 0) return at;
  for (let i = 1; i <= count; i++) {
    const next = (((at + step * i) % count) + count) % count;
    if (!disabled(next)) return next;
  }
  return at;
}

/** Room left round the board in the view, as a share of its size. */
const MARGIN = 1.15;
/** The narrowest screen the view must fit (4:3, a tablet; wider screens get more room at the sides). */
const ASPECT = 4 / 3;
/** The game's default field of view, up and down, in degrees. */
const FOV = 70;
/** How far the view looks down, in degrees. */
const PITCH = 60;
/** A pad reaches this far from its space's middle. */
const PAD = 1.5;

/**
 * Board's view: the whole board from high up, looking down at its middle, from the side that puts the
 * board's longer way across the screen, far enough back that every space fits the narrowest screen.
 * Given a `yaw` (the board camera's way, while it never turns), it looks that way instead, still
 * far enough back for the whole board as it lies across that view.
 */
export function boardOverview(spaces: readonly Pick<Space, "at" | "floor">[], yaw?: number): Shot | undefined {
  if (spaces.length === 0) return undefined;
  const y = Math.max(...spaces.map((space) => floorOf(space)));
  // The view's ways over the ground: ahead (where it looks) and across (the screen's width).
  let forward: [number, number];
  if (yaw === undefined) {
    const xs = spaces.map((space) => space.at[0]);
    const zs = spaces.map((space) => space.at[2]);
    // From the south (+z) looking north, or from the east (+x) looking west: the longer way across.
    const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
    forward = alongX ? [0, -1] : [-1, 0];
  } else {
    const radians = (yaw * Math.PI) / 180;
    forward = [-Math.sin(radians), Math.cos(radians)];
  }
  const side: [number, number] = [-forward[1], forward[0]];
  const across = spaces.map((space) => space.at[0] * side[0] + space.at[2] * side[1]);
  const ahead = spaces.map((space) => space.at[0] * forward[0] + space.at[2] * forward[1]);
  const [aMin, aMax] = [Math.min(...across) - PAD, Math.max(...across) + PAD];
  const [dMin, dMax] = [Math.min(...ahead) - PAD, Math.max(...ahead) + PAD];
  const a = (aMin + aMax) / 2;
  const d = (dMin + dMax) / 2;
  const middle: Vec3 = [a * side[0] + d * forward[0], y, a * side[1] + d * forward[1]];
  const wide = aMax - aMin;
  const deep = dMax - dMin;
  const pitch = (PITCH * Math.PI) / 180;
  const half = (FOV * Math.PI) / 360;
  const halfAcross = Math.atan(Math.tan(half) * ASPECT);
  // Far enough back for the width, and for the depth as it looks from this high (its near edge is closer).
  const forWidth = wide / 2 / Math.tan(halfAcross);
  const forDepth = ((deep / 2) * Math.sin(pitch)) / Math.tan(half) + (deep / 2) * Math.cos(pitch);
  const distance = Math.max(forWidth, forDepth, 8) * MARGIN;
  const up = Math.sin(pitch) * distance;
  const back = Math.cos(pitch) * distance;
  const location: Vec3 = [middle[0] - forward[0] * back, y + up, middle[2] - forward[1] * back];
  return { location, facing: middle };
}

/**
 * A pan over the whole board (Golem Gardens' golem swap, the user: "a camera pan over the entire
 * board"): Board's view of `points` (the spaces and whatever else must be in it), swung `turn`
 * degrees round its middle, from half of it one way to half the other. The camera eases from the
 * first to the second. Given a `yaw` (the board camera's way, while it never turns), the view never
 * turns from it: it slides across the board instead, about as far as the swing would take it.
 */
export function boardPan(points: readonly Vec3[], turn: number, yaw?: number): [Shot, Shot] | [] {
  const view = boardOverview(points.map((at) => ({ at, floor: at[1] })), yaw);
  if (!view?.facing) return [];
  const middle = view.facing;
  const dx = view.location[0] - middle[0];
  const dz = view.location[2] - middle[2];
  if (yaw !== undefined) {
    // Across the view (square to the way it looks), as far as the swing's ends are from where it starts.
    const level = Math.hypot(dx, dz) || 1;
    const reach = level * Math.sin((turn * Math.PI) / 360);
    const slid = (by: number): Shot => {
      const [sx, sz] = [(-dz / level) * by, (dx / level) * by];
      return { location: [view.location[0] + sx, view.location[1], view.location[2] + sz], facing: [middle[0] + sx, middle[1], middle[2] + sz] };
    };
    return [slid(-reach), slid(reach)];
  }
  const swung = (degrees: number): Shot => {
    const radians = (degrees * Math.PI) / 180;
    return { location: [middle[0] + dx * Math.cos(radians) - dz * Math.sin(radians), view.location[1], middle[2] + dx * Math.sin(radians) + dz * Math.cos(radians)], facing: middle };
  };
  return [swung(-turn / 2), swung(turn / 2)];
}
