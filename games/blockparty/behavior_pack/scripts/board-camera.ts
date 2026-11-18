// The board's own camera (docs/plans/block-party-ui.md, "Cameras"): whenever nobody else's shot is
// up, everyone watches the player whose turn it is through it.
//   - The board view: behind the player and above, in one of two modes (a per-map setting): fixed,
//     the default (it follows the player but always looks the same way), or turning (it stays
//     behind the player as the path turns). It follows their walk too.
//   - The turn shot: the board view zoomed in (closer, a narrower field of view), eased both ways,
//     while their board menu is up; they turn to face it.
//   - Another shot takes the camera (an NPC's, Board's view of the whole board: stage.ts shot()) and
//     gives it back (stage.ts clear()), and the board view eases back in.
//   - Into a minigame: the camera rises and pulls back from the board, still aimed at the same point.
// Every distance, angle and field of view is a per-map setting (game.config.ts, map.settings: the
// map editor's Game settings tool, in both editors). The pure parts are exported for the tests.
import { EasingType, type Entity, type Player } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import type { Vec3 } from "./board.ts";
import { boardOverview } from "./board-view.ts";

export interface BoardCameraSettings {
  /** The board view turns as the path turns (else it always looks the same way). */
  turns: boolean;
  /** Which way a fixed board view looks (yaw: 0 south, 90 west, 180 north, 270 east); undefined: the side that shows the board's longer way across. */
  direction?: number;
  /** How far behind the player, and how high over their feet. */
  distance: number;
  height: number;
  /** How far it looks down, in degrees. */
  pitch: number;
  /** Its field of view, in degrees. */
  fov: number;
  /** The turn shot: how far from the player, and its field of view. */
  turnDistance: number;
  turnFov: number;
  /** Seconds a move between shots eases over. */
  ease: number;
}

export const DEFAULT_BOARD_CAMERA: BoardCameraSettings = { turns: false, distance: 10, height: 7, pitch: 35, fov: 70, turnDistance: 4, turnFov: 50, ease: 1 };

/** The per-map settings' keys (game.config.ts map.settings) and how each makes a camera setting. */
export const CAMERA_SETTING_KEYS = {
  turns: "boardCameraTurns",
  direction: "boardCameraDirection",
  distance: "boardCameraDistance",
  height: "boardCameraHeight",
  pitch: "boardCameraPitch",
  fov: "boardCameraFov",
  turnDistance: "turnCameraDistance",
  turnFov: "turnCameraFov",
  ease: "boardCameraEase",
} as const;

/** The camera settings from a map's numbers (`read` gives a setting's value by key, the default where the map has none). */
export function cameraSettings(read: (key: string) => number): BoardCameraSettings {
  const k = CAMERA_SETTING_KEYS;
  const direction = read(k.direction);
  return {
    turns: read(k.turns) === 1,
    ...(direction >= 0 ? { direction } : {}),
    distance: read(k.distance),
    height: read(k.height),
    pitch: read(k.pitch),
    fov: read(k.fov),
    turnDistance: read(k.turnDistance),
    turnFov: read(k.turnFov),
    // Tenths of a second in the map.
    ease: read(k.ease) / 10,
  };
}

/** The yaw that looks at the board the way Board's view does: across its longer way. */
export function autoDirection(spaces: readonly { at: Vec3 }[]): number {
  const overview = boardOverview(spaces);
  if (!overview?.facing) return 180;
  const [lx, , lz] = overview.location;
  const [fx, , fz] = overview.facing;
  return yawToward(lx, lz, fx, fz);
}

/** The yaw looking from (x1, z1) toward (x2, z2): 0 is south (+z), 90 west (-x). */
export function yawToward(x1: number, z1: number, x2: number, z2: number): number {
  return normal((Math.atan2(-(x2 - x1), z2 - z1) * 180) / Math.PI);
}

/** A yaw between 0 and 360. */
export function normal(yaw: number): number {
  return ((yaw % 360) + 360) % 360;
}

