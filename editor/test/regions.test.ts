import { describe, expect, it } from "vitest";
import type { EditorRules, MapConfig } from "@minecade/minigame-core/config";
import {
  BOUNDS_COLOR,
  KILL_COLOR,
  boundaryRows,
  boundsAround,
  outlineShown,
  toggleBoundary,
  entryBox,
  outlineBoxes,
  regionEntries,
  regionLabel,
  regionName,
  regionTargets,
  targetKeyOf,
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
      ["addBounds", "Add to bounds (another box)"],
      ["regions.kill", "Kill region"],
      ["regions.bombA", "Bomb site A"],
      ["regions.buyZone.red", "Buy zone (Red)"],
      ["regions.buyZone.blue", "Buy zone (Blue)"],
      ["regions.plot", "plot"],
      ["new", "New region..."],
    ]);
  });

  it("makes the bounds and the kill region tiles, and groups a team's regions for the Team list", () => {
    const targets = regionTargets(map, rules);
    expect(targets.filter((target) => target.tile).map((target) => target.groupLabel)).toEqual(["Bounds", "Add bounds", "Kill region"]);
    const red = targets.find((target) => target.key === "regions.buyZone.red");
    expect(red).toMatchObject({ group: "regions.buyZone", groupLabel: "Buy zone", teamLabel: "Red", tile: false });
    expect(targets.find((target) => target.key === "regions.plot")).toMatchObject({ group: "regions.plot", groupLabel: "plot", tile: false });
    expect(targets.at(-1)).toMatchObject({ key: "new", groupLabel: "New region", tile: false });
    // A box the map has is saved where its target's key says.
    const entries = regionEntries(map, rules);
    expect(entries.map(targetKeyOf)).toEqual(["bounds", "regions.kill", "regions.kill", "regions.buyZone.red", "regions.plot"]);
  });

  it("keys targets the way the checklist keys its rows", () => {
    const empty = regionTargets({ name: "Empty", spawns: [] }, rules);
    expect(empty.find((target) => target.key === "regions.buyZone.blue")?.name).toBe("buyZone.blue");
    // Another bounds box only once the map has one.
    expect(empty.some((target) => target.kind === "addBounds")).toBe(false);
  });

  it("says Bounds replaces them all when there are several", () => {
    const several = { ...map, bounds: [map.bounds, { min: [30, 50, 0], max: [40, 60, 5] }] } as MapConfig;
    expect(regionTargets(several, rules)[0].label).toBe("Bounds (replaces all 2 boxes)");
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
      ["bounds#0", "Bounds"],
      ["regions.kill#0", "Kill region 1"],
      ["regions.kill#1", "Kill region 2"],
      ["regions.buyZone.red#0", "Buy zone (Red) 1"],
      ["regions.plot#0", "plot 1"],
    ]);
    expect(entries[2].region).toEqual({ name: "kill", index: 1 });
  });

  it("numbers several bounds boxes, and draws kill Y over the box around them", () => {
    const second = { min: [30, 50, 0], max: [40, 60, 5] } as const;
    const several = { ...map, bounds: [map.bounds, second] } as MapConfig;
    const entries = regionEntries(several, rules).filter((entry) => entry.bounds !== undefined);
    expect(entries.map((entry) => [entry.key, entry.label, entry.bounds])).toEqual([
      ["bounds#0", "Bounds 1", 0],
      ["bounds#1", "Bounds 2", 1],
    ]);
    expect(entryBox(several, entries[1])).toEqual(second);
    expect(boundsAround(several)).toEqual({ min: [-20, 50, -20], max: [40, 90, 20] });
    expect(boundsAround({ name: "Empty", spawns: [] })).toBeUndefined();
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
    expect(outlines.find((outline) => outline.key === "bounds#0")?.color).toEqual(BOUNDS_COLOR);
    expect(outlines.find((outline) => outline.key === "regions.kill#1")?.color).toEqual(KILL_COLOR);
    expect(outlines.find((outline) => outline.key === "regions.buyZone.red#0")?.color).toEqual({ red: 1, green: 85 / 255, blue: 85 / 255 });
    const plot = outlines.find((outline) => outline.key === "regions.plot#0")?.color;
    expect(plot).toBeDefined();
    expect(plot).not.toEqual(BOUNDS_COLOR);
    expect(plot).not.toEqual(KILL_COLOR);
  });
});

describe("the Boundaries view", () => {
  it("has a row per boundary the map has, in outline order", () => {
    expect(boundaryRows({ ...map, killY: 45 }, rules).map((row) => [row.group, row.label, row.detail])).toEqual([
      ["bounds", "Bounds", "white, 1 box"],
      ["killY", "Kill Y", "red plane, y 45"],
      ["regions.kill", "Kill regions", "red, 2 boxes"],
      ["regions.buyZone.red", "Buy zone (Red)", "1 box"],
      ["regions.plot", "plot", "1 box"],
    ]);
    expect(boundaryRows({ name: "Empty", spawns: [] }, rules)).toEqual([]);
  });

  it("groups each outline with its switch", () => {
    const groups = outlineBoxes(map, rules).map((outline) => outline.group);
    expect(groups).toEqual(["bounds", "regions.kill", "regions.kill", "regions.buyZone.red", "regions.plot"]);
    expect(outlineShown("regions.kill", new Set(["regions.kill"]))).toBe(true);
    expect(outlineShown("bounds", new Set(["regions.kill"]))).toBe(false);
    expect(outlineShown("bounds", new Set(["all"]))).toBe(true);
  });

  it("toggles one switch, or all of them; one switch while all are on leaves the others on", () => {
    const groups = ["bounds", "killY", "regions.kill"];
    expect([...toggleBoundary(new Set(), "bounds", groups)]).toEqual(["bounds"]);
    expect([...toggleBoundary(new Set(["bounds"]), "bounds", groups)]).toEqual([]);
    expect([...toggleBoundary(new Set(["bounds"]), "all", groups)]).toEqual(["all"]);
    expect([...toggleBoundary(new Set(["all"]), "all", groups)]).toEqual([]);
    expect([...toggleBoundary(new Set(["all"]), "killY", groups)]).toEqual(["bounds", "regions.kill"]);
  });
});
