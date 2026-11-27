// Button Mash (FFA; docs/plans/block-party-minigames.md): each player faces a big button of their
// own. On Go, hit it as many times as you can; its count rises over it. When time's up a cutscene goes
// through the players from last place to first: the camera on each in turn as they blast up into the
// sky on a firework trail, higher for more hits, the winner last and highest. Most hits wins; equal
// counts tie. The button is the board's coin for now (a model of its own comes later); a hit counts
// on your own button only. Players are held in place throughout. Bots hit every 3 to 5 ticks (a
// Medium bot's: botWait).
import { world, type Entity } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { botFace, botWait, clock, everyTick, isPlayer, moveTo, onPlan, placesBy, spawnIn } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** Each launch's ticks, and how hard the highest launch goes up (applyKnockback's vertical). */
const LAUNCH = 44;
const MOST_UP = 3.2;

export const BUTTON_MASH: MinigameDef = {
  id: "buttonmash",
  name: "Button Mash",
  kind: "ffa",
  rules: "Hit your button as many times as you can before time's up. Most hits wins.",
  tutorial: [
    {
      objective: "Hit your own button as fast as you can until time's up. Most hits wins, and blasts off highest.",
      controls: [{ input: "attack", what: "Hit your button" }],
    },
  ],
  ...onPlan("buttonmash"),
  problem(field) {
    return field.points(MARKUP.buttons).length >= 2 ? undefined : "its arena map needs a button for each spawn";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension } = play;
    const everyone = play.sides.flat();
    const buttons = field.points(MARKUP.buttons);
    const total = play.setting("playTime") * 20;
    const hits = new Map(everyone.map((who) => [who.key, 0]));
    const buttonOf = new Map<string, Entity>();
    everyone.forEach((who, i) => {
      const spot = buttons[i];
      const button = spot && spawnIn(play, "blockparty:coin", spot, spot.yaw, "0");
      if (button) buttonOf.set(who.key, button);
      play.freeze(who, total + LAUNCH * everyone.length + 100);
    });
    const hit = (who: Who) => {
      hits.set(who.key, (hits.get(who.key) ?? 0) + 1);
      const button = buttonOf.get(who.key);
      if (button?.isValid) button.nameTag = String(hits.get(who.key));
    };
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (!isPlayer(damagingEntity)) return;
      const who = everyone.find((one) => one.player?.id === damagingEntity.id);
      if (who && buttonOf.get(who.key)?.id === hitEntity.id) hit(who);
    });
    const nextBotHit = new Map(everyone.filter((who) => !who.player).map((who) => [who.key, 3]));
    const soonest = botWait(play, 3);
    const latest = botWait(play, 5);
    await everyTick(play, total, (tick) => {
      for (const who of everyone) {
        if (who.player) continue;
        const body = play.bodyOf(who);
        const button = buttonOf.get(who.key);
        if (!body || !button?.isValid) continue;
        if (tick === 0) botFace(body, button.location);
        if (tick >= (nextBotHit.get(who.key) ?? 0)) {
          hit(who);
          nextBotHit.set(who.key, tick + soonest + Math.floor(play.random() * (latest - soonest + 1)));
        }
      }
      if (tick % 5 === 0) play.status(`Hit it!  ${clock(total - tick)}`);
    });
    const places = placesBy(everyone.map((who) => who.key), (key) => hits.get(key) ?? 0);
    // The launches, last place first: the camera on each as they blast up, higher for more hits.
    const best = Math.max(1, ...hits.values());
    const order = [...places].reverse().flat();
    for (const key of order) {
      if (scope.disposed) break;
      const who = everyone.find((one) => one.key === key);
      const body = who && play.bodyOf(who);
      if (!who || !body) continue;
      const start = { ...body.location };
      const button = buttonOf.get(key);
      const from = button?.isValid ? button.location : { x: start.x, y: start.y, z: start.z + 3 };
      for (const viewer of everyone) {
        try {
          viewer.player?.camera.setCamera("minecraft:free", { location: { x: from.x, y: from.y + 1, z: from.z }, facingLocation: { x: start.x, y: start.y + 8, z: start.z } });
        } catch {
          // gone
        }
      }
      const up = 0.8 + (MOST_UP - 0.8) * ((hits.get(key) ?? 0) / best);
      try {
        if (isPlayer(body)) body.applyKnockback({ x: 0, z: 0 }, up);
        else body.applyImpulse({ x: 0, y: up * 0.55, z: 0 });
      } catch {
        // gone
      }
      play.notice(`${who.name}: ${hits.get(key)} hits`, LAUNCH);
      await everyTick(play, LAUNCH, (tick) => {
        try {
          const at = body.location;
          dimension.spawnParticle("minecraft:basic_flame_particle", { x: at.x, y: at.y - 0.3, z: at.z });
          if (tick % 4 === 0) dimension.spawnParticle("minecraft:sparkler_emitter", at);
        } catch {
          // gone
        }
      });
      // Put back before they land.
      moveTo(who, body, { ...start, yaw: undefined });
    }
    return { places };
  },
};
