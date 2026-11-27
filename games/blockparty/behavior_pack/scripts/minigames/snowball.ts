// Snowball Sniper (FFA; docs/plans/block-party-minigames.md): targets slide back and forth across
// the arena, one in each Target lane (along its long side, at its middle); everyone throws snowballs
// (kept topped up) from their stand. A hit scores the target's points: 1 for every 10 blocks from the
// stands. Most points wins. The targets are the board's coin for now. Snowballs do nothing to
// players. Bots throw where a target will be every second or so, hitting about half the time.
import { EntityComponentTypes, ItemStack, world, type Entity, type Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { clock, everyTick, flat, onPlan, placesBy, spawnIn, throwFrom } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play, type WorldBox } from "./kit.ts";

/** Snowballs a player is kept topped up to. */
const SNOWBALLS = 16;
/** Ticks between a bot's throws. */
const BOT_THROW = 22;

interface Target {
  entity: Entity | undefined;
  lane: WorldBox;
  /** Its way along the lane: x or z, from and to, and where it is now (0 to 1, and which way). */
  alongX: boolean;
  from: number;
  to: number;
  t: number;
  dir: number;
  points: number;
}

function placeOf(target: Target): Vector3 {
  const { lane } = target;
  const pos = target.from + (target.to - target.from) * target.t;
  const mid = target.alongX ? (lane.min.z + lane.max.z + 1) / 2 : (lane.min.x + lane.max.x + 1) / 2;
  return target.alongX ? { x: pos, y: lane.min.y, z: mid } : { x: mid, y: lane.min.y, z: pos };
}

export const SNOWBALL: MinigameDef = {
  id: "snowball",
  name: "Snowball Sniper",
  kind: "ffa",
  rules: "Throw snowballs at the sliding targets. The far ones score more.",
  tutorial: [
    {
      objective: "Throw snowballs at the targets sliding across the arena: the further away, the more a hit scores. Most points wins.",
      controls: [
        { input: "use", what: "Throw a snowball" },
        { input: "move", what: "Get a better angle" },
      ],
    },
  ],
  ...onPlan("snowball"),
  problem(field) {
    return field.regions(MARKUP.targets).length > 0 ? undefined : "its arena map has no Target lanes";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope } = play;
    const everyone = play.sides.flat();
    const total = play.setting("playTime") * 20;
    const speed = play.setting("targetSpeed") / 20;
    const stands = field.spawns[0] ?? { x: field.min.x, y: field.min.y, z: field.min.z };
    const points = new Map(everyone.map((who) => [who.key, 0]));
    const targets: Target[] = field.regions(MARKUP.targets).map((lane) => {
      const alongX = lane.max.x - lane.min.x >= lane.max.z - lane.min.z;
      const from = alongX ? lane.min.x + 0.5 : lane.min.z + 0.5;
      const to = alongX ? lane.max.x + 0.5 : lane.max.z + 0.5;
      const middle = { x: (lane.min.x + lane.max.x + 1) / 2, y: lane.min.y, z: (lane.min.z + lane.max.z + 1) / 2 };
      const target: Target = { entity: undefined, lane, alongX, from, to, t: play.random(), dir: play.random() < 0.5 ? 1 : -1, points: Math.max(1, Math.round(flat(middle, stands) / 10)) };
      target.entity = spawnIn(play, "blockparty:coin", placeOf(target), undefined, `${target.points}`);
      return target;
    });
    const topUp = () => {
      for (const who of everyone) {
        try {
          const container = who.player?.getComponent(EntityComponentTypes.Inventory)?.container;
          const have = container?.getItem(0);
          if (container && (have?.typeId !== "minecraft:snowball" || have.amount < SNOWBALLS)) container.setItem(0, new ItemStack("minecraft:snowball", SNOWBALLS));
        } catch {
          // gone
        }
      }
    };
    topUp();
    scope.subscribe(world.afterEvents.projectileHitEntity, (event) => {
      const hit = event.getEntityHit()?.entity;
      const target = targets.find((one) => hit && one.entity?.isValid && one.entity.id === hit.id);
      const who = target && everyone.find((one) => play.bodyOf(one)?.id === event.source?.id);
      if (!target || !who) return;
      points.set(who.key, (points.get(who.key) ?? 0) + target.points);
      play.tell(who, `Hit! +${target.points}`, 20);
      play.dimension.playSound("random.orb", target.entity!.location);
    });
    const nextThrow = new Map(everyone.filter((who) => !who.player).map((who) => [who.key, 10 + Math.floor(play.random() * 20)]));
    await everyTick(play, total, (tick) => {
      for (const target of targets) {
        const length = Math.abs(target.to - target.from) || 1;
        target.t += (target.dir * speed) / length;
        if (target.t >= 1 || target.t <= 0) {
          target.t = Math.max(0, Math.min(1, target.t));
          target.dir *= -1;
        }
        try {
          if (target.entity?.isValid) target.entity.teleport(placeOf(target));
        } catch {
          // gone
        }
      }
      if (tick % 20 === 0) topUp();
      for (const who of everyone) {
        if (who.player || tick < (nextThrow.get(who.key) ?? 0)) continue;
        const body = play.bodyOf(who);
        if (!body || targets.length === 0) continue;
        nextThrow.set(who.key, tick + BOT_THROW + Math.floor(play.random() * 10));
        // Leads the target by its travel over the flight.
        const target = targets[Math.floor(play.random() * targets.length)];
        const now = placeOf(target);
        const flight = flat(body.location, now) / 1.5;
        const ahead = { ...target, t: Math.max(0, Math.min(1, target.t + (target.dir * speed * flight) / (Math.abs(target.to - target.from) || 1))) };
        const aim = placeOf(ahead);
        throwFrom(play, body, { x: aim.x, y: aim.y + 0.6, z: aim.z }, { error: 1.4 });
      }
      if (tick % 5 === 0) play.status(`${everyone.map((who) => `${who.name} ${points.get(who.key)}`).join("  ")}  ${clock(total - tick)}`);
    });
    return { places: placesBy(everyone.map((who) => who.key), (key) => points.get(key) ?? 0) };
  },
};
