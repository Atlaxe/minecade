// The spike's pieces: each player has one on the test board, walked from space to space by the
// script while everyone watches through the scripted camera (the plan's "Pieces"). Three ways to
// be the piece, each tried with the drivers that suit it:
//   - "player": the player, movement locked, moved each tick by teleport, or pushed each tick
//     (applyKnockback toward the next point, so the client moves itself and vanilla's own walk
//     plays);
//   - "mount": the player riding an invisible mount (blockparty:mount) the script moves, by
//     teleport or by gliding (its velocity set each tick, which clients smooth out);
//   - "stand_in": a player-shaped figure (blockparty:stand_in, Steve's skin) walks instead, by
//     teleport or gliding, while the player waits unseen at its spot.
// Unless the push driver is on (vanilla's walk plays then), the piece plays the pack's own walk
// animation (animation.blockparty.walk) while it moves; on a mount, the stand pose in between
// (the walk and the stand straighten the riding pose's legs). A label (blockparty:label, an
// invisible entity with the name always showing) can ride over each piece, since Bedrock never shows
// players their own name tag, and the player's own tag can be hidden so the others don't see two.
import { EasingType, EffectTypes, EntityAttachPoint, InputPermissionCategory, system, world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { along, pathOf, route, standAt, type Space, type Vec3 } from "./board.ts";

export type PieceMethod = "player" | "mount" | "stand_in";
export type PieceDriver = "teleport" | "push" | "glide";
export type WalkCamera = "chase" | "watch" | "attach" | "none";

export const METHODS: readonly { id: PieceMethod; label: string }[] = [
  { id: "player", label: "The player, moved by script" },
  { id: "mount", label: "The player on an invisible mount" },
  { id: "stand_in", label: "A stand-in figure (Steve)" },
];
export const DRIVERS: readonly { id: PieceDriver; label: string }[] = [
  { id: "teleport", label: "Teleport each tick" },
  { id: "push", label: "Push each tick (the player only)" },
  { id: "glide", label: "Glide: velocity each tick (mount, stand-in)" },
];
export const WALK_CAMERAS: readonly { id: WalkCamera; label: string }[] = [
  { id: "chase", label: "Chase: behind, looking ahead" },
  { id: "watch", label: "Watch: a fixed spot facing the piece" },
  { id: "attach", label: "Attached to the mount or stand-in" },
  { id: "none", label: "None: your own view" },
];

export interface PieceSettings {
  method: PieceMethod;
  driver: PieceDriver;
  camera: WalkCamera;
  /** Blocks a second. */
  speed: number;
  /** The pack's walk animation (off: only what vanilla plays). */
  animation: boolean;
  /** A label with the name over the piece. */
  label: boolean;
  /** The player's own name tag hidden (the label shows the name instead). */
  hideTag: boolean;
  /** How far the mount sits under the space, in blocks (a rider sits higher than they stand). */
  seatDrop: number;
}

export const DEFAULT_SETTINGS: PieceSettings = { method: "player", driver: "teleport", camera: "chase", speed: 8, animation: true, label: true, hideTag: true, seatDrop: 0.5 };

const ANIM_CONTROLLER = "blockparty.piece";
const WALK = "animation.blockparty.walk";
const STAND = "animation.blockparty.stand";
const REST = "animation.blockparty.rest";
/** Where a label rides over a standing player's feet, and over a mount (its second seat says the same). */
const LABEL_HEIGHT = 2.35;
const CHASE_EVERY = 2;

interface PieceState {
  space: number;
  corner: number;
  walking: boolean;
  mount?: Entity;
  standIn?: Entity;
  label?: Entity;
  /** The method the piece's entities were made for. */
  madeFor?: PieceMethod;
}

const vec = (v: Vec3): Vector3 => ({ x: v[0], y: v[1], z: v[2] });
const arr = (v: Vector3): Vec3 => [v.x, v.y, v.z];

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

  /** Whether the player is riding their piece's mount now. */
  riding(player: Player): boolean {
    return !!player.getComponent("minecraft:riding")?.entityRidingOn;
  }

  /** Puts the player's piece on its space (Start at first), made for their settings. */
  place(player: Player): void {
    const state = this.state(player);
    const settings = this.host.settings(player);
    this.remake(player, state, settings);
    const at = standAt(this.host.spaces()[state.space], state.corner);
    this.putAt(player, state, settings, at, 180);
    this.applyLabel(player, state, settings);
  }

  /** Back to Start, with the settings as they are now. */
  reset(player: Player): void {
    const state = this.state(player);
    state.space = 0;
    this.place(player);
  }

  /** Takes the piece away (its mount, stand-in and label) and gives the player back their own body. */
  release(player: Player): void {
    const state = this.state(player);
    this.removeEntities(player, state);
    unlock(player);
    player.nameTag = player.name;
  }

  /** A player left: their mount, stand-in and label go (their place on the board is kept for a rejoin). */
  forget(name: string): void {
    const state = this.states.get(name.toLowerCase());
    if (!state) return;
    for (const entity of [state.mount, state.standIn, state.label]) {
      try {
        if (entity?.isValid) entity.remove();
      } catch {
        // gone
      }
    }
    state.mount = undefined;
    state.standIn = undefined;
    state.label = undefined;
    state.madeFor = undefined;
    state.walking = false;
  }

  /** The entity that is the piece now: the player, their mount or their stand-in. */
  body(player: Player): Entity {
    const state = this.state(player);
    return state.standIn?.isValid ? state.standIn : state.mount?.isValid ? state.mount : player;
  }

  /** Walks the player's piece `steps` spaces ahead. Resolves when it has landed. */
  async walk(player: Player, steps: number): Promise<void> {
    const state = this.state(player);
    if (state.walking) return;
    const settings = this.host.settings(player);
    this.remake(player, state, settings);
    const spaces = this.host.spaces();
    const passed = route(spaces, state.space, steps);
    const landing = passed[passed.length - 1];
    const start = arr(this.body(player).location);
    const points: Vec3[] = [settings.method === "mount" ? raise(start, settings.seatDrop) : start, ...passed.slice(0, -1).map((space) => space.at), standAt(landing, state.corner)];
    const path = pathOf(points);
    const driver = this.driverFor(settings);
    const mover = this.body(player);
    state.walking = true;
    const startedAt = system.currentTick;
    let dismounts = 0;
    try {
      if (settings.method === "player") lock(player);
      if (settings.animation && driver !== "push") this.animate(mover, WALK, player);
      const perTick = settings.speed / 20;
      let traveled = 0;
      let tick = 0;
      let lastYaw = 180;
      if (settings.camera === "watch") this.watchCamera(mover);
      if (settings.camera === "attach") this.attachCamera(mover, player);
      while (traveled < path.length && !this.scope.disposed && player.isValid) {
        traveled = Math.min(path.length, traveled + perTick);
        const { point, yaw } = along(path, traveled);
        lastYaw = yaw;
        const target = settings.method === "mount" ? lower(point, settings.seatDrop) : point;
        this.drive(mover, driver, target, yaw, perTick);
        if (settings.method === "mount" && !this.riding(player)) {
          dismounts++;
          state.mount?.getComponent("minecraft:rideable")?.addRider(player);
        }
        if (settings.camera === "chase" && tick % CHASE_EVERY === 0) this.chaseCamera(path, traveled, yaw);
        tick++;
        await this.scope.wait(1);
      }
      if (!player.isValid || this.scope.disposed) return;
      const end = standAt(landing, state.corner);
      this.putAt(player, state, settings, end, lastYaw);
      state.space = landing.index;
      if (settings.animation && driver !== "push") this.animate(mover, settings.method === "mount" ? STAND : REST, player);
      const seconds = ((system.currentTick - startedAt) / 20).toFixed(1);
      const off = arr(mover.location);
      const miss = Math.hypot(off[0] - end[0], off[2] - end[2]).toFixed(2);
      this.host.report(player, `Walked ${steps} to space ${landing.index + 1} (${landing.type}) in ${seconds} s, ${path.length.toFixed(1)} blocks: ${settings.method}, ${driver}${dismounts > 0 ? `, fell off the mount ${dismounts} times (put back)` : ""}, ${miss} off the spot before the last snap.`);
      await this.scope.wait(20);
      if (settings.camera !== "none") for (const watcher of this.host.watchers()) watcher.camera.clear();
    } catch (error) {
      log.warn(`blockparty: ${player.name}'s walk failed: ${describeError(error)}`);
      this.host.report(player, `The walk failed: ${describeError(error)}`);
    } finally {
      state.walking = false;
      if (player.isValid && settings.method === "player") unlock(player);
    }
  }

  /** The driver a method can use: push is the player's only, glide never the player's. */
  private driverFor(settings: PieceSettings): PieceDriver {
    if (settings.method === "player") return settings.driver === "glide" ? "teleport" : settings.driver;
    return settings.driver === "push" ? "glide" : settings.driver;
  }

  private drive(entity: Entity, driver: PieceDriver, target: Vec3, yaw: number, perTick: number): void {
    try {
      if (driver === "teleport") {
        entity.teleport(vec(target), { rotation: { x: 0, y: yaw } });
      } else if (driver === "push") {
        const here = entity.location;
        let dx = target[0] - here.x;
        let dz = target[2] - here.z;
        const length = Math.hypot(dx, dz);
        const most = perTick * 1.5;
        if (length > most) {
          dx *= most / length;
          dz *= most / length;
        }
        // applyKnockback's horizontal speed is 0.4 times the force's length (docs/spike-results.md, "Knockback").
        entity.applyKnockback({ x: dx / 0.4, z: dz / 0.4 }, 0);
        entity.setRotation({ x: 0, y: yaw });
      } else {
        const here = entity.location;
        entity.clearVelocity();
        entity.applyImpulse({ x: target[0] - here.x, y: target[1] - here.y, z: target[2] - here.z });
        entity.setRotation({ x: 0, y: yaw });
      }
    } catch (error) {
      log.warn(`blockparty: moving a piece failed: ${describeError(error)}`);
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

  /** The Watch camera: a fixed spot over the board, facing the moving piece (does it track it?). */
  private watchCamera(mover: Entity): void {
    const at = this.host.overview();
    for (const watcher of this.host.watchers()) {
      try {
        watcher.camera.setCamera("minecraft:free", { location: vec(at), facingEntity: mover, easeOptions: { easeTime: 0.6, easeType: EasingType.InOutSine } });
      } catch (error) {
        this.host.report(watcher, `The Watch camera failed: ${describeError(error)}`);
      }
    }
  }

  /** The camera attached to the mount or stand-in (attachToEntity takes no players). */
  private attachCamera(mover: Entity, walker: Player): void {
    if (mover.typeId === "minecraft:player") {
      this.host.report(walker, "Attached needs a mount or a stand-in: the player can't take a camera. Using your own view.");
      return;
    }
    for (const watcher of this.host.watchers()) {
      try {
        watcher.camera.attachToEntity({ entity: mover, locator: EntityAttachPoint.Head });
      } catch (error) {
        this.host.report(watcher, `Attaching the camera failed: ${describeError(error)}`);
      }
    }
  }

  private animate(entity: Entity, animation: string, player: Player): void {
    try {
      entity.playAnimation(animation, { controller: ANIM_CONTROLLER, stopExpression: animation === REST ? "q.any_animation_finished" : "0", blendOutTime: 0.1 });
    } catch (error) {
      this.host.report(player, `Playing ${animation} failed: ${describeError(error)}`);
    }
  }

  /** Makes the piece's mount or stand-in for the method (taking down any made for another). */
  private remake(player: Player, state: PieceState, settings: PieceSettings): void {
    const dimension = player.dimension;
    if (state.madeFor !== settings.method) {
      this.removeEntities(player, state, false);
      state.madeFor = settings.method;
    }
    if (settings.method === "mount" && !state.mount?.isValid) {
      state.mount = dimension.spawnEntity("blockparty:mount", vec(lower(arr(player.location), settings.seatDrop)));
    }
    if (settings.method === "stand_in" && !state.standIn?.isValid) {
      state.standIn = dimension.spawnEntity("blockparty:stand_in", player.location);
      state.standIn.nameTag = player.name;
    }
    if (settings.method === "mount" && state.mount?.isValid && !this.riding(player)) {
      const added = state.mount.getComponent("minecraft:rideable")?.addRider(player);
      if (!added) this.host.report(player, "Couldn't put you on the mount.");
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.Dismount, false);
      this.animate(player, STAND, player);
    }
    if (settings.method === "stand_in") {
      player.addEffect(EffectTypes.get("invisibility")!, 20000000, { showParticles: false, amplifier: 0 });
      player.nameTag = "";
    } else {
      player.removeEffect("invisibility");
    }
  }

  /** Puts the piece exactly at `at`, facing `yaw`; the player too, out of sight, behind a stand-in. */
  private putAt(player: Player, state: PieceState, settings: PieceSettings, at: Vec3, yaw: number): void {
    try {
      if (settings.method === "mount" && state.mount?.isValid) {
        state.mount.teleport(vec(lower(at, settings.seatDrop)), { rotation: { x: 0, y: yaw } });
        if (!this.riding(player)) state.mount.getComponent("minecraft:rideable")?.addRider(player);
      } else if (settings.method === "stand_in" && state.standIn?.isValid) {
        state.standIn.teleport(vec(at), { rotation: { x: 0, y: yaw } });
        player.teleport(vec(at), { rotation: { x: 0, y: yaw } });
      } else {
        player.teleport(vec(at), { rotation: { x: 0, y: yaw } });
      }
    } catch (error) {
      log.warn(`blockparty: placing ${player.name}'s piece failed: ${describeError(error)}`);
    }
  }

  /** The label over the piece (on its mount's second seat, else kept over it each tick), and the player's own tag. */
  private applyLabel(player: Player, state: PieceState, settings: PieceSettings): void {
    const wanted = settings.label && settings.method !== "stand_in";
    if (!wanted) {
      if (state.label?.isValid) state.label.remove();
      state.label = undefined;
    } else if (!state.label?.isValid) {
      state.label = player.dimension.spawnEntity("blockparty:label", vec(raise(arr(player.location), LABEL_HEIGHT)));
      state.label.nameTag = player.name;
    }
    if (state.label?.isValid && settings.method === "mount" && state.mount?.isValid) state.mount.getComponent("minecraft:rideable")?.addRider(state.label);
    if (settings.method !== "stand_in") player.nameTag = settings.hideTag ? "" : player.name;
  }

  /** Keeps every label not on a mount over its player's head. */
  private keepLabels(): void {
    for (const player of world.getAllPlayers()) {
      const state = this.states.get(player.name.toLowerCase());
      const label = state?.label;
      if (!label?.isValid || label.getComponent("minecraft:riding")?.entityRidingOn) continue;
      try {
        label.teleport(vec(raise(arr(player.location), LABEL_HEIGHT)));
      } catch {
        // gone
      }
    }
  }

  /** The settings changed: makes the piece again where it is. */
  refresh(player: Player): void {
    const state = this.state(player);
    if (state.walking) return;
    const settings = this.host.settings(player);
    if (state.madeFor !== settings.method && state.label?.isValid) {
      state.label.remove();
      state.label = undefined;
    }
    this.place(player);
  }

  private removeEntities(player: Player, state: PieceState, label = true): void {
    for (const entity of [state.mount, state.standIn, ...(label ? [state.label] : [])]) {
      try {
        if (entity?.isValid) entity.remove();
      } catch {
        // gone
      }
    }
    state.mount = undefined;
    state.standIn = undefined;
    if (label) state.label = undefined;
    state.madeFor = undefined;
    try {
      player.removeEffect("invisibility");
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.Dismount, true);
      player.playAnimation(REST, { controller: ANIM_CONTROLLER });
    } catch {
      // gone
    }
  }

  private removeAll(): void {
    for (const player of world.getAllPlayers()) {
      const state = this.states.get(player.name.toLowerCase());
      if (state) this.removeEntities(player, state);
      unlock(player);
      try {
        player.nameTag = player.name;
      } catch {
        // gone
      }
    }
  }
}

function raise(at: Vec3, by: number): Vec3 {
  return [at[0], at[1] + by, at[2]];
}

function lower(at: Vec3, by: number): Vec3 {
  return [at[0], at[1] - by, at[2]];
}

/** The player can't move or turn (their piece is walked for them); jumping still reaches the script. */
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
