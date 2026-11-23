// Golem Gardens' golems on the board (the user's design, 2026-11-22; docs/plans/block-party.md
// "Golems"; the rules are golem-rules.ts's):
//   - The four stand on the board all game, on the vanilla Iron Golem's model (blockparty:iron_golem):
//     the two active on their posts, blocking their paths, the other two at their rest spots.
//   - The toll: a walk that comes to an active golem's path stops at the space before it, and the
//     golem asks its 5 coins (the dialogue box, Pay or Not now). Paid, the coins fly to it and it
//     steps aside along its walk (the user: it steps aside for that player, then back); the piece goes
//     by and the golem walks back to its post. Not paid (or short of coins): at a fork the player picks
//     a way again, elsewhere their walk ends there.
//   - The swap (each Star bought): one active golem and one resting trade places. The camera cuts to
//     the one leaving, it says it has to move, then the camera pans over the whole board while both
//     walk to their new spots, and the cutscene ends once the last is there (the user). A skipped
//     swap puts them there at once.
//   - Golems walk, never teleport (the user): each leg of a walk is planned over the ground as a
//     piece's is (walk-plan.ts) and followed a tick at a time (walk-follow.ts), as bots walk. Only a
//     golem stuck for good is put at the end of its leg.
import type { Entity } from "@minecraft/server";
import { describeError, log } from "@minecade/minigame-core";
import { count } from "./board-rules.ts";
import { boardPan } from "./board-view.ts";
import type { Vec3 } from "./board.ts";
import { moveBot, stepBot, type Who } from "./bots.ts";
import { GOLEM_TOLL, GOLEM_WALK, asidePath, botPays, golemOn, pickSwap, startingActive, walkTicks, walkTo, type Golem, type GolemSpot } from "./golem-rules.ts";
import type { LoopHost } from "./board-loop.ts";
import { button } from "./lines.ts";
import type { Seat } from "./seats.ts";
import type { Party, Token } from "./tokens.ts";
import { followTick, legOf, newFollow } from "./walk-follow.ts";
import { planLeg, type TerrainReader } from "./walk-plan.ts";
import { wayShot, type Shot, type ShotWay } from "./stage-layout.ts";

/** The NPC role a golem is (npcs.ts; its entity blockparty:iron_golem). */
const ROLE = "iron_golem";
/** Ticks a leg may run past its length before a golem stuck on it is put at its end. */
const STUCK_SLACK = 40;
/** The camera on the golem who speaks: how far in front of it, and the height of its eyes. */
const FACE_AWAY = 5;
const GOLEM_EYES = 2.3;
/** How far round the board the swap's pan turns, in degrees, and the least it lasts (seconds). */
const PAN_TURN = 50;
const PAN_LEAST = 3;
/** Ticks the swap's last shot holds once both golems are there. */
const SWAP_HOLD = 20;

/** What the golems use of the board loop (board-loop.ts). */
export interface GolemLoop {
  seatOf(key: string): Seat | undefined;
  transfer(from: Party, to: Party, token: Token, count: number): Promise<void>;
  spent(key: string, amount: number): void;
}

export class GolemGates {
  private readonly loop: GolemLoop;
  private readonly host: LoopHost;
  private golems: Golem[] = [];
  private active = new Set<number>();
  private placed = false;
  /** Each golem's walk going on now (a new one waits for it). */
  private readonly walking = new Map<number, Promise<void>>();

  constructor(loop: GolemLoop, host: LoopHost) {
    this.loop = loop;
    this.host = host;
  }

  /** Whether the board has golems. */
  get any(): boolean {
    this.ensure();
    return this.golems.length > 0;
  }

  /** The golems take their places for the game: golems 1 and 2 on their posts, the rest resting. */
  start(): void {
    this.golems = [...(this.host.golems?.() ?? [])];
    this.active = startingActive(this.golems);
    this.placed = true;
    for (const golem of this.golems) this.stand(golem, this.active.has(golem.number));
  }

  /** The active golem on the path from space `from` to space `to` (indexes), if there is one. */
  blocking(from: number, to: number): Golem | undefined {
    this.ensure();
    return golemOn(this.golems, this.active, from, to);
  }

