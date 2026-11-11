import { describe, expect, it } from "vitest";
import type { GameConfig } from "@minecade/minigame-core/config";
import { validateGameConfig, validateMapConfig } from "../validate.ts";

const game: GameConfig = { id: "sumo", name: "Sumo", minPlayers: 2, maxPlayers: 3 };
const bounds = { min: [-10, 50, -10], max: [10, 90, 10] };
const spawns = [
  [0, 64, 0],
  [2, 64, 0],
  [-2, 64, 0],
];

describe("validateGameConfig", () => {
  it("accepts a sensible config", () => {
    expect(validateGameConfig(game, "sumo")).toEqual([]);
  });

  it("takes the whole blocks pack, or the network's cut when blocks is left out", () => {
    expect(validateGameConfig({ ...game, blocks: "full" }, "sumo")).toEqual([]);
    expect(validateGameConfig({ ...game, blocks: "all" as "full" }, "sumo")).toEqual(['blocks must be "full" or left out']);
  });

  it("takes item ids for the mannequins to hold, named or not", () => {
    expect(validateGameConfig({ ...game, mannequinItems: ["minecraft:bow", { item: "minecade:{color}_paintball_rifle", name: "Rifle" }] }, "sumo")).toEqual([]);
    expect(validateGameConfig({ ...game, mannequinItems: ["bow", { name: "Rifle" } as unknown as { item: string }] }, "sumo")).toEqual([
      'mannequinItems: "bow" must be an item id, such as "minecraft:bow"',
      'mannequinItems: {"name":"Rifle"} must be an item id, such as "minecraft:bow"',
    ]);
  });

  it("reports every problem at once", () => {
    expect(validateGameConfig({ ...game, id: "other", minPlayers: 0, maxPlayers: -1 }, "sumo")).toEqual([
      'id "other" must match the folder name "sumo"',
      "minPlayers must be a whole number of at least 1",
      "maxPlayers must be a whole number no smaller than minPlayers",
    ]);
  });

  it("checks game screen options against what the orchestrator passes on", () => {
    const round = { id: "round", label: "Round", values: [{ value: "15", label: "15 s" }, { value: "30", label: "30 s" }] };
    expect(validateGameConfig({ ...game, options: [round] }, "sumo")).toEqual([]);
    expect(validateGameConfig({ ...game, options: [{ id: "teams", label: "Teams", values: round.values }] }, "sumo")).toEqual([]);
    expect(
      validateGameConfig(
        {
          ...game,
          teams: { count: 2 },
          minPlayers: 2,
          options: [
            { id: "teams", label: "Teams", values: round.values },
            { id: "Bad id", label: "", values: [{ value: "x".repeat(33), label: "" }] },
            round,
            round,
          ],
        },
        "sumo",
      ),
    ).toEqual([
      "options ids must be unique",
      'options "teams": team games already get a Teams setting',
      'options "Bad id": the id must be lower camelCase letters, digits or _, up to 32 characters',
      'options "Bad id": label is required',
      'options "Bad id": needs at least 2 values',
      'options "Bad id": values must be 1 to 32 characters',
      'options "Bad id": every value needs a label',
    ]);
    const many = Array.from({ length: 8 }, (_, i) => ({ ...round, id: `option${i}` }));
    expect(validateGameConfig({ ...game, teams: { count: 2 }, minPlayers: 2, options: many }, "sumo")).toEqual(["a game can have at most 8 settings, Teams included"]);
  });

  it("checks a Team count setting names one of the options, with team counts the range allows", () => {
    const teamCount = (values: string[]) => ({ id: "teamCount", label: "Team count", values: values.map((value) => ({ value, label: value })) });
    const teams = { count: [2, 4] as [number, number], option: "teamCount" };
    expect(validateGameConfig({ ...game, maxPlayers: 8, teams, options: [teamCount(["2", "3", "4"])] }, "sumo")).toEqual([]);
    expect(validateGameConfig({ ...game, maxPlayers: 8, teams, options: [teamCount(["2", "5"])] }, "sumo")).toEqual(['teams.option "teamCount": every value must be a team count from 2 to 4']);
    expect(validateGameConfig({ ...game, maxPlayers: 8, teams, options: [] }, "sumo")).toEqual([`teams.option "teamCount" must be one of the game's options`]);
  });

  it("shows scores as sides only for team scores of up to four teams, without best-of rounds", () => {
    const teams = { count: [2, 4] as [number, number] };
    expect(validateGameConfig({ ...game, maxPlayers: 8, teams, scoring: { per: "team", display: "sides" } }, "sumo")).toEqual([]);
    expect(validateGameConfig({ ...game, scoring: { per: "player", display: "sides" } }, "sumo")).toEqual(['scoring.display "sides" is for team scores (per: "team")']);
    const five = { count: 5, defs: ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id, color: "§f" })) };
    expect(validateGameConfig({ ...game, minPlayers: 5, maxPlayers: 8, teams: five, scoring: { per: "team", display: "sides" } }, "sumo")).toEqual(['scoring.display "sides" shows up to 4 teams']);
  });
});

