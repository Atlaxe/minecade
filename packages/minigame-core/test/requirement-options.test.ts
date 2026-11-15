// Requirement options (docs/plans/block-party.md, "Requirement options"): a game marks checklist rows
// adjustable (map.adjustable), each map turns them off or sets their count (map.json
// "requirements"), and the checklist, the validator, the build's borrow check and map edits follow.
import { describe, expect, it } from "vitest";
import type { MapRequirementsConfig } from "../src/config.ts";
import { mapChecklist } from "../src/map-checklist.ts";
import type { MapConfig } from "../src/map-config.ts";
import { applyEdit, MapEditError } from "../src/map-edit.ts";
import { adjustableProblems, choiceProblems, mapRequirements, optionKey, requirementOptions, uncoveredRequirements } from "../src/map-requirements.ts";
import { validateMapConfig, type MapRules } from "../src/map-validate.ts";

const TEAMS = [
  { id: "red", name: "Red" },
  { id: "blue", name: "Blue" },
];

/** An arena game: Kill Y (can go), 1 kill region (1 to 3), 2 holes a team (2 to 4), team spawns (fixed). */
const ARENA: MapRequirementsConfig = {
  teamSpawns: true,
  killY: true,
  regions: { kill: { label: "Kill region" } },
  points: { hole: { label: "Hole", count: 2, perTeam: true } },
  adjustable: { killY: { off: true }, "regions.kill": { min: 1, max: 3 }, "points.hole": { min: 2, max: 4, off: true } },
};
const SHAPE = { kind: "game" as const, maxPlayers: 4, teams: TEAMS };
const RULES: MapRules = { ...SHAPE, requires: ARENA };

/** A map with everything the game asks for by default. */
function fullMap(extra: Partial<MapConfig> = {}): MapConfig {
  return {
    name: "Arena",
    spawns: [[0, 64, 0]],
    spectatorSpawn: [0, 70, 0],
    killY: 40,
    teamSpawns: { red: [[5, 64, 0]], blue: [[-5, 64, 0]] },
    points: { "hole.red": [[1, 64, 1], [2, 64, 2]], "hole.blue": [[-1, 64, 1], [-2, 64, 2]] },
    regions: { kill: [{ min: [10, 40, 10], max: [12, 42, 12] }] },
    ...extra,
  };
}

