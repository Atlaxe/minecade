import { describe, expect, it } from "vitest";
import type { EditorRules, MapConfig } from "@minecade/minigame-core/config";
import {
  BOUNDS_COLOR,
  KILL_COLOR,
  entryBox,
  outlineBoxes,
  regionEntries,
  regionLabel,
  regionName,
  regionTargets,
} from "../behavior_pack/scripts/regions.ts";

const rules: EditorRules = {
  kind: "game",
  maxPlayers: 4,
  teams: [
    { id: "red", name: "Red", color: "§c" },
    { id: "blue", name: "Blue", color: "§9" },
  ],
  requires: { regions: { bombA: { label: "Bomb site A" }, buyZone: { label: "Buy zone", perTeam: true } } },
};

const map: MapConfig = {
  name: "Arena",
  spawns: [[0, 65, 0]],
  bounds: { min: [-20, 50, -20], max: [20, 90, 20] },
  regions: {
    kill: [
      { min: [-3, 50, -3], max: [3, 55, 3] },
      { min: [10, 50, 10], max: [12, 55, 12] },
    ],
    "buyZone.red": [{ min: [-18, 60, -18], max: [-14, 64, -14] }],
    plot: [{ min: [0, 60, 0], max: [1, 61, 1] }],
  },
};

describe("region tool targets", () => {
  it("offers the bounds, the kill region, required regions, the map's others, then a new one", () => {
    expect(regionTargets(map, rules).map((target) => [target.key, target.label])).toEqual([
      ["bounds", "Bounds"],
      ["regions.kill", "Kill region"],
      ["regions.bombA", "Bomb site A"],
      ["regions.buyZone.red", "Buy zone (Red)"],
      ["regions.buyZone.blue", "Buy zone (Blue)"],
      ["regions.plot", "plot"],
      ["new", "New region..."],
    ]);
  });

  it("keys targets the way the checklist keys its rows", () => {
    expect(regionTargets({ name: "Empty", spawns: [] }, rules).find((target) => target.key === "regions.buyZone.blue")?.name).toBe("buyZone.blue");
  });

  it("labels team regions of unknown names by their team", () => {
    expect(regionLabel("flag.blue", rules)).toBe("flag (Blue)");
    expect(regionLabel("flag.green", rules)).toBe("flag.green");
  });

  it("accepts plain names for new regions", () => {
    expect(regionName(" lava_pit2 ")).toBe("lava_pit2");
    expect(regionName("2nd")).toBeUndefined();
    expect(regionName("buyZone.red")).toBeUndefined();
    expect(regionName("")).toBeUndefined();
  });
});

describe("the map's boxes", () => {
  it("lists the bounds, then each region's boxes, numbered", () => {
    const entries = regionEntries(map, rules);
    expect(entries.map((entry) => [entry.key, entry.label])).toEqual([
      ["bounds", "Bounds"],
      ["regions.kill#0", "Kill region 1"],
      ["regions.kill#1", "Kill region 2"],
      ["regions.buyZone.red#0", "Buy zone (Red) 1"],
      ["regions.plot#0", "plot 1"],
    ]);
    expect(entries[2].region).toEqual({ name: "kill", index: 1 });
  });

  it("finds an entry's box in the map as it is now", () => {
    const [bounds, kill] = regionEntries(map, rules);
    expect(entryBox(map, kill)).toEqual(kill.box);
    expect(entryBox({ ...map, bounds: undefined }, bounds)).toBeUndefined();
    expect(entryBox({ ...map, regions: { kill: [] } }, kill)).toBeUndefined();
  });

  it("skips malformed boxes from a hand edit", () => {
    const broken = { ...map, bounds: { min: [0, 0] }, regions: { kill: [{ min: [0, 0, 0] }], plot: "no" } } as unknown as MapConfig;
    expect(regionEntries(broken, rules)).toEqual([]);
  });

  it("colors outlines: bounds white, kill red, team regions in the team's color, others in turn", () => {
    const outlines = outlineBoxes(map, rules);
    expect(outlines.find((outline) => outline.key === "bounds")?.color).toEqual(BOUNDS_COLOR);
    expect(outlines.find((outline) => outline.key === "regions.kill#1")?.color).toEqual(KILL_COLOR);
    expect(outlines.find((outline) => outline.key === "regions.buyZone.red#0")?.color).toEqual({ red: 1, green: 85 / 255, blue: 85 / 255 });
    const plot = outlines.find((outline) => outline.key === "regions.plot#0")?.color;
    expect(plot).toBeDefined();
    expect(plot).not.toEqual(BOUNDS_COLOR);
    expect(plot).not.toEqual(KILL_COLOR);
  });
});
