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

  it("refuses what the viewer doesn't change, and malformed edits", () => {
    expect(viewerEdit({ op: "name", name: "X" })).toMatch(/doesn't make "name" edits/);
    expect(viewerEdit({ op: "extra", key: "a", value: 1 })).toMatch(/doesn't make/);
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
  const requires = { regions: { plot: { label: "Build boundary", count: 8, minSize: 24 } } };
  const config = { name: "M", spawns: [], buildLimit: { above: 80, below: 60 } };

  it("refuses a region box under the game's minSize, as game Edit does", () => {
    const small = { min: [0, 0, 0], max: [22, 30, 30] } as Box;
    const big = { min: [0, 0, 0], max: [23, 23, 23] } as Box;
    expect(markupProblem(config, { op: "addRegion", name: "plot", box: small }, requires)).toMatch(/at least 24 blocks/);
    expect(markupProblem(config, { op: "setRegion", name: "plot", index: 0, box: big }, requires)).toBeUndefined();
    expect(markupProblem(config, { op: "addRegion", name: "kill", box: small }, requires)).toBeUndefined();
  });

  it("keeps the build limit's sides apart", () => {
    expect(markupProblem(config, { op: "buildLimit", side: "above", y: 60 }, requires)).toMatch(/over the build limit below/);
    expect(markupProblem(config, { op: "buildLimit", side: "above" }, requires)).toBeUndefined();
    expect(markupProblem(config, { op: "batch", edits: [{ op: "killY", y: 999 }] }, requires)).toMatch(/Kill Y/);
  });
});
