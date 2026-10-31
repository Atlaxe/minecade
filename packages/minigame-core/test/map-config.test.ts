import { describe, expect, it } from "vitest";
import { MAP_TIMES, blockOf, boundsBox, boundsBoxes, enclosingBox, exactPosition, isExact, mapTimeTicks, positionText, worldPoint } from "../src/map-config.ts";

describe("mapTimeTicks", () => {
  it("turns a time's name into ticks, and passes ticks through", () => {
    expect(mapTimeTicks("midnight")).toBe(18000);
    expect(mapTimeTicks("day")).toBe(MAP_TIMES.day);
    expect(mapTimeTicks(0)).toBe(0);
    expect(mapTimeTicks(23999)).toBe(23999);
  });

  it("is undefined when unset or not a time", () => {
    for (const time of [undefined, "dusk", "toString", 24000, -1, 1.5, true]) expect(mapTimeTicks(time)).toBeUndefined();
  });
});

describe("positions", () => {
  it("stands whole positions in their block's middle, and exact ones where they are", () => {
    expect(worldPoint([3, 65, -2])).toEqual({ x: 3.5, y: 65, z: -1.5 });
    expect(worldPoint([3, 65, -2, 90, 0])).toEqual({ x: 3.5, y: 65, z: -1.5 });
    expect(worldPoint([3.27, 65, -2])).toEqual({ x: 3.27, y: 65, z: -2 });
    expect(isExact([3, 65.5, -2])).toBe(false);
    expect(isExact([3, 65, -1.84])).toBe(true);
  });

  it("makes exact positions to hundredths that never read as a block's middle", () => {
    expect(exactPosition({ x: 3.274, y: 65, z: -1.836 })).toEqual([3.27, 65, -1.84]);
    expect(exactPosition({ x: 2, y: 65, z: 5 }, { yaw: 0, pitch: 10 })).toEqual([2.01, 65, 5, 0, 10]);
    expect(Object.is(exactPosition({ x: -0.001, y: 65, z: 0.5 })[0], -0)).toBe(false);
  });

  it("finds the block and prints positions", () => {
    expect(blockOf([3.27, 65, -1.84])).toEqual([3, 65, -2]);
    expect(positionText([3.27, 65, -1.84, 90, 0])).toBe("3.27 65 -1.84");
    expect(positionText([3, 65, -2])).toBe("3 65 -2");
  });
});

describe("bounds", () => {
  const west = { min: [-20, 40, -5], max: [-10, 80, 5] } as const;
  const east = { min: [10, 50, -8], max: [20, 90, 5] } as const;

  it("lists one box or several, and the box around them all", () => {
    expect(boundsBoxes({})).toEqual([]);
    expect(boundsBoxes({ bounds: { min: [...west.min], max: [...west.max] } })).toHaveLength(1);
    const both = { bounds: [{ min: [...west.min], max: [...west.max] }, { min: [...east.min], max: [...east.max] }] } as { bounds: { min: [number, number, number]; max: [number, number, number] }[] };
    expect(boundsBoxes(both)).toHaveLength(2);
    expect(boundsBox(both)).toEqual({ min: [-20, 40, -8], max: [20, 90, 5] });
    expect(boundsBox({})).toBeUndefined();
    expect(enclosingBox([])).toBeUndefined();
  });
});
