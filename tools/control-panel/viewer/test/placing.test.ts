import { describe, expect, it } from "vitest";
import { VIEW_FORMAT, type View } from "../../../viewer/view-format.ts";
import { floorSpot, normalYaw, placedPosition, yawToward } from "../placing.ts";
import { buildVolume, type FaceColors } from "../volume.ts";

const STONE: FaceColors = [[120, 120, 120, 255], [110, 110, 110, 255], [100, 100, 100, 255]];

/** A floor of stone at y 64 from x 0 to 3 (z 0), and a wall block on it at x 3, y 65 to 66. */
function volume() {
  const blocks = new Uint16Array(4096);
  const at = (x: number, y: number, z: number) => (x << 8) | (z << 4) | y;
  for (let x = 0; x <= 3; x++) blocks[at(x, 0, 0)] = 1;
  blocks[at(3, 1, 0)] = 1;
  blocks[at(3, 2, 0)] = 1;
  const view: View = { format: VIEW_FORMAT, stamp: "test", box: { min: [0, 64, 0], max: [3, 66, 0] }, looks: [{ name: "minecraft:air" }, { name: "minecraft:stone" }], sections: 1, list: [{ x: 0, y: 4, z: 0, blocks }] };
  return buildVolume(view, { "minecraft:stone": STONE });
}

describe("floorSpot", () => {
  const v = volume();

  it("puts a point on top of the block clicked, where it was clicked", () => {
    expect(floorSpot(v, { block: [1, 0, 0], normal: [0, 1, 0], point: [1.25, 1, 0.75] })).toEqual({ x: 1.25, y: 65, z: 0.75 });
  });

  it("drops a click on a block's side to the floor in front of it", () => {
    // The wall's west side at y 66: in front of it (x 2.7) and down onto the floor's top, y 65.
    const spot = floorSpot(v, { block: [3, 2, 0], normal: [-1, 0, 0], point: [3, 2.5, 0.5] })!;
    expect(spot.y).toBe(65);
    expect(spot.x).toBeCloseTo(2.7);
    expect(spot.z).toBe(0.5);
  });

  it("finds no floor where there's nothing below", () => {
    expect(floorSpot(v, { block: [0, 0, 0], normal: [0, 0, 1], point: [0.5, 0.5, 1] })).toBeUndefined();
  });
});

describe("placedPosition", () => {
  it("is the block's middle with Center on block, else the exact point", () => {
    expect(placedPosition({ x: 1.25, y: 65, z: 0.75 }, true)).toEqual([1, 65, 0]);
    expect(placedPosition({ x: 1.25, y: 65, z: 0.75 }, false)).toEqual([1.25, 65, 0.75]);
    // Whole x and z would read as a block's middle: x moves by 0.01.
    expect(placedPosition({ x: 2, y: 65, z: 3 }, false)).toEqual([2.01, 65, 3]);
  });
});

describe("yawToward", () => {
  const from = { x: 0, y: 0, z: 0 };
  it("is game Edit's yaw: 0 south, 90 west, -90 east, 180 north", () => {
    expect(yawToward(from, { x: 0, y: 0, z: 5 }, 15)).toBe(0);
    expect(yawToward(from, { x: -5, y: 0, z: 0 }, 15)).toBe(90);
    expect(yawToward(from, { x: 5, y: 0, z: 0 }, 15)).toBe(-90);
    expect(yawToward(from, { x: 0, y: 0, z: -5 }, 15)).toBe(180);
  });

  it("snaps to steps", () => {
    expect(yawToward(from, { x: -1, y: 0, z: 2 }, 15)).toBe(30);
    expect(yawToward(from, { x: -1, y: 0, z: 2 }, 1)).toBe(27);
  });
});

describe("normalYaw", () => {
  it("keeps yaws over -180 up to 180", () => {
    expect(normalYaw(-180)).toBe(180);
    expect(normalYaw(270)).toBe(-90);
    expect(Object.is(normalYaw(-0), 0)).toBe(true);
  });
});