/** The shortest turn from `from` to `to`, in degrees (-180 to 180). */
export function turnBetween(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** A camera shot: where it is and which way it looks. */
export interface CameraShot {
  location: Vec3;
  yaw: number;
  pitch: number;
}

/**
 * The board view (or, zoomed, the turn shot) of a player standing at `at`, the camera looking along
 * `yaw`: behind them by the distance, up by the height, looking down by the pitch. The turn shot is
 * as much closer as its distance is, the same angle.
 */
export function viewShot(at: Vec3, yaw: number, settings: BoardCameraSettings, zoom: "board" | "turn"): CameraShot {
  const share = zoom === "turn" ? settings.turnDistance / Math.max(1, settings.distance) : 1;
  const back = settings.distance * share;
  const up = settings.height * share;
  const rad = (yaw * Math.PI) / 180;
  // Yaw 0 looks south (+z): the camera stands north of the player.
  const forward = [-Math.sin(rad), Math.cos(rad)];
  // Aimed at the chest in the turn shot, at the feet's middle in the board view.
  const lift = zoom === "turn" ? 1.2 : 0.5;
  return { location: [at[0] - forward[0] * back, at[1] + lift + up, at[2] - forward[1] * back], yaw: normal(yaw), pitch: settings.pitch };
}

/** The rotation that looks from `eye` straight at `point` (pitch: below 0 looks up). */
export function lookInto(eye: { x: number; y: number; z: number }, point: Vec3): { x: number; y: number } {
  const flat = Math.hypot(point[0] - eye.x, point[2] - eye.z);
  const pitch = -(Math.atan2(point[1] - eye.y, flat) * 180) / Math.PI;
  return { x: Math.max(-89, Math.min(89, pitch)), y: yawToward(eye.x, eye.z, point[0], point[2]) };
}

/** Into a minigame: from `shot`, risen and pulled back along its line to `point`, still aimed at it. */
export function zoomOutShot(shot: CameraShot, point: Vec3, rise = 10, back = 1.6): { location: Vec3; facing: Vec3 } {
  const [x, y, z] = shot.location;
  return { location: [point[0] + (x - point[0]) * (1 + back), y + rise + (y - point[1]) * back, point[2] + (z - point[2]) * (1 + back)], facing: point };
}

export interface BoardCameraHost {
  scope: Scope;
  /** Everyone who watches the board. */
  watchers(): Player[];
  settings(): BoardCameraSettings;
  /** Whether the board's camera is the game's now (the board game on, not in a minigame or the pre-game). */
  engaged(): boolean;
  /** The piece it watches: the player whose turn it is (or was last). */
  focus(): Entity | undefined;
}

/** Ticks between the board view's moves while it follows (each eased over the gap, so it glides). */
const FOLLOW_EVERY = 2;
/** How far a turning board view turns in a tick at most, in degrees (a corner pans). */
const TURN_RATE = 6;

export class BoardCamera {
  private readonly host: BoardCameraHost;
  private zoom: "board" | "turn" = "board";
  /** Another shot has the camera (until it's given back). */
  private taken = false;
  /** The next move eases over the settings' ease time (a new shot), not the follow's glide. */
  private fresh = true;
  private wasEngaged = false;
  private yaw: number | undefined;
  private last: CameraShot | undefined;
  private tick = 0;

  constructor(host: BoardCameraHost) {
    this.host = host;
    host.scope.interval(() => this.follow(), 1);
  }

  /** Whether the board's camera is the game's now (a walk then leaves the camera to it). */
  get active(): boolean {
    return this.host.engaged();
  }

  /** The shot on screen now (the board view's), if it's up. */
  get shot(): CameraShot | undefined {
    return this.wasEngaged && !this.taken ? this.last : undefined;
  }

  /** The turn shot on `body`: eased in, and they turn to face it, looking up into it (their keys locked: spike.ts, keepControls). */
  turnShot(body: Entity): void {
    this.zoom = "turn";
    this.fresh = true;
    const yaw = this.yawFor(body);
    try {
      const at = body.location;
      const shot = viewShot([at.x, at.y, at.z], yaw, this.host.settings(), "turn");
      body.teleport(at, { rotation: lookInto(body.getHeadLocation(), shot.location) });
    } catch {
      // gone
    }
  }

  /** Back out to the board view (the roll's done, the walk follows). */
  boardShot(): void {
    if (this.zoom === "board") return;
    this.zoom = "board";
    this.fresh = true;
  }

  /** Another shot takes the camera: the board view waits, and the field of view goes back to the player's own. */
  take(): void {
    if (this.taken) return;
    this.taken = true;
    this.setFov(undefined, 0);
  }

  /** The other shot is done: true when the board view takes over again (eased in), false when the board's camera isn't the game's now. */
  giveBack(): boolean {
    this.taken = false;
    this.fresh = true;
    return this.host.engaged();
  }

  /** Into a minigame: the camera rises and pulls back from the board view, still aimed at the same point, over `seconds`. */
  zoomOut(seconds: number): void {
    const shot = this.last;
    const body = this.host.focus();
    if (!shot || !body?.isValid) return;
    const at = body.location;
    const out = zoomOutShot(shot, [at.x, at.y + 0.5, at.z]);
    for (const watcher of this.host.watchers()) {
      try {
        watcher.camera.setCamera("minecraft:free", { location: vec(out.location), facingLocation: vec(out.facing), easeOptions: { easeTime: seconds, easeType: EasingType.InOutSine } });
      } catch {
        // gone
      }
    }
  }

  /** Which way the camera looks at `body` now: the fixed direction, or (turning) behind them as they face. */
  private yawFor(body: Entity): number {
    const settings = this.host.settings();
    if (!settings.turns) return settings.direction ?? 180;
    return this.yaw ?? body.getRotation().y;
  }

  /** Each tick: while it's the game's camera and nobody else's shot is up, the board view follows the focus. */
  private follow(): void {
    const engaged = this.host.engaged();
    if (!engaged) {
      if (this.wasEngaged) {
        // A minigame or the pre-game has the camera now; next time it eases back in.
        this.wasEngaged = false;
        this.fresh = true;
        this.zoom = "board";
        this.setFov(undefined, 0);
      }
      return;
    }
    if (!this.wasEngaged) {
      // Back from a minigame (or the pre-game): whatever shot had the camera before is gone.
      this.taken = false;
      this.fresh = true;
    }
    this.wasEngaged = true;
    if (this.taken) return;
    this.tick++;
    if (!this.fresh && this.tick % FOLLOW_EVERY !== 0) return;
    const body = this.host.focus();
    if (!body?.isValid) return;
    const settings = this.host.settings();
    let yaw: number;
    if (settings.turns) {
      // Behind the piece, turning toward its facing at most TURN_RATE a tick (the turn shot keeps where it was).
      const facing = body.getRotation().y;
      this.yaw ??= facing;
      if (this.zoom === "board") this.yaw = normal(this.yaw + Math.max(-TURN_RATE * FOLLOW_EVERY, Math.min(TURN_RATE * FOLLOW_EVERY, turnBetween(this.yaw, facing))));
      yaw = this.yaw;
    } else yaw = settings.direction ?? 180;
    const at = body.location;
    const shot = viewShot([at.x, at.y, at.z], yaw, settings, this.zoom);
    const last = this.last;
    const moved = !last || Math.hypot(shot.location[0] - last.location[0], shot.location[1] - last.location[1], shot.location[2] - last.location[2]) > 0.02 || Math.abs(turnBetween(last.yaw, shot.yaw)) > 0.1 || last.pitch !== shot.pitch;
    if (!moved && !this.fresh) return;
    const ease = this.fresh ? { easeTime: Math.max(0.05, settings.ease), easeType: EasingType.InOutSine } : { easeTime: (FOLLOW_EVERY + 1) / 20, easeType: EasingType.Linear };
    for (const watcher of this.host.watchers()) {
      try {
        watcher.camera.setCamera("minecraft:free", { location: vec(shot.location), rotation: { x: shot.pitch, y: shot.yaw }, easeOptions: ease });
      } catch (error) {
        log.warn(`blockparty: the board camera failed: ${describeError(error)}`);
      }
    }
    if (this.fresh) this.setFov(this.zoom === "turn" ? settings.turnFov : settings.fov, settings.ease);
    this.fresh = false;
    this.last = shot;
  }

  /** Everyone's field of view (undefined: their own again), eased. */
  private setFov(fov: number | undefined, seconds: number): void {
    for (const watcher of this.host.watchers()) {
      try {
        const easeOptions = { easeTime: Math.max(0.05, seconds), easeType: EasingType.InOutSine };
        watcher.camera.setFov(fov === undefined ? { easeOptions } : { fov, easeOptions });
      } catch {
        // gone, or a client that can't
      }
    }
  }
}

const vec = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });
