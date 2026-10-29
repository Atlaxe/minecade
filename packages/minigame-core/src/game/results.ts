// How a match (or round) ended, and the default "last standing" rule.
import type { EndReason } from "../protocol/index.ts";

export type Result =
  /** Players won; `team` is set when a team won. */
  | { kind: "win"; players: string[]; team?: string; reason: string }
  | { kind: "draw"; reason: string }
  /** Everyone won or lost together (PvE). */
  | { kind: "coop"; won: boolean; reason: string }
  /** Not a real result: stats aren't recorded. */
  | { kind: "aborted"; reason: Exclude<EndReason, "finished"> };

export function draw(reason: string): Result {
  return { kind: "draw", reason };
}

export function aborted(reason: Exclude<EndReason, "finished">): Result {
  return { kind: "aborted", reason };
}

/** The end_game reason for a result. */
export function endReason(result: Result): EndReason {
  return result.kind === "aborted" ? result.reason : "finished";
}

/**
 * Last player or team standing. `sides` are the players or teams still in it; `startedWith` is
 * how many sides the contest began with. A contest that started with one side (solo testing)
 * never "wins" this way; it ends when that side is out or time runs out.
 */
export function lastStanding(sides: string[], startedWith: number): { winner?: string; everyoneOut: boolean } {
  if (sides.length === 0) return { everyoneOut: true };
  if (startedWith >= 2 && sides.length === 1) return { winner: sides[0], everyoneOut: false };
  return { everyoneOut: false };
}
