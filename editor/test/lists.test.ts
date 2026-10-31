import { describe, expect, it } from "vitest";
import type { EditorRules, MapConfig } from "@minecade/minigame-core/config";
import { aimedPoint, blockPosition, compass, entryPosition, markerPitch, markerSpecs, queueText, sameYaw, snapFacing, spawnLists } from "../behavior_pack/scripts/lists.ts";

const rules: EditorRules = {
  kind: "game",
  maxPlayers: 4,
  teams: [
    { id: "red", name: "Red", color: "§c" },
    { id: "blue", name: "Blue", color: "§9" },
  ],
  requires: { points: { bomb: { label: "Bomb site" }, flag: { label: "Flag", perTeam: true } } },
};

const map: MapConfig = {
  name: "Arena",
  spawns: [[5, 65, 0], [-5, 65, 0, 90, 0]],
  spectatorSpawn: [0, 80, 0],
  teamSpawns: { red: [[1, 65, 1]], green: [[2, 65, 2]] },
  points: { bomb: [[0, 64, 0]], extra: [[3, 64, 3]] },
};

describe("spawn tool lists", () => {
  it("offers spawns, the spectator and queue spawns, team spawns and the points, required ones first", () => {
    const lists = spawnLists(map, rules);
    expect(lists.map((list) => [list.key, list.label])).toEqual([
      ["spawns", "Spawns"],
      ["spectatorSpawn", "Spectator spawn"],
      ["queueSpawn", "Queue spawn"],
      ["teamSpawns.red", "Red spawns"],
      ["teamSpawns.blue", "Blue spawns"],
      ["teamSpawns.green", "green spawns"],
      ["points.bomb", "Bomb site"],
      ["points.flag.red", "Flag (Red)"],
      ["points.flag.blue", "Flag (Blue)"],
      ["points.extra", "extra"],
    ]);
    expect(lists.find((list) => list.key === "points.flag.blue")?.color).toBe("§9");
    expect(spawnLists({ name: "Hall", spawns: [] }, { kind: "lobby", requires: { points: { terminal: { label: "Terminal" } } } }).map((list) => list.label)).toEqual(["Spawn", "Terminal"]);
  });

  it("numbers a marker for every entry, with its facing", () => {
    const specs = markerSpecs(map, spawnLists(map, rules));
    expect(specs.map((spec) => [spec.key, spec.label])).toEqual([
      ["spawns#0", "§fSpawn 1"],
      ["spawns#1", "§fSpawn 2\n§7faces west"],
      ["spectatorSpawn#0", "§7Spectator spawn"],
      ["teamSpawns.red#0", "§cRed spawn 1"],
      ["teamSpawns.green#0", "§fgreen spawn 1"],
      ["points.bomb#0", "§eBomb site 1"],
      ["points.extra#0", "§eextra 1"],
    ]);
    expect(specs[1]).toMatchObject({ at: { x: -4.5, y: 65, z: 0.5 }, facing: { yaw: 90, pitch: 0 } });
  });

  it("names the queue spawn's marker with how players wait there", () => {
    const queued: MapConfig = { name: "M", spawns: [], queueSpawn: [0, 80, 30], queue: { mode: "free", countdown: 10 } };
    const specs = markerSpecs(queued, spawnLists(queued, { kind: "game", maxPlayers: 2 }));
    expect(specs.map((spec) => spec.label)).toEqual(["§bQueue spawn (free, 10 s)"]);
    expect(queueText({ name: "M", spawns: [], queueSpawn: [0, 80, 30] })).toBe("lock in, 5 s");
  });

  it("stands a marker on an exact position where it is, not in its block's middle", () => {
    const specs = markerSpecs({ name: "M", spawns: [[3.27, 65, -1.84]] }, spawnLists({ name: "M", spawns: [] }, { kind: "game", maxPlayers: 2 }));
    expect(specs[0].at).toEqual({ x: 3.27, y: 65, z: -1.84 });
  });
});

