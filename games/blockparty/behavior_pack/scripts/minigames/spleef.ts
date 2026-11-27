// Spleef Duo (2v2, and FFA each alone; docs/plans/block-party-minigames.md): everyone gets a shovel
// that breaks the snow floor in one hit, and every block broken gives a snowball to throw. A snowball
// that hits a player knocks them back (Snowball knockback). Dig under the others, or knock them into
// a hole; a fall (Kill Y) is out. The last team with someone standing wins (each alone: places by
// when they fell). After the time, the floor crumbles by itself. Bots walk at a rival, break the snow
// under them now and then, and throw.
import { EntityComponentTypes, ItemStack, world } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, blocksOf, botAim, botArm, botFace, botLook, botStep, botWait, clock, everyTick, fellOut, floorOf, isPlayer, item, nearestOf, onPlan, placesByOut, setBlock, sideMap, throwFrom } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

const SNOW = "minecraft:snow";
/** Ticks a bot waits between breaking a rival's floor, and between throws (a Medium bot's: botWait). */
const BOT_BREAK = 30;
const BOT_THROW = 45;
/** Ticks between each crumbling block once time's up. */
const CRUMBLE_EVERY = 2;

export const SPLEEF: MinigameDef = {
  id: "spleef",
  name: "Spleef Duo",
  kind: "2v2",
  rules: "Break the snow under the other team, or knock them into a hole with snowballs. A fall is out.",
  tutorial: [
    {
      objective: "Break the snow under the others, or knock them into a hole: every block you break gives you a snowball. A fall is out. The last team standing wins.",
      controls: [
        { input: "attack", what: "Break the snow" },
        { input: "use", what: "Throw a snowball" },
        { input: "move", what: "Keep off the holes" },
      ],
    },
  ],
  ...onPlan("spleef"),
  problem(field) {
    return field.regions(MARKUP.floor)[0] ? undefined : "its arena map has no Floor box";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension, sides } = play;
    const floors = field.regions(MARKUP.floor);
    const everyone = sides.flat();
    const sideOf = sideMap(sides);
    const total = play.setting("playTime") * 20;
    const strength = play.setting("knockback") / 10;
    const floorY = Math.min(...floors.map((box) => box.min.y), floorOf(field.spawns, field));
    const snow = floors.flatMap((box) => blocksOf({ min: box.min, max: { ...box.max, y: box.min.y } }));
    for (const at of snow) setBlock(dimension, at, SNOW);
    for (const who of everyone) play.give(who, item("minecraft:diamond_shovel", { canDestroy: [SNOW] }), 0);
    play.hits("push", 1);
    const outAt = new Map<string, number>();
    const snowball = (who: Who) => {
      try {
        who.player?.getComponent(EntityComponentTypes.Inventory)?.container?.addItem(new ItemStack("minecraft:snowball", 1));
      } catch {
        // gone
      }
    };
    scope.subscribe(world.afterEvents.playerBreakBlock, ({ player, brokenBlockPermutation }) => {
      const who = everyone.find((one) => one.player?.id === player.id);
      if (who && brokenBlockPermutation.type.id === SNOW) snowball(who);
    });
    // A snowball's hit: a push, harder than vanilla's (bots too), never a teammate.
    scope.subscribe(world.afterEvents.projectileHitEntity, (event) => {
      const hit = event.getEntityHit()?.entity;
      const source = event.source;
      if (!hit || event.projectile.typeId !== "minecraft:snowball") return;
      const victim = everyone.find((who) => play.bodyOf(who)?.id === hit.id);
      const thrower = everyone.find((who) => play.bodyOf(who)?.id === source?.id);
      if (!victim || play.isOut(victim) || (thrower && sideOf.get(thrower.key) === sideOf.get(victim.key))) return;
      play.push(victim, source?.location ?? event.location, strength);
    });
    const lastBreak = new Map<string, number>();
    const lastThrow = new Map<string, number>();
    let crumbled = 0;
    const order = [...snow].sort(() => play.random() - 0.5);
    const sidesLeft = () => new Set(play.inPlay().map((who) => sideOf.get(who.key))).size;
    // Past the time limit the floor crumbles until someone's out.
    await everyTick(play, total + order.length * CRUMBLE_EVERY, (tick) => {
      if (tick >= total && tick % CRUMBLE_EVERY === 0 && crumbled < order.length) setBlock(dimension, order[crumbled++], "minecraft:air");
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body) continue;
        if (fellOut(field, body, floorY, 2)) {
          outAt.set(who.key, tick);
          play.out(who);
          play.say(`${who.name} fell.`);
          continue;
        }
        if (isPlayer(body)) continue;
        const rivals = play.inPlay().filter((one) => sideOf.get(one.key) !== sideOf.get(who.key));
        const rival = nearestOf(play, body.location, rivals);
        if (!rival) continue;
        botFace(body, rival.body.location);
        if (rival.gap < 3.2 && tick - (lastBreak.get(who.key) ?? -99) >= botWait(play, BOT_BREAK)) {
          lastBreak.set(who.key, tick);
          const under = { x: Math.floor(rival.body.location.x), y: Math.floor(rival.body.location.y - 0.5), z: Math.floor(rival.body.location.z) };
          if (blockId(dimension, under) === SNOW) {
            // Looked at and dug out with a swing, as a player breaks it.
            const block = { x: under.x + 0.5, y: under.y + 0.5, z: under.z + 0.5 };
            botLook(play, who, block);
            botArm(play, who);
            try {
              dimension.playSound("dig.snow", block, { volume: 0.7 });
            } catch {
              // unloaded
            }
            setBlock(dimension, under, "minecraft:air");
          }
        } else if (rival.gap < 12 && tick - (lastThrow.get(who.key) ?? -99) >= botWait(play, BOT_THROW)) {
          lastThrow.set(who.key, tick);
          throwFrom(play, body, { x: rival.body.location.x, y: rival.body.location.y + 1, z: rival.body.location.z }, { error: botAim(play, 1) });
        }
        if (rival.gap > 2.6) botStep(play, who, rival.body.location, BOT_WALK * 0.8, 2.4);
      }
      if (tick % 5 === 0) play.status(tick < total ? `${play.inPlay().length} left  ${clock(total - tick)}` : "The floor crumbles!");
      return everyone.length > 1 ? sidesLeft() <= 1 : play.inPlay().length === 0;
    });
    if (sides.every((side) => side.length === 1)) return { places: placesByOut(everyone.map((who) => who.key), outAt) };
    const standing = sides.map((side) => side.filter((who) => !play.isOut(who)).length);
    return { winner: standing[0] === standing[1] ? undefined : standing[0] > standing[1] ? 0 : 1 };
  },
};
