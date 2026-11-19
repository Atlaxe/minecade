// How Block Party's NPCs come and go on the board (the user, 2026-11-18): the pure parts, so the
// tests can check them; stage.ts plays them.
//   - Chris and his balloon: when the Star moves on, a balloon pops out of Chris and carries him up,
//     over to the new Star's space and down beside it, where the balloon goes (flightPlan).
//   - The Wandering Trader walks in with his llamas from out of the shot, along the board's path
//     (walkInPath), the llamas each keeping to his trail a few blocks behind (trailPoint).
//   - The Witch appears and vanishes in a puff of smoke (stage.ts; nothing here).
//   - The Referee at every Versus space and the Villager at every Shop space are there all game
//     (residentRole): those spots are always there (the user).
import { floorOf, type Space, type Vec3 } from "./board.ts";
import { besideSpace } from "./stage-layout.ts";

/** Who stands at a space of a type all game, by type. */
const RESIDENTS: Readonly<Record<string, string>> = { versus: "referee", shop: "villager" };

/** The NPC that stands at a space of `type` all game (the Referee at Versus, the Villager at the Shop), if any. */
export function residentRole(type: string): string | undefined {
  return RESIDENTS[type];
}

/** How high over the higher end a balloon flight goes, in blocks. */
export const CRUISE = 8;
/** Its speeds, blocks a tick: up, across (at its fastest; a long way goes faster, see flightPlan), down. */
const RISE_SPEED = 0.22;
const ACROSS_SPEED = 0.45;
const DESCENT_SPEED = 0.2;
/** The longest a flight across takes, in ticks (a far Star doesn't keep everyone waiting). */
const ACROSS_MOST = 110;

/** A flight from one spot to another: how long it takes, and where it is at each tick of it. */
export interface Flight {
  ticks: number;
  at(tick: number): Vec3;
}

/** Eases from 0 to 1 and stays there: slow out, slow in. */
export function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * A balloon flight from `from` to `to`: up to CRUISE over the higher of the two, across, and down,
 * each part eased, the way across starting before the climb is over and the descent before it has
 * arrived, so the corners round off.
 */
export function flightPlan(from: Vec3, to: Vec3, cruise = CRUISE): Flight {
  const top = Math.max(from[1], to[1]) + cruise;
  const rise = Math.max(10, Math.round((top - from[1]) / RISE_SPEED));
  const descent = Math.max(10, Math.round((top - to[1]) / DESCENT_SPEED));
  const across = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const travel = Math.max(20, Math.min(ACROSS_MOST, Math.round(across / ACROSS_SPEED)));
  // Across begins halfway up and ends halfway down.
  const acrossFrom = Math.round(rise / 2);
  const acrossTicks = Math.round(rise / 2) + travel + Math.round(descent / 2);
  const ticks = rise + travel + descent;
  return {
    ticks,
    at(tick: number): Vec3 {
      const t = Math.min(ticks, Math.max(0, tick));
      const h = smooth((t - acrossFrom) / acrossTicks);
      const up = smooth(t / rise);
      const down = smooth((t - rise - travel) / descent);
      const y = t < rise + travel ? from[1] + (top - from[1]) * up : top + (to[1] - top) * down;
      return [from[0] + (to[0] - from[0]) * h, y, from[2] + (to[2] - from[2]) * h];
    },
  };
}

/** How fast a balloon comes straight down (blocks a tick, at its fastest; it eases in and out). */
const DROP_SPEED = 0.16;

/**
 * Straight down from `from` to `to` (Chris coming in under his balloon at the first Stars), eased
 * at both ends; any way across is made along the way.
 */
export function descentPlan(from: Vec3, to: Vec3, speed = DROP_SPEED): Flight {
  const ticks = Math.max(20, Math.round(Math.abs(from[1] - to[1]) / speed));
  return {
    ticks,
    at(tick: number): Vec3 {
      const t = smooth(Math.min(ticks, Math.max(0, tick)) / ticks);
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
    },
  };
}

/** The spaces that lead into `space`. */
function into(space: Space, spaces: readonly Space[]): Space[] {
  return spaces.filter((other) => other.next.includes(space.index));
}

/**
 * Where the Wandering Trader walks in from and through to `spot` (one of besideSpace(space)'s, its
 * `side`): beside the board's path the way it came, space by space back from `space`, until the
 * walk is at least `far` blocks long, then `beyond` blocks further on the same line (out of the
 * shot). First point first; `spot` last.
 */
export function walkInPath(space: Space, spaces: readonly Space[], side: number, spot: Vec3, far = 12, beyond = 4): Vec3[] {
  const points: Vec3[] = [spot];
  const seen = new Set([space.index]);
  let length = 0;
  let here = space;
  while (length < far) {
    const back = into(here, spaces).find((other) => !seen.has(other.index));
    if (!back) break;
    seen.add(back.index);
    const point = besideSpace(back, spaces)[side] ?? besideSpace(back, spaces)[0];
    length += Math.hypot(point[0] - points[0][0], point[2] - points[0][2]);
    points.unshift([point[0], floorOf(back), point[2]]);
    here = back;
  }
  // On along the line from the last two points (or straight back along the path when there's only the spot).
  const [first, second] = points.length > 1 ? [points[0], points[1]] : [[spot[0] - 1, spot[1], spot[2]] as Vec3, spot];
  const dx = first[0] - second[0];
  const dz = first[2] - second[2];
  const gap = Math.hypot(dx, dz) || 1;
  const more = beyond + Math.max(0, far - length);
  points.unshift([first[0] + (dx / gap) * more, first[1], first[2] + (dz / gap) * more]);
  return points;
}

/** A trail of spots something went through, each with how far along it went. */
export interface TrailPoint {
  at: Vec3;
  along: number;
}

/** Adds where the leader is now to its trail (only when it's moved). */
export function extendTrail(trail: TrailPoint[], at: Vec3): void {
  const last = trail.at(-1);
  if (!last) {
    trail.push({ at, along: 0 });
    return;
  }
  const step = Math.hypot(at[0] - last.at[0], at[1] - last.at[1], at[2] - last.at[2]);
  if (step < 0.05) return;
  trail.push({ at, along: last.along + step });
}

/** The spot `behind` blocks back along the trail from its end (its start, if it's shorter). */
export function trailPoint(trail: readonly TrailPoint[], behind: number): Vec3 | undefined {
  const last = trail.at(-1);
  if (!last) return undefined;
  const goal = last.along - behind;
  if (goal <= 0) return trail[0].at;
  for (let i = trail.length - 1; i > 0; i--) {
    const a = trail[i - 1];
    const b = trail[i];
    if (a.along <= goal) {
      const t = b.along === a.along ? 0 : (goal - a.along) / (b.along - a.along);
      return [a.at[0] + (b.at[0] - a.at[0]) * t, a.at[1] + (b.at[1] - a.at[1]) * t, a.at[2] + (b.at[2] - a.at[2]) * t];
    }
  }
  return trail[0].at;
}
