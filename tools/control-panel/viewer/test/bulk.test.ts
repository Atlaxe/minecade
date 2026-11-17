import { applyEdit, type Box, type MapConfig, type MapEdit } from "@minecade/minigame-core/config";
import { describe, expect, it } from "vitest";
import { boxCornerEdits, boxListKey, groupMiddle, howMany, moveEdits, pointEdits, retypeBoxesEdits, retypePointsEdits, runOf, shared, spaceEdits, type BulkBox, type BulkPoint, type BulkSpace } from "../bulk.ts";

const config = {
  name: "Test",
  spawns: [
    [1, 64, 1],
    [2.37, 64, 2, 90, 10],
    [5, 65, 5],
  ],
  teamSpawns: { red: [[8, 64, 8]] },
  regions: {
    plot: [
      { min: [0, 64, 0], max: [23, 87, 23] },
      { min: [30, 64, 0], max: [53, 87, 23] },
    ],
  },
  spaces: [
    { id: 1, at: [0, 64, 0], type: "start", next: [2] },
    { id: 2, at: [4, 64, 0], type: "red", next: [3], star: true },
    { id: 3, at: [8, 64, 0], type: "blue", next: [1], locked: true },
  ],
} as unknown as MapConfig;

const spawn = (index: number): BulkPoint => ({ kind: "point", key: `spawns#${index}`, label: `Spawn ${index + 1}`, target: { list: "spawns" }, index, position: config.spawns[index], yaw: 45 });
const space = (id: number): BulkSpace => ({ kind: "space", key: `space:${id}`, label: `Space ${id}`, id, position: config.spaces!.find((candidate) => candidate.id === id)!.at });
const plot = (index: number, minSize?: number): BulkBox => {
  const box = config.regions!.plot[index];
  return { kind: "box", key: `regions.plot#${index}`, label: `Build boundary ${index + 1}`, entry: { key: `regions.plot#${index}`, label: `Build boundary ${index + 1}`, box, region: { name: "plot", index } }, box, ...(minSize === undefined ? {} : { minSize }) };
};
const run = (edits: MapEdit[]) => applyEdit(config, { op: "batch", edits });

describe("shared values", () => {
  it("is the value every one has, else undefined (Mixed)", () => {
    expect(shared([64, 64, 64])).toBe(64);
    expect(shared([64, 65])).toBeUndefined();
    expect(shared([])).toBeUndefined();
    expect(howMany([1, 2, 3], (n) => n > 0)).toBe("all");
    expect(howMany([1, 2, 3], (n) => n > 1)).toBe("some");
    expect(howMany([1, 2, 3], (n) => n > 5)).toBe("none");
  });
});

describe("moving several together", () => {
  it("moves points, spaces and boxes by whole blocks, each keeping its facing and an exact point exact", () => {
    const next = run(moveEdits([spawn(0), spawn(1), space(2), plot(1)], [3, 1, -2]));
    expect(next.spawns).toEqual([[4, 65, -1], [5.37, 65, 0, 90, 10], [5, 65, 5]]);
    expect(next.spaces!.find((candidate) => candidate.id === 2)!.at).toEqual([7, 65, -2]);
    expect(next.regions!.plot).toEqual([config.regions!.plot[0], { min: [33, 65, -2], max: [56, 88, 21] }]);
  });

  it("does nothing for no offset", () => {
    expect(moveEdits([spawn(0)], [0, 0, 0])).toEqual([]);
  });

  it("puts the gizmo at the middle of them all", () => {
    expect(groupMiddle([{ x: 1.5, y: 64, z: 1.5 }], [{ min: [4, 60, 4], max: [5, 61, 5] } as Box])).toEqual([3.75, 62.5, 3.75]);
    expect(groupMiddle([], [])).toBeUndefined();
  });
});

