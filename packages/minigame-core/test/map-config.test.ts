import { describe, expect, it } from "vitest";
import { MAP_TIMES, mapTimeTicks } from "../src/map-config.ts";

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
