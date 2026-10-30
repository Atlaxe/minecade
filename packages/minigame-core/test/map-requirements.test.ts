import { describe, expect, it } from "vitest";
import { possibleTeams } from "../src/game/teams.ts";
import { mapRequirements } from "../src/map-requirements.ts";

const TEAMS = [
  { id: "red", name: "Red" },
  { id: "blue", name: "Blue" },
];

describe("mapRequirements", () => {
  it("needs a spawn per player slot by default, and one for the lobby", () => {
    expect(mapRequirements(undefined, { kind: "game", maxPlayers: 6 })).toEqual([{ key: "spawns", label: "Spawns", field: "spawns", min: 6, perPlayer: true }]);
    expect(mapRequirements(undefined, { kind: "lobby" })).toEqual([{ key: "spawns", label: "Spawn", field: "spawns", min: 1 }]);
    expect(mapRequirements({ spawns: { min: 2 } }, { kind: "game", maxPlayers: 6 })[0]).toEqual({ key: "spawns", label: "Spawns", field: "spawns", min: 2 });
    expect(mapRequirements({ spawns: { min: "maxPlayers" } }, { kind: "game", maxPlayers: 6 })[0].min).toBe(6);
  });

  it("reads the short forms", () => {
    expect(mapRequirements({ points: ["flag"], regions: ["floor"], teamSpawns: true }, { kind: "game", maxPlayers: 4 })).toEqual([
      { key: "spawns", label: "Spawns", field: "spawns", min: 1, perPlayer: false },
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
      ["spawns", "Spawns", 1],
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

  it("treats per-team entries as one when the game has no teams", () => {
    expect(mapRequirements({ points: { flag: { perTeam: true } } }, { kind: "game", maxPlayers: 2 })[1]).toEqual({ key: "points.flag", label: "flag", field: "points", name: "flag", min: 1 });
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
