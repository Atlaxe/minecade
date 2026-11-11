import { describe, expect, it } from "vitest";
import type { Box } from "@minecade/minigame-core/config";
import { boxEdges, boxUnder, keptBox, rayBox, raySheet, segmentDistance, sheetEdges, sheetUnder, type PickBox } from "../pick.ts";

const DOWN = [0, -1, 0] as const;

describe("keptBox", () => {
  const box: Box = { min: [0, 60, 0], max: [9, 69, 9] };
  it("keeps the part of a box the cuts keep", () => {
    expect(keptBox({ min: [0, 60, 0], max: [9, 69, 9] }, {})).toEqual(box);
    expect(keptBox(box, { top: 64 })).toEqual({ min: [0, 60, 0], max: [9, 64, 9] });
    expect(keptBox(box, { x: { at: 3, side: "below" } })).toEqual({ min: [0, 60, 0], max: [3, 69, 9] });
    expect(keptBox(box, { z: { at: 3, side: "above" } })).toEqual({ min: [0, 60, 3], max: [9, 69, 9] });
  });

  it("is nothing when the cuts keep none of it", () => {
    expect(keptBox(box, { top: 59 })).toBeUndefined();
    expect(keptBox(box, { x: { at: 10, side: "above" } })).toBeUndefined();
  });
});

describe("rayBox", () => {
  it("is where a ray goes into and out of a box of whole blocks", () => {
    expect(rayBox([-5, 0.5, 0.5], [1, 0, 0], { min: [0, 0, 0], max: [2, 0, 0] })).toEqual({ enter: 5, exit: 8 });
    expect(rayBox([0.5, 10, 0.5], DOWN, { min: [0, 0, 0], max: [0, 4, 0] })).toEqual({ enter: 5, exit: 10 });
  });

  it("starts below 0 from inside, and is nothing for a ray that misses or points away", () => {
    expect(rayBox([1, 0.5, 0.5], [1, 0, 0], { min: [0, 0, 0], max: [2, 0, 0] })?.enter).toBeLessThan(0);
    expect(rayBox([-5, 3, 0.5], [1, 0, 0], { min: [0, 0, 0], max: [2, 0, 0] })).toBeUndefined();
    expect(rayBox([5, 0.5, 0.5], [1, 0, 0], { min: [0, 0, 0], max: [2, 0, 0] })).toBeUndefined();
  });
});

describe("boxUnder", () => {
  // Looking straight down at a 24 block plot on a floor at y 63, inside bounds around the map.
  const camera = [5.5, 120, 5.5] as const;
  const plot: PickBox = { key: "regions.plot#0", box: { min: [0, 63, 0], max: [23, 86, 23] } };
  const bounds: PickBox = { key: "bounds#0", box: { min: [-20, 40, -20], max: [40, 100, 40] }, bounds: true };
  const floor = 120 - 64; // the ray meets the floor's top at y 64

  it("picks a region the ray goes into before the block, the block being inside it", () => {
    expect(boxUnder(camera, DOWN, [bounds, plot], floor)).toBe("regions.plot#0");
  });

  it("picks the smallest of the regions the ray goes into", () => {
    const zone: PickBox = { key: "regions.build#0", box: { min: [-10, 50, -10], max: [30, 90, 30] } };
    expect(boxUnder(camera, DOWN, [zone, plot], floor)).toBe("regions.plot#0");
    expect(boxUnder([-5.5, 120, -5.5], DOWN, [zone, plot], floor)).toBe("regions.build#0");
  });

  it("picks the bounds only when the ray comes out of them before any block", () => {
    expect(boxUnder(camera, DOWN, [bounds], floor)).toBeUndefined();
    expect(boxUnder(camera, DOWN, [bounds], Infinity)).toBe("bounds#0");
  });

  it("leaves out a box the camera is in, and a region past the block", () => {
    expect(boxUnder([5.5, 70, 5.5], DOWN, [plot], 6)).toBeUndefined();
    expect(boxUnder([5.5, 120, 5.5], DOWN, [plot], 10)).toBeUndefined();
  });
});

describe("sheetUnder", () => {
  const rect = { x0: -11, z0: -11, x1: 12, z1: 12 };
  const sheets = [
    { key: "killY", y: 30 },
    { key: "buildLimit.above", y: 100 },
  ];

  it("picks the nearest sheet the ray crosses inside its rectangle, when no block is in the way or behind", () => {
    expect(sheetUnder([0, 120, 0], DOWN, sheets, rect, Infinity)).toBe("buildLimit.above");
    expect(sheetUnder([0, 50, 0], DOWN, sheets, rect, Infinity)).toBe("killY");
    expect(raySheet([0, 50, 0], DOWN, 30, rect)).toBe(20);
  });

  it("picks nothing over a block, or past the sheets' rectangle", () => {
    expect(sheetUnder([0, 120, 0], DOWN, sheets, rect, 40)).toBeUndefined();
    expect(sheetUnder([20, 120, 0], DOWN, sheets, rect, Infinity)).toBeUndefined();
  });
});

describe("outlines", () => {
  it("measures a spot's distance to a segment on the canvas", () => {
    expect(segmentDistance(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(segmentDistance(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(1, 1, 0, 0, 0, 0)).toBeCloseTo(Math.SQRT2);
  });

  it("has a box's 12 edges, corner to corner, and a sheet's 4", () => {
    const edges = boxEdges({ min: [0, 0, 0], max: [1, 2, 3] });
    expect(edges).toHaveLength(12);
    for (const [a, b] of edges) expect(a.filter((value, axis) => value !== b[axis])).toHaveLength(1);
    expect(edges.flat()).toContainEqual([2, 3, 4]);
    expect(sheetEdges(30, { x0: 0, z0: 0, x1: 4, z1: 5 })).toEqual([
      [[0, 30, 0], [4, 30, 0]],
      [[4, 30, 0], [4, 30, 5]],
      [[4, 30, 5], [0, 30, 5]],
      [[0, 30, 5], [0, 30, 0]],
    ]);
  });
});
