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
});

describe("validateMapConfig", () => {
  it("accepts a game map and a lobby map", () => {
    expect(validateMapConfig({ name: "Arena", spawns, bounds, build: { commands: ["fill 0 63 0 1 63 1 stone"] } }, { kind: "game", maxPlayers: 3 })).toEqual([]);
    expect(validateMapConfig({ name: "Main", spawns: [[0, 65, 0]], eliminationY: 58 }, { kind: "lobby" })).toEqual([]);
  });

  it("needs a spawn for every player slot", () => {
    expect(validateMapConfig({ name: "Arena", spawns: spawns.slice(0, 2) }, { kind: "game", maxPlayers: 3 })).toEqual([
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
});
