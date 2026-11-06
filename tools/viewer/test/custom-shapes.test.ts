import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conditionHolds, customShape, customShapes, turnBox, type BlockDefinition } from "../custom-shapes.ts";

describe("conditionHolds", () => {
  it("reads the block-state terms the blocks pack's permutations use, joined by && and ||", () => {
    const states = { "minecade:facing": "east", "minecade:open": 1, "minecade:level": 3 };
    expect(conditionHolds("q.block_state('minecade:facing') == 'east'", states)).toBe(true);
    expect(conditionHolds("q.block_state('minecade:facing') == 'east' && q.block_state('minecade:open') == 'true'", states)).toBe(true);
    expect(conditionHolds("q.block_state('minecade:facing') == 'north' || q.block_state('minecade:level') == 3", states)).toBe(true);
    expect(conditionHolds("query.block_state('minecade:open') != false", states)).toBe(true);
    expect(conditionHolds("q.block_state('minecade:facing') == 'west'", states)).toBe(false);
    // Anything else doesn't hold.
    expect(conditionHolds("math.random(0, 1) > 0.5", states)).toBe(false);
  });
});

describe("turnBox", () => {
  it("turns a quarter about y clockwise seen from above for Bedrock's -90 (east from north)", () => {
    // A chair's back against the south side, facing north, turned to face east: against the west side.
    expect(turnBox([4, 7, 12, 12, 16, 13], [0, -90, 0])).toEqual([3, 7, 4, 4, 16, 12]);
    expect(turnBox([4, 7, 12, 12, 16, 13], [0, -180, 0])).toEqual([4, 7, 3, 12, 16, 4]);
    expect(turnBox([4, 7, 12, 12, 16, 13], [0, 90, 0])).toEqual([12, 7, 4, 13, 16, 12]);
  });

  it("turns about x first: a quarter takes the top to the north, a half turns a block upside down", () => {
    expect(turnBox([0, 13, 0, 16, 16, 16], [90, 0, 0])).toEqual([0, 0, 0, 16, 16, 3]);
    expect(turnBox([0, 0, 0, 16, 3, 16], [180, 0, 0])).toEqual([0, 13, 0, 16, 16, 16]);
  });
});

describe("customShape", () => {
  const chair: BlockDefinition = {
    components: { "minecraft:collision_box": [{ origin: [-4, 7, 4], size: [8, 9, 1] }] },
    permutations: [
      { condition: "q.block_state('minecade:facing') == 'east'", components: { "minecraft:transformation": { rotation: [0, -90, 0] } } },
      { condition: "q.block_state('minecade:facing') == 'south'", components: { "minecraft:collision_box": false } },
    ],
  };

  it("mirrors x from Bedrock's boxes and applies the permutations its states pick", () => {
    expect(customShape(chair, { "minecade:facing": "north" })).toEqual({ boxes: [[4, 7, 12, 12, 16, 13]] });
    expect(customShape(chair, { "minecade:facing": "east" })).toEqual({ boxes: [[3, 7, 4, 4, 16, 12]] });
    expect(customShape(chair, { "minecade:facing": "south" })).toEqual({ plant: true });
  });

  it("is a cube without boxes, takes the selection box without a collision box, and is see-through when blended", () => {
    expect(customShape({ components: {}, permutations: [] }, {})).toEqual({ cube: true });
    expect(customShape({ components: { "minecraft:selection_box": { origin: [-8, 0, -8], size: [16, 8, 16] } }, permutations: [] }, {})).toEqual({ boxes: [[0, 0, 0, 16, 8, 16]] });
    const glass = { components: { "minecraft:material_instances": { "*": { texture: "glass", render_method: "blend" } } }, permutations: [] };
    expect(customShape(glass, {})).toEqual({ cube: true, seeThrough: true });
  });
});

describe("customShapes", () => {
  it("reads only the custom looks' blocks from the pack, keyed as the page keys looks", () => {
    const pack = mkdtempSync(join(tmpdir(), "custom-shapes-"));
    mkdirSync(join(pack, "behavior_pack", "blocks"), { recursive: true });
    writeFileSync(
      join(pack, "behavior_pack", "blocks", "stool.json"),
      JSON.stringify({ format_version: "1.26.0", "minecraft:block": { description: { identifier: "minecade:stool" }, components: { "minecraft:collision_box": { origin: [-4, 0, -4], size: [8, 10, 8] } } } }),
    );
    const shapes = customShapes([{ name: "minecraft:stone" }, { name: "minecade:stool", states: { "minecade:color": "red" } }, { name: "minecade:missing" }], pack);
    expect(shapes).toEqual({ 'minecade:stool{"minecade:color":"red"}': { boxes: [[4, 0, 4, 12, 10, 12]] } });
  });
});
