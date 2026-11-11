import { describe, expect, it } from "vitest";
import { VIEW_FORMAT, type View } from "../../../viewer/view-format.ts";
import { blocksWithoutLook, hasFloor, mapWarnings, solidAt } from "../checks.ts";
import type { Markup } from "../markup.ts";
import { buildVolume, type FaceColors } from "../volume.ts";

const STONE: FaceColors = [[120, 120, 120, 255], [110, 110, 110, 255], [100, 100, 100, 255]];
const LOOKS = [{ name: "minecraft:air" }, { name: "minecraft:stone" }, { name: "minecraft:stone_slab", states: { "minecraft:vertical_half": "bottom" } }, { name: "minecade:plane" }, { name: "minecade:mystery" }, { name: "minecraft:water" }, { name: "minecraft:barrier" }];

/** One section at the world's corner: a stone floor at y 0 (x 0 to 7), a slab at x 2 on it, a wall block at x 5, y 2, two plane blocks and a mystery block. */
function volume() {
  const blocks = new Uint16Array(4096);
  const at = (x: number, y: number, z: number) => (x << 8) | (z << 4) | y;
  for (let x = 0; x < 8; x++) blocks[at(x, 0, 0)] = 1;
  blocks[at(2, 1, 0)] = 2;
  blocks[at(5, 2, 0)] = 1;
  blocks[at(10, 0, 0)] = 3;
  blocks[at(11, 0, 0)] = 3;
  blocks[at(12, 0, 0)] = 4;
  blocks[at(14, 0, 0)] = 5;
  blocks[at(15, 0, 0)] = 6;
  const view: View = { format: VIEW_FORMAT, stamp: "test", box: { min: [0, 0, 0], max: [15, 2, 0] }, looks: LOOKS, sections: 1, list: [{ x: 0, y: 0, z: 0, blocks }] };
  return buildVolume(view, { "minecraft:stone": STONE, "minecraft:stone_slab": STONE, "minecade:plane": STONE, "minecraft:water": STONE });
}

const point = (key: string, list: string, x: number, y: number) => ({ key, list, label: key, at: { x, y, z: 0.5 } });
const markup = (points: ReturnType<typeof point>[], boxes: { key: string; list: string; label: string; box: { min: [number, number, number]; max: [number, number, number] } }[] = []) => ({ points, boxes }) as unknown as Markup;

describe("solidAt and hasFloor", () => {
  const v = volume();
  it("knows what's solid, slabs by their half", () => {
    expect(solidAt(v, 0.5, 0.5, 0.5)).toBe(true);
    expect(solidAt(v, 2.5, 1.25, 0.5)).toBe(true);
    expect(solidAt(v, 2.5, 1.75, 0.5)).toBe(false);
    expect(solidAt(v, 14.5, 0.5, 0.5)).toBe(false);
  });

  it("finds a floor within three blocks, and water counts", () => {
    expect(hasFloor(v, { x: 0.5, y: 1, z: 0.5 })).toBe(true);
    expect(hasFloor(v, { x: 0.5, y: 4, z: 0.5 })).toBe(true);
    expect(hasFloor(v, { x: 0.5, y: 4.5, z: 0.5 })).toBe(false);
    expect(hasFloor(v, { x: 14.5, y: 2, z: 0.5 })).toBe(true);
    expect(hasFloor(v, { x: 13.5, y: 2, z: 0.5 })).toBe(false);
    // A barrier isn't drawn, but players stand on it.
    expect(hasFloor(v, { x: 15.5, y: 1, z: 0.5 })).toBe(true);
    expect(solidAt(v, 15.5, 0.5, 0.5)).toBe(true);
  });
});

describe("mapWarnings", () => {
  const v = volume();
  it("warns of a point in a block, a spawn with no floor, and the editor's blocks left in the world", () => {
    const warnings = mapWarnings(
      v,
      markup([point("Spawn 1", "spawns", 0.5, 1), point("Spawn 2", "spawns", 5.5, 1), point("Spawn 3", "spawns", 9.5, 5), point("Spawn 4", "spawns", 2.5, 1.5), point("Lamp", "points.lamp", 9.5, 5)]),
    );
    expect(warnings.map((warning) => warning.text)).toEqual([
      "Spawn 2: its head is in a block",
      "Spawn 3: nothing to stand on within 3 blocks",
      "2 of game Edit's boundary blocks (minecade:plane) are left in the world",
    ]);
    expect(warnings[0].entry).toBe("Spawn 2");
    expect(warnings[2].block).toBe("minecade:plane");
  });

  it("warns of build areas that overlap or come within a block", () => {
    const box = (min: [number, number, number], max: [number, number, number]) => ({ min, max });
    const warnings = mapWarnings(
      v,
      markup(
        [point("Spawn 1", "spawns", 0.5, 1), point("Spawn 2", "spawns", 30.5, 1), point("Spawn 3", "spawns", 10.5, 1)],
        [
          { key: "regions.plot#0", list: "regions.plot", label: "Build area 1", box: box([0, 0, 0], [3, 4, 3]) },
          { key: "regions.plot#1", list: "regions.plot", label: "Build area 2", box: box([3, 0, 0], [6, 4, 3]) },
          { key: "regions.plot#2", list: "regions.plot", label: "Build area 3", box: box([7, 0, 0], [10, 4, 3]) },
        ],
      ),
    ).filter((warning) => !warning.block);
    expect(warnings.map((warning) => warning.text)).toEqual([
      "Spawn 2: nothing to stand on within 3 blocks",
      "Build area 1 and Build area 2 overlap",
      "Build area 2's shell (the block around it) reaches Build area 3",
    ]);
    // A spawn away from the one build area is fine: it only has to be in the arena (the checklist's).
    const one = mapWarnings(v, markup([point("Spawn 1", "spawns", 0.5, 1), point("Spawn 2", "spawns", 1.5, 1)], [{ key: "regions.plot#0", list: "regions.plot", label: "Build area 1", box: box([0, 0, 0], [3, 4, 3]) }]));
    expect(one.filter((warning) => !warning.block).map((warning) => warning.text)).toEqual([]);
  });
});

describe("blocksWithoutLook", () => {
  it("lists the blocks with no color, with how many there are", () => {
    expect(blocksWithoutLook(volume())).toEqual([{ name: "minecade:mystery", count: 1 }]);
  });
});
