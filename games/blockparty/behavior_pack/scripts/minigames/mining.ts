// Mining Race (FFA; docs/plans/block-party-minigames.md): each player has a cube of stone, filled
// with ores by the game. Break ores for points (games/blockparty/minigames/mining.json: each ore's
// points and how often it turns up). Most points wins. A pickaxe that breaks only stone and the ores
// (an Adventure player breaks only what it allows), with Haste to dig fast; nothing drops. With one
// Mines box everyone digs the same cube. Bots tunnel toward the nearest ore of their mine, a block
// every so often.
import { world, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import file from "../../../minigames/mining.json";
import { MARKUP } from "./arenas.ts";
import { blockId, blocksOf, botFace, botStep, byWeight, clock, everyTick, flat, item, onPlan, placesBy, setBlock } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play, type WorldBox } from "./kit.ts";

export const ORES: readonly { id: string; points: number; weight: number }[] = file.ores;
const STONE = "minecraft:stone";
/** Ticks between a bot's blocks. */
const BOT_DIG = 14;

export const MINING: MinigameDef = {
  id: "mining",
  name: "Mining Race",
  kind: "ffa",
  rules: "Dig into your stone and break ores for points. Most points wins.",
  tutorial: [
    {
      objective: "Dig into your cube of stone and break the ores for points: coal 1, iron 2, gold 3, diamond 5, emerald 8. Most points wins.",
      controls: [
        { input: "attack", what: "Mine" },
        { input: "move", what: "Get in close" },
      ],
    },
  ],
  ...onPlan("mining"),
  problem(field) {
    return field.regions(MARKUP.mines)[0] ? undefined : "its arena map has no Mines";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension } = play;
    const everyone = play.sides.flat();
    const mines = field.regions(MARKUP.mines);
    const mineOf = new Map<string, WorldBox>(everyone.map((who, i) => [who.key, mines[i] ?? mines[0]]));
    const total = play.setting("playTime") * 20;
    const share = play.setting("oreShare") / 100;
    const points = new Map(everyone.map((who) => [who.key, 0]));
    const pointsOf = new Map(ORES.map((ore) => [ore.id, ore.points]));
    // Fill every mine: stone, ores through it.
    for (const mine of new Set(mineOf.values())) {
      for (const at of blocksOf(mine)) setBlock(dimension, at, play.random() < share ? byWeight(ORES, play.random).id : STONE);
    }
    const canBreak = [STONE, ...ORES.map((ore) => ore.id)];
    for (const who of everyone) {
      play.give(who, item("minecraft:diamond_pickaxe", { canDestroy: canBreak }), 0);
      try {
        who.player?.addEffect("haste", total + 40, { amplifier: 2, showParticles: false });
      } catch {
        // gone
      }
    }
    const score = (who: Who, id: string) => {
      const add = pointsOf.get(id) ?? 0;
      if (add <= 0) return;
      points.set(who.key, (points.get(who.key) ?? 0) + add);
      play.tell(who, `+${add}`, 20);
    };
    // A player's break: its points, and nothing drops.
    scope.subscribe(world.afterEvents.playerBreakBlock, ({ player, brokenBlockPermutation, block }) => {
      const who = everyone.find((one) => one.player?.id === player.id);
      if (!who) return;
      score(who, brokenBlockPermutation.type.id);
      const at = block.location;
      scope.timeout(() => {
        try {
          for (const drop of dimension.getEntities({ type: "minecraft:item", location: { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 }, maxDistance: 2.5 })) drop.remove();
        } catch {
          // unloaded
        }
      }, 1);
    });
    /** The nearest ore in a mine to a spot. */
    const nearestOre = (mine: WorldBox, from: Vector3): Vector3 | undefined => {
      let best: { at: Vector3; gap: number } | undefined;
      for (const at of blocksOf(mine)) {
        const id = blockId(dimension, at);
        if (!pointsOf.has(id)) continue;
        const gap = Math.hypot(at.x + 0.5 - from.x, at.y + 0.5 - from.y, at.z + 0.5 - from.z);
        if (!best || gap < best.gap) best = { at, gap };
      }
      return best?.at;
    };
    const lastDig = new Map<string, number>();
    const oreOf = new Map<string, Vector3>();
    await everyTick(play, total, (tick) => {
      for (const who of play.inPlay()) {
        if (who.player) continue;
        const body = play.bodyOf(who);
        const mine = mineOf.get(who.key);
        if (!body || !mine) continue;
        const digging = tick - (lastDig.get(who.key) ?? -99) >= BOT_DIG;
        // The ore it's after, looked for again only when it digs (a mine is a few hundred blocks).
        const ore = digging || !oreOf.has(who.key) ? nearestOre(mine, body.location) : oreOf.get(who.key);
        if (!ore) continue;
        oreOf.set(who.key, ore);
        const middle = { x: ore.x + 0.5, y: ore.y, z: ore.z + 0.5 };
        botFace(body, middle);
        if (!digging) {
          botStep(play, who, { x: middle.x, y: body.location.y, z: middle.z }, 0.12, 1.2);
          continue;
        }
        lastDig.set(who.key, tick);
        if (flat(body.location, middle) < 2.6 && Math.abs(ore.y - body.location.y) < 3) {
          score(who, blockId(dimension, ore));
          setBlock(dimension, ore, "minecraft:air");
          continue;
        }
        // Tunnel: the blocks at its feet and head the way to the ore.
        const dx = middle.x - body.location.x;
        const dz = middle.z - body.location.z;
        const length = Math.hypot(dx, dz) || 1;
        for (const dy of [0, 1]) {
          const at = { x: Math.floor(body.location.x + (dx / length) * 0.9), y: Math.floor(body.location.y) + dy, z: Math.floor(body.location.z + (dz / length) * 0.9) };
          const id = blockId(dimension, at);
          if (id === STONE || pointsOf.has(id)) {
            score(who, id);
            setBlock(dimension, at, "minecraft:air");
          }
        }
      }
      if (tick % 5 === 0) play.status(`${everyone.map((who) => `${who.name} ${points.get(who.key)}`).join("  ")}  ${clock(total - tick)}`);
    });
    return { places: placesBy(everyone.map((who) => who.key), (key) => points.get(key) ?? 0) };
  },
};
