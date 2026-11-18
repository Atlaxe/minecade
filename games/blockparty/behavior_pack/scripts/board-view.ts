// The board menu's pure parts (docs/plans/block-party-ui.md, "The board menu" and "The item panel"),
// so the tests can check them: which way the movement keys step, stepping through a list that skips
// what's disabled and wraps round, and Board's view of the whole board (the user: a wide, still view
// of the entire board, nothing to move).
import type { Space, Vec3 } from "./board.ts";
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
 */
export function boardOverview(spaces: readonly Pick<Space, "at">[]): Shot | undefined {
  if (spaces.length === 0) return undefined;
  const xs = spaces.map((space) => space.at[0]);
  const zs = spaces.map((space) => space.at[2]);
  const minX = Math.min(...xs) - PAD;
  const maxX = Math.max(...xs) + PAD;
  const minZ = Math.min(...zs) - PAD;
  const maxZ = Math.max(...zs) + PAD;
  const y = Math.max(...spaces.map((space) => space.at[1]));
  const middle: Vec3 = [(minX + maxX) / 2, y, (minZ + maxZ) / 2];
  // Across the screen and away from it: the longer way across.
  const alongX = maxX - minX >= maxZ - minZ;
  const across = alongX ? maxX - minX : maxZ - minZ;
  const deep = alongX ? maxZ - minZ : maxX - minX;
  const pitch = (PITCH * Math.PI) / 180;
  const half = (FOV * Math.PI) / 360;
  const halfAcross = Math.atan(Math.tan(half) * ASPECT);
  // Far enough back for the width, and for the depth as it looks from this high (its near edge is closer).
  const forWidth = across / 2 / Math.tan(halfAcross);
  const forDepth = ((deep / 2) * Math.sin(pitch)) / Math.tan(half) + (deep / 2) * Math.cos(pitch);
  const distance = Math.max(forWidth, forDepth, 8) * MARGIN;
  const up = Math.sin(pitch) * distance;
  const back = Math.cos(pitch) * distance;
  // From the south (+z) looking north, or from the east (+x) looking west.
  const location: Vec3 = alongX ? [middle[0], y + up, middle[2] + back] : [middle[0] + back, y + up, middle[2]];
  return { location, facing: middle };
}
