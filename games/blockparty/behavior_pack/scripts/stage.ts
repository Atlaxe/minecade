// Block Party's stage (pass 6, docs/plans/block-party.md "Shots"; block-party-ui.md "Cameras"): the
// NPCs on the board and the shots everyone watches together.
//   - The cast: one entity per part (Chris at the podium, a Chris beside each Star, the Referee at a
//     duel), on the vanilla mob's model with no AI (npcs.ts's roles), placed, turned and taken away
//     by the game. A Chris who "falls in" drops from above with slow falling, so every client moves
//     it smoothly (a teleport each tick jitters).
//   - The user's asks (2026-11-18): the Referee at every Versus space and the Villager at every Shop
//     space stand there all game (residents); a seat and the NPC it talks with turn to each other;
//     the Star floats over its space, fading away as it's bought (its transfer flies from it); when
//     the Star moves on, a balloon carries Chris over to it (entrances.ts plans the flight; he moves
//     by his speed each tick, as bots do, so it's smooth); the Wandering Trader walks in with his
//     llamas on leads; the Witch comes and goes in a puff of smoke, the Enderman by teleporting; the
//     rest an item brings just appear (the user).
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
import { boardBox, floorOf, type Space, type Vec3 } from "./board.ts";
import { stepBot, stepToward, type Who } from "./bots.ts";
import type { Dialogue } from "./dialogue.ts";
import { extendTrail, flightPlan, residentRole, trailPoint, walkInPath, type TrailPoint } from "./entrances.ts";
import { forkShot } from "./fork.ts";
import { moment } from "./lines.ts";
import { portalRing, type Moves } from "./moves.ts";
import { NPC_ANIMATION } from "./npcs.ts";
import { eventCue, playCue } from "./sounds.ts";
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
  /** A seat turns where it stands to look at `toward` (an NPC it's talking with). */
  face?(who: Who, toward: Vec3): void;
  /** A shot of the stage's takes the camera from the board's own (board-camera.ts), its field of view eased back over `seconds` (a pan's). */
  cameraTaken?(seconds: number): void;
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

/** The Star over a Star's space: how high over the floor (over a piece's head), its properties, and how long its fade takes before it goes. */
const STAR_OVER = 2.5;
const TURNING = "blockparty:turning";
const FADED = "blockparty:faded";
const STAR_FADE_TICKS = 20;
/** Chris's balloon (chris.json): the property that shows it, the time it takes to pop out, and the events that make him fly (no gravity, no collisions) and land again. */
const BALLOON = "blockparty:balloon";
const BALLOON_POP_TICKS = 14;
const FLY_EVENT = "blockparty:fly";
const LAND_EVENT = "blockparty:land";
/** The camera on a flight: how often it moves on, how far to the side and how far up. */
const CAMERA_EVERY = 2;
const FOLLOW_AWAY = 9;
const FOLLOW_UP = 3;
/**
 * Who comes and goes their own way (the user, 2026-11-18): the Witch in a puff of smoke, like a
 * magician (the pack's particle); the Enderman by teleporting (his blink's portal particles).
 * Everyone else an item or a space brings just appears. Then the ticks the effect hides them before they're there.
 */
const ENTRANCES: Readonly<Record<string, "smoke" | "teleport">> = { witch: "smoke", enderman: "teleport" };
const SMOKE_PARTICLE = "blockparty:smoke_puff";
const ENTRANCE_HIDES = 3;
/** The Trader's walk in: his speed (blocks a tick), the longest it may take, his llamas and the gap between each and the one ahead. */
const TRADER_WALK = 0.16;
const WALK_MOST = 400;
const LLAMAS = 2;
const LLAMA_GAP = 1.9;
/** A fork's camera turning from one way to another, in seconds. */
const FORK_PAN = 0.8;
/** A llama's coat (trader_llama.json): creamy, white, brown or gray. */
const COAT = "blockparty:coat";

