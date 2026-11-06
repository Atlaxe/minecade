import type { Box, MapConfig } from "@minecade/minigame-core/config";
import { describe, expect, it } from "vitest";
import { addBoxEdit, boxFrom, faceToCut, facePlane, heightEdit, heightFromBlock, heightProblem, moveFace, nearestOnAxis, nudgeFace, removeBoxEdit, setBoxEdit, sizeText } from "../boxes.ts";

const BOX: Box = { min: [0, 60, 0], max: [9, 69, 4] };

describe("boxFrom", () => {
  it("spans two corner blocks, both inside, whichever is clicked first", () => {
    expect(boxFrom([5, 70, -2], [1, 60, 3])).toEqual({ min: [1, 60, -2], max: [5, 70, 3] });
    expect(sizeText(boxFrom([5, 70, -2], [1, 60, 3]))).toBe("5 x 11 x 6");
  });
});

describe("faces", () => {
  it("lie between blocks: a max face past its last block", () => {
    expect(facePlane(BOX, { axis: 0, side: "min" })).toBe(0);
    expect(facePlane(BOX, { axis: 0, side: "max" })).toBe(10);
  });

  it("move to the nearest whole plane, never past the other face", () => {
    expect(moveFace(BOX, { axis: 0, side: "max" }, 12.4)).toEqual({ min: [0, 60, 0], max: [11, 69, 4] });
    expect(moveFace(BOX, { axis: 1, side: "min" }, 58.6)).toEqual({ min: [0, 59, 0], max: [9, 69, 4] });
    expect(moveFace(BOX, { axis: 2, side: "max" }, -30)).toEqual({ min: [0, 60, 0], max: [9, 69, 0] });
    expect(moveFace(BOX, { axis: 2, side: "min" }, 30)).toEqual({ min: [0, 60, 4], max: [9, 69, 4] });
  });

  it("nudge out with positive steps and in with negative ones", () => {
    expect(nudgeFace(BOX, { axis: 0, side: "max" }, 1).max[0]).toBe(10);
    expect(nudgeFace(BOX, { axis: 0, side: "min" }, 1).min[0]).toBe(-1);
    expect(nudgeFace(BOX, { axis: 1, side: "max" }, -5).max[1]).toBe(64);
  });

  it("go onto a cut: the nearer face, or the picked one on that axis", () => {
    // A height cut at layer 66 is nearer the top: the top's last layer becomes 66.
    expect(faceToCut(BOX, 1, 66)).toEqual({ min: [0, 60, 0], max: [9, 66, 4] });
    // At layer 62, nearer the bottom: the bottom's first layer becomes 62.
    expect(faceToCut(BOX, 1, 62)).toEqual({ min: [0, 62, 0], max: [9, 69, 4] });
    // The picked face wins when it's on the cut's axis.
    expect(faceToCut(BOX, 1, 66, { axis: 1, side: "min" })).toEqual({ min: [0, 66, 0], max: [9, 69, 4] });
    expect(faceToCut(BOX, 0, 20, { axis: 1, side: "min" })).toEqual({ min: [0, 60, 0], max: [20, 69, 4] });
  });
});

describe("box edits", () => {
  it("add a box where the Region tool would save it", () => {
    expect(addBoxEdit({ kind: "bounds" }, BOX)).toEqual({ op: "addBounds", box: BOX });
    expect(addBoxEdit({ kind: "spectatorBounds" }, BOX)).toEqual({ op: "addBounds", box: BOX, spectators: true });
    expect(addBoxEdit({ kind: "region", name: "kill" }, BOX)).toEqual({ op: "addRegion", name: "kill", box: BOX });
  });

  it("change and remove the box an entry names", () => {
    expect(setBoxEdit({ key: "bounds#1", label: "Bounds 2", box: BOX, bounds: 1 }, BOX)).toEqual({ op: "setBounds", index: 1, box: BOX });
    expect(setBoxEdit({ key: "spectatorBounds#0", label: "Spectator bounds", box: BOX, bounds: 0, spectators: true }, BOX)).toEqual({ op: "setBounds", index: 0, box: BOX, spectators: true });
    expect(setBoxEdit({ key: "regions.plot#2", label: "Plot 3", box: BOX, region: { name: "plot", index: 2 } }, BOX)).toEqual({ op: "setRegion", name: "plot", index: 2, box: BOX });
    expect(removeBoxEdit({ key: "regions.plot#2", label: "Plot 3", box: BOX, region: { name: "plot", index: 2 } })).toEqual({ op: "removeRegion", name: "plot", index: 2 });
    expect(removeBoxEdit({ key: "bounds#0", label: "Bounds", box: BOX, bounds: 0 })).toEqual({ op: "removeBounds", index: 0 });
  });
});

describe("heights", () => {
  const config: MapConfig = { name: "M", spawns: [], buildLimit: { above: 80, below: 60 } };

  it("start where game Edit's Kill Y tool starts them: kill Y under the block clicked, a build limit on it", () => {
    expect(heightFromBlock("killY", 63)).toBe(63);
    expect(heightFromBlock("above", 63)).toBe(64);
    expect(heightFromBlock("below", 63)).toBe(64);
  });

  it("keep game Edit's rules", () => {
    expect(heightProblem(config, "killY", -64)).toBeUndefined();
    expect(heightProblem(config, "killY", 320)).toMatch(/Kill Y/);
    expect(heightProblem(config, "above", 320)).toBeUndefined();
    expect(heightProblem(config, "above", 60)).toMatch(/over the build limit below \(60\)/);
    expect(heightProblem(config, "below", 81)).toMatch(/under the build limit above \(80\)/);
    expect(heightProblem(config, "below", 1.5)).toMatch(/whole number/);
  });

  it("set or remove a line", () => {
    expect(heightEdit("killY", 12)).toEqual({ op: "killY", y: 12 });
    expect(heightEdit("killY")).toEqual({ op: "killY" });
    expect(heightEdit("above", 90)).toEqual({ op: "buildLimit", side: "above", y: 90 });
    expect(heightEdit("below")).toEqual({ op: "buildLimit", side: "below" });
  });
});

describe("nearestOnAxis", () => {
  it("finds where along an axis a ray passes nearest", () => {
    // A vertical line at x 5, z 0; a ray along +z at height 7 from x 5, z -10: nearest at y 7.
    expect(nearestOnAxis([5, 0, 0], [0, 1, 0], [5, 7, -10], [0, 0, 1])).toBeCloseTo(7);
    // From a point at height 2 on the line, 5 further up.
    expect(nearestOnAxis([5, 2, 0], [0, 1, 0], [5, 7, -10], [0, 0, 1])).toBeCloseTo(5);
  });

  it("gives nothing for a ray along the axis", () => {
    expect(nearestOnAxis([0, 0, 0], [0, 1, 0], [0, 10, 0], [0, -1, 0])).toBeUndefined();
  });
});
