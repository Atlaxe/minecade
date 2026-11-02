import { describe, expect, it } from "vitest";
import { possibleTeams } from "../src/game/teams.ts";
import { MapView } from "../src/game/map-view.ts";
import { worldSpawnOf, type MapConfig } from "../src/map-config.ts";
import { mapRequirements, usesPlainSpawns } from "../src/map-requirements.ts";
import { validateMapConfig, type MapRules } from "../src/map-validate.ts";

const TEAMS = [
  { id: "red", name: "Red" },
  { id: "blue", name: "Blue" },
];

describe("mapRequirements", () => {
  it("needs a spawn per player slot by default, and a spectator or queue spawn; the lobby needs one spawn", () => {
    expect(mapRequirements(undefined, { kind: "game", maxPlayers: 6 })).toEqual([{ key: "spawns", label: "Spawns", field: "spawns", min: 6, perPlayer: true }, { key: "spectatorOrQueue", label: "Spectator or queue spawn", field: "spectatorOrQueue", min: 1 }]);
    expect(mapRequirements(undefined, { kind: "lobby" })).toEqual([{ key: "spawns", label: "Spawn", field: "spawns", min: 1 }]);
    expect(mapRequirements({ spawns: { min: 2 } }, { kind: "game", maxPlayers: 6 })[0]).toEqual({ key: "spawns", label: "Spawns", field: "spawns", min: 2 });
    expect(mapRequirements({ spawns: { min: "maxPlayers" } }, { kind: "game", maxPlayers: 6 })[0].min).toBe(6);
  });

  it("reads the short forms", () => {
    // A team spawn game has no plain spawns unless it asks for them.
    expect(mapRequirements({ points: ["flag"], regions: ["floor"], teamSpawns: true }, { kind: "game", maxPlayers: 4 })).toEqual([
      { key: "spectatorOrQueue", label: "Spectator or queue spawn", field: "spectatorOrQueue", min: 1 },
      { key: "points.flag", label: "flag", field: "points", name: "flag", min: 1 },
      { key: "regions.floor", label: "floor", field: "regions", name: "floor", min: 1 },
      { key: "teamSpawns", label: "Team spawns", field: "teamSpawns", min: 1 },
    ]);
  });

  it("expands descriptors in checklist order, per team where asked", () => {
    const list = mapRequirements(
      {
        spectatorSpawn: true,
        killY: true,
        bounds: true,
        teamSpawns: { perTeam: 5 },
        points: { bombA: { label: "Bomb site A" }, mob: { count: 3 } },
        regions: { buyZone: { label: "Buy zone", perTeam: true } },
      },
      { kind: "game", maxPlayers: 10, teams: TEAMS },
    );
    expect(list.map((requirement) => [requirement.key, requirement.label, requirement.min])).toEqual([
      ["spectatorSpawn", "Spectator spawn", 1],
      ["bounds", "Bounds", 1],
      ["killY", "Kill Y", 1],
      ["points.bombA", "Bomb site A", 1],
      ["points.mob", "mob", 3],
      ["regions.buyZone.red", "Buy zone (Red)", 1],
      ["regions.buyZone.blue", "Buy zone (Blue)", 1],
      ["teamSpawns.red", "Red spawns", 5],
      ["teamSpawns.blue", "Blue spawns", 5],
    ]);
    expect(list.find((requirement) => requirement.key === "regions.buyZone.blue")).toMatchObject({ field: "regions", name: "buyZone.blue", team: "blue" });
  });

  it("asks for both sides of the build limit, or just the ones named, after kill Y", () => {
    const keys = (map: Parameters<typeof mapRequirements>[0]) => mapRequirements(map, { kind: "game", maxPlayers: 2 }).map((requirement) => requirement.key);
    expect(keys({ spectatorSpawn: true, killY: true, buildLimit: true })).toEqual(["spawns", "spectatorSpawn", "killY", "buildLimit.above", "buildLimit.below"]);
    expect(keys({ spectatorSpawn: true, buildLimit: { above: true } })).toEqual(["spawns", "spectatorSpawn", "buildLimit.above"]);
    expect(mapRequirements({ buildLimit: true }, { kind: "game", maxPlayers: 2 }).find((requirement) => requirement.key === "buildLimit.below")).toMatchObject({ label: "Build limit below", field: "buildLimit", name: "below", min: 1 });
  });

  it("asks for exactly the spectator and queue spawns a game names, or neither when it says false", () => {
    const keys = (map: Parameters<typeof mapRequirements>[0]) => mapRequirements(map, { kind: "game", maxPlayers: 2 }).map((requirement) => requirement.key);
    expect(keys({ queueSpawn: true })).toEqual(["spawns", "queueSpawn"]);
    expect(keys({ spectatorSpawn: true, queueSpawn: true })).toEqual(["spawns", "spectatorSpawn", "queueSpawn"]);
    expect(keys({ spectatorSpawn: false })).toEqual(["spawns"]);
  });

  it("treats per-team entries as one when the game has no teams", () => {
    expect(mapRequirements({ points: { flag: { perTeam: true } } }, { kind: "game", maxPlayers: 2 })[2]).toEqual({ key: "points.flag", label: "flag", field: "points", name: "flag", min: 1 });
  });

  it("reads the lobby's terminal", () => {
    expect(mapRequirements({ spawns: { min: 1 }, points: { terminal: { label: "Terminal", count: 1 } } }, { kind: "lobby" })).toEqual([
      { key: "spawns", label: "Spawn", field: "spawns", min: 1 },
      { key: "points.terminal", label: "Terminal", field: "points", name: "terminal", min: 1 },
    ]);
  });
});

