import { describe, expect, it } from "vitest";
import { VIEW_FORMAT, type View } from "../../../viewer/view-format.ts";
import { buildVolume, EAST, faceColors, lookAtSpot, pick, solidTop, spotsOf, UP, waterAtSpot, type FaceColors } from "../volume.ts";

const STONE: FaceColors = [[120, 120, 120, 255], [110, 110, 110, 255], [100, 100, 100, 255]];
const LOG: FaceColors = [[180, 150, 90, 255], [170, 140, 80, 255], [110, 85, 50, 255]];

/** A view with these blocks at world spots (one section each as needed). */
function view(blocks: { at: [number, number, number]; look: number }[], looks: View["looks"]): View {
  const sections = new Map<string, Uint16Array>();
  for (const { at, look } of blocks) {
    const key = at.map((v) => Math.floor(v / 16)).join(",");
    if (!sections.has(key)) sections.set(key, new Uint16Array(4096));
    const [x, y, z] = at.map((v) => ((v % 16) + 16) % 16);
    sections.get(key)![(x << 8) | (z << 4) | y] = look;
  }
  const min = [0, 1, 2].map((i) => Math.min(...blocks.map((b) => b.at[i]))) as [number, number, number];
  const max = [0, 1, 2].map((i) => Math.max(...blocks.map((b) => b.at[i]))) as [number, number, number];
  return {
    format: VIEW_FORMAT,
    stamp: "test",
    box: { min, max },
    looks,
    sections: sections.size,
    list: [...sections].map(([key, layer]) => {
      const [x, y, z] = key.split(",").map(Number);
      return { x, y, z, blocks: layer };
    }),
  };
}

const LOOKS: View["looks"] = [{ name: "minecraft:air" }, { name: "minecraft:stone" }, { name: "minecraft:barrier" }, { name: "minecade:mystery" }, { name: "minecraft:oak_log", states: { pillar_axis: "x" } }];
const TABLE = { "minecraft:stone": STONE, "minecraft:oak_log": LOG };

describe("buildVolume", () => {
  it("puts blocks in a grid of whole sections from the box's corner section", () => {
    const volume = buildVolume(view([{ at: [-3, 5, 20], look: 1 }, { at: [17, -60, 21], look: 1 }], LOOKS), TABLE);
    expect(volume.origin).toEqual([-16, -64, 16]);
    expect(volume.size).toEqual([48, 80, 16]);
    expect(lookAtSpot(volume, -3 + 16, 5 + 64, 20 - 16)).toBe(1);
    expect(lookAtSpot(volume, 17 + 16, -60 + 64, 21 - 16)).toBe(1);
    expect(lookAtSpot(volume, 0, 0, 0)).toBe(0);
  });

  it("doesn't draw hidden blocks, and lists drawn blocks without a color", () => {
    const volume = buildVolume(view([{ at: [0, 0, 0], look: 1 }], LOOKS), TABLE);
    expect(Array.from(volume.drawn)).toEqual([0, 1, 0, 1, 1]);
    expect(volume.unknown).toEqual(["minecade:mystery"]);
    expect(Array.from(volume.colors.subarray(3 * 24, 3 * 24 + 4))).toEqual([255, 0, 255, 255]);
  });
});

describe("faceColors", () => {
  it("puts a log's rings on its ends when it lies along x or z", () => {
    expect(faceColors({ name: "minecraft:oak_log" }, LOG)[UP]).toEqual(LOG[0]);
    const alongX = faceColors({ name: "minecraft:oak_log", states: { pillar_axis: "x" } }, LOG);
    expect(alongX[UP]).toEqual(LOG[2]);
    expect(alongX[EAST]).toEqual(LOG[0]);
  });
});

describe("pick", () => {
  // A 3-high column at x 2, z 2, and a barrier (not drawn) above it.
  const volume = buildVolume(view([{ at: [2, 0, 2], look: 1 }, { at: [2, 1, 2], look: 1 }, { at: [2, 2, 2], look: 1 }, { at: [2, 3, 2], look: 2 }], LOOKS), TABLE);

  it("finds the first drawn block down a ray, with the face it went in by", () => {
    const hit = pick(volume, [2.5, 40, 2.5], [0, -1, 0]);
    expect(hit?.block).toEqual([2, 2, 2]);
    expect(hit?.normal).toEqual([0, 1, 0]);
    expect(hit?.point[1]).toBeCloseTo(3);
  });

  it("skips what's past a cut", () => {
    expect(pick(volume, [2.5, 40, 2.5], [0, -1, 0], { top: 0 })?.block).toEqual([2, 0, 2]);
    expect(pick(volume, [-5, 1.5, 2.5], [1, 0, 0], { x: { at: 1, side: "below" } })).toBeUndefined();
    expect(pick(volume, [-5, 1.5, 2.5], [1, 0, 0])?.normal).toEqual([-1, 0, 0]);
  });

  it("misses a ray that never meets the grid", () => {
    expect(pick(volume, [100, 100, 100], [1, 0, 0])).toBeUndefined();
  });
});

