import { describe, expect, it } from "vitest";
import type { Box } from "@minecade/minigame-core/config";
import {
  blockBox,
  describeBox,
  edgePoints,
  floorAt,
  growBox,
  nudgeBox,
  parseHeight,
  planePoints,
  sameBox,
  sizeText,
  topCenter,
  type Point,
} from "../behavior_pack/scripts/boxes.ts";

const none = { west: 0, east: 0, down: 0, up: 0, north: 0, south: 0 };

describe("selection boxes", () => {
  it("starts at one block and grows to each block used on, on every axis", () => {
    let box = blockBox([5, 64, -3]);
    expect(sizeText(box)).toBe("1 x 1 x 1");
    box = growBox(box, [10, 60, -3]);
    box = growBox(box, [2, 70, 4]);
    expect(box).toEqual({ min: [2, 60, -3], max: [10, 70, 4] });
    expect(sameBox(growBox(box, [5, 65, 0]), box)).toBe(true);
    expect(describeBox(box)).toBe("9 x 11 x 8 blocks, from 2 60 -3 to 10 70 4");
  });

  it("nudges sides outward or inward, never inside out", () => {
    const box: Box = { min: [0, 60, 0], max: [9, 69, 9] };
    expect(nudgeBox(box, { ...none, west: 2, up: -3, south: 1 })).toEqual({ min: [-2, 60, 0], max: [9, 66, 10] });
    expect(nudgeBox(box, { ...none, east: -9 })).toEqual({ min: [0, 60, 0], max: [0, 69, 9] });
    expect(nudgeBox(box, { ...none, east: -10 })).toBeUndefined();
    expect(nudgeBox(box, { ...none, down: -6, up: -5 })).toBeUndefined();
  });

  it("puts the bottom at kill Y, and finds the top center", () => {
    const box: Box = { min: [0, 60, 0], max: [9, 69, 9] };
    expect(floorAt(box, 50)).toEqual({ min: [0, 50, 0], max: [9, 69, 9] });
    expect(floorAt(box, 69)?.min[1]).toBe(69);
    expect(floorAt(box, 70)).toBeUndefined();
    expect(topCenter(box)).toEqual({ x: 5, y: 70, z: 5 });
  });

  it("reads typed heights within the world", () => {
    expect(parseHeight(" 58 ")).toBe(58);
    expect(parseHeight("-64")).toBe(-64);
    expect(parseHeight("319")).toBe(319);
    expect(parseHeight("320")).toBeUndefined();
    expect(parseHeight("58.5")).toBeUndefined();
    expect(parseHeight("")).toBeUndefined();
  });
});

describe("outline dots", () => {
  const key = (point: Point) => `${point.x},${point.y},${point.z}`;

  it("draws a one-block box as its 8 corners", () => {
    const points = edgePoints(blockBox([0, 0, 0]), { x: 0, y: 0, z: 0 }, 40, 1000);
    expect(points.map(key).sort()).toEqual(["0,0,0", "0,0,1", "0,1,0", "0,1,1", "1,0,0", "1,0,1", "1,1,0", "1,1,1"]);
  });

  it("puts a dot at every block along each edge, and none twice", () => {
    const points = edgePoints({ min: [0, 0, 0], max: [2, 1, 0] }, { x: 1, y: 1, z: 0 }, 40, 1000);
    // Outer edges: 4 along x with 4 dots, 4 along y with 1 between corners, 4 along z with none.
    expect(points).toHaveLength(16 + 4);
    expect(new Set(points.map(key)).size).toBe(points.length);
  });

  it("spaces dots out to stay within the budget, keeping the corners", () => {
    const box: Box = { min: [0, 0, 0], max: [99, 0, 0] };
    const points = edgePoints(box, { x: 50, y: 0, z: 0 }, 1000, 100);
    expect(points.length).toBeLessThanOrEqual(100);
    expect(points.length).toBeGreaterThan(25);
    const keys = new Set(points.map(key));
    for (const corner of ["0,0,0", "100,0,0", "0,1,1", "100,1,1"]) expect(keys.has(corner)).toBe(true);
  });

  it("only draws what's within reach", () => {
    const box: Box = { min: [0, 0, 0], max: [999, 0, 0] };
    const points = edgePoints(box, { x: 500, y: 0, z: 0 }, 10, 1000);
    expect(points.every((point) => Math.hypot(point.x - 500, point.y, point.z) <= 10)).toBe(true);
    expect(points.filter((point) => point.y === 0 && point.z === 0)).toHaveLength(21);
    expect(edgePoints(box, { x: 500, y: 50, z: 0 }, 10, 1000)).toEqual([]);
  });

  it("dots the kill Y plane near the player, inside the bounds", () => {
    const bounds: Box = { min: [-5, 50, -5], max: [4, 90, 4] };
    const points = planePoints(58, bounds, { x: 0, y: 60, z: 0 }, 24, 3);
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point.y === 58 && point.x >= -5 && point.x <= 5 && point.z >= -5 && point.z <= 5)).toBe(true);
    expect(points.every((point) => point.x % 3 === 0 && point.z % 3 === 0)).toBe(true);
    expect(planePoints(58, bounds, { x: 0, y: 90, z: 0 }, 24, 3)).toEqual([]);
    const open = planePoints(58, undefined, { x: 100, y: 58, z: 100 }, 6, 3);
    expect(open.every((point) => Math.hypot(point.x - 100, point.z - 100) <= 6)).toBe(true);
    expect(open.length).toBeGreaterThan(5);
  });
});
