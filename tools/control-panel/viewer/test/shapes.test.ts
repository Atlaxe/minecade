import { describe, expect, it } from "vitest";
import { buildShapeTable, covered, CUBE, hitShape, insideShape, OCCLUDES, PASSABLE, SEE_THROUGH, shapeOf, shapeTop, sideRects, vanillaShape, WATER, type Box16 } from "../shapes.ts";
import { NORTH, SOUTH, UP } from "../volume.ts";

const boxes = (name: string, states?: Record<string, string | number>) => vanillaShape(name, states).boxes;
/** The floor plan a shape's upper half covers (the step of a stair), as [x0, z0, x1, z1] lists, sorted. */
const upper = (shape: Box16[]) => shape.filter((box) => box[1] >= 8 && box[4] === 16).map(([x0, , z0, x1, , z1]) => [x0, z0, x1, z1]).sort();

describe("vanillaShape", () => {
  it("draws slabs as their half, and double slabs and plain blocks as cubes", () => {
    expect(boxes("oak_slab", { "minecraft:vertical_half": "bottom" })).toEqual([[0, 0, 0, 16, 8, 16]]);
    expect(boxes("normal_stone_slab", { "minecraft:vertical_half": "top" })).toEqual([[0, 8, 0, 16, 16, 16]]);
    expect(vanillaShape("smooth_stone_double_slab", { "minecraft:vertical_half": "bottom" })).toBe(CUBE);
    expect(vanillaShape("stone")).toBe(CUBE);
  });

  it("puts a stair's step on the side it faces (weirdo_direction 0 to 3: east, west, south, north), and its corners", () => {
    const facing = (direction: number, corner = "none", top = 0) => boxes("oak_stairs", { weirdo_direction: direction, upside_down_bit: top, "minecraft:corner": corner });
    expect(upper(facing(0))).toEqual([[8, 0, 16, 16]]);
    expect(upper(facing(3))).toEqual([[0, 0, 16, 8]]);
    // Facing south: outer left is the south-east quarter, outer right the south-west; inner left adds the north-east.
    expect(upper(facing(2, "outer_left"))).toEqual([[8, 8, 16, 16]]);
    expect(upper(facing(2, "outer_right"))).toEqual([[0, 8, 8, 16]]);
    expect(upper(facing(2, "inner_left"))).toEqual([[0, 8, 16, 16], [8, 0, 16, 8]].sort());
    // Upside down: the slab on top, the step under it.
    expect(facing(3, "none", 1)).toEqual([[0, 8, 0, 16, 16, 16], [0, 0, 0, 16, 8, 8]]);
  });

  it("places doors by Paintball's rules: a shut door whose cardinal direction is south stands on the west side", () => {
    const door = (direction: string, open: number, hinge: number) => boxes("wooden_door", { "minecraft:cardinal_direction": direction, open_bit: open, door_hinge_bit: hinge });
    expect(door("south", 0, 0)).toEqual([[0, 0, 0, 3, 16, 16]]);
    expect(door("east", 0, 0)).toEqual([[0, 0, 13, 16, 16, 16]]);
    // That door open: against the south side with the hinge on the right, the north with it on the left.
    expect(door("south", 1, 1)).toEqual([[0, 0, 13, 16, 16, 16]]);
    expect(door("south", 1, 0)).toEqual([[0, 0, 0, 16, 16, 3]]);
  });

  it("places trapdoors: shut on the bottom or top, open against the side away from where they face", () => {
    expect(boxes("trapdoor", { direction: 0, open_bit: 0, upside_down_bit: 0 })).toEqual([[0, 0, 0, 16, 3, 16]]);
    expect(boxes("trapdoor", { direction: 0, open_bit: 0, upside_down_bit: 1 })).toEqual([[0, 13, 0, 16, 16, 16]]);
    // direction 3 faces north: open against the south side.
    expect(boxes("spruce_trapdoor", { direction: 3, open_bit: 1, upside_down_bit: 0 })).toEqual([[0, 0, 13, 16, 16, 16]]);
  });

  it("runs a gate across the block, posts at its ends, and lowers it in a wall", () => {
    const shut = boxes("fence_gate", { "minecraft:cardinal_direction": "south", open_bit: 0, in_wall_bit: 0 });
    expect(shut.every(([, , z0, , , z1]) => z0 >= 7 && z1 <= 9)).toBe(true);
    const along = boxes("fence_gate", { "minecraft:cardinal_direction": "east", open_bit: 0, in_wall_bit: 0 });
    expect(along.every(([x0, , , x1]) => x0 >= 7 && x1 <= 9)).toBe(true);
    const low = boxes("fence_gate", { "minecraft:cardinal_direction": "south", open_bit: 0, in_wall_bit: 1 });
    expect(Math.max(...low.map((box) => box[4]))).toBe(13);
  });

  it("gives fences, walls and panes a post and arms to the sides they join", () => {
    expect(boxes("oak_fence", {})).toEqual([[6, 0, 6, 10, 16, 10]]);
    expect(boxes("oak_fence", { "minecraft:connection_north": 1 })).toHaveLength(3);
    const wall = boxes("cobblestone_wall", { wall_post_bit: 0, wall_connection_type_north: "tall", wall_connection_type_south: "short", wall_connection_type_east: "none", wall_connection_type_west: "none" });
    expect(wall).toEqual([[5, 0, 0, 11, 16, 8], [5, 0, 8, 11, 14, 16]]);
    expect(boxes("glass_pane", { "minecraft:connection_east": 1 })).toEqual([[7, 0, 7, 9, 16, 9], [9, 0, 7, 16, 16, 9]]);
  });

  it("draws thin layers, snow by its height, plants crossed and liquids as liquids", () => {
    expect(boxes("red_carpet")).toEqual([[0, 0, 0, 16, 1, 16]]);
    expect(boxes("snow_layer", { height: 3 })).toEqual([[0, 0, 0, 16, 8, 16]]);
    expect(vanillaShape("poppy")).toEqual({ boxes: [], cross: true, passable: true });
    expect(vanillaShape("oak_sapling").cross).toBe(true);
    expect(vanillaShape("torch").cross).toBe(true);
    expect(vanillaShape("water").liquid).toBe("water");
    expect(vanillaShape("flowing_lava").liquid).toBe("lava");
  });
});

