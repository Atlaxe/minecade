// Anvil Rain (FFA; docs/plans/block-party-minigames.md): anvils fall over the floor, each marked by a
// shadow a moment before it drops, faster as time goes. The safe area shrinks: ring by ring from the
// edge, the floor fills with anvils. A falling anvil that reaches you puts you out (no damage: the
// game judges it). Last one in wins; the rest place by when they went out. Landed anvils stay as
// blocks until the arena is cleared. Bots step off a shadow after a moment's reaction.
import type { Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, botStep, botWait, clock, everyTick, flat, onPlan, placesByOut, setBlock } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** A falling block's speed gain a tick. */
const GRAVITY = 0.04;
/** Ticks before a bot sees a shadow under it (a Medium bot's: botWait). */
const BOT_REACT = 8;

interface Drop {
  x: number;
  z: number;
  /** The block it lands in, and the tick it drops, then lands. */
  y: number;
  dropAt: number;
  landAt: number;
  dropped: boolean;
}

export const ANVIL_RAIN: MinigameDef = {
  id: "anvilrain",
  name: "Anvil Rain",
  kind: "ffa",
  rules: "Anvils fall where shadows show. Keep out from under them as the floor fills up.",
  tutorial: [
    {
      objective: "Anvils fall where the shadows show, faster as time goes, and the floor fills in from its edge. Don't be under one when it lands.",
      controls: [
        { input: "move", what: "Dodge the shadows" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("anvilrain"),
  problem(field) {
    return field.regions(MARKUP.floor)[0] ? undefined : "its arena map has no Floor box";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, dimension } = play;
    const box = field.regions(MARKUP.floor)[0];
    const everyone = play.sides.flat();
    const total = play.setting("playTime") * 20;
    const warning = Math.max(3, play.setting("warning") * 2);
    const startRate = play.setting("startRate");
    const endRate = play.setting("endRate");
    const ringEvery = play.setting("ringEvery") * 20;
    const top = box.max.y;
    const width = box.max.x - box.min.x + 1;
    const depth = box.max.z - box.min.z + 1;
    const rings = Math.floor(Math.min(width, depth) / 2);
    /** How many rings have closed: columns closer to the edge than this are full. */
    let closed = 0;
    const drops: Drop[] = [];
    const outAt = new Map<string, number>();
    const fleeTo = new Map<string, Vector3>();
    const react = botWait(play, BOT_REACT);
    /** Where an anvil dropped on (x, z) lands: on the first block under the box's top. */
    const landing = (x: number, z: number): number | undefined => {
      for (let y = top - 1; y >= box.min.y - 1; y--) if (blockId(dimension, { x, y, z }) !== "minecraft:air") return y + 1 < top ? y + 1 : undefined;
      return undefined;
    };
    const queue = (x: number, z: number, tick: number) => {
      if (drops.some((drop) => drop.x === x && drop.z === z)) return;
      const y = landing(x, z);
      if (y === undefined) return;
      const fall = Math.ceil(Math.sqrt((2 * (top - y)) / GRAVITY));
      drops.push({ x, z, y, dropAt: tick + warning, landAt: tick + warning + fall, dropped: false });
    };
    const ring = (r: number): [number, number][] => {
      const cells: [number, number][] = [];
      for (let x = box.min.x + r; x <= box.max.x - r; x++) {
        for (let z = box.min.z + r; z <= box.max.z - r; z++) {
          if (x === box.min.x + r || x === box.max.x - r || z === box.min.z + r || z === box.max.z - r) cells.push([x, z]);
        }
      }
      return cells;
    };
    const safeSpot = (): Vector3 => {
      const r = Math.min(closed + 1, rings - 1);
      const x = box.min.x + r + play.random() * Math.max(1, width - 2 * r);
      const z = box.min.z + r + play.random() * Math.max(1, depth - 2 * r);
      return { x, y: box.min.y + 1, z };
    };
    let owed = 0;
    await everyTick(play, total, (tick) => {
      // New drops: their rate climbs from the start's to the end's, inside the safe area.
      owed += (startRate + ((endRate - startRate) * tick) / total) / 20;
      while (owed >= 1) {
        owed--;
        const spot = safeSpot();
        queue(Math.floor(spot.x), Math.floor(spot.z), tick);
      }
      // A ring closes: every column of it gets an anvil.
      if (tick > 0 && ringEvery > 0 && tick % ringEvery === 0 && closed < rings - 1) {
        for (const [x, z] of ring(closed)) queue(x, z, tick);
        closed++;
      }
      // Shadows, drops and landings.
      for (const drop of [...drops]) {
        if (!drop.dropped) {
          if (tick % 4 === 0) {
            try {
              dimension.spawnParticle("minecraft:basic_smoke_particle", { x: drop.x + 0.5, y: drop.y + 0.1, z: drop.z + 0.5 });
            } catch {
              // unloaded
            }
          }
          if (tick >= drop.dropAt) {
            drop.dropped = true;
            setBlock(dimension, { x: drop.x, y: top, z: drop.z }, "minecraft:anvil");
          }
        }
        if (tick >= drop.landAt) {
          drops.splice(drops.indexOf(drop), 1);
          for (const who of play.inPlay()) {
            const body = play.bodyOf(who);
            if (!body) continue;
            const at = body.location;
            const under = Math.abs(at.x - (drop.x + 0.5)) < 0.8 && Math.abs(at.z - (drop.z + 0.5)) < 0.8 && at.y > drop.y - 0.5 && at.y < drop.y + 1.5;
            if (!under) continue;
            outAt.set(who.key, tick);
            play.out(who);
            play.say(`An anvil got ${who.name}.`);
          }
        }
      }
      // Bots: off a shadow they're under, a moment after it shows.
      for (const who of play.inPlay()) {
        if (who.player) continue;
        const body = play.bodyOf(who);
        if (!body) continue;
        const threat = drops.find((drop) => tick - (drop.dropAt - warning) >= react && flat(body.location, { x: drop.x + 0.5, y: 0, z: drop.z + 0.5 }) < 1.6);
        let target = fleeTo.get(who.key);
        if (threat && (!target || flat(target, { x: threat.x + 0.5, y: 0, z: threat.z + 0.5 }) < 2)) {
          target = safeSpot();
          fleeTo.set(who.key, target);
        }
        if (target && botStep(play, who, target, BOT_WALK)) fleeTo.delete(who.key);
      }
      if (tick % 5 === 0) play.status(`${play.inPlay().length} left  ${clock(total - tick)}`);
      return everyone.length > 1 ? play.inPlay().length <= 1 : play.inPlay().length === 0;
    });
    return { places: placesByOut(everyone.map((who) => who.key), outAt) };
  },
};
