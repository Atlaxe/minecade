// Block Party's stage (pass 6, docs/plans/block-party.md "Shots"; block-party-ui.md "Cameras"): the
// NPCs on the board and the shots everyone watches together.
//   - The cast: one entity per part (Chris at the podium, a Chris beside each Star, the Referee at a
//     duel), on the vanilla mob's model with no AI (npcs.ts's roles), placed, turned and taken away
//     by the game. A Chris who "falls in" drops from above with slow falling, so every client moves
//     it smoothly (a teleport each tick jitters).
//   - The shots, for everyone at once: a cut, or a pan (the camera eases there). A line's camera in
//     the user's file (Pan, Cut, Stay) picks how a conversation's shot comes in; each moment has its
//     own default.
//   - The pre-game: the intro (the map's intro shots, or high shots round the board), the starting
//     podium (the map's lineup, Chris's spot and camera, or Start's corners with Chris on the next
//     space), the turn order reveal (the camera moves to each player in turn), and the Star reveal
//     (the camera pans to each Star's space as its Chris drops in beside it).
// While a cutscene is skipped (dialogue.ts) the shots and waits are left out, but everyone and
// everything still ends up where it belongs.
// A line's Speaker (its actions, moves.ts) is the part of its character's role last brought into a
// scene, put there or turned to a seat (speaker()): of the Chrises on the board, the one at this Star.
import { EasingType, world, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { boardBox, type Space, type Vec3 } from "./board.ts";
import type { Who } from "./bots.ts";
import type { Dialogue } from "./dialogue.ts";
import { moment } from "./lines.ts";
import type { Moves } from "./moves.ts";
import { NPC_ANIMATION } from "./npcs.ts";
import { besideSpace, faceShot, introAround, markerShot, podiumFromMarkup, podiumOnStart, spaceShot, twoShot, yawFrom, type Marker, type Podium, type Shot } from "./stage-layout.ts";

/** The map's podium and intro markup (Block Party's config, map.points). */
export interface StageMarkup {
  lineup: Marker[];
  chris?: Marker;
  podiumCamera?: Marker;
  intro: Marker[];
}

export interface StageDeps {
  scope: Scope;
  dimension: Dimension;
  dialogue: Dialogue;
  spaces(): readonly Space[];
  markup(): StageMarkup;
  /** A seat's body put at `at` facing `yaw`: a player teleported (their piece locked), a bot made again there. */
  put(who: Who, at: Vec3, yaw: number): void;
  /** Everyone back on Start, as the board loop places them. */
  toStart(who: Who): void;
  /** A shot of the stage's takes the camera from the board's own (board-camera.ts). */
  cameraTaken?(): void;
  /** The stage is done with the camera: true when the board's own takes it back (else everyone gets their own view). */
  cameraBack?(): boolean;
  /** The space a shot is on lights up (space-markers.ts); undefined when the shot is on something else. */
  select?(space: Space | undefined): void;
  /** The characters' moves (moves.ts): what move() plays. */
  moves?: Moves;
}

/** How a shot comes in. */
export type Move = "Pan" | "Cut" | "Stay";

const BOARD_AREA = "minecade:blockparty_board";
/** A pan's ease, in seconds. */
const PAN = 1.4;
/** How high a Chris falls in from, and how long the fall is given before the game goes on. */
const DROP = 9;
const DROP_TICKS = 70;
/** The intro: each shot held, then eased to the next over this many seconds. */
const INTRO_HOLD = 30;
const INTRO_EASE = 3;

export class Stage {
  private readonly deps: StageDeps;
  private readonly cast = new Map<string, Entity>();
  /** Each part's role, by key. */
  private readonly roles = new Map<string, string>();
  /** The part of each role last brought into a scene (put there, or turned to a seat), by role: it speaks that character's lines. */
  private readonly lastOf = new Map<string, string>();
  /** The podium this game uses (the map's, or the one on Start). */
  private podiumNow: Podium | undefined;

  constructor(deps: StageDeps) {
    this.deps = deps;
    deps.scope.add(() => {
      for (const key of [...this.cast.keys()]) this.remove(key);
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(BOARD_AREA)) manager.removeTickingArea(BOARD_AREA);
    });
  }

  /** Keeps the whole board loaded, so NPCs can be placed (and fall) anywhere on it, however far from the players. */
  async loadBoard(): Promise<void> {
    const spaces = this.deps.spaces();
    if (spaces.length === 0) return;
    const box = boardBox(spaces);
    const manager = world.tickingAreaManager;
    try {
      if (manager.hasTickingArea(BOARD_AREA)) manager.removeTickingArea(BOARD_AREA);
      const markers = [...this.deps.markup().lineup, ...[this.deps.markup().chris, this.deps.markup().podiumCamera].filter((marker): marker is Marker => marker !== undefined)].map((marker) => marker.at);
      const xs = [box.min[0], box.max[0], ...markers.map((at) => at[0])];
      const zs = [box.min[2], box.max[2], ...markers.map((at) => at[2])];
      await manager.createTickingArea(BOARD_AREA, {
        dimension: this.deps.dimension,
        from: { x: Math.min(...xs) - 8, y: box.min[1] - 8, z: Math.min(...zs) - 8 },
        to: { x: Math.max(...xs) + 8, y: box.max[1] + 16, z: Math.max(...zs) + 8 },
      });
    } catch (error) {
      log.warn(`blockparty: keeping the board loaded failed: ${describeError(error)}`);
    }
  }

  // ---- Shots ----------------------------------------------------------------------------------

  /** Everyone's camera to `shot`: eased there (Pan), at once (Cut), or left as it is (Stay). Nothing while a cutscene is skipped. */
  shot(shot: Shot, move: Move = "Cut", ease = PAN): void {
    if (move === "Stay") return;
    // A new shot: no space is in it unless the caller says so (spaceShotOf).
    this.deps.select?.(undefined);
    if (this.deps.dialogue.skipping) return;
    this.deps.cameraTaken?.();
    const location = vec(shot.location);
    const easeOptions = move === "Pan" ? { easeOptions: { easeTime: ease, easeType: EasingType.InOutSine } } : {};
    for (const player of world.getAllPlayers()) {
      try {
        if (shot.rotation) player.camera.setCamera("minecraft:free", { location, rotation: { x: shot.rotation.pitch, y: shot.rotation.yaw }, ...easeOptions });
        else player.camera.setCamera("minecraft:free", { location, facingLocation: vec(shot.facing ?? shot.location), ...easeOptions });
      } catch {
        // gone
      }
    }
  }

  /** The board's own camera again (board-camera.ts) while the board game is on, else everyone's own view. */
  clear(): void {
    this.deps.select?.(undefined);
    if (this.deps.cameraBack?.()) return;
    for (const player of world.getAllPlayers()) {
      try {
        player.camera.clear();
      } catch {
        // gone
      }
    }
  }

  /** Whether a cutscene is being skipped (dialogue.ts): what's left of it shouldn't play. */
  get skipping(): boolean {
    return this.deps.dialogue.skipping;
  }

  /** How a moment's shot comes in: its camera in the user's file, else `fallback`. */
  moveFor(id: string, fallback: Move): Move {
    const camera = moment(id).camera;
    return camera === "Pan" || camera === "Cut" || camera === "Stay" ? camera : fallback;
  }

  // ---- The cast -----------------------------------------------------------------------------

  /** A part on stage (`key`), as the role's entity, at `at` facing `yaw`: placed, or moved there. */
  put(key: string, role: string, at: Vec3, yaw: number): Entity | undefined {
    let entity = this.cast.get(key);
    try {
      if (!entity?.isValid) {
        entity = this.deps.dimension.spawnEntity(`blockparty:${role}`, vec(at));
        this.cast.set(key, entity);
      } else entity.teleport(vec(at));
      entity.setRotation({ x: 0, y: yaw });
      this.roles.set(key, role);
      this.lastOf.set(role, key);
      return entity;
    } catch (error) {
      log.warn(`blockparty: putting ${role} on stage failed: ${describeError(error)}`);
      return undefined;
    }
  }

  /** A part drops in from above, slowly (none of the fall while a cutscene is skipped). */
  async fallIn(key: string, role: string, at: Vec3, yaw: number): Promise<void> {
    this.remove(key);
    if (this.deps.dialogue.skipping) {
      this.put(key, role, at, yaw);
      return;
    }
    const entity = this.put(key, role, [at[0], at[1] + DROP, at[2]], yaw);
    try {
      entity?.addEffect("slow_falling", DROP_TICKS + 60, { amplifier: 0, showParticles: false });
    } catch {
      // no effects on it: it just falls
    }
    await this.deps.dialogue.wait(DROP_TICKS);
    // Wherever the fall ended, it stands where it should.
    if (entity?.isValid) this.put(key, role, at, yaw);
  }

  get(key: string): Entity | undefined {
    const entity = this.cast.get(key);
    return entity?.isValid ? entity : undefined;
  }

  /**
   * Who speaks for `role` (a line's Speaker, or a character an action names): the part of it last
   * brought into a scene while it's still on stage, else any part of it on stage.
   */
  speaker(role: string): Entity | undefined {
    const last = this.lastOf.get(role);
    const entity = last ? this.get(last) : undefined;
    if (entity) return entity;
    for (const [key, part] of this.cast) if (this.roles.get(key) === role && part.isValid) return part;
    return undefined;
  }

  /** A part on stage drops in again from above where it stands, facing the same way (a line's Fall in). */
  async fallAgain(entity: Entity): Promise<void> {
    const key = [...this.cast].find(([, part]) => part === entity)?.[0];
    const role = key ? this.roles.get(key) : undefined;
    if (!key || !role || !entity.isValid) return;
    const at = arr(entity.location);
    await this.fallIn(key, role, at, entity.getRotation().y);
  }

  remove(key: string): void {
    const entity = this.cast.get(key);
    this.cast.delete(key);
    this.roles.delete(key);
    try {
      if (entity?.isValid) entity.remove();
    } catch {
      // gone
    }
  }

  /** Turns a part to face `toward` (it's the one in the scene now: it speaks its role's lines). */
  face(key: string, toward: Vec3): void {
    const entity = this.get(key);
    if (!entity) return;
    const role = this.roles.get(key);
    if (role) this.lastOf.set(role, key);
    try {
      entity.setRotation({ x: 0, y: yawFrom(arr(entity.location), toward) });
    } catch {
      // gone
    }
  }

  /** A spot beside a space with ground under it and room to stand (the first one, if none has). */
  besideSpace(space: Space): Vec3 {
    const spots = besideSpace(space, this.deps.spaces());
    for (const spot of spots) if (this.standable(spot)) return spot;
    return spots[0];
  }

  private standable(at: Vec3): boolean {
    try {
      const feet = { x: Math.floor(at[0]), y: Math.floor(at[1]), z: Math.floor(at[2]) };
      const ground = this.deps.dimension.getBlock({ ...feet, y: feet.y - 1 });
      const here = this.deps.dimension.getBlock(feet);
      const head = this.deps.dimension.getBlock({ ...feet, y: feet.y + 1 });
      return ground !== undefined && !ground.isAir && !ground.isLiquid && here?.isAir === true && head?.isAir === true;
    } catch {
      return false;
    }
  }

  // ---- The pre-game -------------------------------------------------------------------------

  /** The intro: the map's intro shots (or high ones round the board), the camera easing from each to the next. */
  async intro(): Promise<void> {
    const marked = this.deps.markup().intro;
    const spaces = this.deps.spaces();
    const middle = spaces.length > 0 ? centerOf(spaces) : undefined;
    const shots = marked.length > 0 ? marked.map((marker) => markerShot(marker, middle)) : introAround(spaces);
    for (let i = 0; i < shots.length && !this.deps.dialogue.skipping; i++) {
      this.shot(shots[i], i === 0 ? "Cut" : "Pan", INTRO_EASE);
      await this.deps.dialogue.wait((i === 0 ? 0 : INTRO_EASE * 20) + INTRO_HOLD);
    }
  }

  /** The starting podium: everyone in the lineup facing Chris, Chris at his spot, the podium camera (a cut). */
  async podium(seats: readonly Who[]): Promise<void> {
    const podium = this.podiumFor(seats.length);
    this.podiumNow = podium;
    const middle = lineupMiddle(podium);
    this.put("chris:podium", "chris", podium.chris, yawFrom(podium.chris, middle));
    seats.forEach((who, i) => this.deps.put(who, podium.lineup[i] ?? podium.lineup[0], yawFrom(podium.lineup[i] ?? podium.lineup[0], podium.chris)));
    this.shot(podium.camera, "Cut");
    await this.deps.scope.wait(2);
  }

  /** The podium camera again (a cut): after a skipped cutscene, which leaves the shots out. */
  podiumShot(): void {
    if (this.podiumNow) this.shot(this.podiumNow.camera, "Cut");
  }

  /** The order roll: everyone turns from Chris to face the camera's way. */
  turnToCamera(seats: readonly Who[]): void {
    const podium = this.podiumNow;
    if (!podium) return;
    const yaw = yawFrom(podium.chris, podium.camera.location);
    seats.forEach((who, i) => this.deps.put(who, podium.lineup[i] ?? podium.lineup[0], yaw));
  }

  /** The order reveal: the camera moves to the seat's spot in the lineup (never a cut), and Chris looks at them. */
  async reveal(seat: number): Promise<void> {
    const podium = this.podiumNow;
    if (!podium) return;
    const at = podium.lineup[seat] ?? podium.lineup[0];
    this.face("chris:podium", at);
    const yaw = yawFrom(podium.chris, podium.camera.location);
    this.shot(faceShot(at, yaw), "Pan", 1.2);
    await this.deps.dialogue.wait(26);
  }

  /** The Star reveal for one Star: the camera pans to its space, and its Chris drops in beside it. */
  async starReveal(space: Space): Promise<void> {
    this.spaceShotOf(space, this.moveFor("pregame.star", "Pan"));
    await this.deps.dialogue.wait(Math.round(PAN * 20));
    await this.starChris(space, true);
  }

  /** Off the podium: its Chris goes, everyone back on Start, everyone's own camera. */
  toBoard(seats: readonly Who[]): void {
    this.remove("chris:podium");
    for (const who of seats) this.deps.toStart(who);
    this.podiumNow = undefined;
    this.clear();
  }

  // ---- On the board -------------------------------------------------------------------------

  /** The Chris who stands by the Star on `space`: placed (dropping in when `drop`), facing the space. */
  async starChris(space: Space, drop: boolean): Promise<void> {
    const at = this.besideSpace(space);
    const yaw = yawFrom(at, space.at);
    if (drop) await this.fallIn(starKey(space), "chris", at, yaw);
    else this.put(starKey(space), "chris", at, yaw);
  }

  /** A seat at the Star: Chris turns to them, and the shot of the two comes in (the offer's camera, a pan by default). */
  async starVisit(who: Who, space: Space): Promise<void> {
    if (!this.get(starKey(space))) await this.starChris(space, false);
    const chris = this.get(starKey(space));
    if (!chris || !who.body.isValid) return;
    const them = arr(who.body.location);
    this.face(starKey(space), them);
    this.shot(twoShot(them, arr(chris.location), sideOf(who)), this.moveFor("star.chris.offer", "Pan"));
    await this.deps.scope.wait(Math.round(PAN * 20));
  }

  /** The Star flies on: its Chris leaves `from`, the camera pans to `to`, and a Chris drops in there. */
  async starMoved(from: Space, to: Space): Promise<void> {
    this.remove(starKey(from));
    this.spaceShotOf(to, this.moveFor("star.chris.moves", "Pan"));
    await this.deps.scope.wait(Math.round(PAN * 20));
    await this.starChris(to, true);
  }

  /** The Referee comes to a duel: beside the lander's space, turned to them, the two in shot (a cut by default). */
  async referee(who: Who, space: Space | undefined): Promise<void> {
    if (!space || !who.body.isValid) return;
    const at = this.besideSpace(space);
    const them = arr(who.body.location);
    this.put("referee", "referee", at, yawFrom(at, them));
    this.shot(twoShot(them, at, sideOf(who)), this.moveFor("versus.announce", "Cut"));
    await this.deps.scope.wait(10);
  }

  refereeGone(): void {
    this.remove("referee");
  }

  /**
   * An NPC comes to a seat on its space (pass 7: the Villager at a Shop, the Witch at Chance Time,
   * the Warden, the Enderman, the Iron Golem): `role`'s entity beside the space, turned to them, the
   * two in shot (the moment `lineId`'s camera, else `fallback`). Gone with remove(key).
   */
  async visit(key: string, role: string, who: Who, space: Space | undefined, lineId: string, fallback: Move = "Cut"): Promise<Entity | undefined> {
    if (!space || !who.body.isValid) return undefined;
    const at = this.besideSpace(space);
    const them = arr(who.body.location);
    const entity = this.put(key, role, at, yawFrom(at, them));
    this.shot(twoShot(them, at, sideOf(who)), this.moveFor(lineId, fallback));
    await this.deps.dialogue.wait(10);
    return entity;
  }

  /** A part beside a space, facing it (the Wandering Trader by its Item space); dropping in when `drop`. */
  async beside(key: string, role: string, space: Space, drop: boolean): Promise<void> {
    const at = this.besideSpace(space);
    const yaw = yawFrom(at, space.at);
    if (drop) await this.fallIn(key, role, at, yaw);
    else this.put(key, role, at, yaw);
  }

  /** A seat comes to a part already on stage (the Trader by his space): it turns to them, the two in shot (a pan by default). */
  async meet(key: string, who: Who, lineId: string, fallback: Move = "Pan"): Promise<void> {
    const part = this.get(key);
    if (!part || !who.body.isValid) return;
    const them = arr(who.body.location);
    this.face(key, them);
    const move = this.moveFor(lineId, fallback);
    this.shot(twoShot(them, arr(part.location), sideOf(who)), move);
    if (move === "Pan") await this.deps.dialogue.wait(Math.round(PAN * 20));
  }

  /** The camera to a space (a pan by default, or the moment `lineId`'s camera), given time to get there. */
  async toSpace(space: Space, lineId: string, fallback: Move = "Pan"): Promise<void> {
    const move = this.moveFor(lineId, fallback);
    this.spaceShotOf(space, move);
    if (move === "Pan") await this.deps.dialogue.wait(Math.round(PAN * 20));
  }

  /** The shot of a space (spaceShot), the space lit up while the shot stays on it (a Stay keeps the shot there is). */
  private spaceShotOf(space: Space, move: Move): void {
    this.shot(spaceShot(space, this.deps.spaces()), move);
    if (move !== "Stay") this.deps.select?.(space);
  }

  /** Two seats in one shot (an Ender Pearl's swap, Coin Swap): a cut by default. */
  async twoSeats(a: Who, b: Who, lineId: string, fallback: Move = "Cut"): Promise<void> {
    if (!a.body.isValid || !b.body.isValid) return;
    this.shot(twoShot(arr(a.body.location), arr(b.body.location), sideOf(a)), this.moveFor(lineId, fallback));
    await this.deps.dialogue.wait(10);
  }

  /**
   * A Lightning Strike on a seat: the camera looks up from beside them, a flash of light and the
   * thunder's crack. No real bolt (it would set the board alight).
   */
  lightning(who: Who): void {
    if (!who.body.isValid) return;
    const at = who.body.location;
    if (!this.deps.dialogue.skipping) this.shot({ location: [at.x + 3, at.y + 1, at.z + 3], facing: [at.x, at.y + 6, at.z] }, "Cut");
    try {
      for (let y = 0; y <= 12; y += 0.5) this.deps.dimension.spawnParticle("minecraft:electric_spark_particle", { x: at.x, y: at.y + y, z: at.z });
      this.deps.dimension.spawnParticle("minecraft:huge_explosion_emitter", { x: at.x, y: at.y + 1, z: at.z });
      for (const player of world.getAllPlayers()) player.playSound("ambient.weather.lightning.impact", { volume: 0.8 });
    } catch {
      // unloaded
    }
  }

  /**
   * A part does one of its character's moves (`character` and `action` as the dialogue tool names
   * them: moves.ts), as a line's action would: the Warden's Emerge shows him once he's under way,
   * his Dig away hides him once he's down. `toward`: who it's about.
   */
  move(key: string, character: string, action: string, toward?: Entity): void {
    const entity = this.get(key);
    if (entity) this.deps.moves?.npc(entity, character, action, toward);
  }

  /** A part plays a vanilla animation (the Warden's roar, the golem's hit), held when `hold`. */
  act(key: string, animation: string, hold = false): void {
    const entity = this.get(key);
    if (!entity) return;
    try {
      entity.playAnimation(animation, { controller: NPC_ANIMATION, stopExpression: hold ? "0" : "q.any_animation_finished", blendOutTime: 0.2 });
    } catch (error) {
      log.warn(`blockparty: ${key}'s ${animation} failed: ${describeError(error)}`);
    }
  }

  private podiumFor(seats: number): Podium {
    const markup = this.deps.markup();
    const marked = podiumFromMarkup(markup.lineup, markup.chris, markup.podiumCamera, seats);
    if (marked) return marked;
    const spaces = this.deps.spaces();
    return podiumOnStart(spaces[0], spaces);
  }
}

/** The Chris beside the Star on a space. */
function starKey(space: Space): string {
  return `chris:star:${space.index}`;
}

/** Which side a two-shot looks from: the same side for a seat each time, so the screen doesn't flip. */
function sideOf(who: Who): 1 | -1 {
  let hash = 0;
  for (const char of who.key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return hash % 2 === 0 ? 1 : -1;
}

function lineupMiddle(podium: Podium): Vec3 {
  const n = podium.lineup.length || 1;
  return [podium.lineup.reduce((sum, at) => sum + at[0], 0) / n, podium.lineup[0]?.[1] ?? podium.chris[1], podium.lineup.reduce((sum, at) => sum + at[2], 0) / n];
}

function centerOf(spaces: readonly Space[]): Vec3 {
  const box = boardBox(spaces);
  return [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2];
}

function vec(at: Vec3): Vector3 {
  return { x: at[0], y: at[1], z: at[2] };
}

function arr(at: Vector3): Vec3 {
  return [at.x, at.y, at.z];
}
