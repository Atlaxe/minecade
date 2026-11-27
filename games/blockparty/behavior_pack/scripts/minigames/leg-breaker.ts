// Leg Breaker (FFA; docs/plans/block-party-minigames.md): everyone jumps down a shaft through layers
// of platforms with holes in them; first to the Bottom wins. Each layer mixes five blocks landing
// their own (vanilla) way: slime bounces you back up, cobweb catches you, hay takes most of a fall,
// concrete none of it, magma burns. Falls hurt for real; a hard landing (3 hearts or more) breaks a
// leg: Slowness for 3 seconds. No hearts left: back to the top a moment later, healed. At time the
// rest place by how deep they got. The game lays random layers in the Layers box each time (evenly
// spaced, patches of the five blocks, holes); a map with Layers off keeps its own. Bots walk to the
// nearest hole and drop (they take no fall damage).
import { world, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, botStep, clock, everyTick, Hearts, isPlayer, moveTo, onPlan, placesBy, setBlock } from "./common.ts";
import { inOrder, over, type MinigameDef, type Outcome, type Play, type WorldBox } from "./kit.ts";

const BLOCKS = [
  { key: "slime", id: "minecraft:slime" },
  { key: "cobweb", id: "minecraft:web" },
  { key: "hay", id: "minecraft:hay_block" },
  { key: "concrete", id: "minecraft:white_concrete" },
  { key: "magma", id: "minecraft:magma" },
] as const;
/** A patch of one block, blocks across. */
const PATCH = 3;
/** A hard landing, in half hearts, and the broken leg's Slowness. */
const HARD_LANDING = 6;
const BROKEN_TICKS = 60;

