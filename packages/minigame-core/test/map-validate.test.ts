// Map format v2 checks. The original checks are tested in tools/build/test (validate.test.ts and
// validate-map-extras.test.ts), through the build's re-export.
import { describe, expect, it } from "vitest";
import type { MapConfig } from "../src/map-config.ts";
import { mapWarnings, validateMapConfig, type MapRules } from "../src/map-validate.ts";

const TEAMS = [
  { id: "red", name: "Red" },
  { id: "blue", name: "Blue" },
];
const bounds = { min: [-20, 40, -20], max: [20, 100, 20] };
const game: MapRules = { kind: "game", maxPlayers: 1, teams: TEAMS };

describe("validateMapConfig: map format v2", () => {
  it("accepts saved facings, kill regions, per-team keys and the editor's keys", () => {
    const map = {
      name: "Castle",
      draft: true,
      spawns: [[0, 65, 0, 90, 0]],
      spectatorSpawn: [0, 80, 0, -45, 30],
      bounds,
      teamSpawns: { red: [[-5, 65, 0, -90, 0]], blue: [[5, 65, 0]] },
      points: { "flag.red": [[-10, 65, 0]] },
      regions: { kill: [{ min: [-2, 40, -2], max: [2, 50, 2] }], "base.blue": [{ min: [5, 60, -5], max: [10, 70, 5] }] },
      cameras: { overview: { at: [0, 90, -15, 0, 25], kind: "map" } },
      source: { world: "Arenas", box: { min: [1200, 40, -620], max: [1296, 96, -540] }, offset: [-1248, 0, 580] },
    };
    expect(validateMapConfig(map, game)).toEqual([]);
  });

  it("checks facings and positions", () => {
    expect(validateMapConfig({ name: "M", spawns: [[0, 65, 0, 200, 0], [0, 65, 0, 0, 91], [0, 65, 0, 1]] }, { kind: "lobby" })).toEqual([
      "spawns[0] facing must be a yaw from -180 to 180 and a pitch from -90 to 90",
      "spawns[1] facing must be a yaw from -180 to 180 and a pitch from -90 to 90",
      "spawns[2] must be [x, y, z]",
    ]);
  });

  it("keeps killY in the world, and region boxes the right way round", () => {
    expect(validateMapConfig({ name: "M", spawns: [[0, 65, 0]], killY: -100 }, { kind: "lobby" })).toEqual(['"killY" must be within -64 to 319']);
    expect(validateMapConfig({ name: "M", spawns: [[0, 65, 0]], regions: { kill: [{ min: [5, 40, 0], max: [0, 50, 5] }] } }, { kind: "lobby" })).toEqual([
      "regions.kill[0] min must not be larger than max",
    ]);
  });

  it("needs team keys to be the game's teams, when the teams are known", () => {
    const map = { name: "M", spawns: [[0, 65, 0]], teamSpawns: { green: [[0, 65, 1]] }, points: { "flag.green": [[0, 65, 2]] }, regions: { "zone.red": [{ min: [0, 60, 0], max: [1, 61, 1] }] } };
    expect(validateMapConfig(map, game)).toEqual(['teamSpawns.green: "green" must be one of red, blue', 'points.flag.green: "green" must be one of red, blue']);
    expect(validateMapConfig(map, { kind: "game", maxPlayers: 1 })).toEqual([]);
    expect(validateMapConfig({ name: "M", spawns: [[0, 65, 0]], points: { "flag.red": [[0, 65, 2]] } }, { kind: "lobby", teams: [] })).toEqual([
      'points.flag.red: "red" must be a team, and this map\'s game has none',
    ]);
  });

  it("counts what the game requires, per team", () => {
    const rules: MapRules = {
      kind: "game",
      maxPlayers: 4,
      teams: TEAMS,
      requires: { spectatorSpawn: true, bounds: true, killY: true, teamSpawns: { perTeam: 2 }, points: { bombA: { count: 2 } }, regions: { buyZone: { perTeam: true } } },
    };
    const map = { name: "M", spawns: [[0, 65, 0]], teamSpawns: { red: [[1, 65, 0], [2, 65, 0]], blue: [[3, 65, 0]] }, points: { bombA: [[4, 65, 0]] }, regions: { "buyZone.red": [{ min: [0, 60, 0], max: [1, 61, 1] }] } };
    expect(validateMapConfig(map, rules)).toEqual([
      'this game needs a "spectatorSpawn"',
      'this game needs "bounds"',
      'this game needs "killY"',
      'this game needs 2 "points.bombA" entries, has 1',
      'this game needs a "regions.buyZone.blue" entry',
      'this game needs 2 "teamSpawns.blue" entries, has 1',
    ]);
  });

  it("checks the lobby's terminal", () => {
    const rules: MapRules = { kind: "lobby", requires: { spawns: { min: 1 }, points: { terminal: { label: "Terminal", count: 1 } } } };
    expect(validateMapConfig({ name: "Lobby", spawns: [[0, 65, 0]] }, rules)).toEqual(['the lobby needs a "points.terminal" entry']);
    expect(validateMapConfig({ name: "Lobby", spawns: [[0, 65, 0]], points: { terminal: [[0, 65, 3]] } }, rules)).toEqual([]);
  });

  it("reports broken values instead of throwing", () => {
    expect(validateMapConfig({ name: "M", spawns: [[0, 65, 0]], teamSpawns: null, build: null, draft: "yes" }, { kind: "lobby" })).toEqual([
      '"draft" must be true or false',
      '"teamSpawns" must map names to lists of [x, y, z]',
      '"build.commands" must be a list of console commands',
      '"bounds" is required when "build" is present (baking works inside it)',
    ]);
    expect(validateMapConfig({ name: "M", spawns: [[0, 65, 0]], source: { world: "A" }, cameras: { top: { at: [0, 1, 2], kind: "photo" } } }, { kind: "lobby" })).toEqual([
      '"source" must be { "world", "box": { "min", "max" }, "offset": [x, y, z] }',
      'cameras.top must be { "at": [x, y, z, yaw, pitch], "kind": "map" or "game" }',
    ]);
  });
});

describe("mapWarnings", () => {
  it("points out two entries of a list on the same block", () => {
    const map: MapConfig = { name: "M", spawns: [[0, 65, 0], [1, 65, 0], [0, 65, 0, 90, 0]], points: { flag: [[2, 65, 2], [2, 65, 2]] } };
    expect(mapWarnings(map)).toEqual(["spawns[2] is in the same block as spawns[0]", "points.flag[1] is in the same block as points.flag[0]"]);
    expect(mapWarnings({ name: "M", spawns: [[0, 65, 0]] })).toEqual([]);
    expect(mapWarnings({ name: "M", spawns: [[0.2, 65, 0.3], [0.8, 65, 0.9], [1.2, 65, 0.3]] })).toEqual(["spawns[1] is in the same block as spawns[0]"]);
  });
});

describe("exact positions", () => {
  it("keeps a point inside its bounds' last block, as the runtime does", () => {
    const rules: MapRules = { kind: "game", maxPlayers: 1 };
    const bounds = { min: [-12, 40, -12], max: [12, 100, 12] } as MapConfig["bounds"];
    expect(validateMapConfig({ name: "M", spawns: [[12.7, 65, -12]], bounds }, rules)).toEqual([]);
    expect(validateMapConfig({ name: "M", spawns: [[13.01, 65, 0]], bounds }, rules)).toEqual(['spawns[0] [13.01,65,0] is outside "bounds"']);
  });
});
