// The spike's pieces: each player is their own piece on the test board, walked from space to space
// by the script while everyone watches through the scripted camera (the plan's "Pieces").
//
// The user's first look settled the way: the player, their walking locked, pushed each tick
// (applyKnockback toward the next point). Their own client moves them, so vanilla's walk plays and
// the camera stays smooth. Teleporting each tick, gliding an invisible mount and a stand-in figure
// all stuttered (20 stops a second), and a jump threw the player off the mount, so those are gone.
//
// What this pass adds on top of the push:
//   - facing: setRotation doesn't turn a player on their own client, so a turn is a teleport to
//     where the player already is, with the new facing, once at each corner (or spread over a few
//     ticks, the "Turn over" setting). A player's teleport can't keep their velocity
//     (keepVelocity throws "not supported for player teleportation"), so the next push gets them
//     going again;
//   - landing on the spot: the push steers back toward the path every tick (a pull toward where the
//     piece should be, on top of the walking speed), and after the last point it settles onto the
//     spot with smaller pushes; only a piece still more than SNAP_OVER off is teleported there.
// A label (blockparty:label, an invisible entity with the name always showing) is kept over each
// piece, since Bedrock never shows players their own name tag, and the player's own tag can be
// hidden so the others don't see two.
import { EasingType, InputPermissionCategory, system, world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { along, pathOf, route, standAt, type Space, type Vec3 } from "./board.ts";

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
  /** Ticks a turn is spread over, one facing teleport a tick (1: a snap at the corner). */
  turnTicks: number;
  /** A label with the name over the piece. */
  label: boolean;
  /** The player's own name tag hidden (the label shows the name instead). */
  hideTag: boolean;
  /** Where the label floats, in blocks over the player's feet. */
  labelHeight: number;
}

export const DEFAULT_SETTINGS: PieceSettings = { camera: "chase", speed: 8, turnTicks: 1, label: true, hideTag: true, labelHeight: 1.5 };

/** applyKnockback's horizontal speed is 0.4 times the force's length (docs/spike-results.md, "Knockback"). */
const KNOCKBACK_SPEED = 0.4;
/** How much of the gap to where the piece should be is closed each tick, on top of the walking speed. */
const PULL = 0.25;
/** The fastest push, as a share of the walking speed. */
const MOST = 1.6;
/** Ticks the piece gets to settle onto its spot after the last point. */
const SETTLE_TICKS = 16;
/** Close enough to the spot: the settling stops. */
const SETTLED = 0.08;
/** Further off than this after settling, and the piece is teleported onto its spot. */
const SNAP_OVER = 0.3;
/** A change of direction bigger than this (degrees) is a turn. */
const TURN_OVER = 3;
const CHASE_EVERY = 2;

interface PieceState {
  space: number;
  corner: number;
  walking: boolean;
  label?: { entity: Entity; height: number };
}

const vec = (v: Vec3): Vector3 => ({ x: v[0], y: v[1], z: v[2] });

/** What a piece's host gives it: the board, everyone watching, and each player's settings. */
export interface PiecesHost {
  spaces: () => readonly Space[];
  settings: (player: Player) => PieceSettings;
  /** Everyone who watches a walk through its camera. */
  watchers: () => Player[];
  /** Where the Watch camera stands. */
  overview: () => Vec3;
  /** Told when a walk ends, to the walker: what happened, for the chat. */
  report: (player: Player, text: string) => void;
}

export class Pieces {
  private readonly states = new Map<string, PieceState>();
  private nextCorner = 0;

  constructor(
    private readonly scope: Scope,
    private readonly host: PiecesHost,
  ) {
    scope.interval(() => this.keepLabels(), 1);
    scope.add(() => this.removeAll());
  }

  private state(player: Player): PieceState {
    const key = player.name.toLowerCase();
    let state = this.states.get(key);
    if (!state) {
      state = { space: 0, corner: this.nextCorner++ % 4, walking: false };
      this.states.set(key, state);
    }
    return state;
  }

  isWalking(player: Player): boolean {
    return this.state(player).walking;
  }

  /** Puts the player on their piece's space (Start at first), facing south, with their label. */
  place(player: Player): void {
    const state = this.state(player);
    try {
      player.teleport(vec(standAt(this.host.spaces()[state.space], state.corner)), { rotation: { x: 0, y: 180 } });
    } catch (error) {
      log.warn(`blockparty: placing ${player.name}'s piece failed: ${describeError(error)}`);
    }
    this.applyLabel(player, state, this.host.settings(player));
  }

