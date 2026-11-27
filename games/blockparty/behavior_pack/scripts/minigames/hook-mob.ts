// Hook the Mob (FFA, and 2v2 by its teams; docs/plans/block-party-minigames.md): mobs wander the pool
// in the middle; each player stands at the edge of their own pit. Cast your fishing rod, hook a mob,
// and reel it in: it flies up in an arc toward where you're looking, as far as the reach. Land it in
// your pit to score (chickens 1, pigs 2, sheep 2, cows 3). A creeper in a pit blows, and that pit's
// player loses 3: aim one at someone else's. Most points wins. A hook landing on a mob hooks it;
// the second use reels it in. One that lands outside every pit goes back to the pool. Vanilla mobs
// (creepers break no blocks while it plays). Bots throw the nearest good mob into their pit every few
// seconds, now and then a creeper into the leader's.
import { world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { clock, everyTick, flat, inside, item, onPlan, pick, placesBy, removeEntity, sideMap, spawnIn, spotIn, winnerBy } from "./common.ts";
import { inOrder, middleOf, type MinigameDef, type Outcome, type Play } from "./kit.ts";

const MOBS = [
  { type: "minecraft:chicken", points: 1 },
  { type: "minecraft:pig", points: 2 },
  { type: "minecraft:sheep", points: 2 },
  { type: "minecraft:cow", points: 3 },
] as const;
const CREEPER = "minecraft:creeper";
const CREEPER_COST = 3;
/** A throw's ticks in the air, and its height at the top. */
const FLIGHT = 24;
const ARC = 5;
/** Ticks between a bot's throws. */
const BOT_EVERY = 70;

interface Mob {
  entity: Entity;
  type: string;
  points: number;
  /** In the air: from, to, ticks flown; and who threw it. */
  flying?: { from: Vector3; to: Vector3; t: number; by: Who };
}

export const HOOK_MOB: MinigameDef = {
  id: "hookmob",
  name: "Hook the Mob",
  kind: "ffa",
  rules: "Hook a mob with your rod and reel it into your pit. Creepers cost the pit they land in.",
  tutorial: [
    {
      objective: "Cast your rod at a mob, then reel it in: it flies toward where you look. Land it in your pit to score; land a creeper in someone else's to cost them.",
      controls: [
        { input: "use", what: "Cast, then reel in" },
        { input: "move", what: "Aim at your pit with where you look" },
      ],
    },
  ],
  ...onPlan("hookmob"),
  problem(field) {
    if (!field.regions(MARKUP.pool)[0]) return "its arena map has no Pool";
    return field.regions(MARKUP.pits).length > 0 ? undefined : "its arena map has no Pits";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension, sides } = play;
    const pool = field.regions(MARKUP.pool)[0];
    const pits = field.regions(MARKUP.pits);
    const everyone = sides.flat();
    const sideOf = sideMap(sides);
    const pitOf = new Map(everyone.map((who, i) => [who.key, i]));
    const total = play.setting("playTime") * 20;
    const most = play.setting("mobs");
    const creepers = play.setting("creeperShare") / 100;
    const reach = play.setting("reach");
    const scores = sides.map(() => 0);
    const mobs: Mob[] = [];
    const hooked = new Map<string, Mob>();
    const griefing = world.gameRules.mobGriefing;
    world.gameRules.mobGriefing = false;
    scope.add(() => (world.gameRules.mobGriefing = griefing));
    const spawnMob = () => {
      const creeper = play.random() < creepers;
      const kind = creeper ? { type: CREEPER, points: -CREEPER_COST } : pick(MOBS, play.random);
      const entity = spawnIn(play, kind.type, spotIn(pool, play.random, 1));
      if (entity) mobs.push({ entity, type: kind.type, points: kind.points });
    };
    for (let i = 0; i < most; i++) spawnMob();
    for (const who of everyone) play.give(who, item("minecraft:fishing_rod"), 0);
    const throwMob = (mob: Mob, by: Who, to: Vector3) => {
      if (mob.flying || !mob.entity.isValid) return;
      mob.flying = { from: { ...mob.entity.location }, to, t: 0, by };
      for (const [key, one] of hooked) if (one === mob) hooked.delete(key);
    };
    // Hooked: the rod's hook lands on a mob.
    scope.subscribe(world.afterEvents.projectileHitEntity, (event) => {
      if (event.projectile.typeId !== "minecraft:fishing_hook") return;
      const hit = event.getEntityHit()?.entity;
      const mob = mobs.find((one) => hit && one.entity.isValid && one.entity.id === hit.id);
      const who = everyone.find((one) => one.player?.id === event.source?.id);
      if (mob && who && !mob.flying) {
        hooked.set(who.key, mob);
        play.tell(who, "Hooked! Use again to reel it in.", 40);
      }
    });
    // Reeled in: toward where they look, as far as the reach.
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (itemStack.typeId !== "minecraft:fishing_rod") return;
      const who = everyone.find((one) => one.player?.id === source.id);
      const mob = who && hooked.get(who.key);
      if (!who || !mob) return;
      throwMob(mob, who, aimOf(source, reach));
    });
    const land = (mob: Mob) => {
      const at = mob.entity.location;
      const pit = pits.findIndex((box) => inside(box, at, 0.8));
      if (pit < 0) {
        // Back to the pool.
        mob.entity.teleport(spotIn(pool, play.random, 1));
        return;
      }
      const owner = everyone.find((who) => pitOf.get(who.key) === pit);
      const side = owner ? sideOf.get(owner.key) : undefined;
      if (side !== undefined) scores[side] += mob.points;
      if (mob.type === CREEPER) {
        try {
          dimension.spawnParticle("minecraft:huge_explosion_emitter", at);
        } catch {
          // unloaded
        }
        dimension.playSound("random.explode", at, { volume: 2 });
        if (owner) play.say(`A creeper blew up ${owner.name}'s pit.`);
      } else if (owner) play.tell(owner, `+${mob.points}`, 20);
      mobs.splice(mobs.indexOf(mob), 1);
      removeEntity(mob.entity);
      spawnMob();
    };
    const nextBot = new Map(everyone.filter((who) => !who.player).map((who) => [who.key, 30 + Math.floor(play.random() * 40)]));
    await everyTick(play, total, (tick) => {
      for (const mob of [...mobs]) {
        if (!mob.entity.isValid) {
          mobs.splice(mobs.indexOf(mob), 1);
          spawnMob();
          continue;
        }
        const flight = mob.flying;
        if (flight) {
          flight.t++;
          const k = flight.t / FLIGHT;
          const at = { x: flight.from.x + (flight.to.x - flight.from.x) * k, y: flight.from.y + (flight.to.y - flight.from.y) * k + ARC * 4 * k * (1 - k), z: flight.from.z + (flight.to.z - flight.from.z) * k };
          try {
            mob.entity.teleport(at);
            mob.entity.clearVelocity();
          } catch {
            // gone
          }
          if (flight.t >= FLIGHT) {
            mob.flying = undefined;
            land(mob);
          }
        } else if (tick % 10 === 0 && !inside(pool, mob.entity.location, 1)) {
          mob.entity.teleport(spotIn(pool, play.random, 1));
        }
      }
      // Bots: the nearest good mob into their own pit; now and then a creeper into the leader's.
      for (const who of everyone) {
        if (who.player || tick < (nextBot.get(who.key) ?? 0)) continue;
        nextBot.set(who.key, tick + BOT_EVERY + Math.floor(play.random() * 40));
        const body = play.bodyOf(who);
        if (!body) continue;
        const own = pits[pitOf.get(who.key) ?? 0];
        const creeper = mobs.find((one) => one.type === CREEPER && !one.flying);
        const leaderSide = scores.indexOf(Math.max(...scores));
        const leader = everyone.find((one) => sideOf.get(one.key) === leaderSide && one.key !== who.key);
        if (creeper && leader && play.random() < 0.25) {
          const theirs = pits[pitOf.get(leader.key) ?? 0];
          if (theirs) throwMob(creeper, who, middleOf(theirs));
          continue;
        }
        const good = mobs.filter((one) => one.type !== CREEPER && !one.flying).sort((a, b) => flat(a.entity.location, body.location) - flat(b.entity.location, body.location))[0];
        if (good && own) throwMob(good, who, play.random() < 0.7 ? middleOf(own) : spotIn(pool, play.random));
      }
      if (tick % 5 === 0) play.status(`${sides.map((side, s) => `${side.map((one) => one.name).join("+")} ${scores[s]}`).join("  ")}  ${clock(total - tick)}`);
    });
    if (sides.every((side) => side.length === 1)) return { places: placesBy(sides.map((side) => side[0].key), (key) => scores[sideOf.get(key) ?? 0]) };
    return { winner: winnerBy(scores) };
  },
};

/** Where a player's reel throws to: the block they look at, or as far as the reach the way they look, on the ground. */
function aimOf(player: Player, reach: number): Vector3 {
  try {
    const hit = player.getBlockFromViewDirection({ maxDistance: reach });
    if (hit) return { x: hit.block.location.x + 0.5, y: hit.block.location.y + 1, z: hit.block.location.z + 0.5 };
  } catch {
    // nothing in reach
  }
  const view = player.getViewDirection();
  const length = Math.hypot(view.x, view.z) || 1;
  return { x: player.location.x + (view.x / length) * reach, y: player.location.y, z: player.location.z + (view.z / length) * reach };
}