describe("possibleTeams", () => {
  it("lists every team a match could use", () => {
    expect(possibleTeams({ count: 2 }).map((team) => team.id)).toEqual(["red", "blue"]);
    expect(possibleTeams({ count: [2, 4] }).map((team) => team.id)).toEqual(["red", "blue", "green", "yellow"]);
    const roles = [
      { id: "seeker", name: "Seeker", color: "§c", size: 1 },
      { id: "hider", name: "Hider", color: "§a", size: "rest" as const },
    ];
    expect(possibleTeams({ count: 2, defs: roles }).map((team) => team.id)).toEqual(["seeker", "hider"]);
  });
});

describe("plain spawns", () => {
  it("are on for the lobby and most games, off for a team spawn game unless it names them, and off when a game says false", () => {
    expect(usesPlainSpawns(undefined, "lobby")).toBe(true);
    expect(usesPlainSpawns(undefined, "game")).toBe(true);
    expect(usesPlainSpawns({ teamSpawns: true }, "game")).toBe(false);
    expect(usesPlainSpawns({ teamSpawns: true, spawns: { min: 2 } }, "game")).toBe(true);
    expect(usesPlainSpawns({ spawns: false }, "game")).toBe(false);
    expect(mapRequirements({ teamSpawns: true, spawns: { min: 2 } }, { kind: "game", maxPlayers: 4 })[0]).toEqual({ key: "spawns", label: "Spawns", field: "spawns", min: 2 });
    expect(mapRequirements({ spawns: false, spectatorSpawn: true }, { kind: "game", maxPlayers: 4 }).map((requirement) => requirement.key)).toEqual(["spectatorSpawn"]);
  });
});

describe("a map without plain spawns", () => {
  const map: MapConfig = { name: "Bridges", spawns: [], spectatorSpawn: [0, 90, 0], teamSpawns: { red: [[-10, 64, 0], [-10, 64, 2]], blue: [[10, 64, 0]] } };

  it("waits at every team's spawns in turn, and bakes its world spawn at the first team spawn", () => {
    expect(new MapView(map).waitingSpots).toEqual([[-10, 64, 0], [10, 64, 0], [-10, 64, 2]]);
    expect(new MapView({ ...map, spawns: [[1, 64, 1]] }).waitingSpots).toEqual([[1, 64, 1]]);
    expect(worldSpawnOf(map)).toEqual([-10, 64, 0]);
    expect(worldSpawnOf({ spawns: [], queueSpawn: [0, 70, 0] })).toEqual([0, 70, 0]);
  });

  it("passes validation for a team spawn game", () => {
    const rules: MapRules = { kind: "game", maxPlayers: 4, teams: TEAMS, requires: { teamSpawns: true } };
    expect(validateMapConfig(map, rules)).toEqual([]);
    expect(validateMapConfig(map, { ...rules, requires: { teamSpawns: true, spawns: {} } })).toEqual(["needs at least 1 spawn, has 0"]);
  });
});
