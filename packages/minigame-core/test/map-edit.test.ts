import { describe, expect, it } from "vitest";
import type { MapConfig } from "../src/map-config.ts";
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
const box = { min: [-2, 50, -2], max: [2, 55, 2] } as MapConfig["bounds"] & object;

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
    expect(describeEdit({ op: "draft", draft: false })).toBe("mark ready");
  });

  it("lists a map's entries", () => {
    expect(listOf(base, { list: "points", name: "flag" })).toEqual([[0, 65, 0]]);
    expect(listOf(base, { list: "teamSpawns", team: "red" })).toEqual([]);
    expect(listOf(base, { list: "spectatorSpawn" })).toEqual([]);
  });
});
