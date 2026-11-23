// A space's cutscene camera (src/board/board-map.ts; the user, 2026-11-23; Block Party's
// /spacecam, docs/plans/block-party-ui.md "Cameras").
import { describe, expect, it } from "vitest";
import { BLOCK_PARTY_BOARD, setSpaceCamera, spaceCameraProblems, spaceProblems, type BoardSpace } from "../src/board/board-map.ts";
import { applyEdit, describeEdit } from "../src/map-edit.ts";
import type { MapConfig } from "../src/map-config.ts";

const SPACES: BoardSpace[] = [
  { id: 1, at: [0, 64, 0], type: "start", next: [2] },
  { id: 2, at: [4, 64, 0], type: "shop", next: [1] },
];

describe("a space's cutscene camera", () => {
  it("is its own way, pitch and distance, or free; the map keeps them in order", () => {
    const set = setSpaceCamera(SPACES, 2, { distance: 8, yaw: 135, pitch: 25 });
    expect(set[1].camera).toEqual({ yaw: 135, pitch: 25, distance: 8 });
    expect(Object.keys(set[1].camera!)).toEqual(["yaw", "pitch", "distance"]);
    expect(setSpaceCamera(SPACES, 2, { free: true })[1].camera).toEqual({ free: true });
  });

  it("goes when it's taken away or left empty", () => {
    const set = setSpaceCamera(SPACES, 2, { yaw: 90 });
    expect(setSpaceCamera(set, 2, undefined)[1]).toEqual(SPACES[1]);
    expect(setSpaceCamera(set, 2, {})[1]).toEqual(SPACES[1]);
  });

  it("refuses what doesn't fit: out of range, not whole, unknown parts, free with a way", () => {
    expect(spaceCameraProblems({ yaw: 360 }, "camera")).toEqual(["camera.yaw must be a whole number from 0 to 359"]);
    expect(spaceCameraProblems({ pitch: 12.5 }, "camera")).toEqual(["camera.pitch must be a whole number from -30 to 89"]);
    expect(spaceCameraProblems({ distance: 1 }, "camera")).toEqual(["camera.distance must be a whole number from 2 to 60"]);
    expect(spaceCameraProblems({ zoom: 2 }, "camera")).toEqual(["camera.zoom isn't part of a space's camera (free, yaw, pitch or distance)"]);
    expect(spaceCameraProblems({ free: true, yaw: 90 }, "camera")).toEqual(["camera can't be free and have a yaw"]);
    expect(spaceCameraProblems({ free: false }, "camera")).toEqual(["camera.free must be true (or left out)"]);
    expect(spaceCameraProblems([90], "camera")).toHaveLength(1);
    expect(() => setSpaceCamera(SPACES, 2, { yaw: -5 })).toThrow(/yaw/);
    expect(() => setSpaceCamera(SPACES, 9, { yaw: 5 })).toThrow();
  });

  it("is checked with the map's spaces", () => {
    expect(spaceProblems([{ id: 1, at: [0, 64, 0], camera: { yaw: 90, pitch: 30 } }], BLOCK_PARTY_BOARD)).toEqual([]);
    expect(spaceProblems([{ id: 1, at: [0, 64, 0], camera: { yaw: 400 } }], BLOCK_PARTY_BOARD)).toEqual(["spaces[0].camera.yaw must be a whole number from 0 to 359"]);
  });

  it("is a map edit, with words for the undo history", () => {
    const config: MapConfig = { name: "Board", spawns: [], spaces: SPACES };
    const edited = applyEdit(config, { op: "spaceCamera", id: 2, camera: { yaw: 180 } });
    expect((edited.spaces as BoardSpace[])[1].camera).toEqual({ yaw: 180 });
    expect((applyEdit(edited, { op: "spaceCamera", id: 2 }).spaces as BoardSpace[])[1].camera).toBeUndefined();
    expect(() => applyEdit(config, { op: "spaceCamera", id: 2, camera: { yaw: 999 } })).toThrow(/yaw/);
    expect(describeEdit({ op: "spaceCamera", id: 2, camera: { free: true } })).toBe("change space 2's cutscene camera");
    expect(describeEdit({ op: "spaceCamera", id: 2 })).toBe("take space 2's cutscene camera away");
  });
});
