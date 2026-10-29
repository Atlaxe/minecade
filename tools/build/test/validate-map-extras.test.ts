import { describe, expect, it } from "vitest";
import type { GameConfig, TeamDef } from "@minecade/minigame-core/config";
import { validateGameConfig, validateMapConfig, type MapRules } from "../validate.ts";

const bounds = { min: [-10, 50, -10], max: [10, 90, 10] };
const spawns = [
  [0, 64, 0],
  [2, 64, 0],
];
const game: MapRules = { kind: "game", maxPlayers: 2 };

describe("validateMapConfig: killY and named entries", () => {
  it("accepts killY, team spawns, points and regions inside the bounds", () => {
    const map = {
      name: "Fort",
      spawns: [[0, 64, 0]],
      bounds,
      killY: 40,
      teamSpawns: { red: [[-5, 64, 0]], blue: [[5, 64, 0]] },
      points: { flag: [[0, 70, 0], [1, 70, 1]] },
      regions: { floor: [{ min: [-10, 50, -10], max: [10, 63, 10] }] },
    };
    const rules: MapRules = { kind: "game", maxPlayers: 8, requires: { points: ["flag"], regions: ["floor"], teamSpawns: true } };
    expect(validateMapConfig(map, rules)).toEqual([]);
  });

  it("needs killY to be a number", () => {
    expect(validateMapConfig({ name: "Void", spawns, killY: "low" }, game)).toEqual(['"killY" must be a number']);
    expect(validateMapConfig({ name: "Void", spawns, killY: Number.POSITIVE_INFINITY }, game)).toEqual(['"killY" must be a number']);
    expect(validateMapConfig({ name: "Void", spawns, killY: Number.NaN }, game)).toEqual(['"killY" must be a number']);
    expect(validateMapConfig({ name: "Void", spawns, killY: -20 }, game)).toEqual([]);
  });

  it("needs team spawns and points to map names to non-empty lists of positions", () => {
    expect(validateMapConfig({ name: "M", spawns, teamSpawns: [[0, 64, 0]], points: "flag" }, game)).toEqual([
      '"teamSpawns" must map names to lists of [x, y, z]',
      '"points" must map names to lists of [x, y, z]',
    ]);
    expect(
      validateMapConfig({ name: "M", spawns, teamSpawns: { red: [], blue: [[0, 64]] }, points: { flag: "here", bomb: [[1, 2, 3], [1, "y", 3]] } }, game),
    ).toEqual([
      "teamSpawns.red must be a non-empty list of [x, y, z]",
      "teamSpawns.blue[0] must be [x, y, z]",
      "points.flag must be a non-empty list of [x, y, z]",
      "points.bomb[1] must be [x, y, z]",
    ]);
  });

  it("needs regions to map names to non-empty lists of boxes", () => {
    expect(validateMapConfig({ name: "M", spawns, regions: [] }, game)).toEqual(['"regions" must map names to lists of { "min", "max" } boxes']);
    expect(validateMapConfig({ name: "M", spawns, regions: { floor: [], plot: [{ min: [0, 0, 0] }], wall: "x" } }, game)).toEqual([
      "regions.floor must be a non-empty list of boxes",
      'regions.plot[0] must be { "min": [x, y, z], "max": [x, y, z] }',
      "regions.wall must be a non-empty list of boxes",
    ]);
  });

  it("keeps team spawns, points and regions inside the bounds", () => {
    const map = {
      name: "Fort",
      spawns,
      bounds,
      teamSpawns: { red: [[0, 64, 0], [40, 64, 0]] },
      points: { flag: [[0, 95, 0]] },
      regions: {
        floor: [
          { min: [-10, 50, -10], max: [10, 63, 10] },
          { min: [0, 40, 0], max: [5, 60, 5] },
        ],
        roof: [{ min: [0, 80, 0], max: [5, 100, 5] }],
      },
    };
    expect(validateMapConfig(map, game)).toEqual([
      'teamSpawns.red[1] [40,64,0] is outside "bounds"',
      'points.flag[0] [0,95,0] is outside "bounds"',
      'regions.floor[1] is outside "bounds"',
      'regions.roof[0] is outside "bounds"',
    ]);
  });

  it("counts the edges of the bounds as inside", () => {
    const map = {
      name: "Edge",
      spawns,
      bounds,
      teamSpawns: { red: [[10, 90, 10]], blue: [[-10, 50, -10]] },
      points: { corner: [[10, 50, -10]] },
      regions: { all: [{ min: [-10, 50, -10], max: [10, 90, 10] }] },
    };
    expect(validateMapConfig(map, game)).toEqual([]);
  });

  it("reports the entries the game requires that the map is missing", () => {
    const rules: MapRules = { kind: "game", maxPlayers: 2, requires: { points: ["flag", "base"], regions: ["floor"], teamSpawns: true } };
    expect(validateMapConfig({ name: "Bare", spawns, points: { flag: [[0, 64, 0]] } }, rules)).toEqual([
      'this game needs a "points.base" entry',
      'this game needs a "regions.floor" entry',
      'this game needs "teamSpawns"',
    ]);
    expect(validateMapConfig({ name: "Bare", spawns, teamSpawns: {} }, { kind: "game", maxPlayers: 2, requires: { teamSpawns: true } })).toEqual([
      'this game needs "teamSpawns"',
    ]);
    expect(validateMapConfig({ name: "Bare", spawns }, { kind: "game", maxPlayers: 2, requires: {} })).toEqual([]);
  });

  it("waives one spawn per player slot when the map has team spawns", () => {
    const rules: MapRules = { kind: "game", maxPlayers: 8 };
    const teamSpawns = { red: [[-5, 64, 0]], blue: [[5, 64, 0]] };
    expect(validateMapConfig({ name: "Fort", spawns: [[0, 64, 0]], teamSpawns }, rules)).toEqual([]);
    expect(validateMapConfig({ name: "Fort", spawns: [[0, 64, 0]], teamSpawns: {} }, rules)).toEqual([
      "needs at least 8 spawns (one per player slot), has 1",
    ]);
    expect(validateMapConfig({ name: "Fort", spawns: [], teamSpawns }, rules)).toEqual(["needs at least 1 spawn, has 0"]);
  });
});

