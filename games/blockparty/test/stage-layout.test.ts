// Where the NPCs stand and the shots look from (stage-layout.ts), and the stage markup a board asks
// for (stage-markup.ts).
import { describe, expect, it } from "vitest";
import { mapRequirements } from "@minecade/minigame-core/config";
import type { Space, Vec3 } from "../behavior_pack/scripts/board.ts";
import { EYE, besideSpace, faceShot, finalPodium, hoverBefore, introAround, markerShot, orbitShots, pathWay, podiumFromMarkup, podiumOnStart, pulledBack, spaceShot, twoShot, yawFrom } from "../behavior_pack/scripts/stage-layout.ts";
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

  it("asks a board for its pre-game podium, Chris by type, the podium camera, the intro and the final podium, each a row a map can turn off", () => {
    expect(config.map.points).toBe(STAGE_MARKUP);
    const rows = mapRequirements(config.map, { kind: "game", maxPlayers: config.maxPlayers });
    expect(rows.filter((row) => row.field === "points").map((row) => [row.key, row.label, row.min, row.floor])).toEqual([
      ["points.podium", "Pre-game podium", 4, 0],
      ["points.chris.pregame", "Chris (Pre-game)", 1, 0],
      ["points.chris.final", "Chris (Final podium)", 1, 0],
      ["points.podiumCamera", "Podium camera", 1, 0],
      ["points.intro", "Intro shots", 2, 0],
      ["points.finalPodium", "Final podium", 4, 0],
      ["points.finalCamera", "Final podium camera", 1, 0],
    ]);
    expect(chrisKey("pregame")).toBe("chris.pregame");
    expect(chrisKey("final")).toBe("chris.final");
    expect(Object.keys(STAGE_ADJUSTABLE)).toEqual(["points.podium", "points.chris", "points.podiumCamera", "points.intro", "points.finalPodium", "points.finalCamera"]);
  });
});

describe("the end of the game's stage", () => {
  // The pre-game podium: four spots along x at z 0, Chris at z 5, the camera behind them at z -6.
  const pregame = { lineup: [[0, 70, 0], [1.5, 70, 0], [4, 70, 0], [5.5, 70, 0]] as Vec3[], chris: [2.75, 70, 5] as Vec3, camera: { location: [2.75, 73.2, -6] as Vec3, facing: [2.75, 70.8, 5] as Vec3 } };

  it("stands the final podium on the pre-game one, in place order, facing its camera, when the map marks none", () => {
    const podium = finalPodium([], undefined, undefined, 4, pregame);
    expect(podium.marked).toBe(false);
    expect(podium.spots).toEqual(pregame.lineup);
    expect(podium.camera).toBe(pregame.camera);
    expect(podium.chris).toEqual(pregame.chris);
    // Everyone faces the camera (north, -z: yaw 180 or -180).
    for (const yaw of podium.yaws) expect(Math.abs(yaw)).toBeGreaterThan(150);
    // Too few final spots for everyone: the pre-game podium still.
    expect(finalPodium([{ at: [0, 64, 0] }], undefined, undefined, 2, pregame).marked).toBe(false);
  });

  it("uses the map's final podium: each spot's own facing, Chris's marker, its camera, or a shot in front of the spots", () => {
    // 2nd, 1st, 3rd across x, all facing south (+z, yaw 0), 1st higher.
    const spots = [{ at: [10, 66, 0] as Vec3, yaw: 0 }, { at: [8, 65, 0] as Vec3, yaw: 0 }, { at: [12, 64, 0] as Vec3, yaw: 0 }];
    const podium = finalPodium(spots, { at: [20, 64, 3] }, undefined, 3, pregame);
    expect(podium.marked).toBe(true);
    expect(podium.spots).toEqual([[10, 66, 0], [8, 65, 0], [12, 64, 0]]);
    expect(podium.yaws).toEqual([0, 0, 0]);
    expect(podium.chris).toEqual([20, 64, 3]);
    // No camera marker: in front of them (south, +z), looking at their middle.
    expect(podium.camera.location[2]).toBeGreaterThanOrEqual(7);
    expect(podium.camera.facing?.[0]).toBeCloseTo(10);
    // No Chris marker: past the end of the row, on the lowest spot's floor.
    const aside = finalPodium(spots, undefined, undefined, 3, pregame).chris;
    expect(aside[1]).toBe(64);
    expect(Math.abs(aside[0] - 10)).toBeGreaterThan(2);
    // The map's camera with its own facing wins, and spots with none face it.
    const camera = { at: [10, 64, 9], yaw: 180, pitch: 10 };
    const marked = finalPodium([{ at: [10, 66, 0] }, { at: [8, 65, 0] }], undefined, camera, 2, pregame);
    expect(marked.camera.rotation).toEqual({ yaw: 180, pitch: 10 });
    expect(marked.yaws[0]).toBeCloseTo(0);
  });

  it("starts the final podium's ease in further back and higher, still aimed the same way", () => {
    const shot = { location: [0, 70, 0] as Vec3, facing: [0, 70, 10] as Vec3 };
    const back = pulledBack(shot, 6, 2);
    expect(back.location).toEqual([0, 72, -6]);
    expect(back.facing).toEqual([0, 70, 10]);
    const turned = pulledBack({ location: [0, 70, 0], rotation: { yaw: 0, pitch: 0 } }, 6);
    expect(turned.location[2]).toBeCloseTo(-6);
    expect(turned.rotation).toEqual({ yaw: 0, pitch: 0 });
    // Raised, a shot with its own facing looks at where it looked: down a little.
    const raised = pulledBack({ location: [0, 70, 0], rotation: { yaw: 0, pitch: 0 } }, 6, 2);
    expect(raised.facing?.[2]).toBeCloseTo(6);
  });

  it("orbits the winner round their front, level with a little over their eyes, looking at them", () => {
    const shots = orbitShots([0, 64, 0], 0, 4, 120, 4);
    expect(shots).toHaveLength(5);
    for (const shot of shots) {
      expect(Math.hypot(shot.location[0], shot.location[2])).toBeCloseTo(4);
      expect(shot.location[1]).toBeCloseTo(64 + EYE + 0.5);
      expect(shot.facing).toEqual([0, 65.2, 0]);
      // Facing south: always in front of them.
      expect(shot.location[2]).toBeGreaterThan(0);
    }
    expect(shots[2].location[0]).toBeCloseTo(0);
    expect(shots[0].location[0]).toBeCloseTo(-shots[4].location[0]);
  });

  it("hovers the Allay in front of a player's head, toward the camera", () => {
    const spot = hoverBefore([0, 64, 0], [0, 70, -10]);
    expect(spot[2]).toBeCloseTo(-1.4);
    expect(spot[1]).toBeCloseTo(64 + EYE + 0.3);
  });
});
