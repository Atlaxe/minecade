// The camera tuned in game and the cutscenes' way (the user, 2026-11-23: /boardcam, /spacecam,
// "when board camera turns is set to 0 ... it should apply to ALL cameras for that map"):
// camera-tuning.ts, stage-layout.ts's ways, Board's view and the golems' pan along the board's way.
import { describe, expect, it } from "vitest";
import type { MapEdit, MapSettingConfig } from "@minecade/minigame-core/config";
import { CAMERA_SETTING_KEYS } from "../behavior_pack/scripts/board-camera.ts";
import { testSpaces, type Space, type Vec3 } from "../behavior_pack/scripts/board.ts";
import { boardOverview, boardPan } from "../behavior_pack/scripts/board-view.ts";
import { BOARD_CAM_SETTINGS, BOARD_CAM_WORDS, CameraTuning, SPACE_CAM_WORDS, describeSpaceCamera, saveBatches, spaceName, wholeYaw, type TuningHost } from "../behavior_pack/scripts/camera-tuning.ts";
import { forkShot } from "../behavior_pack/scripts/fork.ts";
import { golemShot } from "../behavior_pack/scripts/golems.ts";
import { cutsceneWay, flightShot, lightningShot, nearestSpace, seatWayShot, spaceShot, twoShot, wayShot, yawFrom, type Shot } from "../behavior_pack/scripts/stage-layout.ts";
import config from "../game.config.ts";

/** Which way a shot looks over the ground (its yaw), however it says so. */
function yawOf(shot: Shot): number {
  const yaw = shot.rotation ? shot.rotation.yaw : yawFrom(shot.location, shot.facing!);
  return ((Math.round(yaw) % 360) + 360) % 360;
}

describe("a cutscene's way", () => {
  it("is the space's own, else the board camera's while it never turns, unless the space is free", () => {
    expect(cutsceneWay(undefined, 180)).toEqual({ yaw: 180 });
    expect(cutsceneWay(undefined, undefined)).toBeUndefined();
    expect(cutsceneWay({ yaw: 90, pitch: 20 }, 180)).toEqual({ yaw: 90, pitch: 20 });
    expect(cutsceneWay({ yaw: 90 }, undefined)).toEqual({ yaw: 90 });
    expect(cutsceneWay({ free: true }, 180)).toBeUndefined();
    expect(cutsceneWay({ distance: 6 }, 180)).toEqual({ yaw: 180, distance: 6 });
    expect(cutsceneWay({ distance: 6 }, undefined)).toBeUndefined();
  });

  it("lays a shot that looks exactly that way at its subject, as far back and as high as it says", () => {
    const shot = wayShot([10, 64, 10], { yaw: 0 }, 8, 30);
    expect(shot.rotation).toEqual({ yaw: 0, pitch: 30 });
    // Yaw 0 looks south (+z): the camera is north of the subject, 8 back along its line.
    expect(shot.location[0]).toBeCloseTo(10);
    expect(Math.hypot(shot.location[0] - 10, shot.location[1] - 64, shot.location[2] - 10)).toBeCloseTo(8);
    expect(shot.location[2]).toBeLessThan(10);
    expect(shot.location[1]).toBeCloseTo(64 + 8 * Math.sin(Math.PI / 6));
    const tuned = wayShot([10, 64, 10], { yaw: 270, pitch: 10, distance: 5 }, 8, 30);
    expect(tuned.rotation).toEqual({ yaw: 270, pitch: 10 });
    expect(Math.hypot(tuned.location[0] - 10, tuned.location[1] - 64, tuned.location[2] - 10)).toBeCloseTo(5);
    expect(wayShot([0, 0, 0], { yaw: -90 }, 5, 0).rotation?.yaw).toBe(270);
  });

  it("turns every kind of board shot that way", () => {
    const spaces = testSpaces([0, 64, 0], 6);
    const way = { yaw: 135 };
    expect(yawOf(twoShot([0, 64, 0], [3, 64, 1], 1, way))).toBe(135);
    expect(yawOf(spaceShot(spaces[2], spaces, way))).toBe(135);
    expect(yawOf(seatWayShot([1, 64, 1], way))).toBe(135);
    expect(yawOf(lightningShot([1, 64, 1], way))).toBe(135);
    expect(yawOf(flightShot([1, 70, 1], way))).toBe(135);
    expect(yawOf(forkShot(spaces[0], [1, 0], [spaces[1], spaces[2]], way))).toBe(135);
    expect(yawOf(golemShot({ at: [5, 64, 5], yaw: 0 }, way))).toBe(135);
    // Without one, each keeps its own side, as before.
    expect(twoShot([0, 64, 0], [3, 64, 1], 1).rotation).toBeUndefined();
    expect(spaceShot(spaces[2], spaces)).toEqual(spaceShot(spaces[2], spaces, undefined));
  });

  it("finds the space a seat stands on (its corner), and none off the board", () => {
    const spaces = testSpaces([0, 64, 0], 6);
    const corner: Vec3 = [spaces[3].at[0] + 0.7, spaces[3].at[1], spaces[3].at[2] - 0.7];
    expect(nearestSpace(spaces, corner)).toBe(spaces[3]);
    expect(nearestSpace(spaces, [100, 64, 100])).toBeUndefined();
  });
});

