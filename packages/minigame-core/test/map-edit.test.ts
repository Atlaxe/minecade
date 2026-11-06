import { describe, expect, it } from "vitest";
import type { Box, MapConfig } from "../src/map-config.ts";
import { MapEditError, applyEdit, describeEdit, listKey, listOf, type MapEdit } from "../src/map-edit.ts";
import { formatMapConfig } from "../src/map-format.ts";

const base: MapConfig = {
  name: "Arena",
  spawns: [
    [5, 65, 0],
    [-5, 65, 0, 90, 0],
  ],
  bounds: { min: [-20, 50, -20], max: [20, 90, 20] },
  points: { flag: [[0, 65, 0]] },
  build: { commands: ["fill -7 64 -7 7 64 7 stone"] },
};
const box: Box = { min: [-2, 50, -2], max: [2, 55, 2] };

describe("applyEdit's star box", () => {
  it("turns the lobby's star box on and off, after the time", () => {
    const on = applyEdit({ name: "Hub", spawns: [], time: "midnight" }, { op: "stars", on: true });
    expect(Object.keys(on)).toEqual(["name", "spawns", "time", "stars"]);
    expect(on.stars).toBe(true);
    expect("stars" in applyEdit(on, { op: "stars", on: false })).toBe(false);
    expect(describeEdit({ op: "stars", on: true })).toBe("star box on");
  });
});

