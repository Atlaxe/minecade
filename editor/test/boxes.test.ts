import { describe, expect, it } from "vitest";
import type { Box } from "@minecade/minigame-core/config";
import {
  blockBox,
  DOTS,
  describeBox,
  floorAt,
  growBox,
  nearDots,
  nudgeBox,
  parseHeight,
  planePoints,
  rectDots,
  sameBox,
  sizeText,
  topCenter,
  viewDots,
  type Point,
  type View,
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
  /** Looking along +z from `eye`. */
  const viewFrom = (x: number, y: number, z: number): View => ({ eye: { x, y, z }, look: { x: 0, y: 0, z: 1 } });

  it("draws every edge of a box in front, each corner once, none twice", () => {
    const dots = viewDots(blockBox([0, 0, 5]), viewFrom(0.5, 0.5, 0), 1000);
    const keys = new Set(dots.map(key));
    expect(keys.size).toBe(dots.length);
    for (const corner of ["0,0,5", "1,0,5", "0,1,5", "1,1,5", "0,0,6", "1,0,6", "0,1,6", "1,1,6"]) expect(keys.has(corner)).toBe(true);
  });

  it("spaces dots by distance, on multiples of the gap from the box's corner", () => {
    const box: Box = { min: [0, 0, 2], max: [0, 0, 401] };
    const dots = viewDots(box, viewFrom(0, 0, 0), 10_000).filter((dot) => dot.x === 0 && dot.y === 0);
    const near = dots.filter((dot) => dot.z < 10).length;
    const far = dots.filter((dot) => dot.z >= 30 && dot.z < 38).length;
    expect(near).toBeGreaterThan(far);
    // Along the edge's axis every dot short of the pull-in distance sits on a multiple of the narrowest gap.
    const unmoved = dots.filter((dot) => dot.z < DOTS.project - 0.5);
    expect(unmoved.length).toBeGreaterThan(30);
    expect(unmoved.every((dot) => ((dot.z - 2) / DOTS.minGap) % 1 === 0)).toBe(true);
  });

  it("pulls far dots in along the line of sight, so a box shows from any distance", () => {
    const box: Box = { min: [-10, -10, 1000], max: [9, 9, 1019] };
    const view = viewFrom(0, 0, 0);
    const dots = viewDots(box, view, 1000);
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(Math.hypot(dot.x, dot.y, dot.z)).toBeCloseTo(DOTS.project, 6);
      expect(dot.size).toBeCloseTo(Math.min(DOTS.maxSize, DOTS.project * DOTS.sizePerBlock), 6);
    }
    // The corner at -10 -10 1000 is drawn on its own line of sight.
    const scale = DOTS.project / Math.hypot(10, 10, 1000);
    expect(dots.some((dot) => Math.abs(dot.x + 10 * scale) < 1e-9 && Math.abs(dot.y + 10 * scale) < 1e-9 && Math.abs(dot.z - 1000 * scale) < 1e-9)).toBe(true);
  });

  it("sizes near dots by their distance", () => {
    const [dot] = viewDots(blockBox([0, 0, 30]), viewFrom(0, 0, 0), 1000);
    expect(dot.size).toBeCloseTo(Math.max(DOTS.minSize, Math.hypot(dot.x, dot.y, dot.z) * DOTS.sizePerBlock), 6);
  });

  it("leaves out what's behind the player", () => {
    expect(viewDots(blockBox([0, 0, -20]), viewFrom(0, 0, 0), 1000)).toEqual([]);
    expect(nearDots([{ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 5 }], viewFrom(0, 0, 0)).map(key)).toEqual(["0,0,5"]);
  });

  it("widens the gaps to stay within the budget", () => {
    const box: Box = { min: [-50, -50, 2], max: [49, 49, 101] };
    const dots = viewDots(box, viewFrom(0, 0, 0), 150);
    expect(dots.length).toBeLessThanOrEqual(150);
    expect(dots.length).toBeGreaterThan(30);
  });

  it("outlines the kill Y plane's rectangle", () => {
    const keys = new Set(rectDots(-5, 5, 5, 15, 58, viewFrom(0, 60, 0), 1000).map(key));
    for (const corner of ["-5,58,5", "5,58,5", "-5,58,15", "5,58,15"]) expect(keys.has(corner)).toBe(true);
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
