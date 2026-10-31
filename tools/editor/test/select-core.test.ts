import { describe, expect, it } from "vitest";
import type { Box } from "@minecade/minigame-core/config";
import { centerOffset, chunkRange, draftMap, insideBox, mapIdProblem, moveBox, parseSelectFile, worldSlug, type Selection } from "../select-core.ts";

/** Build B of the user's "Datapacking (imported)", the spike's and this pass's test build. */
const BUILD_B: Box = { min: [96, -64, -80], max: [207, 0, 47] };

describe("where an extracted map goes", () => {
  it("centers the box at x 0, z 0 in whole blocks, keeping its heights", () => {
    expect(centerOffset(BUILD_B)).toEqual([-152, 0, 16]);
    expect(moveBox(BUILD_B, centerOffset(BUILD_B))).toEqual({ min: [-56, -64, -64], max: [55, 0, 63] });
    // An odd width leaves the extra block on the plus side, never -0.
    expect(centerOffset({ min: [0, 5, 0], max: [2, 9, 0] })).toEqual([-1, 0, 0]);
    expect(Object.is(centerOffset({ min: [-1, 0, -1], max: [0, 0, 0] })[0], -0)).toBe(false);
  });

  it("names the chunks a box touches, for Chunker", () => {
    expect(chunkRange(BUILD_B)).toEqual({ minX: 6, minZ: -5, maxX: 12, maxZ: 2 });
    expect(chunkRange({ min: [-1, 0, 15], max: [0, 0, 16] })).toEqual({ minX: -1, minZ: 0, maxX: 0, maxZ: 1 });
  });

  it("knows whether a block is inside the box", () => {
    expect(insideBox(BUILD_B, [152, -10, -16])).toBe(true);
    expect(insideBox(BUILD_B, [152, 1, -16])).toBe(false);
  });

  it("writes a new map's draft map.json: the spawn moved with the map, the bounds and where it came from", () => {
    const config = draftMap({ name: "Build B", box: BUILD_B, offset: [-152, 0, 16], spawn: [152, -40, -16] }, "Datapacking (imported)");
    expect(config).toEqual({
      name: "Build B",
      draft: true,
      spawns: [[0, -40, 0]],
      bounds: { min: [-56, -64, -64], max: [55, 0, 63] },
      source: { world: "Datapacking (imported)", box: BUILD_B, offset: [-152, 0, 16] },
    });
  });
});

describe("a world's list", () => {
  const selection: Selection = { target: "sumo", map: "castle", name: "Castle", box: BUILD_B, offset: [-152, 0, 16], spawn: [152, -40, -16], status: "ready" };

  it("names a world's file after its name", () => {
    expect(worldSlug("Datapacking (imported)")).toBe("datapacking-imported");
    expect(worldSlug("???")).toBe("world");
  });

  it("reads a world's file, and nothing else", () => {
    const file = { world: "Arenas", path: "C:/worlds/arenas", selections: [selection] };
    expect(parseSelectFile(JSON.stringify(file))).toEqual(file);
    expect(parseSelectFile('{"world": "Arenas"}')).toBeUndefined();
    expect(parseSelectFile("not json")).toBeUndefined();
  });

  it("refuses a map id that isn't one, or that's taken", () => {
    expect(mapIdProblem("castle_2", ["arena_1"], [selection], "sumo")).toBeUndefined();
    expect(mapIdProblem("Castle", [], [], "sumo")).toContain("is not a map id");
    expect(mapIdProblem("arena_1", ["arena_1"], [], "sumo")).toContain("already");
    expect(mapIdProblem("castle", [], [selection], "sumo")).toContain("in this world's list");
    expect(mapIdProblem("castle", [], [selection], "lobby")).toBeUndefined();
  });
});