describe("pick near the camera", () => {
  it("passes through blocks the camera is in, so a click from inside a wall lands beyond it", () => {
    const volume = buildVolume(view([{ at: [0, 0, 0], look: 1 }, { at: [0, 0, 5], look: 1 }], LOOKS), TABLE);
    const from = [0.5, 0.5, 0.4];
    // From inside the block at z 0, looking south: without skipping, that block; with it, the one at z 5.
    expect(pick(volume, from, [0, 0, 1])?.block[2]).toBe(0);
    expect(pick(volume, from, [0, 0, 1], {}, 1)?.block[2]).toBe(5);
  });
});

describe("shapes in the volume", () => {
  const looks: View["looks"] = [
    { name: "minecraft:air" },
    { name: "minecraft:stone" },
    { name: "minecraft:poppy" },
    { name: "minecraft:stone_slab", states: { "minecraft:vertical_half": "bottom" } },
    { name: "minecraft:wooden_door", states: { "minecraft:cardinal_direction": "south", open_bit: 1, upper_block_bit: 0, door_hinge_bit: 0 } },
    { name: "minecraft:wooden_door", states: { "minecraft:cardinal_direction": "north", open_bit: 0, upper_block_bit: 1, door_hinge_bit: 1 } },
    { name: "minecraft:water", states: { liquid_depth: 0 } },
  ];
  const table = { "minecraft:stone": STONE, "minecraft:poppy": STONE, "minecraft:stone_slab": STONE, "minecraft:wooden_door": STONE, "minecraft:water": STONE };

  it("passes a click through a flower to the block under it, and meets a slab at its top", () => {
    const volume = buildVolume(view([{ at: [0, 0, 0], look: 1 }, { at: [0, 1, 0], look: 2 }, { at: [1, 0, 0], look: 3 }], looks), table);
    expect(pick(volume, [0.5, 10, 0.5], [0, -1, 0])?.block).toEqual([0, 0, 0]);
    const slab = pick(volume, [1.5, 10, 0.5], [0, -1, 0])!;
    expect(slab.block).toEqual([1, 0, 0]);
    expect(slab.point[1]).toBeCloseTo(0.5);
    expect(solidTop(volume, 1, 0, 0)).toBe(0.5);
    expect(solidTop(volume, 0, 1, 0)).toBeUndefined();
  });

  it("gives both halves of a door the lower one's facing and open, and the upper one's hinge", () => {
    const volume = buildVolume(view([{ at: [0, 0, 0], look: 4 }, { at: [0, 1, 0], look: 5 }], looks), table);
    const [lower, upper] = [lookAtSpot(volume, 0, 0, 0), lookAtSpot(volume, 0, 1, 0)].map((id) => volume.looks[id].states!);
    for (const states of [lower, upper]) expect([states["minecraft:cardinal_direction"], states.open_bit, states.door_hinge_bit]).toEqual(["south", 1, 1]);
    expect([lower.upper_block_bit, upper.upper_block_bit]).toEqual([0, 1]);
  });

  it("keeps layer 1 (the water of waterlogged blocks) by section", () => {
    const base = view([{ at: [3, 2, 1], look: 3 }], looks);
    const water = new Uint16Array(4096);
    water[(3 << 8) | (1 << 4) | 2] = 6;
    base.list[0].water = water;
    const volume = buildVolume(base, table);
    expect(waterAtSpot(volume, 3, 2, 1)).toBe(6);
    expect(waterAtSpot(volume, 3, 3, 1)).toBe(0);
  });

  it("lists every spot of the looks asked for", () => {
    const volume = buildVolume(view([{ at: [0, 0, 0], look: 1 }, { at: [2, 1, 0], look: 1 }, { at: [1, 0, 0], look: 3 }], looks), table);
    expect(spotsOf(volume, (look) => look === 1)).toEqual([[0, 0, 0], [2, 1, 0]]);
    expect(volume.counts[1]).toBe(2);
  });
});