  /**
   * `who` has come to `golem`'s path: it asks the toll. True when they paid (it then steps aside and
   * resolves once it's out of the way: call back() after they've passed). `fork`: they're at a fork
   * (a bot pays there only on the way to the Star, `towardStar`).
   */
  async toll(who: Who, golem: Golem, fork: boolean, towardStar: boolean): Promise<boolean> {
    const seat = this.loop.seatOf(who.key);
    const entity = this.entity(golem);
    if (!seat) return false;
    const { stage } = this.host;
    const fills = { player: who.name, toll: count(GOLEM_TOLL, "coin"), coins: count(seat.coins, "coin") };
    await stage.meet(this.key(golem), who, "golem.toll");
    if (seat.coins < GOLEM_TOLL) {
      await this.host.say("golem.toll.short", fills, false, who);
      return false;
    }
    const picked = await this.host.talk("golem.toll", fills, { to: who, buttons: [button("golem.toll.pay", fills), button("golem.toll.no")], back: 1, botPick: botPays(seat.coins, fork, towardStar) ? 0 : 1 });
    if (picked !== 0) {
      await this.host.say("golem.toll.declined", fills, false, who);
      return false;
    }
    seat.coins -= GOLEM_TOLL;
    this.loop.spent(who.key, GOLEM_TOLL);
    this.host.changed();
    await this.loop.transfer(who, entity, "coin", GOLEM_TOLL);
    await this.host.say("golem.toll.paid", fills, false, who);
    await this.aside(golem);
    return true;
  }

  /** A golem steps aside along its walk (for a payer, or a walk back past it); resolves once it's out of the way. */
  async aside(golem: Golem): Promise<void> {
    await this.walkGolem(golem, asidePath(golem), false);
  }

  /** A golem that stepped aside walks back to its post (not awaited by the walk that passed it), and stands there. */
  back(golem: Golem): void {
    void this.walkGolem(golem, [...asidePath(golem)].reverse(), false, true);
  }

  /**
   * A Star was bought: one active golem and one resting trade places (pickSwap), as a cutscene: the
   * camera cuts to the one leaving, which says it has to move; then a pan over the whole board while
   * both walk to their new spots, ending once the last is there.
   */
  async swap(): Promise<void> {
    this.ensure();
    const pick = pickSwap(this.golems, this.active, this.host.random);
    if (!pick) return;
    const { leaving, coming } = pick;
    this.active.delete(leaving.number);
    this.active.add(coming.number);
    const { stage } = this.host;
    await this.host.cutscene(true, async () => {
      await Promise.all([this.walking.get(leaving.number), this.walking.get(coming.number)]);
      const key = this.key(leaving);
      // The one leaving speaks (its role's lines are the part last brought into a scene), turned to
      // the camera when the cutscene looks the board camera's way, else ahead along its post.
      stage.lay(undefined, (way) => {
        const shot = golemShot(leaving.post, way);
        stage.face(key, way ? shot.location : ahead(leaving.post, 3));
        return shot;
      }, "Cut");
      await this.host.say("golem.swap", {}, true);
      if (stage.skipping) return;
      const ways = [walkTo(leaving, false), walkTo(coming, true)];
      const seconds = Math.max(PAN_LEAST, Math.max(...ways.map((way) => walkTicks(way))) / 20);
      const [from, to] = boardPan(
        [...this.host.spaces().map((space) => space.at), ...this.golems.flatMap((golem) => [golem.post.at, golem.rest.at])],
        PAN_TURN,
        stage.wayAt(undefined)?.yaw,
      );
      if (from && to) {
        stage.shot(from, "Cut");
        await this.host.scope.wait(1);
        stage.shot(to, "Pan", seconds);
      }
      await Promise.all([this.walkGolem(leaving, ways[0], true), this.walkGolem(coming, ways[1], true)]);
      if (!stage.skipping) await this.host.scope.wait(SWAP_HOLD);
    });
    // Wherever the walks got to (all the way, or skipped), each stands on its spot.
    this.stand(leaving, false);
    this.stand(coming, true);
  }

  /** Puts a golem on its post (active) or its rest spot, facing its way. */
  private stand(golem: Golem, onPost: boolean): void {
    const spot = onPost ? golem.post : golem.rest;
    const entity = this.host.stage.get(this.key(golem));
    if (entity) {
      try {
        stepBot(entity, 0, 0);
        entity.teleport(vec(spot.at), { rotation: { x: 0, y: spot.yaw } });
        return;
      } catch {
        // gone: put again
      }
    }
    this.host.stage.put(this.key(golem), ROLE, spot.at, spot.yaw);
  }

  /** The golems, placed if they haven't been (a game that started past the pre-game). */
  private ensure(): void {
    if (!this.placed) this.start();
  }

  private key(golem: Golem): string {
    return `golem:${golem.number}`;
  }

