// Golem Gardens' golems as the game plays them (the user's design, 2026-11-22; docs/plans/block-party.md
// "Golems"): pure, so the tests can check them. The map marks four golems in the Panel (map.json
// "golems", minigame-core's board-golems.ts): each a post, where it stands while it's active,
// blocking the path from one space to the next; a rest spot, where it stands while it isn't; and the
// bends of its walk between the two.
//   - Golems 1 and 2 start on their posts, 3 and 4 at their rest spots: two active, two not.
//   - A player whose walk comes to an active golem's path pays it 5 coins to go on (the toll). At a
//     fork they can go another way instead; anywhere else, not paying ends their walk there.
//   - Each Star bought, one active golem (at random) and one that isn't (at random) trade places:
//     each walks to its other spot, so two are always active.
import { GOLEMS_ACTIVE, golemsOf, xyzOf, type BoardGolem } from "@minecade/minigame-core/config";
import type { Space, Vec3 } from "./board.ts";

/** The toll, in coins (the user: a flat 5). */
export const GOLEM_TOLL = 5;
/** How fast a golem walks, in blocks a tick (a little over a player's walk at half speed). */
export const GOLEM_WALK = 0.12;

/** A spot a golem stands on: its block's middle (y its floor), and the way it faces. */
export interface GolemSpot {
  at: Vec3;
  yaw: number;
}

/** A golem the game plays: all its parts set, its path a link on the board. */
export interface Golem {
  /** 1 to 4, as the map numbers it. */
  number: number;
  post: GolemSpot;
  rest: GolemSpot;
  /** The path it blocks, as space indexes (board.ts). */
  before: number;
  after: number;
  /** Its walk from its post to its rest spot: the post, each bend, the rest spot. */
  walk: Vec3[];
}

/**
 * The map's golems the game can play (map.json "golems"): only those with every part set on a path
 * that's on the board (a published map has all four; a draft may not).
 */
export function mapGolems(config: { golems?: unknown }, spaces: readonly Space[]): Golem[] {
  const byId = new Map(spaces.flatMap((space) => (space.id === undefined ? [] : [[space.id, space] as const])));
  return golemsOf(config).flatMap((golem: BoardGolem, i): Golem[] => {
    const before = golem.before === undefined ? undefined : byId.get(golem.before);
    const after = golem.after === undefined ? undefined : byId.get(golem.after);
    if (!golem.post || !golem.rest || !before || !after || !before.next.includes(after.index)) return [];
    const post = spotOf(golem.post);
    const rest = spotOf(golem.rest);
    return [{ number: i + 1, post, rest, before: before.index, after: after.index, walk: [post.at, ...(golem.bends ?? []).map(blockMiddle), rest.at] }];
  });
}

/** The golems on their posts at the start: golems 1 and 2 (by the map's numbers). */
export function startingActive(golems: readonly Golem[]): Set<number> {
  return new Set(golems.filter((golem) => golem.number <= GOLEMS_ACTIVE).map((golem) => golem.number));
}

/** The active golem blocking the path from space `from` to space `to` (indexes), if one is. */
export function golemOn(golems: readonly Golem[], active: ReadonlySet<number>, from: number, to: number): Golem | undefined {
  return golems.find((golem) => active.has(golem.number) && golem.before === from && golem.after === to);
}

/** Any golem (active or not) on the path between two spaces, either way round: it steps aside for a walk back. */
export function golemBetween(golems: readonly Golem[], active: ReadonlySet<number>, a: number, b: number): Golem | undefined {
  return golemOn(golems, active, a, b) ?? golemOn(golems, active, b, a);
}

/**
 * A Star bought: one active golem and one that isn't, each picked at random, trade places (the user:
 * "one of the active, and one of the inactive, to keep a balance"). Undefined when either side has none.
 */
export function pickSwap(golems: readonly Golem[], active: ReadonlySet<number>, random: () => number): { leaving: Golem; coming: Golem } | undefined {
  const on = golems.filter((golem) => active.has(golem.number));
  const off = golems.filter((golem) => !active.has(golem.number));
  if (on.length === 0 || off.length === 0) return undefined;
  return { leaving: on[Math.min(on.length - 1, Math.floor(random() * on.length))], coming: off[Math.min(off.length - 1, Math.floor(random() * off.length))] };
}

/** A golem's walk to its post (from its rest spot) or to its rest spot (from its post). */
export function walkTo(golem: Golem, post: boolean): Vec3[] {
  return post ? [...golem.walk].reverse() : [...golem.walk];
}

/** How long a walk takes, in ticks, at the golem's speed. */
export function walkTicks(points: readonly Vec3[], perTick = GOLEM_WALK): number {
  const length = points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - points[i][0], point[2] - points[i][2]), 0);
  return Math.ceil(length / perTick);
}

/**
 * Where a golem steps to let a payer by (the user: it steps aside for them, then back): the first
 * `away` blocks of its walk to its rest spot, as the points to walk through. A golem whose walk is
 * shorter goes all the way.
 */
export function asidePath(golem: Golem, away = 3): Vec3[] {
  const out: Vec3[] = [golem.walk[0]];
  let left = away;
  for (let i = 1; i < golem.walk.length && left > 0; i++) {
    const a = golem.walk[i - 1];
    const b = golem.walk[i];
    const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (span <= left) {
      out.push(b);
      left -= span;
      continue;
    }
    const t = left / span;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    left = 0;
  }
  return out;
}

/** Whether a bot pays a golem: when it has the coins, at a fork only for the way to the Star. */
export function botPays(coins: number, atFork: boolean, towardStar: boolean): boolean {
  return coins >= GOLEM_TOLL && (!atFork || towardStar);
}

function spotOf(position: readonly number[]): GolemSpot {
  return { at: blockMiddle(xyzOf(position as Vec3)), yaw: position.length === 5 ? position[3] : 0 };
}

/** A block's position as where something stands on it: its middle (whole x and z), y its floor. */
function blockMiddle(at: readonly number[]): Vec3 {
  const middle = (value: number) => (Number.isInteger(value) ? value + 0.5 : value);
  return [middle(at[0]), at[1], middle(at[2])];
}
