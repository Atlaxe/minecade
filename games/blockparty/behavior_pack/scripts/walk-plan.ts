// Block Party's walk over the ground between spaces (docs/plans/block-party.md, "Moving over the
// board"): what a piece does on each stretch of its walk (a leg: one space to the next, in a straight
// line), planned once from the blocks along it when the leg starts, then followed tick by tick
// (walk-follow.ts). Like a player would:
//   - anything up or down by STEP at most (a slab, a stair, a carpet, a space's marker) is walked,
//     on a slope: lifted before a step up (to a lip over its edge as the piece's front gets there),
//     let down a little after a step down;
//   - a step up of more than STEP, up to JUMP_UP (a block), is jumped before the piece gets to it,
//     on an arc picked to clear it and come down onto its top (never its side), as near a player's
//     own jump as fits; a block in the way that it can't stand on (a hurdle) is jumped over in one
//     arc, clear of its back (a player moves down before along, so the back would catch it);
//   - a gap (nothing under it, or water or lava) is jumped when its far side is within MAX_GAP; a
//     crack narrower than WALK_OVER is walked over, as a running player does;
//   - a drop is walked off and fallen down;
//   - a rise taller than a jump with a ladder or vines on it is climbed, and so is a drop with one.
// Heights are the piece's feet. A piece is 0.6 wide, so it stands on the highest ground anywhere
// under it (its footprint). What the walk can't get over (a wall too tall with nothing to climb, a
// fall into nothing) is `blocked`: the walk puts the piece at the leg's end there.
// Pure, apart from the TerrainReader it's handed (terrain.ts reads the world), so the tests can
// plan legs over made-up ground.
import type { Vec3 } from "./board.ts";

/** Half a piece's width. */
export const PIECE_HALF = 0.3;
/** The most a piece walks up or down without jumping or falling (a slab, a stair, a marker), in blocks. */
export const STEP = 0.6;
/** The most a jump goes up onto (a block, and a little). */
export const JUMP_UP = 1.3;
/** A gap under the piece this long or shorter (its footprint off the ground) is walked over. */
export const WALK_OVER = 0.2;
/** How far ahead a jump looks for a gap's far side. */
export const MAX_GAP = 4.5;
/** How far over a piece's feet the ground is looked for (a step up is found below it). */
export const LOOK_UP = 1.6;
/** How far down the ground is looked for (deeper is a fall into nothing). */
export const MAX_DROP = 10;
/**
 * How far over a step's edge a piece is lifted as it gets there, and over a climb's top: a pushed
 * piece in the air doesn't step up even a hair, and the walk follows its plan only so closely.
 */
export const LIP = 0.1;
/** A climb's speed (a ladder or vines), in blocks a tick: vanilla's own on a ladder. */
export const CLIMB_SPEED = 0.15;
/** The blocks a piece climbs. */
export const CLIMBABLE: ReadonlySet<string> = new Set([
  "minecraft:ladder",
  "minecraft:vine",
  "minecraft:twisting_vines",
  "minecraft:weeping_vines",
  "minecraft:cave_vines",
  "minecraft:cave_vines_body_with_berries",
  "minecraft:cave_vines_head_with_berries",
  "minecraft:scaffolding",
]);

/** The plan's heights are this far apart along a leg (about). */
export const SAMPLE = 0.1;
/** Where across a piece the ground is looked at: its middle and near each side. */
const ACROSS = [-0.25, 0, 0.25];
/** Gravity and air drag on a player, each tick. */
const GRAVITY = 0.08;
const DRAG = 0.98;
/** A jump's upward speeds tried (a player's own jump is 0.42, which the pick leans to). */
const JUMP_SPEEDS = speeds(0.28, 0.62);
const PLAIN_JUMP = 0.42;
/** How far before an edge or a face a jump may take off. */
const TAKEOFF_REACH = 2.2;
/** Where a jump best lands: this far past where the far side's ground first comes under the piece (all of it on, and a little more). */
const LAND_PAST = 0.9;
/** How far over anything a jump stays, rising, and over an edge it comes down past. */
const CLEAR = LIP;
/** A landing on ground that changes again within this far (a hurdle's top: a block deep is 1.6 under a piece) counts BRIEF against it, so a jump over it wins. */
const MIN_STAY = 2;
const BRIEF = 3;
/** How far from a wall a piece climbs (its front), and how far past an edge it goes before climbing down (its back): clear of a ladder (3 pixels thick). */
const CLIMB_GAP = 0.25;
/** The slopes a step is walked on: up (blocks up a block along: lifted before the step) and down (let down after it). */
const SLOPE_UP = 1;
const SLOPE_DOWN = 1.6;