describe("Board's view and the golems' pan along the board camera's way", () => {
  const spaces = testSpaces([0, 64, 0], 6);

  it("looks the board camera's way at the whole board, and the same as ever without one", () => {
    const free = boardOverview(spaces)!;
    // Its own: from the south or the east, as before.
    expect([0, 90, 180, 270]).toContain(yawOf(free));
    for (const yaw of [0, 45, 200]) {
      const shot = boardOverview(spaces, yaw)!;
      expect(yawOf(shot)).toBe(yaw);
      expect(shot.facing![0]).toBeCloseTo(free.facing![0]);
      expect(shot.facing![2]).toBeCloseTo(free.facing![2]);
    }
  });

  it("slides across the board instead of swinging round it, so its way never turns", () => {
    const points: Vec3[] = [[0, 64, 0], [40, 64, 0], [40, 64, 20], [0, 64, 20]];
    const [from, to] = boardPan(points, 60, 30) as [Shot, Shot];
    expect(yawOf(from)).toBe(30);
    expect(yawOf(to)).toBe(30);
    expect(Math.hypot(from.location[0] - to.location[0], from.location[2] - to.location[2])).toBeGreaterThan(5);
    expect(boardPan([], 60, 30)).toEqual([]);
  });
});

/** A host for the tuning: the board's camera settings from game.config.ts, a test board, and what it was asked to do. */
function host(over: Partial<TuningHost> = {}): TuningHost & { calls: string[]; saved: MapEdit[]; map: Record<string, number>; spacesNow: Space[]; now?: Space; shown?: Space } {
  const settings = config.map!.settings! as Record<string, MapSettingConfig>;
  const map: Record<string, number> = {};
  const spacesNow = testSpaces([0, 64, 0], 6).map((space, i) => ({ ...space, id: i + 1 }));
  const fake: TuningHost & { calls: string[]; saved: MapEdit[]; map: Record<string, number>; spacesNow: Space[]; now?: Space; shown?: Space } = {
    calls: [],
    saved: [],
    map,
    spacesNow,
    setting: (key) => settings[key],
    mapValue: (key) => map[key] ?? settings[key].default,
    spaces: () => spacesNow,
    boardYaw: () => 180,
    retuned: () => fake.calls.push("retuned"),
    spaceNow: () => fake.now,
    shotSpace: () => fake.shown,
    show: (space) => {
      fake.calls.push(`show ${space.id}`);
      fake.shown = space;
    },
    back: () => (fake.calls.push("back"), true),
    canSave: () => true,
    save: async (edit) => {
      fake.saved.push(edit);
      return { ok: true, message: "Saved to the map." };
    },
    ...over,
  };
  return fake;
}