  private entity(golem: Golem): Entity | undefined {
    return this.host.stage.get(this.key(golem));
  }

  /**
   * A golem walks through `points` (its first is where it is), a leg at a time over the ground, after
   * any walk it's on now. `cutscene`: it stops where it is if the cutscene is skipped (the caller puts
   * it on its spot). `onPost`: once there, it stands on its post (true) or rest spot (false), as part
   * of the same walk, so a walk after it starts from there.
   */
  private walkGolem(golem: Golem, points: readonly Vec3[], cutscene: boolean, onPost?: boolean): Promise<void> {
    const before = this.walking.get(golem.number) ?? Promise.resolve();
    const walk = before.then(async () => {
      await this.walkAlong(golem, points, cutscene);
      if (onPost !== undefined) this.stand(golem, onPost);
    });
    this.walking.set(golem.number, walk);
    return walk.finally(() => {
      if (this.walking.get(golem.number) === walk) this.walking.delete(golem.number);
    });
  }

  private async walkAlong(golem: Golem, points: readonly Vec3[], cutscene: boolean): Promise<void> {
    const entity = this.entity(golem);
    if (!entity) return;
    const terrain = this.host.terrain;
    const { scope, stage } = this.host;
    const stop = () => scope.disposed || !entity.isValid || (cutscene && stage.skipping);
    try {
      for (let i = 1; i < points.length && !stop(); i++) {
        const at = entity.location;
        const a: Vec3 = [at.x, at.y, at.z];
        const b = points[i];
        const leg = legOf(a, b);
        if (leg.span < 0.05) continue;
        const plan = terrain ? planOf(terrain, a, b) : undefined;
        const follow = newFollow();
        const budget = Math.ceil(leg.span / GOLEM_WALK) + (plan?.climbTicks ?? 0) + STUCK_SLACK;
        let ticks = 0;
        for (; ticks < budget && !stop(); ticks++) {
          const here = entity.location;
          if (!plan) {
            const gap = Math.hypot(b[0] - here.x, b[2] - here.z);
            if (gap <= GOLEM_WALK) break;
            moveBot(entity, ((b[0] - here.x) / gap) * GOLEM_WALK, entity.getVelocity().y, ((b[2] - here.z) / gap) * GOLEM_WALK);
          } else {
            const next = followTick(plan, leg, follow, here, GOLEM_WALK);
            if (next.kind !== "push") {
              if (next.kind === "skip") ticks = budget;
              break;
            }
            moveBot(entity, next.want.x, next.up, next.want.z);
          }
          await scope.wait(1);
        }
        if (stop()) break;
        // Stuck for good on the leg (something in its way): put at its end, the one time a golem isn't walked.
        if (ticks >= budget) entity.teleport(vec(b));
      }
      if (entity.isValid) stepBot(entity, 0, 0);
    } catch (error) {
      log.warn(`blockparty: golem ${golem.number}'s walk failed: ${describeError(error)}`);
    }
  }
}

/** The leg's plan over the ground (walk-plan.ts), or none when the ground can't be read. */
function planOf(terrain: TerrainReader, a: Vec3, b: Vec3) {
  try {
    return planLeg(terrain, a, b, GOLEM_WALK);
  } catch {
    return undefined;
  }
}

/** A close shot of a golem on its spot: in front of it, at its eyes; along a cutscene's `way`, that way of it (it turns to face the camera). */
export function golemShot(spot: GolemSpot, way?: ShotWay): Shot {
  const [x, y, z] = spot.at;
  if (way) return wayShot([x, y + GOLEM_EYES - 0.2, z], way, FACE_AWAY, 3);
  const [fx, fz] = forward(spot.yaw);
  return { location: [x + fx * FACE_AWAY, y + GOLEM_EYES, z + fz * FACE_AWAY], facing: [x, y + GOLEM_EYES - 0.2, z] };
}

/** A point `away` blocks in front of a spot. */
function ahead(spot: GolemSpot, away: number): Vec3 {
  const [fx, fz] = forward(spot.yaw);
  return [spot.at[0] + fx * away, spot.at[1], spot.at[2] + fz * away];
}

/** Yaw 0 faces +z (south). */
function forward(yaw: number): [number, number] {
  const radians = (yaw * Math.PI) / 180;
  return [-Math.sin(radians), Math.cos(radians)];
}

function vec(at: Vec3): { x: number; y: number; z: number } {
  return { x: at[0], y: at[1], z: at[2] };
}

