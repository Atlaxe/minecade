import type { EditorRules, MapConfig } from "@minecade/minigame-core/config";
import { describe, expect, it } from "vitest";
import { KIND_COLORS, boxText, buildMarkup, findEntry } from "../markup.ts";

const RULES: EditorRules = {
  kind: "game",
  maxPlayers: 4,
  requires: {
    teamSpawns: true,
    bounds: true,
    buildLimit: { above: true },
    points: { hole: { label: "Hole", perTeam: true, marker: { model: "hole" } }, flag: { label: "Flag" } },
    regions: { spawnGuard: { label: "Spawn guard", perTeam: true }, plot: { label: "Plot", minSize: 4 } },
  },
  teams: [
    { id: "red", name: "Red", color: "§c" },
    { id: "blue", name: "Blue", color: "§9" },
  ],
  markerModels: { hole: 3 },
};

const CONFIG: MapConfig = {
  name: "Test",
  spawns: [[0, 64, 0]],
  queueSpawn: [1.5, 64, 2.25, 90, 10],
  bounds: { min: [-10, 60, -10], max: [10, 80, 10] },
  killY: 50,
  buildLimit: { above: 75 },
  teamSpawns: { red: [[3, 64, 3]] },
  points: { "hole.red": [[5, 60, 5]], flag: [[0, 70, 0]] },
  regions: { "spawnGuard.red": [{ min: [0, 60, 0], max: [2, 62, 2] }] },
};

describe("buildMarkup", () => {
  const markup = buildMarkup(CONFIG, RULES);

  it("draws every entry as game Edit does: its list's color, shape and name", () => {
    const byKey = Object.fromEntries(markup.points.map((point) => [point.key, point]));
    expect(byKey["spawns#0"]).toMatchObject({ label: "Spawn 1", color: KIND_COLORS.spawns, shape: { kind: "player" }, at: { x: 0.5, y: 64, z: 0.5 }, faced: false });
    expect(byKey["teamSpawns.red#0"]).toMatchObject({ label: "Red spawn 1", color: 0xff5555, shape: { kind: "player" } });
    expect(byKey["queueSpawn#0"]).toMatchObject({ label: "Queue spawn (lock in, 5 s)", color: KIND_COLORS.queueSpawn, at: { x: 1.5, y: 64, z: 2.25 }, yaw: 90, pitch: 10, faced: true });
    expect(byKey["points.hole.red#0"]).toMatchObject({ label: "Hole (Red) 1", color: 0xff5555, shape: { kind: "model", model: "hole" } });
    expect(byKey["points.flag#0"]).toMatchObject({ label: "Flag 1", color: KIND_COLORS.points, shape: { kind: "post" } });
  });

  it("points an entry without a facing at the map's middle", () => {
    const spawn = markup.points.find((point) => point.key === "teamSpawns.red#0")!;
    // From (3.5, 3.5) toward the bounds' middle (0.5, 0.5): north-west, yaw 135.
    expect(spawn.yaw).toBe(135);
  });

  it("lists the boxes in game Edit's region colors, and the heights", () => {
    expect(markup.boxes.map((box) => [box.key, box.color])).toEqual([
      ["bounds#0", 0xffffff],
      ["regions.spawnGuard.red#0", 0xff5555],
    ]);
    expect(markup.planes.map((plane) => [plane.key, plane.y, plane.color])).toEqual([
      ["killY", 50, 0xd00000],
      ["buildLimit.above", 75, 0xff8c1a],
    ]);
  });

  it("groups the lists as game Edit's tools do, with what the checklist needs", () => {
    expect(markup.sections.map((section) => section.title)).toEqual(["Spawns", "Game markers", "Boundaries"]);
    const lists = Object.fromEntries(markup.sections.flatMap((section) => section.lists).map((list) => [list.key, list]));
    expect(lists["teamSpawns.blue"]).toMatchObject({ label: "Blue spawns", need: 1, done: false, entries: [] });
    expect(lists["points.hole.red"]).toMatchObject({ label: "Hole (Red)", need: 1, done: true });
    expect(lists["regions.kill"]).toMatchObject({ label: "Kill region", color: 0xd00000, entries: [] });
    // A region with no boxes yet still has its color, and the game's minimum size.
    expect(lists["regions.plot"]).toMatchObject({ label: "Plot", minSize: 4, entries: [] });
    expect(lists["regions.plot"].color).not.toBe(0xffffff);
    expect(lists.killY).toMatchObject({ kind: "plane", entries: [{ key: "killY", detail: "y 50" }] });
    expect(lists["buildLimit.below"]).toMatchObject({ kind: "plane", entries: [] });
    expect(lists.queueSpawn.entries[0].detail).toBe("1.5 64 2.25, faces west");
  });

  it("finds an entry and its list by key", () => {
    expect(findEntry(markup, "bounds#0")).toMatchObject({ list: { key: "bounds" }, entry: { label: "Bounds", detail: "21 x 21 x 21 from -10 60 -10" } });
    expect(findEntry(markup, "nowhere#0")).toBeUndefined();
  });

  it("carries the checklist", () => {
    expect(markup.checklist.ready).toBe(false);
    expect(markup.checklist.problems.join(" ")).toMatch(/blue/i);
  });
});

describe("boxText", () => {
  it("says a box's size and corner", () => {
    expect(boxText({ min: [0, 1, 2], max: [0, 1, 2] })).toBe("1 x 1 x 1 from 0 1 2");
  });
});
