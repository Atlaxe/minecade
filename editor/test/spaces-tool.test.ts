import { describe, expect, it } from "vitest";
import { linkDots } from "../behavior_pack/scripts/spaces-tool.ts";

describe("the Spaces tool's links", () => {
  it("runs dots from a space toward the next, stopping short of both, with an arrowhead at the end", () => {
    const dots = linkDots({ x: 0.5, y: 64, z: 0.5 }, { x: 5.5, y: 64, z: 0.5 });
    const line = dots.slice(0, -6);
    expect(line[0].x).toBeCloseTo(1.4);
    expect(line.at(-1)!.x).toBeLessThanOrEqual(4.6 + 1e-9);
    expect(line.every((dot) => dot.y === 64.35 && dot.z === 0.5)).toBe(true);
    // The arrowhead's strokes go back from the tip (toward lower x), one either side.
    const head = dots.slice(-6);
    expect(head.every((dot) => dot.x < 4.6)).toBe(true);
    expect(head.some((dot) => dot.z > 0.5) && head.some((dot) => dot.z < 0.5)).toBe(true);
  });

  it("draws nothing between spaces closer than a block and a half", () => {
    expect(linkDots({ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 })).toEqual([]);
  });
});