describe("/boardcam", () => {
  it("has a word for every board camera setting, then reset and save", () => {
    expect(Object.values(BOARD_CAM_SETTINGS).sort()).toEqual(Object.values(CAMERA_SETTING_KEYS).sort());
    expect(BOARD_CAM_WORDS).toEqual(["turns", "direction", "distance", "height", "pitch", "fov", "turndistance", "turnfov", "ease", "reset", "save"]);
    expect(SPACE_CAM_WORDS).toContain("free");
  });

  it("changes a setting for the game at once, in the map's units and range", async () => {
    const fake = host();
    const tuning = new CameraTuning(fake);
    expect(await tuning.boardCommand("distance", 14, "Steve")).toBe("Board camera distance: 14 blocks (the map: 10 blocks).");
    expect(tuning.value("boardCameraDistance")).toBe(14);
    expect(fake.calls).toEqual(["retuned"]);
    expect(await tuning.boardCommand("fov", 200, "Steve")).toMatch(/30 to 110/);
    expect(await tuning.boardCommand("fov", undefined, "Steve")).toMatch(/is 70 degrees/);
    expect(tuning.value("boardCameraFov")).toBe(70);
    // Back to the map's value: nothing left to save.
    await tuning.boardCommand("distance", 10, "Steve");
    expect(tuning.unsaved).toBe(false);
  });

  it("lists every setting, marking what changed", async () => {
    const tuning = new CameraTuning(host());
    await tuning.boardCommand("height", 9, "Steve");
    const list = await tuning.boardCommand(undefined, undefined, "Steve");
    expect(list).toContain("height 9 *");
    expect(list).toContain("direction -1 (picked: 180)");
    expect(list).toContain("/boardcam save");
  });

  it("resets every change not saved, the spaces' too", async () => {
    const fake = host();
    const tuning = new CameraTuning(fake);
    fake.now = fake.spacesNow[2];
    await tuning.boardCommand("pitch", 50, "Steve");
    await tuning.spaceCommand("way", 90, "Steve");
    expect(await tuning.boardCommand("reset", undefined, "Steve")).toMatch(/undone/);
    expect(tuning.value("boardCameraPitch")).toBe(35);
    expect(fake.spacesNow[2].camera).toBeUndefined();
    expect(await tuning.boardCommand("reset", undefined, "Steve")).toMatch(/as the map has it/);
  });
});