describe("validateGameConfig: teams, kits, stats and respawn", () => {
  const base: GameConfig = { id: "ctf", name: "Capture the Flag", minPlayers: 4, maxPlayers: 16 };
  const roles: TeamDef[] = [
    { id: "seekers", name: "Seekers", color: "§c", size: 1 },
    { id: "hiders", name: "Hiders", color: "§a", size: "rest" },
  ];

  it("accepts a full, sensible config", () => {
    const config: GameConfig = {
      ...base,
      teams: { count: 2, minPerTeam: 2 },
      kits: {
        list: [
          { id: "archer", name: "Archer", items: [{ item: "minecraft:bow" }] },
          { id: "knight", name: "Knight", items: [{ item: "minecraft:iron_sword" }] },
        ],
      },
      stats: { mode: "team", extras: [{ key: "flags", label: "Flags", agg: "sum" }, { key: "life", label: "Longest life", agg: "max" }] },
      respawn: { mode: "lives", lives: 3 },
    };
    expect(validateGameConfig(config, "ctf")).toEqual([]);
    expect(validateGameConfig({ ...base, teams: { count: [2, 4], minPerTeam: 2 } }, "ctf")).toEqual([]);
  });

  it("needs enough team defs for the count", () => {
    expect(validateGameConfig({ ...base, minPlayers: 5, teams: { count: 5 } }, "ctf")).toEqual(["teams.count needs 5 teams but only 4 are defined"]);
    const defs: TeamDef[] = [
      { id: "cats", name: "Cats", color: "§6" },
      { id: "dogs", name: "Dogs", color: "§b" },
    ];
    expect(validateGameConfig({ ...base, teams: { count: 3, defs } }, "ctf")).toEqual(["teams.count needs 3 teams but only 2 are defined"]);
    expect(validateGameConfig({ ...base, teams: { count: [5, 6] } }, "ctf")).toEqual(["teams.count needs 5 teams but only 4 are defined"]);
  });

  it("needs minPlayers to fill an exact team count", () => {
    expect(validateGameConfig({ ...base, teams: { count: 2, minPerTeam: 3 } }, "ctf")).toEqual(["minPlayers must be at least 6 to fill 2 teams"]);
    expect(validateGameConfig({ ...base, minPlayers: 2, teams: { count: 3 } }, "ctf")).toEqual(["minPlayers must be at least 3 to fill 3 teams"]);
    expect(validateGameConfig({ ...base, minPlayers: 6, teams: { count: 2, minPerTeam: 3 } }, "ctf")).toEqual([]);
  });

  it("rejects an inverted range", () => {
    expect(validateGameConfig({ ...base, teams: { count: [4, 2] } }, "ctf")).toEqual(["teams.count range must be [min, max]"]);
  });

  it("skips the count checks for role teams", () => {
    expect(validateGameConfig({ ...base, minPlayers: 2, teams: { count: 3, defs: roles } }, "ctf")).toEqual([]);
  });

  it("needs unique kit ids and stats extra keys", () => {
    const kit = { id: "archer", name: "Archer", items: [] };
    expect(validateGameConfig({ ...base, kits: { list: [kit, { ...kit, name: "Archer 2" }] } }, "ctf")).toEqual(["kit ids must be unique"]);
    expect(
      validateGameConfig(
        {
          ...base,
          stats: {
            mode: "solo",
            extras: [
              { key: "flags", label: "Flags", agg: "sum" },
              { key: "flags", label: "Most flags", agg: "max" },
            ],
          },
        },
        "ctf",
      ),
    ).toEqual(["stats extra keys must be unique"]);
  });

  it("needs at least one life in lives mode", () => {
    const problem = 'respawn.lives must be at least 1 when respawn.mode is "lives"';
    expect(validateGameConfig({ ...base, respawn: { mode: "lives" } }, "ctf")).toEqual([problem]);
    expect(validateGameConfig({ ...base, respawn: { mode: "lives", lives: 0 } }, "ctf")).toEqual([problem]);
    expect(validateGameConfig({ ...base, respawn: { mode: "lives", lives: 1 } }, "ctf")).toEqual([]);
    expect(validateGameConfig({ ...base, respawn: { mode: "unlimited" } }, "ctf")).toEqual([]);
  });

  it("reports every team, kit, stats and respawn problem at once", () => {
    const kit = { id: "archer", name: "Archer", items: [] };
    expect(
      validateGameConfig(
        {
          ...base,
          teams: { count: [4, 2] },
          kits: { list: [kit, kit] },
          stats: { mode: "solo", extras: [{ key: "a", label: "A", agg: "sum" }, { key: "a", label: "A", agg: "sum" }] },
          respawn: { mode: "lives" },
        },
        "ctf",
      ),
    ).toEqual([
      "teams.count range must be [min, max]",
      "kit ids must be unique",
      "stats extra keys must be unique",
      'respawn.lives must be at least 1 when respawn.mode is "lives"',
    ]);
  });
});
