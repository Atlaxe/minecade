// Minecart Dodge (FFA; docs/plans/block-party-minigames.md): a lane-crossing race through a
// mineshaft, from the start across the lanes to the Finish. Track lanes: carts run along them, each
// lane its own speed and way, now and then a TNT cart that blows when it reaches a player, sending
// everyone near back; a cart that hits you sends you back to the start. Water lanes: logs float along
// them, carrying whoever stands on them; falling in the water sends you back. First over the Finish
// wins; at time the rest place by the furthest lane reached, then by who got there first.
// The carts are vanilla's minecarts moved by script (their rail physics can't be told where to go).
// The logs are blocks moved a block at a time, carrying their riders with them (the plan's fallback
// for piece 17, which needs its spike for smooth logs). Bots wait for a gap in a track lane and for a
// log under their next step.
import type { Entity, Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, botStop, botStep, clock, everyTick, flat, moveTo, onPlan, pick, placesBy, removeEntity, setBlock, spawnIn } from "./common.ts";
import { inOrder, middleOf, over, type MinigameDef, type Outcome, type Play, type WorldBox } from "./kit.ts";

const CARTS = ["minecraft:minecart", "minecraft:chest_minecart", "minecraft:hopper_minecart"] as const;
const TNT_CART = "minecraft:tnt_minecart";
const LOG = "minecraft:oak_log";
const WATER = "minecraft:water";
/** How close a cart gets to hit a player. */
const HIT = 0.9;
/** How far up a lane a bot looks for a coming cart. */
const BOT_SAFE = 5;

interface Lane {
  box: WorldBox;
  alongX: boolean;
  /** Its way (+1 or -1) and speed, blocks a tick. */
  dir: number;
  speed: number;
  /** Where along the crossing it is (its middle across the lane). */
  cross: number;
}

interface Cart {
  entity: Entity | undefined;
  lane: Lane;
  pos: number;
  tnt: boolean;
}

interface Log {
  lane: Lane;
  /** Its back end along the lane, and its length. */
  pos: number;
  length: number;
  next: number;
}

function laneOf(box: WorldBox, random: () => number, speed: number, index: number): Lane {
  const alongX = box.max.x - box.min.x >= box.max.z - box.min.z;
  return { box, alongX, dir: index % 2 === 0 ? 1 : -1, speed: speed * (0.8 + random() * 0.4), cross: alongX ? (box.min.z + box.max.z + 1) / 2 : (box.min.x + box.max.x + 1) / 2 };
}

function laneStart(lane: Lane): number {
  const lo = lane.alongX ? lane.box.min.x : lane.box.min.z;
  const hi = (lane.alongX ? lane.box.max.x : lane.box.max.z) + 1;
  return lane.dir > 0 ? lo : hi;
}

function laneEnd(lane: Lane): number {
  const lo = lane.alongX ? lane.box.min.x : lane.box.min.z;
  const hi = (lane.alongX ? lane.box.max.x : lane.box.max.z) + 1;
  return lane.dir > 0 ? hi : lo;
}

function pointOn(lane: Lane, pos: number): Vector3 {
  return lane.alongX ? { x: pos, y: lane.box.min.y, z: lane.cross } : { x: lane.cross, y: lane.box.min.y, z: pos };
}