describe("a value typed for several", () => {
  it("sets one axis on each point and space, leaving out the ones that have it", () => {
    const edits = pointEdits([spawn(0), spawn(1), spawn(2), space(3)], { axis: 1, value: 65 });
    // Spawn 3 is at y 65 already.
    expect(edits).toHaveLength(3);
    const next = run(edits);
    expect(next.spawns).toEqual([[1, 65, 1], [2.37, 65, 2, 90, 10], [5, 65, 5]]);
    expect(next.spaces!.find((candidate) => candidate.id === 3)!.at).toEqual([8, 65, 0]);
  });

  it("makes them all face a fixed way (the way they were shown), or none", () => {
    const faced = run(pointEdits([spawn(0), spawn(1)], { faced: true }));
    expect(faced.spawns!.slice(0, 2)).toEqual([[1, 64, 1, 45, 0], [2.37, 64, 2, 90, 10]]);
    const free = run(pointEdits([spawn(0), spawn(1), space(1)], { faced: false }));
    expect(free.spawns!.slice(0, 2)).toEqual([[1, 64, 1], [2.37, 64, 2]]);
  });

  it("sets the yaw and pitch on the ones facing a fixed way", () => {
    const both = run(pointEdits([spawn(0), spawn(1)], { faced: true }));
    const points = [0, 1].map((index): BulkPoint => ({ ...spawn(index), position: both.spawns![index] }));
    expect(applyEdit(both, { op: "batch", edits: pointEdits(points, { yaw: 270 }) }).spawns!.slice(0, 2)).toEqual([[1, 64, 1, -90, 0], [2.37, 64, 2, -90, 10]]);
    expect(applyEdit(both, { op: "batch", edits: pointEdits(points, { pitch: 120 }) }).spawns!.slice(0, 2)).toEqual([[1, 64, 1, 45, 90], [2.37, 64, 2, 90, 90]]);
  });

  it("sets a corner on each box, unless one would be too small for its list", () => {
    const { edits } = boxCornerEdits([plot(0), plot(1)], "min", 1, 70);
    expect(run(edits).regions!.plot).toEqual([
      { min: [0, 70, 0], max: [23, 87, 23] },
      { min: [30, 70, 0], max: [53, 87, 23] },
    ]);
    expect(boxCornerEdits([plot(0, 24), plot(1, 24)], "min", 1, 70).problem).toBe("Build boundary 1 would be too small: it must span at least 24 blocks along every side.");
  });

  it("gives every space a type as one retype, and a switch to the ones without it", () => {
    const spaces = config.spaces!;
    expect(spaceEdits(spaces, { type: "blue" })).toEqual([{ op: "retypeSpaces", types: { "1": "blue", "2": "blue" } }]);
    expect(spaceEdits(spaces, { flag: "locked", on: true })).toEqual([
      { op: "setSpace", id: 1, locked: true },
      { op: "setSpace", id: 2, locked: true },
    ]);
    expect(spaceEdits(spaces, { flag: "star", on: false })).toEqual([{ op: "setSpace", id: 2, star: false }]);
  });
});

describe("a Type for several", () => {
  it("moves spawns into one list in the order picked, the ones there already staying", () => {
    const red: BulkPoint = { kind: "point", key: "teamSpawns.red#0", label: "Red spawn 1", target: { list: "teamSpawns", team: "red" }, index: 0, position: [8, 64, 8], yaw: 0 };
    const { edits, moved } = retypePointsEdits([spawn(2), red, spawn(0)], { list: "teamSpawns", team: "red" });
    expect(moved).toBe(2);
    const next = run(edits);
    expect(next.spawns).toEqual([[2.37, 64, 2, 90, 10]]);
    expect(next.teamSpawns).toEqual({ red: [[8, 64, 8], [5, 65, 5], [1, 64, 1]] });
  });

  it("moves boxes into another list, unless one is too small for it", () => {
    const { edits, moved } = retypeBoxesEdits([plot(0), plot(1)], { kind: "region", name: "kill" }, "regions.kill", "Kill region", undefined);
    expect(moved).toBe(2);
    expect(run(edits).regions).toEqual({ kill: config.regions!.plot });
    expect(retypeBoxesEdits([plot(0)], { kind: "region", name: "big" }, "regions.big", "Big", 30).problem).toBe("Build boundary 1 is too small for Big: boxes there span at least 30 blocks along every side.");
    expect(boxListKey(plot(0).entry)).toBe("regions.plot");
    expect(boxListKey({ key: "spectatorBounds#0", label: "Spectator bounds", box: plot(0).box, spectators: true })).toBe("spectatorBounds");
  });
});

describe("a run in the overview", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("is every entry from the last one clicked to this one, either way", () => {
    expect(runOf(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(runOf(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(runOf(order, "c", "c")).toEqual(["c"]);
  });

  it("is only this one when nothing was clicked, or the other isn't shown", () => {
    expect(runOf(order, undefined, "c")).toEqual(["c"]);
    expect(runOf(order, "z", "c")).toEqual(["c"]);
  });
});
