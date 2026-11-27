// Rising Lava (FFA; docs/plans/block-party-minigames.md): lava (or water, the map's choice) fills the
// Rise box from its bottom, a layer at a time, faster as it goes. Players climb the map's platforms;
// whoever it reaches (its top passes their feet) is out. Last one in wins; everyone still in when it
// reaches the top ties first. Hits do no damage, so lava only looks the part. Bots climb: the nearest
// step up within a few blocks, hopping onto it.
import type { Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, botRun, clock, everyTick, onPlan, placesByOut, setBlock } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** How far round a bot looks for its next step up. */
const LOOK = 3;

export const RISING_LAVA: MinigameDef = {
  id: "risinglava",
  name: "Rising Lava",
  kind: "ffa",
  rules: "Climb! The lava rises a layer at a time, faster and faster. It reaches you, you're out.",
  tutorial: [
    {
      objective: "The lava rises a layer at a time, faster as it goes. Climb the platforms to stay above it. Last one in wins.",
      controls: [
        { input: "move", what: "Climb" },
        { input: "jump", what: "Up a step" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("risinglava"),
  problem(field) {
    return field.regions(MARKUP.rise)[0] ? undefined : "its arena map has no Rise box";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, dimension } = play;
    const rise = field.regions(MARKUP.rise)[0];
    const everyone = play.sides.flat();
    const liquid = play.setting("water") === 1 ? "minecraft:water" : "minecraft:lava";
    const startDelay = play.setting("startDelay") * 20;
    const first = play.setting("riseEvery") * 2;
    const last = play.setting("riseEnd") * 2;
    const layers = rise.max.y - rise.min.y + 1;
    // Long enough for every layer at its pace, and a little more.
    const total = startDelay + Math.ceil(((first + last) / 2) * layers) + 40;
    const outAt = new Map<string, number>();
    /** The highest layer filled so far (below the box: none). */
    let level = rise.min.y - 1;
    let nextAt = startDelay;
    const fillLayer = (y: number) => {
      for (let x = rise.min.x; x <= rise.max.x; x++) for (let z = rise.min.z; z <= rise.max.z; z++) if (blockId(dimension, { x, y, z }) === "minecraft:air") setBlock(dimension, { x, y, z }, liquid);
    };
    const stepUp = (from: Vector3): Vector3 | undefined => {
      const feet = Math.floor(from.y);
      let best: { at: Vector3; gap: number } | undefined;
      for (let dx = -LOOK; dx <= LOOK; dx++) {
        for (let dz = -LOOK; dz <= LOOK; dz++) {
          const x = Math.floor(from.x) + dx;
          const z = Math.floor(from.z) + dz;
          // A block whose top is a step above the feet, with room to stand.
          const solid = blockId(dimension, { x, y: feet, z });
          if (solid === "minecraft:air" || solid.includes("lava") || solid.includes("water") || solid === "") continue;
          if (blockId(dimension, { x, y: feet + 1, z }) !== "minecraft:air" || blockId(dimension, { x, y: feet + 2, z }) !== "minecraft:air") continue;
          const gap = Math.hypot(dx, dz);
          if (!best || gap < best.gap) best = { at: { x: x + 0.5, y: feet + 1, z: z + 0.5 }, gap };
        }
      }
      return best?.at;
    };
    const targets = new Map<string, Vector3>();
    play.notice(`The ${liquid.includes("water") ? "water" : "lava"} is coming! Climb!`);
    await everyTick(play, total, (tick) => {
      if (tick >= nextAt && level < rise.max.y) {
        level++;
        fillLayer(level);
        const share = (level - rise.min.y) / Math.max(1, layers - 1);
        nextAt = tick + Math.max(1, Math.round(first + (last - first) * share));
      }
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body) continue;
        if (body.location.y < level + 1 - 0.05) {
          outAt.set(who.key, tick);
          play.out(who);
          play.say(`The ${liquid.includes("water") ? "water" : "lava"} got ${who.name}.`);
          continue;
        }
        if (who.player) continue;
        const target = targets.get(who.key);
        if (!target || Math.floor(target.y) <= Math.floor(body.location.y) - 0.5 || botRun(play, who, target, BOT_WALK, 0.3)) {
          const next = stepUp(body.location);
          if (next) targets.set(who.key, next);
          else targets.delete(who.key);
        }
      }
      if (tick % 5 === 0) play.status(`${play.inPlay().length} left  ${tick < startDelay ? `rises in ${clock(startDelay - tick)}` : `layer ${Math.max(0, level - rise.min.y + 1)} of ${layers}`}`);
      if (level >= rise.max.y) return true;
      return everyone.length > 1 ? play.inPlay().length <= 1 : play.inPlay().length === 0;
    });
    return { places: placesByOut(everyone.map((who) => who.key), outAt) };
  },
};
