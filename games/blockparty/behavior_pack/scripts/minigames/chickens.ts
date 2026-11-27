// Chicken Chase (FFA; docs/plans/block-party-minigames.md): chickens run loose in the pen. Hit one to
// catch it: it vanishes in a puff for a point, and another comes. Most points wins. Vanilla chickens,
// whose running about is the point; one out of the pen is put back. Bots chase the nearest chicken.
// For now every chicken is worth 1 (the plan's cold chickens worth 2 wait for a way to tell them
// apart by script).
import { world, type Entity } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_RUN, botStep, clock, everyTick, flat, inside, isPlayer, onPlan, placesBy, removeEntity, spawnIn, spotIn } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** How close a bot gets to catch a chicken. */
const BOT_CATCH = 1.6;

export const CHICKENS: MinigameDef = {
  id: "chickens",
  name: "Chicken Chase",
  kind: "ffa",
  rules: "Hit a chicken to catch it. Most chickens caught wins.",
  tutorial: [
    {
      objective: "Chickens run loose in the pen. Hit one to catch it for a point. Most points wins.",
      controls: [
        { input: "move", what: "Chase the chickens" },
        { input: "attack", what: "Catch a chicken" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("chickens"),
  problem(field) {
    return field.regions(MARKUP.pen)[0] ? undefined : "its arena map has no Pen";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension } = play;
    const pen = field.regions(MARKUP.pen)[0];
    const everyone = play.sides.flat();
    const total = play.setting("playTime") * 20;
    const most = play.setting("chickens");
    const points = new Map(everyone.map((who) => [who.key, 0]));
    const chickens = new Set<Entity>();
    const spawnChicken = () => {
      const chicken = spawnIn(play, "minecraft:chicken", spotIn(pen, play.random, 1));
      if (chicken) chickens.add(chicken);
    };
    for (let i = 0; i < most; i++) spawnChicken();
    const caught = (who: (typeof everyone)[number], chicken: Entity) => {
      if (!chickens.has(chicken)) return;
      chickens.delete(chicken);
      try {
        dimension.spawnParticle("minecraft:huge_explosion_emitter", chicken.location);
      } catch {
        // unloaded
      }
      removeEntity(chicken);
      points.set(who.key, (points.get(who.key) ?? 0) + 1);
      play.tell(who, `Caught! ${points.get(who.key)}`, 30);
      spawnChicken();
    };
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (!isPlayer(damagingEntity)) return;
      const who = everyone.find((one) => one.player?.id === damagingEntity.id);
      const chicken = [...chickens].find((one) => one.isValid && one.id === hitEntity.id);
      if (who && chicken && !play.isOut(who)) caught(who, chicken);
    });
    await everyTick(play, total, (tick) => {
      // Chickens out of the pen go back in.
      if (tick % 10 === 0) {
        for (const chicken of [...chickens]) {
          if (!chicken.isValid) {
            chickens.delete(chicken);
            spawnChicken();
            continue;
          }
          if (!inside(pen, chicken.location, 1)) chicken.teleport(spotIn(pen, play.random, 1));
        }
      }
      for (const who of play.inPlay()) {
        if (who.player) continue;
        const body = play.bodyOf(who);
        if (!body) continue;
        let best: Entity | undefined;
        let gap = Infinity;
        for (const chicken of chickens) {
          if (!chicken.isValid) continue;
          const d = flat(body.location, chicken.location);
          if (d < gap) {
            gap = d;
            best = chicken;
          }
        }
        if (!best) continue;
        if (gap < BOT_CATCH) caught(who, best);
        else botStep(play, who, best.location, BOT_RUN * 0.85);
      }
      if (tick % 5 === 0) play.status(`${everyone.map((who) => `${who.name} ${points.get(who.key)}`).join("  ")}  ${clock(total - tick)}`);
    });
    return { places: placesBy(everyone.map((who) => who.key), (key) => points.get(key) ?? 0) };
  },
};
