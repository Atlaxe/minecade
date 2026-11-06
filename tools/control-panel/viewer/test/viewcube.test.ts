import { describe, expect, it } from "vitest";
import { cubeRegion, regionName } from "../viewcube.ts";

describe("the view cube", () => {
  it("tells a face's middle from an edge and a corner", () => {
    expect(cubeRegion({ x: 0.05, y: 0.5, z: -0.1 })).toEqual([0, 1, 0]);
    expect(cubeRegion({ x: 0.45, y: 0.5, z: 0 })).toEqual([1, 1, 0]);
    expect(cubeRegion({ x: -0.45, y: 0.5, z: 0.4 })).toEqual([-1, 1, 1]);
    expect(cubeRegion({ x: 0.5, y: 0, z: 0 })).toEqual([1, 0, 0]);
  });

  it("names a region for its tooltip", () => {
    expect(regionName([0, 1, 0])).toBe("Top");
    expect(regionName([0, 0, -1])).toBe("North");
    expect(regionName([1, 1, -1])).toBe("Top north-east");
    expect(regionName([-1, -1, 1])).toBe("Bottom south-west");
  });
});
