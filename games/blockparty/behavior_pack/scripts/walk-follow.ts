// Block Party's walk, one tick at a time: where a piece on a leg (walk-plan.ts's plan for it) is
// pushed this tick, from where it is now. pieces.ts walks players and bots with it, and the headless
// check (spike/blockparty/walk.ts) walks a SimulatedPlayer over the test board with it, so the check
// runs exactly what the game does (docs/spike-results.md, "Walking the test board").
//   - Along: each push asks for what takes the piece a tick's step from the speed it has (a push
//     keeps part of it: half of what's left after friction, so more of it in the air).
//   - Up: the plan's change in height over the step, and most of the gap to the plan; never under
//     the ground the piece's front sweeps over this tick (a lip over it where it rises: a player
//     moves up or down before along, so a dip under an edge it's about to meet stops it there);
//     over walked ground, a piece over the plan is let down onto it (a little under, so it lands).
//   - Climbs, in order: the piece walks to a ladder's foot at the height it's on, climbs at its spot
//     (to a lip over the top going up), and once off it walks on at the climb's end, never back on.
//   - A piece that stops getting anywhere is lifted (a lip it didn't clear), and after STUCK ticks
//     it's put at the leg's end.
// Pure, so the tests can follow a plan with a model of a pushed player.
import type { Vec3 } from "./board.ts";
import { CLIMB_SPEED, LIP, PIECE_HALF, heightAt, pushUp, type Climb, type LegPlan } from "./walk-plan.ts";

/** applyKnockback's horizontal speed is 0.4 times the force's length (docs/spike-results.md, "Knockback"). */
export const KNOCKBACK_SPEED = 0.4;
/**
 * How much of the speed a player had a push keeps: half of what's left after a tick's friction,
 * 0.546 on the ground and 0.91 in the air (docs/spike-results.md, "A push down"), as getVelocity reads
 * it (the last tick's move).
 */
export const GROUND_KEEP = 0.273;
export const AIR_KEEP = 0.455;
/** How much of the sideways drift off a leg's line is taken back each tick. */
const STEER = 0.4;
/** How much of the gap between the piece's height and the plan's is made up each tick (on top of the plan's own change). */
const FOLLOW = 0.7;
/** A piece this far under its plan has fallen (a jump that missed): it's put at the leg's end. */
const FELL = 2.5;
/** How close to a climb's spot the climb starts. */
const CLIMB_REACH = 0.15;
/** How far past a climb's spot its end still holds the piece (up: over the top until all of it is). */
const CLIMB_AFTER = 0.6;
/** How far under walked ground a piece over it is asked to go, so it lands rather than hovers. */
const SETTLE = 0.05;
/** A tick going less than this share of a step along is a stall (outside a climb). */
const STALL = 0.25;
/** Stalled this many ticks running, the piece is lifted over what's ahead; this many more, put at the leg's end. */
const STALL_LIFT = 2;
const STUCK = 10;

/** A leg: from `a` to `b` (feet), its length along the ground and its way. */
export interface Leg {
  a: Vec3;
  b: Vec3;
  span: number;
  ux: number;
  uz: number;
}

export function legOf(a: Vec3, b: Vec3): Leg {
  const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
  return { a, b, span, ux: span > 0 ? (b[0] - a[0]) / span : 0, uz: span > 0 ? (b[2] - a[2]) / span : 1 };
}

/** What following a leg keeps from tick to tick. */
export interface FollowState {
  /** The most the piece has been off the leg's line. */
  drift: number;
  /** The next climb (its index in the plan's). */
  climb: number;
  /** Where the piece was along the leg last tick, when it was walking. */
  last?: number;
  /** Ticks running it's barely moved. */
  stalled: number;
}

export function newFollow(): FollowState {
  return { drift: 0, climb: 0, stalled: 0 };
}

/** This tick: a push (`want` blocks along the ground, `up` blocks up), or the leg is over (`end`: got there; `skip`: put at its end). */
export type FollowStep =
  | { kind: "push"; want: { x: number; z: number }; up: number; climbing: boolean; along: number; target: number }
  | { kind: "end"; along: number }
  | { kind: "skip"; why: "blocked" | "fell" | "stuck"; along: number };

