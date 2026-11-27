// Mini Survival Games (FFA, and 2v2 by its teams; docs/plans/block-party-minigames.md): everyone
// starts on a pedestal around a stash of chests in the middle, more chests around the arena. On Go,
// grab gear and fight; real damage, after a few moments when nobody can hurt anyone. Later the border
// closes in toward the middle, and outside it costs a heart a second. Last one standing wins; at time
// the rest place by hearts left. The game places a chest at each Chests point and fills it from
// games/blockparty/minigames/survival.json (Middle ones with the better loot). Bots go to the
// nearest chest not yet opened (and get its best weapon's hit), then fight the nearest player.
import { BlockPermutation, ItemStack, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import file from "../../../minigames/survival.json";
import { MARKUP } from "./arenas.ts";
import { blockAt, botStep, byWeight, clock, everyTick, flat, Hearts, isPlayer, nearestOf, onPlan, placesByOut, sideMap } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play, type Spot } from "./kit.ts";

type Loot = { id: string; amount?: number; weight?: number };
const MIDDLE: readonly Loot[] = file.middle;
const OUTER: readonly Loot[] = file.outer;
/** Ticks between the border's particles, and between its hurts. */
const BORDER_SHOW = 10;
const BORDER_HURT = 20;

/** A bot's hit with what it took from chests, in half hearts. */
function weaponHit(loot: readonly string[]): number {
  if (loot.some((id) => id.includes("diamond_sword"))) return 7;
  if (loot.some((id) => id.includes("iron_sword") || id.includes("iron_axe"))) return 6;
  if (loot.some((id) => id.includes("stone_"))) return 5;
  if (loot.some((id) => id.includes("wooden_sword"))) return 4;
  return 2;
}

