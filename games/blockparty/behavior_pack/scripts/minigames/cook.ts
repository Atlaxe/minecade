// Cook's Request (FFA, and 2v2 by its teams; tiled; docs/plans/block-party-minigames.md): a kitchen
// each (each team's in a 2v2), with a few interactables that give the ingredients. A villager asks
// for a dish and everyone races to make it: take what the crops, animals and pantry chests give,
// prepare and cook it with the kitchen's blocks, then hand the dish to the villager (a use on it,
// holding the dish). Each request scores by order of delivery (3, 2, 1); then the kitchen resets for
// the next. Most points after the requests wins. Recipes and the rest are
// games/blockparty/minigames/cook.json's.
// The interactables: crops (breaking one gives its crop, the break cancelled and the crop back to
// seeds, grown again after the Regrow setting), animals at the Animal spots (a hit gives its meat and
// it comes back later; a bucket milks a cow, a use on a chicken gives an egg), pantry chests (filled
// each request). The kitchen (the custom blocks pack's, run by script): a cooking pot takes what you
// use on it and cooks a recipe's mix while on a stove, a use taking the dish out (a hit tips out a
// mix); a skillet on a stove cooks raw food in 3 seconds; a cutting board chops what's put on it in
// three hits; a sink fills buckets and bottles; the trash bin takes what's in your hand. Bots deliver
// after a time around a good player's.
import { EntityComponentTypes, ItemStack, system, world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import file from "../../../minigames/cook.json";
import { MARKUP } from "./arenas.ts";
import { blockAt, blockId, botArm, botHold, botLook, botStep, botWait, clock, everyTick, flat, inside, item, onPlan, pick, placesBy, removeEntity, setBlock, sideMap, spawnIn, tilesOf, winnerBy } from "./common.ts";
import { type Field, type MinigameDef, type Outcome, type Play, type WorldBox } from "./kit.ts";

interface Ingredient {
  id: string;
  chopped?: boolean;
}
interface Dish {
  id: string;
  name: string;
  in: string;
  from: Ingredient[];
}
export const DISHES: readonly Dish[] = file.dishes;
const SKILLET: Readonly<Record<string, string>> = file.skillet;
const CHOP: readonly string[] = file.chop;
const CROPS: readonly { block: string; item: string; grown?: number }[] = file.crops;
const ANIMALS: Readonly<Record<string, string>> = file.animals;
const PANTRY: readonly string[] = file.pantry;
const DECOYS: readonly string[] = file.decoys;

const POT = "minecade:cooking_pot";
const SKILLET_BLOCK = "minecade:skillet";
const STOVE = "minecade:stove";
const BOARD = "minecade:cutting_board";
const SINK = "minecade:sink";
const TRASH = "minecade:trash_bin";
/** Ticks the skillet cooks, and hits a chop takes. */
const SKILLET_TICKS = 60;
const CHOPS = 3;
const CHOPPED = "Chopped ";
/** Points by order of delivery. */
const DELIVERY = [3, 2, 1];

function keyOf(at: Vector3): string {
  return `${Math.floor(at.x)},${Math.floor(at.y)},${Math.floor(at.z)}`;
}

function named(id: string): string {
  return id.replace(/^[a-z_]+:/, "").replace(/_block$/, "").replace(/_/g, " ");
}

/** The item in a player's hand, and a way to take one of it. */
function hand(player: Player): { item: ItemStack | undefined; take: () => void } {
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  const slot = player.selectedSlotIndex;
  const held = container?.getItem(slot);
  return {
    item: held,
    take: () => {
      if (!container || !held) return;
      if (held.amount > 1) {
        held.amount -= 1;
        container.setItem(slot, held);
      } else container.setItem(slot, undefined);
    },
  };
}

function giveItem(player: Player, id: string, chopped = false): void {
  try {
    const stack = new ItemStack(id, 1);
    if (chopped) stack.nameTag = `${CHOPPED}${named(id)}`;
    player.getComponent(EntityComponentTypes.Inventory)?.container?.addItem(stack);
  } catch {
    // an item this server doesn't know
  }
}

/** Whether a pot's contents are a recipe's, any order. */
function makes(contents: readonly Ingredient[], dish: Dish): boolean {
  if (dish.in !== "pot" || contents.length !== dish.from.length) return false;
  const left = contents.map((one) => `${one.id}${one.chopped ? "*" : ""}`).sort();
  const want = dish.from.map((one) => `${one.id}${one.chopped ? "*" : ""}`).sort();
  return left.every((one, i) => one === want[i]);
}

/** The animals a dish's meat comes from (cows for milk and beef, chickens for eggs), two at most. */
function animalsFor(dish: Dish): string[] {
  const wanted = new Set<string>();
  for (const one of dish.from) {
    const raw = Object.entries(SKILLET).find(([, cooked]) => cooked === one.id)?.[0] ?? one.id;
    const animal = Object.entries(ANIMALS).find(([, meat]) => meat === raw)?.[0];
    if (animal) wanted.add(animal);
    if (one.id === "minecraft:milk_bucket") wanted.add("minecraft:cow");
    if (one.id === "minecraft:egg") wanted.add("minecraft:chicken");
  }
  const list = [...wanted];
  return list.length > 0 ? list : ["minecraft:cow", "minecraft:chicken"];
}

interface Pot {
  contents: Ingredient[];
  cookingUntil?: number;
  dish?: Dish;
  ready?: boolean;
}

export const COOK: MinigameDef = {
  id: "cook",
  name: "Cook's Request",
  kind: "ffa",
  rules: "Make the dish the villager asks for in your kitchen and hand it over. First served scores the most.",
  tutorial: [
    {
      objective: "The villager asks for a dish. Gather from the crops, animals and pantry, cook it in your kitchen (pot, skillet, cutting board) and hand it to the villager. First served scores the most.",
      controls: [
        { input: "use", what: "Harvest, cook and hand it over" },
        { input: "attack", what: "Break crops, chop on the board" },
        { input: "move", what: "Work your kitchen" },
      ],
    },
  ],
  ...onPlan("cook"),
  problem(field) {
    if (!field.points(MARKUP.villager)[0]) return "its arena map has no Villager";
    return field.points(MARKUP.pantry).length > 0 ? undefined : "its arena map has no Pantry";
  },
  spawns(field, sides) {
    const tiles = tilesOf(field);
    return sides.map((count, i) => (tiles[i] ?? tiles[0]).spawns.slice(0, count));
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension, sides } = play;
    const tiles = tilesOf(field);
    const kitchens: Field[] = sides.map((_, i) => tiles[i] ?? tiles[0]);
    const boxOf = (tile: Field): WorldBox => ({ min: tile.min, max: { x: tile.min.x + tile.size[0] - 1, y: tile.min.y + tile.size[1] - 1, z: tile.min.z + tile.size[2] - 1 } });
    const sideOf = sideMap(sides);
    const tileAt = (at: Vector3) => kitchens.findIndex((tile) => inside(boxOf(tile), at));
    const requests = play.setting("requests");
    const requestTime = play.setting("requestTime") * 20;
    const cookTime = play.setting("cookTime") * 20;
    const regrow = play.setting("regrow") * 20;
    const scores = sides.map(() => 0);
    const pots = new Map<string, Pot>();
    const skillets = new Map<string, { raw?: string; until?: number; done?: string }>();
    const boards = new Map<string, { id?: string; chopped?: boolean; hits: number }>();
    const growing = new Map<string, number>();
    /** Each kitchen's animals: the entity, what it is, its spot. */
    const animals: { entity: Entity | undefined; type: string; spot: Vector3; tile: number; back?: number }[] = [];
    const villagers = kitchens.map((tile) => {
      const spot = tile.points(MARKUP.villager)[0];
      return spot ? spawnIn(play, "blockparty:villager", spot, spot.yaw, "") : undefined;
    });
    let dish: Dish = pick(DISHES, play.random);
    let delivered: number[] = [];
    let open = false;
    const whoIs = (player: Player): Who | undefined => sides.flat().find((one) => one.player?.id === player.id);
    const ownsTile = (who: Who, at: Vector3) => tileAt(at) === sideOf.get(who.key);
    // Crops: the break is cancelled; the crop given and set back to seeds, grown again later.
    scope.subscribeBefore(world.beforeEvents.playerBreakBlock, (event) => {
      const crop = CROPS.find((one) => one.block === event.block.typeId);
      event.cancel = true;
      if (!crop) return;
      const at = event.block.location;
      const player = event.player;
      system.run(() => {
        const who = whoIs(player);
        if (!who || !ownsTile(who, at) || growing.has(keyOf(at))) return;
        giveItem(player, crop.item);
        if (crop.grown !== undefined) {
          setBlock(dimension, at, crop.block, { growth: 0 });
          growing.set(keyOf(at), system.currentTick + regrow);
          scope.timeout(() => {
            growing.delete(keyOf(at));
            setBlock(dimension, at, crop.block, { growth: crop.grown! });
          }, Math.max(1, regrow));
        }
      });
    });
    const usePot = (who: Who, player: Player, at: Vector3) => {
      const key = keyOf(at);
      const pot = pots.get(key) ?? { contents: [] };
      pots.set(key, pot);
      const { item: held, take } = hand(player);
      if (pot.ready && pot.dish) {
        giveItem(player, pot.dish.id);
        pots.set(key, { contents: [] });
        play.tell(who, `${pot.dish.name} is ready!`, 40);
        return;
      }
      if (pot.cookingUntil !== undefined) return play.tell(who, "It's cooking...", 30);
      if (!held || pot.contents.length >= 6) return;
      pot.contents.push({ id: held.typeId, ...(held.nameTag?.startsWith(CHOPPED) ? { chopped: true } : {}) });
      take();
      if (held.typeId.endsWith("_bucket") && held.typeId !== "minecraft:bucket") giveItem(player, "minecraft:bucket");
      const match = DISHES.find((one) => makes(pot.contents, one));
      const onStove = blockId(dimension, { x: at.x, y: at.y - 1, z: at.z }) === STOVE;
      if (match && onStove) {
        pot.dish = match;
        pot.cookingUntil = system.currentTick + cookTime;
        play.tell(who, `Cooking ${match.name}...`, 40);
      } else play.tell(who, `In the pot: ${pot.contents.map((one) => `${one.chopped ? "chopped " : ""}${named(one.id)}`).join(", ")}`, 60);
    };
    const useSkillet = (who: Who, player: Player, at: Vector3) => {
      const key = keyOf(at);
      const pan = skillets.get(key) ?? {};
      skillets.set(key, pan);
      if (pan.done) {
        giveItem(player, pan.done);
        skillets.set(key, {});
        return;
      }
      if (pan.raw) return play.tell(who, "It's cooking...", 30);
      const { item: held, take } = hand(player);
      const cooked = held && SKILLET[held.typeId];
      if (!held || !cooked) return play.tell(who, "The skillet cooks meat, fish, potatoes and kelp.", 40);
      if (blockId(dimension, { x: at.x, y: at.y - 1, z: at.z }) !== STOVE) return play.tell(who, "The skillet needs a stove under it.", 40);
      take();
      pan.raw = held.typeId;
      pan.until = system.currentTick + SKILLET_TICKS;
    };
    const useBoard = (who: Who, player: Player, at: Vector3) => {
      const key = keyOf(at);
      const board = boards.get(key) ?? { hits: 0 };
      boards.set(key, board);
      if (board.id && board.chopped) {
        giveItem(player, board.id, true);
        boards.set(key, { hits: 0 });
        return;
      }
      if (board.id) return play.tell(who, "Hit the board to chop it.", 30);
      const { item: held, take } = hand(player);
      if (!held || !CHOP.includes(held.typeId)) return play.tell(who, "The board chops carrots, apples, pumpkins and melon.", 40);
      take();
      board.id = held.typeId;
      board.hits = 0;
    };
    scope.subscribe(world.afterEvents.playerInteractWithBlock, ({ player, block }) => {
      const who = whoIs(player);
      if (!who || !open || !ownsTile(who, block.location)) return;
      const at = block.location;
      switch (block.typeId) {
        case POT:
          return usePot(who, player, at);
        case SKILLET_BLOCK:
          return useSkillet(who, player, at);
        case BOARD:
          return useBoard(who, player, at);
        case SINK: {
          const { item: held, take } = hand(player);
          if (held?.typeId === "minecraft:bucket") {
            take();
            giveItem(player, "minecraft:water_bucket");
          } else if (held?.typeId === "minecraft:glass_bottle") {
            take();
            giveItem(player, "minecraft:potion");
          }
          return;
        }
        case TRASH: {
          const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
          container?.setItem(player.selectedSlotIndex, undefined);
          return;
        }
      }
    });
    // Hits: the board chops, a pot's mix is tipped out.
    scope.subscribe(world.afterEvents.entityHitBlock, ({ damagingEntity, hitBlock }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const key = keyOf(hitBlock.location);
      if (hitBlock.typeId === BOARD) {
        const board = boards.get(key);
        if (board?.id && !board.chopped && ++board.hits >= CHOPS) board.chopped = true;
      } else if (hitBlock.typeId === POT) {
        const pot = pots.get(key);
        if (pot && !pot.cookingUntil && !pot.ready) pots.set(key, { contents: [] });
      }
    });
    // Animals: a hit gives meat (and it comes back later); a bucket milks a cow, a chicken gives an egg.
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const animal = animals.find((one) => one.entity?.isValid && one.entity.id === hitEntity.id);
      const who = whoIs(damagingEntity as Player);
      if (!animal || !who || sideOf.get(who.key) !== animal.tile) return;
      giveItem(damagingEntity as Player, ANIMALS[animal.type] ?? "minecraft:beef");
      removeEntity(animal.entity);
      animal.entity = undefined;
      animal.back = system.currentTick + regrow;
    });
    scope.subscribe(world.afterEvents.playerInteractWithEntity, ({ player, target }) => {
      const who = whoIs(player);
      if (!who || !open) return;
      const side = sideOf.get(who.key) ?? -1;
      // The villager: hand over the dish.
      if (villagers[side]?.isValid && target.id === villagers[side]?.id) {
        const { item: held, take } = hand(player);
        if (held?.typeId !== dish.id) return play.tell(who, `The villager wants ${dish.name}.`, 40);
        if (delivered.includes(side)) return;
        take();
        delivered.push(side);
        const add = DELIVERY[delivered.length - 1] ?? 0;
        scores[side] += add;
        play.say(`${sides[side].map((one) => one.name).join(" and ")} served ${dish.name}${delivered.length === 1 ? " first" : ""}.`);
        return;
      }
      const animal = animals.find((one) => one.entity?.isValid && one.entity.id === target.id && one.tile === side);
      if (!animal) return;
      const { item: held, take } = hand(player);
      if (animal.type === "minecraft:cow" && held?.typeId === "minecraft:bucket") {
        take();
        giveItem(player, "minecraft:milk_bucket");
      } else if (animal.type === "minecraft:chicken") giveItem(player, "minecraft:egg");
    });
    const reset = () => {
      pots.clear();
      skillets.clear();
      boards.clear();
      for (const animal of animals) removeEntity(animal.entity);
      animals.length = 0;
      kitchens.forEach((tile, t) => {
        const types = animalsFor(dish);
        tile.points(MARKUP.animals).forEach((spot, i) => {
          const type = types[i % types.length];
          animals.push({ entity: spawnIn(play, type, spot), type, spot, tile: t });
        });
        // The pantry: what the crops and animals don't give, and a few decoys.
        for (const spot of tile.points(MARKUP.pantry)) {
          setBlock(dimension, spot, "minecraft:chest");
          try {
            const container = blockAt(dimension, spot)?.getComponent("minecraft:inventory")?.container;
            container?.clearAll();
            const stock = [...PANTRY, ...PANTRY, pick(DECOYS, play.random), pick(DECOYS, play.random)];
            stock.forEach((id, slot) => container?.setItem(slot % (container.size ?? 27), new ItemStack(id, id.includes("bucket") || id.includes("bowl") || id.includes("bottle") ? 1 : 3)));
          } catch {
            // unloaded
          }
        }
      });
    };
    for (const who of sides.flat()) {
      play.give(who, item("minecraft:wooden_hoe", { canDestroy: CROPS.map((crop) => crop.block) }), 0);
      play.give(who, item("minecraft:bucket", { free: true }), 1);
      play.give(who, item("minecraft:bowl", { free: true, amount: 2 }), 2);
    }
    for (let request = 1; request <= requests && !scope.disposed; request++) {
      dish = request === 1 ? dish : pick(DISHES, play.random);
      delivered = [];
      reset();
      open = true;
      const how = dish.in === "pot" ? `in the pot: ${dish.from.map((one) => `${one.chopped ? "chopped " : ""}${named(one.id)}`).join(", ")}` : "at the crafting table";
      play.notice(`Request ${request}: ${dish.name}!\nMade ${how}`, 120);
      // An all-bot side's delivery time: a Medium bot's (botWait), so a slower level can miss a request.
      const botAt = new Map(sides.map((side, s) => [s, side.every((who) => !who.player) ? botWait(play, Math.floor(requestTime * (0.35 + play.random() * 0.45))) : -1]));
      // Meanwhile its bots work the kitchen, as players would: to a pantry chest, an animal or the
      // villager, a look and a use there (a chest's sound at a chest), a moment, then the next.
      const jobs = new Map<string, { to: Vector3; chest: boolean; until?: number }>();
      for (const who of sides.flat()) if (!who.player) botHold(play, who, undefined);
      const nextJob = (s: number): { to: Vector3; chest: boolean } => {
        const tile = kitchens[s];
        const places = [...tile.points(MARKUP.pantry).map((at) => ({ to: at, chest: true })), ...tile.points(MARKUP.animals).map((at) => ({ to: at, chest: false })), ...tile.points(MARKUP.villager).map((at) => ({ to: at, chest: false }))];
        return pick(places, play.random) ?? { to: tile.points(MARKUP.villager)[0], chest: false };
      };
      const work = (tick: number) => {
        sides.forEach((side, s) => {
          if ((botAt.get(s) ?? -1) < 0 || delivered.includes(s)) return;
          for (const who of side) {
            const body = play.bodyOf(who);
            if (!body) continue;
            let job = jobs.get(who.key);
            if (!job || (job.until !== undefined && tick >= job.until)) {
              job = nextJob(s);
              jobs.set(who.key, job);
            }
            if (job.until !== undefined) continue;
            if (!botStep(play, who, { x: job.to.x, y: body.location.y, z: job.to.z }, undefined, 1.4) && flat(body.location, job.to) > 1.5) continue;
            job.until = tick + botWait(play, 20 + Math.floor(play.random() * 25));
            botLook(play, who, job.to);
            botArm(play, who);
            if (job.chest) {
              try {
                dimension.playSound("random.chestopen", job.to, { volume: 0.6 });
              } catch {
                // unloaded
              }
            }
          }
        });
      };
      await everyTick(play, requestTime, (tick) => {
        work(tick);
        const now = system.currentTick;
        for (const pot of pots.values()) {
          if (pot.cookingUntil !== undefined && now >= pot.cookingUntil) {
            pot.cookingUntil = undefined;
            pot.ready = true;
          }
        }
        for (const pan of skillets.values()) {
          if (pan.raw && pan.until !== undefined && now >= pan.until) {
            pan.done = SKILLET[pan.raw];
            pan.raw = undefined;
            pan.until = undefined;
          }
        }
        for (const animal of animals) {
          if (!animal.entity && animal.back !== undefined && now >= animal.back) {
            animal.entity = spawnIn(play, animal.type, animal.spot);
            animal.back = undefined;
          } else if (animal.entity?.isValid && Math.hypot(animal.entity.location.x - animal.spot.x, animal.entity.location.z - animal.spot.z) > 3) {
            animal.entity.teleport(animal.spot);
          }
        }
        // All-bot sides deliver at their time.
        for (const [side, at] of botAt) {
          if (at >= 0 && tick >= at && !delivered.includes(side)) {
            // The dish held up to the villager.
            const villager = kitchens[side].points(MARKUP.villager)[0];
            for (const who of sides[side]) {
              botHold(play, who, dish.id);
              if (villager) botLook(play, who, villager);
              botArm(play, who);
            }
            delivered.push(side);
            scores[side] += DELIVERY[delivered.length - 1] ?? 0;
            play.say(`${sides[side].map((one) => one.name).join(" and ")} served ${dish.name}${delivered.length === 1 ? " first" : ""}.`);
          }
        }
        if (tick % 5 === 0) play.status(`${dish.name}  ${sides.map((side, s) => `${side.map((one) => one.name).join("+")} ${scores[s]}`).join("  ")}  ${clock(requestTime - tick)}`);
        return delivered.length >= sides.length;
      });
      open = false;
      await scope.wait(30);
    }
    for (const animal of animals) removeEntity(animal.entity);
    if (sides.every((side) => side.length === 1)) return { places: placesBy(sides.map((side) => side[0].key), (key) => scores[sideOf.get(key) ?? 0]) };
    return { winner: winnerBy(scores) };
  },
};