export class Stage {
  private readonly deps: StageDeps;
  private readonly cast = new Map<string, Entity>();
  /** Each part's role, by key. */
  private readonly roles = new Map<string, string>();
  /** The part of each role last brought into a scene (put there, or turned to a seat), by role: it speaks that character's lines. */
  private readonly lastOf = new Map<string, string>();
  /** The podium this game uses (the map's, or the one on Start). */
  private podiumNow: Podium | undefined;
  /** The Referee at the duel now (his key), if any: one who came, or the one standing at the Versus space. */
  private refereeNow: string | undefined;

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
    // Loaded: the NPCs who stand at their spaces all game take their places.
    this.residents();
  }

  // ---- Shots ----------------------------------------------------------------------------------

  /** Everyone's camera to `shot`: eased there (Pan), at once (Cut), or left as it is (Stay). Nothing while a cutscene is skipped. */
  shot(shot: Shot, move: Move = "Cut", ease = PAN): void {
    if (move === "Stay") return;
    // A new shot: no space is in it unless the caller says so (spaceShotOf).
    this.deps.select?.(undefined);
    if (this.deps.dialogue.skipping) return;
    this.deps.cameraTaken?.(move === "Pan" ? ease : 0);
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

  /**
   * The NPCs who stand at their spaces all game (the user, 2026-11-18: those spots are always
   * there): the Referee beside every Versus space and the Villager beside every Shop space, facing
   * it, at the default spot beside it (per-marker spots come with the editor later). Any missing are
   * put back.
   */
  residents(): void {
    for (const space of this.deps.spaces()) this.resident(space);
  }

  /** The key of the NPC who stands at `space` all game, put there if it's missing; undefined for a space with none. */
  resident(space: Space): string | undefined {
    const role = residentRole(space.type);
    if (!role) return undefined;
    const key = residentKey(space);
    if (!this.get(key)) {
      const at = this.besideSpace(space);
      this.put(key, role, at, yawFrom(at, space.at));
    }
    return key;
  }

  /**
   * A seat on a resident's space (the Shop's Villager, the Versus Referee): the two turn to each
   * other and their shot comes in (the moment `lineId`'s camera, else `fallback`). Their key, or
   * undefined for a space with no resident.
   */
  async atResident(who: Who, space: Space | undefined, lineId: string, fallback: Move = "Cut"): Promise<string | undefined> {
    const key = space ? this.resident(space) : undefined;
    const part = key ? this.get(key) : undefined;
    if (!key || !part || !who.body.isValid) return undefined;
    const them = arr(who.body.location);
    const at = arr(part.location);
    this.face(key, them);
    this.deps.face?.(who, at);
    this.shot(twoShot(them, at, sideOf(who)), this.moveFor(lineId, fallback));
    await this.deps.dialogue.wait(10);
    return key;
  }

  /** A resident turns back to its space when its scene is over. */
  backToSpace(key: string): void {
    const space = this.deps.spaces().find((one) => residentKey(one) === key);
    if (space) this.face(key, space.at);
  }

  /** The Chris who stands by the Star on `space`: placed (dropping in when `drop`), facing the space, and the Star over the space. */
  async starChris(space: Space, drop: boolean): Promise<void> {
    const at = this.besideSpace(space);
    const yaw = yawFrom(at, space.at);
    if (drop) await this.fallIn(starKey(space), "chris", at, yaw);
    else this.put(starKey(space), "chris", at, yaw);
    this.starModel(space);
  }

  /**
   * The Star over a Star's space (the user, 2026-11-18): its model, turning and bobbing, popping in
   * as it's put there. Nothing if it's there already.
   */
  starModel(space: Space): void {
    const key = starModelKey(space);
    if (this.get(key)) return;
    const model = this.put(key, "star", [space.at[0], floorOf(space) + STAR_OVER, space.at[2]], 0);
    try {
      model?.setProperty(TURNING, true);
    } catch {
      // gone
    }
  }

  /**
   * The Star over `space` is bought: it fades away (its client eases it out) and goes a moment
   * later. It's handed back meanwhile, so the bought Star's transfer can fly from it.
   */
  starTaken(space: Space): Entity | undefined {
    const key = starModelKey(space);
    const model = this.get(key);
    if (!model) return undefined;
    try {
      model.setProperty(FADED, true);
    } catch {
      // gone
    }
    this.cast.delete(key);
    this.roles.delete(key);
    this.deps.scope.timeout(() => {
      try {
        if (model.isValid) model.remove();
      } catch {
        // gone
      }
    }, STAR_FADE_TICKS);
    return model;
  }

  /** The Star over `space`, if it's there (the bought Star's transfer flies from it). */
  starModelAt(space: Space): Entity | undefined {
    return this.get(starModelKey(space));
  }

  /** A seat at the Star: Chris and they turn to each other, and the shot of the two comes in (the offer's camera, a pan by default). */
  async starVisit(who: Who, space: Space): Promise<void> {
    if (!this.get(starKey(space))) await this.starChris(space, false);
    const chris = this.get(starKey(space));
    if (!chris || !who.body.isValid) return;
    const them = arr(who.body.location);
    this.face(starKey(space), them);
    this.deps.face?.(who, arr(chris.location));
    this.shot(twoShot(them, arr(chris.location), sideOf(who)), this.moveFor("star.chris.offer", "Pan"));
    await this.deps.scope.wait(Math.round(PAN * 20));
  }

  /**
   * The Star flies on (the user, 2026-11-18): a balloon pops out of Chris and carries him up, over to
   * `to` and down beside it, the camera following him; there the balloon goes and the Star appears
   * over the space. Skipped (or with no Chris to fly), he's simply there.
   */
  async starMoved(from: Space, to: Space): Promise<void> {
    // The Star over `from` has faded as it was bought; gone now if it hasn't.
    this.starTaken(from);
    const chris = this.get(starKey(from));
    if (!chris || this.deps.dialogue.skipping) {
      this.remove(starKey(from));
      await this.starChris(to, false);
      return;
    }
    // He's the Chris at `to` from now on.
    this.cast.delete(starKey(from));
    this.roles.delete(starKey(from));
    this.cast.set(starKey(to), chris);
    this.roles.set(starKey(to), "chris");
    this.lastOf.set("chris", starKey(to));
    const spot = this.besideSpace(to);
    await this.balloonFlight(chris, spot, to.at);
    if (chris.isValid) this.put(starKey(to), "chris", spot, yawFrom(spot, to.at));
    this.starModel(to);
    await this.deps.dialogue.wait(10);
  }

  /** Chris under his balloon from where he stands to `spot`, turned to `facing` as he lands. */
  private async balloonFlight(chris: Entity, spot: Vec3, facing: Vec3): Promise<void> {
    const from = arr(chris.location);
    const flight = flightPlan(from, spot);
    // The way across, for the camera's side (the same all flight, so it never swings round).
    const across = Math.hypot(spot[0] - from[0], spot[2] - from[2]) || 1;
    const way: [number, number] = [(spot[0] - from[0]) / across, (spot[2] - from[2]) / across];
    const property = (name: string, value: boolean) => {
      try {
        if (chris.isValid) chris.setProperty(name, value);
      } catch {
        // gone
      }
    };
    property(BALLOON, true);
    playCue(eventCue("npc.chris.balloon"));
    this.follow(chris, way, true);
    await this.deps.dialogue.wait(BALLOON_POP_TICKS);
    try {
      chris.triggerEvent(FLY_EVENT);
    } catch {
      // gone
    }
    for (let tick = 0; tick < flight.ticks && chris.isValid && !this.deps.dialogue.skipping && !this.deps.scope.disposed; tick++) {
      // Each tick it goes the way to where the flight is next (fixing any drift), no gravity, no collisions.
      const at = chris.location;
      const next = flight.at(tick + 1);
      try {
        chris.clearVelocity();
        chris.applyImpulse({ x: next[0] - at.x, y: next[1] - at.y, z: next[2] - at.z });
        if (Math.hypot(next[0] - at.x, next[2] - at.z) > 0.05) chris.setRotation({ x: 0, y: yawFrom([at.x, at.y, at.z], next) });
      } catch {
        // gone this tick
      }
      if (tick % CAMERA_EVERY === 0) this.follow(chris, way, false);
      await this.deps.scope.wait(1);
    }
    try {
      if (chris.isValid) {
        chris.clearVelocity();
        chris.triggerEvent(LAND_EVENT);
        chris.teleport(vec(spot), { rotation: { x: 0, y: yawFrom(spot, facing) } });
      }
    } catch {
      // gone
    }
    // Down: the balloon goes with a pop.
    property(BALLOON, false);
    playCue(eventCue("npc.chris.balloon_pop"));
    try {
      this.deps.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: spot[0], y: spot[1] + 2.4, z: spot[2] });
    } catch {
      // unloaded
    }
  }

  /** The camera beside `body`, off to the side of `way`, looking at it: eased there when `first`, then gliding along each tick or two. */
  private follow(body: Entity, way: [number, number], first: boolean): void {
    if (this.deps.dialogue.skipping || !body.isValid) return;
    const at = body.location;
    const location: Vec3 = [at.x - way[1] * FOLLOW_AWAY - way[0] * 2, at.y + FOLLOW_UP, at.z + way[0] * FOLLOW_AWAY - way[1] * 2];
    const facing: Vec3 = [at.x, at.y + 1.2, at.z];
    if (first) {
      this.shot({ location, facing }, "Pan", 1);
      return;
    }
    for (const player of world.getAllPlayers()) {
      try {
        player.camera.setCamera("minecraft:free", { location: vec(location), facingLocation: vec(facing), easeOptions: { easeTime: (CAMERA_EVERY + 1) / 20, easeType: EasingType.Linear } });
      } catch {
        // gone
      }
    }
  }

  /** The Referee comes to a duel: at a Versus space the one who stands there, else beside the lander's space; the two turned to each other and in shot (a cut by default). */
  async referee(who: Who, space: Space | undefined): Promise<void> {
    if (!space || !who.body.isValid) return;
    const resident = await this.atResident(who, space, "versus.announce");
    if (resident) {
      this.refereeNow = resident;
      return;
    }
    const at = this.besideSpace(space);
    const them = arr(who.body.location);
    this.put("referee", "referee", at, yawFrom(at, them));
    this.refereeNow = "referee";
    this.deps.face?.(who, at);
    this.shot(twoShot(them, at, sideOf(who)), this.moveFor("versus.announce", "Cut"));
    await this.deps.scope.wait(10);
  }

  /** The duel's Referee is done: one who came goes, one who stands at the space turns back to it. */
  refereeGone(): void {
    const key = this.refereeNow;
    this.refereeNow = undefined;
    if (key === "referee") this.remove("referee");
    else if (key) this.backToSpace(key);
  }

  /**
   * An NPC comes to a seat on its space (pass 7: the Witch at Chance Time, the Warden, the Enderman,
   * the Iron Golem, the Villager an item brings): `role`'s entity beside the space, the two turned
   * to each other, in shot (the moment `lineId`'s camera, else `fallback`). The Witch appears in a
   * puff of smoke, the Enderman teleports in (ENTRANCES). Gone with leave(key) (or remove(key) for
   * no exit at all).
   */
  async visit(key: string, role: string, who: Who, space: Space | undefined, lineId: string, fallback: Move = "Cut"): Promise<Entity | undefined> {
    if (!space || !who.body.isValid) return undefined;
    const at = this.besideSpace(space);
    const them = arr(who.body.location);
    const entrance = this.deps.dialogue.skipping ? undefined : ENTRANCES[role];
    this.shot(twoShot(them, at, sideOf(who)), this.moveFor(lineId, fallback));
    if (entrance) {
      // The shot first, then the smoke or the portal's sparks, and out of them the NPC.
      await this.deps.dialogue.wait(4);
      this.effect(at, role, "appear");
      await this.deps.dialogue.wait(ENTRANCE_HIDES);
    }
    const entity = this.put(key, role, at, yawFrom(at, them));
    this.deps.face?.(who, at);
    await this.deps.dialogue.wait(entrance ? 16 : 10);
    return entity;
  }

  /** A part leaves the stage its way: the Witch in a puff of smoke, the Enderman teleporting away, anyone else at once. */
  leave(key: string): void {
    const part = this.get(key);
    const role = this.roles.get(key);
    if (part && role && ENTRANCES[role] && !this.deps.scope.disposed) this.effect(arr(part.location), role, "vanish");
    this.remove(key);
  }

  /** A role's way in or out where it stands, with its sound (event npc.<role>.appear or .vanish): a puff of smoke, or a teleport's portal sparks. */
  private effect(at: Vec3, role: string, how: "appear" | "vanish"): void {
    playCue(eventCue(`npc.${role}.${how}`));
    if (ENTRANCES[role] === "teleport") {
      portalRing(this.deps.dimension, vec(at));
      return;
    }
    try {
      for (const up of [0.2, 0.9, 1.6]) this.deps.dimension.spawnParticle(SMOKE_PARTICLE, { x: at[0], y: at[1] + up, z: at[2] });
    } catch {
      // unloaded
    }
  }

  /**
   * The Wandering Trader comes to `space` with his llamas (the user, 2026-11-18): when `walk`, the
   * camera cuts to the space and he walks in from out of the shot along the board's path, the llamas
   * on leads behind him, each keeping to his trail; else (or skipped) they're simply there.
   */
  async traderArrives(key: string, space: Space, walk: boolean): Promise<void> {
    this.traderGone(key);
    const spots = besideSpace(space, this.deps.spaces());
    const spot = this.besideSpace(space);
    const side = Math.max(0, spots.findIndex((one) => one[0] === spot[0] && one[2] === spot[2]));
    const path = walkInPath(space, this.deps.spaces(), side, spot);
    const yaw = yawFrom(spot, space.at);
    if (!walk || this.deps.dialogue.skipping || path.length < 2) {
      const trader = this.put(key, "wandering_trader", spot, yaw);
      const behind = path.length >= 2 ? path[path.length - 2] : ([spot[0] - 1, spot[1], spot[2]] as Vec3);
      this.llamas(key, trader, spot, behind, false);
      return;
    }
    this.shot(spaceShot(space, this.deps.spaces()), "Cut");
    this.deps.select?.(space);
    await this.deps.dialogue.wait(16);
    const trader = this.put(key, "wandering_trader", path[0], yawFrom(path[0], path[1]));
    if (!trader) return;
    const llamas = this.llamas(key, trader, path[0], path[0], true);
    const trail: TrailPoint[] = [];
    let next = 1;
    let best = Infinity;
    let stuck = 0;
    for (let tick = 0; tick < WALK_MOST && next < path.length && trader.isValid && !this.deps.dialogue.skipping && !this.deps.scope.disposed; tick++) {
      const target = path[next];
      if (stepToward(trader, vec(target), TRADER_WALK, next === path.length - 1 ? 0.15 : 0.6)) {
        next++;
        best = Infinity;
        stuck = 0;
      } else {
        // Held up by something in the way: on to the next spot after a while.
        const gap = Math.hypot(target[0] - trader.location.x, target[2] - trader.location.z);
        if (gap < best - 0.05) {
          best = gap;
          stuck = 0;
        } else if (++stuck > 30) {
          trader.teleport(vec(target));
          next++;
          best = Infinity;
          stuck = 0;
        }
      }
      extendTrail(trail, arr(trader.location));
      llamas.forEach((llama, i) => {
        const goal = trailPoint(trail, LLAMA_GAP * (i + 1));
        if (goal && llama.isValid) stepToward(llama, vec(goal), TRADER_WALK * 1.4, 0.3);
      });
      await this.deps.scope.wait(1);
    }
    if (trader.isValid) {
      stepBot(trader, 0, 0);
      this.put(key, "wandering_trader", spot, yaw);
    }
    for (const llama of llamas) if (llama.isValid) stepBot(llama, 0, 0);
  }

  /** The Trader goes, his llamas first (so their leads don't drop as items), and any lead that did drop near him. */
  traderGone(key: string): void {
    const trader = this.get(key);
    const at = trader?.location;
    for (let i = 0; i < LLAMAS; i++) this.remove(llamaKey(key, i));
    this.remove(key);
    if (!at) return;
    try {
      for (const item of this.deps.dimension.getEntities({ type: "minecraft:item", location: at, maxDistance: 12 })) {
        if (item.getComponent("minecraft:item")?.itemStack.typeId === "minecraft:lead") item.remove();
      }
    } catch {
      // unloaded
    }
  }

  /** The Trader's llamas: put at `first` (in a line behind `behind`'s way when they're standing), each on a lead to him. */
  private llamas(key: string, trader: Entity | undefined, first: Vec3, behind: Vec3, walking: boolean): Entity[] {
    const out: Entity[] = [];
    const dx = behind[0] - first[0];
    const dz = behind[2] - first[2];
    const gap = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < LLAMAS; i++) {
      const back = walking ? 0.5 * (i + 1) : LLAMA_GAP * (i + 1);
      const at: Vec3 = [first[0] + (dx / gap) * back, first[1], first[2] + (dz / gap) * back];
      const llama = this.put(llamaKey(key, i), "trader_llama", at, yawFrom(at, first));
      if (!llama) continue;
      try {
        llama.setProperty(COAT, Math.floor(Math.random() * 4));
      } catch {
        // gone
      }
      try {
        if (trader?.isValid) llama.getComponent("minecraft:leashable")?.leashTo(trader);
      } catch (error) {
        log.warn(`blockparty: a llama's lead failed: ${describeError(error)}`);
      }
      out.push(llama);
    }
    return out;
  }

  /** A part already on stage (the Trader by his space) and a seat come to talk: they turn to each other, the two in shot (a pan by default). */
  async meet(key: string, who: Who, lineId: string, fallback: Move = "Pan"): Promise<void> {
    const part = this.get(key);
    if (!part || !who.body.isValid) return;
    const them = arr(who.body.location);
    this.face(key, them);
    this.deps.face?.(who, arr(part.location));
    const move = this.moveFor(lineId, fallback);
    this.shot(twoShot(them, arr(part.location), sideOf(who)), move);
    if (move === "Pan") await this.deps.dialogue.wait(Math.round(PAN * 20));
  }

  /**
   * A fork's way picked (dialogue.ts fork): everyone's camera eases round to look down it from
   * behind the fork, and its first space lights up.
   */
  forkView(fork: Space, heading: [number, number], way: readonly Space[]): void {
    this.shot(forkShot(fork, heading, way), "Pan", FORK_PAN);
    if (way[0]) this.deps.select?.(way[0]);
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

/** The Star over a Star's space. */
function starModelKey(space: Space): string {
  return `star:${space.index}`;
}

/** The NPC who stands at a space all game (the Referee at Versus, the Villager at the Shop). */
function residentKey(space: Space): string {
  return `resident:${space.index}`;
}

/** One of the Trader's llamas. */
function llamaKey(trader: string, index: number): string {
  return `${trader}:llama:${index}`;
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
