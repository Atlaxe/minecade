// The spike's test board and walk paths: the layout around the square, the route a roll takes, the
// corners pieces share, and where a walk is along its path.
import { describe, expect, it } from "vitest";
import { STAND, along, angleGap, boardBox, distance, floorOf, mapSpaces, pathOf, route, standAt, testSpaces, yawTo, type Vec3 } from "../behavior_pack/scripts/board.ts";

describe("the test board", () => {
  const spaces = testSpaces([0, 64, 48], 6);

  it("has 12 spaces around a square, Start first, each the spacing from the next", () => {
    expect(spaces).toHaveLength(12);
    expect(spaces[0].type).toBe("start");
    for (let i = 0; i < spaces.length; i++) expect(distance(spaces[i].at, spaces[(i + 1) % spaces.length].at)).toBeCloseTo(6);
    expect(new Set(spaces.map((space) => space.at.join(","))).size).toBe(12);
  });

  it("puts spaces on block middles, a piece on the pedestal's top over the floor", () => {
    expect(STAND).toBe(0.5);
    for (const space of spaces) {
      expect(floorOf(space)).toBe(64);
      expect(space.at[1]).toBe(64 + STAND);
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

describe("turning", () => {
  it("turns the short way round", () => {
    expect(angleGap(170, -170)).toBe(20);
    expect(angleGap(-170, 170)).toBe(-20);
    expect(angleGap(0, 90)).toBe(90);
  });
});

describe("a map's own spaces", () => {
  const spaces = mapSpaces([
    { id: 4, at: [10, 64, 0], type: "blue", next: [9] },
    { id: 9, at: [10.3, 64, 5], next: [2, 4] },
    { id: 2, at: [0, 64, 0], type: "start", next: [4] },
  ]);

  it("puts Start first, whole x and z at a block's middle, a piece on the pedestal's top, links as indices, and Blue for no type", () => {
    expect(spaces.map((space) => [space.id, space.type, space.at, space.next])).toEqual([
      [2, "start", [0.5, 64.5, 0.5], [1]],
      [4, "blue", [10.5, 64.5, 0.5], [2]],
      [9, "blue", [10.3, 64.5, 5.5], [0, 1]],
    ]);
    expect(spaces.map(floorOf)).toEqual([64, 64, 64]);
  });

  it("walks each space's first way on", () => {
    expect(route(spaces, 0, 4).map((space) => space.id)).toEqual([4, 9, 2, 4]);
  });
});