/** Where on `leg` (planned as `plan`) a piece at `at` goes this tick, walking `perTick` blocks a tick. */
export function followTick(plan: LegPlan, leg: Leg, state: FollowState, at: { x: number; y: number; z: number }, perTick: number): FollowStep {
  const { a, span, ux, uz } = leg;
  const along = (at.x - a[0]) * ux + (at.z - a[2]) * uz;
  if (span - along <= perTick) return { kind: "end", along };
  const side = (at.x - a[0]) * -uz + (at.z - a[2]) * ux;
  state.drift = Math.max(state.drift, Math.abs(side));
  const steer = { x: -uz * side * STEER, z: ux * side * STEER };
  const pending = plan.climbs[state.climb];
  if (pending && along >= pending.at - CLIMB_REACH) {
    const up = pending.to > pending.from;
    const done = up ? at.y >= pending.to + LIP - 0.02 : at.y <= pending.to + 0.03;
    if (!done) {
      // On a ladder or vines: held at the climbing spot, up (to a lip over the top) or down at a climb's speed.
      state.last = undefined;
      state.stalled = 0;
      const forward = Math.max(-perTick, Math.min(perTick, (pending.at - along) * 0.5));
      const rise = up ? Math.min(CLIMB_SPEED, pending.to + LIP - at.y) : -Math.min(CLIMB_SPEED, at.y - pending.to);
      return { kind: "push", want: { x: ux * forward + steer.x, z: uz * forward + steer.z }, up: rise, climbing: true, along, target: pending.to };
    }
    state.climb++;
  }
  const here = planAt(plan, state, along);
  if (at.y < here - FELL) return { kind: "skip", why: "fell", along };
  if (plan.blocked !== undefined && along >= plan.blocked - PIECE_HALF) return { kind: "skip", why: "blocked", along };
  // Barely moving: lifted over what's ahead, then given up on.
  state.stalled = state.last !== undefined && along - state.last < STALL * perTick ? state.stalled + 1 : 0;
  state.last = along;
  if (state.stalled >= STALL_LIFT + STUCK) return { kind: "skip", why: "stuck", along };
  let next = planAt(plan, state, along + perTick);
  const rise = sweepTop(plan, state, along, perTick);
  if (rise !== undefined) next = Math.max(next, rise + LIP);
  // Under the plan: its change in height over this tick's step, and most of the gap to it. Over it:
  // straight down to it (onto walked ground, a little under).
  const walked = !plan.air[sampleOf(plan, along + perTick)];
  let up = at.y <= next ? next - here + FOLLOW * (here - at.y) : next - at.y - (walked ? SETTLE : 0);
  if (state.stalled >= STALL_LIFT) up = Math.max(up, Math.max(next, planAt(plan, state, along + 2 * perTick)) + LIP - at.y);
  return { kind: "push", want: { x: ux * perTick + steer.x, z: uz * perTick + steer.z }, up, climbing: false, along, target: next };
}

const sampleOf = (plan: LegPlan, s: number): number => Math.round(Math.max(0, Math.min(plan.heights.length - 1, s / plan.step)));

/**
 * The highest ground the piece's front sweeps over this tick (its middle from `along` a step on),
 * when that's higher than the ground under it now; not past the next climb's foot, nor where the
 * walk is blocked.
 */
function sweepTop(plan: LegPlan, state: FollowState, along: number, perTick: number): number | undefined {
  const { ground, step } = plan;
  const under = ground[sampleOf(plan, along)];
  let end = along + perTick + step;
  const ahead = plan.climbs[state.climb];
  if (ahead) end = Math.min(end, ahead.at - 0.2);
  if (plan.blocked !== undefined) end = Math.min(end, plan.blocked - PIECE_HALF);
  let top: number | undefined;
  for (let k = Math.max(0, Math.ceil(along / step)); k <= Math.min(ground.length - 1, Math.floor(end / step)); k++) {
    const g = ground[k];
    if (g !== null && (top === undefined || g > top)) top = g;
  }
  return top !== undefined && top > (under ?? -Infinity) + 0.01 ? top : undefined;
}

/**
 * The plan's height at `s` along the leg as a walk follows it: short of the next climb, the height
 * at its foot (the plan jumps to its top at its spot); just past the last one, its end (up: a lip
 * over its top, until all of the piece is over it).
 */
function planAt(plan: LegPlan, state: FollowState, s: number): number {
  const ahead: Climb | undefined = plan.climbs[state.climb];
  if (ahead && s > ahead.at - 0.2) return heightAt(plan, ahead.at - 0.2);
  const behind: Climb | undefined = plan.climbs[state.climb - 1];
  if (behind && s < behind.at + CLIMB_AFTER) return behind.to > behind.from ? Math.max(heightAt(plan, s), behind.to + LIP) : Math.min(heightAt(plan, s), behind.to);
  return heightAt(plan, s);
}

/**
 * The applyKnockback that moves a player `want` blocks along the ground this tick from the speed
 * they have (`velocity`, getVelocity's; `onGround`, isOnGround's), and `up` blocks up (down when less
 * than 0: pushUp works out the strength). On the ground with nothing to go up, nothing goes up.
 */
export function knockbackFor(want: { x: number; z: number }, up: number, velocity: { x: number; y: number; z: number }, onGround: boolean): { x: number; z: number; strength: number } {
  const keep = onGround ? GROUND_KEEP : AIR_KEEP;
  const strength = onGround && Math.abs(up) < 0.005 ? 0 : pushUp(up, velocity.y);
  return { x: (want.x - velocity.x * keep) / KNOCKBACK_SPEED, z: (want.z - velocity.z * keep) / KNOCKBACK_SPEED, strength };
}
