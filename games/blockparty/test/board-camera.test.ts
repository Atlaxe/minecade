// The board's camera (board-camera.ts): the board view, the turn shot, other shots taking it and
// giving it back, and into a minigame; and the controls that go with it (no jump on the board but
// the roll's, the item panel on A and D only).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Scope } from "@minecade/minigame-core";
import { InputPermissionCategory, system, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../../packages/minigame-core/test/util.ts";
import { BoardCamera, DEFAULT_BOARD_CAMERA, autoDirection, cameraSettings, lookInto, normal, turnBetween, viewShot, yawToward, zoomOutShot, type BoardCameraSettings } from "../behavior_pack/scripts/board-camera.ts";
import { RIGHT_X, sidewaysOf } from "../behavior_pack/scripts/board-view.ts";
import { testSpaces } from "../behavior_pack/scripts/board.ts";
import { hold, lock, resendLocks } from "../behavior_pack/scripts/pieces.ts";
import config from "../game.config.ts";

async function ticks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    system.advanceTicks(1);
    await flushPromises(2);
  }
}

describe("the board camera's shots", () => {
  const settings: BoardCameraSettings = { ...DEFAULT_BOARD_CAMERA, direction: 180 };

  it("stands behind the player and above, looking the way it's set", () => {
    // Looking north (yaw 180): the camera is south of the player, higher, pitched down.
    const shot = viewShot([0, 64, 0], 180, settings, "board");
    expect(shot.location[0]).toBeCloseTo(0);
    expect(shot.location[2]).toBeCloseTo(settings.distance);
    expect(shot.location[1]).toBeCloseTo(64 + 0.5 + settings.height);
    expect(shot.yaw).toBe(180);
    expect(shot.pitch).toBe(settings.pitch);
  });

  it("comes closer for the turn shot, at the same angle", () => {
    const board = viewShot([0, 64, 0], 0, settings, "board");
    const turn = viewShot([0, 64, 0], 0, settings, "turn");
    expect(Math.abs(turn.location[2])).toBeCloseTo(settings.turnDistance);
    expect(Math.abs(turn.location[2])).toBeLessThan(Math.abs(board.location[2]));
    expect((turn.location[1] - 65.2) / settings.turnDistance).toBeCloseTo(settings.height / settings.distance);
  });

  it("rises and pulls back into a minigame, still aimed at the same point", () => {
    const shot = viewShot([0, 64, 0], 180, settings, "board");
    const out = zoomOutShot(shot, [0, 64.5, 0]);
    expect(out.facing).toEqual([0, 64.5, 0]);
    expect(out.location[1]).toBeGreaterThan(shot.location[1] + 5);
    expect(out.location[2]).toBeGreaterThan(shot.location[2]);
  });

  it("works out yaws and turns", () => {
    expect(yawToward(0, 0, 0, 5)).toBeCloseTo(0);
    expect(yawToward(0, 0, -5, 0)).toBeCloseTo(90);
    expect(yawToward(0, 0, 0, -5)).toBeCloseTo(180);
    expect(normal(-90)).toBe(270);
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
    // Up and to the south: yaw 0, pitched up (below 0) by 45 degrees.
    const look = lookInto({ x: 0, y: 64, z: 0 }, [0, 67, 3]);
    expect(look.y).toBeCloseTo(0);
    expect(look.x).toBeCloseTo(-45);
  });

  it("looks across the board's longer way when the map doesn't say", () => {
    // The test board is square: across x, seen from the south looking north.
    expect(autoDirection(testSpaces([0, 64, 0], 6))).toBeCloseTo(180);
    const long = testSpaces([0, 64, 0], 6).map((space) => ({ at: [space.at[0] / 3, space.at[1], space.at[2] * 2] as [number, number, number] }));
    expect(autoDirection(long)).toBeCloseTo(90);
  });

  it("reads the map's settings, fixed and across the board unless it says", () => {
    const defaults = Object.fromEntries(Object.entries(config.map.settings).map(([key, setting]) => [key, setting.default]));
    const read = (key: string) => defaults[key] as number;
    const settings = cameraSettings(read);
    expect(settings.turns).toBe(false);
    expect(settings.direction).toBeUndefined();
    expect(settings.ease).toBe(1);
    expect(cameraSettings((key) => (key === "boardCameraDirection" ? 90 : key === "boardCameraTurns" ? 1 : read(key)))).toMatchObject({ turns: true, direction: 90 });
    for (const setting of Object.values(config.map.settings)) {
      expect(setting.default).toBeGreaterThanOrEqual(setting.min);
      expect(setting.default).toBeLessThanOrEqual(setting.max);
    }
  });
});

