// Towers of Fortune (FFA; docs/plans/block-party-minigames.md): everyone starts on top of a pillar,
// far apart. Every few seconds everyone gets a random vanilla item (games/blockparty/minigames/
// towers.json, by weight): blocks, tools, weapons, armor, food, ender pearls, spawn eggs. Build,
// bridge and fight; real damage, and a fall (Kill Y) is out. Last one standing wins; at time the
// rest place by hearts left. Plays in Survival, so everything places and breaks; what's spawned or
// dropped in the arena goes with it. Bots bridge toward the nearest player and hit in reach.
import { EntityComponentTypes, GameMode, ItemStack, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import file from "../../../minigames/towers.json";
import { BOT_WALK, blockId, botStep, botWait, byWeight, clock, everyTick, fellOut, floorOf, Hearts, isPlayer, nearestOf, onPlan, placesByOut, setBlock } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

export const TOWER_ITEMS: readonly { id: string; amount?: number; weight?: number }[] = file.items;
/** Ticks between a bot's bridge blocks (a Medium bot's: botWait). */
const BOT_BRIDGE = 16;

export const TOWERS: MinigameDef = {
  id: "towers",
  name: "Towers of Fortune",
  kind: "ffa",
  rules: "A random item every few seconds. Build, bridge and fight. A fall is out.",
  tutorial: [
    {
      objective: "Everyone gets a random item every few seconds. Build, bridge over and fight: a fall or no hearts is out. Last one standing wins.",
      controls: [
        { input: "use", what: "Place, eat, throw" },
        { input: "attack", what: "Fight, break" },
        { input: "move", what: "Bridge across" },
      ],
    },
  ],
  ...onPlan("towers"),
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, dimension } = play;
    const everyone = play.sides.flat();
    const total = play.setting("playTime") * 20;
    const every = play.setting("itemEvery") * 20;
    const floorY = Math.min(field.min.y, floorOf(field.spawns, field) - 30);
    const outAt = new Map<string, number>();
    let tick = 0;
    const out = (who: Who, why: string) => {
      if (play.isOut(who)) return;
      outAt.set(who.key, tick);
      play.out(who);
      play.say(`${who.name} ${why}.`);
    };
    const hearts = new Hearts(play, (who) => out(who, "is out"));
    for (const who of everyone) {
      try {
        who.player?.setGameMode(GameMode.Survival);
      } catch {
        // gone
      }
    }
    const lastBridge = new Map<string, number>();
    await everyTick(play, total, (t) => {
      tick = t;
      if (t % every === 0) {
        for (const who of play.inPlay()) {
          const pick = byWeight(TOWER_ITEMS, play.random);
          try {
            who.player?.getComponent(EntityComponentTypes.Inventory)?.container?.addItem(new ItemStack(pick.id, pick.amount ?? 1));
          } catch {
            // an item this server doesn't know
          }
        }
      }
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body) continue;
        if (fellOut(field, body, floorY)) {
          out(who, "fell");
          continue;
        }
        if (isPlayer(body)) continue;
        const foes = play.inPlay().filter((one) => one.key !== who.key);
        if (hearts.botSwing(who, foes, 4, (one) => out(one, "is out"))) continue;
        const foe = nearestOf(play, body.location, foes);
        if (!foe) continue;
        // A bridge: a block ahead under its feet toward the nearest player, then a step onto it.
        const dx = foe.body.location.x - body.location.x;
        const dz = foe.body.location.z - body.location.z;
        const length = Math.hypot(dx, dz) || 1;
        const ahead: Vector3 = { x: Math.floor(body.location.x + (dx / length) * 0.8), y: Math.floor(body.location.y) - 1, z: Math.floor(body.location.z + (dz / length) * 0.8) };
        if (blockId(dimension, ahead) === "minecraft:air") {
          if (t - (lastBridge.get(who.key) ?? -99) >= botWait(play, BOT_BRIDGE)) {
            lastBridge.set(who.key, t);
            setBlock(dimension, ahead, "minecraft:oak_planks");
          }
          continue;
        }
        botStep(play, who, { x: ahead.x + 0.5, y: body.location.y, z: ahead.z + 0.5 }, BOT_WALK * 0.6, 0.2);
      }
      if (t % 5 === 0) play.status(`${play.inPlay().length} left  ${clock(total - t)}`);
      return everyone.length > 1 ? play.inPlay().length <= 1 : play.inPlay().length === 0;
    });
    // What was spawned or dropped in the arena goes.
    try {
      const { min, size } = field;
      for (const entity of dimension.getEntities({ location: min, volume: { x: size[0], y: size[1], z: size[2] } })) {
        if (entity.typeId !== "minecraft:player" && entity.typeId !== "blockparty:bot") entity.remove();
      }
    } catch {
      // unloaded
    }
    return { places: placesByOut(everyone.map((who) => who.key), outAt, (key) => hearts.health(everyone.find((who) => who.key === key)!)) };
  },
};