/** A cheap hash to 0..1 of whole numbers (the layers' patches). */
function hash(a: number, b: number, c: number, seed: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Lays `count` random layers in a box, evenly spaced; returns each layer's height. */
function layLayers(play: Play, box: WorldBox): number[] {
  const count = play.setting("layerCount");
  const holes = play.setting("holes") / 100;
  const weights = BLOCKS.map((block) => Math.max(0, play.setting(block.key)));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const seed = Math.floor(play.random() * 100000);
  const height = box.max.y - box.min.y + 1;
  const ys: number[] = [];
  for (let i = 0; i < count; i++) {
    const y = box.max.y - Math.round(((i + 0.5) * height) / count);
    ys.push(y);
    for (let x = box.min.x; x <= box.max.x; x++) {
      for (let z = box.min.z; z <= box.max.z; z++) {
        const at = { x, y, z };
        if (play.random() < holes) {
          setBlock(play.dimension, at, "minecraft:air");
          continue;
        }
        let roll = hash(Math.floor(x / PATCH), Math.floor(z / PATCH), i, seed) * sum;
        let pick: string = BLOCKS[0].id;
        for (let b = 0; b < BLOCKS.length; b++) {
          roll -= weights[b];
          if (roll < 0) {
            pick = BLOCKS[b].id;
            break;
          }
        }
        setBlock(play.dimension, at, pick);
      }
    }
  }
  return ys;
}

export const LEG_BREAKER: MinigameDef = {
  id: "legbreaker",
  name: "Leg Breaker",
  kind: "ffa",
  rules: "Drop down the shaft through the layers. First to the bottom wins. Falls hurt.",
  tutorial: [
    {
      objective: "Drop down the shaft through the holes in each layer. Slime bounces, cobweb catches, hay softens a fall, magma burns. Falls hurt: first to the bottom wins.",
      controls: [
        { input: "move", what: "Find the holes" },
        { input: "jump", what: "Hop over a gap" },
        { input: "sneak", what: "Stand on magma without burning" },
      ],
    },
  ],
  ...onPlan("legbreaker"),
  problem(field) {
    return field.regions(MARKUP.bottom)[0] ? undefined : "its arena map has no Bottom";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension } = play;
    const bottom = field.regions(MARKUP.bottom)[0];
    const layersBox = field.regions(MARKUP.layers)[0];
    const everyone = play.sides.flat();
    const starts = new Map(everyone.map((who, i) => [who.key, field.spawns[i] ?? field.spawns[0]]));
    const total = play.setting("playTime") * 20;
    const respawn = Math.max(1, play.setting("respawn") * 20);
    const layerYs = layersBox ? layLayers(play, layersBox) : [];
    const topY = Math.max(...field.spawns.map((spot) => spot.y));
    const deepest = new Map(everyone.map((who) => [who.key, 0]));
    const finished: string[] = [];
    const resting = new Set<string>();
    const down = (who: Who) => {
      if (resting.has(who.key)) return;
      resting.add(who.key);
      play.tell(who, "Out of hearts! Back to the top.");
      scope.timeout(() => {
        hearts.heal(who);
        resting.delete(who.key);
        const start = starts.get(who.key);
        if (start) moveTo(who, play.bodyOf(who), start);
      }, respawn);
    };
    const hearts = new Hearts(play, down);
    // A hard landing breaks a leg.
    scope.subscribe(world.afterEvents.entityHurt, ({ hurtEntity, damage, damageSource }) => {
      if (!isPlayer(hurtEntity) || damageSource.cause !== "fall" || damage < HARD_LANDING) return;
      const who = everyone.find((one) => one.player?.id === hurtEntity.id);
      if (!who) return;
      try {
        hurtEntity.addEffect("slowness", BROKEN_TICKS, { amplifier: 1 });
      } catch {
        // gone
      }
      play.tell(who, "You broke a leg!", 40);
    });
    /** A bot's hole to drop through: the nearest air in the layer under it. */
    const holeFor = (at: Vector3): Vector3 | undefined => {
      const below = layerYs.find((y) => y < at.y - 0.5);
      if (below === undefined || !layersBox) return undefined;
      let best: { at: Vector3; gap: number } | undefined;
      for (let i = 0; i < 60; i++) {
        const x = layersBox.min.x + Math.floor(play.random() * (layersBox.max.x - layersBox.min.x + 1));
        const z = layersBox.min.z + Math.floor(play.random() * (layersBox.max.z - layersBox.min.z + 1));
        if (blockId(dimension, { x, y: below, z }) !== "minecraft:air") continue;
        const spot = { x: x + 0.5, y: at.y, z: z + 0.5 };
        const gap = Math.hypot(spot.x - at.x, spot.z - at.z);
        if (!best || gap < best.gap) best = { at: spot, gap };
      }
      return best?.at;
    };
    const holes = new Map<string, Vector3>();
    await everyTick(play, total, (tick) => {
      for (const who of play.inPlay()) {
        if (finished.includes(who.key) || resting.has(who.key)) continue;
        const body = play.bodyOf(who);
        if (!body) continue;
        const depth = topY - body.location.y;
        if (depth > (deepest.get(who.key) ?? 0)) deepest.set(who.key, depth);
        if (over(bottom, body.location, 1, 2)) {
          finished.push(who.key);
          play.say(`${who.name} reached the bottom${finished.length === 1 ? " first" : ""}.`);
          continue;
        }
        if (who.player) continue;
        // A bot over a layer heads for a hole in it; falling, it lets itself fall.
        const hole = holes.get(who.key);
        if (!hole || Math.abs(hole.y - body.location.y) > 1.5) {
          const next = holeFor(body.location);
          if (next) holes.set(who.key, next);
          else holes.delete(who.key);
        }
        const target = holes.get(who.key);
        if (target) botStep(play, who, target, BOT_WALK, 0.15);
      }
      if (tick % 5 === 0) play.status(`${everyone.map((who) => `${who.name} ${Math.floor(deepest.get(who.key) ?? 0)}`).join("  ")}  ${clock(total - tick)}`);
      return finished.length >= play.inPlay().length;
    });
    const rest = everyone.map((who) => who.key).filter((key) => !finished.includes(key));
    return { places: [...finished.map((key) => [key]), ...placesBy(rest, (key) => Math.floor(deepest.get(key) ?? 0))] };
  },
};