function speeds(from: number, to: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += 0.02) out.push(Math.round(v * 100) / 100);
  return out;
}

/** What the planner knows of the world. */
export interface TerrainReader {
  /**
   * The top of the ground at (x, z), looked for from about `near` (a height the piece's feet are
   * near): the first surface down from LOOK_UP over it, MAX_DROP deep at most, or the top of what's
   * there when that's inside a block (a wall). Undefined for nothing (the void), or water or lava
   * first.
   */
  ground(x: number, z: number, near: number): number | undefined;
  /** Whether the block at (x, y, z) can be climbed (CLIMBABLE). */
  climbable(x: number, y: number, z: number): boolean;
}

/** A climb: at `at` along the leg, from height `from` to `to` (up or down). */
export interface Climb {
  at: number;
  from: number;
  to: number;
}

export interface LegPlan {
  /** The leg's length along the ground. */
  span: number;
  /** The distance between heights. */
  step: number;
  /** The feet's height every `step` along the leg, from its start to its end. */
  heights: number[];
  /** Whether the piece is off the ground there (in a jump or a fall). */
  air: boolean[];
  /** The ground under the piece there (the highest anywhere under it), null for none (a gap). */
  ground: (number | null)[];
  climbs: Climb[];
  /** Where nothing gets the piece on: the walk puts it at the leg's end when it gets there. */
  blocked?: number;
  /** About how many ticks the climbs take. */
  climbTicks: number;
}

/** A jump's or a fall's path: from grid index `from` (its takeoff) to `land`, its heights in between. */
interface Arc {
  from: number;
  land: number;
  landY: number;
  heights: number[];
}

/**
 * Plans a leg from `from` to `to` (the feet, where the piece starts, and where it's going) for a
 * piece walking `perTick` blocks a tick: the ground along it as `reader` finds it, and what to do
 * about each change in it.
 */
