import type { MapList } from "@minecade/minigame-core/config";
import { describe, expect, it } from "vitest";
import { mirrorBox, mirrorPosition, mirrorYaw, nextTeam, speedEdits, teamOf, type SpeedEntry } from "../speed.ts";

const TEAMS = ["red", "blue"];

describe("mirrorPosition", () => {
  it("mirrors a block's middle to the block across 0, and an exact point to its negative", () => {
    // Block 3 (middle 3.5) mirrors to block -4 (middle -3.5).
    expect(mirrorPosition([3, 65, -2], "x")).toEqual([-4, 65, -2]);
    expect(mirrorPosition([3, 65, -2], "z")).toEqual([3, 65, 1]);
    expect(mirrorPosition([3, 65, -2], "turn")).toEqual([-4, 65, 1]);
    expect(mirrorPosition([3.27, 65, -1.84], "x")).toEqual([-3.27, 65, -1.84]);
    expect(mirrorPosition([0.5, 64.5, 0], "turn")).toEqual([-0.5, 64.5, 0]);
  });

  it("mirrors across the map's middle when it isn't 0: a half block's middle, or a block's edge", () => {
    // Bounds x -18 to 18 have their middle at 0.5 (block 0's middle): block 3 mirrors to block -3.
    expect(mirrorPosition([3, 65, -21], "x", { x: 0.5, z: 8 })).toEqual([-3, 65, -21]);
    expect(mirrorPosition([3, 65, -21.59], "x", { x: 0.5, z: 8 })).toEqual([-2, 65, -21.59]);
    expect(mirrorPosition([0.49, -31, -21.59], "z", { x: 0.5, z: 8 })).toEqual([0.49, -31, 37.59]);
    expect(mirrorBox({ min: [2, 60, -5], max: [6, 70, -1] }, "z", { x: 0, z: 8 })).toEqual({ min: [2, 60, 16], max: [6, 70, 20] });
  });

  it("turns a fixed facing with it", () => {
    expect(mirrorPosition([3, 65, -2, 90, 10], "x")).toEqual([-4, 65, -2, -90, 10]);
    expect(mirrorYaw(0, "z")).toBe(180);
    expect(mirrorYaw(45, "z")).toBe(135);
    expect(mirrorYaw(-90, "turn")).toBe(90);
    expect(mirrorYaw(180, "x")).toBe(180);
  });
});

describe("mirrorBox", () => {
  it("mirrors whole blocks across 0", () => {
    expect(mirrorBox({ min: [2, 60, -5], max: [6, 70, -1] }, "x")).toEqual({ min: [-7, 60, -5], max: [-3, 70, -1] });
    expect(mirrorBox({ min: [2, 60, -5], max: [6, 70, -1] }, "turn")).toEqual({ min: [-7, 60, 0], max: [-3, 70, 4] });
  });
});

describe("teams", () => {
  const point = (target: MapList): SpeedEntry => ({ kind: "point", label: "P", target, position: [1, 2, 3] });
  it("reads an entry's team from its list, and goes round the teams", () => {
    expect(teamOf(point({ list: "teamSpawns", team: "red" }), TEAMS)).toBe("red");
    expect(teamOf(point({ list: "points", name: "hole.blue" }), TEAMS)).toBe("blue");
    expect(teamOf(point({ list: "points", name: "lamp" }), TEAMS)).toBeUndefined();
    expect(teamOf({ kind: "box", label: "B", place: { kind: "region", name: "spawnGuard.red" }, box: { min: [0, 0, 0], max: [1, 1, 1] } }, TEAMS)).toBe("red");
    expect(nextTeam("blue", ["red", "blue", "yellow"])).toBe("yellow");
    expect(nextTeam("yellow", ["red", "blue", "yellow"])).toBe("red");
  });
});

describe("speedEdits", () => {
  const entries: SpeedEntry[] = [
    { kind: "point", label: "Red spawn 1", target: { list: "teamSpawns", team: "red" }, position: [10, 64, 5, 90, 0] },
    { kind: "point", label: "Hole (Red) 1", target: { list: "points", name: "hole.red" }, position: [12.5, 60, 7.25] },
    { kind: "box", label: "Spawn guard (Red) 1", place: { kind: "region", name: "spawnGuard.red" }, box: { min: [8, 60, 2], max: [14, 70, 9] } },
    { kind: "box", label: "Bounds", place: { kind: "bounds" }, box: { min: [0, 50, 0], max: [20, 90, 20] } },
    { kind: "point", label: "Queue spawn", target: { list: "queueSpawn" }, position: [0, 64, 0], single: true },
  ];

  it("mirrors each entry into the other team's list, untouched lists into their own, and leaves out single entries", () => {
    const { edits, skipped } = speedEdits(entries, TEAMS, { mirror: "x" });
    expect(edits).toEqual([
      { op: "add", target: { list: "teamSpawns", team: "blue" }, at: [-11, 64, 5, -90, 0] },
      { op: "add", target: { list: "points", name: "hole.blue" }, at: [-12.5, 60, 7.25] },
      { op: "addRegion", name: "spawnGuard.blue", box: { min: [-15, 60, 2], max: [-9, 70, 9] } },
      { op: "addBounds", box: { min: [-21, 50, 0], max: [-1, 90, 20] } },
    ]);
    expect(skipped).toEqual(["Queue spawn holds one entry"]);
    // Kept in their own team's lists when asked.
    expect(speedEdits(entries.slice(0, 1), TEAMS, { mirror: "z", mirrorTeam: { kind: "same" } }).edits).toEqual([{ op: "add", target: { list: "teamSpawns", team: "red" }, at: [10, 64, -6, 90, 0] }]);
  });

  it("copies team entries to another team as they are, and says which it left out", () => {
    const { edits, skipped } = speedEdits(entries, TEAMS, { copyTo: "blue" });
    expect(edits).toEqual([
      { op: "add", target: { list: "teamSpawns", team: "blue" }, at: [10, 64, 5, 90, 0] },
      { op: "add", target: { list: "points", name: "hole.blue" }, at: [12.5, 60, 7.25] },
      { op: "addRegion", name: "spawnGuard.blue", box: { min: [8, 60, 2], max: [14, 70, 9] } },
    ]);
    expect(skipped).toEqual(["Bounds isn't a team's", "Queue spawn isn't a team's"]);
    expect(speedEdits(entries.slice(0, 1), TEAMS, { copyTo: "red" }).skipped).toEqual(["Red spawn 1 is already red's"]);
  });
});
