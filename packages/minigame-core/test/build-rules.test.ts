import { describe, expect, it } from "vitest";
import { buildAllowed } from "../src/game/build.ts";
import { MapView } from "../src/game/map-view.ts";
import type { MapConfig } from "../src/map-config.ts";

describe("buildAllowed", () => {
  const map: MapConfig = { name: "Bridge", spawns: [[0, 65, 0]], bounds: { min: [-20, 0, -20], max: [20, 120, 20] } };

  it("keeps blocks within the build limit: none above its top plane, none below its bottom one", () => {
    const view = new MapView({ ...map, buildLimit: { above: 80, below: 60 } });
    expect(buildAllowed([0, 79, 0], view, [])).toBe(true);
    expect(buildAllowed([0, 80, 0], view, [])).toBe(false);
    expect(buildAllowed([0, 60, 0], view, [])).toBe(true);
    expect(buildAllowed([0, 59, 0], view, [])).toBe(false);
  });

  it("builds anywhere in the bounds without one", () => {
    const view = new MapView(map);
    expect(buildAllowed([0, 110, 0], view, [])).toBe(true);
    expect(buildAllowed([0, 121, 0], view, [])).toBe(false);
  });
});
