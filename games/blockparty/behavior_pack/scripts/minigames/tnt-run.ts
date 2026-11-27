// TNT Run (FFA; docs/plans/block-party-minigames.md): every floor block a player steps on vanishes a
// moment after. Layers under it catch a fall; below the last (Kill Y), a player is out. Last one in
// wins; the rest place by when they fell. The blocks under all four corners of a player's feet go,
// so edges hold nobody up. Bots keep walking toward blocks nobody has stepped on.
import type { Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, botStep, clock, everyTick, fellOut, inside, onPlan, placesByOut, setBlock } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** How far from a player's middle their feet's corners reach. */
const FOOT = 0.3;

export const TNT_RUN: MinigameDef = {
  id: "tntrun",
  name: "TNT Run",
  kind: "ffa",
  rules: "Every block you step on vanishes. Keep moving, and don't fall through the last floor.",
  tutorial: [
    {
      objective: "Every block you step on vanishes a moment later. Keep moving: fall through the last floor and you're out. Last one standing wins.",
      controls: [
        { input: "move", what: "Keep moving" },
        { input: "jump", what: "Hop the gaps" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("tntrun"),
  problem(field) {
    return field.regions(MARKUP.floor)[0] ? undefined : "its arena map has no Floor box";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, dimension } = play;
    const floor = field.regions(MARKUP.floor)[0];
    const everyone = play.sides.flat();
    const delay = Math.max(1, play.setting("delay") * 2);
    const total = play.setting("playTime") * 20;
    /** Blocks going, by "x,y,z": the tick they go. */
    const going = new Map<string, number>();
    const targets = new Map<string, Vector3>();
    const outAt = new Map<string, number>();
    const bottom = floor.min.y - 1;
    const pickTarget = (from: Vector3): Vector3 => {
      // A block nobody has stepped on yet on the bot's own layer, of a few looked at.
      const layer = Math.floor(from.y) - 1;
      let best: { at: Vector3; score: number } | undefined;
      for (let i = 0; i < 8; i++) {
        const x = floor.min.x + Math.floor(play.random() * (floor.max.x - floor.min.x + 1));
        const z = floor.min.z + Math.floor(play.random() * (floor.max.z - floor.min.z + 1));
        const at = { x, y: layer, z };
        if (going.has(`${x},${layer},${z}`) || blockId(dimension, at) === "minecraft:air") continue;
        const score = Math.hypot(x - from.x, z - from.z) * (0.5 + play.random());
        if (!best || score < best.score) best = { at: { x: x + 0.5, y: layer + 1, z: z + 0.5 }, score };
      }
      return best?.at ?? { x: (floor.min.x + floor.max.x + 1) / 2, y: from.y, z: (floor.min.z + floor.max.z + 1) / 2 };
    };
    await everyTick(play, total, (tick) => {
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body) continue;
        const at = body.location;
        if (fellOut(field, body, bottom, 1)) {
          outAt.set(who.key, tick);
          play.out(who);
          play.say(`${who.name} fell.`);
          continue;
        }
        // The blocks under each corner of their feet go a moment after.
        const under = Math.floor(at.y - 0.05);
        for (const [dx, dz] of [
          [-FOOT, -FOOT],
          [FOOT, -FOOT],
          [-FOOT, FOOT],
          [FOOT, FOOT],
        ]) {
          const block = { x: Math.floor(at.x + dx), y: under, z: Math.floor(at.z + dz) };
          if (!inside(floor, block)) continue;
          const key = `${block.x},${block.y},${block.z}`;
          if (!going.has(key) && blockId(dimension, block) !== "minecraft:air") going.set(key, tick + delay);
        }
        if (!who.player) {
          const target = targets.get(who.key);
          if (!target || Math.abs(target.y - at.y) > 1.5 || botStep(play, who, target, BOT_WALK, 0.5)) targets.set(who.key, pickTarget(at));
        }
      }
      for (const [key, when] of going) {
        if (when > tick) continue;
        going.delete(key);
        const [x, y, z] = key.split(",").map(Number);
        setBlock(dimension, { x, y, z }, "minecraft:air");
      }
      if (tick % 5 === 0) play.status(`${play.inPlay().length} left  ${clock(total - tick)}`);
      return everyone.length > 1 ? play.inPlay().length <= 1 : play.inPlay().length === 0;
    });
    return { places: placesByOut(everyone.map((who) => who.key), outAt) };
  },
};
