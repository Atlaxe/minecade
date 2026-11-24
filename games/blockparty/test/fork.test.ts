// A fork in the board's path (fork.ts): which way is Left and which Right as the piece arrives, the
// buttons' lines, and the camera looking down a way.
import { describe, expect, it } from "vitest";
import { mapSpaces, type Space, type Vec3 } from "../behavior_pack/scripts/board.ts";
import { forkButtons, forkLabelIds, forkOrder, forkShot, headingInto, leftTurn, wayAhead } from "../behavior_pack/scripts/fork.ts";

const space = (index: number, at: [number, number], next: number[]): Space => ({ index, type: "blue", at: [at[0], 64, at[1]] as Vec3, floor: 63.5, next });

/**
 * A walk north (-z) from 0 to the fork at 1, which leads west (2) and east (3), both coming back to 4.
 * Going north, west is on the left.
 */
function northFork(): Space[] {
  return [space(0, [0, 10], [1]), space(1, [0, 5], [3, 2]), space(2, [-5, 0], [4]), space(3, [5, 0], [4]), space(4, [0, -5], [0])];
}

describe("a fork in the path", () => {
  it("knows which way a turn goes: going north, west is left and east is right", () => {
    expect(leftTurn([0, -1], [-1, 0])).toBeCloseTo(90);
    expect(leftTurn([0, -1], [1, 0])).toBeCloseTo(-90);
    // Going south, it's the other way round.
    expect(leftTurn([0, 1], [1, 0])).toBeCloseTo(90);
    expect(leftTurn([0, -1], [0, -1])).toBeCloseTo(0);
  });

  it("orders the ways left to right as the piece arrives, whatever order the board lists them in", () => {
    const spaces = northFork();
    const fork = spaces[1];
    const heading = headingInto(spaces, fork, 0);
    expect(heading[0]).toBeCloseTo(0);
    expect(heading[1]).toBeCloseTo(-1);
    // next is [3 (east), 2 (west)]: the left button is the west way, index 1 in next.
    expect(forkOrder(spaces, fork, heading).map((way) => fork.next[way])).toEqual([2, 3]);
  });

  it("finds the way in from the space leading to the fork when the walk starts on it, else the ways' middle", () => {
    const spaces = northFork();
    const heading = headingInto(spaces, spaces[1]);
    expect(heading[1]).toBeCloseTo(-1);
    // Nothing leads in: the middle of the ways (north here).
    const alone = [space(0, [0, 0], [1, 2]), space(1, [-5, -5], [0]), space(2, [5, -5], [0])];
    alone[1].next = [];
    alone[2].next = [];
    const middle = headingInto(alone, alone[0]);
    expect(middle[0]).toBeCloseTo(0);
    expect(middle[1]).toBeCloseTo(-1);
    expect(forkOrder(alone, alone[0], middle).map((way) => alone[0].next[way])).toEqual([1, 2]);
  });

  it("names the buttons Left and Right, with Middle between for three or more", () => {
    expect(forkLabelIds(2)).toEqual(["branch.left", "branch.right"]);
    expect(forkLabelIds(3)).toEqual(["branch.left", "branch.middle", "branch.right"]);
    expect(forkLabelIds(4)).toEqual(["branch.left", "branch.middle", "branch.middle", "branch.right"]);
  });

  it("names the buttons by where the ways go when the map doesn't name them", () => {
    const spaces = northFork();
    const fork = spaces[1];
    // next is [3 (east), 2 (west)]: Left is west (index 1 in next), Right east (index 0).
    expect(forkButtons(spaces, fork, headingInto(spaces, fork, 0))).toEqual({ ways: [1, 0], ids: ["branch.left", "branch.right"] });
  });

  it("names the buttons as the map names the ways (the user, 2026-11-24), Left first and Right last", () => {
    const spaces = northFork();
    const fork = spaces[1];
    const heading = headingInto(spaces, fork, 0);
    // The camera sees it the other way round: east is named Left, west Right.
    fork.ways = { 3: "left", 2: "right" };
    expect(forkButtons(spaces, fork, heading)).toEqual({ ways: [0, 1], ids: ["branch.left", "branch.right"] });
    // One named Straight, the other left to the game: it stays Left (west), Straight to its right.
    fork.ways = { 3: "straight" };
    expect(forkButtons(spaces, fork, heading)).toEqual({ ways: [1, 0], ids: ["branch.left", "branch.straight"] });
    // Straight and Right: Straight goes left of Right, whichever way they go.
    fork.ways = { 2: "straight", 3: "right" };
    expect(forkButtons(spaces, fork, heading)).toEqual({ ways: [1, 0], ids: ["branch.straight", "branch.right"] });
    fork.ways = { 2: "right", 3: "straight" };
    expect(forkButtons(spaces, fork, heading)).toEqual({ ways: [0, 1], ids: ["branch.straight", "branch.right"] });
    // Two in the middle (Up and Down) keep the order they go, left to right.
    fork.ways = { 2: "down", 3: "up" };
    expect(forkButtons(spaces, fork, heading)).toEqual({ ways: [1, 0], ids: ["branch.down", "branch.up"] });
  });

  it("takes a map's way names to the spaces' indexes", () => {
    const spaces = mapSpaces([
      { id: 5, at: [0, 64, 0], type: "blue", next: [1, 9], ways: { "9": "straight", "1": "left" } },
      { id: 1, at: [0, 64, -4], type: "start", next: [5] },
      { id: 9, at: [4, 64, 0], type: "red", next: [5] },
    ]);
    // Start goes first, so space 5 is index 1, space 1 index 0 and space 9 index 2.
    expect(spaces[1].ways).toEqual({ 0: "left", 2: "straight" });
    expect(spaces[0]).not.toHaveProperty("ways");
  });

  it("follows a way a few spaces on, stopping where it comes round", () => {
    const spaces = northFork();
    expect(wayAhead(spaces, 2).map((one) => one.index)).toEqual([2, 4, 0]);
    expect(wayAhead(spaces, 2, 2).map((one) => one.index)).toEqual([2, 4]);
    const loop = [space(0, [0, 0], [1]), space(1, [5, 0], [0])];
    expect(wayAhead(loop, 0, 5).map((one) => one.index)).toEqual([0, 1]);
  });

  it("looks down the way from behind the fork, the way the piece came, up high", () => {
    const spaces = northFork();
    const fork = spaces[1];
    const shot = forkShot(fork, [0, -1], wayAhead(spaces, 2));
    // Behind (south of) the fork and above its floor.
    expect(shot.location[2]).toBeGreaterThan(fork.at[2]);
    expect(shot.location[1]).toBeGreaterThan(63.5 + 3);
    // Aimed at the way's second space (the space after the west one).
    expect(shot.facing?.[0]).toBe(0);
    expect(shot.facing?.[2]).toBe(-5);
  });
});
