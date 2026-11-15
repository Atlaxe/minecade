// The spike's test board and walk paths: the layout around the square, the route a roll takes, the
// corners pieces share, and where a walk is along its path.
import { describe, expect, it } from "vitest";
import { along, angleGap, boardBox, distance, easedShare, pathOf, route, slowPoints, standAt, testSpaces, yawTo, type Vec3 } from "../behavior_pack/scripts/board.ts";

describe("the test board", () => {
  const spaces = testSpaces([0, 64, 48], 6);

  it("has 12 spaces around a square, Start first, each the spacing from the next", () => {
    expect(spaces).toHaveLength(12);
    expect(spaces[0].type).toBe("start");
    for (let i = 0; i < spaces.length; i++) expect(distance(spaces[i].at, spaces[(i + 1) % spaces.length].at)).toBeCloseTo(6);
    expect(new Set(spaces.map((space) => space.at.join(","))).size).toBe(12);
  });

  it("puts spaces on block middles at the pads' height", () => {
    for (const space of spaces) {
      expect(space.at[1]).toBe(64);
      expect(Math.abs(space.at[0] % 1)).toBeCloseTo(0.5);
      expect(Math.abs(space.at[2] % 1)).toBeCloseTo(0.5);
    }
  });

  it("routes a roll around the loop, landing on the last space", () => {
    expect(route(spaces, 10, 3).map((space) => space.index)).toEqual([11, 0, 1]);
    expect(route(spaces, 0, 6).at(-1)?.index).toBe(6);
  });

  it("gives four pieces a corner each of a pad", () => {
    const corners = [0, 1, 2, 3].map((corner) => standAt(spaces[0], corner).join(","));
    expect(new Set(corners).size).toBe(4);
    expect(standAt(spaces[0], -1)).toEqual(spaces[0].at);
  });

  it("boxes the board with room around it", () => {
    const box = boardBox(spaces);
    for (const space of spaces) {
      expect(space.at[0]).toBeGreaterThan(box.min[0]);
      expect(space.at[0]).toBeLessThan(box.max[0]);
      expect(space.at[2]).toBeGreaterThan(box.min[2]);
      expect(space.at[2]).toBeLessThan(box.max[2]);
    }
  });
});

describe("walk paths", () => {
  const points: Vec3[] = [
    [0, 64, 0],
    [6, 64, 0],
    [6, 64, 6],
  ];
  const path = pathOf(points);

  it("measures the path", () => {
    expect(path.length).toBeCloseTo(12);
    expect(path.at).toEqual([0, 6, 12]);
  });

  it("finds the point and the leg's facing along it", () => {
    expect(along(path, 3).point).toEqual([3, 64, 0]);
    expect(along(path, 3).yaw).toBeCloseTo(-90);
    expect(along(path, 9).point).toEqual([6, 64, 3]);
    expect(along(path, 9).yaw).toBeCloseTo(0);
    expect(along(path, 99).point).toEqual([6, 64, 6]);
    expect(along(path, -1).point).toEqual([0, 64, 0]);
  });

  it("faces south at yaw 0 and west at 90, as Bedrock does", () => {
    expect(yawTo([0, 0, 0], [0, 0, 1])).toBeCloseTo(0);
    expect(yawTo([0, 0, 0], [-1, 0, 0])).toBeCloseTo(90);
    expect(Math.abs(yawTo([0, 0, 0], [0, 0, -1]))).toBeCloseTo(180);
  });
});

describe("easing into corners", () => {
  // An L: 6 east, then 4 south, with a step along the first leg that doesn't turn.
  const path = pathOf([[0, 64, 0], [3, 64, 0], [6, 64, 0], [6, 64, 4]]);

  it("slows down at the start, each corner and the end, not where the way stays the same", () => {
    expect(slowPoints(path)).toEqual([0, 6, 10]);
    expect(slowPoints(pathOf([[0, 64, 0], [0, 64, 0.01], [0, 64, 5]]))).toEqual([0, 5]);
  });

  it("goes from the floor at a slow point to full speed `ease` blocks away, smoothly", () => {
    const slow = slowPoints(path);
    expect(easedShare(6, slow, 2, 0.1)).toBeCloseTo(0.1);
    expect(easedShare(3, slow, 2, 0.1)).toBe(1);
    expect(easedShare(5, slow, 2, 0.1)).toBeCloseTo(0.1 + 0.9 * 0.5);
    expect(easedShare(5.5, slow, 2, 0.1)).toBeLessThan(easedShare(5, slow, 2, 0.1));
    expect(easedShare(6, slow, 0, 0.1)).toBe(1);
  });

  it("turns the short way round", () => {
    expect(angleGap(170, -170)).toBe(20);
    expect(angleGap(-170, 170)).toBe(-20);
    expect(angleGap(0, 90)).toBe(90);
  });
});
