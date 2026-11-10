import type { Box } from "@minecade/minigame-core/config";
import { describe, expect, it } from "vitest";
import { markupProblem, viewerEdit } from "../edit-check.ts";

describe("viewerEdit", () => {
  it("takes the edits that place, move, face and remove markup", () => {
    const edits = [
      { op: "add", target: { list: "spawns" }, at: [0, 64, 0] },
      { op: "add", target: { list: "teamSpawns", team: "red" }, at: [0.5, 64, 0.25, 90, 0] },
      { op: "set", target: { list: "queueSpawn" }, index: 0, at: [1, 2, 3] },
      { op: "move", target: { list: "points", name: "hole.red" }, index: 1, at: [1, 2, 3] },
      { op: "face", target: { list: "spectatorSpawn" }, index: 0, facing: { yaw: -90, pitch: 0 } },
      { op: "face", target: { list: "spawns" }, index: 0 },
      { op: "remove", target: { list: "spawns" }, index: 3 },
      { op: "addBounds", box: { min: [0, 0, 0], max: [5, 5, 5] }, spectators: true },
      { op: "setRegion", name: "spawnGuard.red", index: 0, box: { min: [0, 0, 0], max: [0, 0, 0] } },
      { op: "killY", y: -64 },
      { op: "buildLimit", side: "above", y: 320 },
      { op: "buildLimit", side: "below" },
      { op: "draft", draft: false },
      { op: "batch", edits: [{ op: "killY" }, { op: "remove", target: { list: "spawns" }, index: 0 }] },
    ];
    for (const edit of edits) expect(viewerEdit(edit)).toBe(edit);
  });

  it("takes the map settings: the name, the time, the queue, game settings and the star box", () => {
    const edits = [
      { op: "name", name: "Castle Keep" },
      { op: "time", time: "sunset" },
      { op: "time", time: 18000 },
      { op: "time" },
      { op: "queue", mode: "free" },
      { op: "queue", countdown: 10 },
      { op: "extra", key: "buildPadding", value: 4 },
      { op: "extra", key: "buildPadding" },
      { op: "extra", key: "theme", value: "ice" },
      { op: "stars", on: true },
      { op: "gameThumbnail", on: true },
    ];
    for (const edit of edits) expect(viewerEdit(edit)).toBe(edit);
    expect(viewerEdit({ op: "name", name: "" })).toMatch(/1 to 48/);
    expect(viewerEdit({ op: "name", name: " Padded" })).toMatch(/1 to 48/);
    expect(viewerEdit({ op: "name", name: "\u00a7cRed" })).toMatch(/color codes/);
    expect(viewerEdit({ op: "time", time: "teatime" })).toMatch(/time of day/);
    expect(viewerEdit({ op: "time", time: 24000 })).toMatch(/time of day/);
    expect(viewerEdit({ op: "queue" })).toMatch(/mode or its countdown/);
    expect(viewerEdit({ op: "queue", countdown: 0 })).toMatch(/1 to 60/);
    expect(viewerEdit({ op: "queue", mode: "wait" })).toMatch(/lock or free/);
    expect(viewerEdit({ op: "extra", key: "spawns", value: 1 })).toMatch(/not one of map.json's own/);
    expect(viewerEdit({ op: "extra", key: "x", value: [1] })).toMatch(/number, true or false, or text/);
    expect(viewerEdit({ op: "stars", on: "yes" })).toMatch(/true or false/);
    expect(viewerEdit({ op: "gameThumbnail" })).toMatch(/true or false/);
  });

  it("refuses what the viewer doesn't change, and malformed edits", () => {
    expect(viewerEdit({ op: "camera", name: "X" })).toMatch(/doesn't make "camera" edits/);
    expect(viewerEdit({ op: "dropBuild" })).toMatch(/doesn't make/);
    expect(viewerEdit("add")).toMatch(/object/);
    expect(viewerEdit({ op: "add", target: { list: "spawns" }, at: [0, null, 0] })).toMatch(/position/);
    expect(viewerEdit({ op: "add", target: { list: "spawns" }, at: [0, 1] })).toMatch(/position/);
    expect(viewerEdit({ op: "add", target: { list: "cameras" }, at: [0, 1, 2] })).toMatch(/not a list/);
    expect(viewerEdit({ op: "add", target: { list: "points", name: "../x" }, at: [0, 1, 2] })).toMatch(/name their list/);
    expect(viewerEdit({ op: "remove", target: { list: "spawns" }, index: -1 })).toMatch(/whole number/);
    expect(viewerEdit({ op: "addBounds", box: { min: [0, 0, 0], max: [0.5, 1, 1] } })).toMatch(/whole-block/);
    expect(viewerEdit({ op: "addBounds", box: { min: [5, 0, 0], max: [0, 1, 1] } })).toMatch(/whole-block/);
    expect(viewerEdit({ op: "addRegion", name: "9lives", box: { min: [0, 0, 0], max: [1, 1, 1] } })).toMatch(/region's name/);
    expect(viewerEdit({ op: "killY", y: 320 })).toMatch(/kill Y/);
    expect(viewerEdit({ op: "buildLimit", side: "up", y: 1 })).toMatch(/above or below/);
    expect(viewerEdit({ op: "buildLimit", side: "above", y: 321 })).toMatch(/build limit/);
    expect(viewerEdit({ op: "batch", edits: [{ op: "batch", edits: [] }] })).toMatch(/batch/);
    expect(viewerEdit({ op: "batch", edits: [] })).toMatch(/1 to/);
  });
});

describe("markupProblem", () => {
  const requires = { regions: { plot: { label: "Build boundary", count: 8, minSize: 24 } }, settings: { buildPadding: { label: "Build padding", default: 2, min: 0, max: 8, unit: "blocks" } } };
  const rules = { requires, kind: "game" };
  const config = { name: "M", spawns: [], buildLimit: { above: 80, below: 60 } };

  it("refuses a region box under the game's minSize, as game Edit does", () => {
    const small = { min: [0, 0, 0], max: [22, 30, 30] } as Box;
    const big = { min: [0, 0, 0], max: [23, 23, 23] } as Box;
    expect(markupProblem(config, { op: "addRegion", name: "plot", box: small }, rules)).toMatch(/at least 24 blocks/);
    expect(markupProblem(config, { op: "setRegion", name: "plot", index: 0, box: big }, rules)).toBeUndefined();
    expect(markupProblem(config, { op: "addRegion", name: "kill", box: small }, rules)).toBeUndefined();
  });

  it("keeps the build limit's sides apart", () => {
    expect(markupProblem(config, { op: "buildLimit", side: "above", y: 60 }, rules)).toMatch(/over the build limit below/);
    expect(markupProblem(config, { op: "buildLimit", side: "above" }, rules)).toBeUndefined();
    expect(markupProblem(config, { op: "batch", edits: [{ op: "killY", y: 999 }] }, rules)).toMatch(/Kill Y/);
  });

  it("keeps a game setting in its range, other keys to their kind, the star box to the lobby, and the queue to its spawn", () => {
    const withKeys = { ...config, theme: "ice", eliminationY: 40 };
    expect(markupProblem(withKeys, { op: "extra", key: "buildPadding", value: 4 }, rules)).toBeUndefined();
    expect(markupProblem(withKeys, { op: "extra", key: "buildPadding", value: 9 }, rules)).toMatch(/0 to 8/);
    expect(markupProblem(withKeys, { op: "extra", key: "buildPadding" }, rules)).toBeUndefined();
    expect(markupProblem(withKeys, { op: "extra", key: "theme", value: "lava" }, rules)).toBeUndefined();
    expect(markupProblem(withKeys, { op: "extra", key: "eliminationY", value: "high" }, rules)).toMatch(/a number/);
    expect(markupProblem(withKeys, { op: "extra", key: "newKey", value: 1 }, rules)).toMatch(/isn't one of this map's settings/);
    expect(markupProblem(config, { op: "stars", on: true }, rules)).toMatch(/only for the lobby/);
    expect(markupProblem(config, { op: "stars", on: true }, { kind: "lobby" })).toBeUndefined();
    expect(markupProblem(config, { op: "stars", on: false }, rules)).toBeUndefined();
    expect(markupProblem(config, { op: "gameThumbnail", on: true }, rules)).toBeUndefined();
    expect(markupProblem(config, { op: "gameThumbnail", on: true }, { kind: "lobby" })).toMatch(/lobby has no picture/);
    expect(markupProblem(config, { op: "gameThumbnail", on: false }, { kind: "lobby" })).toBeUndefined();
    expect(markupProblem(config, { op: "queue", mode: "free" }, rules)).toMatch(/queue spawn first/);
    expect(markupProblem({ ...config, queueSpawn: [0, 64, 0] }, { op: "queue", mode: "free" }, rules)).toBeUndefined();
  });
});