export const MINECARTS: MinigameDef = {
  id: "minecarts",
  name: "Minecart Dodge",
  kind: "ffa",
  rules: "Cross the mineshaft to the Finish: dodge the carts, ride the logs over the water.",
  tutorial: [
    {
      objective: "Get across to the Finish. A cart that hits you, or the water, sends you back to the start. Ride the logs across the water. First over wins.",
      controls: [
        { input: "move", what: "Cross the lanes" },
        { input: "jump", what: "Hop onto the logs" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("minecarts"),
  problem(field) {
    return field.regions(MARKUP.finish)[0] ? undefined : "its arena map has no Finish";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, dimension } = play;
    const finish = field.regions(MARKUP.finish)[0];
    const goal = middleOf(finish);
    const everyone = play.sides.flat();
    const starts = new Map(everyone.map((who, i) => [who.key, field.spawns[i] ?? field.spawns[0]]));
    const total = play.setting("playTime") * 20;
    const cartSpeed = play.setting("cartSpeed") / 20;
    const cartGap = play.setting("cartGap") * 2;
    const tntShare = play.setting("tntShare") / 100;
    const tntRadius = play.setting("tntRadius");
    const logSpeed = play.setting("logSpeed") / 20;
    const logMin = play.setting("logMin");
    const logMax = Math.max(logMin, play.setting("logMax"));
    const respawn = play.setting("respawn") * 2;
    const tracks = field.regions(MARKUP.tracks).map((box, i) => laneOf(box, play.random, cartSpeed, i));
    const waters = field.regions(MARKUP.waterLanes).map((box, i) => laneOf(box, play.random, logSpeed, i + 1));
    const carts: Cart[] = [];
    const logs: Log[] = [];
    const nextCart = tracks.map(() => Math.floor(play.random() * cartGap));
    const nextLog = waters.map(() => 0);
    /** How far along the crossing each player has got (the start's line is 0), and when. */
    const startLine = field.spawns[0] ?? goal;
    const crossing = (at: Vector3) => flat(at, startLine);
    const furthest = new Map(everyone.map((who) => [who.key, { gap: 0, at: 0 }]));
    const finished: string[] = [];
    const resting = new Map<string, number>();
    const sendBack = (who: (typeof everyone)[number], why: string, tick: number) => {
      if (resting.has(who.key)) return;
      resting.set(who.key, tick + Math.max(1, respawn));
      play.tell(who, `${why} Back to the start.`, 30);
      const start = starts.get(who.key);
      if (start) moveTo(who, play.bodyOf(who), start);
      play.freeze(who, Math.max(1, respawn));
    };
    const logBlocks = (log: Log): Vector3[] =>
      Array.from({ length: log.length }, (_, i) => {
        const at = pointOn(log.lane, Math.floor(log.pos) - log.lane.dir * i);
        return { x: Math.floor(at.x), y: log.lane.box.min.y, z: Math.floor(at.z) };
      });
    const onLog = (at: Vector3) => logs.some((log) => logBlocks(log).some((block) => Math.floor(at.x) === block.x && Math.floor(at.z) === block.z && Math.abs(at.y - (block.y + 1)) < 0.4));
    await everyTick(play, total, (tick) => {
      // Carts come along each track lane, now and then a TNT one.
      tracks.forEach((lane, i) => {
        if (tick < nextCart[i]) return;
        nextCart[i] = tick + Math.round(cartGap * (0.6 + play.random() * 0.8));
        const tnt = play.random() < tntShare;
        const pos = laneStart(lane);
        carts.push({ entity: spawnIn(play, tnt ? TNT_CART : pick(CARTS, play.random), pointOn(lane, pos), lane.alongX ? (lane.dir > 0 ? -90 : 90) : lane.dir > 0 ? 0 : 180), lane, pos, tnt });
      });
      for (const cart of [...carts]) {
        cart.pos += cart.lane.dir * cart.lane.speed;
        const at = pointOn(cart.lane, cart.pos);
        if ((cart.lane.dir > 0 && cart.pos > laneEnd(cart.lane)) || (cart.lane.dir < 0 && cart.pos < laneEnd(cart.lane)) || !cart.entity?.isValid) {
          removeEntity(cart.entity);
          carts.splice(carts.indexOf(cart), 1);
          continue;
        }
        try {
          cart.entity.teleport(at);
          cart.entity.clearVelocity();
        } catch {
          // gone
        }
        for (const who of play.inPlay()) {
          const body = play.bodyOf(who);
          if (!body || resting.has(who.key) || finished.includes(who.key) || flat(body.location, at) > HIT || Math.abs(body.location.y - at.y) > 1.5) continue;
          if (cart.tnt) {
            try {
              dimension.spawnParticle("minecraft:huge_explosion_emitter", at);
            } catch {
              // unloaded
            }
            dimension.playSound("random.explode", at, { volume: 2 });
            for (const near of play.inPlay()) {
              const nearBody = play.bodyOf(near);
              if (nearBody && flat(nearBody.location, at) <= tntRadius) sendBack(near, "Boom!", tick);
            }
            removeEntity(cart.entity);
            carts.splice(carts.indexOf(cart), 1);
            break;
          }
          sendBack(who, "A cart got you!", tick);
        }
      }
      // Logs float along each water lane, carrying whoever stands on them a block at a time.
      waters.forEach((lane, i) => {
        if (tick < nextLog[i]) return;
        const length = logMin + Math.floor(play.random() * (logMax - logMin + 1));
        nextLog[i] = tick + Math.round((length + 2 + play.random() * 4) / lane.speed);
        logs.push({ lane, pos: laneStart(lane) + (lane.dir > 0 ? 0 : -1), length, next: tick });
      });
      for (const log of [...logs]) {
        if (tick < log.next) continue;
        log.next = tick + Math.max(1, Math.round(1 / log.lane.speed));
        const before = logBlocks(log);
        // Riders move with it.
        const riders = play.inPlay().filter((who) => {
          const body = play.bodyOf(who);
          return body && before.some((block) => Math.floor(body.location.x) === block.x && Math.floor(body.location.z) === block.z && Math.abs(body.location.y - (block.y + 1)) < 0.6);
        });
        for (const block of before) setBlock(dimension, block, WATER);
        log.pos += log.lane.dir;
        const after = logBlocks(log);
        const gone = after.every((block) => (log.lane.alongX ? block.x < log.lane.box.min.x || block.x > log.lane.box.max.x : block.z < log.lane.box.min.z || block.z > log.lane.box.max.z));
        if (gone) {
          logs.splice(logs.indexOf(log), 1);
          continue;
        }
        for (const block of after) {
          const inLane = log.lane.alongX ? block.x >= log.lane.box.min.x && block.x <= log.lane.box.max.x : block.z >= log.lane.box.min.z && block.z <= log.lane.box.max.z;
          if (inLane) setBlock(dimension, block, LOG, { pillar_axis: log.lane.alongX ? "x" : "z" });
        }
        for (const who of riders) {
          const body = play.bodyOf(who);
          if (!body) continue;
          const step = log.lane.alongX ? { x: log.lane.dir, z: 0 } : { x: 0, z: log.lane.dir };
          try {
            body.teleport({ x: body.location.x + step.x, y: body.location.y, z: body.location.z + step.z }, { keepVelocity: true });
          } catch {
            // gone
          }
        }
      }
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body || finished.includes(who.key)) continue;
        const back = resting.get(who.key);
        if (back !== undefined) {
          if (tick < back) continue;
          resting.delete(who.key);
        }
        if (over(finish, body.location, 1, 2)) {
          finished.push(who.key);
          play.say(`${who.name} made it across${finished.length === 1 ? " first" : ""}.`);
          continue;
        }
        const at = body.location;
        if (blockId(dimension, at).includes("water") && !onLog(at)) {
          sendBack(who, "In the water!", tick);
          continue;
        }
        const gap = Math.floor(crossing(at));
        const best = furthest.get(who.key)!;
        if (gap > best.gap) furthest.set(who.key, { gap, at: tick });
        if (who.player) continue;
        // A bot: forward when the way ahead is clear (no cart coming, a log under its next step).
        const toward = { x: goal.x - at.x, z: goal.z - at.z };
        const length = Math.hypot(toward.x, toward.z) || 1;
        const ahead = { x: at.x + (toward.x / length) * 1.2, y: at.y, z: at.z + (toward.z / length) * 1.2 };
        const track = tracks.find((lane) => Math.abs((lane.alongX ? ahead.z : ahead.x) - lane.cross) < 1);
        const water = waters.find((lane) => Math.abs((lane.alongX ? ahead.z : ahead.x) - lane.cross) < 1);
        const cartComing = track && carts.some((cart) => cart.lane === track && flat(pointOn(track, cart.pos), ahead) < BOT_SAFE && (cart.lane.dir > 0 ? cart.pos < (track.alongX ? ahead.x : ahead.z) + 1 : cart.pos > (track.alongX ? ahead.x : ahead.z) - 1));
        const below = blockId(dimension, { x: ahead.x, y: at.y - 1, z: ahead.z });
        const noLog = water !== undefined && !below.includes("log");
        if (cartComing || noLog) botStop(play, who);
        else botStep(play, who, { x: ahead.x, y: below.includes("log") ? at.y + 0.6 : at.y, z: ahead.z }, BOT_WALK, 0.1);
      }
      if (tick % 5 === 0) play.status(`Across ${finished.length}  ${clock(total - tick)}`);
      return finished.length >= play.inPlay().length;
    });
    for (const log of logs) for (const block of logBlocks(log)) setBlock(dimension, block, WATER);
    const rest = everyone.map((who) => who.key).filter((key) => !finished.includes(key));
    return { places: [...finished.map((key) => [key]), ...placesBy(rest, (key) => (furthest.get(key)?.gap ?? 0) * 100000 - (furthest.get(key)?.at ?? 0))] };
  },
};