describe("/spacecam", () => {
  it("tunes the space the cutscene on screen is at, laying its shot again", async () => {
    const fake = host();
    const tuning = new CameraTuning(fake);
    fake.now = fake.shown = fake.spacesNow[4];
    expect(await tuning.spaceCommand("way", -45, "Steve")).toBe("space 5 (blue): its cutscenes look its own way, 315 degrees.");
    expect(await tuning.spaceCommand("pitch", 20, "Steve")).toMatch(/pitch 20/);
    expect(fake.spacesNow[4].camera).toEqual({ yaw: 315, pitch: 20 });
    // The shot on screen is this space's: it's laid again, not shown afresh.
    expect(fake.calls).toEqual(["retuned", "retuned"]);
    expect(await tuning.spaceCommand("free", undefined, "Steve")).toMatch(/are free/);
    expect(fake.spacesNow[4].camera).toEqual({ pitch: 20, free: true });
    expect(await tuning.spaceCommand("board", undefined, "Steve")).toMatch(/board camera's way, 180/);
    expect(await tuning.spaceCommand("default", undefined, "Steve")).toMatch(/board camera's way/);
    expect(fake.spacesNow[4].camera).toBeUndefined();
    expect(tuning.unsaved).toBe(false);
  });

  it("shows a space it tunes that isn't on screen, and one picked by id; back returns to the board's camera", async () => {
    const fake = host();
    const tuning = new CameraTuning(fake);
    fake.now = fake.spacesNow[1];
    await tuning.spaceCommand("distance", 6, "Steve");
    expect(fake.calls).toEqual(["retuned", "show 2"]);
    expect(await tuning.spaceCommand("space", 7, "Steve")).toMatch(/^space 7 \(chance\)/);
    expect(await tuning.spaceCommand("space", 99, "Steve")).toMatch(/no space 99/);
    expect(await tuning.spaceCommand("distance", 7, "Steve")).toMatch(/puts the camera back/);
    expect(await tuning.spaceCommand("back", undefined, "Steve")).toMatch(/camera from before/);
    expect(fake.calls.slice(-4)).toEqual(["show 7", "retuned", "show 2", "back"]);
  });

  it("refuses what doesn't fit, and says when there's no space to tune", async () => {
    const fake = host();
    const tuning = new CameraTuning(fake);
    expect(await tuning.spaceCommand("way", 90, "Steve")).toMatch(/No space to tune/);
    fake.now = fake.spacesNow[0];
    expect(await tuning.spaceCommand("pitch", 95, "Steve")).toMatch(/-30 to 89/);
    expect(await tuning.spaceCommand("distance", undefined, "Steve")).toMatch(/needs a number/);
    expect(fake.spacesNow[0].camera).toBeUndefined();
  });
});

describe("saving the tuned camera", () => {
  it("sends every change as map edits from a preview, then has nothing left to save", async () => {
    const fake = host();
    const tuning = new CameraTuning(fake);
    fake.now = fake.spacesNow[3];
    await tuning.boardCommand("distance", 12, "Steve");
    await tuning.spaceCommand("way", 90, "Steve");
    expect(await tuning.boardCommand("save", undefined, "Steve")).toBe("Saved to the map.");
    expect(fake.saved).toEqual([
      {
        op: "batch",
        edits: [
          { op: "extra", key: "boardCameraDistance", value: 12 },
          { op: "spaceCamera", id: 4, camera: { yaw: 90 } },
        ],
      },
    ]);
    expect(tuning.unsaved).toBe(false);
    // Saved values are the game's now: reset no longer takes them back.
    expect(await tuning.boardCommand("reset", undefined, "Steve")).toMatch(/as the map has it/);
    expect(tuning.value("boardCameraDistance")).toBe(12);
    expect(await tuning.spaceCommand("save", undefined, "Steve")).toMatch(/Nothing to save/);
  });

  it("takes a space's camera away on the map when it went back to none", async () => {
    const fake = host();
    fake.spacesNow[3].camera = { free: true };
    const tuning = new CameraTuning(fake);
    fake.now = fake.spacesNow[3];
    await tuning.spaceCommand("default", undefined, "Steve");
    expect(tuning.edits()).toEqual([{ op: "spaceCamera", id: 4 }]);
  });

  it("lists what to set by hand anywhere but a preview", async () => {
    const fake = host({ canSave: () => false });
    const tuning = new CameraTuning(fake);
    fake.now = fake.spacesNow[3];
    await tuning.boardCommand("fov", 60, "Steve");
    await tuning.spaceCommand("way", 90, "Steve");
    const said = await tuning.boardCommand("save", undefined, "Steve");
    expect(said).toMatch(/^Not saved: only a preview/);
    expect(said).toContain("Board camera field of view 60");
    expect(said).toContain('space 4 (item): {"yaw":90}');
    expect(fake.saved).toEqual([]);
    expect(tuning.unsaved).toBe(true);
  });

  it("stops at the first save the map editor refuses, keeping the rest to save", async () => {
    const fake = host({ save: async () => ({ ok: false, message: "The map wasn't changed: busy" }) });
    const tuning = new CameraTuning(fake);
    await tuning.boardCommand("ease", 5, "Steve");
    expect(await tuning.boardCommand("save", undefined, "Steve")).toBe("The map wasn't changed: busy");
    expect(tuning.unsaved).toBe(true);
  });

  it("splits a long save into batches that each fit a console message", () => {
    const edits: MapEdit[] = Array.from({ length: 40 }, (_, i) => ({ op: "spaceCamera", id: i + 1, camera: { yaw: 90, pitch: 20, distance: 8 } }));
    const batches = saveBatches(edits);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) expect(JSON.stringify(batch).length).toBeLessThanOrEqual(1300);
    expect(batches.flatMap((batch) => (batch.op === "batch" ? batch.edits : [batch]))).toEqual(edits);
    expect(saveBatches([edits[0]])).toEqual([edits[0]]);
    expect(saveBatches([])).toEqual([]);
  });

  it("names spaces and yaws as the commands take them", () => {
    expect(wholeYaw(-90)).toBe(270);
    expect(wholeYaw(359.6)).toBe(0);
    expect(spaceName({ index: 2, type: "blue", at: [0, 0, 0], next: [] })).toBe("space 3 (blue)");
    expect(describeSpaceCamera({ pitch: 20 }, undefined)).toMatch(/turns.*pitch 20 \(used once it has a way\)/);
  });
});
