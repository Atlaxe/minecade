import { describe, expect, it } from "vitest";
import { MAP_TIMES, blockOf, exactPosition, isExact, mapTimeTicks, positionText, worldPoint } from "../src/map-config.ts";

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
