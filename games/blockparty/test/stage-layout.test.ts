// Where the NPCs stand and the shots look from (stage-layout.ts), and the stage markup a board asks
// for (stage-markup.ts).
import { describe, expect, it } from "vitest";
import { mapRequirements } from "@minecade/minigame-core/config";
import type { Space, Vec3 } from "../behavior_pack/scripts/board.ts";
import { EYE, besideSpace, faceShot, introAround, markerShot, pathWay, podiumFromMarkup, podiumOnStart, spaceShot, twoShot, yawFrom } from "../behavior_pack/scripts/stage-layout.ts";
import { STAGE_ADJUSTABLE, STAGE_MARKUP, chrisKey } from "../behavior_pack/scripts/stage-markup.ts";
import config from "../game.config.ts";

/** A straight run of spaces east (+x), 5 apart, Start first, looping back: pieces at 64, on markers whose floor is 63.5. */
function line(count = 4): Space[] {
  return Array.from({ length: count }, (_, index) => ({ index, type: index === 0 ? "start" : "blue", at: [index * 5, 64, 0] as Vec3, floor: 63.5, next: [(index + 1) % count] }));
}

const flatDistance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

describe("Block Party's stage", () => {
  it("knows which way the path runs through a space", () => {
    const spaces = line();
    expect(pathWay(spaces[1], spaces)).toEqual([1, 0]);
  });

  it("puts an NPC beside a space across the path first, then ahead and behind, on the floor", () => {
    const spaces = line();
    const spots = besideSpace(spaces[1], spaces);
    expect(spots[0]).toEqual([5, 63.5, 2.5]);
    expect(spots[1]).toEqual([5, 63.5, -2.5]);
    expect(spots[2]).toEqual([7.5, 63.5, 0]);
    expect(spots[3]).toEqual([2.5, 63.5, 0]);
  });

  it("frames two people from the side of the line between them, looking at their middle", () => {
    const shot = twoShot([0, 64, 0], [4, 64, 0], 1);
    expect(shot.facing).toEqual([2, 65.1, 0]);
    expect(shot.location[0]).toBe(2);
    expect(Math.abs(shot.location[2])).toBeGreaterThanOrEqual(4.5);
    expect(twoShot([0, 64, 0], [4, 64, 0], -1).location[2]).toBe(-shot.location[2]);
  });

  it("stands the podium on Start when the board marks none: the seats on its corners, Chris on the next space, the camera behind", () => {
    const spaces = line();
    const podium = podiumOnStart(spaces[0], spaces);
    expect(podium.lineup).toHaveLength(4);
    for (const at of podium.lineup) expect(flatDistance(at, spaces[0].at)).toBeLessThan(1.5);
    expect(podium.chris).toEqual(spaces[1].at);
    expect(podium.camera.location[0]).toBeLessThan(0);
    expect(podium.camera.facing?.[0]).toBe(spaces[1].at[0]);
  });

  it("takes the board's own podium when it marks one with a spot for every seat and Chris", () => {
    const lineup = [0, 1, 3, 4].map((x) => ({ at: [x, 70, 0] as Vec3 }));
    const chris = { at: [2, 70, 5] as Vec3 };
    const camera = { at: [2, 70, -6] as Vec3, yaw: 0, pitch: 10 };
    const podium = podiumFromMarkup(lineup, chris, camera, 4);
    expect(podium?.chris).toEqual([2, 70, 5]);
    expect(podium?.camera).toEqual({ location: [2, 70 + EYE, -6], rotation: { yaw: 0, pitch: 10 } });
    expect(podiumFromMarkup(lineup.slice(0, 3), chris, camera, 4)).toBeUndefined();
    expect(podiumFromMarkup(lineup, undefined, camera, 4)).toBeUndefined();
    // No podium camera: behind the podium's middle, away from Chris and up, looking at him.
    const behind = podiumFromMarkup(lineup, chris, undefined, 4);
    expect(behind?.chris).toEqual([2, 70, 5]);
    expect(behind?.camera.facing).toEqual([2, 70.8, 5]);
    expect(behind?.camera.location[0]).toBeCloseTo(2);
    expect(behind?.camera.location[1]).toBeCloseTo(73.2);
    expect(behind?.camera.location[2]).toBeCloseTo(-6);
    // A camera with no facing looks at Chris.
    expect(markerShot({ at: [0, 64, 0] }, [5, 64, 5]).facing).toEqual([5, 64, 5]);
  });

  it("flies the intro round the board, high, looking at its middle, when the board marks no shots", () => {
    const spaces = line();
    const shots = introAround(spaces);
    expect(shots).toHaveLength(3);
    for (const shot of shots) {
      expect(shot.facing).toEqual([7.5, 64, 0]);
      expect(shot.location[1]).toBeGreaterThanOrEqual(74);
    }
    expect(introAround([])).toEqual([]);
  });

  it("shows a space from across the path and up, and a face from in front", () => {
    const spaces = line();
    const shot = spaceShot(spaces[2], spaces);
    expect(shot.facing).toEqual([10, 64.8, 0]);
    expect(shot.location[1]).toBeGreaterThan(64);
    // Facing south (+z), the camera is south of them, looking back at their eyes.
    const face = faceShot([0, 64, 0], 0);
    expect(face.location[2]).toBeGreaterThan(0);
    expect(face.facing?.[2]).toBe(0);
    expect(yawFrom([0, 64, 0], [0, 64, 5])).toBeCloseTo(0);
    expect(yawFrom([0, 64, 0], [-5, 64, 0])).toBeCloseTo(90);
  });

  it("asks a board for its pre-game podium, Chris by type, the podium camera and the intro, each a row a map can turn off", () => {
    expect(config.map.points).toBe(STAGE_MARKUP);
    const rows = mapRequirements(config.map, { kind: "game", maxPlayers: config.maxPlayers });
    expect(rows.filter((row) => row.field === "points").map((row) => [row.key, row.label, row.min, row.floor])).toEqual([
      ["points.podium", "Pre-game podium", 4, 0],
      ["points.chris.pregame", "Chris (Pre-game)", 1, 0],
      ["points.podiumCamera", "Podium camera", 1, 0],
      ["points.intro", "Intro shots", 2, 0],
    ]);
    expect(chrisKey("pregame")).toBe("chris.pregame");
    expect(Object.keys(STAGE_ADJUSTABLE)).toEqual(["points.podium", "points.chris", "points.podiumCamera", "points.intro"]);
  });
});
