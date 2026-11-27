// Hot TNT (FFA; the user's Hot Potato; docs/plans/block-party-minigames.md): one player holds a lit
// TNT and passes it with a hit (a push), never straight back for a moment. Its fuse is hidden, but it
// shows how close it is: smoke over the holder and a hiss, faster and louder. The holder runs a
// little faster. When it blows the holder is out, anyone within the Out distance too, and anyone
// further in the blast loses hearts (more the closer) and is thrown back. A new TNT then goes to a
// random player still in. When 2 are left it's over: more health wins, equal health ties. A game
// that starts with 2 ends at the first blast. The rest place by when they went out. Bots: the holder
// chases the nearest player; the others keep away from it.
import { EntityComponentTypes, world, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { BOT_RUN, BOT_WALK, botArm, botHold, botLook, botStep, everyTick, flat, isPlayer, item, nearestOf, now, onPlan, pick, placesBy } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** Ticks between one blast and the next TNT. */
const BETWEEN = 50;
/** How close a bot holder gets to pass. */
const BOT_PASS = 1.8;

export const HOT_TNT: MinigameDef = {
  id: "hottnt",
  name: "Hot TNT",
  kind: "ffa",
  rules: "Pass the lit TNT with a hit before it blows. When two are left, more health wins.",
  tutorial: [
    {
      objective: "Someone holds a lit TNT: hit a player to pass it on (not straight back). When it blows the holder is out and those near get hurt. With two left, more health wins.",
      controls: [
        { input: "attack", what: "Pass the TNT with a hit" },
        { input: "move", what: "Keep away from the holder" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("hottnt"),
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { scope, dimension, field } = play;
    const everyone = play.sides.flat();
    const fuseMin = play.setting("fuseMin") * 20;
    const fuseMax = Math.max(fuseMin, play.setting("fuseMax") * 20);
    const noPassBack = play.setting("noPassBack") * 2;
    const speed = play.setting("holderSpeed");
    const killRadius = play.setting("killRadius");
    const blastRadius = Math.max(killRadius + 0.5, play.setting("blastRadius"));
    const blastHearts = play.setting("blastHearts") * 2;
    const started = everyone.length;
    /** Health, out of 20, kept by the game: a player's mirrors their vanilla hearts. */
    const health = new Map(everyone.map((who) => [who.key, 20]));
    const outAt = new Map<string, number>();
    let holder: Who | undefined;
    let passedFrom: { key: string; at: number } | undefined;
    play.hits("push", 1);
    const healthOf = (who: Who) => {
      if (!who.player) return health.get(who.key) ?? 0;
      try {
        return who.player.getComponent(EntityComponentTypes.Health)?.currentValue ?? 0;
      } catch {
        return 0;
      }
    };
    const setHealth = (who: Who, value: number) => {
      health.set(who.key, value);
      try {
        who.player?.getComponent(EntityComponentTypes.Health)?.setCurrentValue(Math.max(1, value));
      } catch {
        // gone
      }
    };
    const handTo = (who: Who) => {
      if (holder?.player) holder.player.getComponent(EntityComponentTypes.Inventory)?.container?.setItem(0, undefined);
      else if (holder) botHold(play, holder, undefined);
      try {
        holder?.player?.removeEffect("speed");
      } catch {
        // gone
      }
      holder = who;
      play.give(who, item("minecraft:tnt", { name: "Lit TNT" }), 0);
      try {
        if (who.player) who.player.selectedSlotIndex = 0;
        if (speed > 0) who.player?.addEffect("speed", 20 * 120, { amplifier: speed - 1, showParticles: false });
      } catch {
        // gone
      }
      play.tell(who, "You have the TNT! Pass it on.", 40);
    };
    const pass = (from: Who, to: Who) => {
      if (holder?.key !== from.key || play.isOut(to) || to.key === from.key) return;
      if (passedFrom && passedFrom.key === to.key && now() - passedFrom.at < noPassBack) return;
      passedFrom = { key: from.key, at: now() };
      handTo(to);
      play.say(`${from.name} passed it to ${to.name}.`);
    };
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (!isPlayer(damagingEntity) || !holder || holder.player?.id !== damagingEntity.id) return;
      const to = play.inPlay().find((who) => play.bodyOf(who)?.id === hitEntity.id);
      if (to) pass(holder, to);
    });
    const ended = () => (started <= 2 ? outAt.size > 0 : play.inPlay().length <= 2);
    let round = 0;
    while (!scope.disposed && !ended() && play.inPlay().length > 1) {
      round++;
      handTo(pick(play.inPlay(), play.random));
      passedFrom = undefined;
      const fuse = fuseMin + Math.floor(play.random() * Math.max(1, fuseMax - fuseMin));
      await everyTick(play, fuse, (tick) => {
        const body = holder && play.bodyOf(holder);
        const left = fuse - tick;
        // How close it is: smoke and a hiss, faster as it comes.
        const every = left < 60 ? 3 : left < 160 ? 8 : 16;
        if (body && tick % every === 0) {
          try {
            dimension.spawnParticle("minecraft:basic_smoke_particle", { x: body.location.x, y: body.location.y + 2.3, z: body.location.z });
          } catch {
            // unloaded
          }
          if (tick % (every * 3) === 0) dimension.playSound("random.fuse", body.location, { volume: left < 60 ? 1.5 : 0.7 });
        }
        for (const who of play.inPlay()) {
          const me = play.bodyOf(who);
          if (!me || isPlayer(me) || !body || !holder) continue;
          if (who.key === holder.key) {
            const target = nearestOf(
              play,
              me.location,
              play.inPlay().filter((one) => one.key !== who.key && !(passedFrom?.key === one.key && now() - passedFrom.at < noPassBack)),
            );
            if (target && target.gap < BOT_PASS) {
              botLook(play, who, target.body.location, true);
              botArm(play, who);
              play.push(target.who, me.location, 1);
              pass(who, target.who);
            } else if (target) botStep(play, who, target.body.location, BOT_RUN, 1);
          } else {
            // Away from the holder, kept inside the arena.
            const away = { x: me.location.x * 2 - body.location.x, y: me.location.y, z: me.location.z * 2 - body.location.z };
            const clamp: Vector3 = {
              x: Math.max(field.min.x + 1.5, Math.min(field.min.x + field.size[0] - 1.5, away.x)),
              y: away.y,
              z: Math.max(field.min.z + 1.5, Math.min(field.min.z + field.size[2] - 1.5, away.z)),
            };
            if (flat(me.location, body.location) < 7) botStep(play, who, clamp, BOT_WALK, 0.5);
          }
        }
        if (tick % 5 === 0) play.status(`${holder ? `${holder.name} has it` : ""}  ${play.inPlay().length} left`);
      });
      if (scope.disposed || !holder) break;
      // The blast.
      const center = play.bodyOf(holder)?.location;
      if (!center) break;
      try {
        dimension.spawnParticle("minecraft:huge_explosion_emitter", center);
      } catch {
        // unloaded
      }
      dimension.playSound("random.explode", center, { volume: 3 });
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body) continue;
        const gap = who.key === holder.key ? 0 : flat(body.location, center);
        if (gap <= killRadius) {
          outAt.set(who.key, round);
          play.out(who);
          play.say(`${who.name} was ${who.key === holder.key ? "holding it" : "too close"}.`);
        } else if (gap <= blastRadius) {
          const share = 1 - (gap - killRadius) / (blastRadius - killRadius);
          setHealth(who, healthOf(who) - Math.max(1, Math.round(blastHearts * share)));
          play.push(who, center, 1 + share * 1.5);
        }
      }
      holder.player?.getComponent(EntityComponentTypes.Inventory)?.container?.setItem(0, undefined);
      holder = undefined;
      await scope.wait(BETWEEN);
    }
    // Still in by health (equal ties), then by when they went out.
    const still = play.inPlay().map((who) => who.key);
    const first = placesBy(still, (key) => healthOf(everyone.find((who) => who.key === key)!));
    const gone = placesBy(
      everyone.map((who) => who.key).filter((key) => outAt.has(key)),
      (key) => outAt.get(key) ?? 0,
    );
    return { places: [...first, ...gone] };
  },
};
