import { describe, expect, it } from "vitest";
import { mapChecklist } from "../src/map-checklist.ts";
import type { MapConfig } from "../src/map-config.ts";

const teams = [
  { id: "red", name: "Red" },
  { id: "blue", name: "Blue" },
];

describe("mapChecklist", () => {
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

  it("needs one plain spawn once a map has team spawns", () => {
    const map: MapConfig = { name: "Arena", spawns: [[0, 65, 0]], teamSpawns: { red: [[1, 65, 0]], blue: [[-1, 65, 0]] } };
    const list = mapChecklist(map, { kind: "game", maxPlayers: 8, teams, requires: { teamSpawns: true } });
    expect(list.rows[0]).toMatchObject({ key: "spawns", have: 1, need: 1, done: true });
    expect(list.rows.filter((row) => row.field === "teamSpawns").every((row) => row.done)).toBe(true);
    expect(list.ready).toBe(true);
  });

  it("warns about two entries on the same block once nothing is missing", () => {
    const list = mapChecklist({ name: "Hall", spawns: [[0, 65, 0], [0, 65, 0]] }, { kind: "lobby" });
    expect(list.ready).toBe(true);
    expect(list.warnings).toEqual(["spawns[1] is at the same block as spawns[0]"]);
  });
});