describe("where the Spawn tool places", () => {
  const block = { x: 3, y: 64, z: -2 };

  it("puts an entry exactly where it aims on top of a block", () => {
    expect(aimedPoint({ block, face: "Up", faceLocation: { x: 0.27, y: 1, z: 0.16 } })).toEqual({ point: { x: 3.27, y: 65, z: -1.84 }, onTop: true });
    // A world location (older APIs) means the same spot.
    expect(aimedPoint({ block, face: "Up", faceLocation: { x: 3.27, y: 65, z: -1.84 } }).point).toEqual({ x: 3.27, y: 65, z: -1.84 });
  });

  it("puts it just in front of a side it aims at, for the floor below", () => {
    const { point, onTop } = aimedPoint({ block, face: "South", faceLocation: { x: 0.5, y: 0.6, z: 1 } });
    expect(onTop).toBe(false);
    expect(point.x).toBeCloseTo(3.5);
    expect(point.y).toBeCloseTo(64.6);
    expect(point.z).toBeCloseTo(-0.7);
  });

  it("rounds to hundredths, or centers on the block when asked", () => {
    expect(entryPosition({ x: 3.2712, y: 65.0001, z: -1.8449 }, false)).toEqual([3.27, 65, -1.84]);
    expect(entryPosition({ x: 3.2712, y: 65.0001, z: -1.8449 }, false, { yaw: 90, pitch: 0 })).toEqual([3.27, 65, -1.84, 90, 0]);
    expect(entryPosition({ x: 3.2712, y: 64.99999, z: -1.8449 }, true)).toEqual([3, 65, -2]);
    // Whole x and z would mean a block's middle, so an exact point never comes out whole.
    expect(entryPosition({ x: 4.001, y: 65, z: 2 }, false)).toEqual([4.01, 65, 2]);
  });
});

describe("facing", () => {
  it("names compass directions", () => {
    expect([0, 45, 90, 180, -180, -90, -45, 359].map(compass)).toEqual(["south", "southwest", "west", "north", "north", "east", "southeast", "south"]);
  });

  it("snaps a view to whole degrees, or the yaw to 45 or 90 with the pitch level", () => {
    expect(snapFacing({ yaw: 33.6, pitch: 12.4 }, "exact")).toEqual({ yaw: 34, pitch: 12 });
    expect(snapFacing({ yaw: 33.6, pitch: 12.4 }, "45")).toEqual({ yaw: 45, pitch: 0 });
    expect(snapFacing({ yaw: 179, pitch: -3 }, "90")).toEqual({ yaw: -180, pitch: 0 });
    expect(snapFacing({ yaw: -0.2, pitch: -0.3 }, "exact")).toEqual({ yaw: 0, pitch: 0 });
    expect(Object.is(snapFacing({ yaw: -0.2, pitch: -0.3 }, "exact").yaw, 0)).toBe(true);
  });

  it("tilts a marker's facing line by the pitch, in whole degrees", () => {
    expect(markerPitch(undefined)).toBe(0);
    expect(markerPitch({ yaw: 90, pitch: 12.6 })).toBe(13);
    expect(markerPitch({ yaw: 90, pitch: -95 })).toBe(-90);
    expect(Object.is(markerPitch({ yaw: 0, pitch: -0.2 }), 0)).toBe(true);
  });

  it("compares yaws around the circle", () => {
    expect(sameYaw(180, -180)).toBe(true);
    expect(sameYaw(359.8, 0)).toBe(true);
    expect(sameYaw(45, 45.4)).toBe(true);
    expect(sameYaw(45, 46)).toBe(false);
    expect(sameYaw(0, 180)).toBe(false);
  });

  it("puts a player's feet in a block, even a hair under the top of the one below", () => {
    expect(blockPosition({ x: -0.3, y: 64.99999, z: 7.9 })).toEqual([-1, 65, 7]);
  });
});
