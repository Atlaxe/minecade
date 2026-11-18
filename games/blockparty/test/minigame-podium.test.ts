// The minigame podium (minigame-podium.ts): who stands where after a minigame, the shot on them, the
// stand-in podium for an arena that marks none, and the poses the winners and the sad hold there
// (animations.ts, holdPoint and the pack's held poses).
import { describe, expect, it } from "vitest";
import { CLIPS, HOLD_SUFFIX, PLAYER, holdOf, holdPoint, variantsOf } from "../behavior_pack/scripts/animations.ts";
import { podiumLayout, podiumOrder, podiumPlaces, standInPodium, yawToward } from "../behavior_pack/scripts/minigame-podium.ts";
import { MARKUP } from "../behavior_pack/scripts/minigames/arenas.ts";
import { testField, type Spot } from "../behavior_pack/scripts/minigames/kit.ts";
import playerPack from "../resource_pack/animations/blockparty.player.animation.json";

const MIN = { x: 100, y: 64, z: 200 };
const RULES = { x: 120, y: 80, z: 190 };

describe("the minigame podium's places", () => {
  it("are an FFA's places, ties side by side, with anyone the outcome left out last", () => {
    const sides = [["a"], ["b"], ["c"], ["d"]];
    expect(podiumPlaces(sides, { places: [["c"], ["a", "d"]] })).toEqual([["c"], ["a", "d"], ["b"]]);
    expect(podiumOrder(podiumPlaces(sides, { places: [["c"], ["a", "d"]] }))).toEqual(["c", "a", "d", "b"]);
  });

  it("put a team minigame's winning side first, and everyone together after a draw", () => {
    const sides = [["solo"], ["x", "y", "z"]];
    expect(podiumPlaces(sides, { winner: 1 })).toEqual([["x", "y", "z"], ["solo"]]);
    expect(podiumPlaces(sides, { winner: 0 })).toEqual([["solo"], ["x", "y", "z"]]);
    expect(podiumPlaces(sides, { winner: undefined })).toEqual([["solo", "x", "y", "z"]]);
  });
});

describe("the minigame podium's layout", () => {
  const podium: Spot[] = [
    { x: 110.5, y: 68, z: 220.5, yaw: 180 },
    { x: 108.5, y: 67, z: 220.5, yaw: 180 },
    { x: 112.5, y: 66, z: 220.5, yaw: 180 },
    { x: 114.5, y: 65, z: 220.5, yaw: 180 },
  ];

  it("uses the arena map's podium, 1st first, through its Podium camera's own facing", () => {
    const camera: Spot = { x: 111, y: 69, z: 212, yaw: 0, pitch: 10 };
    const field = testField(MIN, [40, 20, 60], { points: { [MARKUP.podium]: podium, [MARKUP.podiumCamera]: [camera] } });
    const layout = podiumLayout(field, 3, [], RULES);
    expect(layout.marked).toBe(true);
    expect(layout.spots).toEqual(podium.slice(0, 3));
    expect(layout.shot).toEqual({ location: { x: 111, y: 69, z: 212 }, rotation: { x: 10, y: 0 } });
  });

  it("stands the camera in front of the podium, the way its spots face, when the map has no Podium camera", () => {
    const field = testField(MIN, [40, 20, 60], { points: { [MARKUP.podium]: podium } });
    const layout = podiumLayout(field, 4, [], RULES);
    // They face north (180): the camera is north of them, up a little, looking at their middle.
    expect(layout.shot.location.z).toBeLessThan(214.5);
    expect(layout.shot.location.y).toBeGreaterThan(66.5);
    expect(layout.shot.facing).toEqual({ x: 111.5, y: 66.5 + 1.1, z: 220.5 });
  });

  it("falls back on the stand-in when the map marks fewer spots than there are players", () => {
    const field = testField(MIN, [40, 20, 60], { points: { [MARKUP.podium]: podium.slice(0, 2) } });
    const standIn = standInPodium({ x: 120, y: 64, z: 230 }, 64, yawToward({ x: 120, y: 64, z: 230 }, RULES), 3);
    const layout = podiumLayout(field, 3, standIn.spots, RULES);
    expect(layout.marked).toBe(false);
    expect(layout.spots).toEqual(standIn.spots);
  });
});

describe("the stand-in podium", () => {
  it("lays four columns side by side, 1st the highest, everyone on top facing the camera's side", () => {
    // The camera is to the north (180): the columns run east to west.
    const { spots, blocks } = standInPodium({ x: 120.4, y: 64, z: 230.6 }, 64, 170, 4);
    expect(spots.map((spot) => spot.y)).toEqual([68, 67, 66, 65]);
    expect(spots.every((spot) => spot.yaw === 180 && spot.z === 230.5)).toBe(true);
    expect(new Set(spots.map((spot) => spot.x)).size).toBe(4);
    // 4 + 3 + 2 + 1 blocks, each column from the floor up under its spot.
    expect(blocks).toHaveLength(10);
    for (const spot of spots) {
      const column = blocks.filter((block) => block.at.x === spot.x - 0.5 && block.at.z === spot.z - 0.5);
      expect(Math.max(...column.map((block) => block.at.y))).toBe(spot.y - 1);
      expect(Math.min(...column.map((block) => block.at.y))).toBe(64);
    }
    // 1st stands between 2nd and 3rd.
    const across = spots.map((spot) => spot.x);
    expect(Math.min(across[1], across[2]) < across[0] && across[0] < Math.max(across[1], across[2])).toBe(true);
  });

  it("lays only as many columns as there are players (a duel's two)", () => {
    const { spots, blocks } = standInPodium({ x: 0, y: 64, z: 0 }, 64, 0, 2);
    expect(spots).toHaveLength(2);
    expect(blocks).toHaveLength(4 + 3);
  });
});

describe("the poses held on the podium", () => {
  it("are held where each clip's last move back to rest starts", () => {
    const bones = (name: string) => (playerPack.animations as Record<string, { bones?: Record<string, unknown> }>)[name]?.bones;
    expect(holdPoint(bones("animation.blockparty.player.celebration.arms_up"), 1.8)).toBe(1.3);
    expect(holdPoint(bones("animation.blockparty.player.celebration.fist_pump"), 1.6)).toBe(1.05);
    // The stomp's leg is down again early on: that isn't the move back to rest.
    expect(holdPoint(bones("animation.blockparty.player.sad.stomp"), 1.8)).toBe(1.4);
    // Nothing goes back to rest: held at its end.
    expect(holdPoint({ head: { rotation: { "0.0": [0, 0, 0], "1.0": [20, 0, 0] } } }, 1)).toBe(1);
  });

  it("are in the pack for every Celebration and Sad, never picked as a variant themselves", () => {
    for (const set of ["Celebration", "Sad"]) {
      const clips = variantsOf(CLIPS, PLAYER, set);
      expect(clips.length).toBeGreaterThan(0);
      for (const clip of clips) {
        expect(clip.name.endsWith(HOLD_SUFFIX)).toBe(false);
        const pose = holdOf(CLIPS, clip);
        expect(pose, clip.name).toBeDefined();
        expect(pose?.loops).toBe(true);
        expect(clip.holdAt).toBeLessThan(clip.seconds);
      }
    }
  });
});