  /** Back to Start. */
  reset(player: Player): void {
    this.state(player).space = 0;
    this.place(player);
  }

  /** Takes the label away and gives the player back their movement and name tag. */
  release(player: Player): void {
    this.removeLabel(this.state(player));
    unlock(player);
    player.nameTag = player.name;
  }

  /** A player left: their label goes (their place on the board is kept for a rejoin). */
  forget(name: string): void {
    const state = this.states.get(name.toLowerCase());
    if (!state) return;
    this.removeLabel(state);
    state.walking = false;
  }

  /** Walks the player's piece `steps` spaces ahead. Resolves when it has landed. */
  async walk(player: Player, steps: number): Promise<void> {
    const state = this.state(player);
    if (state.walking) return;
    const settings = this.host.settings(player);
    const spaces = this.host.spaces();
    const passed = route(spaces, state.space, steps);
    const landing = passed[passed.length - 1];
    const end = standAt(landing, state.corner);
    const here = player.location;
    const path = pathOf([[here.x, here.y, here.z], ...passed.slice(0, -1).map((space) => space.at), end]);
    state.walking = true;
    const startedAt = system.currentTick;
    let turns = 0;
    let worstLag = 0;
    try {
      lock(player);
      if (settings.camera === "watch") this.watchCamera(player);
      const perTick = settings.speed / 20;
      const turnTicks = Math.max(1, Math.round(settings.turnTicks));
      let traveled = 0;
      let tick = 0;
      let facing = player.getRotation().y;
      let turn: { from: number; to: number; step: number } | undefined;
      while (traveled < path.length && !this.scope.disposed && player.isValid) {
        traveled = Math.min(path.length, traveled + perTick);
        const { point, yaw } = along(path, traveled);
        if (!turn && Math.abs(angleGap(facing, yaw)) > TURN_OVER) {
          turn = { from: facing, to: yaw, step: 0 };
          turns++;
        }
        if (turn) {
          turn.step++;
          const share = Math.min(1, turn.step / turnTicks);
          facing = turn.from + angleGap(turn.from, turn.to) * share;
          this.face(player, facing);
          if (share >= 1) turn = undefined;
        }
        const rad = (yaw * Math.PI) / 180;
        this.push(player, point, { x: -Math.sin(rad) * perTick, z: Math.cos(rad) * perTick }, perTick);
        worstLag = Math.max(worstLag, Math.hypot(player.location.x - point[0], player.location.z - point[2]));
        if (settings.camera === "chase" && tick % CHASE_EVERY === 0) this.chaseCamera(path, traveled, yaw);
        tick++;
        await this.scope.wait(1);
      }
      if (!player.isValid || this.scope.disposed) return;
      let settleTicks = 0;
      for (; settleTicks < SETTLE_TICKS; settleTicks++) {
        const at = player.location;
        if (Math.hypot(end[0] - at.x, end[2] - at.z) < SETTLED) break;
        this.push(player, end, { x: 0, z: 0 }, perTick, 0.5);
        await this.scope.wait(1);
        if (!player.isValid || this.scope.disposed) return;
      }
      this.stop(player);
      const at = player.location;
      const miss = Math.hypot(at.x - end[0], at.z - end[2]);
      const snapped = miss > SNAP_OVER;
      if (snapped) player.teleport(vec(end), { rotation: { x: 0, y: facing } });
      state.space = landing.index;
      const seconds = ((system.currentTick - startedAt) / 20).toFixed(1);
      this.host.report(
        player,
        `Walked ${steps} to space ${landing.index + 1} (${landing.type}) in ${seconds} s, ${path.length.toFixed(1)} blocks, ${turns} turns over ${turnTicks} ticks; at most ${worstLag.toFixed(2)} off the path; settled in ${settleTicks} ticks, ${miss.toFixed(2)} off the spot${snapped ? " (teleported onto it)" : ""}.`,
      );
      await this.scope.wait(20);
      if (settings.camera !== "none") for (const watcher of this.host.watchers()) watcher.camera.clear();
    } catch (error) {
      log.warn(`blockparty: ${player.name}'s walk failed: ${describeError(error)}`);
      this.host.report(player, `The walk failed: ${describeError(error)}`);
    } finally {
      state.walking = false;
      if (player.isValid) unlock(player);
    }
  }

