import { describe, expect, it } from "vitest";
import { mapChecklist } from "../src/map-checklist.ts";
import type { MapConfig } from "../src/map-config.ts";

const teams = [
  { id: "red", name: "Red" },
  { id: "blue", name: "Blue" },
];

describe("mapChecklist", () => {
  it("asks for each side of the build limit a game needs", () => {
    const rules = { kind: "game" as const, maxPlayers: 2, requires: { spectatorSpawn: true, buildLimit: true } };
    const map: MapConfig = { name: "Bridge", spawns: [[0, 65, 0], [1, 65, 0]], spectatorSpawn: [0, 80, 0], buildLimit: { above: 90 } };
    const checklist = mapChecklist(map, rules);
    expect(checklist.rows.filter((row) => row.field === "buildLimit").map((row) => [row.label, row.done])).toEqual([
      ["Build limit above", true],
      ["Build limit below", false],
    ]);
    expect(checklist.problems).toEqual(['this game needs "buildLimit.below"']);
    expect(mapChecklist({ ...map, buildLimit: { above: 90, below: 60 } }, rules).ready).toBe(true);
  });

  it("counts only the boxes of a region as big as the game asks for", () => {
    const rules = { kind: "game" as const, maxPlayers: 2, requires: { spectatorSpawn: true, regions: { plot: { label: "Build boundary", count: 2, minSize: 24 } } } };
    const big = { min: [0, 64, 0] as [number, number, number], max: [23, 87, 23] as [number, number, number] };
    const small = { min: [40, 64, 0] as [number, number, number], max: [63, 80, 23] as [number, number, number] };
    const map: MapConfig = { name: "Row", spawns: [[0, 65, 0], [1, 65, 0]], spectatorSpawn: [0, 90, 0], regions: { plot: [big, small] } };
    const checklist = mapChecklist(map, rules);
    expect(checklist.rows.filter((row) => row.field === "regions").map((row) => [row.label, row.have, row.need, row.done, row.minSize])).toEqual([["Build boundary", 1, 2, false, 24]]);
    expect(checklist.problems).toEqual(["regions.plot[1] is 24x17x24, smaller than 24 on a side", 'this game needs 2 "regions.plot" entries, has 1']);
    expect(mapChecklist({ ...map, regions: { plot: [big, { ...small, max: [63, 87, 23] }] } }, rules).ready).toBe(true);
  });

  it("counts each requirement and lists the build's problems", () => {
    const map: MapConfig = { name: "Arena", draft: true, spawns: [[0, 65, 0], [1, 65, 0]], points: { "flag.red": [[2, 65, 0]] } };
    const list = mapChecklist(map, {
      kind: "game",
      maxPlayers: 4,
      teams,
      requires: { spectatorSpawn: true, points: { flag: { label: "Flag", perTeam: true } } },
    });
    expect(list.rows.map(({ key, have, need, done }) => [key, have, need, done])).toEqual([
      ["spawns", 2, 4, false],
      ["spectatorSpawn", 0, 1, false],
      ["points.flag.red", 1, 1, true],
      ["points.flag.blue", 0, 1, false],
    ]);
    expect(list.rows[2].label).toBe("Flag (Red)");
    expect(list.ready).toBe(false);
    expect(list.problems).toContain('this game needs a "spectatorSpawn"');
    expect(list.warnings).toEqual([]);
  });

  it("needs no plain spawns for a team spawn game, unless it asks for them (then one, for waiting)", () => {
    const map: MapConfig = { name: "Arena", spawns: [], queueSpawn: [0, 70, 20], teamSpawns: { red: [[1, 65, 0]], blue: [[-1, 65, 0]] } };
    const list = mapChecklist(map, { kind: "game", maxPlayers: 8, teams, requires: { teamSpawns: true } });
    expect(list.rows.some((row) => row.key === "spawns")).toBe(false);
    expect(list.rows.filter((row) => row.field === "teamSpawns").every((row) => row.done)).toBe(true);
    // Its queue spawn is where players watch from too.
    expect(list.rows[0]).toMatchObject({ key: "spectatorOrQueue", have: 1, need: 1, done: true });
    expect(list.ready).toBe(true);
    const asked = mapChecklist({ ...map, spawns: [[0, 65, 0]] }, { kind: "game", maxPlayers: 8, teams, requires: { teamSpawns: true, spawns: {} } });
    expect(asked.rows[0]).toMatchObject({ key: "spawns", have: 1, need: 1, done: true });
  });

  it("warns about two entries on the same block once nothing is missing", () => {
    const list = mapChecklist({ name: "Hall", spawns: [[0, 65, 0], [0, 65, 0]] }, { kind: "lobby" });
    expect(list.ready).toBe(true);
    expect(list.warnings).toEqual(["spawns[1] is in the same block as spawns[0]"]);
  });
});
