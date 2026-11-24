// A fork in the board's path (the user, 2026-11-18): not a form for the player, but the fork box
// (dialogue.ts fork, the workshop's blockparty_fork component), its buttons side by side and named
// for where each way goes as the piece arrives ("Left", "Right"), not by space and type. Picking a
// button turns everyone's camera down that way. Pure, so the tests can check which way is which.
// A map can name a fork's ways itself (the user, 2026-11-24, the Panel's Fork buttons: Left,
// Straight, Right, Up, Down), since the camera doesn't always look the way the piece goes; the
// buttons then stand left to right by their names (forkButtons).
import { floorOf, type Space, type Vec3 } from "./board.ts";
import { wayShot, type Shot, type ShotWay } from "./stage-layout.ts";

/** A flat direction (x, z), a unit. */
type Flat = [number, number];

function unit(dx: number, dz: number): Flat {
  const length = Math.hypot(dx, dz);
  return length > 1e-6 ? [dx / length, dz / length] : [0, 1];
}

/**
 * Which way the piece is going as it reaches the fork: from the space it came from (`from`, else
 * the one leading in), else along the ways' middle.
 */
export function headingInto(spaces: readonly Space[], fork: Space, from?: number): Flat {
  const before = (from !== undefined ? spaces[from] : undefined) ?? spaces.find((space) => space.next.includes(fork.index));
  if (before && Math.hypot(fork.at[0] - before.at[0], fork.at[2] - before.at[2]) > 1e-6) return unit(fork.at[0] - before.at[0], fork.at[2] - before.at[2]);
  let dx = 0;
  let dz = 0;
  for (const next of fork.next) {
    const [x, z] = unit(spaces[next].at[0] - fork.at[0], spaces[next].at[2] - fork.at[2]);
    dx += x;
    dz += z;
  }
  return unit(dx, dz);
}

/**
 * How far to the left a way turns, going along `heading`, in degrees (right is below 0). In the
 * world's x east and z south, looking north, west is on the left.
 */
export function leftTurn(heading: Flat, way: Flat): number {
  const cross = heading[0] * way[1] - heading[1] * way[0];
  const dot = heading[0] * way[0] + heading[1] * way[1];
  return (-Math.atan2(cross, dot) * 180) / Math.PI;
}

/** The fork's ways, as indexes into its `next`, from the leftmost to the rightmost going along `heading`. */
export function forkOrder(spaces: readonly Space[], fork: Space, heading: Flat): number[] {
  const turns = fork.next.map((next) => leftTurn(heading, unit(spaces[next].at[0] - fork.at[0], spaces[next].at[2] - fork.at[2])));
  return fork.next.map((_, i) => i).sort((a, b) => turns[b] - turns[a] || a - b);
}

/** The buttons' line ids, left to right, for `count` ways: Left and Right, and Middle between them. */
export function forkLabelIds(count: number): string[] {
  if (count <= 1) return ["branch.left"].slice(0, count);
  return ["branch.left", ...Array.from({ length: count - 2 }, () => "branch.middle"), "branch.right"];
}

/** Where a button stands among a fork's, left to right, by its line: Left first, Right last, the rest between. */
const BUTTON_RANK: Record<string, number> = { "branch.left": 0, "branch.right": 2 };

/**
 * A fork's buttons, left to right: each way (an index into the fork's `next`) and its line id. A way
 * the map names (the fork's `ways`) is branch.<name>; one it doesn't is named by where it goes as
 * the piece arrives along `heading` (forkLabelIds). They stand left to right by their names, Left
 * first and Right last, ways with the same place in the order they go left to right.
 */
export function forkButtons(spaces: readonly Space[], fork: Space, heading: Flat): { ways: number[]; ids: string[] } {
  const order = forkOrder(spaces, fork, heading);
  const auto = forkLabelIds(order.length);
  const buttons = order.map((way, position) => {
    const name = fork.ways?.[fork.next[way]];
    return { way, position, id: name ? `branch.${name}` : auto[position] };
  });
  buttons.sort((a, b) => (BUTTON_RANK[a.id] ?? 1) - (BUTTON_RANK[b.id] ?? 1) || a.position - b.position);
  return { ways: buttons.map((button) => button.way), ids: buttons.map((button) => button.id) };
}

/** A way ahead from its first space, `count` spaces long at most (the first way at every fork on it). */
export function wayAhead(spaces: readonly Space[], first: number, count = 3): Space[] {
  const out: Space[] = [];
  let at: number | undefined = first;
  while (at !== undefined && out.length < count && !out.some((space) => space.index === at)) {
    out.push(spaces[at]);
    at = spaces[at].next[0];
  }
  return out;
}

/** How far behind the fork the camera stands, how high, and how many spaces along a way it looks. */
const BEHIND = 5;
const UP = 5;
export const LOOK_ALONG = 2;

/** Along a cutscene's way (the board camera's, or the fork space's own), how far down the fork's shot looks. */
const WAY_PITCH = 35;

/**
 * The camera at a fork looking down one way: behind the fork the way the piece came, up high, aimed
 * at the way's space LOOK_ALONG along (or as far as the way goes). Along a cutscene's `along` (the
 * board camera never turning), it looks that way instead, at the fork and that space together, so
 * each way picked still pans the camera over to it.
 */
export function forkShot(fork: Space, heading: Flat, way: readonly Space[], along?: ShotWay): Shot {
  const floor = floorOf(fork);
  const target = way[Math.min(LOOK_ALONG, way.length) - 1] ?? fork;
  if (along) {
    const middle: Vec3 = [(fork.at[0] + target.at[0]) / 2, (floor + floorOf(target)) / 2 + 1, (fork.at[2] + target.at[2]) / 2];
    const spread = Math.hypot(target.at[0] - fork.at[0], target.at[2] - fork.at[2]);
    return wayShot(middle, along, Math.max(8, spread * 1.3 + 4), WAY_PITCH);
  }
  const location: Vec3 = [fork.at[0] - heading[0] * BEHIND, floor + UP, fork.at[2] - heading[1] * BEHIND];
  return { location, facing: [target.at[0], floorOf(target) + 1, target.at[2]] };
}
