// The spike's pieces: each player is their own piece on the test board, walked from space to space
// by the script while everyone watches through the scripted camera (the plan's "Pieces").
//
// The user's looks settled the way: the player, their walking locked, pushed each tick
// (applyKnockback). Their own client moves them, so vanilla's walk plays and the camera stays smooth.
// Teleporting each tick, gliding an invisible mount and a stand-in figure all stuttered (20 stops a
// second), a jump threw the player off the mount, and slowing down into corners looked worse than
// walking on at one speed, so the walk is:
//   - one speed all the way: each tick a push along the leg the player is on that takes them a
//     tick's step from the speed they have (a push keeps part of it: walk-follow.ts), plus a pull
//     back onto the leg's line for any drift sideways;
//   - legs followed by where the player is, not by the clock: a leg ends when the player is within
//     a tick's step of its end, so a corner is turned exactly on the space's block middle;
//   - a turn is one teleport onto that middle with the new facing (setRotation doesn't turn a player
//     on their own client, and a player's teleport can't keep their speed, so it costs that one
//     tick); straight on through a space there's no teleport at all;
//   - the chase camera follows the player and turns at most CAMERA_TURN degrees a tick, so it pans
//     round a corner instead of cutting to the new way.
// Over the ground (the user, 2026-11-19: walk off ledges, stairs, jump before a block, and more):
// each leg is planned from the blocks along it when it starts (walk-plan.ts, terrain.ts: slopes up
// and down small steps, jumps up blocks and over gaps, falls off drops, climbs ladders and vines),
// and each tick's push carries the plan's height for that tick (walk-follow.ts): a push sets how fast
// a player goes up (or down: docs/spike-results.md, "A push down"), so pieces never fall or step up
// by themselves. A piece that gets stuck anyway is put at the leg's end. The headless check walks a
// SimulatedPlayer and a bot over the test board with the same code (spike/blockparty/walk.ts).
// No names over the pieces (the user: a label lags behind the player, and a HUD will say whose turn
// it is), and the players' own name tags are hidden on the board.
//
// A bot's piece (bots.ts) is its own body, walked the same way, except that it's set moving at the
// step's speed each tick (a push's overshoot is a player's client's) and has nothing to lock.
import { EasingType, InputPermissionCategory, system, world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { angleGap, distance, route, standAt, yawTo, type Space, type Vec3 } from "./board.ts";
import { isPlayer, moveBot, nameOf, stepBot } from "./bots.ts";
import { eventCue, playCue } from "./sounds.ts";
import { followTick, knockbackFor, legOf, newFollow } from "./walk-follow.ts";
import { planLeg, type LegPlan, type TerrainReader } from "./walk-plan.ts";

/** The sound cue for a piece getting to each space on its walk (the user's Sounds view, Board). */
const WALK_STEP = "walk.step";

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

/** Ticks a leg may run past its length at full speed before the piece is put at its end (something in the way). */
const STUCK_SLACK = 30;
/** How much of the gap to the piece's height the chase camera makes up each move (so a jump doesn't bob it). */
const CAMERA_RISE = 0.3;
/** A change of direction bigger than this (degrees) is a turn. */
const TURN_OVER = 3;
/** The fastest the chase camera turns, in degrees a tick, so a corner pans (a right angle in about 0.75 s). */
const CAMERA_TURN = 6;
const CHASE_EVERY = 2;

interface PieceState {
  space: number;
  corner: number;
  walking: boolean;
  /** Off the board (an arena, a ride) until it's placed again: a player may walk there. */
  off: boolean;
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
  /** The board's ground, as the walk reads it (terrain.ts). */
  terrain: TerrainReader;
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
      state = { space: 0, corner: this.nextCorner++ % 4, walking: false, off: false };
      this.states.set(key, state);
    }
    return state;
  }

  isWalking(body: Entity): boolean {
    return this.state(body).walking;
  }

  /** Whether the body is off the board (released: an arena, a ride). */
  isOff(body: Entity): boolean {
    return this.state(body).off;
  }

  /** Puts the piece on its space (Start at first), facing its next space (the plan: pieces stand facing where they go), a player's name tag hidden. */
  place(body: Entity): void {
    const state = this.state(body);
    state.off = false;
    try {
      const spaces = this.host.spaces();
      const space = spaces[state.space];
      const next = spaces[space.next[0] ?? -1];
      body.teleport(vec(standAt(space, state.corner)), { rotation: { x: 0, y: next ? yawTo(space.at, next.at) : 180 } });
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

  /** Puts the piece on space `index` at once (a die's face: everyone swapping places, going back). */
  moveTo(body: Entity, index: number): void {
    if (index < 0 || index >= this.host.spaces().length) return;
    this.state(body).space = index;
    this.place(body);
  }

  /** Back to Start. */
  reset(body: Entity): void {
    this.state(body).space = 0;
    this.place(body);
  }

  /** Gives a player back their movement and name tag (off the board: an arena, a ride). */
  release(body: Entity): void {
    this.state(body).off = true;
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
   * stretch (the board loop's walks). `reached` hears of each space as the piece gets to it (the
   * moves left counting down), and each plays the walk.step sound cue.
   */
  async walkThrough(player: Entity, passed: readonly Space[], options: { land?: boolean; quiet?: boolean; reached?: (space: Space) => void } = {}): Promise<void> {
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
    const follow = newFollow();
    let stuck = 0;
    let miss = 0;
    try {
      if (isPlayer(player)) lock(player);
      if (settings.camera === "watch") this.watchCamera(player);
      const perTick = settings.speed / 20;
      let facing = player.getRotation().y;
      let cameraYaw: number | undefined;
      let cameraY: number | undefined;
      let tick = 0;
      for (let leg = 0; leg < points.length - 1; leg++) {
        const a = points[leg];
        const b = points[leg + 1];
        const line = legOf(a, b);
        const span = line.span;
        if (span < 0.05) {
          this.reached(passed[leg], options.reached);
          continue;
        }
        const yaw = yawTo(a, b);
        // The first leg's turn, where the player stands (later ones are made on arriving at a corner).
        if (Math.abs(angleGap(facing, yaw)) > TURN_OVER) {
          this.face(player, player.location, yaw);
          facing = yaw;
          turns++;
          await this.scope.wait(1);
        }
        cameraYaw ??= yaw;
        // The ground along the leg, and what the piece does over it (walk-plan.ts).
        const plan = this.planOf(a, b, perTick);
        const budget = Math.ceil(span / perTick) + plan.climbTicks + STUCK_SLACK;
        let ticks = 0;
        for (; ticks < budget && !this.scope.disposed && player.isValid; ticks++) {
          const at = player.location;
          const next = followTick(plan, line, follow, at, perTick);
          if (next.kind === "end") break;
          if (next.kind === "skip") {
            // Fallen off (a jump that missed), or at what nothing gets it over: on to the leg's end.
            ticks = budget;
            break;
          }
          this.push(player, next.want, next.up);
          if (settings.camera === "chase" && tick % CHASE_EVERY === 0) {
            cameraYaw += Math.max(-CAMERA_TURN * CHASE_EVERY, Math.min(CAMERA_TURN * CHASE_EVERY, angleGap(cameraYaw, yaw)));
            cameraY = cameraY === undefined ? at.y : cameraY + (at.y - cameraY) * CAMERA_RISE;
            this.chaseCamera({ x: at.x, y: cameraY, z: at.z }, cameraYaw);
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
        // A corner (or the end): onto the space's block middle, facing the next leg. Straight on, no
        // teleport. Landed, the piece faces its next space (the plan: pieces stand facing where they go).
        const onward = last && land ? this.host.spaces()[landing.next[0] ?? -1] : undefined;
        if (last || stuck > 0 || (next !== undefined && Math.abs(angleGap(yaw, next)) > TURN_OVER)) {
          this.face(player, { x: b[0], y: b[1], z: b[2] }, onward ? yawTo(landing.at, onward.at) : (next ?? facing));
          if (next !== undefined && Math.abs(angleGap(yaw, next)) > TURN_OVER) turns++;
          facing = next ?? facing;
          stuck = 0;
        }
        this.reached(passed[leg], options.reached);
      }
      this.stop(player);
      state.space = landing.index;
      const seconds = ((system.currentTick - startedAt) / 20).toFixed(1);
      if (options.quiet) return;
      this.host.report(player, `Walked ${steps} to space ${landing.index + 1} (${landing.type}) in ${seconds} s, ${length.toFixed(1)} blocks (${(length / ((system.currentTick - startedAt) / 20)).toFixed(1)} a second), ${turns} turns; at most ${follow.drift.toFixed(2)} off a leg's line; ${miss.toFixed(2)} off the spot before it was put on it.`);
      await this.scope.wait(20);
      if (settings.camera !== "none") for (const watcher of this.host.watchers()) watcher.camera.clear();
    } catch (error) {
      log.warn(`blockparty: ${nameOf(player)}'s walk failed: ${describeError(error)}`);
      this.host.report(player, `The walk failed: ${describeError(error)}`);
    } finally {
      // The game holds the player again (spike.ts, keepControls) now the walk is over.
      state.walking = false;
    }
  }

  /** A walk got to `space`: its sound, and whoever's counting. */
  private reached(space: Space | undefined, heard: ((space: Space) => void) | undefined): void {
    if (!space) return;
    playCue(eventCue(WALK_STEP));
    try {
      heard?.(space);
    } catch (error) {
      log.warn(`blockparty: a walk's step failed: ${describeError(error)}`);
    }
  }

  /** The leg's plan over the ground (walk-plan.ts), or a flat one when the ground can't be read. */
  private planOf(a: Vec3, b: Vec3, perTick: number): LegPlan {
    try {
      return planLeg(this.host.terrain, a, b, perTick);
    } catch (error) {
      log.warn(`blockparty: planning a piece's walk failed: ${describeError(error)}`);
      return { span: Math.hypot(b[0] - a[0], b[2] - a[2]), step: Math.max(0.05, Math.hypot(b[0] - a[0], b[2] - a[2])), heights: [a[1], b[1]], air: [false, false], ground: [a[1], b[1]], climbs: [], climbTicks: 0 };
    }
  }

  /**
   * One tick's push: `want` blocks along the ground this tick and `up` blocks up (down when less than
   * 0), worked out from the speed the player has (knockbackFor). A bot is set moving at both.
   */
  private push(player: Entity, want: { x: number; z: number }, up: number): void {
    if (!isPlayer(player)) return moveBot(player, want.x, up, want.z);
    try {
      const push = knockbackFor(want, up, player.getVelocity(), player.isOnGround);
      player.applyKnockback({ x: push.x, z: push.z }, push.strength);
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

/**
 * The player can't walk or turn (their piece is walked for them). `jump`: they can jump too (the
 * roll: the jump hits their die); else a jump only reaches the script (the spike: a jump reaches it
 * with jumping off).
 */
export function lock(player: Player, jump = false): void {
  try {
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, false);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, jump);
  } catch {
    // gone
  }
}

/**
 * On the board between moves (the user: nobody walks the board by themselves): the movement keys
 * don't move the player, but they look round, and jump and sneak are the game's buttons. A jump
 * doesn't jump (the user: picking a button mustn't make the player jump); it still reaches the
 * script.
 */
export function hold(player: Player): void {
  try {
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, false);
    for (const category of [InputPermissionCategory.Movement, InputPermissionCategory.Camera]) {
      player.inputPermissions.setPermissionCategory(category, true);
    }
  } catch {
    // gone
  }
}

/**
 * Sends the player's input locks again as they stand. The user saw a turn's first button press after
 * a minigame really jump, though jumping was off: a client back from a long teleport seems to miss
 * the locks sent while it loads (the next press didn't jump). Jumping flipped and set back makes the
 * server send the whole set again (spike.ts, keepControls, a few times after a minigame).
 */
export function resendLocks(player: Player): void {
  try {
    const jump = player.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Jump);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, !jump);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, jump);
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