describe("the board camera", () => {
  let scope: Scope;
  let camera: BoardCamera;
  let alex: FakePlayer;
  let sam: FakePlayer;
  let engaged: boolean;
  let settings: BoardCameraSettings;

  beforeEach(() => {
    world.reset();
    system.reset();
    scope = new Scope("test");
    alex = world.join("Alex");
    sam = world.join("Sam");
    alex.location = { x: 10, y: 64, z: 20 };
    engaged = true;
    settings = { ...DEFAULT_BOARD_CAMERA, direction: 180 };
    camera = new BoardCamera({ scope, watchers: () => [alex, sam] as never, settings: () => settings, engaged: () => engaged, focus: () => alex as never });
  });

  afterEach(() => scope.dispose());

  it("shows everyone the board view on the focus, following them", async () => {
    await ticks(1);
    expect(sam.camera.view?.location?.z).toBeCloseTo(20 + settings.distance);
    expect(sam.camera.view?.rotation).toEqual({ x: settings.pitch, y: 180 });
    expect(sam.camera.fovs.at(-1)).toBe(settings.fov);
    alex.location = { x: 14, y: 64, z: 20 };
    await ticks(3);
    expect(sam.camera.view?.location?.x).toBeCloseTo(14);
  });

  it("zooms in for the turn shot, the player turned to face it, and out again", async () => {
    await ticks(1);
    camera.turnShot(alex as never);
    // Looking north: they turn south, to the camera, and look up into it from their eyes.
    expect(alex.getRotation().y).toBeCloseTo(0);
    const shot = viewShot([10, 64, 20], 180, settings, "turn");
    const up = (Math.atan2(shot.location[1] - (64 + 1.62), settings.turnDistance) * 180) / Math.PI;
    expect(alex.getRotation().x).toBeCloseTo(-up);
    expect(alex.getRotation().x).toBeLessThan(0);
    await ticks(1);
    expect(sam.camera.view?.location?.z).toBeCloseTo(20 + settings.turnDistance);
    expect(sam.camera.fovs.at(-1)).toBe(settings.turnFov);
    camera.boardShot();
    await ticks(1);
    expect(sam.camera.view?.location?.z).toBeCloseTo(20 + settings.distance);
  });

  it("waits while another shot has the camera, and takes it back after", async () => {
    await ticks(1);
    camera.take();
    alex.camera.setCamera("minecraft:free", { location: { x: 0, y: 100, z: 0 } });
    alex.location = { x: 30, y: 64, z: 20 };
    await ticks(4);
    expect(alex.camera.view?.location).toEqual({ x: 0, y: 100, z: 0 });
    expect(alex.camera.fovs.at(-1)).toBeUndefined();
    expect(camera.giveBack()).toBe(true);
    await ticks(1);
    expect(alex.camera.view?.location?.x).toBeCloseTo(30);
  });

  it("leaves the camera alone outside the board game, and comes back from a minigame on its own", async () => {
    engaged = false;
    await ticks(3);
    expect(alex.camera.view).toBeUndefined();
    expect(camera.giveBack()).toBe(false);
    camera.take();
    engaged = true;
    await ticks(1);
    // A shot that had it before the minigame is gone with it.
    expect(alex.camera.view?.location?.z).toBeCloseTo(20 + settings.distance);
  });

  it("turns with the path when the map says so", async () => {
    settings = { ...settings, turns: true, direction: undefined };
    alex.rotation = { x: 0, y: 90 };
    await ticks(1);
    expect(alex.camera.view?.rotation?.y).toBeCloseTo(90);
    alex.rotation = { x: 0, y: 180 };
    await ticks(4);
    const yaw = alex.camera.view?.rotation?.y ?? 0;
    // Turning, a few degrees a tick.
    expect(yaw).toBeGreaterThan(90);
    expect(yaw).toBeLessThan(180);
    await ticks(30);
    expect(alex.camera.view?.rotation?.y).toBeCloseTo(180);
  });

  it("rises from the board into a minigame", async () => {
    await ticks(1);
    const before = alex.camera.view?.location?.y ?? 0;
    camera.zoomOut(3);
    expect(alex.camera.view?.location?.y).toBeGreaterThan(before + 5);
  });
});

describe("the board's controls", () => {
  it("never jump on the board, but jump for the roll", () => {
    world.reset();
    const alex = world.join("Alex");
    hold(alex as never);
    expect(alex.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Jump)).toBe(false);
    expect(alex.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Camera)).toBe(true);
    lock(alex as never, true);
    expect(alex.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Jump)).toBe(true);
    lock(alex as never);
    expect(alex.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Jump)).toBe(false);
    // Sent again after a minigame, the locks stay as they were.
    resendLocks(alex as never);
    expect(alex.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Jump)).toBe(false);
    expect(alex.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Camera)).toBe(false);
  });

  it("step the item panel with A and D only", () => {
    expect(sidewaysOf({ x: 0, y: 1 })).toBe(0);
    expect(sidewaysOf({ x: 0, y: -1 })).toBe(0);
    expect(Math.sign(-sidewaysOf({ x: RIGHT_X, y: 0 }))).toBe(1);
    expect(Math.sign(-sidewaysOf({ x: -RIGHT_X, y: 0.9 }))).toBe(-1);
  });
});