describe("validateMapConfig", () => {
  it("accepts a game map and a lobby map", () => {
    expect(validateMapConfig({ name: "Arena", spawns, spectatorSpawn: [0, 80, 0], bounds, build: { commands: ["fill 0 63 0 1 63 1 stone"] } }, { kind: "game", maxPlayers: 3 })).toEqual([]);
    expect(validateMapConfig({ name: "Main", spawns: [[0, 65, 0]], eliminationY: 58 }, { kind: "lobby" })).toEqual([]);
  });

  it("needs a spawn for every player slot", () => {
    expect(validateMapConfig({ name: "Arena", spawns: spawns.slice(0, 2), spectatorSpawn: [0, 80, 0] }, { kind: "game", maxPlayers: 3 })).toEqual([
      "needs at least 3 spawns (one per player slot), has 2",
    ]);
    expect(validateMapConfig({ name: "Main", spawns: [] }, { kind: "lobby" })).toEqual(["needs at least 1 spawn, has 0"]);
  });

  it("keeps spawns inside the bounds, and the bounds inside the world", () => {
    const problems = validateMapConfig(
      { name: "Arena", spawns: [...spawns.slice(0, 2), [40, 64, 0]], spectatorSpawn: [0, 120, 0], bounds },
      { kind: "game", maxPlayers: 3 },
    );
    expect(problems).toEqual(['spawns[2] [40,64,0] is outside "bounds"', 'spectatorSpawn [0,120,0] is outside "bounds"']);
    expect(validateMapConfig({ name: "Deep", spawns: [[0, 0, 0]], bounds: { min: [0, -100, 0], max: [1, 1, 1] } }, { kind: "lobby" })).toEqual([
      '"bounds" y must stay within -64 to 319',
    ]);
    expect(validateMapConfig({ name: "Flipped", spawns: [[0, 0, 0]], bounds: { min: [5, 0, 0], max: [-5, 1, 1] } }, { kind: "lobby" })).toContain(
      '"bounds" min must not be larger than max',
    );
  });

  it("checks types and the build section", () => {
    expect(validateMapConfig([], { kind: "lobby" })).toEqual(["map.json must be a JSON object"]);
    expect(validateMapConfig({ spawns: [[0, "x", 0]] }, { kind: "lobby" })).toEqual(['"name" is required', "spawns[0] must be [x, y, z]"]);
    expect(validateMapConfig({ name: "M", spawns: [[0, 65, 0]], build: { commands: ["/fill 0 0 0 1 1 1 stone"] } }, { kind: "lobby" })).toEqual([
      'build.commands[0]: leave out the leading "/"',
      '"bounds" is required when "build" is present (baking works inside it)',
    ]);
  });

  it("checks the time of day and the star box", () => {
    expect(validateMapConfig({ name: "Main", spawns: [[0, 65, 0]], time: "midnight", stars: true }, { kind: "lobby" })).toEqual([]);
    expect(validateMapConfig({ name: "Arena", spawns, spectatorSpawn: [0, 80, 0], time: 6000 }, { kind: "game", maxPlayers: 3 })).toEqual([]);
    const timeProblem = '"time" must be one of day, noon, sunset, night, midnight, sunrise, or ticks from 0 to 23999';
    for (const time of ["dusk", 24000, -1, 1.5, "toString"]) {
      expect(validateMapConfig({ name: "Main", spawns: [[0, 65, 0]], time }, { kind: "lobby" })).toEqual([timeProblem]);
    }
    expect(validateMapConfig({ name: "Main", spawns: [[0, 65, 0]], stars: "yes" }, { kind: "lobby" })).toEqual(['"stars" must be true or false']);
    expect(validateMapConfig({ name: "Arena", spawns, spectatorSpawn: [0, 80, 0], stars: true }, { kind: "game", maxPlayers: 3 })).toEqual(['"stars" is only for the lobby map']);
  });
});