export function planLeg(reader: TerrainReader, from: Vec3, to: Vec3, perTick: number): LegPlan {
  const span = Math.hypot(to[0] - from[0], to[2] - from[2]);
  if (span < 0.05) return { span, step: 1, heights: [from[1], to[1]], air: [false, false], ground: [from[1], to[1]], climbs: [], climbTicks: 0 };
  const n = Math.max(1, Math.round(span / SAMPLE));
  const ds = span / n;
  const ux = (to[0] - from[0]) / span;
  const uz = (to[2] - from[2]) / span;
  // The ground under the piece's width at each sample, from half a piece before the start to half a
  // piece past the end, each looked for from the last ground found (so a drop's bottom and a
  // wall's top are found).
  const reach = Math.max(1, Math.round(PIECE_HALF / ds));
  const raw: (number | undefined)[] = [];
  let near = from[1];
  for (let j = -reach; j <= n + reach; j++) {
    const s = j * ds;
    let best: number | undefined;
    for (const c of ACROSS) {
      const g = reader.ground(from[0] + ux * s - uz * c, from[2] + uz * s + ux * c, near);
      if (g !== undefined && (best === undefined || g > best)) best = g;
    }
    raw.push(best);
    if (best !== undefined) near = best;
  }
  // What the piece stands on at each sample: the highest ground anywhere under it.
  const ground: (number | undefined)[] = [];
  for (let j = 0; j <= n; j++) {
    let best: number | undefined;
    for (let k = j; k <= j + 2 * reach; k++) {
      const g = raw[k];
      if (g !== undefined && (best === undefined || g > best)) best = g;
    }
    ground.push(best);
  }

  const heights: number[] = new Array<number>(n + 1).fill(from[1]);
  const air: boolean[] = new Array<boolean>(n + 1).fill(false);
  const walked: boolean[] = new Array<boolean>(n + 1).fill(false);
  const climbs: Climb[] = [];
  let blocked: number | undefined;
  const at = (s: number): [number, number] => [from[0] + ux * s, from[2] + uz * s];
  /** Whether a ladder or vines is in the blocks at `s` along the leg between heights `low` and `high`. */
  const climbable = (s: number, low: number, high: number): boolean => {
    const [x, z] = at(s);
    for (let y = Math.floor(low + 0.01); y < high - 0.01; y++) if (reader.climbable(x, y, z)) return true;
    return false;
  };

  // The walking height: where the piece starts, unless the ground under it is within a step of that.
  let level = ground[0] !== undefined && Math.abs(ground[0] - from[1]) <= STEP ? ground[0] : from[1];
  heights[0] = level;
  walked[0] = true;
  /** The first sample of the walk the piece is on (a jump can't take off before it). */
  let since = 0;
  let j = 0;
  /** Puts an arc's heights in, from its takeoff to its landing, and walks on from there. */
  const fly = (arc: Arc): void => {
    for (let k = arc.from + 1; k < arc.land; k++) {
      heights[k] = arc.heights[k - arc.from - 1];
      air[k] = true;
      walked[k] = false;
    }
    heights[arc.land] = arc.landY;
    walked[arc.land] = true;
    level = arc.landY;
    j = arc.land;
    since = arc.land;
  };
  /** Nothing gets the piece on from sample `k`: it stays at its height to the end. */
  const stop = (k: number): void => {
    blocked = k * ds;
    for (let m = k + 1; m <= n; m++) {
      heights[m] = level;
      walked[m] = false;
    }
    j = n;
  };

  while (j < n) {
    const next = ground[j + 1];
    if (next !== undefined && Math.abs(next - level) <= STEP) {
      // A step up: over its edge by a lip as the piece's front gets to it (the slope lifts it there).
      if (next > level + 0.01) heights[j] = Math.max(heights[j], next + LIP);
      level = next;
      j++;
      heights[j] = level;
      walked[j] = true;
      continue;
    }
    if (next !== undefined && next > level) {
      // Up more than a step: the top is the highest the piece will stand on once all of it is on.
      let top = next;
      for (let k = j + 1; k <= Math.min(n, j + 1 + 2 * reach); k++) {
        const g = ground[k];
        if (g !== undefined && g > top && g - next <= STEP) top = g;
      }
      // The face: where the piece's front first meets it.
      const face = j * ds + ds / 2 + PIECE_HALF;
      if (top - level > JUMP_UP) {
        // Taller than a jump: climbed if there's a ladder or vines on it, else nothing gets the piece up.
        if (!climbable(face - 0.25, level, top)) {
          stop(j);
          continue;
        }
        const spot = Math.max(since * ds, face - PIECE_HALF - CLIMB_GAP);
        climbs.push({ at: spot, from: level, to: top });
        // Up the climb, then on over the top: the heights past the climbing spot are the top's, and a
        // lip over it until all of the piece is over it.
        for (let k = Math.floor(spot / ds) + 1; k <= j; k++) {
          heights[k] = top + LIP;
          walked[k] = false;
        }
        level = top;
        since = j;
        continue;
      }
      const arc = jump(j, j + 1);
      if (arc) fly(arc);
      else stop(j);
      continue;
    }
    if (next !== undefined) {
      // Down more than a step. A dip the piece is over for no more than WALK_OVER is walked over.
      const back = backAt(j + 1);
      if (back !== undefined && (back - (j + 1)) * ds <= WALK_OVER) {
        hold(j + 1, back);
        continue;
      }
      // The edge: where the piece's back leaves it.
      const edge = j * ds + ds / 2 - PIECE_HALF;
      const low = next;
      if (climbable(edge + 0.25, low, level)) {
        const spot = edge + PIECE_HALF + CLIMB_GAP;
        const after = Math.min(n, Math.ceil(spot / ds - 1e-9));
        for (let k = j + 1; k < after; k++) {
          heights[k] = level;
          walked[k] = false;
        }
        const bottom = ground[after] ?? low;
        climbs.push({ at: spot, from: level, to: bottom });
        heights[after] = bottom;
        walked[after] = true;
        level = bottom;
        j = after;
        since = after;
        continue;
      }
      const arc = fall(j);
      if (arc) fly(arc);
      else stop(j);
      continue;
    }
    // A gap: nothing under the piece (or water or lava). Its far side is the next ground the piece
    // can get onto.
    let far: number | undefined;
    for (let k = j + 2; k <= Math.min(n, j + 1 + Math.ceil(MAX_GAP / ds)); k++) {
      const g = ground[k];
      if (g !== undefined) {
        if (g - level <= JUMP_UP && level - g <= MAX_DROP) far = k;
        break;
      }
    }
    if (far === undefined) {
      stop(j);
      continue;
    }
    if ((far - (j + 1)) * ds <= WALK_OVER && Math.abs((ground[far] ?? level) - level) <= STEP) {
      hold(j + 1, far);
      continue;
    }
    const arc = jump(j, far);
    if (arc) fly(arc);
    else stop(j);
  }

  // A step on a slope: each walked height is lifted toward a step up just ahead and kept up after a
  // step down just behind, within the same stretch of walking.
  const smooth = heights.slice();
  const upReach = Math.ceil((STEP + LIP) / SLOPE_UP / ds);
  const downReach = Math.ceil(STEP / SLOPE_DOWN / ds);
  for (let k = 0; k <= n; k++) {
    if (!walked[k]) continue;
    let h = heights[k];
    for (let m = k + 1; m <= Math.min(n, k + upReach) && walked[m]; m++) h = Math.max(h, heights[m] - (m - k) * ds * SLOPE_UP);
    for (let m = k - 1; m >= Math.max(0, k - downReach) && walked[m]; m--) h = Math.max(h, heights[m] - (k - m) * ds * SLOPE_DOWN);
    smooth[k] = h;
  }
  const climbTicks = climbs.reduce((sum, climb) => sum + Math.ceil(Math.abs(climb.to - climb.from) / CLIMB_SPEED) + 10, 0);
  return { span, step: ds, heights: smooth, air, ground: ground.map((g) => g ?? null), climbs, ...(blocked !== undefined ? { blocked } : {}), climbTicks };

  /** The first sample from `k` on where the ground is back within a step of the walking height. */
  function backAt(k: number): number | undefined {
    for (let m = k; m <= Math.min(n, k + Math.ceil(MAX_GAP / ds)); m++) {
      const g = ground[m];
      if (g !== undefined && Math.abs(g - level) <= STEP) return m;
    }
    return undefined;
  }

  /** The piece keeps its height over samples `k` to `until` (not including it): a crack walked over. */
  function hold(k: number, until: number): void {
    for (let m = k; m < until; m++) {
      heights[m] = level;
      walked[m] = false;
    }
    j = until - 1;
  }

  /**
   * The best jump from the walk before sample `edge` (its last sample at the walking height) over to
   * the ground from sample `farSide` on: each takeoff within TAKEOFF_REACH of the edge and each of
   * JUMP_SPEEDS, flown as a player flies (gravity and drag each tick, `perTick` along); one that
   * clears everything and comes down on the far side, the closest to a plain jump landing LAND_PAST
   * in, wins.
   */
  function jump(edge: number, farSide: number): Arc | undefined {
    const earliest = Math.max(since, edge - Math.round(TAKEOFF_REACH / ds));
    let best: { arc: Arc; score: number } | undefined;
    for (let t = edge; t >= earliest; t--) {
      for (const up of JUMP_SPEEDS) {
        const arc = flight(t, heights[t], up, farSide);
        if (!arc) continue;
        const score = 10 * Math.abs(up - PLAIN_JUMP) + Math.abs(arc.land * ds - (farSide * ds + LAND_PAST)) + 0.3 * (edge - t) * ds + (brief(arc) ? BRIEF : 0);
        if (!best || score < best.score) best = { arc, score };
      }
    }
    return best?.arc;
  }

  /** Whether the ground an arc lands on changes by more than a step again within MIN_STAY (the leg's end doesn't count). */
  function brief(arc: Arc): boolean {
    for (let k = arc.land + 1; k <= Math.min(n, arc.land + Math.round(MIN_STAY / ds)); k++) {
      const g = ground[k];
      if (g === undefined || Math.abs(g - arc.landY) > STEP) return true;
    }
    return false;
  }

  /** A flight from sample `t` at height `y0` going up at `up` a tick: where it comes down, if it comes down well (not into a side, nor before `farSide`, nor past the leg's end). */
  function flight(t: number, y0: number, up: number, farSide: number): Arc | undefined {
    const path: number[] = [];
    let s = t * ds;
    let y = y0;
    let v = up;
    let k = t + 1;
    let before = y0;
    /** Samples in a tick's step. */
    const lag = Math.max(1, Math.round(perTick / ds));
    for (let tick = 0; tick < 200; tick++) {
      const s2 = s + perTick;
      const y2 = y + v;
      while (k <= n && k * ds <= s2 + 1e-9) {
        const yk = y + (y2 - y) * ((k * ds - s) / perTick);
        const g = ground[k];
        if (g !== undefined && v > 0 && yk < g + CLEAR) return undefined;
        if (v <= 0) {
          // Coming down, a player moves down before along, so it can't go under ground that was under
          // it a tick back: higher ground there (a hurdle's back) would catch it.
          let behind = -Infinity;
          for (let m = Math.max(t + 1, k - lag); m < k; m++) behind = Math.max(behind, ground[m] ?? -Infinity);
          if (behind > (g ?? -Infinity) + 0.01 && yk < behind - 0.01) return undefined;
        }
        if (g !== undefined && yk < g - 0.01) {
          // Down onto its top: over it the sample before (and by a lip over an edge there), else into its side.
          const edge = (ground[k - 1] ?? -Infinity) < g - 0.01;
          if (k < farSide || before < g + (edge ? CLEAR : 0)) return undefined;
          return { from: t, land: k, landY: g, heights: path };
        }
        path.push(yk);
        before = yk;
        k++;
      }
      if (k > n || y2 < y0 - MAX_DROP) return undefined;
      s = s2;
      y = y2;
      v = (v - GRAVITY) * DRAG;
    }
    return undefined;
  }

  /** Walking off the edge after sample `edge` and falling as a player falls, to the ground below (or the leg's end). */
  function fall(edge: number): Arc | undefined {
    const path: number[] = [];
    let s = edge * ds;
    let y = level;
    let v = 0;
    let k = edge + 1;
    for (let tick = 0; tick < 200; tick++) {
      v = (v - GRAVITY) * DRAG;
      const s2 = s + perTick;
      const y2 = y + v;
      while (k <= n && k * ds <= s2 + 1e-9) {
        const yk = y + (y2 - y) * ((k * ds - s) / perTick);
        const g = ground[k];
        if (g !== undefined && yk <= g) return { from: edge, land: k, landY: g, heights: path };
        path.push(yk);
        k++;
      }
      if (k > n) {
        // The leg ends in the air: it lands where the leg ends.
        const g = ground[n];
        if (g === undefined) return undefined;
        path.pop();
        return { from: edge, land: n, landY: g, heights: path };
      }
      if (y2 < level - MAX_DROP) return undefined;
      s = s2;
      y = y2;
    }
    return undefined;
  }
}

