// The spike's pieces: each player is their own piece on the test board, walked from space to space
// by the script while everyone watches through the scripted camera (the plan's "Pieces").
//
// The user's looks settled the way: the player, their walking locked, pushed each tick
// (applyKnockback). Their own client moves them, so vanilla's walk plays and the camera stays smooth.
// Teleporting each tick, gliding an invisible mount and a stand-in figure all stuttered (20 stops a
// second), a jump threw the player off the mount, and slowing down into corners looked worse than
// walking on at one speed, so the walk is:
//   - one speed all the way: each tick a push along the leg the player is on, made a little smaller
//     than asked (a push moves a player about 1.375 times what it asks, measured), plus a pull back
//     onto the leg's line for any drift sideways;
//   - legs followed by where the player is, not by the clock: a leg ends when the player is within
//     a tick's step of its end, so a corner is turned exactly on the space's block middle;
//   - a turn is one teleport onto that middle with the new facing (setRotation doesn't turn a player
//     on their own client, and a player's teleport can't keep their speed, so it costs that one
//     tick); straight on through a space there's no teleport at all;
//   - the chase camera follows the player and turns at most CAMERA_TURN degrees a tick, so it pans
//     round a corner instead of cutting to the new way.
// No names over the pieces (the user: a label lags behind the player, and a HUD will say whose turn
// it is), and the players' own name tags are hidden on the board.
//
// A bot's piece (bots.ts) is its own body, walked the same way, except that it's set moving at the
// step's speed each tick (a push's overshoot is a player's client's) and has nothing to lock.
import { EasingType, InputPermissionCategory, system, world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { angleGap, distance, route, standAt, yawTo, type Space, type Vec3 } from "./board.ts";
import { isPlayer, nameOf, stepBot } from "./bots.ts";

export type WalkCamera = "chase" | "watch" | "none";

export const WALK_CAMERAS: readonly { id: WalkCamera; label: string }[] = [
  { id: "chase", label: "Chase: behind, looking ahead" },
  { id: "watch", label: "Watch: a fixed spot facing the piece" },
  { id: "none", label: "None: your own view" },
];

export interface PieceSettings {
  camera: WalkCamera;
  /** Blocks a second. */
  speed: number;
}

export const DEFAULT_SETTINGS: PieceSettings = { camera: "chase", speed: 8 };

/** applyKnockback's horizontal speed is 0.4 times the force's length (docs/spike-results.md, "Knockback"). */
const KNOCKBACK_SPEED = 0.4;
/** A push moves a player this many times what it asks, once going (0.55 a tick for 0.4, docs/spike-results.md, "Block Party"). */
const PUSH_GAIN = 1.375;
/** How much of the sideways drift off a leg's line is taken back each tick. */
const STEER = 0.4;
/** Ticks a leg may run past its length at full speed before the piece is put at its end (something in the way). */
const STUCK_SLACK = 30;
/** A change of direction bigger than this (degrees) is a turn. */
const TURN_OVER = 3;
/** The fastest the chase camera turns, in degrees a tick, so a corner pans (a right angle in about 0.75 s). */
const CAMERA_TURN = 6;
const CHASE_EVERY = 2;

interface PieceState {
  space: number;
  corner: number;
  walking: boolean;
}

const vec = (v: Vec3): Vector3 => ({ x: v[0], y: v[1], z: v[2] });

/** What a piece's host gives it: the board, everyone watching, and each player's settings. */
export interface PiecesHost {
  spaces: () => readonly Space[];
  settings: (body: Entity) => PieceSettings;
  /** Everyone who watches a walk through its camera. */
  watchers: () => Player[];
  /** Where the Watch camera stands. */
  overview: () => Vec3;
  /** Told when a walk ends, to the walker: what happened, for the chat. */
  report: (body: Entity, text: string) => void;
}

export class Pieces {
  private readonly states = new Map<string, PieceState>();
  private nextCorner = 0;

  constructor(
    private readonly scope: Scope,
    private readonly host: PiecesHost,
  ) {
    scope.add(() => this.removeAll());
  }

  private state(body: Entity): PieceState {
    const key = nameOf(body).toLowerCase();
    let state = this.states.get(key);
    if (!state) {
      state = { space: 0, corner: this.nextCorner++ % 4, walking: false };
      this.states.set(key, state);
    }
    return state;
  }

  isWalking(body: Entity): boolean {
    return this.state(body).walking;
  }

  /** Puts the piece on its space (Start at first), facing south, a player's name tag hidden. */
  place(body: Entity): void {
    const state = this.state(body);
    try {
      body.teleport(vec(standAt(this.host.spaces()[state.space], state.corner)), { rotation: { x: 0, y: 180 } });
      if (isPlayer(body)) body.nameTag = "";
      else body.clearVelocity();
    } catch (error) {
      log.warn(`blockparty: placing ${nameOf(body)}'s piece failed: ${describeError(error)}`);
    }
  }

  /** Where `name`'s piece stands on its space. */
  spotOf(name: string): Vector3 {
    const state = this.states.get(name.toLowerCase());
    return vec(standAt(this.host.spaces()[state?.space ?? 0], state?.corner ?? 0));
  }

  /** Back to Start. */
  reset(body: Entity): void {
    this.state(body).space = 0;
    this.place(body);
  }

  /** Gives a player back their movement and name tag (off the board: an arena, a ride). */
  release(body: Entity): void {
    if (!isPlayer(body)) return;
    unlock(body);
    body.nameTag = body.name;
  }

  /** A player left (their place on the board is kept for a rejoin). */
  forget(name: string): void {
    const state = this.states.get(name.toLowerCase());
    if (state) state.walking = false;
  }

  /** Walks the piece `steps` spaces ahead. Resolves when it has landed. */
  async walk(body: Entity, steps: number): Promise<void> {
    return this.walkThrough(body, route(this.host.spaces(), this.state(body).space, steps));
  }

  /** The space the piece is on (its index). */
  spaceOf(body: Entity): number {
    return this.state(body).space;
  }

  /**
   * Walks the player's piece through `passed`, in order, from where it is. `land`: the last is where
   * it lands (on its corner of the spot), else it stops on that space's middle (at a branch, or the
   * Star) to go on later. `quiet`: no chat report, and the camera is left as it is for the next
   * stretch (the board loop's walks).
   */
  async walkThrough(player: Entity, passed: readonly Space[], options: { land?: boolean; quiet?: boolean } = {}): Promise<void> {
    const state = this.state(player);
    if (state.walking || passed.length === 0) return;
    const land = options.land !== false;
    const steps = passed.length;
    const settings = this.host.settings(player);
    const landing = passed[passed.length - 1];
    const end = land ? standAt(landing, state.corner) : landing.at;
    const here = player.location;
    const points: Vec3[] = [[here.x, here.y, here.z], ...passed.slice(0, -1).map((space) => space.at), end];
    const length = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
    state.walking = true;
    const startedAt = system.currentTick;
    let turns = 0;
    let drift = 0;
    let stuck = 0;
    let miss = 0;
    try {
      if (isPlayer(player)) lock(player);
      if (settings.camera === "watch") this.watchCamera(player);
      const perTick = settings.speed / 20;
      let facing = player.getRotation().y;
      let cameraYaw: number | undefined;
      let tick = 0;
      for (let leg = 0; leg < points.length - 1; leg++) {
        const a = points[leg];
        const b = points[leg + 1];
        const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (span < 0.05) continue;
        const ux = (b[0] - a[0]) / span;
        const uz = (b[2] - a[2]) / span;
        const yaw = yawTo(a, b);
        // The first leg's turn, where the player stands (later ones are made on arriving at a corner).
        if (Math.abs(angleGap(facing, yaw)) > TURN_OVER) {
          this.face(player, player.location, yaw);
          facing = yaw;
          turns++;
          await this.scope.wait(1);
        }
        cameraYaw ??= yaw;
        const budget = Math.ceil(span / perTick) + STUCK_SLACK;
        let ticks = 0;
        for (; ticks < budget && !this.scope.disposed && player.isValid; ticks++) {
          const at = player.location;
          const along = (at.x - a[0]) * ux + (at.z - a[2]) * uz;
          if (span - along <= perTick) break;
          const side = (at.x - a[0]) * -uz + (at.z - a[2]) * ux;
          drift = Math.max(drift, Math.abs(side));
          this.push(player, { x: ux * perTick + uz * side * STEER, z: uz * perTick - ux * side * STEER });
          if (settings.camera === "chase" && tick % CHASE_EVERY === 0) {
            cameraYaw += Math.max(-CAMERA_TURN * CHASE_EVERY, Math.min(CAMERA_TURN * CHASE_EVERY, angleGap(cameraYaw, yaw)));
            this.chaseCamera(at, cameraYaw);
          }
          tick++;
          await this.scope.wait(1);
        }
        if (!player.isValid || this.scope.disposed) return;
        if (ticks >= budget) stuck++;
        const last = leg === points.length - 2;
        const next = last ? undefined : yawTo(b, points[leg + 2]);
        const at = player.location;
        if (last) miss = Math.hypot(at.x - b[0], at.z - b[2]);
        // A corner (or the end): onto the space's block middle, facing the next leg. Straight on, no teleport.
        if (last || stuck > 0 || (next !== undefined && Math.abs(angleGap(yaw, next)) > TURN_OVER)) {
          this.face(player, { x: b[0], y: b[1], z: b[2] }, next ?? facing);
          if (next !== undefined && Math.abs(angleGap(yaw, next)) > TURN_OVER) turns++;
          facing = next ?? facing;
          stuck = 0;
        }
      }
      this.stop(player);
      state.space = landing.index;
      const seconds = ((system.currentTick - startedAt) / 20).toFixed(1);
      if (options.quiet) return;
      this.host.report(player, `Walked ${steps} to space ${landing.index + 1} (${landing.type}) in ${seconds} s, ${length.toFixed(1)} blocks (${(length / ((system.currentTick - startedAt) / 20)).toFixed(1)} a second), ${turns} turns; at most ${drift.toFixed(2)} off a leg's line; ${miss.toFixed(2)} off the spot before it was put on it.`);
      await this.scope.wait(20);
      if (settings.camera !== "none") for (const watcher of this.host.watchers()) watcher.camera.clear();
    } catch (error) {
      log.warn(`blockparty: ${nameOf(player)}'s walk failed: ${describeError(error)}`);
      this.host.report(player, `The walk failed: ${describeError(error)}`);
    } finally {
      state.walking = false;
      if (player.isValid && isPlayer(player)) unlock(player);
    }
  }

  /** One tick's push: `step` blocks this tick (asked for a little less, as a player's pushes overshoot; a bot is set moving at it). */
  private push(player: Entity, step: { x: number; z: number }): void {
    if (!isPlayer(player)) return stepBot(player, step.x, step.z);
    try {
      player.applyKnockback({ x: step.x / PUSH_GAIN / KNOCKBACK_SPEED, z: step.z / PUSH_GAIN / KNOCKBACK_SPEED }, 0);
    } catch (error) {
      log.warn(`blockparty: pushing a piece failed: ${describeError(error)}`);
    }
  }

  /** Stops the piece where it is (a push of nothing takes its speed away). */
  private stop(player: Entity): void {
    if (!isPlayer(player)) return stepBot(player, 0, 0);
    try {
      player.applyKnockback({ x: 0, z: 0 }, 0);
    } catch {
      // gone
    }
  }

  /** Puts the piece at `at` facing `yaw` (a player on their own client): a teleport (it stops them that tick). */
  private face(player: Entity, at: Vector3, yaw: number): void {
    try {
      player.teleport(at, { rotation: { x: 0, y: yaw } });
    } catch (error) {
      log.warn(`blockparty: turning a piece failed: ${describeError(error)}`);
    }
  }

  /** The chase camera, for everyone: behind the piece and above, looking ahead, turned to `yaw`. */
  private chaseCamera(at: Vector3, yaw: number): void {
    const rad = (yaw * Math.PI) / 180;
    const forward = { x: -Math.sin(rad), z: Math.cos(rad) };
    const location = { x: at.x - forward.x * 7, y: at.y + 4.5, z: at.z - forward.z * 7 };
    const facingLocation = { x: at.x + forward.x * 6, y: at.y + 1, z: at.z + forward.z * 6 };
    for (const watcher of this.host.watchers()) {
      try {
        watcher.camera.setCamera("minecraft:free", { location, facingLocation, easeOptions: { easeTime: 0.15, easeType: EasingType.Linear } });
      } catch {
        // gone
      }
    }
  }

  /** The Watch camera: a fixed spot over the board, facing the moving piece. */
  private watchCamera(walker: Entity): void {
    const at = this.host.overview();
    for (const watcher of this.host.watchers()) {
      try {
        watcher.camera.setCamera("minecraft:free", { location: vec(at), facingEntity: walker, easeOptions: { easeTime: 0.6, easeType: EasingType.InOutSine } });
      } catch (error) {
        this.host.report(watcher, `The Watch camera failed: ${describeError(error)}`);
      }
    }
  }

  /** The settings changed: puts the piece down again. */
  refresh(body: Entity): void {
    if (!this.state(body).walking) this.place(body);
  }

  private removeAll(): void {
    for (const player of world.getAllPlayers()) {
      unlock(player);
      try {
        player.nameTag = player.name;
      } catch {
        // gone
      }
    }
  }
}

/** The player can't walk or turn (their piece is walked for them); jumping still reaches the script. */
export function lock(player: Player): void {
  try {
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, false);
  } catch {
    // gone
  }
}

export function unlock(player: Player): void {
  try {
    for (const category of [InputPermissionCategory.Movement, InputPermissionCategory.LateralMovement, InputPermissionCategory.Camera, InputPermissionCategory.Jump]) {
      player.inputPermissions.setPermissionCategory(category, true);
    }
  } catch {
    // gone
  }
}