describe("applyEdit", () => {
  it("adds, moves, faces, removes and renumbers list entries, keeping facings", () => {
    let map = applyEdit(base, { op: "add", target: { list: "spawns" }, at: [0, 65, 5, 180, 10] });
    expect(map.spawns).toEqual([[5, 65, 0], [-5, 65, 0, 90, 0], [0, 65, 5, 180, 10]]);
    map = applyEdit(map, { op: "move", target: { list: "spawns" }, index: 1, at: [-6, 66, 1] });
    expect(map.spawns[1]).toEqual([-6, 66, 1, 90, 0]);
    map = applyEdit(map, { op: "face", target: { list: "spawns" }, index: 0, facing: { yaw: -90, pitch: 5 } });
    expect(map.spawns[0]).toEqual([5, 65, 0, -90, 5]);
    map = applyEdit(map, { op: "face", target: { list: "spawns" }, index: 0 });
    expect(map.spawns[0]).toEqual([5, 65, 0]);
    map = applyEdit(map, { op: "renumber", target: { list: "spawns" }, from: 2, to: 0 });
    expect(map.spawns).toEqual([[0, 65, 5, 180, 10], [5, 65, 0], [-6, 66, 1, 90, 0]]);
    map = applyEdit(map, { op: "remove", target: { list: "spawns" }, index: 1 });
    expect(map.spawns).toEqual([[0, 65, 5, 180, 10], [-6, 66, 1, 90, 0]]);
    expect(base.spawns).toHaveLength(2);
  });

  it("sets and clears each side of the build limit, after kill Y, dropping it once both are gone", () => {
    let map = applyEdit(base, { op: "killY", y: 40 });
    map = applyEdit(map, { op: "buildLimit", side: "below", y: 50 });
    map = applyEdit(map, { op: "buildLimit", side: "above", y: 90 });
    expect(map.buildLimit).toEqual({ above: 90, below: 50 });
    expect(Object.keys(map).indexOf("buildLimit")).toBe(Object.keys(map).indexOf("killY") + 1);
    map = applyEdit(map, { op: "buildLimit", side: "above" });
    expect(map.buildLimit).toEqual({ below: 50 });
    map = applyEdit(map, { op: "buildLimit", side: "below" });
    expect("buildLimit" in map).toBe(false);
    expect(describeEdit({ op: "buildLimit", side: "above", y: 3 })).toBe("set build limit above");
  });

  it("puts new keys where they're written by hand, and drops lists left empty", () => {
    let map = applyEdit(base, { op: "add", target: { list: "teamSpawns", team: "red" }, at: [-10, 65, 0] });
    map = applyEdit(map, { op: "killY", y: 58 });
    map = applyEdit(map, { op: "add", target: { list: "spectatorSpawn" }, at: [0, 80, 0] });
    map = applyEdit(map, { op: "draft", draft: true });
    expect(Object.keys(map)).toEqual(["name", "draft", "spawns", "spectatorSpawn", "bounds", "killY", "teamSpawns", "points", "build"]);
    map = applyEdit(map, { op: "remove", target: { list: "teamSpawns", team: "red" }, index: 0 });
    map = applyEdit(map, { op: "remove", target: { list: "spectatorSpawn" }, index: 0 });
    map = applyEdit(map, { op: "draft", draft: false });
    map = applyEdit(map, { op: "killY" });
    expect(map).toEqual(base);
    expect(formatMapConfig(map)).toBe(formatMapConfig(base));
    // The last flag point takes the empty "points" with it.
    expect(applyEdit(base, { op: "remove", target: { list: "points", name: "flag" }, index: 0 }).points).toBeUndefined();
  });

  it("sets bounds and edits regions, per team too", () => {
    let map = applyEdit(base, { op: "addRegion", name: "kill", box });
    map = applyEdit(map, { op: "addRegion", name: "buyZone.red", box });
    map = applyEdit(map, { op: "setRegion", name: "kill", index: 0, box: { min: [0, 50, 0], max: [1, 51, 1] } });
    expect(map.regions).toEqual({ kill: [{ min: [0, 50, 0], max: [1, 51, 1] }], "buyZone.red": [box] });
    map = applyEdit(map, { op: "removeRegion", name: "buyZone.red", index: 0 });
    map = applyEdit(map, { op: "removeRegion", name: "kill", index: 0 });
    expect(map.regions).toBeUndefined();
    map = applyEdit(map, { op: "bounds" });
    expect(map.bounds).toBeUndefined();
    map = applyEdit(map, { op: "bounds", box });
    expect(Object.keys(map)).toEqual(["name", "spawns", "bounds", "points", "build"]);
    expect(applyEdit(map, { op: "name", name: "Fort" }).name).toBe("Fort");
  });

  it("adds, changes and removes bounds boxes, writing one box as a box", () => {
    const second: Box = { min: [30, 50, -5], max: [40, 60, 5] };
    let map = applyEdit(base, { op: "addBounds", box: second });
    expect(map.bounds).toEqual([base.bounds, second]);
    map = applyEdit(map, { op: "setBounds", index: 1, box });
    expect(map.bounds).toEqual([base.bounds, box]);
    map = applyEdit(map, { op: "removeBounds", index: 0 });
    expect(map.bounds).toEqual(box);
    expect(Object.keys(map)).toEqual(Object.keys(base));
    expect(applyEdit(map, { op: "removeBounds", index: 0 }).bounds).toBeUndefined();
    // Bounds replaces them all with one box.
    expect(applyEdit(applyEdit(base, { op: "addBounds", box: second }), { op: "bounds", box }).bounds).toEqual(box);
    expect(applyEdit({ name: "New", spawns: [] }, { op: "addBounds", box }).bounds).toEqual(box);
    expect(() => applyEdit(base, { op: "setBounds", index: 1, box })).toThrow("there is no entry 2 (the list has 1)");
    expect(describeEdit({ op: "addBounds", box })).toBe("add bounds");
    expect(describeEdit({ op: "removeBounds", index: 1 })).toBe("remove bounds 2");
    expect(formatMapConfig(applyEdit(base, { op: "addBounds", box: second }))).toContain(
      '"bounds": [\n    { "min": [-20, 50, -20], "max": [20, 90, 20] },\n    { "min": [30, 50, -5], "max": [40, 60, 5] }\n  ],',
    );
  });

  it("keeps the spectator bounds apart from the bounds, right after them", () => {
    const stand: Box = { min: [30, 60, -5], max: [40, 70, 5] };
    let map = applyEdit(base, { op: "addBounds", box: stand, spectators: true });
    expect(map.spectatorBounds).toEqual(stand);
    expect(map.bounds).toEqual(base.bounds);
    expect(Object.keys(map)).toEqual(["name", "spawns", "bounds", "spectatorBounds", "points", "build"]);
    map = applyEdit(map, { op: "addBounds", box, spectators: true });
    expect(map.spectatorBounds).toEqual([stand, box]);
    map = applyEdit(map, { op: "setBounds", index: 0, box, spectators: true });
    expect(map.spectatorBounds).toEqual([box, box]);
    map = applyEdit(map, { op: "removeBounds", index: 1, spectators: true });
    expect(map.spectatorBounds).toEqual(box);
    expect(applyEdit(map, { op: "removeBounds", index: 0, spectators: true }).spectatorBounds).toBeUndefined();
    expect(applyEdit(map, { op: "bounds", spectators: true }).spectatorBounds).toBeUndefined();
    expect(applyEdit(map, { op: "bounds", spectators: true }).bounds).toEqual(base.bounds);
    expect(() => applyEdit(base, { op: "removeBounds", index: 0, spectators: true })).toThrow("there is no entry 1 (the list has 0)");
    expect(describeEdit({ op: "addBounds", box, spectators: true })).toBe("add spectator bounds");
    expect(describeEdit({ op: "removeBounds", index: 1, spectators: true })).toBe("remove spectator bounds 2");
    expect(describeEdit({ op: "bounds", box, spectators: true })).toBe("set spectator bounds");
    expect(describeEdit({ op: "bounds" })).toBe("clear bounds");
    expect(describeEdit({ op: "killY", y: 40 })).toBe("set killY");
  });

  it("places, changes and removes preview cameras", () => {
    const camera = { at: [0, 80, -20, 0, 20] as [number, number, number, number, number], kind: "map" as const };
    let map = applyEdit(base, { op: "camera", name: "Camera 1", camera });
    expect(map.cameras).toEqual({ "Camera 1": camera });
    expect(Object.keys(map).at(-2)).toBe("cameras");
    map = applyEdit(map, { op: "camera", name: "Camera 1", camera: { ...camera, kind: "game" } });
    expect(map.cameras?.["Camera 1"].kind).toBe("game");
    expect(applyEdit(map, { op: "camera", name: "Camera 1" }).cameras).toBeUndefined();
    expect(() => applyEdit(map, { op: "camera", name: "Camera 9" })).toThrow('there is no camera "Camera 9"');
    expect(() => applyEdit(map, { op: "camera", name: " ", camera })).toThrow("a camera needs a name");
    expect(describeEdit({ op: "camera", name: "Camera 1", camera })).toBe("set camera Camera 1");
    expect(describeEdit({ op: "camera", name: "Camera 1" })).toBe("remove camera Camera 1");
  });

  it("refuses edits that don't fit", () => {
    expect(() => applyEdit(base, { op: "remove", target: { list: "spawns" }, index: 2 })).toThrow(MapEditError);
    expect(() => applyEdit(base, { op: "move", target: { list: "points", name: "bomb" }, index: 0, at: [0, 0, 0] })).toThrow("there is no entry 1 (the list has 0)");
    const withSpectator = applyEdit(base, { op: "add", target: { list: "spectatorSpawn" }, at: [0, 80, 0] });
    expect(() => applyEdit(withSpectator, { op: "add", target: { list: "spectatorSpawn" }, at: [0, 81, 0] })).toThrow("a map has one spectator spawn");
    expect(() => applyEdit(base, { op: "name", name: "" })).toThrow("a map needs a name");
  });

  it("replaces entries, sets game settings, drops build, and batches edits as one change", () => {
    let map = applyEdit(base, { op: "set", target: { list: "spawns" }, index: 0, at: [1, 66, 1, 45, 0] });
    expect(map.spawns[0]).toEqual([1, 66, 1, 45, 0]);
    map = applyEdit(map, { op: "extra", key: "eliminationY", value: 50 });
    expect(Object.keys(map)).toEqual(["name", "spawns", "bounds", "points", "eliminationY", "build"]);
    expect(applyEdit(map, { op: "extra", key: "eliminationY" }).eliminationY).toBeUndefined();
    expect(() => applyEdit(map, { op: "extra", key: "spawns", value: 1 })).toThrow(MapEditError);
    expect(applyEdit(map, { op: "dropBuild" }).build).toBeUndefined();
    const batch: MapEdit = {
      op: "batch",
      edits: [
        { op: "remove", target: { list: "spawns" }, index: 1 },
        { op: "add", target: { list: "points", name: "flag" }, at: [-5, 65, 0, 90, 0] },
      ],
    };
    map = applyEdit(base, batch);
    expect(map.spawns).toEqual([[5, 65, 0]]);
    expect(map.points).toEqual({ flag: [[0, 65, 0], [-5, 65, 0, 90, 0]] });
    expect(describeEdit(batch)).toBe("remove spawns 2, add points.flag");
    // A batch that fails partway changes nothing.
    expect(() => applyEdit(base, { op: "batch", edits: [{ op: "dropBuild" }, { op: "remove", target: { list: "spawns" }, index: 5 }] })).toThrow(MapEditError);
  });

  it("names lists and edits for logs", () => {
    expect(listKey({ list: "teamSpawns", team: "red" })).toBe("teamSpawns.red");
    expect(listKey({ list: "points", name: "bombA" })).toBe("points.bombA");
    expect(describeEdit({ op: "move", target: { list: "spawns" }, index: 2, at: [0, 0, 0] })).toBe("move spawns 3");
    expect(describeEdit({ op: "draft", draft: false })).toBe("publish (no longer a draft)");
  });

  it("lists a map's entries", () => {
    expect(listOf(base, { list: "points", name: "flag" })).toEqual([[0, 65, 0]]);
    expect(listOf(base, { list: "teamSpawns", team: "red" })).toEqual([]);
    expect(listOf(base, { list: "spectatorSpawn" })).toEqual([]);
  });
});

describe("the queue spawn", () => {
  const base: MapConfig = { name: "M", spawns: [[0, 65, 0]] };

  it("is a list of one, placed after the spectator spawn, with its settings beside it", () => {
    const placed = applyEdit(base, { op: "add", target: { list: "queueSpawn" }, at: [0, 80, 30] });
    expect(placed.queueSpawn).toEqual([0, 80, 30]);
    expect(() => applyEdit(placed, { op: "add", target: { list: "queueSpawn" }, at: [1, 80, 30] })).toThrow("one queue spawn");
    const free = applyEdit(placed, { op: "queue", mode: "free" });
    expect(free.queue).toEqual({ mode: "free", countdown: 5 });
    expect(Object.keys(applyEdit(free, { op: "queue", countdown: 9 }))).toEqual(["name", "spawns", "queueSpawn", "queue"]);
    expect(describeEdit({ op: "queue", mode: "lock", countdown: 9 })).toBe("queue: lock in 9 s countdown");
  });

  it("refuses settings without a queue spawn or out of range, and drops them with it", () => {
    expect(() => applyEdit(base, { op: "queue", mode: "free" })).toThrow("place the queue spawn first");
    const placed: MapConfig = { ...base, queueSpawn: [0, 80, 30], queue: { mode: "free", countdown: 5 } };
    expect(() => applyEdit(placed, { op: "queue", countdown: 0 })).toThrow("whole seconds from 1 to 60");
    const removed = applyEdit(placed, { op: "remove", target: { list: "queueSpawn" }, index: 0 });
    expect(removed.queueSpawn).toBeUndefined();
    expect(removed.queue).toBeUndefined();
  });
});