/** The feet's planned height at `s` along the leg. */
export function heightAt(plan: LegPlan, s: number): number {
  const { heights, step } = plan;
  const i = Math.max(0, Math.min(heights.length - 1, s / step));
  const a = Math.floor(i);
  const b = Math.min(heights.length - 1, a + 1);
  return heights[a] + (heights[b] - heights[a]) * (i - a);
}

/**
 * The upward strength of a push (applyKnockback's verticalStrength) that moves a player `move`
 * blocks up this tick (down when less than 0), going `vy` blocks a tick up now. A push gives a player
 * min(v, 1.2v + 0.49(vy - 0.08)) up (docs/spike-results.md, "A push down"): rising, what's asked;
 * falling, a part of the fall is kept.
 */
export function pushUp(move: number, vy: number): number {
  const kept = 0.49 * (vy - GRAVITY);
  return Math.max(-1.5, Math.min(1, Math.max(move, (move - kept) / 1.2)));
}

/**
 * The top of a stair block at (fx, fz) inside it (each 0 to 1): the half it faces is a full block
 * high, the other half a slab (weirdo_direction 0 east, 1 west, 2 south, 3 north: Java's facing,
 * docs/spike-results.md); a corner (minecraft:corner) is Java's shape for it; upside down, its top is
 * a full block's.
 */
export function stairTop(states: Readonly<Record<string, string | number | boolean>>, fx: number, fz: number): number {
  if (states.upside_down_bit === true || states.upside_down_bit === 1) return 1;
  const facing = Number(states.weirdo_direction ?? 0);
  // East, west, south, north; turned a quarter clockwise and counterclockwise (seen from above).
  const clockwise = [2, 3, 1, 0][facing] ?? 2;
  const counter = [3, 2, 0, 1][facing] ?? 3;
  const inHalf = (side: number): boolean => (side === 0 ? fx >= 0.5 : side === 1 ? fx < 0.5 : side === 2 ? fz >= 0.5 : fz < 0.5);
  const corner = String(states["minecraft:corner"] ?? "none");
  const high =
    corner === "outer_left"
      ? inHalf(facing) && inHalf(counter)
      : corner === "outer_right"
        ? inHalf(facing) && inHalf(clockwise)
        : corner === "inner_left"
          ? inHalf(facing) || inHalf(counter)
          : corner === "inner_right"
            ? inHalf(facing) || inHalf(clockwise)
            : inHalf(facing);
  return high ? 1 : 0.5;
}