describe("requirement options", () => {
  it("lists the rows a game lets each map change, one per row key without its team", () => {
    expect(requirementOptions(ARENA, SHAPE)).toEqual([
      { key: "killY", label: "Kill Y", off: true },
      { key: "points.hole", label: "Hole", count: 2, off: true, range: { min: 2, max: 4 } },
      { key: "regions.kill", label: "Kill region", count: 1, off: false, range: { min: 1, max: 3 } },
    ]);
    const rows = mapRequirements(ARENA, SHAPE);
    expect(rows.filter((row) => optionKey(row) === "points.hole").map((row) => row.key)).toEqual(["points.hole.red", "points.hole.blue"]);
    expect(rows.find((row) => row.key === "teamSpawns.red") && optionKey(rows.find((row) => row.key === "teamSpawns.red")!)).toBe("teamSpawns");
  });

  it("drops the rows a map turns off and takes the counts it sets; choices the game doesn't allow change nothing", () => {
    const rows = mapRequirements(ARENA, { ...SHAPE, choices: { killY: false, "regions.kill": 3, "points.hole": 9, "teamSpawns": false } });
    expect(rows.some((row) => row.key === "killY")).toBe(false);
    expect(rows.find((row) => row.key === "regions.kill")?.min).toBe(3);
    expect(rows.find((row) => row.key === "points.hole.red")?.min).toBe(2);
    expect(rows.some((row) => row.key === "teamSpawns.red")).toBe(true);
  });

  it("makes the checklist and the validator follow the map's own choices", () => {
    const noKill = fullMap({ killY: undefined, requirements: { killY: false } });
    expect(validateMapConfig(noKill, RULES)).toEqual([]);
    expect(mapChecklist(noKill, RULES).rows.some((row) => row.key === "killY")).toBe(false);
    const threeRegions = fullMap({ requirements: { "regions.kill": 3 } });
    expect(validateMapConfig(threeRegions, RULES)).toEqual(['this game needs 3 "regions.kill" entries, has 1']);
    expect(mapChecklist(threeRegions, RULES).rows.find((row) => row.key === "regions.kill")).toMatchObject({ need: 3, have: 1, done: false });
    expect(validateMapConfig(fullMap({ killY: undefined }), RULES)).toEqual(['this game needs "killY"']);
  });

  it("names the choices a game doesn't allow", () => {
    const map = fullMap({ requirements: { "regions.kill": false, "points.hole": 7, bounds: false, killY: 2 } as never });
    expect(validateMapConfig(map, RULES)).toEqual([
      '"requirements.regions.kill": this game can\'t do without Kill region',
      '"requirements.points.hole" must be a whole number from 2 to 4',
      '"requirements.bounds": this game doesn\'t let a map change that',
      '"requirements.killY": Kill Y has no count to set',
    ]);
    expect(choiceProblems([], ARENA, SHAPE)).toEqual(['"requirements" must map checklist rows to false (off) or a count']);
    expect(choiceProblems({ killY: "no" }, ARENA, SHAPE)).toEqual(['"requirements.killY" must be false (off) or a count']);
  });

  it("checks a game's map.adjustable at build", () => {
    expect(adjustableProblems(ARENA, SHAPE)).toEqual([]);
    const bad: MapRequirementsConfig = {
      killY: true,
      regions: { kill: { count: 2 } },
      adjustable: { bounds: { off: true }, killY: { min: 1, max: 2 }, "regions.kill": { min: 3, max: 5 }, spawns: {} },
    };
    expect(adjustableProblems(bad, SHAPE)).toEqual([
      "map.adjustable.bounds: no row of the game's checklist has that key",
      "map.adjustable.killY: Kill Y has no count to change, only off",
      "map.adjustable.regions.kill: the game's own count (2) must be from 3 to 5",
      "map.adjustable.spawns: nothing to change (give off, or min and max)",
    ]);
  });

  it("lets a borrowing game count on a lender's row only down to what a lender's map can be left with", () => {
    const lender: MapRequirementsConfig = { killY: true, regions: { kill: { count: 2 } }, adjustable: { killY: { off: true }, "regions.kill": { min: 1, max: 3 } } };
    const strict: MapRequirementsConfig = { killY: true, regions: { kill: { count: 2 } } };
    const has = mapRequirements(lender, SHAPE);
    expect(uncoveredRequirements(mapRequirements(strict, SHAPE), has).map((row) => row.key)).toEqual(["killY", "regions.kill"]);
    const easy: MapRequirementsConfig = { ...strict, adjustable: { killY: { off: true }, "regions.kill": { min: 1, max: 2 } } };
    expect(uncoveredRequirements(mapRequirements(easy, SHAPE), has)).toEqual([]);
    expect(uncoveredRequirements(mapRequirements({ killY: true, adjustable: { killY: { off: true } } }, SHAPE), mapRequirements({}, SHAPE))).toEqual([]);
  });
});

describe("the requirement edit", () => {
  it("sets, changes and removes a map's choices, keeping only what differs", () => {
    const map = fullMap();
    const off = applyEdit(map, { op: "requirement", key: "killY", value: false });
    expect(off.requirements).toEqual({ killY: false });
    expect(Object.keys(off).indexOf("requirements")).toBe(Object.keys(off).indexOf("regions") + 1);
    const both = applyEdit(off, { op: "requirement", key: "regions.kill", value: 3 });
    expect(both.requirements).toEqual({ killY: false, "regions.kill": 3 });
    expect(applyEdit(both, { op: "requirement", key: "killY", value: 1 }).requirements).toEqual({ killY: 1, "regions.kill": 3 });
    const back = applyEdit(applyEdit(both, { op: "requirement", key: "killY" }), { op: "requirement", key: "regions.kill" });
    expect("requirements" in back).toBe(false);
    expect(map.requirements).toBeUndefined();
  });

  it("refuses a key that isn't a row's and a count under 1", () => {
    expect(() => applyEdit(fullMap(), { op: "requirement", key: "points.a.b", value: false })).toThrow(MapEditError);
    expect(() => applyEdit(fullMap(), { op: "requirement", key: "killY", value: 0 })).toThrow(MapEditError);
  });
});
