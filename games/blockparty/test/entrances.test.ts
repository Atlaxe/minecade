// How the NPCs come and go (entrances.ts): who stands at a space all game, Chris's balloon flight,
// and the Wandering Trader's walk in with his llamas on his trail.
import { describe, expect, it } from "vitest";
import type { Space, Vec3 } from "../behavior_pack/scripts/board.ts";
import { CRUISE, descentPlan, extendTrail, flightPlan, residentRole, smooth, trailPoint, walkInPath, type TrailPoint } from "../behavior_pack/scripts/entrances.ts";
import { besideSpace } from "../behavior_pack/scripts/stage-layout.ts";

/** A straight run of spaces east (+x), 4 apart, looping back. */
function line(count = 8): Space[] {
  return Array.from({ length: count }, (_, index) => ({ index, type: "blue", at: [index * 4, 64, 0] as Vec3, floor: 63.5, next: [(index + 1) % count] }));
}

describe("the NPCs' entrances", () => {
  it("brings Chris straight down under his balloon at a Star's reveal, eased at both ends", () => {
    const descent = descentPlan([0, 74, 0], [0, 64, 0]);
    expect(descent.ticks).toBeGreaterThanOrEqual(40);
    expect(descent.at(0)).toEqual([0, 74, 0]);
    expect(descent.at(descent.ticks)).toEqual([0, 64, 0]);
    // Slow at first, quickest in the middle.
    const first = 74 - descent.at(1)[1];
    const middle = descent.at(Math.round(descent.ticks / 2))[1] - descent.at(Math.round(descent.ticks / 2) + 1)[1];
    expect(middle).toBeGreaterThan(first);
    expect(descentPlan([0, 65, 0], [0, 64, 0]).ticks).toBe(20);
  });

  it("keeps the Referee at Versus spaces and the Villager at the Shop all game, nobody elsewhere", () => {
    expect(residentRole("versus")).toBe("referee");
    expect(residentRole("shop")).toBe("villager");
    for (const type of ["blue", "red", "item", "chance", "warden", "start"]) expect(residentRole(type)).toBeUndefined();
  });

  it("eases from 0 to 1 and stays there", () => {
    expect(smooth(-1)).toBe(0);
    expect(smooth(0.5)).toBe(0.5);
    expect(smooth(2)).toBe(1);
  });

  it("flies Chris up over the higher end, across and down onto the spot, starting and ending where he should", () => {
    const from: Vec3 = [0, 64, 0];
    const to: Vec3 = [30, 66, 10];
    const flight = flightPlan(from, to);
    expect(flight.at(0)).toEqual(from);
    expect(flight.at(flight.ticks)).toEqual(to);
    const path = Array.from({ length: flight.ticks + 1 }, (_, tick) => flight.at(tick));
    // Up to the cruise over the higher end, and never below the lower one.
    expect(Math.max(...path.map((at) => at[1]))).toBeCloseTo(66 + CRUISE);
    expect(Math.min(...path.map((at) => at[1]))).toBeGreaterThanOrEqual(64 - 1e-9);
    // It rises before it goes far across, and it's across before it's far down.
    const halfUp = path.findIndex((at) => at[1] >= 64 + (66 + CRUISE - 64) / 2);
    expect(Math.hypot(path[halfUp][0], path[halfUp][2])).toBeLessThan(1);
    // No step jumps: the most it moves in a tick is under a block.
    for (let i = 1; i < path.length; i++) expect(Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2])).toBeLessThan(1);
  });

  it("keeps a far flight short", () => {
    const near = flightPlan([0, 64, 0], [10, 64, 0]);
    const far = flightPlan([0, 64, 0], [400, 64, 0]);
    expect(far.ticks - near.ticks).toBeLessThanOrEqual(110);
  });

  it("walks the Trader in beside the path the way it came, from out of the shot, ending on his spot", () => {
    const spaces = line();
    const space = spaces[5];
    const spot = besideSpace(space, spaces)[0];
    const path = walkInPath(space, spaces, 0, spot);
    expect(path.at(-1)).toEqual(spot);
    // Beside the spaces before it, on the same side of the path, and at least 12 blocks off at the start.
    for (const point of path) expect(point[2]).toBeCloseTo(spot[2]);
    expect(Math.hypot(path[0][0] - spot[0], path[0][2] - spot[2])).toBeGreaterThanOrEqual(12);
    // It comes from behind (west), getting nearer all the way.
    for (let i = 1; i < path.length; i++) expect(path[i][0]).toBeGreaterThan(path[i - 1][0]);
  });

  it("still walks in from out of the shot with no path behind the space", () => {
    const alone: Space[] = [{ index: 0, type: "item", at: [0, 64, 0], floor: 63.5, next: [] }];
    const spot: Vec3 = [0, 63.5, 2.5];
    const path = walkInPath(alone[0], alone, 0, spot);
    expect(path.at(-1)).toEqual(spot);
    expect(Math.hypot(path[0][0] - spot[0], path[0][2] - spot[2])).toBeGreaterThanOrEqual(12);
  });

  it("keeps each llama a set way back along the Trader's trail", () => {
    const trail: TrailPoint[] = [];
    for (let x = 0; x <= 10; x += 0.5) extendTrail(trail, [x, 64, 0]);
    // Standing still adds nothing.
    extendTrail(trail, [10, 64, 0]);
    expect(trail.at(-1)?.along).toBeCloseTo(10);
    expect(trailPoint(trail, 2)?.[0]).toBeCloseTo(8);
    expect(trailPoint(trail, 3.75)?.[0]).toBeCloseTo(6.25);
    // Further back than the trail goes: its start.
    expect(trailPoint(trail, 50)).toEqual([0, 64, 0]);
    expect(trailPoint([], 1)).toBeUndefined();
  });
});