describe("shapeOf", () => {
  it("draws custom blocks by their pack's boxes, a plant for no collision, and a cube when unknown", () => {
    expect(shapeOf({ name: "minecade:chair" }, { boxes: [[2, 0, 2, 14, 10, 14]] })).toEqual({ boxes: [[2, 0, 2, 14, 10, 14]] });
    expect(shapeOf({ name: "minecade:flower" }, { plant: true }).cross).toBe(true);
    expect(shapeOf({ name: "minecade:mystery" }, undefined)).toBe(CUBE);
    expect(shapeOf({ name: "minecade:crate" }, { boxes: [[0, 0, 0, 16, 16, 16]] })).toBe(CUBE);
  });
});

describe("buildShapeTable", () => {
  it("shares shapes, and flags cubes that hide their neighbors, see-through blocks, water, and what clicks pass", () => {
    const looks = [{ name: "minecraft:air" }, { name: "minecraft:stone" }, { name: "minecraft:glass" }, { name: "minecraft:water" }, { name: "minecraft:poppy" }, { name: "minecraft:dirt" }];
    const table = buildShapeTable(looks, new Uint8Array([0, 1, 1, 1, 1, 1]), {});
    expect(table.shapeOf[1]).toBe(0);
    expect(table.shapeOf[5]).toBe(0);
    expect(table.flags[1]).toBe(OCCLUDES);
    expect(table.flags[2]).toBe(SEE_THROUGH);
    expect(table.flags[3] & (WATER | SEE_THROUGH | PASSABLE)).toBe(WATER | SEE_THROUGH | PASSABLE);
    expect(table.flags[4] & PASSABLE).toBe(PASSABLE);
    expect(table.flags[0] & PASSABLE).toBe(PASSABLE);
  });
});

describe("side rectangles", () => {
  it("lists the parts of each side a shape fills, and whether one holds another", () => {
    const slab = sideRects({ boxes: [[0, 0, 0, 16, 8, 16]] });
    expect(slab[UP]).toEqual([]);
    expect(slab[NORTH]).toEqual([[0, 0, 16, 8]]);
    expect(covered(slab[SOUTH], [0, 0, 16, 8])).toBe(true);
    expect(covered(slab[SOUTH], [0, 0, 16, 16])).toBe(false);
  });
});

describe("hitShape and insideShape", () => {
  const slab = { boxes: [[0, 0, 0, 16, 8, 16] as Box16] };
  it("meets a slab's top at half height, and misses above a low corner piece", () => {
    const hit = hitShape(slab, [0.5, 2, 0.5], [0, -1, 0], 0)!;
    expect(hit.t).toBeCloseTo(1.5);
    expect(hit.normal).toEqual([0, 1, 0]);
    expect(hitShape({ boxes: [[0, 0, 0, 4, 4, 4]] }, [0.75, 2, 0.75], [0, -1, 0], 0)).toBeUndefined();
  });

  it("knows a point in a slab from one above it, and a shape's top", () => {
    expect(insideShape(slab, 0.5, 0.25, 0.5)).toBe(true);
    expect(insideShape(slab, 0.5, 0.75, 0.5)).toBe(false);
    expect(shapeTop(slab)).toBe(0.5);
  });
});