  /**
   * One tick's push: the walking speed along the path (`ahead`, blocks this tick) plus a pull toward
   * where the piece should be now, capped at MOST times the walking speed.
   */
  private push(player: Player, target: Vec3, ahead: { x: number; z: number }, perTick: number, pull = PULL): void {
    try {
      const here = player.location;
      let dx = ahead.x + (target[0] - here.x) * pull;
      let dz = ahead.z + (target[2] - here.z) * pull;
      const length = Math.hypot(dx, dz);
      const most = perTick * MOST;
      if (length > most) {
        dx *= most / length;
        dz *= most / length;
      }
      player.applyKnockback({ x: dx / KNOCKBACK_SPEED, z: dz / KNOCKBACK_SPEED }, 0);
    } catch (error) {
      log.warn(`blockparty: pushing a piece failed: ${describeError(error)}`);
    }
  }

  /** Stops the piece where it is (a push of nothing takes its speed away). */
  private stop(player: Player): void {
    try {
      player.applyKnockback({ x: 0, z: 0 }, 0);
    } catch {
      // gone
    }
  }

  /** Turns the player to `yaw` on their own client: a teleport to where they are (it stops them; the next push goes on). */
  private face(player: Player, yaw: number): void {
    try {
      player.teleport(player.location, { rotation: { x: 0, y: yaw } });
    } catch (error) {
      log.warn(`blockparty: turning a piece failed: ${describeError(error)}`);
    }
  }

  /** The chase camera, for everyone: behind the piece and above, looking a little ahead. */
  private chaseCamera(path: ReturnType<typeof pathOf>, traveled: number, yaw: number): void {
    const { point } = along(path, traveled);
    const ahead = along(path, traveled + 9).point;
    const rad = (yaw * Math.PI) / 180;
    const back = { x: Math.sin(rad) * 7, z: -Math.cos(rad) * 7 };
    const location = { x: point[0] + back.x, y: point[1] + 4.5, z: point[2] + back.z };
    for (const watcher of this.host.watchers()) {
      try {
        watcher.camera.setCamera("minecraft:free", { location, facingLocation: { x: ahead[0], y: ahead[1] + 1, z: ahead[2] }, easeOptions: { easeTime: 0.15, easeType: EasingType.Linear } });
      } catch {
        // gone
      }
    }
  }

  /** The Watch camera: a fixed spot over the board, facing the moving piece. */
  private watchCamera(walker: Player): void {
    const at = this.host.overview();
    for (const watcher of this.host.watchers()) {
      try {
        watcher.camera.setCamera("minecraft:free", { location: vec(at), facingEntity: walker, easeOptions: { easeTime: 0.6, easeType: EasingType.InOutSine } });
      } catch (error) {
        this.host.report(watcher, `The Watch camera failed: ${describeError(error)}`);
      }
    }
  }

  /** The label over the piece, and the player's own tag. */
  private applyLabel(player: Player, state: PieceState, settings: PieceSettings): void {
    if (!settings.label) {
      this.removeLabel(state);
    } else if (!state.label?.entity.isValid) {
      const at = player.location;
      const entity = player.dimension.spawnEntity("blockparty:label", { x: at.x, y: at.y + settings.labelHeight, z: at.z });
      entity.nameTag = player.name;
      state.label = { entity, height: settings.labelHeight };
    } else {
      state.label.height = settings.labelHeight;
    }
    player.nameTag = settings.hideTag ? "" : player.name;
  }

  /** Keeps every label over its player's head. */
  private keepLabels(): void {
    for (const player of world.getAllPlayers()) {
      const label = this.states.get(player.name.toLowerCase())?.label;
      if (!label?.entity.isValid) continue;
      try {
        const at = player.location;
        label.entity.teleport({ x: at.x, y: at.y + label.height, z: at.z });
      } catch {
        // gone
      }
    }
  }

  /** The settings changed: puts the piece down again with them. */
  refresh(player: Player): void {
    if (!this.state(player).walking) this.place(player);
  }

  private removeLabel(state: PieceState): void {
    try {
      if (state.label?.entity.isValid) state.label.entity.remove();
    } catch {
      // gone
    }
    state.label = undefined;
  }

  private removeAll(): void {
    for (const state of this.states.values()) this.removeLabel(state);
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

/** The signed turn from `from` to `to`, in degrees, the short way round (-180 to 180). */
export function angleGap(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
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
