import { BLOCK_PARTY_BOARD, type MapConfig } from "@minecade/minigame-core/config";
import { describe, expect, it } from "vitest";
import { placeSpace, spaceIdOf, spaceKey, spaceMarkup, spacePosition } from "../spaces.ts";

const BOARD = BLOCK_PARTY_BOARD;

describe("a board's spaces in the viewer", () => {
  const config: MapConfig = {
    name: "Board",
    spawns: [],
    spaces: [
      { id: 1, at: [0, 64, 0], type: "start", next: [2] },
      { id: 2, at: [4, 64, 0], type: "red", next: [1], star: true },
    ],
  };

  it("draws each space as a post in its type's color, lists them, and arrows its links", () => {
    const { points, list, links } = spaceMarkup(config, BOARD, { need: 12, done: false });
    expect(points.map((point) => [point.key, point.label, point.color, point.noLine])).toEqual([
      ["space:1", "Space 1: Start", 0xf0f0f0, true],
      ["space:2", "Space 2: Red, Star", 0xd23c32, true],
    ]);
    expect(points[0].at).toEqual({ x: 0.5, y: 64, z: 0.5 });
    expect(list?.entries.map((entry) => entry.label)).toEqual(["Space 1: Start", "Space 2: Red, Star"]);
    expect(list).toMatchObject({ key: "spaces", need: 12, done: false });
    expect(links).toEqual([
      { from: { x: 0.5, y: 64, z: 0.5 }, to: { x: 4.5, y: 64, z: 0.5 } },
      { from: { x: 4.5, y: 64, z: 0.5 }, to: { x: 0.5, y: 64, z: 0.5 } },
    ]);
    expect(spaceMarkup(config, undefined, {})).toEqual({ points: [], links: [] });
  });

  it("places a space on a block's middle, after the previous one, its type dealt; the first is Start", () => {
    expect(placeSpace({ name: "Empty", spawns: [] }, BOARD, [3.4, 64, -2.6], undefined)).toEqual({ edit: { op: "addSpace", at: [3, 64, -3], type: "start" }, id: 1 });
    const next = placeSpace(config, BOARD, [8.2, 64, 0.7], 2);
    expect(next.id).toBe(3);
    expect(next.edit).toMatchObject({ op: "addSpace", at: [8, 64, 0], from: 2 });
    expect(["blue", "item"]).toContain((next.edit as { type: string }).type);
    expect(placeSpace(config, BOARD, [8, 64, 0], 9).edit).not.toHaveProperty("from");
  });

  it("reads a space's id from its key", () => {
    expect(spaceIdOf(spaceKey(7))).toBe(7);
    expect(spaceIdOf("spawns#0")).toBeUndefined();
    expect(spacePosition([1.7, 64.2, -0.1])).toEqual([1, 64, -1]);
  });
});
