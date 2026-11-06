import { describe, expect, it } from "vitest";
import type { View } from "../../../viewer/view-format.ts";
import { columnsFrom, dragColumns, heightRange, mapIdFrom, mapIdProblem, sidePicture, typedColumns, viewBetween } from "../select-box.ts";

describe("the box", () => {
  it("spans two columns either way round, stopping at 256 from the first", () => {
    expect(columnsFrom({ x: 5, z: 5 }, { x: -3, z: 9 })).toEqual({ x0: -3, z0: 5, x1: 5, z1: 9 });
    expect(columnsFrom({ x: 0, z: 0 }, { x: 400, z: -400 })).toEqual({ x0: 0, z0: -255, x1: 255, z1: 0 });
    expect(typedColumns(10, 10, -300.4, 2)).toEqual({ x0: -245, z0: 2, x1: 10, z1: 10 });
  });

  it("moves whole, or by an edge or corner that never passes the other side or grows past 256", () => {
    const box = { x0: 0, z0: 0, x1: 9, z1: 9 };
    expect(dragColumns(box, "move", 3, -2)).toEqual({ x0: 3, z0: -2, x1: 12, z1: 7 });
    expect(dragColumns(box, "e", -20, 0)).toEqual({ x0: 0, z0: 0, x1: 0, z1: 9 });
    expect(dragColumns(box, "nw", -5, 4)).toEqual({ x0: -5, z0: 4, x1: 9, z1: 9 });
    expect(dragColumns(box, "s", 0, 1000)).toEqual({ x0: 0, z0: 0, x1: 9, z1: 255 });
  });
});

describe("the height", () => {
  it("keeps the floor and ceiling in the world, the one changed winning", () => {
    expect(heightRange(-100, 400)).toEqual({ floor: -64, ceiling: 319 });
    expect(heightRange(70, 60, "floor")).toEqual({ floor: 70, ceiling: 70 });
    expect(heightRange(70, 60, "ceiling")).toEqual({ floor: 60, ceiling: 60 });
  });
});

/** A view of one section at the origin with a few blocks set. */
function viewWith(blocks: [x: number, y: number, z: number, look: number][]): View {
  const layer = new Uint16Array(4096);
  for (const [x, y, z, look] of blocks) layer[(x << 8) | (z << 4) | y] = look;
  return { format: 1, stamp: "s", box: { min: [0, 0, 0], max: [15, 15, 15] }, looks: [{ name: "minecraft:air" }, { name: "a" }, { name: "b" }, { name: "minecraft:barrier" }], sections: 1, list: [{ x: 0, y: 0, z: 0, blocks: layer }] };
}

describe("the picture from the side", () => {
  it("shows the block nearest the south side of each column and layer, and how far back it is, looking through hidden blocks", () => {
    const view = viewWith([
      [2, 5, 3, 1],
      [2, 5, 9, 2],
      [2, 5, 12, 3],
      [4, 1, 0, 1],
    ]);
    const picture = sidePicture(view, { x0: 2, z0: 0, x1: 4, z1: 12 }, 0, 6, (look) => look === 0 || look === 3);
    expect(picture.width).toBe(3);
    expect(picture.height).toBe(7);
    // Row 0 is the top (y 6); y 5 is row 1, x 2 is column 0: block b at z 9 is in front of a at z 3.
    expect(picture.looks[1 * 3 + 0]).toBe(2);
    expect(picture.depth[1 * 3 + 0]).toBe(3);
    expect(picture.looks[5 * 3 + 2]).toBe(1);
    expect(picture.depth[5 * 3 + 2]).toBe(12);
    expect(picture.looks[0]).toBe(0);
  });
});

describe("the 3D look", () => {
  it("keeps only the layers from the floor to the ceiling", () => {
    const view = viewWith([
      [0, 2, 0, 1],
      [0, 6, 0, 2],
      [0, 10, 0, 1],
    ]);
    const cut = viewBetween(view, 4, 8);
    const layer = cut.list[0].blocks as Uint16Array;
    expect(layer[(0 << 8) | 6]).toBe(2);
    expect(layer[2]).toBe(0);
    expect(layer[10]).toBe(0);
    expect(cut.box.min[1]).toBe(4);
    expect(cut.box.max[1]).toBe(8);
    expect(viewBetween(view, 20, 30).list).toEqual([]);
  });
});

describe("map ids", () => {
  it("makes one from a name, and says why one won't do", () => {
    expect(mapIdFrom("Temple's Ruins 2!")).toBe("temple_s_ruins_2");
    expect(mapIdFrom("--Big-Arena--")).toBe("big-arena");
    expect(mapIdProblem("temples", ["temples"])).toMatch(/already/);
    expect(mapIdProblem("_x", [])).toMatch(/starting with/);
    expect(mapIdProblem("arena_2", ["temples"])).toBeUndefined();
  });
});