export const SURVIVAL: MinigameDef = {
  id: "survival",
  name: "Mini Survival Games",
  kind: "ffa",
  rules: "Grab gear from the chests and fight. Outside the closing border hurts. Last one standing wins.",
  tutorial: [
    {
      objective: "Grab gear from the chests, then fight: nobody can be hurt for the first moments. Later the border closes in, and outside it hurts. Last one standing wins.",
      controls: [
        { input: "use", what: "Open chests" },
        { input: "attack", what: "Fight" },
        { input: "move", what: "Stay inside the border" },
      ],
    },
  ],
  ...onPlan("survival"),
  problem(field) {
    return field.points(`${MARKUP.chests}.middle`).length + field.points(`${MARKUP.chests}.outer`).length > 0 ? undefined : "its arena map has no Chests";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension, sides } = play;
    const everyone = sides.flat();
    const sideOf = sideMap(sides);
    const total = play.setting("playTime") * 20;
    const grace = play.setting("grace") * 20;
    const borderStart = play.setting("borderStart") * 20;
    const borderEnd = play.setting("borderEnd") / 2;
    const middle = { x: field.min.x + field.size[0] / 2, y: field.min.y, z: field.min.z + field.size[2] / 2 };
    const startRadius = Math.max(field.size[0], field.size[2]) / 2 + 1;
    const perChest = file.perChest;
    const outAt = new Map<string, number>();
    let tick = 0;
    const out = (who: Who, why: string) => {
      if (play.isOut(who)) return;
      outAt.set(who.key, tick);
      play.out(who);
      play.say(`${who.name} ${why}.`);
    };
    const hearts = new Hearts(play, (who) => out(who, "is out"));
    play.hits("none");
    // The chests, filled.
    const chests: { at: Spot; loot: string[]; opened: boolean }[] = [];
    const fill = (spot: Spot, pool: readonly Loot[]) => {
      const block = blockAt(dimension, spot);
      const loot: string[] = [];
      try {
        block?.setPermutation(BlockPermutation.resolve("minecraft:chest"));
        const container = blockAt(dimension, spot)?.getComponent("minecraft:inventory")?.container;
        for (let i = 0; i < perChest; i++) {
          const pick = byWeight(pool, play.random);
          loot.push(pick.id);
          container?.setItem(Math.floor(play.random() * (container.size ?? 27)), new ItemStack(pick.id, pick.amount ?? 1));
        }
      } catch {
        // unloaded
      }
      chests.push({ at: spot, loot, opened: false });
    };
    for (const spot of field.points(`${MARKUP.chests}.middle`)) fill(spot, MIDDLE);
    for (const spot of field.points(`${MARKUP.chests}.outer`)) fill(spot, OUTER);
    const botLoot = new Map<string, string[]>();
    const foesOf = (who: Who) => play.inPlay().filter((one) => sideOf.get(one.key) !== sideOf.get(who.key));
    const sidesLeft = () => new Set(play.inPlay().map((who) => sideOf.get(who.key))).size;
    if (grace > 0) play.notice(`No fighting for ${Math.round(grace / 20)} seconds: grab what you can!`);
    await everyTick(play, total, (t) => {
      tick = t;
      if (t === grace) {
        play.hits("real");
        if (grace > 0) play.notice("Fight!");
      }
      // The border: from the arena's edge to its end size, over the time after it starts closing.
      const radius = t < borderStart ? startRadius : startRadius - ((startRadius - borderEnd) * Math.min(1, (t - borderStart) / Math.max(1, total - borderStart)));
      if (t >= borderStart && t % BORDER_SHOW === 0) {
        for (let i = 0; i < 48; i++) {
          const angle = (i / 48) * Math.PI * 2;
          try {
            dimension.spawnParticle("minecraft:redstone_wire_dust_particle", { x: middle.x + Math.cos(angle) * radius, y: middle.y + 1.5, z: middle.z + Math.sin(angle) * radius });
          } catch {
            // unloaded
          }
        }
      }
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body) continue;
        if (t >= borderStart && t % BORDER_HURT === 0 && flat(body.location, middle) > radius) hearts.hurt(who, 2, undefined, "border", (one) => out(one, "was caught by the border"));
        if (isPlayer(body)) continue;
        // A bot: chests first, then the fight (always back inside the border).
        const loot = botLoot.get(who.key) ?? [];
        if (t >= grace && hearts.botSwing(who, foesOf(who), weaponHit(loot), (one) => out(one, "is out"))) continue;
        const chest = loot.length < perChest * 2 ? nearestChest(chests, body.location) : undefined;
        if (chest && t < grace + 200) {
          if (botStep(play, who, chest.at, 0.22, 1.3)) {
            chest.opened = true;
            botLoot.set(who.key, [...loot, ...chest.loot]);
          }
          continue;
        }
        const foe = nearestOf(play, body.location, foesOf(who));
        const target: Vector3 = flat(body.location, middle) > radius - 1 ? middle : (foe?.body.location ?? middle);
        botStep(play, who, target, 0.22, 1.8);
      }
      if (t % 5 === 0) play.status(`${play.inPlay().length} left  ${t < grace ? `fight in ${clock(grace - t)}` : clock(total - t)}`);
      return everyone.length > 1 ? sidesLeft() <= 1 : play.inPlay().length === 0;
    });
    // The chests go with the arena; empty them so nothing spills.
    for (const chest of chests) {
      try {
        blockAt(dimension, chest.at)?.getComponent("minecraft:inventory")?.container?.clearAll();
      } catch {
        // unloaded
      }
    }
    if (sides.every((side) => side.length === 1)) return { places: placesByOut(everyone.map((who) => who.key), outAt, (key) => hearts.health(everyone.find((who) => who.key === key)!)) };
    const left = sides.map((side) => side.filter((who) => !play.isOut(who)).reduce((sum, who) => sum + 100 + hearts.health(who), 0));
    return { winner: left[0] === left[1] ? undefined : left[0] > left[1] ? 0 : 1 };
  },
};

function nearestChest(chests: { at: Spot; opened: boolean; loot: string[] }[], from: Vector3) {
  let best: { at: Spot; opened: boolean; loot: string[] } | undefined;
  let gap = Infinity;
  for (const chest of chests) {
    if (chest.opened) continue;
    const d = flat(chest.at, from);
    if (d < gap) {
      gap = d;
      best = chest;
    }
  }
  return best;
}
