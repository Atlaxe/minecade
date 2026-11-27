// Item Scramble (FFA; docs/plans/block-party-minigames.md): each player starts in a ring of 8 chests
// of their own. An item is called, and everyone searches their chests, full of random items, for it:
// having it in your inventory is a find. Finds score by order, 3 for the first, then 2 and 1. A new
// item each round, the chests refilled and inventories cleared. Most points after the rounds wins.
// Every player's chests hold the same items, shuffled; the called item is in exactly one of them.
// The items are games/blockparty/minigames/scramble.json's. Players are kept inside their own ring.
// Bots open a chest every 2 to 3 seconds, finding the item when they open its chest.
import { EntityComponentTypes, ItemStack, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import file from "../../../minigames/scramble.json";
import { blockAt, botStep, clock, everyTick, flat, moveTo, onPlan, pick, placesBy, setBlock, shuffled } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play, type Spot } from "./kit.ts";

const CALLS: readonly string[] = file.calls;
const FILL: readonly string[] = file.fill;
/** Points for the first, second and third find (later finds score nothing). */
const FIND_POINTS = [3, 2, 1];
/** The 8 chests around a spawn, as steps out (times the ring's distance). */
const RING = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

function itemName(id: string): string {
  return id.replace("minecraft:", "").replace(/_/g, " ");
}

function holds(who: Who, id: string): boolean {
  try {
    const container = who.player?.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!container) return false;
    for (let slot = 0; slot < container.size; slot++) if (container.getItem(slot)?.typeId === id) return true;
  } catch {
    // gone
  }
  return false;
}

export const SCRAMBLE: MinigameDef = {
  id: "scramble",
  name: "Item Scramble",
  kind: "ffa",
  rules: "Search your chests for the item called. The first to find it scores the most.",
  tutorial: [
    {
      objective: "An item is called: search your ring of chests for it and take it. The first to find it scores 3, then 2 and 1. A new item each round.",
      controls: [
        { input: "use", what: "Open a chest" },
        { input: "move", what: "Get to your chests" },
      ],
    },
  ],
  ...onPlan("scramble"),
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension } = play;
    const everyone = play.sides.flat();
    const rounds = play.setting("rounds");
    const roundTime = play.setting("roundTime") * 20;
    const ring = play.setting("ring");
    const perChest = play.setting("perChest");
    const points = new Map(everyone.map((who) => [who.key, 0]));
    const homes = new Map<string, Spot>(everyone.map((who, i) => [who.key, field.spawns[i] ?? field.spawns[0]]));
    const chestsOf = new Map<string, Vector3[]>();
    for (const who of everyone) {
      const home = homes.get(who.key)!;
      const base = { x: Math.floor(home.x), y: Math.floor(home.y), z: Math.floor(home.z) };
      chestsOf.set(
        who.key,
        RING.map(([dx, dz]) => ({ x: base.x + dx * ring, y: base.y, z: base.z + dz * ring })),
      );
    }
    for (const chests of chestsOf.values()) for (const at of chests) setBlock(dimension, at, "minecraft:chest");
    const empty = () => {
      for (const chests of chestsOf.values()) {
        for (const at of chests) {
          try {
            blockAt(dimension, at)?.getComponent("minecraft:inventory")?.container?.clearAll();
          } catch {
            // unloaded
          }
        }
      }
    };
    for (let round = 1; round <= rounds && !scope.disposed; round++) {
      const call = pick(CALLS, play.random);
      // Everyone's chests the same items: the call in one chest, the rest random fill, then shuffled.
      const items = [call, ...Array.from({ length: Math.min(perChest * 8, 200) - 1 }, () => pick(FILL.filter((id) => id !== call), play.random))];
      const callChest = Math.floor(play.random() * 8);
      const slots = shuffled(
        Array.from({ length: 8 * 27 }, (_, i) => i),
        play.random,
      );
      empty();
      for (const who of everyone) who.player?.getComponent(EntityComponentTypes.Inventory)?.container?.clearAll();
      // The same layout for everyone.
      const layout: { chest: number; slot: number; id: string }[] = [];
      let next = 0;
      items.forEach((id, i) => {
        if (i === 0) {
          layout.push({ chest: callChest, slot: Math.floor(play.random() * 27), id });
          return;
        }
        let place = slots[next++];
        while (Math.floor(place / 27) === callChest && layout.some((one) => one.chest === callChest && one.slot === place % 27)) place = slots[next++];
        layout.push({ chest: Math.floor(place / 27), slot: place % 27, id });
      });
      for (const chests of chestsOf.values()) {
        for (const { chest, slot, id } of layout) {
          try {
            blockAt(dimension, chests[chest])?.getComponent("minecraft:inventory")?.container?.setItem(slot, new ItemStack(id, 1));
          } catch {
            // unloaded, or an item this server doesn't know
          }
        }
      }
      const found: string[] = [];
      const botOrder = new Map(everyone.filter((who) => !who.player).map((who) => [who.key, shuffled([0, 1, 2, 3, 4, 5, 6, 7], play.random)]));
      const botNext = new Map(everyone.filter((who) => !who.player).map((who) => [who.key, 40 + Math.floor(play.random() * 20)]));
      play.notice(`Round ${round}: find a ${itemName(call)}!`, 60);
      await everyTick(play, roundTime, (tick) => {
        for (const who of play.inPlay()) {
          const body = play.bodyOf(who);
          const home = homes.get(who.key);
          if (!body || !home) continue;
          // Kept inside their own ring.
          if (flat(body.location, home) > ring + 1.5) moveTo(who, body, { ...home, yaw: undefined });
          if (found.includes(who.key)) continue;
          if (who.player) {
            if (tick % 5 === 0 && holds(who, call)) {
              found.push(who.key);
              const add = FIND_POINTS[found.length - 1] ?? 0;
              points.set(who.key, (points.get(who.key) ?? 0) + add);
              play.tell(who, `Found it! +${add}`, 40);
              play.say(`${who.name} found it${found.length === 1 ? " first" : ""}.`);
            }
            continue;
          }
          // A bot opens its next chest every 2 to 3 seconds.
          const order = botOrder.get(who.key)!;
          const chest = chestsOf.get(who.key)![order[0] ?? 0];
          botStep(play, who, { x: chest.x + 0.5, y: body.location.y, z: chest.z + 0.5 }, 0.2, 1.4);
          if (tick < (botNext.get(who.key) ?? 0)) continue;
          botNext.set(who.key, tick + 40 + Math.floor(play.random() * 20));
          const opened = order.shift();
          if (opened === callChest) {
            found.push(who.key);
            const add = FIND_POINTS[found.length - 1] ?? 0;
            points.set(who.key, (points.get(who.key) ?? 0) + add);
            play.say(`${who.name} found it${found.length === 1 ? " first" : ""}.`);
          }
        }
        if (tick % 5 === 0) play.status(`${itemName(call)}  ${everyone.map((who) => `${who.name} ${points.get(who.key)}`).join("  ")}  ${clock(roundTime - tick)}`);
        return found.length >= play.inPlay().length;
      });
      await scope.wait(30);
    }
    empty();
    return { places: placesBy(everyone.map((who) => who.key), (key) => points.get(key) ?? 0) };
  },
};
