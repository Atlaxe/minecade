// Egg Drop (FFA; docs/plans/block-party-minigames.md): eggs drift down over the drop area, slowly,
// each with a shadow under it; catch them before they land by walking into them. Rare ones count
// more: a brown egg 2 (a smoke trail) and a blue egg 3 (a flame trail). An egg that lands breaks with
// a splat. Most points wins. The eggs are vanilla's thrown egg moved down by script at the fall speed
// (taken away before it lands, so no chicks hatch). Bots run to the nearest egg's landing spot.
import { world, type Entity, type Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_RUN, blockId, botStep, clock, everyTick, flat, onPlan, placesBy, removeEntity, spawnIn } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

interface Egg {
  entity: Entity;
  at: Vector3;
  /** Where it lands (the top of what's under it). */
  floor: number;
  points: number;
}

export const EGG_DROP: MinigameDef = {
  id: "eggdrop",
  name: "Egg Drop",
  kind: "ffa",
  rules: "Catch the falling eggs by walking into them before they land. Rare eggs count more.",
  tutorial: [
    {
      objective: "Eggs drift down where the shadows show. Catch them by walking into them before they land: a smoking egg counts 2, a burning one 3. Most points wins.",
      controls: [
        { input: "move", what: "Get under the eggs" },
        { input: "jump", what: "Catch the high ones" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("eggdrop"),
  problem(field) {
    return field.regions(MARKUP.drop)[0] ? undefined : "its arena map has no Drop box";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension } = play;
    const drop = field.regions(MARKUP.drop)[0];
    const everyone = play.sides.flat();
    const total = play.setting("playTime") * 20;
    const rate = play.setting("eggRate") / 20;
    const fall = play.setting("eggSpeed") / 20;
    const rare = play.setting("rareShare") / 100;
    const points = new Map(everyone.map((who) => [who.key, 0]));
    const eggs: Egg[] = [];
    const landing = (x: number, z: number): number => {
      for (let y = drop.max.y - 1; y >= drop.min.y - 1; y--) if (blockId(dimension, { x, y, z }) !== "minecraft:air") return y + 1;
      return drop.min.y;
    };
    const catchEgg = (egg: Egg, who: (typeof everyone)[number]) => {
      if (!eggs.includes(egg)) return;
      eggs.splice(eggs.indexOf(egg), 1);
      removeEntity(egg.entity);
      points.set(who.key, (points.get(who.key) ?? 0) + egg.points);
      play.tell(who, `+${egg.points}`, 20);
      dimension.playSound("random.pop", egg.at);
    };
    // An egg that touches a player first is a catch too.
    scope.subscribe(world.afterEvents.projectileHitEntity, (event) => {
      const egg = eggs.find((one) => one.entity.isValid && one.entity.id === event.projectile.id);
      const hit = event.getEntityHit()?.entity;
      const who = hit && everyone.find((one) => play.bodyOf(one)?.id === hit.id);
      if (egg && who) catchEgg(egg, who);
    });
    let owed = 0;
    await everyTick(play, total, (tick) => {
      owed += rate;
      while (owed >= 1) {
        owed--;
        const x = drop.min.x + 0.5 + Math.floor(play.random() * (drop.max.x - drop.min.x + 1));
        const z = drop.min.z + 0.5 + Math.floor(play.random() * (drop.max.z - drop.min.z + 1));
        const at = { x, y: drop.max.y, z };
        const entity = spawnIn(play, "minecraft:egg", at);
        if (!entity) continue;
        const roll = play.random();
        eggs.push({ entity, at, floor: landing(Math.floor(x), Math.floor(z)), points: roll < rare / 3 ? 3 : roll < rare ? 2 : 1 });
      }
      for (const egg of [...eggs]) {
        egg.at = { x: egg.at.x, y: egg.at.y - fall, z: egg.at.z };
        try {
          egg.entity.teleport(egg.at);
          egg.entity.clearVelocity();
          if (tick % 4 === 0) dimension.spawnParticle("minecraft:basic_smoke_particle", { x: egg.at.x, y: egg.floor + 0.1, z: egg.at.z });
          if (egg.points === 2) dimension.spawnParticle("minecraft:basic_smoke_particle", egg.at);
          if (egg.points === 3) dimension.spawnParticle("minecraft:basic_flame_particle", egg.at);
        } catch {
          // gone
        }
        // A catch: the egg within a player's box.
        const catcher = play.inPlay().find((who) => {
          const body = play.bodyOf(who);
          return body && Math.abs(body.location.x - egg.at.x) < 0.7 && Math.abs(body.location.z - egg.at.z) < 0.7 && egg.at.y >= body.location.y - 0.2 && egg.at.y <= body.location.y + 2.1;
        });
        if (catcher) {
          catchEgg(egg, catcher);
          continue;
        }
        if (egg.at.y <= egg.floor + 0.2) {
          eggs.splice(eggs.indexOf(egg), 1);
          removeEntity(egg.entity);
          try {
            dimension.spawnParticle("minecraft:egg_destroy_emitter", egg.at);
          } catch {
            // a particle this client doesn't know
          }
        }
      }
      // Bots: to the nearest egg's landing spot that it can reach in time.
      for (const who of play.inPlay()) {
        if (who.player) continue;
        const body = play.bodyOf(who);
        if (!body) continue;
        let best: Egg | undefined;
        let score = Infinity;
        for (const egg of eggs) {
          const gap = flat(body.location, egg.at);
          const ticksLeft = (egg.at.y - egg.floor) / fall;
          if (gap / BOT_RUN > ticksLeft + 5) continue;
          const value = gap - egg.points * 2;
          if (value < score) {
            score = value;
            best = egg;
          }
        }
        if (best) botStep(play, who, { x: best.at.x, y: body.location.y, z: best.at.z }, BOT_RUN * 0.85, 0.2);
      }
      if (tick % 5 === 0) play.status(`${everyone.map((who) => `${who.name} ${points.get(who.key)}`).join("  ")}  ${clock(total - tick)}`);
    });
    for (const egg of eggs) removeEntity(egg.entity);
    return { places: placesBy(everyone.map((who) => who.key), (key) => points.get(key) ?? 0) };
  },
};
